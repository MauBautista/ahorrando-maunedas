// TEMPORARY (spike D, T-013): load driver for the CPU probes in src/spikes/d.ts. Run while
// `wrangler tail --env dev --format json` records cpuTime per invocation.
//   SPIKE_TOKEN_FILE=<file> node scripts/spike-d.ts
import { readFileSync } from 'node:fs';
import { exportJWK, exportPKCS8, generateKeyPair, SignJWT } from 'jose';
import { uuidv7 } from '@maunedas/shared/util/uuid';

const BASE = 'https://maunedas-dev.maunedas.workers.dev/v1/__spike/d';
const TOKEN = readFileSync(process.env.SPIKE_TOKEN_FILE ?? '', 'utf8').trim();
const PROJECT = 'pending-t004-dev';
const COSTCO = '01a152be-d300-7475-a574-383746a557e1'; // seeded store
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Spike-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) console.log(`  ${path} → HTTP ${res.status} ${text.slice(0, 160)}`);
  await sleep(1000);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function repeat(label: string, n: number, fn: () => Promise<unknown>) {
  console.log(`${label} ×${n}`);
  for (let i = 0; i < n; i++) await fn();
}

let clock = Date.now() - 86_400_000;
const meta = () => {
  clock += 10;
  return { id: uuidv7(), created_at: clock, updated_at: clock, deleted_at: null };
};

// --- keys for /jwt and /google-sign (generated here; never stored)
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const jwk = { ...(await exportJWK(publicKey)), kid: 'spike', alg: 'RS256' };
const pkcs8 = await exportPKCS8(privateKey);
const now = Math.floor(Date.now() / 1000);
const idToken = await new SignJWT({ firebase: { sign_in_provider: 'password' } })
  .setProtectedHeader({ alg: 'RS256', kid: 'spike' })
  .setIssuer(`https://securetoken.google.com/${PROJECT}`)
  .setAudience(PROJECT)
  .setSubject('uid-spike')
  .setIssuedAt(now)
  .setExpirationTime(now + 3 * 3600)
  .sign(privateKey);

await repeat('noop', 30, () => call('/noop'));
await repeat('jwt', 40, () => call('/jwt', { token: idToken, jwk }));
await repeat('google-sign', 40, () => call('/google-sign', { pkcs8 }));

// --- catalog: 500 products and 500 variants, 100 per push
const variantIds: string[] = [];
const brands = [
  'Lala',
  'Alpura',
  'Bimbo',
  'Pétalo',
  'Ariel',
  'Zote',
  'La Moderna',
  'Herdez',
  'Nutrioli',
  'Coca-Cola',
];
const kinds = [
  'Leche entera',
  'Pan blanco',
  'Papel higiénico',
  'Detergente',
  'Jabón',
  'Spaghetti',
  'Salsa verde',
  'Aceite',
  'Refresco',
  'Yogurt',
];
for (let batch = 0; batch < 5; batch++) {
  const products = Array.from({ length: 100 }, (_, i) => {
    const n = batch * 100 + i;
    return {
      table: 'products',
      row: { ...meta(), name: `${kinds[n % 10]} ${n}`, brand: brands[(n * 7) % 10] },
    };
  });
  await call('/push', { mutations: products });
  const variants = products.map((p) => {
    const v = {
      ...meta(),
      product_id: p.row.id,
      label: '1 L',
      measure: 'volume',
      unit_amount: 1000,
      pack_count: 1,
    };
    variantIds.push(v.id);
    return { table: 'variants', row: v };
  });
  await call('/push', { mutations: variants });
}
console.log('catalog: 500 products + 500 variants pushed');

// --- purchases: 1 purchase + 99 lines per push (a long ticket)
await repeat('push purchase + 99 lines', 20, async () => {
  const purchase = {
    ...meta(),
    store_id: COSTCO,
    purchased_at: clock,
    source: 'manual',
    status: 'confirmed',
  };
  const lines = Array.from({ length: 99 }, (_, i) => ({
    table: 'purchase_items',
    row: {
      ...meta(),
      purchase_id: purchase.id,
      line_no: i + 1,
      variant_id: variantIds[(i * 37 + clock) % variantIds.length],
      raw_text: `LCH LALA ENT 1L ${i}`,
      quantity: 2,
      unit_price_cents: 2850,
      gross_cents: 5700,
      discount_cents: 0,
      final_cents: 5700,
    },
  }));
  return call('/push', { mutations: [{ table: 'purchases', row: purchase }, ...lines] });
});

await repeat('pull from scratch (limit 500)', 20, () => call('/pull', { limit: 500 }));

const receipt = Array.from({ length: 40 }, (_, i) => `${7501020515300 + i} LCH LALA ENT 1L    ${28 + i}.50`);
await repeat('match 40 lines × 500 variants', 20, () => call('/match', { lines: receipt }));

for (const n of [50, 102, 150]) await repeat(`batch n=${n}`, 3, () => call(`/batch?n=${n}`, {}));
for (const n of [40, 60]) await repeat(`queries n=${n}`, 3, () => call(`/queries?n=${n}`, {}));
console.log('done');
