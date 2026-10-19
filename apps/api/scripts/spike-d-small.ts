// TEMPORARY (spike D, second pass): smaller pushes and pull pages.
import { readFileSync } from 'node:fs';
import { uuidv7 } from '@maunedas/shared/util/uuid';

const BASE = 'https://maunedas-dev.maunedas.workers.dev/v1/__spike/d';
const TOKEN = readFileSync(process.env.SPIKE_TOKEN_FILE ?? '', 'utf8').trim();
const COSTCO = '01a152be-d300-7475-a574-383746a557e1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function call(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'X-Spike-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.log(`  ${path} → HTTP ${res.status}`);
  await res.text();
  await sleep(1000);
}
// Variants pushed in the first pass (any 50 of them).
const pulled = await fetch(`${BASE}/pull`, {
  method: 'POST',
  headers: { 'X-Spike-Token': TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ limit: 50 }),
}).then((r) => r.json() as Promise<{ changes: { variants?: Array<{ id: string }> } }>);
const variantIds = (pulled.changes.variants ?? []).map((v) => v.id);
let clock = Date.now() - 3_600_000;
const meta = () => ({ id: uuidv7(), created_at: (clock += 10), updated_at: clock, deleted_at: null });

for (let i = 0; i < 15; i++) {
  const purchase = { ...meta(), store_id: COSTCO, purchased_at: clock, source: 'manual', status: 'confirmed' };
  const lines = Array.from({ length: 49 }, (_, j) => ({
    table: 'purchase_items',
    row: {
      ...meta(),
      purchase_id: purchase.id,
      line_no: j + 1,
      variant_id: variantIds[j % variantIds.length],
      quantity: 1,
      unit_price_cents: 2850,
      gross_cents: 2850,
      discount_cents: 0,
      final_cents: 2850,
    },
  }));
  await call('/push?size=50', { mutations: [{ table: 'purchases', row: purchase }, ...lines] });
}
for (const limit of [200, 100]) for (let i = 0; i < 15; i++) await call(`/pull?limit=${limit}`, { limit });
console.log('done');
