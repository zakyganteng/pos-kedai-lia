'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { count, rupiah } from '@/lib/format';
import type { BusinessLine, Product, ProductInput, ProductPatch } from '@/lib/types';
import type { AllCategoriesResult } from '@/hooks/use-categories';
import {
  CATEGORY_ALL,
  CATEGORY_NONE,
  categoryIdOf,
  categoryQuery,
} from '@/hooks/use-categories';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import type { MutationFailure } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge, WriteError } from './states';

const PAGE_SIZE = 20;

/** Lengths the backend enforces, so a legal value is never refused here. */
const SKU_MAX = 80;
const NAME_MAX = 160;
const UNIT_MAX = 40;
/** 1_000_000_000_000 is the documented ceiling: thirteen digits. */
const PRICE_DIGITS = 13;

/** Select value standing for "no category". Empty string, never a real id. */
const UNASSIGNED = '';

const STATUS_FILTERS = [
  { value: 'active', label: 'Aktif', active: true as boolean | undefined },
  { value: 'archived', label: 'Diarsipkan', active: false as boolean | undefined },
  { value: 'all', label: 'Semua', active: undefined as boolean | undefined },
];

type Draft = {
  sku: string;
  name: string;
  unit: string;
  /** Digits only. Empty means "not filled in", which is not the same as 0. */
  price: string;
  stockTracked: boolean;
  /** '' is "tanpa kategori"; anything else is a category id. */
  categoryId: string;
  active: boolean;
};

const BLANK: Draft = {
  sku: '',
  name: '',
  unit: '',
  price: '',
  stockTracked: false,
  categoryId: UNASSIGNED,
  active: true,
};

function draftOf(product: Product): Draft {
  return {
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    price: String(product.price),
    stockTracked: product.stockTracked,
    categoryId: categoryIdOf(product) ?? UNASSIGNED,
    active: product.active,
  };
}

/** Strips everything that is not a digit, so the field only ever holds money. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, PRICE_DIGITS);
}

/** Field level messages the backend attached to a refusal. */
function FieldErrors({ failure }: { failure: MutationFailure | null }) {
  if (failure === null || failure.fieldErrors.length === 0) return null;
  return (
    <ul className="stack-sm">
      {failure.fieldErrors.map((entry) => (
        <li className="field-error" key={`${entry.field}:${entry.message}`}>
          {entry.field}: {entry.message}
        </li>
      ))}
    </ul>
  );
}

type ProductAdminPanelProps = {
  line: BusinessLine;
  /** Every category of this line, active and archived. */
  catalogue: AllCategoriesResult;
  /** Bumped by the screen after a category is renamed, archived or restored. */
  revision: number;
  /** Called after the server confirms a write that moves a category count. */
  onChanged: () => void;
  onSessionExpired: () => void;
};

/**
 * Product administration for one food and beverage line: the list the kasir
 * reads from, with create, edit, archive and restore on top of it.
 *
 * Nothing is kept locally after a write. Every confirmed change re-reads the
 * page, so what the table shows is what the server would answer now.
 */
export function ProductAdminPanel({
  line,
  catalogue,
  revision,
  onChanged,
  onSessionExpired,
}: ProductAdminPanelProps) {
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);

  // This panel's own confirmed writes go back to page one: archiving the last
  // row of the last page would otherwise read "halaman 3 dari 2". A sibling
  // panel's write bumps `revision` instead, which re-reads in place.
  const [writes, setWrites] = useState(0);
  const [page, setPage] = useFilteredPage(
    [line.id, status, category, settledSearch, String(writes)].join('\u0000'),
  );

  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>(BLANK);
  const [editing, setEditing] = useState<Product | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(BLANK);
  const [archiving, setArchiving] = useState<Product | null>(null);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const activeFilter = STATUS_FILTERS.find((entry) => entry.value === status)?.active;
  const list = usePaged<Product>(
    `/products${buildQuery({
      businessLineId: line.id,
      active: activeFilter,
      search: settledSearch.trim() || undefined,
      ...categoryQuery(category),
      page,
      limit: PAGE_SIZE,
    })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar produk belum dapat dimuat.' },
  );

  // A rename on the category panel changes the labels shown in this table, so
  // the rows are re-read rather than relabelled from a stale copy.
  const reload = list.reload;
  useEffect(() => {
    if (revision === 0) return;
    reload();
  }, [revision, reload]);

  /** Applied after a confirmed write: back to page one and re-read. */
  const settle = useCallback(() => {
    setWrites((value) => value + 1);
    reload();
    onChanged();
  }, [reload, onChanged]);

  /** Applied after an uncertain write: keep the page, go and look. */
  const recheck = useCallback(
    (key: string) => () => {
      mutate.clear(key);
      reload();
      onChanged();
    },
    [mutate, reload, onChanged],
  );

  const assignable = catalogue.items.filter((entry) => entry.active);
  const categoriesPending = catalogue.error === null && catalogue.initial;

  const nameOfCategory = (product: Product): { label: string; archived: boolean } | null => {
    const id = categoryIdOf(product);
    if (id === null) return null;
    const found = catalogue.byId.get(id);
    if (found === undefined) {
      return { label: catalogue.complete ? 'Kategori tidak dikenal' : 'Belum dimuat', archived: false };
    }
    return { label: found.name, archived: !found.active };
  };

  /**
   * The option a product already holds, when it is archived or sits on a page
   * of categories that has not been read. A select must be able to show the
   * value the record actually has.
   */
  const extraOption = (current: string): { id: string; label: string } | null => {
    if (current === UNASSIGNED) return null;
    const found = catalogue.byId.get(current);
    if (found === undefined) return { id: current, label: 'Kategori ini belum dimuat' };
    if (!found.active) return { id: current, label: `${found.name} (diarsipkan)` };
    return null;
  };

  const createFailure = mutate.failureOf('create');
  const createBusy = mutate.isPending('create');
  const createValid =
    createDraft.sku.trim() !== '' &&
    createDraft.name.trim() !== '' &&
    createDraft.unit.trim() !== '' &&
    createDraft.price !== '';

  const openCreate = () => {
    mutate.clear('create');
    setCreateDraft(BLANK);
    setCreating(true);
  };

  const closeCreate = () => {
    mutate.clear('create');
    setCreating(false);
  };

  const create = async () => {
    if (!createValid) return;
    const body: ProductInput = {
      sku: createDraft.sku.trim(),
      name: createDraft.name.trim(),
      unit: createDraft.unit.trim(),
      price: Number(createDraft.price),
      stockTracked: createDraft.stockTracked,
    };
    if (createDraft.categoryId !== UNASSIGNED) body.categoryId = createDraft.categoryId;

    const ok = await mutate.run('create', async () => {
      await api<Product>(`/products${buildQuery({ businessLineId: line.id })}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    });
    if (!ok) return;
    setCreating(false);
    setCreateDraft(BLANK);
    settle();
  };

  const editKey = editing === null ? null : `edit:${editing.id}`;
  const editFailure = editKey === null ? null : mutate.failureOf(editKey);
  const editBusy = editKey !== null && mutate.isPending(editKey);

  /** Only the fields that actually moved. PATCH requires at least one. */
  const editPatch = ((): ProductPatch => {
    if (editing === null) return {};
    const patch: ProductPatch = {};
    const sku = editDraft.sku.trim();
    const name = editDraft.name.trim();
    const unit = editDraft.unit.trim();
    if (sku !== editing.sku) patch.sku = sku;
    if (name !== editing.name) patch.name = name;
    if (unit !== editing.unit) patch.unit = unit;
    if (editDraft.price !== '' && Number(editDraft.price) !== editing.price) {
      patch.price = Number(editDraft.price);
    }
    if (editDraft.stockTracked !== editing.stockTracked) patch.stockTracked = editDraft.stockTracked;
    if (editDraft.active !== editing.active) patch.active = editDraft.active;
    if (editDraft.categoryId !== (categoryIdOf(editing) ?? UNASSIGNED)) {
      patch.categoryId = editDraft.categoryId === UNASSIGNED ? null : editDraft.categoryId;
    }
    return patch;
  })();

  const editValid =
    editDraft.sku.trim() !== '' &&
    editDraft.name.trim() !== '' &&
    editDraft.unit.trim() !== '' &&
    editDraft.price !== '';
  const editChanged = Object.keys(editPatch).length > 0;

  const openEdit = (product: Product) => {
    mutate.clear(`edit:${product.id}`);
    setEditing(product);
    setEditDraft(draftOf(product));
  };

  const closeEdit = () => {
    if (editKey !== null) mutate.clear(editKey);
    setEditing(null);
  };

  const saveEdit = async () => {
    if (editing === null || !editValid || !editChanged) return;
    const target = editing;
    const ok = await mutate.run(`edit:${target.id}`, async () => {
      await api<Product>(`/products/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editPatch),
      });
    });
    if (!ok) return;
    // Only close the editor that started this write.
    setEditing((current) => (current !== null && current.id === target.id ? null : current));
    settle();
  };

  const archiveKey = archiving === null ? null : `archive:${archiving.id}`;
  const archiveFailure = archiveKey === null ? null : mutate.failureOf(archiveKey);
  const archiveBusy = archiveKey !== null && mutate.isPending(archiveKey);

  const closeArchive = () => {
    if (archiveKey !== null) mutate.clear(archiveKey);
    setArchiving(null);
  };

  const archive = async (product: Product) => {
    const ok = await mutate.run(`archive:${product.id}`, async () => {
      await api<void>(`/products/${product.id}`, { method: 'DELETE' });
    });
    // A refusal keeps the dialog open carrying the reason, so the row is never
    // shown as archived while it is not.
    if (!ok) return;
    setArchiving((current) => (current !== null && current.id === product.id ? null : current));
    settle();
  };

  const restore = async (product: Product) => {
    const ok = await mutate.run(`restore:${product.id}`, async () => {
      await api<Product>(`/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true } satisfies ProductPatch),
      });
    });
    if (!ok) return;
    settle();
  };

  /** Assignable categories, plus whatever value the record already holds. */
  const categoryOptions = (current: string) => {
    const extra = extraOption(current);
    return (
      <>
        <option value={UNASSIGNED}>Tanpa kategori</option>
        {extra !== null ? <option value={extra.id}>{extra.label}</option> : null}
        {assignable.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </>
    );
  };

  return (
    <section className="stack" aria-labelledby="produk-admin-heading">
      <h2 className="section-title" id="produk-admin-heading">
        Produk
      </h2>

      <div className="toolbar">
        <div className="toolbar-filters">
          <div className="field">
            <label className="field-label" htmlFor="produk-admin-cari">
              Cari produk
            </label>
            <input
              id="produk-admin-cari"
              className="input"
              type="search"
              value={search}
              autoComplete="off"
              placeholder="Nama atau SKU"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="produk-admin-status">
              Status
            </label>
            <select
              id="produk-admin-status"
              className="select"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {STATUS_FILTERS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="produk-admin-kategori">
              Kategori
            </label>
            <select
              id="produk-admin-kategori"
              className="select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value={CATEGORY_ALL}>Semua kategori</option>
              <option value={CATEGORY_NONE}>Tanpa kategori</option>
              {catalogue.items.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.active ? entry.name : `${entry.name} (diarsipkan)`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-tall" onClick={openCreate}>
            Tambah produk
          </button>
        </div>
      </div>

      {catalogue.error !== null ? (
        <ErrorBlock
          title="Daftar kategori belum dapat dimuat."
          message={`${catalogue.error} Nama kategori dan saringannya belum dapat ditampilkan.`}
          onRetry={catalogue.reload}
        />
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
            settledSearch.trim() !== '' || category !== CATEGORY_ALL
              ? 'Tidak ada produk yang cocok dengan saringan ini.'
              : status === 'archived'
                ? 'Belum ada produk yang diarsipkan.'
                : 'Belum ada produk pada unit usaha ini.'
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={list.loading}>
            <caption className="sr-only">Daftar produk {line.name}</caption>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Nama</th>
                <th scope="col">Kategori</th>
                <th scope="col">Satuan</th>
                <th scope="col" className="num">
                  Harga
                </th>
                <th scope="col">Stok</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions">
                  Tindakan
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((product) => {
                const restoreKey = `restore:${product.id}`;
                const restoreFailure = mutate.failureOf(restoreKey);
                const label = nameOfCategory(product);
                const onHand = product.stockOnHand ?? 0;
                const reserved = product.reservedQuantity ?? 0;

                return (
                  <tr key={product.id}>
                    <td className="mono">{product.sku}</td>
                    <td>
                      {product.name}
                      {restoreFailure !== null ? (
                        <WriteError
                          failure={restoreFailure}
                          unchangedNote="Produk ini masih diarsipkan."
                          onRecheck={recheck(restoreKey)}
                        />
                      ) : null}
                    </td>
                    <td className={label === null ? 'muted' : undefined}>
                      {label === null
                        ? 'Tanpa kategori'
                        : label.archived
                          ? `${label.label} (diarsipkan)`
                          : label.label}
                    </td>
                    <td>{product.unit}</td>
                    <td className="num money">{rupiah(product.price)}</td>
                    <td>
                      {product.stockTracked ? (
                        <>
                          Dilacak
                          <span className="meta">
                            {' '}
                            {count(onHand)} di tangan · {count(reserved)} dipesan
                          </span>
                        </>
                      ) : (
                        <span className="muted">Tidak dilacak</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge
                        label={product.active ? 'Aktif' : 'Diarsipkan'}
                        tone={product.active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => openEdit(product)}
                      >
                        Ubah
                        <span className="sr-only"> produk {product.name}</span>
                      </button>
                      {product.active ? (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => {
                            mutate.clear(`archive:${product.id}`);
                            setArchiving(product);
                          }}
                        >
                          Arsipkan
                          <span className="sr-only"> produk {product.name}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={mutate.isPending(restoreKey)}
                          onClick={() => void restore(product)}
                        >
                          {mutate.isPending(restoreKey) ? 'Memulihkan…' : 'Pulihkan'}
                          <span className="sr-only"> produk {product.name}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pager
        label="Halaman daftar produk"
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />

      <Dialog
        open={creating}
        title="Tambah produk"
        description="Produk baru langsung aktif dan muncul di halaman Kasir."
        onClose={createBusy ? undefined : closeCreate}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={createBusy}
              onClick={closeCreate}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={createBusy || !createValid}
              onClick={() => void create()}
            >
              {createBusy ? 'Menyimpan…' : 'Simpan produk'}
            </button>
          </>
        }
      >
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="produk-baru-sku">
              SKU
            </label>
            <input
              id="produk-baru-sku"
              className="input"
              type="text"
              value={createDraft.sku}
              maxLength={SKU_MAX}
              autoComplete="off"
              placeholder="MENU-KOPI-SUSU"
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, sku: event.target.value }))
              }
            />
            <p className="field-hint">Kode unik di unit usaha ini, maksimal {SKU_MAX} karakter.</p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="produk-baru-nama">
              Nama produk
            </label>
            <input
              id="produk-baru-nama"
              className="input"
              type="text"
              value={createDraft.name}
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder="Kopi susu"
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, name: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="produk-baru-satuan">
              Satuan
            </label>
            <input
              id="produk-baru-satuan"
              className="input"
              type="text"
              value={createDraft.unit}
              maxLength={UNIT_MAX}
              autoComplete="off"
              placeholder="gelas"
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, unit: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="produk-baru-harga">
              Harga (Rp)
            </label>
            <input
              id="produk-baru-harga"
              className="input input-money"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={createDraft.price}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, price: digitsOnly(event.target.value) }))
              }
            />
            <p className="field-hint">
              Rupiah penuh tanpa titik. {createDraft.price === '' ? 'Belum diisi.' : rupiah(Number(createDraft.price))}
            </p>
          </div>

          <div className="field span-2">
            <label className="field-label" htmlFor="produk-baru-kategori">
              Kategori
            </label>
            <select
              id="produk-baru-kategori"
              className="select"
              value={createDraft.categoryId}
              disabled={categoriesPending}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, categoryId: event.target.value }))
              }
            >
              {categoryOptions(createDraft.categoryId)}
            </select>
            <p className="field-hint">
              {categoriesPending
                ? 'Daftar kategori masih dimuat.'
                : 'Hanya kategori aktif yang dapat dipilih. Produk boleh tanpa kategori.'}
            </p>
          </div>

          <div className="field span-2">
            <label className="check-row">
              <input
                type="checkbox"
                checked={createDraft.stockTracked}
                onChange={(event) =>
                  setCreateDraft((draft) => ({ ...draft, stockTracked: event.target.checked }))
                }
              />
              Lacak stok produk ini
            </label>
            <p className="field-hint">
              Produk berstok dipesan dari halaman Stok dan ketersediaannya dikurangi tiap
              penjualan. Setelah produk punya stok atau pesanan, pilihan ini tidak dapat diubah
              lagi.
            </p>
          </div>
        </form>

        {createFailure !== null ? (
          <>
            <WriteError
              failure={createFailure}
              unchangedNote="Produk baru belum dibuat."
              onRecheck={() => {
                mutate.clear('create');
                setCreating(false);
                setCreateDraft(BLANK);
                settle();
              }}
            />
            <FieldErrors failure={createFailure} />
          </>
        ) : null}
      </Dialog>

      <Dialog
        open={editing !== null}
        title={editing === null ? 'Ubah produk' : `Ubah produk ${editing.name}`}
        onClose={editBusy ? undefined : closeEdit}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={editBusy}
              onClick={closeEdit}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={editBusy || !editValid || !editChanged}
              onClick={() => void saveEdit()}
            >
              {editBusy ? 'Menyimpan…' : 'Simpan perubahan'}
            </button>
          </>
        }
      >
        {editing !== null ? (
          <>
            <form
              className="form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                void saveEdit();
              }}
            >
              <div className="field">
                <label className="field-label" htmlFor="produk-ubah-sku">
                  SKU
                </label>
                <input
                  id="produk-ubah-sku"
                  className="input"
                  type="text"
                  value={editDraft.sku}
                  maxLength={SKU_MAX}
                  autoComplete="off"
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, sku: event.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="produk-ubah-nama">
                  Nama produk
                </label>
                <input
                  id="produk-ubah-nama"
                  className="input"
                  type="text"
                  value={editDraft.name}
                  maxLength={NAME_MAX}
                  autoComplete="off"
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, name: event.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="produk-ubah-satuan">
                  Satuan
                </label>
                <input
                  id="produk-ubah-satuan"
                  className="input"
                  type="text"
                  value={editDraft.unit}
                  maxLength={UNIT_MAX}
                  autoComplete="off"
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, unit: event.target.value }))
                  }
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="produk-ubah-harga">
                  Harga (Rp)
                </label>
                <input
                  id="produk-ubah-harga"
                  className="input input-money"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={editDraft.price}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, price: digitsOnly(event.target.value) }))
                  }
                />
                <p className="field-hint">
                  Harga baru hanya berlaku untuk penjualan berikutnya; struk lama tetap memakai
                  harga saat itu.
                </p>
              </div>

              <div className="field span-2">
                <label className="field-label" htmlFor="produk-ubah-kategori">
                  Kategori
                </label>
                <select
                  id="produk-ubah-kategori"
                  className="select"
                  value={editDraft.categoryId}
                  disabled={categoriesPending}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, categoryId: event.target.value }))
                  }
                >
                  {categoryOptions(editDraft.categoryId)}
                </select>
              </div>

              <div className="field span-2">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={editDraft.stockTracked}
                    onChange={(event) =>
                      setEditDraft((draft) => ({ ...draft, stockTracked: event.target.checked }))
                    }
                  />
                  Lacak stok produk ini
                </label>
                <p className="field-hint">
                  Pelacakan stok hanya dapat diubah selama stok di tangan dan jumlah dipesan
                  keduanya nol. Saat ini tercatat {count(editing.stockOnHand ?? 0)} di tangan dan{' '}
                  {count(editing.reservedQuantity ?? 0)} dipesan; jika bukan nol, server menolak
                  perubahan ini.
                </p>
              </div>

              <div className="field span-2">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={editDraft.active}
                    onChange={(event) =>
                      setEditDraft((draft) => ({ ...draft, active: event.target.checked }))
                    }
                  />
                  Produk aktif
                </label>
                <p className="field-hint">
                  Produk nonaktif hilang dari halaman Kasir tetapi tetap tercatat pada struk lama.
                </p>
              </div>
            </form>

            {!editChanged ? <p className="meta">Belum ada perubahan untuk disimpan.</p> : null}

            {editFailure !== null && editKey !== null ? (
              <>
                <WriteError
                  failure={editFailure}
                  unchangedNote={`Produk ${editing.name} belum berubah.`}
                  onRecheck={() => {
                    mutate.clear(editKey);
                    setEditing(null);
                    settle();
                  }}
                />
                <FieldErrors failure={editFailure} />
              </>
            ) : null}
          </>
        ) : null}
      </Dialog>

      <Dialog
        open={archiving !== null}
        title={archiving === null ? 'Arsipkan produk' : `Arsipkan produk ${archiving.name}?`}
        onClose={archiveBusy ? undefined : closeArchive}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={archiveBusy}
              onClick={closeArchive}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={archiveBusy}
              onClick={() => {
                if (archiving !== null) void archive(archiving);
              }}
            >
              {archiveBusy ? 'Mengarsipkan…' : 'Arsipkan'}
            </button>
          </>
        }
      >
        <p>
          Produk yang diarsipkan hilang dari halaman Kasir. Produk tidak dihapus: struk lama tetap
          memuatnya, dan produk dapat dipulihkan lewat saringan Diarsipkan.
        </p>
        {archiving !== null && archiving.stockTracked ? (
          <p className="meta">
            Stok tercatat {count(archiving.stockOnHand ?? 0)} di tangan dan{' '}
            {count(archiving.reservedQuantity ?? 0)} dipesan.
          </p>
        ) : null}
        {archiveFailure !== null && archiveKey !== null ? (
          <WriteError
            failure={archiveFailure}
            unchangedNote="Produk ini belum diarsipkan."
            onRecheck={() => {
              mutate.clear(archiveKey);
              setArchiving(null);
              settle();
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}
