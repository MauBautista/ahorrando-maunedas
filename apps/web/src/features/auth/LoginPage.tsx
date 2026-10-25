import type { MeResponse } from '@maunedas/shared/api/me';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { APP_NAME } from '../../app-info';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/context';
import { loginMessage } from './messages';
import { type LoginState, ME_KEY, useMe } from './useSession';

/** W-01 (02 §7): user and password, or Google; then `GET /v1/me`, which ends the session of a stranger. */
export function LoginPage() {
  const auth = useAuth();
  const api = useApi();
  const queryClient = useQueryClient();
  const state = (useLocation().state ?? {}) as LoginState;
  const { account, data } = useMe();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(state.message ?? null);

  // Signed in and known to the app: back where the visit was going (or Inicio).
  if (account && data && !busy)
    return <Navigate to={state.from && state.from !== '/login' ? state.from : '/'} replace />;

  async function enter(method: 'password' | 'google', signIn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await signIn();
      const uid = auth.currentUser()?.uid;
      await queryClient.fetchQuery({
        queryKey: [...ME_KEY, uid],
        queryFn: () => api.get<MeResponse>('/v1/me'),
      });
    } catch (e) {
      setMessage(loginMessage(e, method));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return setMessage('Escribe tu usuario y tu contraseña.');
    void enter('password', () => auth.signInWithPassword(username, password));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-8">
      <h1 className="text-center text-display">{APP_NAME}</h1>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1">
          <span className="text-label">Usuario</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label">Contraseña</span>
          <div className="flex gap-2">
            <input
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="field flex-1"
            />
            <button type="button" className="btn-text" onClick={() => setShowPassword((s) => !s)}>
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </label>
        {message && (
          <p role="alert" className="text-error">
            {message}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          Entrar
        </button>
      </form>
      <p className="text-center text-on-surface-variant">o</p>
      <button
        type="button"
        className="btn-outline"
        disabled={busy}
        onClick={() => void enter('google', () => auth.signInWithGoogle())}
      >
        Continuar con Google
      </button>
      <p className="text-center text-label text-on-surface-variant">
        ¿Olvidaste tu contraseña? Pídele al administrador que la restablezca.
      </p>
    </main>
  );
}
