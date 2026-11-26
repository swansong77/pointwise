'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { json, useApi } from './api';
import type { CatalogCard, Category, Dashboard, Merchant, NearbyItem, NotificationItem, Page, RankedCard, Subscription, UserOffer, WalletCard } from './types';

const useAuthed = () => useSession().status === 'authenticated';

/**
 * useQuery for authenticated endpoints: waits until the session (and its access token) exists.
 * Without this, the first render fires the request with no token, gets a 401, and — because 4xx
 * errors are not retried and the key does not change — never recovers.
 */
export function useAuthedQuery<T>(key: readonly unknown[], path: string, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  const api = useApi();
  const authed = useAuthed();
  return useQuery({
    queryKey: key as unknown[],
    queryFn: () => api<T>(path),
    enabled: authed && opts.enabled !== false,
    refetchInterval: opts.refetchInterval,
  });
}

export const qk = {
  dashboard: ['dashboard'] as const,
  wallet: ['wallet'] as const,
  categories: ['categories'] as const,
  cards: (q: string) => ['cards', q] as const,
  offers: (status: string, sort: string) => ['offers', status, sort] as const,
  eligible: ['offers', 'eligible'] as const,
  notifications: ['notifications'] as const,
  unread: ['notifications', 'unread'] as const,
  subscription: ['subscription'] as const,
};

export function useDashboard() {
  const api = useApi();
  return useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api<Dashboard>('/dashboard'),
    enabled: useAuthed(),
  });
}

export function useWallet() {
  const api = useApi();
  return useQuery({
    queryKey: qk.wallet,
    queryFn: () => api<WalletCard[]>('/wallet/cards'),
    enabled: useAuthed(),
  });
}

export function useCategories() {
  const api = useApi();
  return useQuery({
    queryKey: qk.categories,
    queryFn: () => api<Category[]>('/categories'),
    staleTime: 5 * 60_000,
  });
}

/** Catalog search; `type` narrows to personal or business cards. */
export function useCardSearch(q: string, type?: 'PERSONAL' | 'BUSINESS') {
  const api = useApi();
  return useQuery({
    queryKey: [...qk.cards(q), type ?? 'ALL'],
    queryFn: () => api<Page<CatalogCard>>(`/cards?pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${type ? `&type=${type}` : ''}`),
  });
}

export function useMerchantSearch(q: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['merchants', q],
    queryFn: () => api<Page<Merchant>>(`/merchants?pageSize=30${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
}

export function useMyOffers(status: string, sort: string) {
  const api = useApi();
  return useQuery({
    queryKey: qk.offers(status, sort),
    queryFn: () => api<UserOffer[]>(`/offers/mine?status=${status}&sort=${sort}`),
    enabled: useAuthed(),
  });
}

export function useEligibleOffers() {
  const api = useApi();
  return useQuery({
    queryKey: qk.eligible,
    queryFn: () =>
      api<
        Array<{
          offer: UserOffer['offer'];
          walletCardId: string;
          cardName: string;
        }>
      >('/offers/eligible'),
    enabled: useAuthed(),
  });
}

export function useCategoryRecommendation(slug: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['rec', 'category', slug],
    queryFn: () => api<{ category: Category; ranked: RankedCard[] }>(`/recommendations/categories/${slug}`),
    enabled: useAuthed() && !!slug,
  });
}

export function useNearby(coords: { lat: number; lng: number } | null, radius: number) {
  const api = useApi();
  return useQuery({
    queryKey: ['nearby', coords?.lat, coords?.lng, radius],
    queryFn: () => api<NearbyItem[]>(`/nearby?lat=${coords!.lat}&lng=${coords!.lng}&radius=${radius}`),
    enabled: useAuthed() && !!coords,
  });
}

export function useNotifications() {
  const api = useApi();
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api<NotificationItem[]>('/notifications'),
    enabled: useAuthed(),
  });
}

export function useUnreadCount() {
  const api = useApi();
  return useQuery({
    queryKey: qk.unread,
    queryFn: () => api<{ count: number }>('/notifications/unread-count'),
    enabled: useAuthed(),
    refetchInterval: 60_000,
  });
}

export function useSubscription() {
  const api = useApi();
  return useQuery({
    queryKey: qk.subscription,
    queryFn: () => api<Subscription>('/subscription'),
    enabled: useAuthed(),
  });
}

/** Generic mutation that invalidates the given query prefixes on success. */
export function useApiMutation<TVars, TResult = unknown>(
  build: (vars: TVars) => { path: string; method: string; body?: unknown },
  invalidate: ReadonlyArray<readonly unknown[]> = [],
) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { path, method, body } = build(vars);
      return api<TResult>(path, {
        method,
        ...(body !== undefined ? json(body) : {}),
      });
    },
    onSuccess: async () => {
      await Promise.all(invalidate.map((key) => qc.invalidateQueries({ queryKey: key as unknown[] })));
    },
  });
}
