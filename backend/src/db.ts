/**
 * D1 query helpers — all queries use positional parameters (?1, ?2 …).
 * String interpolation into SQL is never used anywhere in this file.
 */

export interface Board {
  id: string;
  name: string;
  org_id: string;
  created_by: string;
  created_at: number;
}

/**
 * Returns every board the given user can access:
 *   (a) boards whose org_id matches the user's active Clerk org, UNION
 *   (b) boards where the user's email appears in board_guests.
 *
 * UNION (not OR + LEFT JOIN) is used deliberately:
 *   - It deduplicates automatically if a user is both an org member AND a
 *     guest of the same board.
 *   - It avoids the NULL-handling ambiguity of outer-join patterns.
 *
 * When orgId is null (no active org selected), only guest boards are returned.
 * When email is null (JWT template not yet configured), guest boards are skipped.
 */
export async function getBoardsForUser(
  db: D1Database,
  email: string | null,
  orgId: string | null,
): Promise<Board[]> {
  if (orgId && email) {
    // Both org membership and guest access paths — deduplicated via UNION.
    const result = await db
      .prepare(
        `SELECT id, name, org_id, created_by, created_at
         FROM boards
         WHERE org_id = ?1
         UNION
         SELECT b.id, b.name, b.org_id, b.created_by, b.created_at
         FROM boards b
         INNER JOIN board_guests bg ON bg.board_id = b.id
         WHERE bg.email = ?2
         ORDER BY created_at DESC`,
      )
      .bind(orgId, email)
      .all<Board>();
    return result.results;
  }

  if (orgId) {
    // Org membership only — no email claim available.
    const result = await db
      .prepare(
        `SELECT id, name, org_id, created_by, created_at
         FROM boards
         WHERE org_id = ?1
         ORDER BY created_at DESC`,
      )
      .bind(orgId)
      .all<Board>();
    return result.results;
  }

  if (email) {
    // Guest access only — user has no active org.
    const result = await db
      .prepare(
        `SELECT b.id, b.name, b.org_id, b.created_by, b.created_at
         FROM boards b
         INNER JOIN board_guests bg ON bg.board_id = b.id
         WHERE bg.email = ?1
         ORDER BY b.created_at DESC`,
      )
      .bind(email)
      .all<Board>();
    return result.results;
  }

  return [];
}

/**
 * IDOR guard for WebSocket connections.
 *
 * Returns true only when BOTH conditions hold:
 *   1. A board with the given boardId exists in D1.
 *   2. The user is authorized — either via org membership OR explicit guest
 *      access (email match in board_guests).
 *
 * A valid JWT alone is never sufficient: the boardId must also exist and the
 * user must belong to it. This prevents horizontal privilege escalation where
 * an authenticated user guesses a boardId they don't own.
 */
export async function userCanAccessBoard(
  db: D1Database,
  boardId: string,
  email: string | null,
  orgId: string | null,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1
       FROM boards
       WHERE id = ?1
         AND (
           org_id = ?2
           OR EXISTS (
             SELECT 1 FROM board_guests
             WHERE board_id = ?1
               AND email = ?3
           )
         )`,
    )
    // ?2: empty string when orgId is null → `org_id = ''` matches nothing,
    //     so the OR falls through to the email guest check.
    // ?3: empty string when email is null → guest path also matches nothing,
    //     so only org members gain access when email claim is absent.
    .bind(boardId, orgId ?? '', email ?? '')
    .first();
  return row !== null;
}

/**
 * Authorization gate for the invite endpoint.
 *
 * Only a member of the org that owns the board may invite guests.
 * Returns false when orgId is null (no active org) — guests cannot invite
 * other guests.
 */
export async function userCanInviteToBoard(
  db: D1Database,
  boardId: string,
  orgId: string | null,
): Promise<boolean> {
  if (!orgId) return false;
  const row = await db
    .prepare(`SELECT 1 FROM boards WHERE id = ?1 AND org_id = ?2`)
    .bind(boardId, orgId)
    .first();
  return row !== null;
}
