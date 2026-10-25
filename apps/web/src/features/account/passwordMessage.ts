/** What to tell after a failed password change (RF-AUTH-06), Android's `PasswordChange` texts. */
export function passwordMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/invalid-login-credentials':
      return 'La contraseña actual no es correcta.';
    case 'auth/weak-password':
      return 'Esa contraseña es muy débil. Elige otra.';
    case 'auth/network-request-failed':
      return 'Necesitas internet para cambiar la contraseña.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
    default:
      return 'No se pudo cambiar la contraseña. Intenta de nuevo.';
  }
}
