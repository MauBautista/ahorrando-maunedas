import { app } from './app';
import { scheduled } from './cron/scheduled';
import type { Env } from './env';

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;
