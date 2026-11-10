'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  dateTime,
  providerStatusLabel,
  reconciliationOutcomeLabel,
  rupiah,
  shortId,
} from '@/lib/format';
import { canManage, isOwner } from '@/lib/nav';
import type { Reconciliation } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Pager } from './pager';
import {
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Notice,
  PermissionBlock,
  StatusBadge,
} from './states';

const PAGE_SIZE = 20;
/** Matches the backend's bound, so the field never sends a search it refuses. */
const SEARCH_MAX = 100;

const OUTCOME_OPTIONS = [
  { value: '', label: 'Semua hasil' },
  { value: 'applied', label: 'Diterapkan' },
  { value: 'duplicate_state', label: 'Status sama (duplikat)' },
  { value: 'mismatch', label: 'Tidak cocok' },
  { value: 'terminal_conflict', label: 'Konflik status akhir' },
  { value: 'unmatched', label: 'Tanpa transaksi' },
  { value: 'stale', label: 'Kedaluwarsa' },
  { value: 'unresolved', label: 'Belum terselesaikan' },
];

function outcomeTone(outcome: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (outcome === 'applied') return 'success';
  if (outcome === 'duplicate_state') return 'neutral';
  if (outcome === 'unresolved') return 'warning';
  return 'error';
}

/**
 * Rekonsiliasi: the sanitized provider events the backend recorded, with the
 * disposition it gave each one.
 *
 * This is a read-only audit view. Nothing on this screen changes payment
 * state; the outcome column is the server's own record of what the event did.
 */
export function ReconciliationScreen() {
  const { user, line, onSessionExpired } = useSession();
  const manages = canManage(user.role);

  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState('');
  const settledSearch = useDebounced(search);
  const trimmedSearch = settledSearch.trim().slice(0, SEARCH_MAX);
  const [page, setPage] = useFilteredPage(`${line.id}\u0000${outcome}\u0000${trimmedSearch}`);

  const list = usePaged<Reconciliation>(
    manages
      ? `/payments/reconciliation${buildQuery({
          businessLineId: line.id,
          search: trimmedSearch || undefined,
          outcome: outcome || undefined,
          page,
          limit: PAGE_SIZE,
        })}`
      : null,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar rekonsiliasi belum dapat dimuat.' },
  );

  const filtered = outcome !== '' || trimmedSearch !== '';

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Rekonsiliasi</h1>
        <p className="meta">{line.name}</p>
      </div>

      {!manages ? (
        <PermissionBlock>
          Rekonsiliasi pembayaran hanya dapat dibuka oleh pemilik dan admin. Akun {user.name} dapat
          menggunakan halaman Kasir dan Struk.
        </PermissionBlock>
      ) : (
        <>
          <div style={{ marginBottom: 'var(--s4)' }}>
            <Notice tone="neutral" title="Catatan peristiwa dari penyedia pembayaran">
              <p className="meta">
                Setiap baris adalah satu peristiwa yang sudah diverifikasi server, beserta
                keputusan yang dicatatnya. Admin melihat peristiwa yang terhubung ke {line.name}.
                {isOwner(user.role)
                  ? ' Sebagai pemilik, Anda juga melihat peristiwa tanpa transaksi yang tidak dapat dikaitkan ke unit usaha mana pun.'
                  : ' Peristiwa tanpa transaksi yang tidak dapat dikaitkan ke unit usaha mana pun hanya terlihat oleh pemilik.'}
              </p>
            </Notice>
          </div>

          <div className="toolbar">
            <div className="toolbar-filters">
              <div className="field">
                <label className="field-label" htmlFor="rekon-cari">
                  Cari peristiwa
                </label>
                <input
                  id="rekon-cari"
                  className="input"
                  type="search"
                  value={search}
                  maxLength={SEARCH_MAX}
                  autoComplete="off"
                  placeholder="ID peristiwa, transaksi, atau penyedia"
                  aria-describedby="rekon-cari-petunjuk"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <p className="field-hint" id="rekon-cari-petunjuk">
                  Cocokkan sebagian ID peristiwa, ID transaksi, atau ID pembayaran penyedia.
                </p>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="rekon-hasil">
                  Hasil
                </label>
                <select
                  id="rekon-hasil"
                  className="select"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                >
                  {OUTCOME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {filtered ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSearch('');
                    setOutcome('');
                  }}
                >
                  Hapus filter
                </button>
              ) : null}
            </div>
            <button type="button" className="btn btn-secondary" onClick={list.reload}>
              Muat ulang
            </button>
          </div>

          {list.loading && list.initial ? <LoadingBlock label="Memuat rekonsiliasi…" /> : null}

          {list.forbidden ? (
            <EmptyBlock title="Akun ini tidak memiliki akses ke rekonsiliasi unit usaha ini." />
          ) : null}

          {list.error !== null ? (
            <ErrorBlock
              title="Daftar rekonsiliasi belum dapat dimuat."
              message={list.error}
              onRetry={list.reload}
            />
          ) : null}

          {!list.loading && list.error === null && !list.forbidden && list.items.length === 0 ? (
            <EmptyBlock
              title={
                filtered
                  ? 'Tidak ada peristiwa yang cocok dengan saringan ini.'
                  : 'Belum ada peristiwa pembayaran yang tercatat.'
              }
            />
          ) : null}

          {list.items.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table" aria-busy={list.loading}>
                <caption className="sr-only">
                  Peristiwa penyedia pembayaran beserta hasil rekonsiliasinya
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Waktu peristiwa</th>
                    <th scope="col">Dicatat</th>
                    <th scope="col">ID peristiwa</th>
                    <th scope="col">Transaksi</th>
                    <th scope="col">ID penyedia</th>
                    <th scope="col">Status penyedia</th>
                    <th scope="col" className="num">
                      Jumlah
                    </th>
                    <th scope="col">Hasil</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((event) => (
                    <tr key={event.id}>
                      <td>{dateTime(event.occurredAt)}</td>
                      <td className="muted">{dateTime(event.createdAt)}</td>
                      <td className="mono">{event.eventId}</td>
                      <td>
                        {event.outcome === 'unmatched' ? (
                          <span className="mono muted">{event.saleId || '—'}</span>
                        ) : (
                          <Link className="mono" href={`/struk/${event.saleId}`}>
                            <span className="sr-only">Buka struk </span>
                            {shortId(event.saleId)}
                          </Link>
                        )}
                      </td>
                      <td className="mono">{event.providerPaymentId}</td>
                      <td>{providerStatusLabel(event.providerStatus)}</td>
                      <td className="num">
                        <span className="money">{rupiah(event.amount)}</span>
                        <div className="meta">{event.currency}</div>
                      </td>
                      <td>
                        <StatusBadge
                          label={reconciliationOutcomeLabel(event.outcome)}
                          tone={outcomeTone(event.outcome)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <Pager
            label="Halaman daftar rekonsiliasi"
            page={page}
            pagination={list.pagination}
            loading={list.loading}
            onPage={setPage}
          />
        </>
      )}
    </main>
  );
}
