import { z } from 'zod';

/** `POST /v1/admin/merge` (03 §12). */
export const MergeRequestSchema = z.object({
  kind: z.enum(['product', 'variant']),
  source_id: z.uuid(),
  target_id: z.uuid(),
  /** The preview of W-12: the same checks and counts, nothing written. */
  dry_run: z.boolean().optional(),
});

export interface MergeResponse {
  /** Rows moved to the target, per table (or that would move, with `dry_run`). */
  moved: Record<string, number>;
}

/** `GET /v1/admin/ai-budget` (03 §12): this month's AI spend in Mexico City, for W-13. */
export interface AiBudget {
  month: string;
  budget_usd: number;
  spent_usd: number;
  soft_limit_pct: number;
  soft_limit_reached: boolean;
  by_purpose: Record<'receipt' | 'image_edit' | 'other', number>;
  calls: number;
}

/** Passwords are checked for length by hand so the answer is `WEAK_PASSWORD`, never echoed back. */
const password = z.string().max(128);
const displayName = z.string().trim().min(1).max(60);
const googleEmail = z.email().max(254);

/** `POST /v1/admin/users` (03 §12): at least one of password or google_email. */
export const CreateUserRequestSchema = z
  .object({
    username: z.string().max(64),
    display_name: displayName,
    role: z.enum(['admin', 'member']),
    password: password.optional(),
    google_email: googleEmail.optional(),
  })
  .refine((r) => r.password !== undefined || r.google_email !== undefined, {
    message: 'Hace falta una contraseña o un correo de Google',
    path: ['password'],
  });

/** `POST /v1/bootstrap` (02 §5.4): the first admin; the role is always admin. */
export const BootstrapRequestSchema = z
  .object({
    username: z.string().max(64),
    display_name: displayName,
    password: password.optional(),
    google_email: googleEmail.optional(),
  })
  .refine((r) => r.password !== undefined || r.google_email !== undefined, {
    message: 'Hace falta una contraseña o un correo de Google',
    path: ['password'],
  });

/** `PATCH /v1/admin/users/:id`: only what changes; `google_email: null` removes Google access. */
export const UpdateUserRequestSchema = z
  .object({
    display_name: displayName.optional(),
    role: z.enum(['admin', 'member']).optional(),
    active: z.boolean().optional(),
    google_email: googleEmail.nullable().optional(),
  })
  .refine((r) => Object.values(r).some((v) => v !== undefined), { message: 'Nada que cambiar' });

/** `POST /v1/admin/users/:id/password`. */
export const SetPasswordRequestSchema = z.object({ password });

export const MIN_PASSWORD_LENGTH = 8;

export interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: 'admin' | 'member';
  active: boolean;
  google_email: string | null;
  has_password: boolean;
  created_at: number;
}
