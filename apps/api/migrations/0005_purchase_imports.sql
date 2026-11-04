-- Migration 0005: purchases imported from a spreadsheet (T-306, 03 §15). Server table, append-only and never synced:
-- each imported purchase's fingerprint, so importing the same file again does not repeat it while it lives.
-- docs/esquema-d1.sql holds the accumulated schema; test/schema.test.ts checks they match.

CREATE TABLE purchase_imports (
  id            TEXT PRIMARY KEY,
  fingerprint   TEXT NOT NULL,
  purchase_id   TEXT NOT NULL REFERENCES purchases(id),
  file_name     TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_purchase_imports_fingerprint ON purchase_imports(fingerprint);
