import {
  AlertEventsQuerySchema,
  type AlertEventRow,
  type AlertEventsResponse,
} from '@maunedas/shared/api/alerts';
import { Hono } from 'hono';
import { requireUser } from '../auth/middleware';
import type { AppEnv } from '../env';
import { decodeCursor, encodeCursor } from '../util/cursor';
import { parseQuery } from '../util/validate';

/** `GET /v1/alerts/events` (03 §11): the user's own alerts, newest first, for the web (Android pulls them). */
export const alerts = new Hono<AppEnv>().get('/v1/alerts/events', requireUser(), async (c) => {
  const query = parseQuery(c, AlertEventsQuerySchema);
  const user = c.get('user');
  const [at, id] = query.cursor ? decodeCursor(query.cursor, 2) : [Number.MAX_SAFE_INTEGER, ''];
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM alert_events WHERE user_id = ?1 AND (fired_at, id) < (?2, ?3)
     ORDER BY fired_at DESC, id DESC LIMIT ?4`,
  )
    // Without a cursor every event is before the largest time.
    .bind(user.id, Number(at), String(id), query.limit + 1)
    .all<AlertEventRow>();
  const items = results.slice(0, query.limit);
  const last = items.at(-1);
  return c.json<AlertEventsResponse>({
    items,
    next_cursor: results.length > query.limit && last ? encodeCursor([last.fired_at, last.id]) : null,
  });
});
