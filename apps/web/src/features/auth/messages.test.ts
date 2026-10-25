import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { loginMessage } from './messages';

const firebase = (code: string) => Object.assign(new Error(code), { code });

describe('loginMessage (02 §8)', () => {
  it('says the same for a stranger and a wrong password, and nothing when Google is closed', () => {
    expect(loginMessage(firebase('auth/invalid-credential'), 'password')).toBe(
      'Usuario o contraseña incorrectos.',
    );
    expect(loginMessage(new Error('USERNAME_INVALID'), 'password')).toBe('Usuario o contraseña incorrectos.');
    expect(loginMessage(firebase('auth/popup-closed-by-user'), 'google')).toBeNull();
    expect(loginMessage(firebase('auth/network-request-failed'), 'password')).toBe(
      'Necesitas internet para iniciar sesión.',
    );
    expect(loginMessage(firebase('auth/something-new'), 'password')).toBe(
      'No se pudo iniciar sesión. Intenta de nuevo.',
    );
  });

  it('names an unregistered Google account and passes the server’s other messages', () => {
    const notAllowed = new ApiError(
      403,
      'USER_NOT_ALLOWED',
      'Esta cuenta no está registrada. Pídele al administrador que la agregue.',
    );
    expect(loginMessage(notAllowed, 'google')).toBe(
      'Esta cuenta de Google no está registrada. Pídele al administrador que la agregue.',
    );
    expect(loginMessage(notAllowed, 'password')).toBe(notAllowed.message);
    expect(
      loginMessage(
        new ApiError(403, 'USER_DISABLED', 'Tu acceso está desactivado. Habla con el administrador.'),
        'google',
      ),
    ).toBe('Tu acceso está desactivado. Habla con el administrador.');
  });
});
