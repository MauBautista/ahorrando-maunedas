import { createContext, useContext } from 'react';

/** The signed-in Firebase account, as much as the app needs of it. */
export interface AuthUser {
  uid: string;
}

/**
 * What the app asks of Firebase Auth (02 §7). The real one is `lib/firebase.ts`; tests pass a fake, so nothing
 * talks to Google.
 */
export interface AuthPort {
  /** Calls back with the account (or null) now and on every change; returns the unsubscribe. */
  onChange(listener: (user: AuthUser | null) => void): () => void;
  currentUser(): AuthUser | null;
  /** An ID token for the API; [force] asks Firebase for a fresh one (after a 401). */
  idToken(force?: boolean): Promise<string | null>;
  signInWithPassword(username: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** How this session signed in: each method is its own Firebase account of the same user (02 §2). */
  signInMethod(): 'password' | 'google' | null;
  /**
   * RF-AUTH-06: `reauthenticateWithCredential` + `updatePassword` of the password account (02 §6.5); the Worker never
   * sees passwords. Rejects with Firebase's `code` (`auth/invalid-credential`, `auth/weak-password`…).
   */
  changePassword(current: string, next: string): Promise<void>;
}

export const AuthContext = createContext<AuthPort | null>(null);

export function useAuth(): AuthPort {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthContext missing');
  return auth;
}
