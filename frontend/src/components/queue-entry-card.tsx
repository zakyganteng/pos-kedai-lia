'use client';

import Link from 'next/link';
import { queueStatusLabel, timeOfDay } from '@/lib/format';
import type { QueueEntry, QueueStatus } from '@/lib/types';
import type { MutationResult } from '@/hooks/use-mutation';
import { StatusBadge, WriteError } from './states';

function queueTone(status: QueueStatus): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'completed') return 'success';
  if (status === 'in_service') return 'warning';
  if (status === 'cancelled') return 'error';
  return 'neutral';
}

export type QueueEntryCardProps = {
  entry: QueueEntry;
  /** Null when the entry has no customer, or the name could not be resolved. */
  customerName: string | null;
  /** Resolved service names, falling back to the id for an unreadable one. */
  serviceNames: string[];
  mutate: MutationResult;
  onStatus: (entry: QueueEntry, status: QueueStatus) => void;
  onCancel: (entry: QueueEntry) => void;
  onLinkSale: (entry: QueueEntry) => void;
  onRecheck: (key: string) => () => void;
};

/**
 * One queue entry: its number, who it is for, what was asked for, and the two
 * or three things that can still be done to it. Actions follow the backend's
 * transitions exactly (waiting to in_service or cancelled, in_service to
 * completed or cancelled), so no button here can be refused for its status.
 */
export function QueueEntryCard({
  entry,
  customerName,
  serviceNames,
  mutate,
  onStatus,
  onCancel,
  onLinkSale,
  onRecheck,
}: QueueEntryCardProps) {
  const statusKey = `status:${entry.id}`;
  const linkKey = `link:${entry.id}`;
  const cancelKey = `cancel:${entry.id}`;

  const statusFailure = mutate.failureOf(statusKey);
  const linkFailure = mutate.failureOf(linkKey);
  const cancelFailure = mutate.failureOf(cancelKey);

  const open = entry.status === 'waiting' || entry.status === 'in_service';
  const statusBusy = mutate.isPending(statusKey);

  return (
    <li className="queue-card">
      <div className="queue-card-head">
        <span className="queue-number" aria-hidden="true">
          #{entry.queueNumber}
        </span>
        <span className="queue-card-title">
          <span className="queue-card-name">
            <span className="sr-only">Nomor antrean {entry.queueNumber}. </span>
            {customerName ?? 'Tanpa pelanggan'}
          </span>
          <span className="queue-card-badges">
            <StatusBadge label={queueStatusLabel(entry.status)} tone={queueTone(entry.status)} />
          </span>
        </span>
      </div>

      <ul className="queue-services" aria-label={`Layanan antrean ${entry.queueNumber}`}>
        {serviceNames.map((name, index) => (
          <li className="queue-service" key={`${entry.id}:${index}`}>
            {name}
          </li>
        ))}
      </ul>

      {entry.note ? <p className="queue-note">{entry.note}</p> : null}

      <dl className="queue-times">
        <div>
          <dt>Masuk</dt>
          <dd>{timeOfDay(entry.createdAt)}</dd>
        </div>
        <div>
          <dt>Mulai</dt>
          <dd>{timeOfDay(entry.startedAt)}</dd>
        </div>
        <div>
          <dt>Selesai</dt>
          <dd>{timeOfDay(entry.completedAt)}</dd>
        </div>
      </dl>

      <div className="btn-row">
        {entry.status === 'waiting' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={statusBusy}
            onClick={() => onStatus(entry, 'in_service')}
          >
            {statusBusy ? 'Menyimpan…' : 'Mulai layanan'}
            <span className="sr-only"> antrean {entry.queueNumber}</span>
          </button>
        ) : null}

        {entry.status === 'in_service' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={statusBusy}
            onClick={() => onStatus(entry, 'completed')}
          >
            {statusBusy ? 'Menyimpan…' : 'Selesai'}
            <span className="sr-only"> antrean {entry.queueNumber}</span>
          </button>
        ) : null}

        {open ? (
          <button
            type="button"
            className="btn btn-danger"
            disabled={mutate.isPending(cancelKey)}
            onClick={() => onCancel(entry)}
          >
            Batalkan
            <span className="sr-only"> antrean {entry.queueNumber}</span>
          </button>
        ) : null}

        {entry.status === 'completed' && entry.saleId ? (
          <Link className="btn btn-secondary" href={`/struk/${entry.saleId}`}>
            Lihat struk
            <span className="sr-only"> antrean {entry.queueNumber}</span>
          </Link>
        ) : null}

        {entry.status === 'completed' && !entry.saleId ? (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={mutate.isPending(linkKey)}
              onClick={() => onLinkSale(entry)}
            >
              Tautkan transaksi
              <span className="sr-only"> antrean {entry.queueNumber}</span>
            </button>
            <Link className="btn btn-quiet" href="/kasir">
              Buka kasir
              <span className="sr-only"> untuk menagih antrean {entry.queueNumber}</span>
            </Link>
          </>
        ) : null}
      </div>

      {statusFailure !== null ? (
        <WriteError
          failure={statusFailure}
          unchangedNote={`Antrean #${entry.queueNumber} masih berstatus ${queueStatusLabel(entry.status)}.`}
          onRecheck={onRecheck(statusKey)}
        />
      ) : null}
      {cancelFailure !== null ? (
        <WriteError
          failure={cancelFailure}
          unchangedNote={`Antrean #${entry.queueNumber} belum dibatalkan.`}
          onRecheck={onRecheck(cancelKey)}
        />
      ) : null}
      {linkFailure !== null ? (
        <WriteError
          failure={linkFailure}
          unchangedNote={`Antrean #${entry.queueNumber} belum tertaut ke transaksi.`}
          onRecheck={onRecheck(linkKey)}
        />
      ) : null}
    </li>
  );
}
