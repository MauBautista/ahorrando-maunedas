import type { AdminUser } from '@maunedas/shared/api/admin';
import { MIN_PASSWORD_LENGTH } from '@maunedas/shared/api/admin';
import { isValidUsername, normalizeUsername } from '@maunedas/shared/auth/username';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { useApi } from '../../lib/context';
import { formatDate } from '../../lib/format';
import { useWide } from '../../lib/useWide';
import { ME_KEY, useMe } from '../auth/useSession';
import { PasswordField } from './PasswordField';

type Role = AdminUser['role'];
const ROLE: Record<Role, string> = { admin: 'Administrador', member: 'Miembro' };
const USERS_KEY = ['admin-users'];

type Editing = { kind: 'new' } | { kind: 'edit'; user: AdminUser } | { kind: 'password'; user: AdminUser };

/**
 * W-11 (06 §3, 02 §5): the household's users with "Nuevo", "Editar", "Restablecer contraseña" and
 * "Desactivar"/"Activar". Passwords are typed or generated here, sent once to the Worker (which never stores or logs
 * them, CLAUDE.md rule 11) and handed over in person. The server's messages are shown as they come (03 §1.2).
 */
export function UsersPage() {
  const api = useApi();
  const queryClient = useQueryClient();
  const wide = useWide();
  const { data: me } = useMe();
  const users = useQuery({
    queryKey: USERS_KEY,
    queryFn: () => api.get<{ items: AdminUser[] }>('/v1/admin/users'),
  });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function done(message: string) {
    await queryClient.invalidateQueries({ queryKey: USERS_KEY });
    // My own name or role may have changed.
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
    setEditing(null);
    setNotice(message);
  }

  async function setActive(user: AdminUser, active: boolean) {
    setNotice(null);
    setProblem(null);
    if (!active && !window.confirm(`¿Desactivar a «${user.display_name}»? Ya no podrá entrar.`)) return;
    try {
      await api.patch(`/v1/admin/users/${user.id}`, { active });
      await done(
        active
          ? `«${user.display_name}» puede volver a entrar.`
          : `«${user.display_name}» ya no puede entrar.`,
      );
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  const actions = (u: AdminUser) => (
    <div className="flex flex-wrap gap-1">
      <button
        type="button"
        className="btn-text"
        aria-label={`Editar a ${u.username}`}
        onClick={() => setEditing({ kind: 'edit', user: u })}
      >
        Editar
      </button>
      <button
        type="button"
        className="btn-text"
        aria-label={`Restablecer la contraseña de ${u.username}`}
        onClick={() => setEditing({ kind: 'password', user: u })}
      >
        Restablecer contraseña
      </button>
      <button
        type="button"
        className={`btn-text ${u.active ? 'text-error' : ''}`}
        aria-label={`${u.active ? 'Desactivar' : 'Activar'} a ${u.username}`}
        onClick={() => void setActive(u, !u.active)}
      >
        {u.active ? 'Desactivar' : 'Activar'}
      </button>
    </div>
  );
  const items = users.data?.items ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-title">Usuarios</h1>
        <button type="button" className="btn-primary" onClick={() => setEditing({ kind: 'new' })}>
          Nuevo usuario
        </button>
      </div>
      {notice && (
        <p role="status" className="rounded-lg bg-surface-variant p-2">
          {notice}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-error">
          {problem}
        </p>
      )}
      {users.isPending ? (
        <p role="status" className="text-on-surface-variant">
          Cargando…
        </p>
      ) : users.isError ? (
        <p role="alert" className="text-error">
          {users.error.message}
        </p>
      ) : wide ? (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-label text-on-surface-variant">
              <th className="p-2 font-medium">Usuario</th>
              <th className="p-2 font-medium">Nombre</th>
              <th className="p-2 font-medium">Rol</th>
              <th className="p-2 font-medium">Google</th>
              <th className="p-2 font-medium">Estado</th>
              <th className="p-2">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr
                key={u.id}
                className={`border-t border-outline/30 ${u.active ? '' : 'text-on-surface-variant'}`}
              >
                <td className="p-2 font-mono">{u.username}</td>
                <td className="p-2">{u.id === me?.user.id ? `${u.display_name} (tú)` : u.display_name}</td>
                <td className="p-2">{ROLE[u.role]}</td>
                <td className="p-2">{u.google_email ?? '—'}</td>
                <td className="p-2">{u.active ? 'Activo' : 'Desactivado'}</td>
                <td className="p-2">{actions(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="flex flex-col divide-y divide-outline/30 rounded-xl border border-outline/30">
          {items.map((u) => (
            <li key={u.id} className={`flex flex-col gap-1 p-3 ${u.active ? '' : 'text-on-surface-variant'}`}>
              <span className="font-medium">
                {u.id === me?.user.id ? `${u.display_name} (tú)` : u.display_name} ·{' '}
                <span className="font-mono">{u.username}</span>
              </span>
              <span className="text-label">
                {[
                  ROLE[u.role],
                  u.active ? 'Activo' : 'Desactivado',
                  u.google_email ?? 'Sin Google',
                  `Desde ${formatDate(u.created_at)}`,
                ].join(' · ')}
              </span>
              {actions(u)}
            </li>
          ))}
        </ul>
      )}
      {editing?.kind === 'new' && (
        <NewUserDialog
          onClose={() => setEditing(null)}
          onDone={(u) => void done(`Se creó «${u.username}».`)}
        />
      )}
      {editing?.kind === 'edit' && (
        <EditUserDialog
          user={editing.user}
          onClose={() => setEditing(null)}
          onDone={(u) => void done(`Se guardaron los cambios de «${u.username}».`)}
        />
      )}
      {editing?.kind === 'password' && (
        <ResetPasswordDialog
          user={editing.user}
          onClose={() => setEditing(null)}
          onDone={() => void done(`Se cambió la contraseña de «${editing.user.username}».`)}
        />
      )}
    </section>
  );
}

function RoleField({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-1 text-label">Rol</legend>
      {(['member', 'admin'] as const).map((r) => (
        <label key={r} className={`tab border border-outline/40 ${value === r ? 'tab-active' : ''}`}>
          <input
            type="radio"
            className="sr-only"
            name="role"
            checked={value === r}
            onChange={() => onChange(r)}
          />
          {ROLE[r]}
        </label>
      ))}
    </fieldset>
  );
}

function Buttons({
  busy,
  onClose,
  onSave,
  save,
}: {
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
  save: string;
}) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-outline" onClick={onClose}>
        Cancelar
      </button>
      <button type="button" className="btn-primary" disabled={busy} onClick={onSave}>
        {save}
      </button>
    </div>
  );
}

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

function Problem({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-error">
      {text}
    </p>
  ) : null;
}

function NewUserDialog({ onClose, onDone }: { onClose: () => void; onDone: (u: AdminUser) => void }) {
  const api = useApi();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [password, setPassword] = useState('');
  const [google, setGoogle] = useState('');
  const { busy, error, setError, run } = useSubmit();

  function save() {
    const u = normalizeUsername(username);
    if (!isValidUsername(u))
      return setError(
        'El usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.',
      );
    if (!name.trim()) return setError('Escribe el nombre.');
    if (!password && !google.trim()) return setError('Escribe una contraseña o un correo de Google.');
    if (password && password.length < MIN_PASSWORD_LENGTH)
      return setError('La contraseña debe tener al menos 8 caracteres.');
    void run(async () => {
      const { user } = await api.post<{ user: AdminUser }>('/v1/admin/users', {
        username: u,
        display_name: name.trim(),
        role,
        ...(password ? { password } : {}),
        ...(google.trim() ? { google_email: google.trim() } : {}),
      });
      onDone(user);
    });
  }

  return (
    <Dialog title="Nuevo usuario" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label">Usuario</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="field"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-label">Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="field" />
        </label>
        <RoleField value={role} onChange={setRole} />
        <PasswordField label="Contraseña inicial" value={password} onChange={setPassword} />
        <label className="flex flex-col gap-1">
          <span className="text-label">Correo de Google (opcional)</span>
          <input
            type="email"
            value={google}
            onChange={(e) => setGoogle(e.target.value)}
            autoComplete="off"
            className="field"
          />
        </label>
        <Problem text={error} />
        <Buttons busy={busy} onClose={onClose} onSave={save} save="Crear" />
      </div>
    </Dialog>
  );
}

function EditUserDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: (u: AdminUser) => void;
}) {
  const api = useApi();
  const [name, setName] = useState(user.display_name);
  const [role, setRole] = useState<Role>(user.role);
  const [google, setGoogle] = useState(user.google_email ?? '');
  const { busy, error, setError, run } = useSubmit();
  const nextGoogle = google.trim() || null;

  function save() {
    if (!name.trim()) return setError('Escribe el nombre.');
    // Only what changed (a PATCH with nothing is a 400).
    const changes = {
      ...(name.trim() !== user.display_name ? { display_name: name.trim() } : {}),
      ...(role !== user.role ? { role } : {}),
      ...(nextGoogle !== user.google_email ? { google_email: nextGoogle } : {}),
    };
    if (Object.keys(changes).length === 0) return onClose();
    void run(async () => {
      const { user: saved } = await api.patch<{ user: AdminUser }>(`/v1/admin/users/${user.id}`, changes);
      onDone(saved);
    });
  }

  return (
    <Dialog title={`Editar a ${user.username}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label">Nombre</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="field" />
        </label>
        <RoleField value={role} onChange={setRole} />
        <label className="flex flex-col gap-1">
          <span className="text-label">Correo de Google (opcional)</span>
          <input
            type="email"
            value={google}
            onChange={(e) => setGoogle(e.target.value)}
            autoComplete="off"
            className="field"
          />
        </label>
        {user.google_email && nextGoogle !== user.google_email && (
          <p className="text-label text-on-surface-variant">
            Al cambiar o quitar el correo, su acceso con Google anterior se cierra.
          </p>
        )}
        <Problem text={error} />
        <Buttons busy={busy} onClose={onClose} onSave={save} save="Guardar" />
      </div>
    </Dialog>
  );
}

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useSubmit();

  function save() {
    if (password.length < MIN_PASSWORD_LENGTH)
      return setError('La contraseña debe tener al menos 8 caracteres.');
    void run(async () => {
      await api.post(`/v1/admin/users/${user.id}/password`, { password });
      onDone();
    });
  }

  return (
    <Dialog title={`Contraseña nueva para ${user.username}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <PasswordField label="Contraseña nueva" value={password} onChange={setPassword} />
        <Problem text={error} />
        <Buttons busy={busy} onClose={onClose} onSave={save} save="Cambiar contraseña" />
      </div>
    </Dialog>
  );
}
