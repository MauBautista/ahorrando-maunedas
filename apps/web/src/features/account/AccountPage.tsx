import { MIN_PASSWORD_LENGTH } from '@maunedas/shared/api/admin';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { CLIENT_SCHEMA } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useMe } from '../auth/useSession';
import { passwordMessage } from './passwordMessage';

/**
 * W-14 (05 §5 S-15): who I am, "Cambiar contraseña" (RF-AUTH-06) and "Cerrar sesión". The name and the Google email
 * are the admin's to change (W-11), as in Android. The password is changed in Firebase from the browser, with the
 * current one first; each sign-in method is its own Firebase account, so a Google session cannot change it.
 */
export function AccountPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useMe();
  const method = auth.signInMethod();

  async function signOut() {
    await auth.signOut();
    // The web keeps no data of its own (04 §7): forgetting the queries is all there is to clean.
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="text-title">Cuenta</h1>
      {data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-on-surface-variant">Nombre</dt>
          <dd>{data.user.display_name}</dd>
          <dt className="text-on-surface-variant">Usuario</dt>
          <dd className="font-mono">{data.user.username}</dd>
          <dt className="text-on-surface-variant">Rol</dt>
          <dd>{data.user.role === 'admin' ? 'Administrador' : 'Miembro'}</dd>
          <dt className="text-on-surface-variant">Google</dt>
          <dd>{data.user.has_google ? 'Vinculada' : 'Sin vincular'}</dd>
          <dt className="text-on-surface-variant">Entraste con</dt>
          <dd>{method === 'google' ? 'Google' : 'Usuario y contraseña'}</dd>
        </dl>
      )}
      <p className="text-label text-on-surface-variant">
        Para cambiar tu nombre o tu correo de Google, pídeselo al administrador.
      </p>
      <section aria-labelledby="password-title" className="flex flex-col gap-3">
        <h2 id="password-title" className="text-title">
          Cambiar contraseña
        </h2>
        {method === 'google' ? (
          <p className="text-on-surface-variant">
            Entraste con Google. Para cambiar tu contraseña, cierra sesión y entra con tu usuario y
            contraseña.
          </p>
        ) : (
          <PasswordForm />
        )}
      </section>
      <button type="button" className="btn-outline self-start" onClick={() => void signOut()}>
        Cerrar sesión
      </button>
      <p className="text-label text-on-surface-variant">
        Versión {__APP_VERSION__} · esquema {CLIENT_SCHEMA}
      </p>
    </section>
  );
}

function PasswordForm() {
  const auth = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    const need = !current
      ? 'Escribe tu contraseña actual.'
      : next.length < MIN_PASSWORD_LENGTH
        ? 'La contraseña nueva necesita al menos 8 caracteres.'
        : next !== repeat
          ? 'Las contraseñas nuevas no coinciden.'
          : null;
    if (need) return setProblem(need);
    setBusy(true);
    setProblem(null);
    try {
      await auth.changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      setDone(true);
    } catch (error) {
      setProblem(passwordMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-label">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setProblem(null);
          setDone(false);
        }}
        autoComplete={autoComplete}
        className="field"
      />
    </label>
  );

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      {field('Contraseña actual', current, setCurrent, 'current-password')}
      {field('Contraseña nueva', next, setNext, 'new-password')}
      {field('Repite la contraseña nueva', repeat, setRepeat, 'new-password')}
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      {done && (
        <p role="status" className="text-success">
          Listo: tu contraseña cambió.
        </p>
      )}
      <button type="submit" className="btn-primary self-start" disabled={busy}>
        Cambiar contraseña
      </button>
    </form>
  );
}
