'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { BusinessLine } from '@/lib/types';
import type { MutationFailure } from '@/hooks/use-mutation';
import { useMutation } from '@/hooks/use-mutation';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge, WriteError } from './states';

const PAGE_SIZE = 20;
/** The backend refuses a name longer than this, so the field stops there too. */
const NAME_MAX = 160;
/** Phone is stored normalized to E.164; the raw field is bounded the same way. */
const PHONE_MAX = 40;

const STATUS_FILTERS = [
  { value: 'active', label: 'Aktif', active: true as boolean | undefined },
  { value: 'archived', label: 'Diarsipkan', active: false as boolean | undefined },
  { value: 'all', label: 'Semua', active: undefined as boolean | undefined },
] as const;

/**
 * Shape shared by `/customers` and `/staff`. Staff never carry a phone, which
 * is why the field is optional rather than nullable-but-present.
 */
export type PersonRecord = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  phone?: string | null;
};

type PersonAdminProps = {
  line: BusinessLine;
  /** Collection path exactly as in openapi.yaml, e.g. `/customers`. */
  resource: string;
  /** Lowercase singular noun used in every label, e.g. `pelanggan`. */
  noun: string;
  /** Prefix for DOM ids and storage-free state keys. */
  idPrefix: string;
  /** Customers carry a phone number; staff do not. */
  withPhone: boolean;
  /** The backend lets this role create a record here. */
  canCreate: boolean;
  /** The backend lets this role rename, archive and restore (owner/admin). */
  canEdit: boolean;
  onSessionExpired: () => void;
};

/** "pelanggan" → "Pelanggan", for sentence-leading copy. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function FieldErrors({ failure }: { failure: MutationFailure }) {
  if (failure.fieldErrors.length === 0) return null;
  return (
    <ul className="field-error">
      {failure.fieldErrors.map((entry) => (
        <li key={`${entry.field}:${entry.message}`}>
          {entry.field}: {entry.message}
        </li>
      ))}
    </ul>
  );
}

/**
 * A duplicate phone is the only conflict these endpoints raise, and the
 * backend reports it as a bare "Duplicate record". Saying which field
 * collided is the difference between a usable message and a dead end.
 */
function DuplicateHint({ failure, withPhone }: { failure: MutationFailure; withPhone: boolean }) {
  if (!withPhone || failure.status !== 409) return null;
  return (
    <p className="field-error">
      Nomor telepon ini sudah dipakai pelanggan lain pada unit usaha ini. Nomor telepon harus unik:
      periksa daftar dengan saringan Semua, atau kosongkan nomor telepon.
    </p>
  );
}

/**
 * List, search, create, rename, archive and restore for a per-line roster of
 * people. `/customers` and `/staff` are the same resource with two
 * differences the backend itself draws: customers have a phone number, and a
 * cashier may create a customer but not a staff member.
 */
export function PersonAdmin({
  line,
  resource,
  noun,
  idPrefix,
  withPhone,
  canCreate,
  canEdit,
  onSessionExpired,
}: PersonAdminProps) {
  const [status, setStatus] = useState<string>('active');
  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);

  // Confirmed writes count into the filter key so the list returns to page one
  // after each of them: archiving the last row of the last page would
  // otherwise leave the pager reading "halaman 3 dari 2".
  const [writes, setWrites] = useState(0);
  const [page, setPage] = useFilteredPage(
    `${line.id}\u0000${status}\u0000${settledSearch}\u0000${writes}`,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [editing, setEditing] = useState<PersonRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [archiving, setArchiving] = useState<PersonRecord | null>(null);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const activeFilter = STATUS_FILTERS.find((entry) => entry.value === status)?.active;
  const list = usePaged<PersonRecord>(
    `${resource}${buildQuery({
      businessLineId: line.id,
      active: activeFilter,
      search: settledSearch.trim() || undefined,
      page,
      limit: PAGE_SIZE,
    })}`,
    {
      onUnauthorized: onSessionExpired,
      errorMessage: `Daftar ${noun} belum dapat dimuat.`,
    },
  );

  const reload = list.reload;

  /** Applied after the server confirms a write: back to page one, then re-read. */
  const settle = useCallback(() => {
    setWrites((value) => value + 1);
    reload();
  }, [reload]);

  /** Applied after an uncertain write: keep the page, go and look at the server. */
  const recheck = useCallback(
    (key: string) => () => {
      mutate.clear(key);
      reload();
    },
    [mutate, reload],
  );

  const createFailure = mutate.failureOf('create');
  const createBusy = mutate.isPending('create');

  const closeCreate = () => {
    mutate.clear('create');
    setCreateOpen(false);
  };

  const create = async () => {
    const name = createName.trim();
    if (name === '') return;
    const phone = createPhone.trim();
    const body: Record<string, unknown> = { name, active: true };
    if (withPhone && phone !== '') body.phone = phone;

    const ok = await mutate.run('create', async () => {
      await api<PersonRecord>(`${resource}${buildQuery({ businessLineId: line.id })}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    });
    if (!ok) return;
    setCreateName('');
    setCreatePhone('');
    setCreateOpen(false);
    settle();
  };

  const openEdit = (person: PersonRecord) => {
    mutate.clear(`edit:${person.id}`);
    setEditing(person);
    setEditName(person.name);
    setEditPhone(person.phone ?? '');
  };

  const editKey = editing === null ? null : `edit:${editing.id}`;
  const editFailure = editKey === null ? null : mutate.failureOf(editKey);
  const editBusy = editKey !== null && mutate.isPending(editKey);

  const closeEdit = () => {
    if (editKey !== null) mutate.clear(editKey);
    setEditing(null);
  };

  const saveEdit = async (person: PersonRecord) => {
    const name = editName.trim();
    if (name === '') return;
    const body: Record<string, unknown> = { name };
    if (withPhone) {
      // An emptied field means "no phone number", which the backend accepts
      // as an explicit null rather than an omitted key.
      const phone = editPhone.trim();
      body.phone = phone === '' ? null : phone;
    }
    const ok = await mutate.run(`edit:${person.id}`, async () => {
      await api<PersonRecord>(`${resource}/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    });
    if (!ok) return;
    setEditing((current) => (current !== null && current.id === person.id ? null : current));
    settle();
  };

  const archiveKey = archiving === null ? null : `archive:${archiving.id}`;
  const archiveFailure = archiveKey === null ? null : mutate.failureOf(archiveKey);
  const archiveBusy = archiveKey !== null && mutate.isPending(archiveKey);

  const closeArchive = () => {
    if (archiveKey !== null) mutate.clear(archiveKey);
    setArchiving(null);
  };

  const archive = async (person: PersonRecord) => {
    const ok = await mutate.run(`archive:${person.id}`, async () => {
      await api<void>(`${resource}/${person.id}`, { method: 'DELETE' });
    });
    // On a refusal the dialog stays open carrying the backend's reason, so a
    // record is never drawn as archived when it is not.
    if (!ok) return;
    setArchiving((current) => (current !== null && current.id === person.id ? null : current));
    settle();
  };

  const restore = async (person: PersonRecord) => {
    const ok = await mutate.run(`restore:${person.id}`, async () => {
      await api<PersonRecord>(`${resource}/${person.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
    });
    if (!ok) return;
    settle();
  };

  const searching = settledSearch.trim() !== '';
  const showEmpty =
    !list.loading && list.error === null && !list.forbidden && list.items.length === 0;

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-filters">
          <div className="field">
            <label className="field-label" htmlFor={`${idPrefix}-cari`}>
              Cari {noun}
            </label>
            <input
              id={`${idPrefix}-cari`}
              className="input"
              type="search"
              autoComplete="off"
              value={search}
              maxLength={100}
              placeholder={withPhone ? 'Nama atau nomor telepon' : 'Nama'}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div
            className="chip-row"
            role="group"
            aria-label={`Saring ${noun} menurut status`}
          >
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
        </div>

        {canCreate ? (
          <button
            type="button"
            className="btn btn-primary btn-tall"
            onClick={() => {
              mutate.clear('create');
              setCreateOpen(true);
            }}
          >
            Tambah {noun}
          </button>
        ) : null}
      </div>

      {list.loading ? (
        <LoadingBlock
          label={list.initial ? `Memuat ${noun}…` : `Memperbarui daftar ${noun}…`}
        />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title={`Akun ini tidak memiliki akses ke data ${noun} unit usaha ini.`} />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title={`Daftar ${noun} belum dapat dimuat.`}
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {showEmpty ? (
        <EmptyBlock
          title={
            searching
              ? `Tidak ada ${noun} yang cocok dengan pencarian ini.`
              : status === 'archived'
                ? `Belum ada ${noun} yang diarsipkan.`
                : `Belum ada ${noun} pada unit usaha ini.`
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={list.loading}>
            <caption className="sr-only">Daftar {noun} unit usaha {line.name}</caption>
            <thead>
              <tr>
                <th scope="col">Nama</th>
                {withPhone ? <th scope="col">Nomor telepon</th> : null}
                <th scope="col">Status</th>
                <th scope="col">Diperbarui</th>
                {canEdit ? (
                  <th scope="col" className="actions">
                    Tindakan
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {list.items.map((person) => {
                const restoreKey = `restore:${person.id}`;
                return (
                  <tr key={person.id}>
                    <th scope="row">{person.name}</th>
                    {withPhone ? (
                      <td className={person.phone ? 'mono' : 'muted'}>{person.phone ?? '—'}</td>
                    ) : null}
                    <td>
                      <StatusBadge
                        label={person.active ? 'Aktif' : 'Diarsipkan'}
                        tone={person.active ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="muted">{dateTime(person.updatedAt)}</td>
                    {canEdit ? (
                      <td className="actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => openEdit(person)}
                        >
                          Ubah
                          <span className="sr-only">
                            {' '}
                            {noun} {person.name}
                          </span>
                        </button>
                        {person.active ? (
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => {
                              mutate.clear(`archive:${person.id}`);
                              setArchiving(person);
                            }}
                          >
                            Arsipkan
                            <span className="sr-only">
                              {' '}
                              {noun} {person.name}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={mutate.isPending(restoreKey)}
                            onClick={() => void restore(person)}
                          >
                            {mutate.isPending(restoreKey) ? 'Memulihkan…' : 'Pulihkan'}
                            <span className="sr-only">
                              {' '}
                              {noun} {person.name}
                            </span>
                          </button>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* A failed restore has no dialog to report into, so its message sits
          under the table rather than inside a cell, where an alert would be
          read out of place. */}
      {list.items.map((person) => {
        const restoreKey = `restore:${person.id}`;
        const failure = mutate.failureOf(restoreKey);
        if (failure === null) return null;
        return (
          <WriteError
            key={restoreKey}
            failure={failure}
            unchangedNote={`${capitalize(noun)} ${person.name} masih diarsipkan.`}
            onRecheck={recheck(restoreKey)}
          />
        );
      })}

      <Pager
        label={`Halaman daftar ${noun}`}
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />

      <Dialog
        open={createOpen}
        title={`Tambah ${noun}`}
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
              type="submit"
              form={`${idPrefix}-form-tambah`}
              className="btn btn-primary"
              disabled={createBusy || createName.trim() === ''}
            >
              {createBusy ? 'Menyimpan…' : 'Simpan'}
            </button>
          </>
        }
      >
        <form
          id={`${idPrefix}-form-tambah`}
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="field span-2">
            <label className="field-label" htmlFor={`${idPrefix}-tambah-nama`}>
              Nama
            </label>
            <input
              id={`${idPrefix}-tambah-nama`}
              className="input"
              type="text"
              autoComplete="off"
              required
              maxLength={NAME_MAX}
              value={createName}
              aria-invalid={createFailure !== null ? true : undefined}
              onChange={(event) => setCreateName(event.target.value)}
            />
          </div>
          {withPhone ? (
            <div className="field span-2">
              <label className="field-label" htmlFor={`${idPrefix}-tambah-telepon`}>
                Nomor telepon (opsional)
              </label>
              <input
                id={`${idPrefix}-tambah-telepon`}
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={PHONE_MAX}
                placeholder="08xxxxxxxxxx"
                value={createPhone}
                aria-describedby={`${idPrefix}-tambah-telepon-hint`}
                onChange={(event) => setCreatePhone(event.target.value)}
              />
              <p className="field-hint" id={`${idPrefix}-tambah-telepon-hint`}>
                Nomor lokal 08… disimpan sebagai +62…. Satu nomor hanya boleh dipakai satu
                pelanggan pada unit usaha ini.
              </p>
            </div>
          ) : null}
        </form>
        {createFailure !== null ? (
          <>
            <DuplicateHint failure={createFailure} withPhone={withPhone} />
            <FieldErrors failure={createFailure} />
            <WriteError
              failure={createFailure}
              unchangedNote={`${capitalize(noun)} baru belum dibuat.`}
              onRecheck={() => {
                mutate.clear('create');
                setCreateOpen(false);
                reload();
              }}
            />
          </>
        ) : null}
      </Dialog>

      <Dialog
        open={editing !== null}
        title={editing === null ? `Ubah ${noun}` : `Ubah ${noun}: ${editing.name}`}
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
              type="submit"
              form={`${idPrefix}-form-ubah`}
              className="btn btn-primary"
              disabled={editBusy || editName.trim() === ''}
            >
              {editBusy ? 'Menyimpan…' : 'Simpan perubahan'}
            </button>
          </>
        }
      >
        {editing !== null ? (
          <form
            id={`${idPrefix}-form-ubah`}
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit(editing);
            }}
          >
            <div className="field span-2">
              <label className="field-label" htmlFor={`${idPrefix}-ubah-nama`}>
                Nama
              </label>
              <input
                id={`${idPrefix}-ubah-nama`}
                className="input"
                type="text"
                autoComplete="off"
                required
                maxLength={NAME_MAX}
                value={editName}
                aria-invalid={editFailure !== null ? true : undefined}
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            {withPhone ? (
              <div className="field span-2">
                <label className="field-label" htmlFor={`${idPrefix}-ubah-telepon`}>
                  Nomor telepon
                </label>
                <input
                  id={`${idPrefix}-ubah-telepon`}
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  maxLength={PHONE_MAX}
                  value={editPhone}
                  aria-describedby={`${idPrefix}-ubah-telepon-hint`}
                  onChange={(event) => setEditPhone(event.target.value)}
                />
                <p className="field-hint" id={`${idPrefix}-ubah-telepon-hint`}>
                  Kosongkan untuk menghapus nomor telepon pelanggan ini.
                </p>
              </div>
            ) : null}
          </form>
        ) : null}
        {editFailure !== null && editing !== null && editKey !== null ? (
          <>
            <DuplicateHint failure={editFailure} withPhone={withPhone} />
            <FieldErrors failure={editFailure} />
            <WriteError
              failure={editFailure}
              unchangedNote={`Data ${noun} ${editing.name} tidak berubah.`}
              onRecheck={() => {
                mutate.clear(editKey);
                setEditing(null);
                reload();
              }}
            />
          </>
        ) : null}
      </Dialog>

      <Dialog
        open={archiving !== null}
        title={
          archiving === null ? `Arsipkan ${noun}` : `Arsipkan ${noun} ${archiving.name}?`
        }
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
          {capitalize(noun)} yang diarsipkan hilang dari pilihan di layar kasir dan antrean.
          Datanya tidak dihapus dan dapat dipulihkan lewat saringan Diarsipkan.
        </p>
        {archiveFailure !== null && archiving !== null && archiveKey !== null ? (
          <>
            <FieldErrors failure={archiveFailure} />
            <WriteError
              failure={archiveFailure}
              unchangedNote={`${capitalize(noun)} ${archiving.name} belum diarsipkan.`}
              onRecheck={() => {
                mutate.clear(archiveKey);
                setArchiving(null);
                reload();
              }}
            />
          </>
        ) : null}
      </Dialog>
    </>
  );
}
