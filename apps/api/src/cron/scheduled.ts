import type { Env } from '../env';
import { log } from '../util/log';
import { isMaintenanceTick, runMaintenance } from './maintenance';
import { notifySoftLimit } from '../alerts/system';
import { fcmDeps } from '../fcm/send';
import { googleTokens } from '../google/oauth';

/**
 * Single hourly Cron (minute 7, 03 §2). The daily maintenance runs on the 04:07 Mexico City tick; the
 * agent watchdog (T-214) plugs in here too.
 */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  log('info', 'cron tick', { cron: controller.cron, scheduled_time: controller.scheduledTime });
  try {
    // "Gasto de IA al 80 %" (08 §5), once a month, sent here so the AI gateway never waits on Firebase.
    await notifySoftLimit(
      env,
      fcmDeps((input, init) => fetch(input, init), googleTokens),
      controller.scheduledTime,
    );
  } catch (err) {
    log('error', 'ai soft limit notice failed', { error: err instanceof Error ? err.message : String(err) });
  }
  if (isMaintenanceTick(controller.scheduledTime)) {
    try {
      const deleted = await runMaintenance(env.DB, controller.scheduledTime);
      log('info', 'maintenance done', { deleted });
    } catch (err) {
      log('error', 'maintenance failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
}
