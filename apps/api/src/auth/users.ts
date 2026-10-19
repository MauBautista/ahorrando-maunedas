import {
  MIN_PASSWORD_LENGTH,
  type AdminUser,
  type CreateUserRequestSchema,
  type UpdateUserRequestSchema,
} from '@maunedas/shared/api/admin';
import { isValidUsername, normalizeUsername, syntheticEmail } from '@maunedas/shared/auth/username';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { z } from 'zod';
import type { UserRow } from '../db/rows';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { log } from '../util/log';
import type { IdentityToolkit } from './firebase-admin';

type CreateUser = z.infer<typeof CreateUserRequestSchema>;
type UpdateUser = z.infer<typeof UpdateUserRequestSchema>;

const USER_SQL = `SELECT u.id, u.username, u.display_name, u.role, u.active, u.google_email, u.created_at,
       EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'password') AS has_password
FROM users u`;

type AdminUserRow = Omit<AdminUser, 'active' | 'has_password'> & { active: number; has_password: number };
const toAdminUser = (r: AdminUserRow): AdminUser => ({
  ...r,
  active: r.active === 1,
  has_password: r.has_password === 1,
});

/** `users` is a DOWN table: every write bumps the sync version and stamps the row with it (02 §4). */
const NEXT_VERSION = `(SELECT value FROM sync_meta WHERE key = 'version')`;

export async function listUsers(db: D1Database): Promise<AdminUser[]> {
  const { results } = await db.prepare(`${USER_SQL} ORDER BY u.username`).all<AdminUserRow>();
  return results.map(toAdminUser);
}

export async function getAdminUser(db: D1Database, id: string): Promise<AdminUser | null> {
  const row = await db.prepare(`${USER_SQL} WHERE u.id = ?1`).bind(id).first<AdminUserRow>();
  return row ? toAdminUser(row) : null;
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new ApiError(400, 'WEAK_PASSWORD');
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** A UNIQUE race on `users` answers the same 409 as the checks made before calling Firebase. */
function uniqueConflict(err: unknown): ApiError | null {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('UNIQUE constraint failed: users.username'))
    return new ApiError(409, 'USERNAME_TAKEN');
  if (message.includes('UNIQUE constraint failed: users.google_email'))
    return new ApiError(409, 'GOOGLE_EMAIL_TAKEN');
  return null;
}

/** Undoes a Firebase account the D1 write could not record (02 §5.3 step 5). Best effort, logged. */
async function compensate(identity: IdentityToolkit, localId: string): Promise<void> {
  try {
    await identity.deleteAccount(localId);
  } catch (err) {
    log('error', 'firebase compensation failed', {
      local_id: localId,
      error: err instanceof ApiError ? err.code : String(err),
    });
  }
}

/**
 * Creates a user (02 §5.3): checks that answer 409 run before touching Firebase; with a password the
 * Firebase account is created first and deleted again if the D1 batch fails.
 */
export async function createUser(
  db: D1Database,
  identity: IdentityToolkit,
  env: Pick<Env, 'SYNTHETIC_EMAIL_DOMAIN'>,
  input: CreateUser,
  now: number,
  options: { onlyIfNoUsers?: boolean } = {},
): Promise<AdminUser> {
  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) throw new ApiError(400, 'USERNAME_INVALID');
  if (input.password !== undefined) assertPassword(input.password);
  const googleEmail = input.google_email === undefined ? null : normalizeEmail(input.google_email);

  const [byName, byEmail] = await db.batch([
    db.prepare('SELECT 1 FROM users WHERE username = ?1').bind(username),
    db.prepare('SELECT 1 FROM users WHERE google_email = ?1').bind(googleEmail),
  ]);
  if (byName!.results.length > 0) throw new ApiError(409, 'USERNAME_TAKEN');
  if (googleEmail !== null && byEmail!.results.length > 0) throw new ApiError(409, 'GOOGLE_EMAIL_TAKEN');

  const localId =
    input.password === undefined
      ? null
      : await identity.createAccount(
          syntheticEmail(username, env.SYNTHETIC_EMAIL_DOMAIN),
          input.password,
          input.display_name,
        );
  const id = uuidv7();
  let inserted: number;
  try {
    // With onlyIfNoUsers (bootstrap) the insert is skipped when someone else created a user meanwhile,
    // and the identity only goes in if its user did.
    const written = await db.batch([
      db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
      db
        .prepare(
          `INSERT INTO users (id, username, display_name, google_email, role, active, created_at, updated_at, version)
           SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, ${NEXT_VERSION}
           WHERE ?7 = 0 OR NOT EXISTS (SELECT 1 FROM users)`,
        )
        .bind(id, username, input.display_name, googleEmail, input.role, now, options.onlyIfNoUsers ? 1 : 0),
      ...(localId
        ? [
            db
              .prepare(
                `INSERT INTO user_identities (firebase_uid, user_id, provider, created_at)
                 SELECT ?1, ?2, 'password', ?3 WHERE EXISTS (SELECT 1 FROM users WHERE id = ?2)`,
              )
              .bind(localId, id, now),
          ]
        : []),
    ]);
    inserted = written[1]!.meta.changes;
  } catch (err) {
    if (localId) await compensate(identity, localId);
    throw uniqueConflict(err) ?? err;
  }
  if (inserted === 0) {
    if (localId) await compensate(identity, localId);
    throw new ApiError(410, 'ALREADY_BOOTSTRAPPED');
  }
  return (await getAdminUser(db, id))!;
}

/**
 * Edits a user (03 §12). Never leaves the household without an active admin. Changing or removing the
 * Google e-mail deletes the user's `google.com` identities in the same batch, so the old Google account
 * loses access (02 §5.3). Activation changes disable or enable every Firebase account of the user first;
 * if anything fails afterwards they are switched back.
 */
export async function updateUser(
  db: D1Database,
  identity: IdentityToolkit,
  id: string,
  patch: UpdateUser,
  now: number,
): Promise<AdminUser> {
  const current = await db.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<UserRow>();
  if (!current) throw new ApiError(404, 'NOT_FOUND');
  const wasActive = current.active === 1;
  const role = patch.role ?? current.role;
  const active = patch.active ?? wasActive;

  if (current.role === 'admin' && wasActive && (role !== 'admin' || !active)) {
    const others = await db
      .prepare(`SELECT count(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?1`)
      .bind(id)
      .first<number>('n');
    if (!others) throw new ApiError(409, 'LAST_ADMIN');
  }

  let googleEmail = current.google_email;
  let dropGoogle = false;
  if (patch.google_email !== undefined) {
    const next = patch.google_email === null ? null : normalizeEmail(patch.google_email);
    if (next !== null) {
      const taken = await db
        .prepare('SELECT 1 FROM users WHERE google_email = ?1 AND id != ?2')
        .bind(next, id)
        .first();
      if (taken) throw new ApiError(409, 'GOOGLE_EMAIL_TAKEN');
    }
    dropGoogle = (next ?? '') !== (current.google_email ?? '').toLowerCase();
    googleEmail = next;
  }

  const toggled: string[] = [];
  const undo = async () => {
    for (const uid of toggled) {
      try {
        await identity.setDisabled(uid, !wasActive);
      } catch (err) {
        log('error', 'firebase activation rollback failed', {
          firebase_uid: uid,
          error: err instanceof ApiError ? err.code : String(err),
        });
      }
    }
  };
  if (active !== wasActive) {
    const { results } = await db
      .prepare('SELECT firebase_uid FROM user_identities WHERE user_id = ?1 ORDER BY firebase_uid')
      .bind(id)
      .all<{ firebase_uid: string }>();
    try {
      for (const { firebase_uid } of results) {
        await identity.setDisabled(firebase_uid, !active);
        toggled.push(firebase_uid);
      }
    } catch (err) {
      await undo();
      throw err;
    }
  }

  try {
    await db.batch([
      db.prepare(`UPDATE sync_meta SET value = value + 1 WHERE key = 'version'`),
      db
        .prepare(
          `UPDATE users SET display_name = ?2, role = ?3, active = ?4, google_email = ?5, updated_at = ?6,
                            version = ${NEXT_VERSION}
           WHERE id = ?1`,
        )
        .bind(id, patch.display_name ?? current.display_name, role, active ? 1 : 0, googleEmail, now),
      ...(dropGoogle
        ? [db.prepare(`DELETE FROM user_identities WHERE user_id = ?1 AND provider = 'google.com'`).bind(id)]
        : []),
    ]);
  } catch (err) {
    await undo();
    throw uniqueConflict(err) ?? err;
  }
  return (await getAdminUser(db, id))!;
}

/**
 * Sets a user's password (02 §5.3): updates the Firebase account of the `password` identity, or creates
 * one with the synthetic e-mail and links it (disabled if the user is inactive).
 */
export async function setUserPassword(
  db: D1Database,
  identity: IdentityToolkit,
  env: Pick<Env, 'SYNTHETIC_EMAIL_DOMAIN'>,
  id: string,
  password: string,
  now: number,
): Promise<void> {
  assertPassword(password);
  const [user, linked] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM users WHERE id = ?1').bind(id),
    db
      .prepare(
        `SELECT firebase_uid FROM user_identities WHERE user_id = ?1 AND provider = 'password' LIMIT 1`,
      )
      .bind(id),
  ]);
  const row = user!.results[0] as UserRow | undefined;
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  const uid = linked!.results[0]?.firebase_uid;
  if (typeof uid === 'string') {
    await identity.setPassword(uid, password);
    return;
  }

  const localId = await identity.createAccount(
    syntheticEmail(row.username, env.SYNTHETIC_EMAIL_DOMAIN),
    password,
    row.display_name,
  );
  try {
    if (row.active !== 1) await identity.setDisabled(localId, true);
    await db
      .prepare(
        `INSERT INTO user_identities (firebase_uid, user_id, provider, created_at) VALUES (?1, ?2, 'password', ?3)`,
      )
      .bind(localId, id, now)
      .run();
  } catch (err) {
    await compensate(identity, localId);
    throw err;
  }
}
