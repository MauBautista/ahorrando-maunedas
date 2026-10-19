import { Hono } from 'hono';
import type { AppEnv } from './env';
import { notFound, onError } from './errors';
import { clientSchema } from './middleware/client-schema';
import { requestId } from './middleware/request-id';
import { health } from './routes/health';

/**
 * Builds the API: request id → error handling → client schema check → routes.
 * `extraRoutes` exists for tests that need routes the production app does not have.
 */
export function createApp(extraRoutes?: (app: Hono<AppEnv>) => void): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requestId);
  app.onError(onError);
  app.notFound(notFound);
  app.use('/v1/*', clientSchema);

  app.route('/', health);
  extraRoutes?.(app);
  return app;
}

export const app = createApp();
