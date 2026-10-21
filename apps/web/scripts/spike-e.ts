/**
 * Spike E (T-014, SDD 11 §7): does Firebase accept the synthetic e-mail domain (02 §3)?
 * For each candidate domain it starts a local `wrangler dev --env dev` (local D1, dev Firebase project)
 * and drives the real Worker code: bootstrap → REST and Firebase JS sign-in → /v1/me → a member that is
 * disabled (USER_DISABLED), enabled and given a new password. Every test account is deleted at the end.
 *
 * Usage (repo root): node apps/web/scripts/spike-e.ts <out.json> [domain…]
 * Needs apps/api/.dev.vars with GOOGLE_SERVICE_ACCOUNT and BOOTSTRAP_TOKEN. Never prints secrets.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ALL_DOMAINS = ['maunedas.local', 'maunedas.test', 'maunedas.invalid', 'users.maunedas.workers.dev'];
const DOMAINS = process.argv.length > 3 ? process.argv.slice(3) : ALL_DOMAINS;
const WRANGLER = 'apps/api/node_modules/.bin/wrangler';
const CONFIG = 'apps/api/wrangler.jsonc';
const WEB_ENV = Object.fromEntries(
  readFileSync('apps/web/.env.dev', 'utf8')
    .split('\n')
    .filter((l) => /^VITE_/.test(l))
    .map((l) => l.split('=') as [string, string]),
);
const API_KEY = WEB_ENV.VITE_FIREBASE_API_KEY!;
const PROJECT_ID = WEB_ENV.VITE_FIREBASE_PROJECT_ID!;
// The web key may be restricted to the dev host (02 §2 step 8); REST calls present it as referrer.
const REFERER = 'https://maunedas-dev.maunedas.workers.dev/';
// A browser on the allowed host sends this Referer to Google; in Node the Firebase JS SDK sends none, so
// it is added to its requests too (otherwise: auth/requests-from-referer-<empty>-are-blocked).
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.includes('googleapis.com')) return nativeFetch(input, init);
  const headers = new Headers(init.headers);
  headers.set('Referer', REFERER);
  return nativeFetch(input, { ...init, headers });
};
// Imported after the patch: the SDK keeps the fetch it finds when it loads.
const { initializeApp, deleteApp } = await import('firebase/app');
const { getAuth, signInWithEmailAndPassword, signOut } = await import('firebase/auth');
const BOOTSTRAP_TOKEN = readFileSync('apps/api/.dev.vars', 'utf8')
  .match(/^BOOTSTRAP_TOKEN=(.+)$/m)?.[1]
  ?.trim();
if (!BOOTSTRAP_TOKEN) throw new Error('apps/api/.dev.vars has no BOOTSTRAP_TOKEN');

const password = () => randomBytes(12).toString('base64url');

async function identity(op: string, body: Record<string, unknown>) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${op}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: REFERER },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  return { ok: res.ok, error: json.error?.message ?? null, idToken: json.idToken as string | undefined };
}
const restLogin = (email: string, pw: string) =>
  identity('signInWithPassword', { email, password: pw, returnSecureToken: true });

async function startWorker(domain: string, port: number): Promise<ChildProcess> {
  const persist = mkdtempSync(join(tmpdir(), 'spike-e-'));
  execFileSync(
    WRANGLER,
    [
      'd1',
      'migrations',
      'apply',
      'maunedas-dev',
      '--local',
      '--env',
      'dev',
      '--persist-to',
      persist,
      '--config',
      CONFIG,
    ],
    {
      stdio: 'ignore',
      env: { ...process.env, CI: '1' },
    },
  );
  const child = spawn(
    WRANGLER,
    [
      'dev',
      '--env',
      'dev',
      '--local',
      '--persist-to',
      persist,
      '--port',
      String(port),
      '--var',
      `SYNTHETIC_EMAIL_DOMAIN:${domain}`,
      '--config',
      CONFIG,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } },
  );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('wrangler dev did not start')), 120_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('Ready on')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`wrangler dev exited with ${code}`)));
  });
  return child;
}

/** Loose JSON of a local Worker response; the spike only reads a few fields. */
interface Body {
  error?: { code?: string; details?: unknown };
  user?: { id: string; username: string; role: string };
}

async function api(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  extra: Record<string, string> = {},
) {
  const res = await fetch(`http://localhost:${port}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Body) : {};
  return { status: res.status, json };
}

async function jsLogin(email: string, pw: string, name: string) {
  const app = initializeApp(
    { apiKey: API_KEY, authDomain: `${PROJECT_ID}.firebaseapp.com`, projectId: PROJECT_ID },
    name,
  );
  try {
    const cred = await signInWithEmailAndPassword(getAuth(app), email, pw);
    await signOut(getAuth(app));
    return { ok: Boolean(cred.user.uid), error: null as string | null };
  } catch (err) {
    return { ok: false, error: (err as { code?: string }).code ?? String(err) };
  } finally {
    await deleteApp(app);
  }
}

async function probe(domain: string, port: number) {
  const r: Record<string, unknown> = { domain };
  const admin = { email: `spike-admin@${domain}`, pw: password() };
  const member = { email: `spike-member@${domain}`, pw: password(), pw2: password() };
  const worker = await startWorker(domain, port);
  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    const t0 = Date.now();
    const boot = await api(
      port,
      'POST',
      '/v1/bootstrap',
      { username: 'spike-admin', display_name: 'Spike Admin', password: admin.pw },
      undefined,
      {
        'X-Bootstrap-Token': BOOTSTRAP_TOKEN!,
      },
    );
    r.create =
      boot.status === 201
        ? 'ok'
        : `${boot.status} ${boot.json.error?.code} ${JSON.stringify(boot.json.error?.details ?? {})}`;
    r.create_ms = Date.now() - t0;
    if (boot.status !== 201) return r;

    const login = await restLogin(admin.email, admin.pw);
    r.rest_login = login.ok ? 'ok' : login.error;
    if (!login.idToken) return r;
    cleanup.push(() => identity('delete', { idToken: login.idToken }));
    r.js_login = (await jsLogin(admin.email, admin.pw, `spike-${port}`)).error ?? 'ok';
    const me = await api(port, 'GET', '/v1/me', undefined, login.idToken);
    r.me =
      me.status === 200
        ? `ok (${me.json.user?.username}, ${me.json.user?.role})`
        : `${me.status} ${me.json.error?.code}`;

    const created = await api(
      port,
      'POST',
      '/v1/admin/users',
      { username: 'spike-member', display_name: 'Spike Member', role: 'member', password: member.pw },
      login.idToken,
    );
    r.admin_create = created.status === 201 ? 'ok' : `${created.status} ${created.json.error?.code}`;
    if (created.status !== 201) return r;
    const memberId = created.json.user.id as string;
    let memberToken = (await restLogin(member.email, member.pw)).idToken;

    const off = await api(port, 'PATCH', `/v1/admin/users/${memberId}`, { active: false }, login.idToken);
    r.disable = off.status === 200 ? 'ok' : `${off.status} ${off.json.error?.code}`;
    r.disabled_rest_login = (await restLogin(member.email, member.pw)).error ?? 'unexpected ok';
    r.disabled_js_login =
      (await jsLogin(member.email, member.pw, `spike-${port}-m`)).error ?? 'unexpected ok';
    const meOff = await api(port, 'GET', '/v1/me', undefined, memberToken);
    r.disabled_me = `${meOff.status} ${meOff.json.error?.code}`;

    const on = await api(port, 'PATCH', `/v1/admin/users/${memberId}`, { active: true }, login.idToken);
    r.enable = on.status === 200 ? 'ok' : `${on.status} ${on.json.error?.code}`;
    const pw = await api(
      port,
      'POST',
      `/v1/admin/users/${memberId}/password`,
      { password: member.pw2 },
      login.idToken,
    );
    r.set_password = pw.status === 204 ? 'ok' : `${pw.status} ${pw.json.error?.code}`;
    r.old_password = (await restLogin(member.email, member.pw)).error ?? 'unexpected ok';
    const fresh = await restLogin(member.email, member.pw2);
    r.new_password = fresh.ok ? 'ok' : fresh.error;
    memberToken = fresh.idToken ?? memberToken;
    if (memberToken) cleanup.push(() => identity('delete', { idToken: memberToken }));
    return r;
  } finally {
    const deleted = await Promise.all(
      cleanup.map((f) =>
        f().then(
          (x) => (x as { ok: boolean }).ok,
          () => false,
        ),
      ),
    );
    r.accounts_deleted = deleted;
    r.admin_gone = (await restLogin(admin.email, admin.pw)).error;
    worker.kill('SIGTERM');
  }
}

const out = process.argv[2] ?? 'spike-e.json';
const results = [];
for (const [i, domain] of DOMAINS.entries()) {
  results.push(await probe(domain, 8790 + i));
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(out, JSON.stringify(results, null, 2));
