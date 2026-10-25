import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** Errors the user must act on (4xx) are not retried; the network and the server get one more try. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) =>
          count < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}
