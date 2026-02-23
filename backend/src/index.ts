/**
 * Cloudflare Worker entry point — Phase 3 multi-tenant build.
 *
 * Security gates in request order:
 *
 *  REST endpoints (Authorization: Bearer <jwt>)
 *   1. verifyClerkRequest   — JWT must be valid and not expired.
 *   2. Business rule checks — org membership, ownership, etc.
 *   3. Parameterized D1 queries — no string interpolation anywhere.
 *
 *  WebSocket upgrade (/board/:id/ws?token=<jwt>)
 *   Gate 1. verifyClerkQueryToken — JWT in ?token= query param (browser
 *           WebSocket API cannot send custom headers).
 *   Gate 2. userCanAccessBoard — D1 query confirms the board exists AND
 *           the user belongs to its org OR is an explicit guest.
 *           A valid JWT alone is not sufficient: boardId must also be
 *           authorized. This prevents IDOR on the real-time channel.
 *   Gate 3. (in BoardRoom DO) — DO still verifies the same JWT on the
 *           `connect` WS message for defense-in-depth.
 */

import { BoardRoom } from './durable-objects/BoardRoom';
import { verifyClerkRequest, verifyClerkQueryToken } from './auth';
import { getBoardsForUser, userCanAccessBoard, userCanInviteToBoard } from './db';

export { BoardRoom };

export interface Env {
  BOARD_ROOM: DurableObjectNamespace;
  DB: D1Database;
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  AI_SERVICE_URL: string;
  AI_SERVICE_SECRET: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  // Tighten to your Cloudflare Pages domain in production, e.g.:
  //   'Access-Control-Allow-Origin': 'https://collabboard.pages.dev'
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function apiError(message: string, status: number): Response {
  return json({ error: message }, status);
}

// ── Worker ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled Worker error:', err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (url.pathname === '/health') {
      return json({ status: 'ok', timestamp: Date.now() });
    }

    // ── POST /api/boards — create a board ────────────────────────────────────
    if (url.pathname === '/api/boards' && request.method === 'POST') {
      const claims = await verifyClerkRequest(request, env.CLERK_SECRET_KEY);
      if (!claims) return apiError('Unauthorized', 401);

      // Only org members can create boards — a board must belong to an org.
      if (!claims.orgId) {
        return apiError('An active organization is required to create boards', 403);
      }

      let body: { name?: unknown };
      try { body = await request.json(); } catch { return apiError('Invalid JSON body', 400); }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return apiError('name is required', 400);
      if (name.length > 100) return apiError('name must be 100 characters or fewer', 400);

      const boardId = crypto.randomUUID();
      await env.DB
        .prepare(
          `INSERT INTO boards (id, name, org_id, created_by, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`,
        )
        .bind(boardId, name, claims.orgId, claims.userId, Date.now())
        .run();

      return json({ id: boardId, name, org_id: claims.orgId }, 201);
    }

    // ── GET /api/boards — list accessible boards ─────────────────────────────
    if (url.pathname === '/api/boards' && request.method === 'GET') {
      const claims = await verifyClerkRequest(request, env.CLERK_SECRET_KEY);
      if (!claims) return apiError('Unauthorized', 401);

      // Returns org-owned boards UNION guest boards — see db.ts for the query.
      const boards = await getBoardsForUser(env.DB, claims.email, claims.orgId);
      return json({ boards });
    }

    // ── POST /api/boards/:id/invite — add a guest to a board ─────────────────
    const inviteMatch = url.pathname.match(/^\/api\/boards\/([\w-]+)\/invite$/);
    if (inviteMatch && request.method === 'POST') {
      const claims = await verifyClerkRequest(request, env.CLERK_SECRET_KEY);
      if (!claims) return apiError('Unauthorized', 401);

      const boardId = inviteMatch[1];

      // Security gate: only a member of the board's owning org may invite.
      // Guests cannot invite other guests.
      const canInvite = await userCanInviteToBoard(env.DB, boardId, claims.orgId);
      if (!canInvite) {
        return apiError(
          'Forbidden: only members of the board\'s organization can invite guests',
          403,
        );
      }

      let body: { email?: unknown };
      try { body = await request.json(); } catch { return apiError('Invalid JSON body', 400); }

      const inviteeEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!inviteeEmail) return apiError('email is required', 400);
      if (!inviteeEmail.includes('@')) return apiError('email must be a valid email address', 400);

      // INSERT OR IGNORE: idempotent — re-inviting an existing guest is a no-op.
      await env.DB
        .prepare(
          `INSERT OR IGNORE INTO board_guests (board_id, email, added_at)
           VALUES (?1, ?2, ?3)`,
        )
        .bind(boardId, inviteeEmail, Date.now())
        .run();

      return json({ success: true });
    }

    // ── DELETE /api/boards/:id — delete a board ──────────────────────────────
    const boardMatch = url.pathname.match(/^\/api\/boards\/([\w-]+)$/);
    if (boardMatch && request.method === 'DELETE') {
      const claims = await verifyClerkRequest(request, env.CLERK_SECRET_KEY);
      if (!claims) return apiError('Unauthorized', 401);

      const boardId = boardMatch[1];

      // Security gate: only an ADMIN of the org that owns the board may delete.
      //   - Guests (no orgId) → 403
      //   - Org members with 'member' role → 403
      //   - Org admins ('admin' or 'org:admin') → proceed
      if (!claims.orgId) {
        return apiError('Forbidden: only organization admins can delete boards', 403);
      }
      const isAdmin = claims.orgRole === 'admin' || claims.orgRole === 'org:admin';
      if (!isAdmin) {
        return apiError('Forbidden: only organization admins can delete boards', 403);
      }
      const row = await env.DB
        .prepare(`SELECT 1 FROM boards WHERE id = ?1 AND org_id = ?2`)
        .bind(boardId, claims.orgId)
        .first();
      if (!row) {
        // Either the board doesn't exist or belongs to a different org.
        // Return 403 (not 404) to avoid leaking whether the board exists.
        return apiError('Forbidden: board not found or you do not own it', 403);
      }

      // CASCADE on board_guests means guest rows are deleted automatically.
      await env.DB
        .prepare(`DELETE FROM boards WHERE id = ?1`)
        .bind(boardId)
        .run();

      return json({ success: true });
    }

    // ── WebSocket upgrade — /board/:id/ws?token=<jwt> ────────────────────────
    const wsMatch = url.pathname.match(/^\/board\/([\w-]+)\/ws$/);
    if (wsMatch && request.headers.get('Upgrade') === 'websocket') {
      const boardId = wsMatch[1];

      // ── Gate 1: JWT verification ──────────────────────────────────────────
      // The browser WebSocket API cannot set custom headers, so the JWT is
      // passed as a query parameter instead. Note: query params appear in
      // server logs; a pre-auth token exchange would be more secure but is
      // out of scope for this phase.
      const claims = await verifyClerkQueryToken(url, env.CLERK_SECRET_KEY);
      if (!claims) {
        return new Response('Unauthorized: missing or invalid token', {
          status: 401,
          headers: CORS_HEADERS,
        });
      }

      // ── Gate 2: D1 board access check (IDOR prevention) ──────────────────
      // A valid JWT is necessary but not sufficient. The board must exist in
      // D1 AND the user must be authorized for it. This single parameterized
      // query enforces both conditions atomically — there is no TOCTOU window.
      const hasAccess = await userCanAccessBoard(
        env.DB,
        boardId,
        claims.email,
        claims.orgId,
      );
      if (!hasAccess) {
        return new Response(
          'Forbidden: you do not have access to this board',
          { status: 403, headers: CORS_HEADERS },
        );
      }

      // Both gates passed — route to the Durable Object.
      // Gate 3 (JWT re-verification) happens inside the DO on the `connect`
      // message for defense-in-depth.
      const doId = env.BOARD_ROOM.idFromName(boardId);
      return env.BOARD_ROOM.get(doId).fetch(request);
    }

    // ── POST /api/generate — proxy to Hono AI service ─────────────────────────
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      const claims = await verifyClerkRequest(request, env.CLERK_SECRET_KEY);
      if (!claims) return apiError('Unauthorized', 401);

      if (!env.AI_SERVICE_URL || !env.AI_SERVICE_SECRET) {
        return apiError('AI service not configured', 503);
      }

      let body: unknown;
      try { body = await request.json(); } catch { return apiError('Invalid JSON body', 400); }

      // Forward to the Hono AI service with internal auth header.
      const aiResponse = await fetch(`${env.AI_SERVICE_URL}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': env.AI_SERVICE_SECRET,
        },
        body: JSON.stringify(body),
      });

      // Pass through the AI service response (status + body).
      const aiBody = await aiResponse.text();
      return new Response(aiBody, {
        status: aiResponse.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── POST /api/generate-code — proxy to Hono AI service (spatial compiler) ──
    if (url.pathname === '/api/generate-code' && request.method === 'POST') {
      const claims = await verifyClerkRequest(request, env.CLERK_SECRET_KEY);
      if (!claims) return apiError('Unauthorized', 401);

      if (!env.AI_SERVICE_URL || !env.AI_SERVICE_SECRET) {
        return apiError('AI service not configured', 503);
      }

      let body: unknown;
      try { body = await request.json(); } catch { return apiError('Invalid JSON body', 400); }

      const aiResponse = await fetch(`${env.AI_SERVICE_URL}/generate-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Secret': env.AI_SERVICE_SECRET,
        },
        body: JSON.stringify(body),
      });

      const aiBody = await aiResponse.text();
      return new Response(aiBody, {
        status: aiResponse.status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
}
