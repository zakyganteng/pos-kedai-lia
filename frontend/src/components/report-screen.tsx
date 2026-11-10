'use client';

import { useState } from 'react';
import { apiDownload } from '@/lib/api';
import { businessDate, count, monthStart, rupiah, shiftBusinessDate, todayBusinessDate } from '@/lib/format';
import { canManage } from '@/lib/nav';
import type { ReportGroupBy, SalesReport } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { buildQuery, useResource } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import { ReportGroups } from './report-groups';
import { ReportInventory } from './report-inventory';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './states';

/** The backend accepts an inclusive range of 1 to 366 days. */
const MAX_DAYS = 366;

const GROUPS: { value: ReportGroupBy; label: string; managersOnly: boolean }[] = [
  { value: 'day', label: 'Per hari', managersOnly: false },
  { value: 'paymentMethod', label: 'Metode pembayaran', managersOnly: false },
  { value: 'item', label: 'Per item', managersOnly: true },
  { value: 'staff', label: 'Per staf', managersOnly: true },
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive length of the range in days, or null when either date is unusable. */
function rangeDays(from: string, to: string): number | null {
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to)) return null;
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000) + 1;
}

function presets(): { label: string; from: string; to: string }[] {
  const today = todayBusinessDate();
  return [
    { label: 'Hari ini', from: today, to: today },
    { label: '7 hari', from: shiftBusinessDate(-6, today), to: today },
    { label: 'Bulan ini', from: monthStart(today), to: today },
    { label: '30 hari', from: shiftBusinessDate(-29, today), to: today },
  ];
}

/**
 * Laporan: confirmed sales for a date range, grouped, plus the stock report
 * for a kedai line.
 *
 * Every figure here is revenue the payment provider confirmed. Pending,
 * failed and voided payments are not in it, and nothing on this screen is
 * profit: no cost of goods is known to this system.
 */
export function ReportScreen() {
  const { user, line, onSessionExpired } = useSession();

  const manages = canManage(user.role);
  const salon = line.type === 'salon';

  const [from, setFrom] = useState(() => monthStart());
  const [to, setTo] = useState(() => todayBusinessDate());
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('day');

  const download = useMutation({ onUnauthorized: onSessionExpired });
  const csvFailure = download.failureOf('csv');
  const csvBusy = download.isPending('csv');

  const days = rangeDays(from, to);
  const tooLong = days !== null && days > MAX_DAYS;
  const reversed = days !== null && days < 1;
  const rangeError =
    days === null
      ? 'Isi tanggal mulai dan tanggal akhir.'
      : reversed
        ? 'Tanggal mulai harus sama dengan atau sebelum tanggal akhir.'
        : tooLong
          ? `Rentang maksimal ${MAX_DAYS} hari; rentang ini ${count(days)} hari.`
          : null;

  const visibleGroups = GROUPS.filter((group) => manages || !group.managersOnly);

  const report = useResource<SalesReport>(
    rangeError === null
      ? `/reports/sales${buildQuery({ businessLineId: line.id, from, to, groupBy })}`
      : null,
    { onUnauthorized: onSessionExpired, errorMessage: 'Laporan belum dapat dimuat.' },
  );

  const value = report.value;
  const average =
    value === null || value.transactionCount === 0
      ? 0
      : Math.round(value.totalSales / value.transactionCount);

  const exportCsv = async () => {
    if (rangeError !== null) return;
    await download.run('csv', async () => {
      await apiDownload(
        `/reports/sales.csv${buildQuery({ businessLineId: line.id, from, to })}`,
        `penjualan-${line.code}-${from}-${to}.csv`,
      );
    });
  };

  const applyPreset = (preset: { from: string; to: string }) => {
    setFrom(preset.from);
    setTo(preset.to);
    download.clear('csv');
  };

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Laporan</h1>
        <p className="meta">{line.name}</p>
      </div>

      <section className="section" aria-label="Rentang tanggal">
        <div className="toolbar">
          <div className="toolbar-filters">
            <div className="field">
              <label className="field-label" htmlFor="laporan-dari">
                Dari tanggal
              </label>
              <input
                id="laporan-dari"
                className="input"
                type="date"
                value={from}
                max={to}
                aria-invalid={rangeError !== null ? true : undefined}
                onChange={(event) => {
                  setFrom(event.target.value);
                  download.clear('csv');
                }}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="laporan-sampai">
                Sampai tanggal
              </label>
              <input
                id="laporan-sampai"
                className="input"
                type="date"
                value={to}
                min={from}
                aria-invalid={rangeError !== null ? true : undefined}
                onChange={(event) => {
                  setTo(event.target.value);
                  download.clear('csv');
                }}
              />
            </div>
          </div>

          {manages ? (
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary btn-tall"
                disabled={csvBusy || rangeError !== null}
                onClick={() => void exportCsv()}
              >
                {csvBusy ? 'Menyiapkan CSV…' : 'Unduh CSV'}
              </button>
            </div>
          ) : null}
        </div>

        <div className="chip-row" role="group" aria-label="Rentang cepat">
          {presets().map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="chip"
              aria-pressed={from === preset.from && to === preset.to}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {rangeError !== null ? (
          <p className="field-error" role="alert">
            {rangeError}
          </p>
        ) : (
          <p className="meta">
            Rentang {businessDate(from)} sampai {businessDate(to)} · {count(days ?? 0)} hari.
          </p>
        )}

        {csvFailure !== null ? (
          <div className="notice notice-error" role="alert">
            <p className="notice-title">Berkas CSV belum dapat diunduh.</p>
            <p className="meta">{csvFailure.message}</p>
            {csvFailure.status === 413 ? (
              <p className="meta">
                Rentang ini berisi lebih dari 10.000 transaksi dan tidak diekspor sebagian.
                Persempit rentang tanggalnya, misalnya per bulan, lalu unduh lagi.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="tabs" role="tablist" aria-label="Pengelompokan laporan">
        {visibleGroups.map((group) => (
          <button
            key={group.value}
            type="button"
            role="tab"
            id={`laporan-tab-${group.value}`}
            aria-selected={groupBy === group.value}
            aria-controls="laporan-panel"
            className="tab"
            onClick={() => setGroupBy(group.value)}
          >
            {group.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="laporan-panel"
        aria-labelledby={`laporan-tab-${groupBy}`}
        className="section"
      >
        {report.loading ? <LoadingBlock label="Memuat laporan…" /> : null}

        {report.forbidden ? (
          <EmptyBlock title="Akun ini tidak memiliki akses ke laporan unit usaha ini.">
            <p className="meta">
              Kasir hanya dapat melihat laporan per hari dan per metode pembayaran.
            </p>
          </EmptyBlock>
        ) : null}

        {report.error !== null ? (
          <ErrorBlock
            title="Laporan belum dapat dimuat."
            message={report.error}
            onRetry={report.reload}
          />
        ) : null}

        {value !== null ? (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <p className="stat-label">Pendapatan terkonfirmasi — bukan laba</p>
                <p className="stat-value money">{rupiah(value.totalSales)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Jumlah transaksi</p>
                <p className="stat-value">{count(value.transactionCount)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Rata-rata per transaksi</p>
                <p className="stat-value money">{rupiah(average)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Zona waktu perhitungan</p>
                <p className="stat-value">{value.timezone}</p>
              </div>
            </div>

            <p className="meta">
              Hanya transaksi lunas dengan pembayaran terkonfirmasi yang dihitung. Pembayaran yang
              masih menunggu, gagal, atau dibatalkan setelah lunas tidak termasuk. Angka ini
              pendapatan, bukan laba: biaya bahan dan operasional tidak diketahui sistem ini.
            </p>

            <ReportGroups
              line={line}
              groupBy={groupBy}
              report={value}
              loading={report.loading}
              onSessionExpired={onSessionExpired}
            />
          </>
        ) : null}
      </div>

      {salon ? null : <ReportInventory line={line} onSessionExpired={onSessionExpired} />}
    </main>
  );
}
