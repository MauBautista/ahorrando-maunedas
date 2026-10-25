import { ApiError } from '../../lib/api';

/** 02 §8. Firebase answers `auth/invalid-credential` both for a stranger and a wrong password (enumeration protection). */
const BY_FIREBASE_CODE: Record<string, string> = {
  'auth/invalid-credential': 'Usuario o contraseña incorrectos.',
  'auth/wrong-password': 'Usuario o contraseña incorrectos.',
  'auth/user-not-found': 'Usuario o contraseña incorrectos.',
  'auth/invalid-email': 'Usuario o contraseña incorrectos.',
  'auth/user-disabled': 'Tu acceso está desactivado. Habla con el administrador.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento e intenta de nuevo.',
  'auth/network-request-failed': 'Necesitas internet para iniciar sesión.',
  'auth/popup-blocked':
    'El navegador bloqueó la ventana de Google. Permite ventanas emergentes e intenta de nuevo.',
};

/** Closing Google's window is not an error. */
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

/** What to tell after a failed login, or null when there is nothing to tell. */
export function loginMessage(error: unknown, method: 'password' | 'google'): string | null {
  if (error instanceof ApiError) {
    if (error.code === 'USER_NOT_ALLOWED' && method === 'google') {
      return 'Esta cuenta de Google no está registrada. Pídele al administrador que la agregue.';
    }
    return error.message;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (SILENT.has(code)) return null;
    if (code in BY_FIREBASE_CODE) return BY_FIREBASE_CODE[code]!;
  }
  // An invalid username never reaches Firebase (`syntheticEmail` throws): it is a wrong user too.
  if (error instanceof Error && error.message === 'USERNAME_INVALID')
    return 'Usuario o contraseña incorrectos.';
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}
