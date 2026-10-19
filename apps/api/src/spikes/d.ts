// TEMPORARY (spike D, T-013): CPU probes on maunedas-dev (Free plan). Lives only on the spike branch; never
// merged. Every route answers 404 unless the deploy sets SPIKES=1 and the request carries SPIKE_TOKEN.
import { expandAbbreviations } from '@maunedas/shared/receipts/abbreviations';
import { normalizeReceiptText } from '@maunedas/shared/receipts/normalize';
import { searchKey } from '@maunedas/shared/text/searchKey';
import { Hono } from 'hono';
import { createLocalJWKSet, importPKCS8, SignJWT, type JWK } from 'jose';
import { verifyFirebaseToken } from '../auth/firebase-token';
import type { UserRow } from '../db/rows';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { pullChanges } from '../sync/pull';
import { pushMutations } from '../sync/push';

const SPIKE_USER: UserRow = {
  id: '0192a5e9-0000-7000-8000-00000000d0d0',
  username: 'spike',
  display_name: 'Spike D',
  google_email: null,
  role: 'admin',
  active: 1,
  created_at: 0,
  updated_at: 0,
  version: 0,
};

async function sameToken(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(x, y);
}

export const spikeD = new Hono<AppEnv>();

spikeD.use('*', async (c, next) => {
  const env = c.env as AppEnv['Bindings'] & { SPIKES?: string; SPIKE_TOKEN?: string };
  if (env.SPIKES !== '1' || !env.SPIKE_TOKEN) throw new ApiError(404, 'NOT_FOUND');
  if (!(await sameToken(c.req.header('X-Spike-Token') ?? '', env.SPIKE_TOKEN)))
    throw new ApiError(404, 'NOT_FOUND');
  await next();
});

spikeD.get('/noop', (c) => c.json({ ok: true }));

/** Firebase ID token verification with the key imported on every request (upper bound). */
spikeD.post('/jwt', async (c) => {
  const { token, jwk } = await c.req.json<{ token: string; jwk: JWK }>();
  const claims = await verifyFirebaseToken(
    token,
    c.env.FIREBASE_PROJECT_ID,
    createLocalJWKSet({ keys: [jwk] }),
  );
  return c.json({ sub: claims.sub });
});

/** Cold Google service token: import the PKCS8 key and sign the JWT bearer assertion (no network). */
spikeD.post('/google-sign', async (c) => {
  const { pkcs8 } = await c.req.json<{ pkcs8: string }>();
  const key = await importPKCS8(pkcs8, 'RS256');
  const iat = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer('spike@example.iam.gserviceaccount.com')
    .setSubject('spike@example.iam.gserviceaccount.com')
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(key);
  return c.json({ length: jwt.length });
});

/** The real push algorithm with a fixed admin user. */
spikeD.post('/push', async (c) => {
  const { mutations } = await c.req.json<{
    mutations: Array<{ table: string; row: Record<string, unknown> }>;
  }>();
  const result = await pushMutations(c.env.DB, SPIKE_USER, mutations, Date.now());
  return c.json({ applied: result.applied, skipped: result.skipped, reasons: result.conflicts.slice(0, 3) });
});

/** The real pull algorithm from scratch (every table, up to `limit` rows each). */
spikeD.post('/pull', async (c) => {
  const { limit = 500 } = await c.req.json<{ limit?: number }>();
  const result = await pullChanges(c.env.DB, SPIKE_USER, { cursors: {}, limit }, Date.now());
  const rows = Object.values(result.changes).reduce((n, r) => n + r.length, 0);
  // Serialize like the real route would (part of the CPU cost).
  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'X-Rows': String(rows) },
  });
});

/** One D1 batch with n statements: does a batch count each statement against the 50 queries limit? */
spikeD.post('/batch', async (c) => {
  const n = Number(c.req.query('n') ?? 50);
  const results = await c.env.DB.batch(
    Array.from({ length: n }, (_, i) => c.env.DB.prepare('SELECT ?1 AS i').bind(i)),
  );
  return c.json({ statements: results.length });
});

/** n separate queries in one invocation. */
spikeD.post('/queries', async (c) => {
  const n = Number(c.req.query('n') ?? 40);
  for (let i = 0; i < n; i++) await c.env.DB.prepare('SELECT ?1 AS i').bind(i).first();
  return c.json({ queries: n });
});

/**
 * Approximation of 09 §5.3 (T-040 does not exist yet): normalize 40 receipt lines, expand abbreviations
 * and score them against up to 500 products and their variants loaded from D1.
 */
spikeD.post('/match', async (c) => {
  const { lines } = await c.req.json<{ lines: string[] }>();
  const { results } = await c.env.DB.prepare(
    `SELECT p.name, p.brand, v.label FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.deleted_at IS NULL LIMIT 500`,
  ).all<{ name: string; brand: string | null; label: string }>();
  const candidates = results.map((r) => searchKey(`${r.name} ${r.brand ?? ''} ${r.label}`).split(' '));
  let best = 0;
  for (const line of lines) {
    const tokens = searchKey(expandAbbreviations(normalizeReceiptText(line)))
      .split(' ')
      .filter((t) => t.length >= 2);
    for (const words of candidates) {
      let score = 0;
      for (const t of tokens) {
        if (words.includes(t)) score += 1;
        else if (t.length >= 3 && words.some((w) => w.startsWith(t))) score += 0.7;
      }
      best = Math.max(best, tokens.length ? score / tokens.length : 0);
    }
  }
  return c.json({ lines: lines.length, candidates: candidates.length, best });
});
