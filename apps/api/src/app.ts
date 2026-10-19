import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { googleSigningKeys } from './auth/firebase-token';
import type { AppEnv } from './env';
import { notFound, onError } from './errors';
import { clientSchema } from './middleware/client-schema';
import { requestId } from './middleware/request-id';
import { catalog } from './routes/catalog';
import { devices } from './routes/devices';
import { health } from './routes/health';
import { me } from './routes/me';
import { sync } from './routes/sync';

export interface AppOptions {
  /** Keys that verify Firebase ID tokens; tests pass local keys. Default: Google's JWKS. */
  firebaseKeys?: JWTVerifyGetKey;
  /** Routes that only tests mount. */
  extraRoutes?: (app: Hono<AppEnv>) => void;
}

/** Builds the API: request id → error handling → client schema check → routes. */
export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const firebaseKeys = options.firebaseKeys ?? googleSigningKeys;
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('firebaseKeys', firebaseKeys);
    await next();
  });
  app.onError(onError);
  app.notFound(notFound);
  app.use('/v1/*', clientSchema);

  app.route('/', health);
  app.route('/', me);
  app.route('/', devices);
  app.route('/', sync);
  app.route('/', catalog);
  options.extraRoutes?.(app);
  return app;
}

export const app = createApp();
