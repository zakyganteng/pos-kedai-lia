'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { BusinessLine, Product } from '@/lib/types';
import type { AllCategoriesResult } from '@/hooks/use-categories';
import { categoryIdOf } from '@/hooks/use-categories';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge, WriteError } from './states';

const PAGE_SIZE = 20;

/** Select value standing for "no category". Empty string, never a real id. */
const UNASSIGNED = '';

type ProductCategoryPanelProps = {
  line: BusinessLine;
  /** Every category of this line, active and archived. */
  catalogue: AllCategoriesResult;
  /** Bumped by the screen after a category is renamed, archived or restored. */
  revision: number;
  /** Called after the server confirms an assignment, which moves a count. */
  onChanged: () => void;
  onSessionExpired: () => void;
};

export function ProductCategoryPanel({
  line,
  catalogue,
  revision,
  onChanged,
  onSessionExpired,
}: ProductCategoryPanelProps) {
  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);
  const [page, setPage] = useFilteredPage(`${line.id}\u0000${settledSearch}`);

  // Drafts hold the pending choice per product. A product with no entry shows
  // whatever the server last reported. Entries are dropped once saved, so the
  // row goes back to reading from the server rather than from this map.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  // No `active` filter: inactive products still hold a category, and a
  // category cannot be archived until every one of them has been moved off it.
  const list = usePaged<Product>(
    `/products${buildQuery({
      businessLineId: line.id,
      search: settledSearch.trim() || undefined,
      page,
      limit: PAGE_SIZE,
    })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar produk belum dapat dimuat.' },
  );

  const reload = list.reload;
  useEffect(() => {
    if (revision === 0) return;
    reload();
  }, [revision, reload]);

  const assignable = catalogue.items.filter((category) => category.active);
  const totalPages = list.pagination?.totalPages ?? 1;

  // Nothing can be assigned until the options are known. Both the select and
  // the buttons go dead together, with one line saying why, rather than a
  // dead select beside a live Simpan that would fail on contact.
  const assignBlocked = catalogue.error !== null || catalogue.initial;
  const assignBlockedNote =
    catalogue.error !== null
      ? 'Kategori produk belum dapat diubah sampai daftar kategori berhasil dimuat.'
      : 'Kategori produk belum dapat diubah sampai daftar kategori selesai dimuat.';

  const recheck = useCallback(
    (key: string) => () => {
      mutate.clear(key);
      reload();
      onChanged();
    },
    [mutate, reload, onChanged],
  );

  const save = async (product: Product, value: string) => {
    const key = `assign:${product.id}`;
    const ok = await mutate.run(key, async () => {
      await api<Product>(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryId: value === UNASSIGNED ? null : value }),
      });
    });
    // Only a confirmed write drops the draft. On failure the row keeps showing
    // the unsaved choice next to the error, so nothing claims to be saved.
    if (!ok) return;
    setDrafts((current) => {
      if (!(product.id in current)) return current;
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    list.reload();
    onChanged();
  };

  return (
    <section className="katalog-pane" aria-labelledby="produk-heading">
      <h2 className="section-title" id="produk-heading">
        Kategori produk
      </h2>

      <p className="meta">
        Daftar ini memuat produk aktif dan nonaktif, sehingga sebuah kategori dapat dikosongkan
        sebelum diarsipkan.
      </p>

      <div className="field">
        <label className="field-label" htmlFor="produk-cari">
          Cari produk
        </label>
        <input
          id="produk-cari"
          className="input"
          type="search"
          value={search}
          autoComplete="off"
          placeholder="Nama atau SKU"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {catalogue.error !== null ? (
        <ErrorBlock
          title="Daftar kategori belum dapat dimuat."
          message={`${catalogue.error} ${assignBlockedNote}`}
          onRetry={catalogue.reload}
        />
      ) : null}

      {catalogue.error === null && catalogue.initial ? (
        <LoadingBlock label={assignBlockedNote} />
      ) : null}

      {catalogue.error === null && !catalogue.complete && !catalogue.initial ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={catalogue.loading}
            onClick={catalogue.loadMore}
          >
            {catalogue.loading
              ? 'Memuat kategori…'
              : `Muat ${catalogue.remainingPages} halaman kategori lagi`}
          </button>
        </div>
      ) : null}

      {list.loading ? (
        <LoadingBlock label={list.initial ? 'Memuat produk…' : 'Memperbarui daftar produk…'} />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke daftar produk unit usaha ini." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title="Daftar produk belum dapat dimuat."
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {!list.loading && list.error === null && !list.forbidden && list.items.length === 0 ? (
        <EmptyBlock
          title={
            settledSearch.trim() !== ''
              ? 'Tidak ada produk yang cocok dengan pencarian ini.'
              : 'Belum ada produk pada unit usaha ini.'
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <ul className="assign-list" aria-busy={list.loading}>
          {list.items.map((product) => {
            const key = `assign:${product.id}`;
            const serverValue = categoryIdOf(product) ?? UNASSIGNED;
            // `??` keeps an explicit "Tanpa kategori" draft, which is '' and
            // therefore not nullish, from falling back to the server value.
            const draft = drafts[product.id] ?? serverValue;
            const dirty = draft !== serverValue;
            const pending = mutate.isPending(key);
            const failure = mutate.failureOf(key);

            // '' is never a key, so an unassigned product simply misses.
            const assigned = catalogue.byId.get(serverValue);
            // An archived category, or one on a page that has not been read,
            // still has to appear in the select: a product must never be shown
            // under a value the control cannot represent.
            const extra =
              serverValue !== UNASSIGNED && (assigned === undefined || !assigned.active)
                ? {
                    id: serverValue,
                    label:
                      assigned === undefined
                        ? 'Kategori ini belum dimuat'
                        : `${assigned.name} (diarsipkan)`,
                  }
                : null;

            return (
              <li className="assign-row" key={product.id}>
                <div className="assign-head">
                  <span className="assign-name">{product.name}</span>
                  {product.active ? null : <StatusBadge label="Nonaktif" tone="neutral" />}
                  <span className="meta">
                    {product.sku} · per {product.unit}
                  </span>
                  <span className="meta money assign-price">{rupiah(product.price)}</span>
                </div>

                <div className="assign-controls">
                  <div className="field">
                    <label className="field-label" htmlFor={`produk-kategori-${product.id}`}>
                      Kategori {product.name}
                    </label>
                    <select
                      id={`produk-kategori-${product.id}`}
                      className="select"
                      value={draft}
                      disabled={pending || assignBlocked}
                      onChange={(event) => {
                        const value = event.target.value;
                        mutate.clear(key);
                        setDrafts((current) => ({ ...current, [product.id]: value }));
                      }}
                    >
                      <option value={UNASSIGNED}>Tanpa kategori</option>
                      {extra !== null ? (
                        <option value={extra.id}>{extra.label}</option>
                      ) : null}
                      {assignable.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!dirty || pending || assignBlocked}
                    onClick={() => void save(product, draft)}
                  >
                    {pending ? 'Menyimpan…' : 'Simpan'}
                    <span className="sr-only"> kategori {product.name}</span>
                  </button>

                  {dirty ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => {
                        mutate.clear(key);
                        setDrafts((current) => {
                          const next = { ...current };
                          delete next[product.id];
                          return next;
                        });
                      }}
                    >
                      Batal
                    </button>
                  ) : serverValue !== UNASSIGNED ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending || assignBlocked}
                      onClick={() => void save(product, UNASSIGNED)}
                    >
                      Hapus kategori
                      <span className="sr-only"> dari {product.name}</span>
                    </button>
                  ) : null}
                </div>

                {failure !== null ? (
                  <WriteError
                    failure={failure}
                    unchangedNote="Kategori produk ini belum berubah."
                    onRecheck={recheck(key)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {totalPages > 1 ? (
        <nav className="pager" aria-label="Halaman daftar produk">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1 || list.loading}
          >
            Sebelumnya
          </button>
          <span className="meta" role="status">
            Halaman {list.pagination?.page ?? page} dari {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || list.loading}
          >
            Berikutnya
          </button>
        </nav>
      ) : null}
    </section>
  );
}
