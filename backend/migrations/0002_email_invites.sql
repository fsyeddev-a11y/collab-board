-- CollabBoard D1 migration — pivot board_guests from user_id to email
--
-- Apply with:
--   wrangler d1 migrations apply collabboard-db               (production)
--   wrangler d1 migrations apply collabboard-db --local       (local dev)

-- Drop old index first (references the column being removed)
DROP INDEX IF EXISTS idx_board_guests_user_id;

-- SQLite does not support ALTER COLUMN, so we use the standard
-- table-recreation pattern to safely change the primary key member.
CREATE TABLE board_guests_new (
  board_id TEXT    NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  email    TEXT    NOT NULL,                 -- invitee's email address
  added_at INTEGER NOT NULL,                -- Unix ms
  PRIMARY KEY (board_id, email)
);

-- Preserve any existing rows (treating old user_id values as the email
-- column). In practice this table is empty at migration time.
INSERT INTO board_guests_new (board_id, email, added_at)
  SELECT board_id, user_id, added_at FROM board_guests;

DROP TABLE board_guests;

ALTER TABLE board_guests_new RENAME TO board_guests;

-- Index for "list boards I have guest access to" query path
CREATE INDEX IF NOT EXISTS idx_board_guests_email ON board_guests (email);
