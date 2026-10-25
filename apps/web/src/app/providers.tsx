import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Api } from '../lib/api';
import { AuthContext, type AuthPort } from '../lib/auth';
import { ApiContext } from '../lib/context';
import { SessionProvider } from '../features/auth/session';

/** What every screen reads: Firebase Auth, the API client, the query cache and the session. Tests pass fakes. */
export function AppProviders({
  auth,
  api,
  queryClient,
  children,
}: {
  auth: AuthPort;
  api: Api;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <AuthContext.Provider value={auth}>
      <ApiContext.Provider value={api}>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>{children}</SessionProvider>
        </QueryClientProvider>
      </ApiContext.Provider>
    </AuthContext.Provider>
  );
}
