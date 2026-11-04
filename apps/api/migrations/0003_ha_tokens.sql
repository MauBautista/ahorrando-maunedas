-- Migration 0003: read-only tokens for Home Assistant (T-308, 03 §13). Server table, never synced: the Worker keeps
-- only the SHA-256 of each token; revoking sets revoked_at.
-- docs/esquema-d1.sql holds the accumulated schema; test/schema.test.ts checks they match.

CREATE TABLE ha_tokens (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  token_sha256  TEXT NOT NULL UNIQUE,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER
);
