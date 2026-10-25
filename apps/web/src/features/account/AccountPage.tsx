import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from '../../lib/auth';
import { useMe } from '../auth/useSession';

/** W-14, for now who is signed in and "Cerrar sesión"; the name and password arrive with T-166. */
export function AccountPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useMe();
  async function signOut() {
    await auth.signOut();
    queryClient.clear();
    navigate('/login', { replace: true });
  }
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title">Cuenta</h1>
      {data && (
        <p>
          {data.user.display_name} · usuario {data.user.username}
          {data.user.role === 'admin' ? ' · administrador' : ''}
        </p>
      )}
      <button type="button" className="btn-outline self-start" onClick={() => void signOut()}>
        Cerrar sesión
      </button>
    </section>
  );
}
