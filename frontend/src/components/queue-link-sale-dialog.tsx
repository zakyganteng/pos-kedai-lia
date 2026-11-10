'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { rupiah, timeOfDay } from '@/lib/format';
import type { QueueEntry, Sale } from '@/lib/types';
import type { MutationResult } from '@/hooks/use-mutation';
import { buildQuery, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { EmptyBlock, ErrorBlock, LoadingBlock, WriteError } from './states';

const PAGE_SIZE = 10;

export type QueueLinkSaleDialogProps = {
  /** Null keeps the dialog closed and the sales request unmade. */
  entry: QueueEntry | null;
  lineId: string;
  /** Business date of the entry; the sale is looked for on the same day. */
  date: string;
  mutate: MutationResult;
  onLinked: () => void;
  onClose: () => void;
  onSessionExpired: () => void;
};

/** Why the backend would refuse this sale, or null when it would accept it. */
function refusal(entry: QueueEntry, sale: Sale): string | null {
  if (entry.customerId && sale.customerId !== entry.customerId) {
    return 'Pelanggan transaksi berbeda dengan pelanggan antrean.';
  }
  const sold = new Set(sale.items.map((item) => item.itemId));
  const missing = entry.serviceIds.filter((id) => !sold.has(id));
  if (missing.length > 0) {
    return `Transaksi ini belum mencakup ${missing.length} layanan yang diminta.`;
  }
  return null;
}

/**
 * Links a completed queue entry to the paid sale that settled it.
 *
 * The backend accepts the link only for a paid sale in the same line that
 * covers every requested service and matches the entry's customer, so sales
 * that would be refused are listed with the reason rather than hidden.
 */
export function QueueLinkSaleDialog({
  entry,
  lineId,
  date,
  mutate,
  onLinked,
  onClose,
  onSessionExpired,
}: QueueLinkSaleDialogProps) {
  const [page, setPage] = useFilteredPage(`${lineId}\u0000${date}\u0000${entry?.id ?? ''}`);
  const [picked, setPicked] = useState<string | null>(null);

  const sales = usePaged<Sale>(
    entry === null
      ? null
      : `/sales${buildQuery({
          businessLineId: lineId,
          status: 'paid',
          from: date,
          to: date,
          page,
          limit: PAGE_SIZE,
        })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar transaksi belum dapat dimuat.' },
  );

  const key = entry === null ? null : `link:${entry.id}`;
  const failure = key === null ? null : mutate.failureOf(key);
  const busy = key !== null && mutate.isPending(key);

  const link = async (target: QueueEntry, saleId: string) => {
    setPicked(saleId);
    const ok = await mutate.run(`link:${target.id}`, async () => {
      await api<QueueEntry>(`/salon/queue/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ saleId }),
      });
    });
    if (!ok) return;
    onLinked();
  };

  const showEmpty =
    !sales.loading && sales.error === null && !sales.forbidden && sales.items.length === 0;

  return (
    <Dialog
      open={entry !== null}
      title={entry === null ? 'Tautkan transaksi' : `Tautkan transaksi ke antrean #${entry.queueNumber}`}
      description="Hanya transaksi lunas pada tanggal yang sama yang ditampilkan. Tautan tidak dapat diubah setelah tersimpan."
      onClose={busy ? undefined : onClose}
      footer={
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
          Tutup
        </button>
      }
    >
      {sales.loading && sales.initial ? <LoadingBlock label="Memuat transaksi…" /> : null}

      {sales.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke daftar transaksi." />
      ) : null}

      {sales.error !== null ? (
        <ErrorBlock
          title="Daftar transaksi belum dapat dimuat."
          message={sales.error}
          onRetry={sales.reload}
        />
      ) : null}

      {showEmpty ? (
        <EmptyBlock title="Belum ada transaksi lunas pada tanggal ini.">
          <p className="meta">
            Selesaikan pembayarannya di halaman Kasir lebih dulu, lalu tautkan dari sini.
          </p>
        </EmptyBlock>
      ) : null}

      {entry !== null && sales.items.length > 0 ? (
        <ul className="record-list">
          {sales.items.map((sale) => {
            const reason = refusal(entry, sale);
            const names = sale.items.map((item) => item.displayName).join(', ');
            const pending = busy && picked === sale.id;
            return (
              <li className="record-row" key={sale.id}>
                <span className="stack-sm">
                  <span>
                    <strong>{timeOfDay(sale.createdAt)}</strong>{' '}
                    <span className="record-amount money">{rupiah(sale.total)}</span>
                  </span>
                  <span className="meta">{names === '' ? 'Tanpa rincian item' : names}</span>
                  {reason !== null ? <span className="field-error">{reason}</span> : null}
                </span>
                <span className="record-meta">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || reason !== null}
                    onClick={() => void link(entry, sale.id)}
                  >
                    {pending ? 'Menautkan…' : 'Tautkan'}
                    <span className="sr-only"> transaksi pukul {timeOfDay(sale.createdAt)}</span>
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Pager
        label="Halaman transaksi lunas"
        page={page}
        pagination={sales.pagination}
        loading={sales.loading}
        onPage={setPage}
      />

      {failure !== null && key !== null ? (
        <WriteError
          failure={failure}
          unchangedNote="Antrean ini belum tertaut ke transaksi."
          onRecheck={() => {
            mutate.clear(key);
            onLinked();
          }}
        />
      ) : null}
    </Dialog>
  );
}
