import { importPKCS8, SignJWT } from 'jose';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { log } from '../util/log';

/** OAuth token for Google services used by the Worker: FCM and Identity Toolkit (02 §5.2). */
const SCOPES = [
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/identitytoolkit',
].join(' ');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_KEY = 'google_oauth';
/** Renew a minute before Google's expiry so no request goes out with a token about to die. */
const EARLY_RENEW_MS = 60_000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export interface GoogleTokenDeps {
  fetch: typeof fetch;
  now: () => number;
}

type TokenEnv = Pick<Env, 'DB' | 'GOOGLE_SERVICE_ACCOUNT'>;

/**
 * Access token with a two-level cache: isolate memory, then `token_cache` in D1 (shared by every
 * isolate). Concurrent cold requests share one exchange. The token is never logged.
 */
export class GoogleTokenSource {
  private memo: { token: string; expMs: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly deps: GoogleTokenDeps = { fetch: (...args) => fetch(...args), now: Date.now },
  ) {}

  async get(env: TokenEnv): Promise<string> {
    const now = this.deps.now();
    if (this.memo && this.memo.expMs - EARLY_RENEW_MS > now) return this.memo.token;
    this.inflight ??= this.load(env).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(env: TokenEnv): Promise<string> {
    const now = this.deps.now();
    const cached = await env.DB.prepare('SELECT value, expires_at FROM token_cache WHERE key = ?1')
      .bind(CACHE_KEY)
      .first<{ value: string; expires_at: number }>();
    if (cached && cached.expires_at - EARLY_RENEW_MS > now) {
      this.memo = { token: cached.value, expMs: cached.expires_at };
      return cached.value;
    }

    const { access_token, expires_in } = await this.exchange(serviceAccount(env), now);
    const expMs = now + expires_in * 1000;
    await env.DB.prepare(
      `INSERT INTO token_cache (key, value, expires_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    )
      .bind(CACHE_KEY, access_token, expMs)
      .run();
    this.memo = { token: access_token, expMs };
    return access_token;
  }

  /** JWT bearer grant (RFC 7523) signed with the service account key. */
  private async exchange(
    sa: ServiceAccount,
    now: number,
  ): Promise<{ access_token: string; expires_in: number }> {
    const key = await importPKCS8(sa.private_key, 'RS256');
    const iat = Math.floor(now / 1000);
    const assertion = await new SignJWT({ scope: SCOPES })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(sa.private_key_id ? { kid: sa.private_key_id } : {}),
      })
      .setIssuer(sa.client_email)
      .setSubject(sa.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(key);

    const res = await this.deps.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) {
      log('error', 'google oauth exchange failed', { status: res.status });
      throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'google_oauth', status: res.status });
    }
    const body = await res.json<{ access_token?: unknown; expires_in?: unknown }>();
    if (
      typeof body.access_token !== 'string' ||
      typeof body.expires_in !== 'number' ||
      body.expires_in <= 0
    ) {
      throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'google_oauth', reason: 'invalid_response' });
    }
    return { access_token: body.access_token, expires_in: body.expires_in };
  }
}

function serviceAccount(env: TokenEnv): ServiceAccount {
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT ?? '') as Partial<ServiceAccount>;
  } catch {
    sa = {};
  }
  if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') {
    // Server misconfiguration (secret missing or malformed): an operator problem, not the client's.
    log('error', 'GOOGLE_SERVICE_ACCOUNT is missing or malformed');
    throw new ApiError(500, 'INTERNAL');
  }
  return sa as ServiceAccount;
}

/** One source per isolate. */
export const googleTokens = new GoogleTokenSource();

export const googleAccessToken = (env: TokenEnv): Promise<string> => googleTokens.get(env);
