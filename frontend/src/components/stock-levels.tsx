'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { count } from '@/lib/format';
import type { BusinessLine, InventoryItem } from '@/lib/types';
import { buildQuery, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Pager } from './pager';
import { EmptyBlock, ErrorBlock, LoadingBlock, StatusBadge } from './states';

const PAGE_SIZE = 20;

type StockLevelsProps = {
  line: BusinessLine;
  /** Bumped by the screen after the server confirms a movement. */
  revision: number;
  /** Owner and admin may record a movement for a row. */
  canRecord: boolean;
  /** Null while the product reference is still loading. */
  hasTrackedProducts: boolean | null;
  onRecord: (productId: string) => void;
  onSessionExpired: () => void;
};

/** A product is low when nothing more than its threshold is still sellable. */
function isLow(item: InventoryItem): boolean {
  return item.availableQuantity <= item.lowStockThreshold;
}

/**
 * Current stock per product: what is physically on hand, what QRIS payments
 * in flight are holding, and what is left to sell.
 */
export function StockLevels({
  line,
  revision,
  canRecord,
  hasTrackedProducts,
  onRecord,
  onSessionExpired,
}: StockLevelsProps) {
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useFilteredPage(`${line.id}\u0000${lowStock}`);

  const list = usePaged<InventoryItem>(
    `/inventory${buildQuery({
      businessLineId: line.id,
      page,
      limit: PAGE_SIZE,
      lowStock: lowStock ? true : undefined,
    })}`,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar stok belum dapat dimuat.' },
  );

  // A movement recorded on this screen changes these numbers, so the page is
  // read again instead of being adjusted locally. The first render already
  // holds a fresh read, so only later revisions trigger one.
  const reload = list.reload;
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    reload();
  }, [revision, reload]);

  const empty =
    !list.loading && list.error === null && !list.forbidden && list.items.length === 0;

  return (
    <section className="section" aria-label="Stok saat ini">
      <div className="chip-row" role="group" aria-label="Saring daftar stok">
        <button
          type="button"
          className="chip"
          aria-pressed={lowStock}
          onClick={() => setLowStock((value) => !value)}
        >
          Hanya stok menipis
        </button>
      </div>

      <p className="meta">
        Tersedia adalah stok fisik dikurangi jumlah yang sedang ditahan oleh pembayaran QRIS yang
        belum selesai.
      </p>

      {list.loading ? (
        <LoadingBlock label={list.initial ? 'Memuat stok…' : 'Memperbarui daftar stok…'} />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke stok unit usaha ini." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title="Daftar stok belum dapat dimuat."
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {empty && lowStock ? (
        <EmptyBlock title="Tidak ada produk yang stoknya menipis saat ini.">
          <p className="meta">Matikan saringan untuk melihat seluruh produk yang dipantau.</p>
        </EmptyBlock>
      ) : null}

      {empty && !lowStock ? (
        <EmptyBlock title="Belum ada produk yang stoknya dipantau.">
          <p className="meta">
            Pemantauan stok diaktifkan per produk di halaman Katalog, lewat pilihan &ldquo;pantau
            stok&rdquo; pada produk. Hanya pemilik dan admin yang dapat mengubahnya.
          </p>
          {hasTrackedProducts === true ? (
            <p className="meta">
              Produk yang dipantau sudah ada, tetapi catatan stoknya belum terbentuk. Catat
              penerimaan pertama untuk produk tersebut.
            </p>
          ) : null}
          {canRecord ? (
            <div className="btn-row">
              <Link className="btn btn-secondary" href="/katalog">
                Buka Katalog
              </Link>
            </div>
          ) : null}
        </EmptyBlock>
      ) : null}

      {list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={list.loading}>
            <caption className="sr-only">Stok produk {line.name}</caption>
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
                {canRecord ? (
                  <th scope="col" className="actions">
                    Tindakan
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
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
                  {canRecord ? (
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => onRecord(item.productId)}
                      >
                        Catat stok
                        <span className="sr-only"> untuk {item.productName}</span>
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pager
        label="Halaman daftar stok"
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />
    </section>
  );
}
