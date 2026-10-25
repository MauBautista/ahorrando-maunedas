import { type ReactNode, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ApiError } from '../../lib/api';
import { type AuthUser, useAuth } from '../../lib/auth';
import { AccountContext, type LoginState, useMe } from './useSession';

export function SessionProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [account, setAccount] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => auth.onChange(setAccount), [auth]);
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

/** The app behind the login: waits for the session, sends strangers to /login and keeps the user for the rest. */
export function RequireSession() {
  const { account, data, error, isPending, refetch } = useMe();
  const location = useLocation();
  if (account === undefined || (account && isPending && !error)) return <Splash />;
  // No network or a server failure is not a reason to sign out: try again from here.
  if (account && error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
    return (
      <div role="alert" className="grid min-h-dvh place-content-center gap-4 p-4 text-center">
        <p>{error.message}</p>
        <button type="button" className="btn-primary" onClick={() => void refetch()}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!account || error) {
    const message = error instanceof ApiError ? error.message : undefined;
    const state: LoginState = { from: location.pathname + location.search, message };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet context={data} />;
}

/** Only for admins (RF-ADM): others land on Inicio. */
export function RequireAdmin() {
  const { data } = useMe();
  return data?.user.role === 'admin' ? <Outlet /> : <Navigate to="/" replace />;
}

export function Splash() {
  return (
    <div role="status" className="grid min-h-dvh place-items-center text-on-surface-variant">
      Cargando…
    </div>
  );
}
