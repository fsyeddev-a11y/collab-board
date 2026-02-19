/**
 * Cursor throttle utility
 *
 * Determines whether a cursor update should be broadcast over WebSocket.
 * Two conditions must both be true:
 *   1. The cursor has actually moved (position changed)
 *   2. The throttle interval has elapsed since the last send
 *
 * Keeping this logic in a pure function makes it straightforward to unit-test
 * without needing a DOM, WebSocket, or tldraw editor instance.
 */

export const CURSOR_THROTTLE_MS = 50;

export function shouldSendCursor(
  x: number,
  y: number,
  lastX: number,
  lastY: number,
  lastSentAt: number,
  now: number,
  throttleMs: number = CURSOR_THROTTLE_MS,
): boolean {
  if (x === lastX && y === lastY) return false;
  return now - lastSentAt >= throttleMs;
}
