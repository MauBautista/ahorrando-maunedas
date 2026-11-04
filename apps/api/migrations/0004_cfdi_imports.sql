-- Migration 0004: CFDI invoices imported as draft purchases (T-307, 03 §14). Server table, append-only and never
-- synced: it keeps the invoice's fiscal UUID so it is not imported twice, and which store each issuer (RFC) was.
-- docs/esquema-d1.sql holds the accumulated schema; test/schema.test.ts checks they match.

CREATE TABLE cfdi_imports (
  id            TEXT PRIMARY KEY,
  fiscal_uuid   TEXT NOT NULL,
  purchase_id   TEXT NOT NULL REFERENCES purchases(id),
  store_id      TEXT NOT NULL REFERENCES stores(id),
  emisor_rfc    TEXT NOT NULL,
  emisor_name   TEXT,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_cfdi_imports_uuid ON cfdi_imports(fiscal_uuid);
CREATE INDEX idx_cfdi_imports_rfc ON cfdi_imports(emisor_rfc, created_at);
