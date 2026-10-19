import { log } from '../util/log';

/**
 * Single hourly Cron (minute 7, 03 §2). The agent watchdog (T-214) and the daily maintenance at
 * 04:07 Mexico City time (T-041) plug in here, receiving `env` and `ctx` when they need them.
 */
export async function scheduled(controller: ScheduledController): Promise<void> {
  log('info', 'cron tick', { cron: controller.cron, scheduled_time: controller.scheduledTime });
}
