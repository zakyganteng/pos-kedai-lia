'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Page } from '@/lib/types';
import { buildQuery } from './use-paged';
import { isForbidden, isUnauthorized, readErrorMessage } from './use-api-error';

/** The backend caps `limit` at 100, so a full read is a sequence of pages. */
const PAGE_LIMIT = 100;

type Loaded<T> = {
  token: string;
  items: T[];
  error: string | null;
  forbidden: boolean;
  truncated: boolean;
};

export type LookupResult<T extends { id: string }> = {
  items: T[];
  byId: Map<string, T>;
  loading: boolean;
  error: string | null;
  forbidden: boolean;
  /** More records exist than were read; names beyond them show as ids. */
  truncated: boolean;
  reload: () => void;
};

/**
 * Reads every page of a small reference list (services, products,
 * customers) so ids in reports, queues and ledgers can be shown by name.
 *
 * `resource` is the collection path (e.g. `/services`), `params` its filters.
 * Pass `null` as resource to stay idle. At most `maxPages` pages are read.
 */
export function useLookup<T extends { id: string }>(
  resource: string | null,
  params: Record<string, string | number | boolean | undefined | null>,
  options?: { onUnauthorized?: () => void; maxPages?: number },
): LookupResult<T> {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onUnauthorized = options?.onUnauthorized;
  const maxPages = options?.maxPages ?? 5;
  const paramKey = JSON.stringify(params);
  const token = resource === null ? 'idle' : `${attempt}\u0000${resource}\u0000${paramKey}`;

  useEffect(() => {
    if (resource === null) return;
    let stale = false;
    const base = JSON.parse(paramKey) as Record<string, string | number | boolean | null>;

    (async () => {
      const items: T[] = [];
      let truncated = false;
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await api<Page<T>>(
          `${resource}${buildQuery({ ...base, page, limit: PAGE_LIMIT })}`,
        );
        if (Array.isArray(result?.data)) items.push(...result.data);
        const totalPages = result?.pagination?.totalPages ?? 1;
        if (page >= totalPages) break;
        if (page === maxPages) truncated = true;
      }
      return { items, truncated };
    })()
      .then(({ items, truncated }) => {
        if (stale) return;
        setLoaded({ token, items, error: null, forbidden: false, truncated });
      })
      .catch((caught: unknown) => {
        if (stale) return;
        if (isUnauthorized(caught)) {
          setLoaded({ token, items: [], error: 'Sesi Anda telah berakhir.', forbidden: false, truncated: false });
          onUnauthorized?.();
          return;
        }
        if (isForbidden(caught)) {
          setLoaded({ token, items: [], error: null, forbidden: true, truncated: false });
          return;
        }
        setLoaded({
          token,
          items: [],
          error: readErrorMessage(caught, 'Data rujukan belum dapat dimuat.'),
          forbidden: false,
          truncated: false,
        });
      });

    return () => {
      stale = true;
    };
  }, [resource, paramKey, token, maxPages, onUnauthorized]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const current = loaded !== null && loaded.token === token ? loaded : null;
  const items = useMemo(() => current?.items ?? loaded?.items ?? [], [current, loaded]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  return {
    items,
    byId,
    loading: resource !== null && current === null,
    error: current?.error ?? null,
    forbidden: current?.forbidden ?? false,
    truncated: current?.truncated ?? false,
    reload,
  };
}
