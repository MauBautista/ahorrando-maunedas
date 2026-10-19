// Signed URLs for image blobs (10 §3).
const WINDOW_MS = 6 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/**
 * Signs a path. With a TTL of 24 h or more, `exp` is rounded up to 6 h windows so the URL is stable and
 * cacheable; with a short TTL (10 min for AI) the exact expiry is used so it never lives for hours.
 */
export async function signPath(
  secret: string,
  path: string,
  ttlMs: number,
  now = Date.now(),
): Promise<string> {
  const exp = ttlMs >= DAY_MS ? Math.ceil((now + ttlMs) / WINDOW_MS) * WINDOW_MS : now + ttlMs;
  const sig = await hmacHex(secret, `${path}:${exp}`);
  return `${path}?exp=${exp}&sig=${sig}`;
}

export async function verifySigned(
  secret: string,
  path: string,
  exp: string | undefined,
  sig: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!exp || !sig || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig) || Number(exp) < now) return false;
  const expected = new TextEncoder().encode(await hmacHex(secret, `${path}:${exp}`));
  const given = new TextEncoder().encode(sig);
  return crypto.subtle.timingSafeEqual(expected, given);
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
