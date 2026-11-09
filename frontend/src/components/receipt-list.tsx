'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { dateTime, paymentLabel, rupiah, saleLabel } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { buildQuery, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { forgetPendingSale, usePendingSales } from '@/hooks/use-checkout';
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, StatusBadge, paymentTone, saleTone } from './states';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'pending_payment', label: 'Menunggu pembayaran' },
  { value: 'paid', label: 'Lunas' },
  { value: 'cancelled', label: 'Dibatalkan' },
  { value: 'voided', label: 'Dibatalkan setelah pembayaran' },
];

export function ReceiptList() {
  const { line, workspace, onSessionExpired } = useSession();
  const pending = usePendingSales(workspace);

  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useFilteredPage(`${line.id}\u0000${status}\u0000${from}\u0000${to}`);

  const query = buildQuery({
    businessLineId: line.id,
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const sales = usePaged<Sale>(`/sales${query}`, {
    onUnauthorized: onSessionExpired,
    errorMessage: 'Daftar struk belum dapat dimuat.',
  });

  // A watched sale that the server already reports as settled no longer needs
  // a shortcut. This is derived from the fetched page, never guessed.
  const settledIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sale of sales.items) {
      if (sale.payment?.status !== 'pending') ids.add(sale.id);
    }
    return ids;
  }, [sales.items]);

  const watchList = pending.filter((note) => !settledIds.has(note.saleId));
  const totalPages = sales.pagination?.totalPages ?? 1;

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Struk</h1>
        <p className="meta">{line.name}</p>
      </div>

      {watchList.length > 0 ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="warning" title="Pembayaran yang masih dipantau" live="polite">
            <ul className="record-list">
              {watchList.map((note) => (
                <li className="record-row" key={note.saleId}>
                  <Link className="record-link" href={`/struk/${note.saleId}`}>
                    <span className="sr-only">Buka struk </span>
                    {note.createdAt === '' ? note.saleId : dateTime(note.createdAt)}
                  </Link>
                  <span className="record-amount money">{rupiah(note.total)}</span>
                  <span className="record-meta">
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => forgetPendingSale(workspace, note.saleId)}
                    >
                      Hapus dari daftar pantau
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}

      <div className="filter-bar">
        <div className="field">
          <label className="field-label" htmlFor="filter-status">
            Status transaksi
          </label>
          <select
            id="filter-status"
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="filter-from">
            Dari tanggal
          </label>
          <input
            id="filter-from"
            className="input"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="filter-to">
            Sampai tanggal
          </label>
          <input
            id="filter-to"
            className="input"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>

        {status !== '' || from !== '' || to !== '' ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setStatus('');
              setFrom('');
              setTo('');
            }}
          >
            Hapus filter
          </button>
        ) : null}
      </div>

      {sales.loading && sales.initial ? <LoadingBlock label="Memuat struk…" /> : null}

      {sales.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke daftar transaksi unit usaha ini." />
      ) : null}

      {sales.error !== null ? (
        <ErrorBlock
          title="Daftar struk belum dapat dimuat."
          message={sales.error}
          onRetry={sales.reload}
        />
      ) : null}

      {!sales.loading && sales.error === null && !sales.forbidden && sales.items.length === 0 ? (
        <EmptyBlock title="Tidak ada transaksi untuk filter ini." />
      ) : null}

      {sales.items.length > 0 ? (
        <ul className="record-list">
          {sales.items.map((sale) => (
            <li className="record-row" key={sale.id}>
              <Link className="record-link" href={`/struk/${sale.id}`}>
                <span className="sr-only">Buka struk </span>
                {dateTime(sale.createdAt)}
              </Link>
              <span className="record-amount money">{rupiah(sale.total)}</span>
              <span className="record-meta">
                <StatusBadge label={saleLabel(sale.status)} tone={saleTone(sale.status)} />
                {sale.payment ? (
                  <StatusBadge
                    label={paymentLabel(sale.payment.status)}
                    tone={paymentTone(sale.payment.status)}
                  />
                ) : null}
                <span className="meta">{sale.items.length} jenis item</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {totalPages > 1 ? (
        <nav className="pager" aria-label="Halaman daftar struk">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1 || sales.loading}
          >
            Sebelumnya
          </button>
          <span className="meta" role="status">
            Halaman {sales.pagination?.page ?? page} dari {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || sales.loading}
          >
            Berikutnya
          </button>
        </nav>
      ) : null}
    </main>
  );
}
