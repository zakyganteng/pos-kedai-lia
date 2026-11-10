'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { roleLabel } from '@/lib/format';
import { isOwner } from '@/lib/nav';
import type { BusinessLine, CurrentUser } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { buildQuery, useDebounced, useFilteredPage, usePaged, useResource } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { UserFormDialog } from './user-form-dialog';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Notice,
  PermissionBlock,
  StatusBadge,
  WriteError,
} from './states';

const PAGE_SIZE = 20;
const SEARCH_MAX = 100;

/**
 * Pengguna: the owner's account administration.
 *
 * The user list is global, not scoped to the selected business line, because
 * an account can be assigned to more than one. Every change here is read back
 * from the server: a saved account is never shown from local state.
 */
export function UserScreen() {
  const { user, line, lines: sessionLines, onSessionExpired } = useSession();
  const owner = isOwner(user.role);

  const [search, setSearch] = useState('');
  const settledSearch = useDebounced(search);
  const trimmedSearch = settledSearch.trim().slice(0, SEARCH_MAX);
  const [writes, setWrites] = useState(0);
  const [page, setPage] = useFilteredPage(`${trimmedSearch}\u0000${writes}`);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CurrentUser | null>(null);
  const [disabling, setDisabling] = useState<CurrentUser | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const list = usePaged<CurrentUser>(
    owner
      ? `/users${buildQuery({
          search: trimmedSearch || undefined,
          page,
          limit: PAGE_SIZE,
        })}`
      : null,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar pengguna belum dapat dimuat.' },
  );

  // Assignable business lines. The session only carries the lines this owner
  // is assigned to, so the catalogue is read from the server and falls back to
  // the session list if that read fails.
  const catalogue = useResource<{ data: BusinessLine[] }>(owner ? '/business-lines' : null, {
    onUnauthorized: onSessionExpired,
    errorMessage: 'Daftar unit usaha belum dapat dimuat.',
  });
  const assignable = catalogue.value?.data ?? sessionLines;

  const settle = () => {
    setWrites((value) => value + 1);
    list.reload();
  };

  const disable = async (target: CurrentUser) => {
    const key = `disable:${target.id}`;
    const ok = await mutate.run(key, async () => {
      await api<void>(`/users/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
    });
    if (!ok) return;
    setDisabling(null);
    if (target.id === user.id) {
      onSessionExpired();
      return;
    }
    settle();
  };

  const reactivate = async (target: CurrentUser) => {
    const key = `activate:${target.id}`;
    const ok = await mutate.run(key, async () => {
      await api<CurrentUser>(`/users/${encodeURIComponent(target.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
    });
    if (!ok) return;
    if (target.id === user.id) {
      onSessionExpired();
      return;
    }
    settle();
  };

  const disableKey = disabling === null ? null : `disable:${disabling.id}`;
  const disableFailure = disableKey === null ? null : mutate.failureOf(disableKey);
  const disableBusy = disableKey !== null && mutate.isPending(disableKey);

  if (!owner) {
    return (
      <main className="pos-main" id="konten">
        <div className="page-head">
          <h1 className="page-title">Pengguna</h1>
          <p className="meta">{line.name}</p>
        </div>
        <PermissionBlock>
          Pengelolaan akun hanya dapat dibuka oleh pemilik. Akun {user.name} tidak dapat melihat
          atau mengubah daftar pengguna.
        </PermissionBlock>
      </main>
    );
  }

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Pengguna</h1>
        <p className="meta">{line.name}</p>
      </div>

      <div style={{ marginBottom: 'var(--s4)' }}>
        <Notice tone="neutral" title="Akun berlaku untuk seluruh unit usaha">
          <p className="meta">
            Daftar ini tidak mengikuti unit usaha yang sedang dipilih. Satu akun dapat ditugaskan
            ke satu atau dua unit usaha, dan hanya dapat membuka data unit usaha tersebut.
          </p>
        </Notice>
      </div>

      {signedOut ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="warning" title="Akun tersebut keluar dari semua perangkat." live="polite">
            <p className="meta">
              Server mengakhiri sesi aktif akun itu setelah perubahan tersimpan. Pengguna harus
              masuk kembali dengan data yang baru.
            </p>
          </Notice>
        </div>
      ) : null}

      {catalogue.error !== null ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="warning" title="Daftar unit usaha belum dapat dimuat.">
            <p className="meta">
              {catalogue.error} Pilihan unit usaha pada formulir memakai unit usaha yang
              ditugaskan ke akun Anda.
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary" onClick={catalogue.reload}>
                Coba lagi
              </button>
            </div>
          </Notice>
        </div>
      ) : null}

      <div className="toolbar">
        <div className="toolbar-filters">
          <div className="field">
            <label className="field-label" htmlFor="pengguna-cari">
              Cari pengguna
            </label>
            <input
              id="pengguna-cari"
              className="input"
              type="search"
              value={search}
              maxLength={SEARCH_MAX}
              autoComplete="off"
              placeholder="Nama atau email"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {trimmedSearch !== '' ? (
            <button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>
              Hapus pencarian
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            mutate.clear('user:create');
            setCreating(true);
          }}
        >
          Tambah pengguna
        </button>
      </div>

      {list.loading && list.initial ? <LoadingBlock label="Memuat pengguna…" /> : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke daftar pengguna." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title="Daftar pengguna belum dapat dimuat."
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {!list.loading && list.error === null && !list.forbidden && list.items.length === 0 ? (
        <EmptyBlock
          title={
            trimmedSearch !== ''
              ? 'Tidak ada pengguna yang cocok dengan pencarian ini.'
              : 'Belum ada akun pengguna.'
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={list.loading}>
            <caption className="sr-only">Daftar akun pengguna</caption>
            <thead>
              <tr>
                <th scope="col">Nama</th>
                <th scope="col">Email</th>
                <th scope="col">Peran</th>
                <th scope="col">Unit usaha</th>
                <th scope="col">Status</th>
                <th scope="col" className="actions">
                  Tindakan
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((entry) => {
                const activateKey = `activate:${entry.id}`;
                const activateFailure = mutate.failureOf(activateKey);
                const activating = mutate.isPending(activateKey);
                const isSelf = entry.id === user.id;

                return (
                  <tr key={entry.id}>
                    <td>
                      {entry.name}
                      {isSelf ? <div className="meta">Akun Anda</div> : null}
                    </td>
                    <td>{entry.email}</td>
                    <td>{roleLabel(entry.role)}</td>
                    <td className="muted">
                      {entry.businessLines.length === 0
                        ? '—'
                        : entry.businessLines.map((assigned) => assigned.name).join(', ')}
                    </td>
                    <td>
                      <StatusBadge
                        label={entry.active ? 'Aktif' : 'Nonaktif'}
                        tone={entry.active ? 'success' : 'neutral'}
                      />
                      {activateFailure !== null ? (
                        <WriteError
                          failure={activateFailure}
                          unchangedNote="Akun ini masih nonaktif."
                          onRecheck={() => {
                            mutate.clear(activateKey);
                            list.reload();
                          }}
                        />
                      ) : null}
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          mutate.clear(`user:edit:${entry.id}`);
                          setEditing(entry);
                        }}
                      >
                        Ubah
                        <span className="sr-only"> akun {entry.name}</span>
                      </button>
                      {entry.active ? (
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => {
                            mutate.clear(`disable:${entry.id}`);
                            setDisabling(entry);
                          }}
                        >
                          Nonaktifkan
                          <span className="sr-only"> akun {entry.name}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={activating}
                          onClick={() => void reactivate(entry)}
                        >
                          {activating ? 'Mengaktifkan…' : 'Aktifkan'}
                          <span className="sr-only"> akun {entry.name}</span>
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
        label="Halaman daftar pengguna"
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />

      {creating ? (
        <UserFormDialog
          user={null}
          lines={assignable}
          self={false}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setSignedOut(false);
            settle();
          }}
          onSessionExpired={onSessionExpired}
        />
      ) : null}

      {editing !== null ? (
        <UserFormDialog
          user={editing}
          lines={assignable}
          self={editing.id === user.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            const self = editing.id === user.id;
            setEditing(null);
            // A successful update revokes that account's sessions, including
            // this one when an owner edits themselves.
            if (self) {
              onSessionExpired();
              return;
            }
            setSignedOut(true);
            settle();
          }}
          onSessionExpired={onSessionExpired}
        />
      ) : null}

      <Dialog
        open={disabling !== null}
        title={
          disabling === null ? 'Nonaktifkan akun' : `Nonaktifkan akun ${disabling.name}?`
        }
        onClose={
          disableBusy
            ? undefined
            : () => {
                if (disableKey !== null) mutate.clear(disableKey);
                setDisabling(null);
              }
        }
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={disableBusy}
              onClick={() => {
                if (disableKey !== null) mutate.clear(disableKey);
                setDisabling(null);
              }}
            >
              Batal
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={disableBusy}
              onClick={() => {
                if (disabling !== null) void disable(disabling);
              }}
            >
              {disableBusy ? 'Menonaktifkan…' : 'Nonaktifkan akun'}
            </button>
          </>
        }
      >
        <p>
          Akun tidak dihapus. Akun dinonaktifkan, sesi aktifnya diakhiri, dan pemiliknya tidak
          dapat masuk sampai diaktifkan kembali lewat tombol Aktifkan.
        </p>
        {disabling !== null && disabling.id === user.id ? (
          <p className="field-error">
            Ini akun Anda sendiri. Anda akan langsung keluar dan tidak dapat masuk kembali dengan
            akun ini.
          </p>
        ) : null}
        <p className="meta">
          Pemilik aktif terakhir tidak dapat dinonaktifkan; permintaan seperti itu ditolak server.
        </p>
        {disableFailure !== null && disableKey !== null ? (
          <WriteError
            failure={disableFailure}
            unchangedNote="Akun ini masih aktif."
            onRecheck={() => {
              mutate.clear(disableKey);
              setDisabling(null);
              list.reload();
            }}
          />
        ) : null}
      </Dialog>
    </main>
  );
}
