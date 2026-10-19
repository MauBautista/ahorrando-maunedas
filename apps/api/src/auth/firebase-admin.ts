import type { Context } from 'hono';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

/** Anything that hands out a Google access token (02 §5.2); tests pass a fixed one. */
export interface AccessTokenSource {
  get(env: Pick<Env, 'DB' | 'GOOGLE_SERVICE_ACCOUNT'>): Promise<string>;
}

type IdentityEnv = Pick<Env, 'DB' | 'GOOGLE_SERVICE_ACCOUNT' | 'FIREBASE_PROJECT_ID'>;

/** Identity Toolkit errors arrive as `error.message`, e.g. "EMAIL_EXISTS" or "WEAK_PASSWORD : …". */
function mapIdentityError(message: string | undefined): ApiError {
  if (message?.startsWith('EMAIL_EXISTS')) return new ApiError(409, 'USERNAME_TAKEN');
  if (message?.startsWith('WEAK_PASSWORD')) return new ApiError(400, 'WEAK_PASSWORD');
  if (message?.startsWith('INVALID_EMAIL')) return new ApiError(400, 'USERNAME_INVALID');
  return new ApiError(502, 'UPSTREAM_ERROR', { service: 'identitytoolkit', message: message?.slice(0, 100) });
}

/**
 * Firebase account administration through Identity Toolkit (02 §5.3), the same endpoints the Admin SDK
 * uses, authorized with the service account token. Passwords are forwarded, never stored or logged.
 */
export class IdentityToolkit {
  constructor(
    private readonly env: IdentityEnv,
    private readonly tokens: AccessTokenSource,
    private readonly fetcher: typeof fetch,
  ) {}

  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const token = await this.tokens.get(this.env);
    let res: Response;
    try {
      res = await this.fetcher(
        `https://identitytoolkit.googleapis.com/v1/projects/${this.env.FIREBASE_PROJECT_ID}/${path}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'identitytoolkit' });
    }
    const json = await res.json<{ error?: { message?: string } } & T>().catch(() => null);
    if (!res.ok || json === null) throw mapIdentityError(json?.error?.message);
    return json;
  }

  async createAccount(email: string, password: string, displayName: string): Promise<string> {
    const { localId } = await this.call<{ localId?: unknown }>('accounts', { email, password, displayName });
    if (typeof localId !== 'string' || localId === '') {
      throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'identitytoolkit' });
    }
    return localId;
  }

  async setPassword(localId: string, password: string): Promise<void> {
    await this.call('accounts:update', { localId, password });
  }

  async setDisabled(localId: string, disabled: boolean): Promise<void> {
    await this.call('accounts:update', { localId, disableUser: disabled });
  }

  async deleteAccount(localId: string): Promise<void> {
    await this.call('accounts:delete', { localId });
  }
}

/** The Identity Toolkit client of a request, with the injected token source and fetch. */
export const identityToolkitOf = (c: Context<AppEnv>) =>
  new IdentityToolkit(c.env, c.get('googleTokens'), c.get('outboundFetch'));
