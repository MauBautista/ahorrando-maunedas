import { z } from 'zod';

/** `POST /v1/devices` (03 §5). */
export const DeviceRegistrationSchema = z.strictObject({
  device_id: z.uuid(),
  platform: z.enum(['android', 'web']),
  /** FCM registration token; null on web and before Android gets one. */
  fcm_token: z.string().min(1).max(4096).nullable(),
  app_version: z.string().min(1).max(64),
});

export type DeviceRegistration = z.infer<typeof DeviceRegistrationSchema>;
