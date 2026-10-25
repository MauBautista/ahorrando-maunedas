import type { AuthPort, AuthUser } from '../lib/auth';

/** Firebase Auth without Google: "buena" is the password; Google signs in as [googleUid]. */
export class FakeAuth implements AuthPort {
  private user: AuthUser | null;
  private listeners = new Set<(u: AuthUser | null) => void>();
  signOuts = 0;
  forcedTokens = 0;
  googleUid = 'uid-google';
  method: 'password' | 'google' = 'password';
  /** The password of the session's account, "buena" until it is changed. */
  password = 'buena';
  /** Firebase's minimum is 6; "debil" stands for any password it refuses as weak. */
  weak = 'debil123';

  constructor(user: AuthUser | null = null) {
    this.user = user;
  }

  private set(user: AuthUser | null) {
    this.user = user;
    this.listeners.forEach((l) => l(user));
  }

  onChange(listener: (u: AuthUser | null) => void) {
    this.listeners.add(listener);
    queueMicrotask(() => listener(this.user));
    return () => void this.listeners.delete(listener);
  }

  currentUser() {
    return this.user;
  }

  async idToken(force = false) {
    if (force) this.forcedTokens++;
    return this.user ? `token-${this.user.uid}${force ? '-fresh' : ''}` : null;
  }

  async signInWithPassword(username: string, password: string) {
    if (password !== this.password)
      throw Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), {
        code: 'auth/invalid-credential',
      });
    this.method = 'password';
    this.set({ uid: `uid-${username}` });
  }

  async signInWithGoogle() {
    this.method = 'google';
    this.set({ uid: this.googleUid });
  }

  signInMethod() {
    return this.user ? this.method : null;
  }

  async changePassword(current: string, next: string) {
    const fail = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code });
    if (current !== this.password) throw fail('auth/invalid-credential');
    if (next === this.weak) throw fail('auth/weak-password');
    this.password = next;
  }

  async signOut() {
    this.signOuts++;
    this.set(null);
  }
}

export const me = (role: 'admin' | 'member' = 'member', name = 'Mauricio Bautista') => ({
  user: { id: 'u1', username: 'mau', display_name: name, role, has_google: false },
  server_time: 0,
  schema_version: 1,
  min_client_schema: 1,
});
