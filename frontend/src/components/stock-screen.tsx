'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/hooks/use-session';
import { useLookup } from '@/hooks/use-lookup';
import { canManage, isOwner } from '@/lib/nav';
import type { Product } from '@/lib/types';
import { StockLevels } from './stock-levels';
import { StockMovements } from './stock-movements';
import { StockMovementDialog } from './stock-movement-dialog';
import { ErrorBlock, Notice } from './states';

type Tab = 'levels' | 'movements';

const TABS: { value: Tab; label: string }[] = [
  { value: 'levels', label: 'Stok saat ini' },
  { value: 'movements', label: 'Riwayat pergerakan' },
];

/** One opening of the movement form. The token remounts it with fresh fields. */
type FormState = { token: number; productId: string };

/**
 * Stok: the stock levels of a kedai line and the ledger of every movement
 * behind them.
 *
 * Everyone who can open the line may read both lists; only owner and admin
 * may record a movement, and only an owner may record an adjustment. The
 * screen never writes what it shows: after a confirmed movement both lists
 * and the product reference are re-read from the server.
 */
export function StockScreen() {
  const { user, line, onSessionExpired } = useSession();

  const manages = canManage(user.role);
  const owner = isOwner(user.role);
  const salon = line.type === 'salon';

  const [tab, setTab] = useState<Tab>('levels');
  const [form, setForm] = useState<FormState | null>(null);
  const [revision, setRevision] = useState(0);

  // One read of the product list serves three jobs: the names on movement
  // rows (which may point at archived products, so no `active` filter here),
  // the product filter, and the options of the movement form. Stock levels
  // carry their own product names and do not depend on it.
  const products = useLookup<Product>(salon ? null : '/products', { businessLineId: line.id }, {
    onUnauthorized: onSessionExpired,
  });

  const tracked = useMemo(
    () => products.items.filter((product) => product.stockTracked && product.active),
    [products.items],
  );

  // The stock list also holds archived products, so a row's "Catat stok"
  // button can preselect one that the normal options exclude. Carrying it in
  // keeps the preselection honest instead of silently emptying the select.
  const preselected = form === null ? '' : form.productId;
  const options = useMemo(() => {
    if (preselected === '' || tracked.some((product) => product.id === preselected)) {
      return tracked;
    }
    const archived = products.items.find(
      (product) => product.id === preselected && product.stockTracked,
    );
    return archived === undefined ? tracked : [...tracked, archived];
  }, [tracked, products.items, preselected]);

  const productsReload = products.reload;
  const onRecorded = useCallback(() => {
    setForm(null);
    setRevision((value) => value + 1);
    // stockOnHand on the product reference moved too; the preview in the form
    // must not keep quoting the figure from before the movement.
    productsReload();
  }, [productsReload]);

  const openForm = useCallback((productId: string) => {
    setForm((current) => ({ token: (current?.token ?? 0) + 1, productId }));
  }, []);

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Stok</h1>
        <p className="meta">{line.name}</p>
      </div>

      {salon ? (
        <Notice tone="neutral" title={`${line.name} tidak memantau stok`}>
          <p className="meta">
            Stok hanya berlaku untuk produk kedai. Layanan salon tidak memiliki persediaan yang
            berkurang saat dijual, sehingga tidak ada catatan stok untuk unit usaha ini.
          </p>
          <p className="meta">
            Pilih unit usaha kedai di bagian atas halaman untuk melihat stok produknya.
          </p>
          <div className="btn-row">
            <Link className="btn btn-secondary" href="/kasir">
              Buka Kasir
            </Link>
          </div>
        </Notice>
      ) : (
        <>
          {manages ? (
            <div className="toolbar">
              <p className="meta">
                {owner
                  ? 'Penerimaan menambah stok; penyesuaian dapat menambah atau mengurangi.'
                  : 'Admin dapat mencatat penerimaan barang. Penyesuaian stok hanya oleh pemilik.'}
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary btn-tall"
                  onClick={() => openForm('')}
                >
                  {owner ? 'Catat penerimaan / penyesuaian' : 'Catat penerimaan'}
                </button>
              </div>
            </div>
          ) : null}

          {products.error !== null ? (
            <ErrorBlock
              title="Daftar produk belum dapat dimuat."
              message={`${products.error} Nama produk pada riwayat pergerakan ditampilkan sebagai kode.`}
              onRetry={products.reload}
            />
          ) : null}

          <div className="tabs" role="tablist" aria-label="Tampilan stok">
            {TABS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="tab"
                id={`stok-tab-${entry.value}`}
                aria-selected={tab === entry.value}
                aria-controls={`stok-panel-${entry.value}`}
                className="tab"
                onClick={() => setTab(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="stok-panel-levels"
            aria-labelledby="stok-tab-levels"
            hidden={tab !== 'levels'}
          >
            {tab === 'levels' ? (
              <StockLevels
                line={line}
                revision={revision}
                canRecord={manages}
                hasTrackedProducts={products.loading ? null : tracked.length > 0}
                onRecord={openForm}
                onSessionExpired={onSessionExpired}
              />
            ) : null}
          </div>

          <div
            role="tabpanel"
            id="stok-panel-movements"
            aria-labelledby="stok-tab-movements"
            hidden={tab !== 'movements'}
          >
            {tab === 'movements' ? (
              <StockMovements
                line={line}
                revision={revision}
                products={products}
                onSessionExpired={onSessionExpired}
              />
            ) : null}
          </div>

          {manages && form !== null ? (
            <StockMovementDialog
              key={form.token}
              line={line}
              owner={owner}
              products={options}
              productsLoading={products.loading}
              initialProductId={form.productId}
              onClose={() => setForm(null)}
              onRecorded={onRecorded}
              onSessionExpired={onSessionExpired}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
