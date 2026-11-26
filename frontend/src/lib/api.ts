'use client';

import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin base path; Next.js rewrites /api/v1/* to the NestJS service. */
export const API_BASE = '/api/v1';

export async function apiFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      // JSON bodies are strings; FormData uploads must let the browser set the multipart boundary
      ...(typeof rest.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

/** Hook returning an authenticated fetcher bound to the current session. */
export function useApi() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  return useCallback(
    <T,>(path: string, init: RequestInit = {}) => apiFetch<T>(path, { ...init, token }),
    [token],
  );
}

export const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
