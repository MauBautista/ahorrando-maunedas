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
}

export const AuthContext = createContext<AuthPort | null>(null);

export function useAuth(): AuthPort {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthContext missing');
  return auth;
}
