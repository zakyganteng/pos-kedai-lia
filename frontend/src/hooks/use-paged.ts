'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Page, Pagination } from '@/lib/types';
import { isForbidden, isUnauthorized, readErrorMessage } from './use-api-error';

type Loaded<T> = {
  /** Identifies which request produced this result. */
  token: string;
  items: T[];
  pagination: Pagination | null;
  error: string | null;
  forbidden: boolean;
};

export type PagedResult<T> = {
  items: T[];
  pagination: Pagination | null;
  loading: boolean;
  /** True until the first result for this list arrives. */
  initial: boolean;
  error: string | null;
  /** The caller lacks permission for this resource. */
  forbidden: boolean;
  reload: () => void;
};

/**
 * Fetches a `{ data, pagination }` page. Pass `null` to stay idle.
 *
 * Loading is derived by comparing the requested path against the path that
 * produced the result in hand, so no state is written while rendering or in
 * the effect body, and a response that arrives after a newer request started
 * is ignored rather than flashing stale rows.
 */
export function usePaged<T>(
  path: string | null,
  options?: { onUnauthorized?: () => void; errorMessage?: string },
): PagedResult<T> {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const onUnauthorized = options?.onUnauthorized;
  const errorMessage = options?.errorMessage ?? 'Data belum dapat dimuat.';
  const token = path === null ? 'idle' : `${attempt}\u0000${path}`;

  useEffect(() => {
    if (path === null) return;
    let stale = false;

    api<Page<T>>(path)
      .then((page) => {
        if (stale) return;
        setLoaded({
          token,
          items: Array.isArray(page?.data) ? page.data : [],
          pagination: page?.pagination ?? null,
          error: null,
          forbidden: false,
        });
      })
      .catch((caught: unknown) => {
        if (stale) return;
        if (isUnauthorized(caught)) {
          setLoaded({
            token,
            items: [],
            pagination: null,
            error: 'Sesi Anda telah berakhir.',
            forbidden: false,
          });
          onUnauthorized?.();
          return;
        }
        if (isForbidden(caught)) {
          setLoaded({ token, items: [], pagination: null, error: null, forbidden: true });
          return;
        }
        setLoaded({
          token,
          items: [],
          pagination: null,
          error: readErrorMessage(caught, errorMessage),
          forbidden: false,
        });
      });

    return () => {
      stale = true;
    };
  }, [path, token, onUnauthorized, errorMessage]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const current = loaded !== null && loaded.token === token ? loaded : null;

  return {
    // Rows from the previous page stay visible while the next one loads.
    items: current?.items ?? loaded?.items ?? [],
    pagination: current?.pagination ?? loaded?.pagination ?? null,
    loading: path !== null && current === null,
    initial: loaded === null,
    error: current?.error ?? null,
    forbidden: current?.forbidden ?? false,
    reload,
  };
}

type ResourceLoaded<T> = { token: string; value: T | null; error: string | null; forbidden: boolean };

export type ResourceResult<T> = {
  value: T | null;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  reload: () => void;
};

/** Same contract as usePaged, for endpoints that return a single object. */
export function useResource<T>(
  path: string | null,
  options?: { onUnauthorized?: () => void; errorMessage?: string },
): ResourceResult<T> {
  const [loaded, setLoaded] = useState<ResourceLoaded<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  const onUnauthorized = options?.onUnauthorized;
  const errorMessage = options?.errorMessage ?? 'Data belum dapat dimuat.';
  const token = path === null ? 'idle' : `${attempt}\u0000${path}`;

  useEffect(() => {
    if (path === null) return;
    let stale = false;

    api<T>(path)
      .then((value) => {
        if (stale) return;
        setLoaded({ token, value, error: null, forbidden: false });
      })
      .catch((caught: unknown) => {
        if (stale) return;
        if (isUnauthorized(caught)) {
          setLoaded({ token, value: null, error: 'Sesi Anda telah berakhir.', forbidden: false });
          onUnauthorized?.();
          return;
        }
        if (isForbidden(caught)) {
          setLoaded({ token, value: null, error: null, forbidden: true });
          return;
        }
        setLoaded({
          token,
          value: null,
          error: readErrorMessage(caught, errorMessage),
          forbidden: false,
        });
      });

    return () => {
      stale = true;
    };
  }, [path, token, onUnauthorized, errorMessage]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const current = loaded !== null && loaded.token === token ? loaded : null;

  return {
    value: current?.value ?? null,
    loading: path !== null && current === null,
    error: current?.error ?? null,
    forbidden: current?.forbidden ?? false,
    reload,
  };
}

/**
 * Page number that resets itself whenever the filters change.
 *
 * Derived from the current filter signature rather than reset in an effect,
 * so a filter change and its page reset land in the same render.
 */
export function useFilteredPage(filterKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key: filterKey, page: 1 });
  const page = state.key === filterKey ? state.page : 1;
  const setPage = useCallback(
    (next: number) => setState({ key: filterKey, page: Math.max(1, next) }),
    [filterKey],
  );
  return [page, setPage];
}

/** Delays a fast changing value so we do not fetch on every keypress. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

export function buildQuery(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
