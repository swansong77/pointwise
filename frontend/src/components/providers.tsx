'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // Retry 5xx/network errors and 429 (rate limited); never retry other 4xx.
            retry: (count, err) => count < 3 && !(err instanceof ApiError && err.status < 500 && err.status !== 429),
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
          },
        },
      }),
  );
  return (
    <SessionProvider refetchInterval={5 * 60}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SessionProvider>
  );
}
