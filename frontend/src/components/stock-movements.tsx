'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { count, dateTime, movementTypeLabel, shortId } from '@/lib/format';
import type { BusinessLine, InventoryMovement, Product } from '@/lib/types';
import type { LookupResult } from '@/hooks/use-lookup';
import { buildQuery, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Pager } from './pager';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './states';

const PAGE_SIZE = 20;

type StockMovementsProps = {
  line: BusinessLine;
  revision: number;
  /** Every product of the line, archived ones included, for names and filter. */
  products: LookupResult<Product>;
  onSessionExpired: () => void;
};

/** Signed amount: the sign carries the meaning, the colour only repeats it. */
function deltaText(delta: number): string {
  return `${delta < 0 ? '\u2212' : '+'}${count(Math.abs(delta))}`;
}

/**
 * The stock ledger: every receipt, adjustment, sale and reversal that moved
 * this line's stock, newest first as the backend returns it.
 */
export function StockMovements({
  line,
  revision,
  products,
  onSessionExpired,
}: StockMovementsProps) {
  const [productId, setProductId] = useState('');
  const [page, setPage] = useFilteredPage(`${line.id}\u0000${productId}`);

  const list = usePaged<InventoryMovement>(
    `/inventory/movements${buildQuery({
      businessLineId: line.id,
      page,
      limit: PAGE_SIZE,
      productId: productId || undefined,
    })}`,
    {
      onUnauthorized: onSessionExpired,
      errorMessage: 'Riwayat pergerakan stok belum dapat dimuat.',
    },
  );

  const reload = list.reload;
  const seenRevision = useRef(revision);
  useEffect(() => {
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    reload();
  }, [revision, reload]);

  const options = useMemo(
    () =>
      products.items
        .filter((product) => product.stockTracked)
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, 'id-ID')),
    [products.items],
  );

  const byId = products.byId;
  const empty =
    !list.loading && list.error === null && !list.forbidden && list.items.length === 0;

  return (
    <section className="section" aria-label="Riwayat pergerakan stok">
      <div className="toolbar-filters">
        <div className="field">
          <label className="field-label" htmlFor="pergerakan-produk">
            Produk
          </label>
          <select
            id="pergerakan-produk"
            className="select"
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">Semua produk</option>
            {options.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
                {product.active ? '' : ' (diarsipkan)'}
              </option>
            ))}
          </select>
          {products.truncated ? (
            <p className="field-hint">
              Daftar produk terlalu panjang untuk dimuat seluruhnya; sebagian nama ditampilkan
              sebagai kode.
            </p>
          ) : null}
        </div>
      </div>

      {list.loading ? (
        <LoadingBlock
          label={list.initial ? 'Memuat pergerakan stok…' : 'Memperbarui riwayat pergerakan…'}
        />
      ) : null}

      {list.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke riwayat stok unit usaha ini." />
      ) : null}

      {list.error !== null ? (
        <ErrorBlock
          title="Riwayat pergerakan stok belum dapat dimuat."
          message={list.error}
          onRetry={list.reload}
        />
      ) : null}

      {empty ? (
        <EmptyBlock
          title={
            productId === ''
              ? 'Belum ada pergerakan stok pada unit usaha ini.'
              : 'Belum ada pergerakan stok untuk produk ini.'
          }
        />
      ) : null}

      {list.items.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table" aria-busy={list.loading}>
            <caption className="sr-only">Pergerakan stok {line.name}</caption>
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Produk</th>
                <th scope="col">Jenis</th>
                <th scope="col" className="num">
                  Perubahan
                </th>
                <th scope="col">Alasan</th>
                <th scope="col">Dicatat oleh</th>
                <th scope="col">Transaksi</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((movement) => {
                const product = byId.get(movement.productId);
                const negative = movement.quantityDelta < 0;
                return (
                  <tr key={movement.id}>
                    <td>{dateTime(movement.createdAt)}</td>
                    <th scope="row">
                      {product ? (
                        product.name
                      ) : (
                        <span className="mono">{shortId(movement.productId)}</span>
                      )}
                    </th>
                    <td>{movementTypeLabel(movement.type)}</td>
                    <td
                      className="num"
                      style={{ color: negative ? 'var(--error)' : 'var(--success)' }}
                    >
                      {deltaText(movement.quantityDelta)}
                    </td>
                    <td>{movement.reason}</td>
                    <td className="mono muted">{shortId(movement.actorId)}</td>
                    <td>
                      {movement.saleId ? (
                        <Link className="mono" href={`/struk/${movement.saleId}`}>
                          <span className="sr-only">Buka struk </span>
                          {shortId(movement.saleId)}
                        </Link>
                      ) : (
                        <span className="muted">—</span>
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
        label="Halaman riwayat pergerakan stok"
        page={page}
        pagination={list.pagination}
        loading={list.loading}
        onPage={setPage}
      />
    </section>
  );
}
