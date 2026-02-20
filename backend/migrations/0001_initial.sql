-- CollabBoard D1 schema — Phase 3 multi-tenant ACL
--
-- Apply with:
--   wrangler d1 migrations apply collabboard-db               (production)
--   wrangler d1 migrations apply collabboard-db --local       (local dev)

-- Boards owned by Clerk organizations
CREATE TABLE IF NOT EXISTS boards (
  id         TEXT    PRIMARY KEY,            -- crypto.randomUUID()
  name       TEXT    NOT NULL,
  org_id     TEXT    NOT NULL,               -- Clerk organization ID
  created_by TEXT    NOT NULL,               -- Clerk user ID of creator
  created_at INTEGER NOT NULL               -- Unix ms
);

-- Index for the "list boards my org owns" query path
CREATE INDEX IF NOT EXISTS idx_boards_org_id ON boards (org_id);

-- Explicit guest access — users invited to a board without org membership
CREATE TABLE IF NOT EXISTS board_guests (
  board_id TEXT    NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id  TEXT    NOT NULL,                 -- Clerk user ID of the guest
  added_at INTEGER NOT NULL,                -- Unix ms
  PRIMARY KEY (board_id, user_id)
);

-- Index for the "list boards I have guest access to" query path
CREATE INDEX IF NOT EXISTS idx_board_guests_user_id ON board_guests (user_id);
