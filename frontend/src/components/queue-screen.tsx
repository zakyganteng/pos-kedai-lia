'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import '@/styles/queue.css';
import { api, newIdempotencyKey } from '@/lib/api';
import { businessDate, queueStatusLabel, shortId, todayBusinessDate } from '@/lib/format';
import type { Customer, QueueEntry, QueueStatus, SalonService, Staff } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { useLookup } from '@/hooks/use-lookup';
import { useMutation } from '@/hooks/use-mutation';
import { buildQuery, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Dialog } from './dialog';
import { Pager } from './pager';
import { QueueAddDialog } from './queue-add-dialog';
import { QueueEntryCard } from './queue-entry-card';
import { QueueLinkSaleDialog } from './queue-link-sale-dialog';
import { EmptyBlock, ErrorBlock, LoadingBlock, Notice, WriteError } from './states';

const PAGE_SIZE = 20;
/** The list re-reads itself on this cadence while today is on screen. */
const REFRESH_MS = 30_000;

const STATUS_CHIPS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Semua' },
  { value: 'waiting', label: queueStatusLabel('waiting') },
  { value: 'in_service', label: queueStatusLabel('in_service') },
  { value: 'completed', label: queueStatusLabel('completed') },
  { value: 'cancelled', label: queueStatusLabel('cancelled') },
];

const COUNTED: readonly QueueStatus[] = ['waiting', 'in_service', 'completed', 'cancelled'];

/**
 * Antrean salon: the walk-in queue for one business date.
 *
 * Salon lines only, which is what the backend enforces, so a kedai line gets
 * a notice instead of a request that would come back 403. Every role may
 * read, add and move entries along; the allowed transitions are the backend's
 * own (waiting to in_service or cancelled, in_service to completed or
 * cancelled), so no button here offers a move the server would refuse.
 */
export function QueueScreen() {
  const { line, onSessionExpired } = useSession();
  const salon = line.type === 'salon';

  const [today, setToday] = useState(() => todayBusinessDate());
  const [date, setDate] = useState(() => todayBusinessDate());
  const [status, setStatus] = useState('');
  const [writes, setWrites] = useState(0);
  const [page, setPage] = useFilteredPage(
    `${line.id}\u0000${date}\u0000${status}\u0000${writes}`,
  );

  const [addOpen, setAddOpen] = useState(false);
  const [addKey, setAddKey] = useState('');
  const [cancelling, setCancelling] = useState<QueueEntry | null>(null);
  const [linking, setLinking] = useState<QueueEntry | null>(null);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const list = usePaged<QueueEntry>(
    salon
      ? `/salon/queue${buildQuery({
          businessLineId: line.id,
          date,
          status: status || undefined,
          page,
          limit: PAGE_SIZE,
        })}`
      : null,
    { onUnauthorized: onSessionExpired, errorMessage: 'Antrean belum dapat dimuat.' },
  );

  const lookupOptions = { onUnauthorized: onSessionExpired };
  const customers = useLookup<Customer>(
    salon ? '/customers' : null,
    { businessLineId: line.id },
    lookupOptions,
  );
  const services = useLookup<SalonService>(
    salon ? '/services' : null,
    { businessLineId: line.id },
    lookupOptions,
  );
  const staff = useLookup<Staff>(
    salon ? '/staff' : null,
    { businessLineId: line.id },
    lookupOptions,
  );

  const reload = list.reload;
  const isToday = date === today;

  /**
   * Re-reads the queue while the tab is visible and today is on screen. A
   * past date cannot change, and a hidden tab has nobody reading it, so
   * neither is polled.
   */
  useEffect(() => {
    if (!salon || !isToday) return;
    let timer: number | null = null;

    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => {
        // A business day can roll over with the page left open overnight.
        setToday(todayBusinessDate());
        reload();
      }, REFRESH_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        reload();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [salon, isToday, reload]);

  /**
   * After a confirmed write. `resetPage` is used when the row has left the
   * filtered list, which can empty the page the user is standing on.
   */
  const settle = useCallback(
    (resetPage: boolean) => {
      if (resetPage) setWrites((value) => value + 1);
      reload();
    },
    [reload],
  );

  const recheck = useCallback(
    (key: string) => () => {
      mutate.clear(key);
      reload();
    },
    [mutate, reload],
  );

  const changeStatus = async (entry: QueueEntry, next: QueueStatus) => {
    const ok = await mutate.run(`status:${entry.id}`, async () => {
      await api<QueueEntry>(`/salon/queue/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
    });
    if (!ok) return;
    // With a status filter on, the entry has just left the list.
    settle(status !== '');
  };

  const assignStaff = async (entry: QueueEntry, staffId: string | null) => {
    const ok = await mutate.run(`staff:${entry.id}`, async () => {
      await api<QueueEntry>(`/salon/queue/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ staffId }),
      });
    });
    if (!ok) return;
    settle(false);
  };

  const cancelKey = cancelling === null ? null : `cancel:${cancelling.id}`;
  const cancelFailure = cancelKey === null ? null : mutate.failureOf(cancelKey);
  const cancelBusy = cancelKey !== null && mutate.isPending(cancelKey);

  const closeCancel = () => {
    if (cancelKey !== null) mutate.clear(cancelKey);
    setCancelling(null);
  };

  const cancel = async (entry: QueueEntry) => {
    const ok = await mutate.run(`cancel:${entry.id}`, async () => {
      await api<QueueEntry>(`/salon/queue/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
    });
    if (!ok) return;
    setCancelling((current) => (current !== null && current.id === entry.id ? null : current));
    settle(status !== '');
  };

  const openAdd = () => {
    mutate.clear('create');
    // One key per submission, minted when the form opens and reused for every
    // retry of that submission so a lost response cannot double the entry.
    setAddKey(newIdempotencyKey());
    setAddOpen(true);
  };

  const onCreated = (entry: QueueEntry) => {
    setAddOpen(false);
    setAddKey('');
    // The backend always files a new entry under the current business date.
    if (entry.date !== date) {
      setToday(entry.date);
      setDate(entry.date);
      return;
    }
    settle(true);
  };

  const counts = COUNTED.map((value) => ({
    value,
    label: queueStatusLabel(value),
    total: list.items.filter((entry) => entry.status === value).length,
  }));

  const activeStaff = staff.items.filter((member) => member.active);
  const showEmpty =
    !list.loading && list.error === null && !list.forbidden && list.items.length === 0;

  if (!salon) {
    return (
      <main className="pos-main" id="konten">
        <div className="page-head">
          <h1 className="page-title">Antrean</h1>
          <p className="meta">{line.name}</p>
        </div>
        <Notice tone="neutral" title={`${line.name} tidak menggunakan antrean`}>
          <p className="meta">
            Antrean hanya berlaku untuk unit usaha salon, tempat satu pelanggan menunggu giliran
            layanan. Pesanan kedai langsung diselesaikan di kasir.
          </p>
          <p className="meta">
            Beralihlah ke unit usaha salon lewat pilihan di bagian atas halaman untuk membuka
            antreannya.
          </p>
          <div className="btn-row">
            <Link className="btn btn-secondary" href="/kasir">
              Buka Kasir
            </Link>
          </div>
        </Notice>
      </main>
    );
  }

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Antrean</h1>
        <p className="meta">{line.name}</p>
      </div>

      <div className="toolbar">
        <div className="toolbar-filters">
          <div className="field">
            <label className="field-label" htmlFor="antrean-tanggal">
              Tanggal
            </label>
            <input
              id="antrean-tanggal"
              className="input"
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value !== '') setDate(event.target.value);
              }}
            />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isToday}
              onClick={() => {
                const now = todayBusinessDate();
                setToday(now);
                setDate(now);
              }}
            >
              Hari ini
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => reload()}>
              Muat ulang
            </button>
          </div>
        </div>

        <button type="button" className="btn btn-primary btn-tall" onClick={openAdd}>
          Tambah antrean
        </button>
      </div>

      <div className="chip-row" role="group" aria-label="Saring antrean menurut status">
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.value === '' ? 'all' : chip.value}
            type="button"
            className="chip"
            aria-pressed={status === chip.value}
            onClick={() => setStatus(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <p className="meta">
        Menampilkan {businessDate(date)}.{' '}
        {isToday
          ? 'Daftar diperbarui otomatis setiap 30 detik selama halaman terbuka.'
          : 'Tanggal lampau tidak diperbarui otomatis.'}
      </p>

      {list.items.length > 0 ? (
        <>
          <h2 className="section-title">Ringkasan halaman ini</h2>
          <div className="stat-grid">
            {counts.map((entry) => (
              <div className="stat-card" key={entry.value}>
                <p className="stat-label">{entry.label}</p>
                <p className="stat-value">{entry.total}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {list.loading ? (
        <LoadingBlock label={list.initial ? 'Memuat antrean…' : 'Memperbarui antrean…'} />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke antrean unit usaha ini." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock title="Antrean belum dapat dimuat." message={list.error} onRetry={list.reload} />
      ) : null}

      {showEmpty ? (
        <EmptyBlock
          title={
            status === ''
              ? `Belum ada antrean pada ${businessDate(date)}.`
              : `Tidak ada antrean berstatus ${queueStatusLabel(status)} pada ${businessDate(date)}.`
          }
        />
      ) : null}

      {services.error !== null || staff.error !== null || customers.error !== null ? (
        <Notice tone="warning" title="Sebagian nama belum dapat dimuat">
          <p className="meta">
            Nomor dan status antrean tetap benar, tetapi nama layanan, staf atau pelanggan dapat
            tampil sebagai kode singkat.
          </p>
        </Notice>
      ) : null}

      {list.items.length > 0 ? (
        <ul className="queue-list" aria-busy={list.loading}>
          {list.items.map((entry) => {
            const staffOptions =
              entry.staffId && !activeStaff.some((member) => member.id === entry.staffId)
                ? [...activeStaff, ...staff.items.filter((member) => member.id === entry.staffId)]
                : activeStaff;
            return (
              <QueueEntryCard
                key={entry.id}
                entry={entry}
                customerName={
                  entry.customerId
                    ? (customers.byId.get(entry.customerId)?.name ?? shortId(entry.customerId))
                    : null
                }
                serviceNames={entry.serviceIds.map(
                  (id) => services.byId.get(id)?.name ?? shortId(id),
                )}
                staffOptions={staffOptions}
                staffName={
                  entry.staffId
                    ? (staff.byId.get(entry.staffId)?.name ?? shortId(entry.staffId))
                    : null
                }
                mutate={mutate}
                onStatus={(target, next) => void changeStatus(target, next)}
                onCancel={(target) => {
                  mutate.clear(`cancel:${target.id}`);
                  setCancelling(target);
                }}
                onStaff={(target, staffId) => void assignStaff(target, staffId)}
                onLinkSale={(target) => {
                  mutate.clear(`link:${target.id}`);
                  setLinking(target);
                }}
                onRecheck={recheck}
              />
            );
          })}
        </ul>
      ) : null}

      <Pager
        label="Halaman antrean"
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />

      <QueueAddDialog
        open={addOpen}
        line={line}
        idempotencyKey={addKey}
        services={services.items}
        servicesLoading={services.loading}
        staff={staff.items}
        viewingDate={date}
        todayDate={today}
        mutate={mutate}
        onCreated={onCreated}
        onClose={() => setAddOpen(false)}
        onSessionExpired={onSessionExpired}
      />

      <QueueLinkSaleDialog
        entry={linking}
        lineId={line.id}
        date={linking?.date ?? date}
        mutate={mutate}
        onLinked={() => {
          setLinking(null);
          settle(false);
        }}
        onClose={() => {
          if (linking !== null) mutate.clear(`link:${linking.id}`);
          setLinking(null);
        }}
        onSessionExpired={onSessionExpired}
      />

      <Dialog
        open={cancelling !== null}
        title={
          cancelling === null ? 'Batalkan antrean' : `Batalkan antrean #${cancelling.queueNumber}?`
        }
        onClose={cancelBusy ? undefined : closeCancel}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={cancelBusy}
              onClick={closeCancel}
            >
              Kembali
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={cancelBusy}
              onClick={() => {
                if (cancelling !== null) void cancel(cancelling);
              }}
            >
              {cancelBusy ? 'Membatalkan…' : 'Batalkan antrean'}
            </button>
          </>
        }
      >
        <p>
          Antrean yang dibatalkan tidak dapat dibuka kembali dan nomornya tidak dipakai ulang.
          Buat antrean baru bila pelanggan kembali.
        </p>
        {cancelFailure !== null && cancelling !== null && cancelKey !== null ? (
          <WriteError
            failure={cancelFailure}
            unchangedNote={`Antrean #${cancelling.queueNumber} belum dibatalkan.`}
            onRecheck={() => {
              mutate.clear(cancelKey);
              setCancelling(null);
              reload();
            }}
          />
        ) : null}
      </Dialog>
    </main>
  );
}
