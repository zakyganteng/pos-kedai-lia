'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { BusinessLine, SalonService, ServiceInput, ServicePatch } from '@/lib/types';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import type { MutationFailure } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge, WriteError } from './states';

const PAGE_SIZE = 20;

/** Lengths the backend enforces, so a legal value is never refused here. */
const NAME_MAX = 160;
const DESCRIPTION_MAX = 1000;
const DURATION_MIN = 1;
const DURATION_MAX = 1440;
/** 1_000_000_000_000 is the documented ceiling: thirteen digits. */
const PRICE_DIGITS = 13;

const STATUS_FILTERS = [
  { value: 'active', label: 'Aktif', active: true as boolean | undefined },
  { value: 'archived', label: 'Diarsipkan', active: false as boolean | undefined },
  { value: 'all', label: 'Semua', active: undefined as boolean | undefined },
];

type Draft = {
  name: string;
  /** Empty means "no description", which the API stores as null. */
  description: string;
  /** Empty means "no duration", which the API stores as null. */
  duration: string;
  /** Digits only. Empty means "not filled in", which is not the same as 0. */
  price: string;
  active: boolean;
};

const BLANK: Draft = { name: '', description: '', duration: '', price: '', active: true };

function draftOf(service: SalonService): Draft {
  return {
    name: service.name,
    description: service.description ?? '',
    duration:
      typeof service.durationMinutes === 'number' ? String(service.durationMinutes) : '',
    price: String(service.price),
    active: service.active,
  };
}

function digitsOnly(value: string, max: number): string {
  return value.replace(/\D/g, '').slice(0, max);
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

type ServiceAdminPanelProps = {
  line: BusinessLine;
  onSessionExpired: () => void;
};

/**
 * Salon service administration: the list the kasir and the antrean both pick
 * from, with create, edit, archive and restore on top of it.
 *
 * Services have no categories. Duration is optional, so a service may simply
 * have no scheduled length, and the table says so in words rather than
 * showing a zero that would read as "instant".
 */
export function ServiceAdminPanel({ line, onSessionExpired }: ServiceAdminPanelProps) {
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);

  // Confirmed writes send the list back to page one, so archiving the last row
  // of the last page never leaves the pager reading "halaman 3 dari 2".
  const [writes, setWrites] = useState(0);
  const [page, setPage] = useFilteredPage(
    [line.id, status, settledSearch, String(writes)].join('\u0000'),
  );

  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>(BLANK);
  const [editing, setEditing] = useState<SalonService | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(BLANK);
  const [archiving, setArchiving] = useState<SalonService | null>(null);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const activeFilter = STATUS_FILTERS.find((entry) => entry.value === status)?.active;
  const list = usePaged<SalonService>(
    `/services${buildQuery({
      businessLineId: line.id,
      active: activeFilter,
      search: settledSearch.trim() || undefined,
      page,
      limit: PAGE_SIZE,
    })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar layanan belum dapat dimuat.' },
  );

  const reload = list.reload;

  const settle = useCallback(() => {
    setWrites((value) => value + 1);
    reload();
  }, [reload]);

  /** Applied after an uncertain write: keep the page, go and look. */
  const recheck = useCallback(
    (key: string) => () => {
      mutate.clear(key);
      reload();
    },
    [mutate, reload],
  );

  const durationValid = (draft: Draft) => {
    if (draft.duration === '') return true;
    const value = Number(draft.duration);
    return value >= DURATION_MIN && value <= DURATION_MAX;
  };

  const createFailure = mutate.failureOf('create');
  const createBusy = mutate.isPending('create');
  const createValid =
    createDraft.name.trim() !== '' && createDraft.price !== '' && durationValid(createDraft);

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
    const description = createDraft.description.trim();
    const body: ServiceInput = {
      name: createDraft.name.trim(),
      price: Number(createDraft.price),
      active: createDraft.active,
      // An empty field is an absent value, sent as null rather than as "".
      description: description === '' ? null : description,
      durationMinutes: createDraft.duration === '' ? null : Number(createDraft.duration),
    };

    const ok = await mutate.run('create', async () => {
      await api<SalonService>(`/services${buildQuery({ businessLineId: line.id })}`, {
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
  const editPatch = ((): ServicePatch => {
    if (editing === null) return {};
    const patch: ServicePatch = {};
    const name = editDraft.name.trim();
    const description = editDraft.description.trim();
    const currentDescription = editing.description ?? '';
    const currentDuration =
      typeof editing.durationMinutes === 'number' ? String(editing.durationMinutes) : '';

    if (name !== editing.name) patch.name = name;
    // Clearing the field is a real change: it sends null, not an empty string.
    if (description !== currentDescription) patch.description = description === '' ? null : description;
    if (editDraft.duration !== currentDuration) {
      patch.durationMinutes = editDraft.duration === '' ? null : Number(editDraft.duration);
    }
    if (editDraft.price !== '' && Number(editDraft.price) !== editing.price) {
      patch.price = Number(editDraft.price);
    }
    if (editDraft.active !== editing.active) patch.active = editDraft.active;
    return patch;
  })();

  const editValid =
    editDraft.name.trim() !== '' && editDraft.price !== '' && durationValid(editDraft);
  const editChanged = Object.keys(editPatch).length > 0;

  const openEdit = (service: SalonService) => {
    mutate.clear(`edit:${service.id}`);
    setEditing(service);
    setEditDraft(draftOf(service));
  };

  const closeEdit = () => {
    if (editKey !== null) mutate.clear(editKey);
    setEditing(null);
  };

  const saveEdit = async () => {
    if (editing === null || !editValid || !editChanged) return;
    const target = editing;
    const ok = await mutate.run(`edit:${target.id}`, async () => {
      await api<SalonService>(`/services/${target.id}`, {
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

  const archive = async (service: SalonService) => {
    const ok = await mutate.run(`archive:${service.id}`, async () => {
      await api<void>(`/services/${service.id}`, { method: 'DELETE' });
    });
    if (!ok) return;
    setArchiving((current) => (current !== null && current.id === service.id ? null : current));
    settle();
  };

  const restore = async (service: SalonService) => {
    const ok = await mutate.run(`restore:${service.id}`, async () => {
      await api<SalonService>(`/services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true } satisfies ServicePatch),
      });
    });
    if (!ok) return;
    settle();
  };

  return (
    <section className="stack" aria-labelledby="layanan-admin-heading">
      <h2 className="section-title" id="layanan-admin-heading">
        Layanan salon
      </h2>

      <p className="meta">
        Layanan salon tidak memakai kategori. Daftar ini yang muncul di halaman Kasir dan saat
        menambah antrean.
      </p>

      <div className="toolbar">
        <div className="toolbar-filters">
          <div className="field">
            <label className="field-label" htmlFor="layanan-cari">
              Cari layanan
            </label>
            <input
              id="layanan-cari"
              className="input"
              type="search"
              value={search}
              autoComplete="off"
              placeholder="Nama layanan"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="layanan-status">
              Status
            </label>
            <select
              id="layanan-status"
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
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-tall" onClick={openCreate}>
            Tambah layanan
          </button>
        </div>
      </div>

      {list.loading ? (
        <LoadingBlock label={list.initial ? 'Memuat layanan…' : 'Memperbarui daftar layanan…'} />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke daftar layanan unit usaha ini." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title="Daftar layanan belum dapat dimuat."
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {!list.loading && list.error === null && !list.forbidden && list.items.length === 0 ? (
        <EmptyBlock
          title={
            settledSearch.trim() !== ''
              ? 'Tidak ada layanan yang cocok dengan pencarian ini.'
              : status === 'archived'
                ? 'Belum ada layanan yang diarsipkan.'
                : 'Belum ada layanan pada unit usaha ini.'
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={list.loading}>
            <caption className="sr-only">Daftar layanan {line.name}</caption>
            <thead>
              <tr>
                <th scope="col">Nama</th>
                <th scope="col">Keterangan</th>
                <th scope="col" className="num">
                  Durasi
                </th>
                <th scope="col" className="num">
                  Harga
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="actions">
                  Tindakan
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((service) => {
                const restoreKey = `restore:${service.id}`;
                const restoreFailure = mutate.failureOf(restoreKey);
                const description = service.description ?? '';
                const duration =
                  typeof service.durationMinutes === 'number' ? service.durationMinutes : null;

                return (
                  <tr key={service.id}>
                    <td>
                      {service.name}
                      {restoreFailure !== null ? (
                        <WriteError
                          failure={restoreFailure}
                          unchangedNote="Layanan ini masih diarsipkan."
                          onRecheck={recheck(restoreKey)}
                        />
                      ) : null}
                    </td>
                    <td className={description === '' ? 'muted' : undefined}>
                      {description === '' ? 'Tanpa keterangan' : description}
                    </td>
                    <td className={duration === null ? 'num muted' : 'num'}>
                      {duration === null ? '—' : `${duration} menit`}
                    </td>
                    <td className="num money">{rupiah(service.price)}</td>
                    <td>
                      <StatusBadge
                        label={service.active ? 'Aktif' : 'Diarsipkan'}
                        tone={service.active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => openEdit(service)}
                      >
                        Ubah
                        <span className="sr-only"> layanan {service.name}</span>
                      </button>
                      {service.active ? (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => {
                            mutate.clear(`archive:${service.id}`);
                            setArchiving(service);
                          }}
                        >
                          Arsipkan
                          <span className="sr-only"> layanan {service.name}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={mutate.isPending(restoreKey)}
                          onClick={() => void restore(service)}
                        >
                          {mutate.isPending(restoreKey) ? 'Memulihkan…' : 'Pulihkan'}
                          <span className="sr-only"> layanan {service.name}</span>
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
        label="Halaman daftar layanan"
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />

      <Dialog
        open={creating}
        title="Tambah layanan"
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
              {createBusy ? 'Menyimpan…' : 'Simpan layanan'}
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
          <div className="field span-2">
            <label className="field-label" htmlFor="layanan-baru-nama">
              Nama layanan
            </label>
            <input
              id="layanan-baru-nama"
              className="input"
              type="text"
              value={createDraft.name}
              maxLength={NAME_MAX}
              autoComplete="off"
              placeholder="Potong rambut"
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, name: event.target.value }))
              }
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="layanan-baru-durasi">
              Durasi (menit)
            </label>
            <input
              id="layanan-baru-durasi"
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={createDraft.duration}
              aria-invalid={durationValid(createDraft) ? undefined : true}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, duration: digitsOnly(event.target.value, 4) }))
              }
            />
            <p className={durationValid(createDraft) ? 'field-hint' : 'field-error'}>
              Boleh dikosongkan. Jika diisi, antara {DURATION_MIN} dan {DURATION_MAX} menit.
            </p>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="layanan-baru-harga">
              Harga (Rp)
            </label>
            <input
              id="layanan-baru-harga"
              className="input input-money"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={createDraft.price}
              onChange={(event) =>
                setCreateDraft((draft) => ({
                  ...draft,
                  price: digitsOnly(event.target.value, PRICE_DIGITS),
                }))
              }
            />
            <p className="field-hint">
              Rupiah penuh tanpa titik.{' '}
              {createDraft.price === '' ? 'Belum diisi.' : rupiah(Number(createDraft.price))}
            </p>
          </div>

          <div className="field span-2">
            <label className="field-label" htmlFor="layanan-baru-keterangan">
              Keterangan
            </label>
            <textarea
              id="layanan-baru-keterangan"
              className="textarea"
              value={createDraft.description}
              maxLength={DESCRIPTION_MAX}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, description: event.target.value }))
              }
            />
            <p className="field-hint">
              Opsional, maksimal {DESCRIPTION_MAX} karakter. Dibaca staf saat memilih layanan.
            </p>
          </div>

          <div className="field span-2">
            <label className="check-row">
              <input
                type="checkbox"
                checked={createDraft.active}
                onChange={(event) =>
                  setCreateDraft((draft) => ({ ...draft, active: event.target.checked }))
                }
              />
              Layanan aktif
            </label>
            <p className="field-hint">
              Layanan nonaktif tidak muncul di halaman Kasir maupun saat menambah antrean.
            </p>
          </div>
        </form>

        {createFailure !== null ? (
          <>
            <WriteError
              failure={createFailure}
              unchangedNote="Layanan baru belum dibuat."
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
        title={editing === null ? 'Ubah layanan' : `Ubah layanan ${editing.name}`}
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
              <div className="field span-2">
                <label className="field-label" htmlFor="layanan-ubah-nama">
                  Nama layanan
                </label>
                <input
                  id="layanan-ubah-nama"
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
                <label className="field-label" htmlFor="layanan-ubah-durasi">
                  Durasi (menit)
                </label>
                <input
                  id="layanan-ubah-durasi"
                  className="input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={editDraft.duration}
                  aria-invalid={durationValid(editDraft) ? undefined : true}
                  onChange={(event) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      duration: digitsOnly(event.target.value, 4),
                    }))
                  }
                />
                <p className={durationValid(editDraft) ? 'field-hint' : 'field-error'}>
                  Kosongkan untuk menghapus durasi. Jika diisi, antara {DURATION_MIN} dan{' '}
                  {DURATION_MAX} menit.
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="layanan-ubah-harga">
                  Harga (Rp)
                </label>
                <input
                  id="layanan-ubah-harga"
                  className="input input-money"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={editDraft.price}
                  onChange={(event) =>
                    setEditDraft((draft) => ({
                      ...draft,
                      price: digitsOnly(event.target.value, PRICE_DIGITS),
                    }))
                  }
                />
                <p className="field-hint">
                  Harga baru hanya berlaku untuk penjualan berikutnya; struk lama tetap memakai
                  harga saat itu.
                </p>
              </div>

              <div className="field span-2">
                <label className="field-label" htmlFor="layanan-ubah-keterangan">
                  Keterangan
                </label>
                <textarea
                  id="layanan-ubah-keterangan"
                  className="textarea"
                  value={editDraft.description}
                  maxLength={DESCRIPTION_MAX}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, description: event.target.value }))
                  }
                />
                <p className="field-hint">
                  Kosongkan untuk menghapus keterangan. Maksimal {DESCRIPTION_MAX} karakter.
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
                  Layanan aktif
                </label>
                <p className="field-hint">
                  Layanan nonaktif hilang dari Kasir dan Antrean, tetapi tetap tercatat pada struk
                  lama.
                </p>
              </div>
            </form>

            {!editChanged ? <p className="meta">Belum ada perubahan untuk disimpan.</p> : null}

            {editFailure !== null && editKey !== null ? (
              <>
                <WriteError
                  failure={editFailure}
                  unchangedNote={`Layanan ${editing.name} belum berubah.`}
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
        title={archiving === null ? 'Arsipkan layanan' : `Arsipkan layanan ${archiving.name}?`}
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
          Layanan yang diarsipkan hilang dari halaman Kasir dan dari pilihan antrean. Layanan tidak
          dihapus: struk lama tetap memuatnya, dan layanan dapat dipulihkan lewat saringan
          Diarsipkan.
        </p>
        {archiveFailure !== null && archiveKey !== null ? (
          <WriteError
            failure={archiveFailure}
            unchangedNote="Layanan ini belum diarsipkan."
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
