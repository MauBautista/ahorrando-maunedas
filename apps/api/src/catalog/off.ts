import type { CatalogSource, OpenCatalogEntry } from '@maunedas/shared/api/barcodes';
import { parseQuantity } from '@maunedas/shared/catalog/quantity';
import { ApiError } from '../errors';

const DAY_MS = 86_400_000;
/** off_cache freshness (10 §2.1): a hit lasts 30 days, a miss 7. */
export const FOUND_TTL_MS = 30 * DAY_MS;
export const NOT_FOUND_TTL_MS = 7 * DAY_MS;
const TIMEOUT_MS = 5_000;
const FIELDS = 'product_name,product_name_es,brands,quantity,image_front_url,image_url';

/** Lookup order and attribution of each project (10 §2.1). */
export const OPEN_CATALOGS: ReadonlyArray<{ source: CatalogSource; host: string; attribution: string }> = [
  { source: 'off', host: 'world.openfoodfacts.org', attribution: 'Open Food Facts contributors' },
  { source: 'obf', host: 'world.openbeautyfacts.org', attribution: 'Open Beauty Facts contributors' },
  { source: 'opf', host: 'world.openproductsfacts.org', attribution: 'Open Products Facts contributors' },
];
/** License of the images of the three projects. */
export const CATALOG_IMAGE_LICENSE = 'CC BY-SA 3.0';

/** Trimmed product kept in off_cache.payload. */
interface CachedProduct {
  name: string | null;
  brand: string | null;
  quantity_text: string | null;
  image_url: string | null;
}

export interface OpenCatalogDeps {
  fetch: typeof fetch;
  userAgent: string;
  now: number;
}

type Answer = { found: true; product: CachedProduct } | { found: false } | { error: string };

const text = (v: unknown, max = 300) =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null;
const httpsUrl = (v: unknown) => {
  const url = text(v, 1000);
  return url?.startsWith('https://') ? url : null;
};

function trimProduct(p: Record<string, unknown>): CachedProduct {
  return {
    name: text(p.product_name_es) ?? text(p.product_name),
    brand: text(typeof p.brands === 'string' ? p.brands.split(',')[0] : null),
    quantity_text: text(p.quantity, 100),
    image_url: httpsUrl(p.image_front_url) ?? httpsUrl(p.image_url),
  };
}

/** One catalog: found, a definite "not found" (404 or status 0), or an error that must not be cached. */
async function ask(deps: OpenCatalogDeps, host: string, code: string): Promise<Answer> {
  let res: Response;
  try {
    res = await deps.fetch(`https://${host}/api/v2/product/${code}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': deps.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { error: `${host}: ${err instanceof Error ? err.name : 'fetch failed'}` };
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return { found: false };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return { error: `${host}: HTTP ${res.status}` };
  }
  let body: { status?: unknown; product?: unknown };
  try {
    body = await res.json();
  } catch {
    return { error: `${host}: invalid JSON` };
  }
  if (body.status !== 1 || typeof body.product !== 'object' || body.product === null) return { found: false };
  return { found: true, product: trimProduct(body.product as Record<string, unknown>) };
}

function toEntry(source: CatalogSource, code: string, p: CachedProduct): OpenCatalogEntry {
  const catalog = OPEN_CATALOGS.find((c) => c.source === source)!;
  return {
    source,
    name: p.name,
    brand: p.brand,
    quantity_text: p.quantity_text,
    parsed: parseQuantity(p.quantity_text),
    image_url: p.image_url,
    license: CATALOG_IMAGE_LICENSE,
    attribution: catalog.attribution,
    source_url: `https://${catalog.host}/product/${code}`,
  };
}

async function remember(
  db: D1Database,
  code: string,
  now: number,
  hit: { source: CatalogSource; product: CachedProduct } | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO off_cache (code, found, source, payload, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(code) DO UPDATE SET found = excluded.found, source = excluded.source,
                                       payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .bind(code, hit ? 1 : 0, hit?.source ?? null, hit ? JSON.stringify(hit.product) : null, now)
    .run();
}

/**
 * Open catalog lookup (10 §2.1): fresh off_cache first, then Open Food Facts → Open Beauty Facts →
 * Open Products Facts until one has the code. A miss is cached only when every catalog answered "not
 * found"; if some failed and none found it, a stale hit is served, or 502 UPSTREAM_ERROR.
 */
export async function lookupOpenCatalog(
  db: D1Database,
  code: string,
  deps: OpenCatalogDeps,
): Promise<OpenCatalogEntry | null> {
  const cached = await db
    .prepare('SELECT found, source, payload, fetched_at FROM off_cache WHERE code = ?1')
    .bind(code)
    .first<{ found: number; source: CatalogSource | null; payload: string | null; fetched_at: number }>();
  const age = cached ? deps.now - cached.fetched_at : Infinity;
  const cachedHit =
    cached?.found === 1 && cached.source && cached.payload
      ? toEntry(cached.source, code, JSON.parse(cached.payload) as CachedProduct)
      : null;
  if (cachedHit && age < FOUND_TTL_MS) return cachedHit;
  if (cached?.found === 0 && age < NOT_FOUND_TTL_MS) return null;

  const errors: string[] = [];
  for (const { source, host } of OPEN_CATALOGS) {
    const answer = await ask(deps, host, code);
    if ('error' in answer) {
      errors.push(answer.error);
    } else if (answer.found) {
      await remember(db, code, deps.now, { source, product: answer.product });
      return toEntry(source, code, answer.product);
    }
  }
  if (errors.length > 0) {
    console.warn(JSON.stringify({ msg: 'open catalog lookup failed', code, errors }));
    if (cachedHit) return cachedHit;
    throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'open_catalog' });
  }
  await remember(db, code, deps.now, null);
  return null;
}
