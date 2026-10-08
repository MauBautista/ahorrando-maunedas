// Shared with Kotlin `Usernames` (SDD 02 §3); vectors in fixtures/usuarios.json.

export const SYNTHETIC_EMAIL_DOMAIN_DEFAULT = 'maunedas.local';
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/; // 3 to 32 characters

export function normalizeUsername(input: string): string {
  return input.normalize('NFKC').trim().toLowerCase();
}

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}

export function assertValidUsername(u: string): void {
  if (!isValidUsername(u)) throw new Error('USERNAME_INVALID');
}

export function syntheticEmail(username: string, domain = SYNTHETIC_EMAIL_DOMAIN_DEFAULT): string {
  const u = normalizeUsername(username);
  assertValidUsername(u);
  return `${u}@${domain}`;
}
