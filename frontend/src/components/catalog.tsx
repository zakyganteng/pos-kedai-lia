'use client';

import { useMemo, useState } from 'react';
import { rupiah } from '@/lib/format';
import type { BusinessLine, InventoryItem, Product, SalonService } from '@/lib/types';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import {
  CATEGORY_ALL,
  CATEGORY_NONE,
  categoryQuery,
  useAllCategories,
} from '@/hooks/use-categories';
import { CategoryChips } from './category-chips';
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice } from './states';
import { CatalogImage } from './catalog-image';

const PAGE_SIZE = 20;

export type CatalogPick = {
  itemType: 'product' | 'service';
  itemId: string;
  name: string;
  unitPrice: number;
  stockTracked: boolean;
};

type CatalogProps = {
  line: BusinessLine;
  quantityOf: (itemId: string) => number;
  isFull: boolean;
  locked: boolean;
  onAdd: (pick: CatalogPick) => void;
  onSessionExpired: () => void;
};

export function Catalog({ line, quantityOf, isFull, locked, onAdd, onSessionExpired }: CatalogProps) {
  const salon = line.type === 'salon';
  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);

  // Salon lines have no categories, so the endpoint is never called for them.
  const categories = useAllCategories(salon ? null : line.id, {
    active: true,
    onUnauthorized: onSessionExpired,
  });

  const [picked, setPicked] = useState<string>(CATEGORY_ALL);
  const pickedIsId = picked !== CATEGORY_ALL && picked !== CATEGORY_NONE;
  // A chosen category can be archived from the Katalog screen while this one
  // is open. Only a complete read proves it is gone; a partial one proves
  // nothing, so the chip stays selected until every page is in. When it is
  // gone the list falls back to everything and says so, rather than leaving a
  // category name above products that were not filtered by it.
  const pickedGone = pickedIsId && categories.complete && !categories.byId.has(picked);
  const selected = pickedGone ? CATEGORY_ALL : picked;
  const selectedName = pickedIsId ? (categories.byId.get(picked)?.name ?? null) : null;
  const selectedIsId = selected !== CATEGORY_ALL && selected !== CATEGORY_NONE;
  // The filter is on but the name is not in hand: the read failed, or the
  // page holding it has not been fetched yet.
  const selectedUnnamed = selectedIsId && !categories.byId.has(selected);

  const [page, setPage] = useFilteredPage(`${line.id}\u0000${settledSearch}\u0000${selected}`);

  const baseParams = {
    businessLineId: line.id,
    active: true,
    page,
    limit: PAGE_SIZE,
    search: settledSearch.trim() || undefined,
  };

  const products = usePaged<Product>(
    salon
      ? null
      : `/products${buildQuery({ ...baseParams, ...categoryQuery(selected) })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar produk belum dapat dimuat.' },
  );
  // Categories describe products only; a service list is never narrowed by one.
  const services = usePaged<SalonService>(salon ? `/services${buildQuery(baseParams)}` : null, {
    onUnauthorized: onSessionExpired,
    errorMessage: 'Daftar layanan belum dapat dimuat.',
  });

  // Stock is a separate, more restricted resource. A cashier may not be
  // allowed to read it; in that case the catalog simply omits stock figures
  // rather than inventing them.
  const inventory = usePaged<InventoryItem>(
    salon ? null : `/inventory${buildQuery({ businessLineId: line.id, page: 1, limit: 100 })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Stok belum dapat dimuat.' },
  );

  const stockByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory.items) map.set(item.productId, item.availableQuantity);
    return map;
  }, [inventory.items]);

  const source = salon ? services : products;
  const noun = salon ? 'layanan' : 'produk';
  const pagination = source.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const hasSearch = settledSearch.trim() !== '';

  // What the current filter narrows to, in words, or null when it narrows to
  // nothing. The name is briefly unknown between a reload starting and the
  // list arriving, but the filter is still on, so it still says so.
  const filteredBy = (() => {
    if (selected === CATEGORY_ALL) return null;
    if (selected === CATEGORY_NONE) return 'tanpa kategori';
    return selectedName === null ? 'kategori yang dipilih' : `kategori ${selectedName}`;
  })();

  const emptyTitle = (() => {
    if (filteredBy !== null && hasSearch) {
      return `Tidak ada ${noun} ${filteredBy} yang cocok dengan pencarian ini.`;
    }
    if (selected === CATEGORY_NONE) {
      return `Semua ${noun} aktif pada unit usaha ini sudah punya kategori.`;
    }
    if (filteredBy !== null) return `Belum ada ${noun} aktif pada ${filteredBy}.`;
    if (hasSearch) return 'Tidak ada hasil untuk pencarian ini.';
    return `Belum ada ${noun} aktif pada unit usaha ini.`;
  })();

  // The product query carries the category filter whether or not the names
  // loaded, so the failure notice has to describe the filter that is actually
  // in force rather than assume it was dropped.
  const categoryErrorNote = (error: string) => {
    if (selected === CATEGORY_ALL) {
      return `${error} Saringan kategori belum tersedia, dan daftar di bawah menampilkan semua ${noun}.`;
    }
    if (selected === CATEGORY_NONE) {
      return `${error} Saringan Tanpa kategori tetap berlaku pada daftar di bawah.`;
    }
    return `${error} Daftar di bawah tetap disaring menurut kategori yang dipilih, tetapi namanya belum dapat ditampilkan.`;
  };

  const availableFor = (product: Product): number | null => {
    if (!product.stockTracked) return null;
    const fromInventory = stockByProduct.get(product.id);
    if (typeof fromInventory === 'number') return fromInventory;
    if (typeof product.stockOnHand === 'number') {
      return product.stockOnHand - (product.reservedQuantity ?? 0);
    }
    return null;
  };

  return (
    <section className="checkout-catalog" aria-labelledby="catalog-heading">
      <h2 className="section-title" id="catalog-heading">
        {salon ? 'Layanan' : 'Produk'} · {line.name}
      </h2>

      <div className="catalog-toolbar">
        <div className="field catalog-search">
          <label className="field-label" htmlFor="catalog-search-input">
            Cari {noun}
          </label>
          <input
            id="catalog-search-input"
            className="input"
            type="search"
            value={search}
            autoComplete="off"
            placeholder={salon ? 'Nama layanan' : 'Nama atau SKU'}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {search !== '' ? (
          <button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>
            Hapus pencarian
          </button>
        ) : null}
      </div>

      {pickedGone ? (
        <Notice tone="warning" title="Kategori yang dipilih sudah tidak aktif" live="polite">
          <p className="meta">
            Kategori itu diarsipkan, jadi daftar ini kembali menampilkan semua produk.
          </p>
        </Notice>
      ) : null}

      {!salon && categories.error !== null ? (
        <ErrorBlock
          title="Daftar kategori belum dapat dimuat."
          message={categoryErrorNote(categories.error)}
          onRetry={categories.reload}
        />
      ) : null}

      {/* Semua and Tanpa kategori need no names, so the control survives a
          failed read; only the named rows go missing. */}
      {!salon && !categories.forbidden ? (
        <CategoryChips
          categories={categories.items}
          selected={selected}
          unnamedSelectedId={selectedUnnamed ? selected : null}
          onSelect={setPicked}
          loadMore={
            categories.complete || categories.error !== null
              ? null
              : {
                  remainingPages: categories.remainingPages,
                  loading: categories.loading,
                  onLoadMore: categories.loadMore,
                }
          }
        />
      ) : null}

      <div
        className="catalog-results"
        role="region"
        aria-label={`Pilihan ${noun}`}
        aria-busy={source.loading}
        tabIndex={0}
      >
      {isFull ? (
        <p className="field-error" role="status">
          Pesanan sudah memuat 100 jenis item. Selesaikan pesanan ini sebelum menambah item lain.
        </p>
      ) : null}

      {!salon && inventory.forbidden ? (
        <p className="meta">Jumlah stok tidak ditampilkan karena akun ini tidak memiliki akses stok.</p>
      ) : null}

      {/* Rows from the previous filter stay on screen while the next page
          loads, so the wait has to be announced and the rows have to stop
          accepting taps. Otherwise pressing a category and tapping straight
          away would add an item the new filter does not contain. */}
      {source.loading ? (
        <LoadingBlock
          label={source.initial ? `Memuat ${noun}…` : `Memperbarui daftar ${noun}…`}
        />
      ) : null}

      {source.forbidden ? (
        <EmptyBlock title={`Akun ini tidak memiliki akses ke daftar ${noun} unit usaha ini.`} />
      ) : null}

      {source.error !== null ? (
        <ErrorBlock
          title={`Daftar ${noun} belum dapat dimuat.`}
          message={source.error}
          onRetry={source.reload}
        />
      ) : null}

      {!source.loading && source.error === null && !source.forbidden && source.items.length === 0 ? (
        <EmptyBlock title={emptyTitle}>
          {hasSearch || filteredBy !== null ? (
            <div className="btn-row">
              {hasSearch ? (
                <button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>
                  Hapus pencarian
                </button>
              ) : null}
              {filteredBy !== null ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPicked(CATEGORY_ALL)}
                >
                  Tampilkan semua kategori
                </button>
              ) : null}
            </div>
          ) : null}
        </EmptyBlock>
      ) : null}

      {source.items.length > 0 ? (
        <ul className="catalog-grid">
          {salon
            ? services.items.map((service) => {
                const inOrder = quantityOf(service.id);
                const blocked = isFull && inOrder === 0;
                return (
                  <li key={service.id}>
                    <button
                      type="button"
                      className="catalog-item"
                      aria-label={`Tambah ${service.name} ke pesanan`}
                      data-selected={inOrder > 0}
                      disabled={blocked || locked || source.loading}
                      onClick={() =>
                        onAdd({
                          itemType: 'service',
                          itemId: service.id,
                          name: service.name,
                          unitPrice: service.price,
                          stockTracked: false,
                        })
                      }
                    >
                      <CatalogImage />
                      <span className="catalog-item-name">{service.name}</span>
                      {service.durationMinutes ? (
                        <span className="meta">{service.durationMinutes} menit</span>
                      ) : null}
                      <span className="catalog-item-foot">
                        <span className="catalog-item-price money">{rupiah(service.price)}</span>
                        {inOrder > 0 ? (
                          <span className="catalog-item-in-order">{inOrder} di pesanan</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            : products.items.map((product) => {
                const inOrder = quantityOf(product.id);
                const available = availableFor(product);
                const outOfStock = available !== null && available - inOrder <= 0;
                const blocked = outOfStock || (isFull && inOrder === 0);
                return (
                  <li key={product.id}>
                    <button
                      type="button"
                      className="catalog-item"
                      aria-label={`Tambah ${product.name} ke pesanan`}
                      data-selected={inOrder > 0}
                      disabled={blocked || locked || source.loading}
                      onClick={() =>
                        onAdd({
                          itemType: 'product',
                          itemId: product.id,
                          name: product.name,
                          unitPrice: product.price,
                          stockTracked: product.stockTracked,
                        })
                      }
                    >
                      <CatalogImage />
                      <span className="catalog-item-name">{product.name}</span>
                      <span className="catalog-item-meta meta">
                        {product.sku} · per {product.unit}
                      </span>
                      <span className="catalog-item-foot">
                        <span className="catalog-item-price money">{rupiah(product.price)}</span>
                        {product.stockTracked ? (
                          <span className="meta">
                            {available === null
                              ? 'Stok dilacak'
                              : outOfStock
                                ? 'Stok habis'
                                : `Sisa stok ${available - inOrder}`}
                          </span>
                        ) : null}
                        {inOrder > 0 ? (
                          <span className="catalog-item-in-order">{inOrder} di pesanan</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
        </ul>
      ) : null}

      </div>

      {pagination !== null && totalPages > 1 ? (
        <nav className="pager" aria-label={`Halaman daftar ${noun}`}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1 || source.loading}
          >
            Sebelumnya
          </button>
          <span className="meta" role="status">
            Halaman {pagination.page} dari {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || source.loading}
          >
            Berikutnya
          </button>
        </nav>
      ) : null}
    </section>
  );
}
