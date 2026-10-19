-- Seed data (T-026): stores (PLAN.md) and proposed categories.
-- Idempotent: fixed UUIDv7 ids and INSERT OR IGNORE, so re-running never duplicates nor overwrites rows
-- the family edited or deleted. Each run takes a new sync version so clients pull the rows.
-- Apply with `pnpm --filter api db:seed:<local|dev|prod>`. Timestamps: 2026-10-19 00:00 America/Mexico_City.

UPDATE sync_meta SET value = value + 1 WHERE key = 'version';

-- Stores. Only Amazon, Costco and Sam's have a tracking adapter; Walmart blocks scraping (decision T34).
INSERT OR IGNORE INTO stores (id, name, chain, kind, website, adapter, default_check_interval_min, created_at, updated_at, version) VALUES
  ('01a152be-d300-7475-a574-383746a557e1', 'Costco', NULL, 'both', 'https://www.costco.com.mx', 'costco_mx', 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d301-716f-9ba4-1a5bef743bc6', 'Sam''s Club', 'Walmart de México', 'both', 'https://www.sams.com.mx', 'sams_mx', 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d302-7728-91d0-bc3a8a5265b0', 'Soriana', NULL, 'physical', 'https://www.soriana.com', NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d303-7468-a376-7e226ecb39fb', 'Bodega Aurrera', 'Walmart de México', 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d304-7175-bafe-5123f7a22f1b', 'Gran Bodega', NULL, 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d305-733f-99fd-fcdadc96a879', 'Walmart', 'Walmart de México', 'both', 'https://www.walmart.com.mx', NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d306-73c1-a5c5-7b05e7805b47', 'Farmacias Guadalajara', NULL, 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d307-7700-8647-e75212b006ae', 'Farmacias Similares', NULL, 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d308-778e-9429-ef2a3f79ee1c', 'Chedraui', NULL, 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d309-74ad-bc2b-8ab7eac25df8', 'La Comer', NULL, 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d30a-756e-99f5-b8a90c2765e9', 'OXXO', NULL, 'physical', NULL, NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d30b-710d-9532-8fc46d536849', 'Amazon', NULL, 'online', 'https://www.amazon.com.mx', 'amazon_mx', 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d30c-778c-a89b-aed065c57490', 'Mercado Libre', NULL, 'online', 'https://www.mercadolibre.com.mx', NULL, 480, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version'));

-- Top-level categories first (categories.parent_id references categories.id).
INSERT OR IGNORE INTO categories (id, parent_id, name, sort_order, created_at, updated_at, version) VALUES
  ('01a152be-d30d-779f-aaee-dd188252b7b5', NULL, 'Despensa', 1, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d30e-72ea-9546-bf91a8b1f355', NULL, 'Refrigerados', 2, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d30f-767e-aada-751fdda6b5e3', NULL, 'Frutas y verduras', 3, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d310-743b-8283-beef25e97b9f', NULL, 'Bebidas', 4, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d311-7596-8b65-81bcfb65b329', NULL, 'Limpieza', 5, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d312-751a-b4cb-af1a314eebe2', NULL, 'Higiene personal', 6, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d313-7542-9862-b012e27cc161', NULL, 'Farmacia', 7, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d314-7203-9047-75c58f00d6ba', NULL, 'Mascotas', 8, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version'));

INSERT OR IGNORE INTO categories (id, parent_id, name, sort_order, created_at, updated_at, version) VALUES
  ('01a152be-d315-7730-a93f-48e1f48a9b01', '01a152be-d30d-779f-aaee-dd188252b7b5', 'Granos y pastas', 1, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d316-7129-b8db-b5c80f1b869e', '01a152be-d30d-779f-aaee-dd188252b7b5', 'Enlatados', 2, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d317-71a3-b479-763d11becfd8', '01a152be-d30d-779f-aaee-dd188252b7b5', 'Aceites y condimentos', 3, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d318-728e-a555-e98fdc47a5c9', '01a152be-d30d-779f-aaee-dd188252b7b5', 'Botanas', 4, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d319-71ec-a96c-49f7c9ff89e7', '01a152be-d30e-72ea-9546-bf91a8b1f355', 'Lácteos', 1, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d31a-7189-bc53-a0e48be67445', '01a152be-d30e-72ea-9546-bf91a8b1f355', 'Carnes', 2, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version')),
  ('01a152be-d31b-71db-a70f-35661b784db0', '01a152be-d30e-72ea-9546-bf91a8b1f355', 'Embutidos', 3, 1792389600000, 1792389600000, (SELECT value FROM sync_meta WHERE key = 'version'));
