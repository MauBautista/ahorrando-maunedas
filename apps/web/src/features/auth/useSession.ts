import type { MeResponse } from '@maunedas/shared/api/me';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import type { AuthUser } from '../../lib/auth';
import { useApi } from '../../lib/context';

/** undefined while Firebase restores the session, null when signed out. */
export const AccountContext = createContext<AuthUser | null | undefined>(undefined);

export const ME_KEY = ['me'] as const;

/** `GET /v1/me` of the signed-in account (02 §7): who this is in the app and their role. */
export function useMe() {
  const api = useApi();
  const account = useContext(AccountContext);
  const query = useQuery({
    queryKey: [...ME_KEY, account?.uid],
    queryFn: () => api.get<MeResponse>('/v1/me'),
    enabled: !!account,
  });
  return { account, ...query };
}

/** Where a signed-out visit goes back to after logging in. */
export interface LoginState {
  from?: string;
  message?: string;
}
