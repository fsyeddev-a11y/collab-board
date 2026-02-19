import { describe, it, expect } from "vitest";
import { shouldSendCursor, CURSOR_THROTTLE_MS } from "../utils/cursorThrottle";

describe("shouldSendCursor", () => {
  it("returns false when the cursor position has not changed", () => {
    // Cursor is at (10, 20) and hasn't moved — even if the interval has passed,
    // there is nothing to broadcast.
    expect(shouldSendCursor(10, 20, 10, 20, 0, 1000)).toBe(false);
  });

  it("returns false when the cursor moved but the throttle interval has not elapsed", () => {
    // Cursor moved from (10, 20) to (15, 25), but only 30 ms have passed
    // since the last send — not enough to clear the 50 ms throttle.
    const lastSentAt = 1000;
    const now = 1030; // 30 ms elapsed — below CURSOR_THROTTLE_MS (50)
    expect(shouldSendCursor(15, 25, 10, 20, lastSentAt, now)).toBe(false);
  });

  it("returns true when the cursor moved and the throttle interval has elapsed", () => {
    // Cursor moved and 60 ms have passed — the update should be sent.
    const lastSentAt = 1000;
    const now = 1060; // 60 ms elapsed — above CURSOR_THROTTLE_MS (50)
    expect(shouldSendCursor(15, 25, 10, 20, lastSentAt, now)).toBe(true);
  });

  it("returns true on the first ever send (lastSentAt = 0)", () => {
    // Initial state: lastSentAt is 0 so any positive `now` clears the throttle.
    expect(shouldSendCursor(5, 10, 0, 0, 0, CURSOR_THROTTLE_MS)).toBe(true);
  });

  it("returns true when exactly on the throttle boundary (inclusive)", () => {
    // At exactly 50 ms elapsed the condition is >= so it should return true.
    const lastSentAt = 1000;
    const now = 1050; // exactly 50 ms — satisfies >=
    expect(shouldSendCursor(1, 2, 0, 0, lastSentAt, now)).toBe(true);
  });

  it("respects a custom throttleMs argument", () => {
    // With a 200 ms custom throttle, 100 ms is not enough.
    expect(shouldSendCursor(1, 2, 0, 0, 1000, 1100, 200)).toBe(false);
    // But 200 ms is.
    expect(shouldSendCursor(1, 2, 0, 0, 1000, 1200, 200)).toBe(true);
  });
});
