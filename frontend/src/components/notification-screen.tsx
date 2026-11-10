'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { dateTime, notificationStatusLabel, shortId } from '@/lib/format';
import { canManage } from '@/lib/nav';
import type { Notification } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { buildQuery, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import { Pager } from './pager';
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

const STATUS_OPTIONS = [
  { value: '', label: 'Semua status' },
  { value: 'queued', label: 'Dalam antrean kirim' },
  { value: 'sent', label: 'Terkirim' },
  { value: 'failed', label: 'Gagal terkirim' },
];

function statusTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'queued') return 'warning';
  return 'neutral';
}

/**
 * Notifikasi: delivery history of the WhatsApp receipt notifications of one
 * business line, with a retry for the ones the server recorded as failed.
 *
 * Nothing here is inferred locally. A retry only ever claims that the server
 * accepted it into the queue; whether a message was actually delivered is
 * read back from the list.
 */
export function NotificationScreen() {
  const { user, line, onSessionExpired } = useSession();
  const manages = canManage(user.role);

  const [status, setStatus] = useState('');
  const [page, setPage] = useFilteredPage(`${line.id}\u0000${status}`);
  const [queuedId, setQueuedId] = useState<string | null>(null);

  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const list = usePaged<Notification>(
    manages
      ? `/notifications${buildQuery({
          businessLineId: line.id,
          status: status || undefined,
          page,
          limit: PAGE_SIZE,
        })}`
      : null,
    { onUnauthorized: onSessionExpired, errorMessage: 'Riwayat notifikasi belum dapat dimuat.' },
  );

  const retry = async (notification: Notification) => {
    const key = `retry:${notification.id}`;
    const ok = await mutate.run(key, async () => {
      await api<{ status: string }>(
        `/notifications/${encodeURIComponent(notification.id)}/retry`,
        { method: 'POST' },
      );
    });
    if (!ok) return;
    setQueuedId(notification.id);
    list.reload();
  };

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Notifikasi</h1>
        <p className="meta">{line.name}</p>
      </div>

      {!manages ? (
        <PermissionBlock>
          Riwayat notifikasi hanya dapat dibuka oleh pemilik dan admin. Akun {user.name} dapat
          menggunakan halaman Kasir dan Struk.
        </PermissionBlock>
      ) : (
        <>
          <div className="toolbar">
            <div className="toolbar-filters">
              <div className="field">
                <label className="field-label" htmlFor="notifikasi-status">
                  Status pengiriman
                </label>
                <select
                  id="notifikasi-status"
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
            </div>
            <button type="button" className="btn btn-secondary" onClick={list.reload}>
              Muat ulang
            </button>
          </div>

          {queuedId !== null ? (
            <div style={{ marginBottom: 'var(--s4)' }}>
              <Notice tone="success" title="Pengiriman ulang dimasukkan ke antrean." live="polite">
                <p className="meta">
                  Server menerima permintaan pengiriman ulang. Statusnya menjadi terkirim hanya
                  setelah penyedia mengonfirmasi, jadi periksa kembali baris notifikasi ini.
                </p>
              </Notice>
            </div>
          ) : null}

          {list.loading && list.initial ? <LoadingBlock label="Memuat riwayat notifikasi…" /> : null}

          {list.forbidden ? (
            <EmptyBlock title="Akun ini tidak memiliki akses ke riwayat notifikasi unit usaha ini." />
          ) : null}

          {list.error !== null ? (
            <ErrorBlock
              title="Riwayat notifikasi belum dapat dimuat."
              message={list.error}
              onRetry={list.reload}
            />
          ) : null}

          {!list.loading && list.error === null && !list.forbidden && list.items.length === 0 ? (
            <EmptyBlock
              title={
                status === ''
                  ? 'Belum ada notifikasi pada unit usaha ini.'
                  : 'Tidak ada notifikasi dengan status ini.'
              }
            />
          ) : null}

          {list.items.length > 0 ? (
            <div className="table-wrap">
              <table className="data-table" aria-busy={list.loading}>
                <caption className="sr-only">Riwayat pengiriman notifikasi WhatsApp</caption>
                <thead>
                  <tr>
                    <th scope="col">Waktu</th>
                    <th scope="col">Struk</th>
                    <th scope="col">Tujuan</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="num">
                      Percobaan
                    </th>
                    <th scope="col">Galat terakhir</th>
                    <th scope="col" className="actions">
                      Tindakan
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((notification) => {
                    const key = `retry:${notification.id}`;
                    const failure = mutate.failureOf(key);
                    const pending = mutate.isPending(key);
                    const failed = notification.status === 'failed';

                    return (
                      <tr key={notification.id}>
                        <td>{dateTime(notification.createdAt)}</td>
                        <td>
                          <Link className="mono" href={`/struk/${notification.saleId}`}>
                            <span className="sr-only">Buka struk </span>
                            {shortId(notification.saleId)}
                          </Link>
                        </td>
                        <td className="mono">{notification.destinationMasked ?? '—'}</td>
                        <td>
                          <StatusBadge
                            label={notificationStatusLabel(notification.status)}
                            tone={statusTone(notification.status)}
                          />
                        </td>
                        <td className="num">{notification.attemptCount}</td>
                        <td className="muted">
                          {notification.lastError ?? '—'}
                          {failure !== null ? (
                            <>
                              {failure.status === 503 ? (
                                <div className="write-error" role="alert">
                                  <p className="field-error">
                                    Penyedia WhatsApp belum dikonfigurasi, jadi tidak ada pesan
                                    yang dikirim. Notifikasi ini tetap berstatus gagal sampai
                                    penyedia diaktifkan.
                                  </p>
                                </div>
                              ) : failure.status === 409 ? (
                                <div className="write-error" role="alert">
                                  <p className="field-error">
                                    {failure.message} Hanya notifikasi yang gagal terkirim yang
                                    dapat dikirim ulang; status baris ini sudah berubah di server.
                                  </p>
                                  <div className="btn-row">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      onClick={() => {
                                        mutate.clear(key);
                                        list.reload();
                                      }}
                                    >
                                      Muat ulang daftar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <WriteError
                                  failure={failure}
                                  unchangedNote="Notifikasi ini belum dimasukkan ke antrean kirim."
                                  onRecheck={() => {
                                    mutate.clear(key);
                                    list.reload();
                                  }}
                                />
                              )}
                            </>
                          ) : null}
                        </td>
                        <td className="actions">
                          {failed ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={pending}
                              onClick={() => void retry(notification)}
                            >
                              {pending ? 'Mengirim ulang…' : 'Kirim ulang'}
                              <span className="sr-only">
                                {' '}
                                notifikasi struk {shortId(notification.saleId)}
                              </span>
                            </button>
                          ) : (
                            <span className="meta">—</span>
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
            label="Halaman riwayat notifikasi"
            page={page}
            pagination={list.pagination}
            loading={list.loading}
            onPage={setPage}
          />

          <p className="meta" style={{ marginTop: 'var(--s3)' }}>
            Pengiriman ulang memakai tujuan dan isi pesan yang sudah tersimpan di server. Bila
            penyedia WhatsApp belum dikonfigurasi, permintaan ditolak dan tidak ada pesan palsu
            yang dicatat sebagai terkirim.
          </p>
        </>
      )}
    </main>
  );
}
