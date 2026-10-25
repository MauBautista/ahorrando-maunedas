import { syntheticEmail } from '@maunedas/shared/auth/username';
import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  EmailAuthProvider,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
} from 'firebase/auth';
import type { AuthPort } from './auth';

/**
 * Firebase Auth for the web (02 §7). In a build the Worker is the `authDomain` (the `/__/auth` proxy, decision
 * T19), so the Google popup stays on our host, which Safari on iPhone needs; `vite dev` uses Firebase's.
 */
export function firebaseAuth(): AuthPort {
  const app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    authDomain: import.meta.env.DEV
      ? `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`
      : window.location.host,
  });
  const auth = getAuth(app);
  const ready = setPersistence(auth, browserLocalPersistence);
  return {
    onChange: (listener) => onAuthStateChanged(auth, (u) => listener(u ? { uid: u.uid } : null)),
    currentUser: () => (auth.currentUser ? { uid: auth.currentUser.uid } : null),
    idToken: async (force = false) => (auth.currentUser ? auth.currentUser.getIdToken(force) : null),
    signInWithPassword: async (username, password) => {
      await ready;
      await signInWithEmailAndPassword(
        auth,
        syntheticEmail(username, import.meta.env.VITE_SYNTHETIC_EMAIL_DOMAIN),
        password,
      );
    },
    signInWithGoogle: async () => {
      await ready;
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    signOut: () => signOut(auth),
    signInMethod: () => {
      const providers = auth.currentUser?.providerData.map((p) => p.providerId) ?? [];
      if (providers.includes('password')) return 'password';
      return providers.includes('google.com') ? 'google' : null;
    },
    changePassword: async (current, next) => {
      const user = auth.currentUser;
      if (!user?.email) throw Object.assign(new Error('Sin sesión'), { code: 'auth/no-current-user' });
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current));
      await updatePassword(user, next);
    },
  };
}
