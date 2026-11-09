'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { Category, Page, Product } from '@/lib/types';
import { buildQuery } from './use-paged';
import { isForbidden, isUnauthorized, readErrorMessage } from './use-api-error';

/**
 * Single import seam for the generated `Category` alias. Every screen imports
 * the type from here, so when the backend spec lands there is one line to
 * follow rather than a dozen.
 */
export type { Category };

/** Sentinel values for the category filter. Neither is a real category id. */
export const CATEGORY_ALL = '';
export const CATEGORY_NONE = '__uncategorized__';

/** The backend caps `limit` at 100, so a full read is a sequence of pages. */
const PAGE_LIMIT = 100;
/** Pages read without the user asking. Covers 500 categories in one go. */
const AUTO_PAGES = 5;

const NO_ITEMS: Category[] = [];

/**
 * A product's category id, with "unassigned" and "field not sent yet" both
 * collapsing to null so callers have one empty case to handle.
 */
export function categoryIdOf(product: Product): string | null {
  const value = product.categoryId;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Turns a filter choice into the query parameters `/products` accepts. */
export function categoryQuery(
  selected: string,
): { categoryId?: string; uncategorized?: boolean } {
  if (selected === CATEGORY_ALL) return {};
  // The two parameters are mutually exclusive upstream; only one is ever set.
  if (selected === CATEGORY_NONE) return { uncategorized: true };
  return { categoryId: selected };
}

type Loaded = {
  /** Identifies which request produced this result. */
  token: string;
  items: Category[];
  totalPages: number;
  loadedPages: number;
  error: string | null;
  forbidden: boolean;
};

export type AllCategoriesResult = {
  items: Category[];
  byId: Map<string, Category>;
  loading: boolean;
  /** True until the first result arrives. */
  initial: boolean;
  error: string | null;
  forbidden: boolean;
  /**
   * True only when every page the server reported has been read. Callers must
   * not conclude that a category is gone while this is false: an id missing
   * from a partial read is simply an id not fetched yet.
   */
  complete: boolean;
  remainingPages: number;
  loadMore: () => void;
  reload: () => void;
};

/**
 * Reads the whole category list for one business line.
 *
 * The Kasir filter and the assignment selector both need every category, not
 * a page of them: a chip row that silently omits a category would make the
 * catalog look emptier than it is, and a selector missing the value a product
 * already holds would mislabel that product. So this walks the pages.
 *
 * Pass `null` to stay idle. Salon lines and accounts without permission must
 * not touch the endpoint at all.
 *
 * There is no cache. Every mount re-reads, so returning to Kasir after a
 * rename or an archive shows the current names rather than a stale copy.
 */
export function useAllCategories(
  businessLineId: string | null,
  options?: { active?: boolean; onUnauthorized?: () => void },
): AllCategoriesResult {
  const active = options?.active;
  const onUnauthorized = options?.onUnauthorized;

  const scope = `${businessLineId ?? ''}\u0000${active === undefined ? '' : String(active)}`;
  // Reach is derived from the scope, so switching line or status restarts at
  // the automatic depth instead of carrying another list's "load more" over.
  const [reach, setReach] = useState({ scope, pages: AUTO_PAGES });
  const pages = reach.scope === scope ? reach.pages : AUTO_PAGES;

  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const token = businessLineId === null ? 'idle' : `${attempt}\u0000${scope}\u0000${pages}`;

  useEffect(() => {
    if (businessLineId === null) return;
    let stale = false;

    const read = async () => {
      const items: Category[] = [];
      let totalPages = 1;
      let loadedPages = 0;

      for (let page = 1; page <= pages; page += 1) {
        const query = buildQuery({ businessLineId, active, page, limit: PAGE_LIMIT });
        const result = await api<Page<Category>>(`/categories${query}`);
        if (stale) return;
        if (Array.isArray(result?.data)) items.push(...result.data);
        totalPages = result?.pagination?.totalPages ?? 1;
        loadedPages = page;
        if (page >= totalPages) break;
      }

      setLoaded({ token, items, totalPages, loadedPages, error: null, forbidden: false });
    };

    const blank = { token, items: NO_ITEMS, totalPages: 1, loadedPages: 0 };

    read().catch((caught: unknown) => {
      if (stale) return;
      if (isUnauthorized(caught)) {
        setLoaded({ ...blank, error: 'Sesi Anda telah berakhir.', forbidden: false });
        onUnauthorized?.();
        return;
      }
      if (isForbidden(caught)) {
        setLoaded({ ...blank, error: null, forbidden: true });
        return;
      }
      setLoaded({
        ...blank,
        error: readErrorMessage(caught, 'Daftar kategori belum dapat dimuat.'),
        forbidden: false,
      });
    });

    return () => {
      stale = true;
    };
  }, [businessLineId, active, pages, token, onUnauthorized]);

  const loadMore = useCallback(() => {
    setReach((current) =>
      current.scope === scope
        ? { scope, pages: current.pages + AUTO_PAGES }
        : { scope, pages: AUTO_PAGES * 2 },
    );
  }, [scope]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const current = loaded !== null && loaded.token === token ? loaded : null;
  // Names from the previous read stay on screen while the next one runs.
  const items = current?.items ?? loaded?.items ?? NO_ITEMS;

  const byId = useMemo(() => {
    const map = new Map<string, Category>();
    for (const category of items) map.set(category.id, category);
    return map;
  }, [items]);

  return {
    items,
    byId,
    loading: businessLineId !== null && current === null,
    initial: loaded === null,
    error: current?.error ?? null,
    forbidden: current?.forbidden ?? false,
    complete: current !== null && current.loadedPages >= current.totalPages,
    remainingPages: current === null ? 0 : Math.max(0, current.totalPages - current.loadedPages),
    loadMore,
    reload,
  };
}
