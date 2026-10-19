import { Hono } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import { googleSigningKeys } from './auth/firebase-token';
import type { AppEnv } from './env';
import { notFound, onError } from './errors';
import { clientSchema } from './middleware/client-schema';
import { requestId } from './middleware/request-id';
import { barcodes } from './routes/barcodes';
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

export interface AppOptions {
  /** Keys that verify Firebase ID tokens; tests pass local keys. Default: Google's JWKS. */
  firebaseKeys?: JWTVerifyGetKey;
  /** fetch for third-party APIs; tests pass a fake so nothing leaves the machine. */
  fetch?: typeof fetch;
  /** Routes that only tests mount. */
  extraRoutes?: (app: Hono<AppEnv>) => void;
}

/** Builds the API: request id → error handling → client schema check → routes. */
export function createApp(options: AppOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const firebaseKeys = options.firebaseKeys ?? googleSigningKeys;
  const outboundFetch = options.fetch ?? ((input, init) => fetch(input, init));
  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('firebaseKeys', firebaseKeys);
    c.set('outboundFetch', outboundFetch);
    await next();
  });
  app.onError(onError);
  app.notFound(notFound);
  app.use('/v1/*', clientSchema);

  app.route('/', health);
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
  options.extraRoutes?.(app);
  return app;
}

export const app = createApp();
