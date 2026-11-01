import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { AccessTokenSource } from './auth/firebase-admin';
import { firebaseAuthProxy } from './auth/proxy';
import { googleSigningKeys } from './auth/firebase-token';
import type { AppEnv } from './env';
import { googleTokens } from './google/oauth';
import { notFound, onError } from './errors';
import { clientSchema } from './middleware/client-schema';
import { requestId } from './middleware/request-id';
import { admin } from './routes/admin';
import { alerts } from './routes/alerts';
import { barcodes } from './routes/barcodes';
import { bootstrap } from './routes/bootstrap';
import { devices } from './routes/devices';
import { health } from './routes/health';
import { images } from './routes/images';
import { lookups } from './routes/lookups';
import { me } from './routes/me';
import { products } from './routes/products';
import { purchases } from './routes/purchases';
import { search } from './routes/search';
import { sync } from './routes/sync';
import { variants } from './routes/variants';
import { agent } from './agent/routes';

export interface AppOptions {
  /** Keys that verify Firebase ID tokens; tests pass local keys. Default: Google's JWKS. */
  firebaseKeys?: JWTVerifyGetKey;
  /** fetch for third-party APIs; tests pass a fake so nothing leaves the machine. */
  fetch?: typeof fetch;
  /** Google access tokens (02 §5.2); tests pass a fixed one. */
  googleTokens?: AccessTokenSource;
  /** Routes that only tests mount. */
  extraRoutes?: (app: Hono<AppEnv>) => void;
}

/** Builds the API: request id → error handling → client schema check → routes. */
export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const firebaseKeys = options.firebaseKeys ?? googleSigningKeys;
  const outboundFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const tokens = options.googleTokens ?? googleTokens;
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('firebaseKeys', firebaseKeys);
    c.set('outboundFetch', outboundFetch);
    c.set('googleTokens', tokens);
    await next();
  });
  app.onError(onError);
  app.notFound(notFound);
  app.use('/v1/*', clientSchema);

  app.all('/__/auth/*', firebaseAuthProxy);
  app.all('/__/firebase/*', firebaseAuthProxy);
  app.route('/', health);
  app.route('/', bootstrap);
  app.route('/', me);
  app.route('/', devices);
  app.route('/', sync);
  app.route('/', lookups);
  app.route('/', products);
  app.route('/', variants);
  app.route('/', search);
  app.route('/', purchases);
  app.route('/', barcodes);
  app.route('/', images);
  app.route('/', admin);
  app.route('/', alerts);
  app.route('/', agent);
  options.extraRoutes?.(app);
  return app;
}

export const app = createApp();
