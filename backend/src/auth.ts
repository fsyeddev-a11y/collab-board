/**
 * Clerk JWT verification helpers for the Worker.
 *
 * Two entry points:
 *  - verifyClerkRequest  — reads the Bearer token from the Authorization header.
 *                          Used by all REST endpoints (POST/GET).
 *  - verifyClerkQueryToken — reads the token from ?token= in the URL.
 *                          Used by WebSocket upgrades, where the browser's
 *                          WebSocket API does not support custom headers.
 */

// @clerk/backend and its transitive CJS deps (snakecase-keys → map-obj) cannot
// be loaded at module initialisation time inside the workerd test runtime —
// the CJS `require()` calls fail because workerd has no require() built-in.
// Identical reasoning to the dynamic import in BoardRoom.ts; see its comment.
// The import is deferred to the first call of extractClaims(), which only
// happens when a real JWT verification is needed — never during test startup.

export interface ClerkClaims {
  /** Clerk user ID (the `sub` claim). */
  userId: string;
  /**
   * The user's currently active Clerk organization ID (`org_id` claim).
   * null when the user has no active organization selected.
   */
  orgId: string | null;
  /**
   * The user's primary email address.
   * Populated only when the Clerk JWT template includes an `email` claim:
   *   Clerk Dashboard → JWT Templates → your template → add `"email": "{{user.primary_email_address}}"`
   * null when the claim is absent (e.g. templates not yet updated).
   */
  email: string | null;
}

async function extractClaims(
  token: string,
  secretKey: string,
): Promise<ClerkClaims | null> {
  try {
    const { verifyToken } = await import('@clerk/backend');
    const payload = await verifyToken(token, {
      secretKey,
      clockSkewInMs: 5000,
    });
    // `org_id` is a Clerk-specific claim not in the standard JWT TypeScript
    // types, so we cast through Record<string, unknown> to access it safely.
    const raw = payload as Record<string, unknown>;
    // Clerk v1 used a flat 'org_id' claim.
    // Clerk v2 nests it under an 'o' object: { o: { id: 'org_xxx', ... } }
    const orgFromFlat = typeof raw['org_id'] === 'string' ? raw['org_id'] : null;
    const oObject = raw['o'] as Record<string, unknown> | undefined;
    const orgFromNested = typeof oObject?.['id'] === 'string' ? oObject['id'] : null;
    const orgId = orgFromFlat ?? orgFromNested;
    const email = typeof raw['email'] === 'string' ? raw['email'] : null;
    return { userId: payload.sub, orgId, email };
  } catch {
    return null;
  }
}

/**
 * Verifies a Bearer JWT in the Authorization header.
 * Returns the verified claims or null if the header is absent or the token
 * is invalid / expired.
 */
export async function verifyClerkRequest(
  request: Request,
  secretKey: string,
): Promise<ClerkClaims | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return extractClaims(authHeader.slice(7), secretKey);
}

/**
 * Verifies a JWT supplied as the `?token=` query parameter.
 * WebSocket upgrades use this because `new WebSocket(url)` in the browser
 * cannot set custom request headers.
 */
export async function verifyClerkQueryToken(
  url: URL,
  secretKey: string,
): Promise<ClerkClaims | null> {
  const token = url.searchParams.get('token');
  if (!token) return null;
  return extractClaims(token, secretKey);
}
