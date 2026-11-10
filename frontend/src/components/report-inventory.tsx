'use client';

import { useState } from 'react';
import { count } from '@/lib/format';
import type { BusinessLine, InventoryItem } from '@/lib/types';
import { buildQuery, useResource } from '@/hooks/use-paged';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge } from './states';

type ReportInventoryProps = {
  line: BusinessLine;
  onSessionExpired: () => void;
};

function isLow(item: InventoryItem): boolean {
  return item.availableQuantity <= item.lowStockThreshold;
}

/**
 * Stock report for a kedai line: the same figures as the Stok screen, read
 * only, so a report printed for the owner carries what needs restocking.
 *
 * Never rendered for a salon line, where the backend refuses the endpoint.
 */
export function ReportInventory({ line, onSessionExpired }: ReportInventoryProps) {
  const [lowStock, setLowStock] = useState(false);

  const report = useResource<{ data: InventoryItem[] }>(
    `/reports/inventory${buildQuery({
      businessLineId: line.id,
      lowStock: lowStock ? true : undefined,
    })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Laporan stok belum dapat dimuat.' },
  );

  const items = report.value?.data ?? [];
  const lowCount = items.filter(isLow).length;

  return (
    <section className="section" aria-labelledby="laporan-stok-judul">
      <h2 className="section-title" id="laporan-stok-judul">
        Laporan stok
      </h2>

      <div className="chip-row" role="group" aria-label="Saring laporan stok">
        <button
          type="button"
          className="chip"
          aria-pressed={lowStock}
          onClick={() => setLowStock((value) => !value)}
        >
          Hanya stok menipis
        </button>
      </div>

      {report.loading ? <LoadingBlock label="Memuat laporan stok…" /> : null}

      {report.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke laporan stok unit usaha ini." />
      ) : null}

      {report.error !== null ? (
        <ErrorBlock
          title="Laporan stok belum dapat dimuat."
          message={report.error}
          onRetry={report.reload}
        />
      ) : null}

      {report.value !== null ? (
        <p className="meta" role="status">
          {count(items.length)} produk dipantau pada daftar ini, {count(lowCount)} di antaranya
          menipis.
        </p>
      ) : null}

      {report.value !== null && items.length === 0 ? (
        <EmptyBlock
          title={
            lowStock
              ? 'Tidak ada produk yang stoknya menipis saat ini.'
              : 'Belum ada produk yang stoknya dipantau.'
          }
        >
          <p className="meta">
            Pemantauan stok diaktifkan per produk di halaman Katalog. Rinciannya, termasuk
            pencatatan penerimaan dan penyesuaian, ada di halaman Stok.
          </p>
        </EmptyBlock>
      ) : null}

      {items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={report.loading}>
            <caption className="sr-only">Laporan stok {line.name}</caption>
            <thead>
              <tr>
                <th scope="col">Produk</th>
                <th scope="col" className="num">
                  Stok fisik
                </th>
                <th scope="col" className="num">
                  Ditahan
                </th>
                <th scope="col" className="num">
                  Tersedia
                </th>
                <th scope="col" className="num">
                  Ambang menipis
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <th scope="row">{item.productName}</th>
                  <td className="num">{count(item.quantity)}</td>
                  <td className="num">{count(item.reservedQuantity)}</td>
                  <td className="num">{count(item.availableQuantity)}</td>
                  <td className="num">{count(item.lowStockThreshold)}</td>
                  <td>
                    {isLow(item) ? (
                      <StatusBadge label="Menipis" tone="warning" />
                    ) : (
                      <span className="muted">Cukup</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
