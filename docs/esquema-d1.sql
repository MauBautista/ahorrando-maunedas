-- =====================================================================
-- Ahorrando Maunedas — esquema de referencia para Cloudflare D1 (SQLite)
-- Versión de diseño: v0 (2026-09-30)
--
-- Este archivo es el DISEÑO. La fuente de verdad en código será
-- apps/api/src/db/schema.ts (Drizzle) + apps/api/migrations/*.sql.
-- Las entidades Room de Android reflejan las tablas SYNC y DOWN.
--
-- Convenciones
--   * id TEXT            = UUIDv7 generado por el cliente (ordenable por tiempo).
--                          Tablas de unión y alias usan UUIDv5 determinista
--                          (ver comentarios) para que dos dispositivos offline
--                          generen el mismo id y no choquen.
--   * Tiempos            = INTEGER epoch ms UTC.
--   * Dinero             = INTEGER centavos. currency explícita ('MXN').
--   * Cantidades base    = g (mass), ml (volume), pz (count).
--   * Booleanos          = INTEGER 0/1.
--   * JSON               = TEXT validado en la API con Zod.
--
-- Columnas de sincronización (tablas SYNC):
--   created_at, updated_at   -> reloj del cliente (el servidor hace clamp a now+5min)
--   deleted_at               -> tombstone; NUNCA DELETE físico en tablas SYNC
--   updated_by               -> users.id (auditoría; no se muestra como "comprador")
--   version                  -> asignada por el servidor en cada push (sync_meta)
--
-- Tipos de tabla
--   SYNC   : editable por clientes, sincroniza en ambos sentidos (LWW por fila)
--   DOWN   : escrita solo por el servidor, se sincroniza hacia los clientes
--   SERVER : solo servidor, no se sincroniza
--
-- Índice (version, id) en toda tabla SYNC/DOWN: el pull pagina con
-- WHERE (version, id) > (?cursor_version, ?cursor_id) ORDER BY version, id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Infraestructura de sync (SERVER)
-- ---------------------------------------------------------------------
CREATE TABLE sync_meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO sync_meta (key, value) VALUES ('version', 0);
INSERT INTO sync_meta (key, value) VALUES ('schema_version', 1);      -- ver SDD 04 §4.8

-- ---------------------------------------------------------------------
-- Usuarios, identidades y dispositivos
-- Auth con Firebase: usuario + contraseña (correo sintético
-- <usuario>@<SYNTHETIC_EMAIL_DOMAIN>) o cuenta de Google. Ver SDD 02.
-- ---------------------------------------------------------------------
-- DOWN (al cliente solo viajan id, username, display_name, role, active)
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,     -- [a-z0-9._-]{3,32}
  display_name  TEXT NOT NULL,
  google_email  TEXT UNIQUE COLLATE NOCASE,              -- NULL = sin acceso con Google
  role          TEXT NOT NULL CHECK (role IN ('admin','member')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_users_version ON users(version, id);

-- SERVER. Una fila por cuenta de Firebase vinculada al usuario.
-- 'password' se crea cuando el admin da de alta al usuario;
-- 'google.com' se vincula en el primer login si el correo coincide con users.google_email.
CREATE TABLE user_identities (
  firebase_uid  TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL CHECK (provider IN ('password','google.com')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_user_identities_user ON user_identities(user_id);

-- SERVER
CREATE TABLE devices (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  platform      TEXT NOT NULL CHECK (platform IN ('android','web')),
  fcm_token     TEXT,
  app_version   TEXT,
  last_seen_at  INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_devices_user ON devices(user_id);

-- ---------------------------------------------------------------------
-- Tiendas (SYNC)
-- ---------------------------------------------------------------------
CREATE TABLE stores (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,             -- "Costco", "Tienda de la esquina"
  chain                       TEXT,                      -- agrupa cadenas si se quiere
  kind                        TEXT NOT NULL CHECK (kind IN ('physical','online','both')),
  website                     TEXT,
  adapter                     TEXT,                      -- adapter de tracking web: 'amazon_mx', ... (NULL = sin tracking)
  default_check_interval_min  INTEGER NOT NULL DEFAULT 480,  -- 8 h
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_stores_version ON stores(version, id);

CREATE TABLE store_branches (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores(id),
  name        TEXT NOT NULL,                             -- "Sucursal Centro"
  city        TEXT,
  address     TEXT,
  lat         REAL,
  lng         REAL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_store_branches_version ON store_branches(version, id);
CREATE INDEX idx_store_branches_store ON store_branches(store_id);

-- ---------------------------------------------------------------------
-- Catálogo (SYNC)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES categories(id),            -- jerárquica
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_categories_version ON categories(version, id);

CREATE TABLE tags (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL COLLATE NOCASE,                    -- dedupe en la UI; sin UNIQUE (offline)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_tags_version ON tags(version, id);

-- Producto conceptual: "Leche Lala Entera". Marca distinta = producto distinto.
CREATE TABLE products (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  brand             TEXT,
  category_id       TEXT REFERENCES categories(id),
  display_unit      TEXT NOT NULL DEFAULT 'pz'
                    CHECK (display_unit IN ('kg','100g','L','100ml','pz')),
  notes             TEXT,
  primary_image_id  TEXT,                                -- -> images.id
  search_key        TEXT NOT NULL DEFAULT '',            -- searchKey(name + ' ' + brand): minúsculas, sin acentos.
                                                         -- Derivada: el cliente la calcula y el servidor la recalcula al recibirla.
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_products_version ON products(version, id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_search ON products(search_key);

-- id = UUIDv5(NS_PRODUCT_TAGS, product_id || ':' || tag_id)
CREATE TABLE product_tags (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  tag_id      TEXT NOT NULL REFERENCES tags(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_tags_version ON product_tags(version, id);
CREATE INDEX idx_product_tags_product ON product_tags(product_id);

-- Variante = presentación: "1 L", "1.5 L", "Paquete 6 × 1 L", "A granel (kg)".
-- Contenido total en unidad base = unit_amount * pack_count.
--   1 L             -> measure=volume, unit_amount=1000, pack_count=1
--   6 × 1 L         -> measure=volume, unit_amount=1000, pack_count=6
--   Huevo 30 pz     -> measure=count,  unit_amount=30,   pack_count=1
--   Jitomate granel -> measure=mass,   unit_amount=1000, pack_count=1, sold_by_weight=1
--                      (purchase_items.quantity = kg comprados, p. ej. 0.845)
CREATE TABLE variants (
  id                TEXT PRIMARY KEY,
  product_id        TEXT NOT NULL REFERENCES products(id),
  label             TEXT NOT NULL,
  measure           TEXT NOT NULL CHECK (measure IN ('mass','volume','count')),
  unit_amount       REAL NOT NULL CHECK (unit_amount > 0),
  pack_count        INTEGER NOT NULL DEFAULT 1 CHECK (pack_count >= 1),
  sold_by_weight    INTEGER NOT NULL DEFAULT 0,
  primary_image_id  TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_variants_version ON variants(version, id);
CREATE INDEX idx_variants_product ON variants(product_id);

-- Un código pertenece a una sola variante (el paquete de 6 tiene su propio código).
-- Conflicto offline (dos teléfonos asignan el mismo código a variantes distintas):
-- el servidor lo detecta ANTES del batch y responde conflict 'barcode_taken'.
CREATE TABLE barcodes (
  id          TEXT PRIMARY KEY,
  variant_id  TEXT NOT NULL REFERENCES variants(id),
  code        TEXT NOT NULL,                             -- normalizado: solo dígitos
  format      TEXT,                                      -- EAN_13, UPC_A, ...
  source      TEXT NOT NULL CHECK (source IN ('scan','off','manual','receipt')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_barcodes_version ON barcodes(version, id);
CREATE UNIQUE INDEX uq_barcodes_code_live ON barcodes(code) WHERE deleted_at IS NULL;
CREATE INDEX idx_barcodes_variant ON barcodes(variant_id);

-- ---------------------------------------------------------------------
-- Imágenes
-- ---------------------------------------------------------------------
-- SYNC. Fila propiedad del cliente; apunta a las renditions elegidas.
CREATE TABLE images (
  id                      TEXT PRIMARY KEY,
  owner_type              TEXT NOT NULL CHECK (owner_type IN ('product','variant','purchase','observation')),
  owner_id                TEXT NOT NULL,
  role                    TEXT NOT NULL CHECK (role IN ('catalog','receipt','shelf_photo')),
  source                  TEXT NOT NULL CHECK (source IN ('user','off','generated')),
  license                 TEXT,                          -- p. ej. licencia de Open Food Facts
  attribution             TEXT,
  source_url              TEXT,
  original_key            TEXT,                          -- R2; NULL mientras se sube
  selected_processed_id   TEXT,                          -- -> image_renditions.id
  selected_thumb_id       TEXT,                          -- -> image_renditions.id
  edit_params             TEXT,                          -- JSON: crop, rotación, fondo, ajustes, manual
  enhance_requested_at    INTEGER,                       -- el usuario pidió "mejorar en casa" (T2)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_images_version ON images(version, id);
CREATE INDEX idx_images_owner ON images(owner_type, owner_id);

-- SYNC append-only: las crea el dispositivo (T1), el agente (T2), la IA (T3)
-- o el editor manual. Nunca se editan, solo se tombstonean; así el servidor
-- no pisa filas del cliente.
CREATE TABLE image_renditions (
  id          TEXT PRIMARY KEY,
  image_id    TEXT NOT NULL REFERENCES images(id),
  kind        TEXT NOT NULL CHECK (kind IN ('mask','processed','thumb')),
  tier        TEXT NOT NULL CHECK (tier IN ('catalog','device','home','ai','manual')),
  r2_key      TEXT NOT NULL,                             -- inmutable (clave versionada)
  width       INTEGER,
  height      INTEGER,
  bytes       INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_image_renditions_version ON image_renditions(version, id);
CREATE INDEX idx_image_renditions_image ON image_renditions(image_id);

-- SERVER. Cola de trabajos de imagen para el agente casero.
CREATE TABLE image_jobs (
  id          TEXT PRIMARY KEY,
  image_id    TEXT NOT NULL REFERENCES images(id),
  op          TEXT NOT NULL CHECK (op IN ('remove_bg')),
  status      TEXT NOT NULL CHECK (status IN ('queued','claimed','done','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  claimed_at  INTEGER,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_image_jobs_status ON image_jobs(status, created_at);

-- ---------------------------------------------------------------------
-- Compras (SYNC)
-- ---------------------------------------------------------------------
CREATE TABLE purchases (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  branch_id         TEXT REFERENCES store_branches(id),
  purchased_at      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'MXN',
  subtotal_cents    INTEGER,                             -- según ticket (para validar)
  discount_cents    INTEGER NOT NULL DEFAULT 0,          -- descuentos a nivel ticket
  total_cents       INTEGER,                             -- según ticket
  source            TEXT NOT NULL CHECK (source IN ('manual','receipt_ai','receipt_ocr','email','cfdi','import')),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  receipt_image_id  TEXT,                                -- -> images.id (role='receipt')
  notes             TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_purchases_version ON purchases(version, id);
CREATE INDEX idx_purchases_date ON purchases(purchased_at);
CREATE INDEX idx_purchases_store ON purchases(store_id, purchased_at);

-- Una línea del ticket.
--   quantity         : unidades de la variante (fraccional si sold_by_weight: kg)
--   unit_price_cents : precio de lista por unidad de variante
--   gross_cents      : round(quantity * unit_price_cents)
--   discount_cents   : descuentos de la línea (>= 0)
--   final_cents      : lo que realmente se pagó por la línea
-- Ejemplo 2x1: quantity=2, unit_price=8900, gross=17800, discount=8900, final=8900
CREATE TABLE purchase_items (
  id                TEXT PRIMARY KEY,
  purchase_id       TEXT NOT NULL REFERENCES purchases(id),
  line_no           INTEGER NOT NULL,
  variant_id        TEXT REFERENCES variants(id),        -- NULL = línea aún sin vincular
  raw_text          TEXT,                                -- "LCH LALA ENT 1L"
  quantity          REAL NOT NULL CHECK (quantity > 0),
  unit_price_cents  INTEGER NOT NULL,
  gross_cents       INTEGER NOT NULL,
  discount_cents    INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  final_cents       INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0,
  CHECK (final_cents = gross_cents - discount_cents)
);
CREATE INDEX idx_purchase_items_version ON purchase_items(version, id);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id, line_no);
CREATE INDEX idx_purchase_items_variant ON purchase_items(variant_id);

-- Aprendizaje de tickets: (tienda, texto normalizado) -> variante.
-- id = UUIDv5(NS_RECEIPT_ALIASES, store_id || ':' || raw_text_norm)
CREATE TABLE receipt_aliases (
  id              TEXT PRIMARY KEY,
  store_id        TEXT NOT NULL REFERENCES stores(id),
  raw_text_norm   TEXT NOT NULL,                         -- mayúsculas, espacios colapsados, sin precio
  variant_id      TEXT NOT NULL REFERENCES variants(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_receipt_aliases_version ON receipt_aliases(version, id);
CREATE UNIQUE INDEX uq_receipt_aliases_live ON receipt_aliases(store_id, raw_text_norm) WHERE deleted_at IS NULL;

-- SERVER. Resultado crudo de la extracción de tickets (auditoría y re-proceso).
CREATE TABLE receipt_extractions (
  id               TEXT PRIMARY KEY,
  image_ids        TEXT NOT NULL,                        -- JSON: 1 a 4 páginas del ticket (images.id)
  images_key       TEXT NOT NULL,                        -- sha256 de los ids ordenados (idempotencia)
  requested_by     TEXT REFERENCES users(id),
  purchase_id      TEXT REFERENCES purchases(id),
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('ok','failed','budget_exceeded')),
  result_json      TEXT,
  cost_usd_micros  INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_receipt_extractions_key ON receipt_extractions(images_key, created_at);

-- ---------------------------------------------------------------------
-- Tracker de precios
-- ---------------------------------------------------------------------
-- SYNC. Configuración del listing (editable por clientes).
CREATE TABLE listings (
  id                  TEXT PRIMARY KEY,
  variant_id          TEXT NOT NULL REFERENCES variants(id),
  store_id            TEXT NOT NULL REFERENCES stores(id),
  adapter             TEXT NOT NULL,                     -- 'amazon_mx','costco_mx','walmart_mx','sams_mx',...
  url                 TEXT NOT NULL,                     -- la que pegó el usuario
  canonical_url       TEXT,                              -- p. ej. https://www.amazon.com.mx/dp/<ASIN>
  external_id         TEXT,                              -- ASIN, SKU, item id
  check_interval_min  INTEGER,                           -- NULL = stores.default_check_interval_min
  active              INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_listings_version ON listings(version, id);
CREATE INDEX idx_listings_variant ON listings(variant_id);

-- DOWN. Estado operativo escrito por el servidor. Separado de listings para que
-- el LWW del cliente nunca pise datos del agente (ni al revés).
CREATE TABLE listing_state (
  listing_id             TEXT PRIMARY KEY REFERENCES listings(id),
  last_checked_at        INTEGER,
  last_status            TEXT CHECK (last_status IN ('pending','ok','not_found','blocked','error')),
  last_error             TEXT,
  consecutive_failures   INTEGER NOT NULL DEFAULT 0,
  last_price_cents       INTEGER,
  last_list_price_cents  INTEGER,
  last_in_stock          INTEGER,
  last_promo_text        TEXT,
  check_requested_at     INTEGER,                        -- botón "Revisar ahora"
  updated_at             INTEGER NOT NULL,
  version                INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_listing_state_version ON listing_state(version, listing_id);

-- SYNC. Observaciones de precio que NO son compras.
--   source='shelf' : captura manual en anaquel (la crea el cliente)
--   source='web'   : la crea el servidor al recibir resultados del agente,
--                    SOLO cuando cambia precio / stock / promo (compresión por cambio).
-- effective_price_cents: precio por unidad considerando la promo (2x1 -> la mitad).
CREATE TABLE price_observations (
  id                     TEXT PRIMARY KEY,
  variant_id             TEXT NOT NULL REFERENCES variants(id),
  store_id               TEXT NOT NULL REFERENCES stores(id),
  branch_id              TEXT REFERENCES store_branches(id),
  listing_id             TEXT REFERENCES listings(id),
  source                 TEXT NOT NULL CHECK (source IN ('shelf','web')),
  price_cents            INTEGER NOT NULL,               -- precio exhibido por unidad de variante
  list_price_cents       INTEGER,                        -- precio "antes" / tachado
  effective_price_cents  INTEGER,
  in_stock               INTEGER,
  promo_text             TEXT,
  extra                  TEXT,                           -- JSON: vendedor, envío, etc.
  observed_at            INTEGER NOT NULL,
  photo_image_id         TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_price_observations_version ON price_observations(version, id);
CREATE INDEX idx_price_observations_variant ON price_observations(variant_id, observed_at);
CREATE INDEX idx_price_observations_listing ON price_observations(listing_id, observed_at);

-- ---------------------------------------------------------------------
-- Promociones (SYNC)
-- Pertenecen a exactamente UNO de: compra, línea de compra u observación.
-- params (JSON) según type:
--   price_cut          {"from_cents":..., "to_cents":...}
--   percent            {"percent":15}
--   nxm                {"n":2,"m":1}            (2x1, 3x2)
--   nth_unit_discount  {"nth":2,"percent":50}   (segundo al 50 %)
--   member_price       {"program":"...", "member_cents":...}
--   coupon             {"code":"...", "amount_cents":...} o {"code":"...", "percent":10}
--   msi                {"months":12}            -> affects_price = 0
--   bundle / other     {"text":"...", "amount_cents":...}
-- Fórmulas del descuento: SDD 09 §6 y fixtures/promociones.json.
-- ---------------------------------------------------------------------
CREATE TABLE promotions (
  id                TEXT PRIMARY KEY,
  purchase_id       TEXT REFERENCES purchases(id),
  purchase_item_id  TEXT REFERENCES purchase_items(id),
  observation_id    TEXT REFERENCES price_observations(id),
  type              TEXT NOT NULL CHECK (type IN ('price_cut','percent','nxm','nth_unit_discount',
                                                  'member_price','coupon','msi','bundle','other')),
  params            TEXT,
  description       TEXT,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  affects_price     INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0,
  CHECK ((purchase_id IS NOT NULL) + (purchase_item_id IS NOT NULL) + (observation_id IS NOT NULL) = 1)
);
CREATE INDEX idx_promotions_version ON promotions(version, id);
CREATE INDEX idx_promotions_purchase ON promotions(purchase_id);
CREATE INDEX idx_promotions_item ON promotions(purchase_item_id);
CREATE INDEX idx_promotions_obs ON promotions(observation_id);

-- ---------------------------------------------------------------------
-- Alertas
-- ---------------------------------------------------------------------
-- SYNC (el pull filtra por user_id: cada quien ve sus reglas)
CREATE TABLE alert_rules (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  variant_id      TEXT NOT NULL REFERENCES variants(id),
  listing_id      TEXT REFERENCES listings(id),          -- NULL = cualquier listing de la variante
  type            TEXT NOT NULL CHECK (type IN ('below_price','drop_pct','new_low','back_in_stock','promo')),
  threshold_cents INTEGER,                               -- below_price
  threshold_pct   REAL,                                  -- drop_pct
  scope           TEXT NOT NULL DEFAULT 'variant_web'
                  CHECK (scope IN ('listing','variant_web','variant_all')),  -- para new_low
  cooldown_hours  INTEGER NOT NULL DEFAULT 24,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
  updated_by TEXT, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_alert_rules_version ON alert_rules(version, id);
CREATE INDEX idx_alert_rules_variant_active ON alert_rules(variant_id) WHERE active = 1 AND deleted_at IS NULL;

-- DOWN (filtradas por user_id). El cooldown se calcula con MAX(fired_at) por regla.
CREATE TABLE alert_events (
  id               TEXT PRIMARY KEY,
  rule_id          TEXT NOT NULL REFERENCES alert_rules(id),
  user_id          TEXT NOT NULL REFERENCES users(id),
  observation_id   TEXT REFERENCES price_observations(id),
  fired_at         INTEGER NOT NULL,
  title            TEXT NOT NULL,
  body             TEXT NOT NULL,
  delivery_status  TEXT NOT NULL CHECK (delivery_status IN ('sent','partial','failed','no_devices')),
  version          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_alert_events_version ON alert_events(version, id);
CREATE INDEX idx_alert_events_rule ON alert_events(rule_id, fired_at);

-- ---------------------------------------------------------------------
-- Agente casero, IA y caches
-- ---------------------------------------------------------------------
-- DOWN. Una sola fila id='home'. La app muestra "Servidor casero: en línea hace 3 min".
CREATE TABLE agent_status (
  id                 TEXT PRIMARY KEY,
  last_heartbeat_at  INTEGER,
  agent_version      TEXT,
  info               TEXT,                               -- JSON: cola, RAM, tiendas bloqueadas
  updated_at         INTEGER NOT NULL,
  version            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_agent_status_version ON agent_status(version, id);

-- SERVER. Contabilidad de IA para el tope mensual.
CREATE TABLE ai_usage (
  id               TEXT PRIMARY KEY,
  purpose          TEXT NOT NULL CHECK (purpose IN ('receipt','image_edit','other')),
  provider         TEXT NOT NULL,
  model            TEXT NOT NULL,
  user_id          TEXT REFERENCES users(id),
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  cost_usd_micros  INTEGER NOT NULL,                     -- costo reportado por el proveedor × 1e6
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_ai_usage_date ON ai_usage(created_at);

-- SERVER. Cache de Open Food Facts / Open Products Facts / Open Beauty Facts.
CREATE TABLE off_cache (
  code        TEXT PRIMARY KEY,
  found       INTEGER NOT NULL,
  source      TEXT,                                      -- 'off','opf','obf'
  payload     TEXT,                                      -- JSON recortado (nombre, marca, cantidad, imagen)
  fetched_at  INTEGER NOT NULL
);

-- SERVER. Token OAuth de FCM y similares.
CREATE TABLE token_cache (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------
-- Vista unificada de puntos de precio (compras + anaquel + web)
-- cents_per_base: centavos por g / ml / pz (REAL, sin redondear).
-- Room define una @DatabaseView equivalente para funcionar offline.
-- ---------------------------------------------------------------------
CREATE VIEW v_price_points AS
SELECT
  'purchase'                                            AS source,
  pi.id                                                 AS point_id,
  pi.variant_id                                         AS variant_id,
  p.store_id                                            AS store_id,
  p.branch_id                                           AS branch_id,
  NULL                                                  AS listing_id,
  p.purchased_at                                        AS observed_at,
  pi.unit_price_cents                                   AS list_unit_cents,
  CAST(ROUND(pi.final_cents / pi.quantity) AS INTEGER)  AS effective_unit_cents,
  pi.final_cents * 1.0 / (pi.quantity * v.unit_amount * v.pack_count) AS cents_per_base,
  (pi.discount_cents > 0)                               AS has_promo
FROM purchase_items pi
JOIN purchases p ON p.id = pi.purchase_id
JOIN variants  v ON v.id = pi.variant_id
WHERE pi.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'confirmed'
UNION ALL
SELECT
  o.source,
  o.id,
  o.variant_id,
  o.store_id,
  o.branch_id,
  o.listing_id,
  o.observed_at,
  o.price_cents,
  COALESCE(o.effective_price_cents, o.price_cents),
  COALESCE(o.effective_price_cents, o.price_cents) * 1.0 / (v.unit_amount * v.pack_count),
  (o.promo_text IS NOT NULL OR o.effective_price_cents IS NOT NULL)
FROM price_observations o
JOIN variants v ON v.id = o.variant_id
WHERE o.deleted_at IS NULL;
