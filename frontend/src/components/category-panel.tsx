'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BusinessLine } from '@/lib/types';
import type { Category } from '@/hooks/use-categories';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge, WriteError } from './states';

const PAGE_SIZE = 20;
/** Matches the backend's limit, so the field never refuses a legal name. */
const NAME_MAX = 160;

const STATUS_FILTERS = [
  { value: 'active', label: 'Aktif', active: true as boolean | undefined },
  { value: 'archived', label: 'Diarsipkan', active: false as boolean | undefined },
  { value: 'all', label: 'Semua', active: undefined as boolean | undefined },
];

type CategoryPanelProps = {
  line: BusinessLine;
  /** Bumped by the screen after a product assignment changes a product count. */
  revision: number;
  /** Called after the server confirms a create, rename, archive or restore. */
  onChanged: () => void;
  onSessionExpired: () => void;
};

export function CategoryPanel({
  line,
  revision,
  onChanged,
  onSessionExpired,
}: CategoryPanelProps) {
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);

  // Counting this line's own confirmed writes into the filter key sends the
  // list back to page one after each of them. Archiving the only row on the
  // last page would otherwise leave the pager reading "halaman 3 dari 2".
  // A sibling panel's write bumps `revision` instead, which re-reads without
  // moving the page the user is on.
  const [writes, setWrites] = useState(0);
  const [page, setPage] = useFilteredPage(
    `${line.id}\u0000${status}\u0000${settledSearch}\u0000${writes}`,
  );

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<Category | null>(null);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const activeFilter = STATUS_FILTERS.find((entry) => entry.value === status)?.active;
  const list = usePaged<Category>(
    `/categories${buildQuery({
      businessLineId: line.id,
      active: activeFilter,
      search: settledSearch.trim() || undefined,
      page,
      limit: PAGE_SIZE,
    })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar kategori belum dapat dimuat.' },
  );

  // A product moving between categories changes the counts shown here, so the
  // list is re-read from the server rather than adjusted locally.
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

  /**
   * Applied after an uncertain write. The page the user is on is kept, since
   * nothing is known to have moved; the server is simply read again so the
   * row shows whatever actually happened.
   */
  const recheck = useCallback(
    (key: string) => () => {
      mutate.clear(key);
      reload();
      onChanged();
    },
    [mutate, reload, onChanged],
  );

  const createFailure = mutate.failureOf('create');
  const trimmedNew = newName.trim();
  const totalPages = list.pagination?.totalPages ?? 1;

  const create = async () => {
    if (trimmedNew === '') return;
    const ok = await mutate.run('create', async () => {
      await api<Category>(`/categories${buildQuery({ businessLineId: line.id })}`, {
        method: 'POST',
        body: JSON.stringify({ name: trimmedNew }),
      });
    });
    if (!ok) return;
    setNewName('');
    settle();
  };

  const rename = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const ok = await mutate.run(`rename:${id}`, async () => {
      await api<Category>(`/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
    });
    if (!ok) return;
    // Only close the editor that started this write. A slow response must not
    // close an editor the user has since opened on another row.
    setEditing((current) => (current !== null && current.id === id ? null : current));
    settle();
  };

  const archive = async (category: Category) => {
    const ok = await mutate.run(`archive:${category.id}`, async () => {
      await api<void>(`/categories/${category.id}`, { method: 'DELETE' });
    });
    // On a refusal the dialog stays open carrying the backend's reason, so the
    // category is never shown as archived when it is not.
    if (!ok) return;
    setArchiving((current) => (current !== null && current.id === category.id ? null : current));
    settle();
  };

  const restore = async (category: Category) => {
    const ok = await mutate.run(`restore:${category.id}`, async () => {
      await api<Category>(`/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
    });
    if (!ok) return;
    settle();
  };

  const archiveKey = archiving === null ? null : `archive:${archiving.id}`;
  const archiveFailure = archiveKey === null ? null : mutate.failureOf(archiveKey);
  const archiveBusy = archiveKey !== null && mutate.isPending(archiveKey);

  const closeArchive = () => {
    if (archiveKey !== null) mutate.clear(archiveKey);
    setArchiving(null);
  };

  return (
    <section className="katalog-pane" aria-labelledby="kategori-heading">
      <h2 className="section-title" id="kategori-heading">
        Kategori
      </h2>

      <form
        className="cat-create"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="kategori-baru">
            Nama kategori baru
          </label>
          <input
            id="kategori-baru"
            className="input"
            type="text"
            value={newName}
            maxLength={NAME_MAX}
            autoComplete="off"
            placeholder="Misalnya Minuman"
            aria-invalid={createFailure !== null ? true : undefined}
            onChange={(event) => setNewName(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary btn-tall"
          disabled={trimmedNew === '' || mutate.isPending('create')}
        >
          {mutate.isPending('create') ? 'Menyimpan…' : 'Tambah kategori'}
        </button>
        {createFailure !== null ? (
          <WriteError
            failure={createFailure}
            unchangedNote="Kategori baru belum dibuat."
            onRecheck={recheck('create')}
          />
        ) : null}
      </form>

      <div className="chip-row" role="group" aria-label="Saring kategori menurut status">
        {STATUS_FILTERS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="chip"
            aria-pressed={status === entry.value}
            onClick={() => setStatus(entry.value)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label className="field-label" htmlFor="kategori-cari">
          Cari kategori
        </label>
        <input
          id="kategori-cari"
          className="input"
          type="search"
          value={search}
          autoComplete="off"
          placeholder="Nama kategori"
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <p className="meta">
        Jumlah produk menghitung setiap produk yang ditugaskan ke kategori, termasuk produk
        nonaktif. Kategori hanya dapat diarsipkan setelah jumlahnya nol.
      </p>

      {list.loading ? (
        <LoadingBlock label={list.initial ? 'Memuat kategori…' : 'Memperbarui daftar kategori…'} />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke kategori unit usaha ini." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title="Daftar kategori belum dapat dimuat."
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {!list.loading && list.error === null && !list.forbidden && list.items.length === 0 ? (
        <EmptyBlock
          title={
            settledSearch.trim() !== ''
              ? 'Tidak ada kategori yang cocok dengan pencarian ini.'
              : status === 'archived'
                ? 'Belum ada kategori yang diarsipkan.'
                : 'Belum ada kategori pada unit usaha ini.'
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <ul className="cat-list" aria-busy={list.loading}>
          {list.items.map((category) => {
            const renameKey = `rename:${category.id}`;
            const restoreKey = `restore:${category.id}`;
            const renameFailure = mutate.failureOf(renameKey);
            const restoreFailure = mutate.failureOf(restoreKey);
            const isEditing = editing !== null && editing.id === category.id;

            return (
              <li className="cat-row" key={category.id}>
                {isEditing ? (
                  <form
                    className="cat-edit"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void rename(category.id, editing.name);
                    }}
                  >
                    <div className="field">
                      <label className="field-label" htmlFor={`kategori-nama-${category.id}`}>
                        Nama kategori
                      </label>
                      <input
                        id={`kategori-nama-${category.id}`}
                        className="input"
                        type="text"
                        value={editing.name}
                        maxLength={NAME_MAX}
                        autoComplete="off"
                        autoFocus
                        aria-invalid={renameFailure !== null ? true : undefined}
                        onChange={(event) => setEditing({ id: category.id, name: event.target.value })}
                      />
                    </div>
                    <div className="btn-row">
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={editing.name.trim() === '' || mutate.isPending(renameKey)}
                      >
                        {mutate.isPending(renameKey) ? 'Menyimpan…' : 'Simpan nama'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={mutate.isPending(renameKey)}
                        onClick={() => {
                          mutate.clear(renameKey);
                          setEditing(null);
                        }}
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <span className="cat-row-name">{category.name}</span>
                    <span className="meta cat-row-count">{category.productCount} produk</span>
                    {category.active ? null : <StatusBadge label="Diarsipkan" tone="neutral" />}
                    <span className="cat-row-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setEditing({ id: category.id, name: category.name })}
                      >
                        Ubah nama
                        <span className="sr-only"> kategori {category.name}</span>
                      </button>
                      {category.active ? (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => {
                            mutate.clear(`archive:${category.id}`);
                            setArchiving(category);
                          }}
                        >
                          Arsipkan
                          <span className="sr-only"> kategori {category.name}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={mutate.isPending(restoreKey)}
                          onClick={() => void restore(category)}
                        >
                          {mutate.isPending(restoreKey) ? 'Memulihkan…' : 'Pulihkan'}
                          <span className="sr-only"> kategori {category.name}</span>
                        </button>
                      )}
                    </span>
                  </>
                )}

                {renameFailure !== null ? (
                  <WriteError
                    failure={renameFailure}
                    unchangedNote={`Nama kategori masih ${category.name}.`}
                    onRecheck={recheck(renameKey)}
                  />
                ) : null}
                {restoreFailure !== null ? (
                  <WriteError
                    failure={restoreFailure}
                    unchangedNote="Kategori ini masih diarsipkan."
                    onRecheck={recheck(restoreKey)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {totalPages > 1 ? (
        <nav className="pager" aria-label="Halaman daftar kategori">
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

      {/* While the request is in flight the dialog cannot be dismissed. A
          dialog closed mid write would leave the answer with nowhere to go,
          and the user free to open another one over the top of it. */}
      <Dialog
        open={archiving !== null}
        title={archiving === null ? 'Arsipkan kategori' : `Arsipkan kategori ${archiving.name}?`}
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
          Kategori yang diarsipkan hilang dari filter kasir. Kategori tidak dihapus dan dapat
          dipulihkan lewat saringan Diarsipkan.
        </p>
        {archiving !== null ? (
          <p className="meta">
            Saat ini tercatat {archiving.productCount} produk pada kategori ini, termasuk produk
            nonaktif.
          </p>
        ) : null}
        {archiveFailure !== null && archiveKey !== null ? (
          <WriteError
            failure={archiveFailure}
            unchangedNote="Kategori ini belum diarsipkan."
            onRecheck={() => {
              mutate.clear(archiveKey);
              setArchiving(null);
              reload();
              onChanged();
            }}
          />
        ) : null}
      </Dialog>
    </section>
  );
}
