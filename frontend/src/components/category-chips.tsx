'use client';

import type { Category } from '@/hooks/use-categories';
import { CATEGORY_ALL, CATEGORY_NONE } from '@/hooks/use-categories';

type CategoryChipsProps = {
  categories: Category[];
  /** The choice currently driving the list, already reconciled by the caller. */
  selected: string;
  /**
   * A selected category id whose name is not in hand, because the read failed
   * or has not reached that page yet. It still gets a chip: a filter that is
   * switched on must have something pressed, or the row claims the list is
   * unfiltered when it is not.
   */
  unnamedSelectedId: string | null;
  onSelect: (value: string) => void;
  /** Null when there is nothing more to read, or when reading failed. */
  loadMore: { remainingPages: number; loading: boolean; onLoadMore: () => void } | null;
};

/**
 * Touch filter for the catalog: Semua, one chip per active category, and
 * Tanpa kategori.
 *
 * Semua and Tanpa kategori are not category rows, they are the two filter
 * states the backend accepts without knowing a single name, so they stay
 * usable even when the category list cannot be read.
 *
 * The row scrolls sideways rather than stacking, so a long list never pushes
 * the products off a counter screen. Every chip is a real button, so a
 * keyboard reaches the far end by tabbing and the browser scrolls it into
 * view; the container contains its own overscroll so a swipe on the chips
 * does not drag the page.
 */
export function CategoryChips({
  categories,
  selected,
  unnamedSelectedId,
  onSelect,
  loadMore,
}: CategoryChipsProps) {
  const chip = (value: string, label: string) => (
    <button
      key={value}
      type="button"
      className="chip"
      aria-pressed={selected === value}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );

  return (
    <div className="chip-row" role="group" aria-label="Saring produk menurut kategori">
      {chip(CATEGORY_ALL, 'Semua')}
      {unnamedSelectedId === null
        ? null
        : chip(unnamedSelectedId, 'Kategori yang dipilih')}
      {categories.map((category) => chip(category.id, category.name))}
      {chip(CATEGORY_NONE, 'Tanpa kategori')}
      {loadMore === null ? null : (
        <button
          type="button"
          className="chip chip-more"
          onClick={loadMore.onLoadMore}
          disabled={loadMore.loading}
        >
          {loadMore.loading
            ? 'Memuat kategori…'
            : `Muat ${loadMore.remainingPages} halaman kategori lagi`}
        </button>
      )}
    </div>
  );
}
