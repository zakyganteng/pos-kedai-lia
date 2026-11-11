'use client';

import { useMemo } from 'react';
import { businessDate, count, paymentMethodLabel, rupiah, shortId } from '@/lib/format';
import type { BusinessLine, ReportGroupBy, SalesReport } from '@/lib/types';
import { useLookup } from '@/hooks/use-lookup';
import { EmptyBlock } from './states';

type NamedRecord = { id: string; name: string };

type ReportGroupsProps = {
  line: BusinessLine;
  groupBy: ReportGroupBy;
  report: SalesReport;
  loading: boolean;
  onSessionExpired: () => void;
};

const KEY_HEADER: Record<ReportGroupBy, string> = {
  day: 'Tanggal',
  paymentMethod: 'Metode pembayaran',
  item: 'Item',
};

function percentText(share: number): string {
  return `${(share * 100).toFixed(1).replace('.', ',')}%`;
}

/**
 * The grouped rows of a sales report, each with its share of the total.
 *
 * Ids are resolved to names through the catalogue, read
 * without an `active` filter so an item sold before it was archived still
 * shows the name it was sold under rather than a bare id.
 */
export function ReportGroups({
  line,
  groupBy,
  report,
  loading,
  onSessionExpired,
}: ReportGroupsProps) {
  const salon = line.type === 'salon';

  const itemResource = groupBy === 'item' ? (salon ? '/services' : '/products') : null;
  const items = useLookup<NamedRecord>(itemResource, { businessLineId: line.id }, {
    onUnauthorized: onSessionExpired,
  });

  const rows = useMemo(() => {
    const groups = report.groups.slice();
    // The backend orders by key, which reads correctly for days. For the other
    // groupings the useful order is largest first.
    if (groupBy !== 'day') groups.sort((left, right) => right.amount - left.amount);
    return groups;
  }, [report.groups, groupBy]);

  const label = (key: string): string => {
    if (groupBy === 'day') return businessDate(key);
    if (groupBy === 'paymentMethod') return paymentMethodLabel(key);
    return items.byId.get(key)?.name ?? shortId(key);
  };

  const lookupTruncated = groupBy === 'item' && items.truncated;
  const lookupError = groupBy === 'item' ? items.error : null;

  if (rows.length === 0) {
    return (
      <EmptyBlock title="Belum ada penjualan terkonfirmasi pada rentang ini.">
        <p className="meta">
          Coba rentang tanggal lain, atau periksa halaman Struk untuk transaksi yang pembayarannya
          masih menunggu.
        </p>
      </EmptyBlock>
    );
  }

  return (
    <>
      {lookupError !== null ? (
        <p className="meta">
          Nama item belum dapat dimuat ({lookupError}), sehingga
          sebagian baris ditampilkan sebagai kode.
        </p>
      ) : null}
      {lookupTruncated ? (
        <p className="meta">
          Daftar rujukan terlalu panjang untuk dimuat seluruhnya; sebagian nama ditampilkan sebagai
          kode.
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="data-table" aria-busy={loading}>
          <caption className="sr-only">
            Penjualan {line.name} {report.from} sampai {report.to}
          </caption>
          <thead>
            <tr>
              <th scope="col">{KEY_HEADER[groupBy]}</th>
              <th scope="col" className="num">
                Pendapatan
              </th>
              <th scope="col" className="num">
                Transaksi
              </th>
              <th scope="col">Porsi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => {
              const share = report.totalSales > 0 ? group.amount / report.totalSales : 0;
              return (
                <tr key={group.key}>
                  <th scope="row">{label(group.key)}</th>
                  <td className="num money">{rupiah(group.amount)}</td>
                  <td className="num">{count(group.count)}</td>
                  <td>
                    <span className="meta">{percentText(share)}</span>
                    <div className="bar-track" aria-hidden="true">
                      <div className="bar-fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
