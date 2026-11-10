'use client';

import { useCallback, useState } from 'react';
import { useSession } from '@/hooks/use-session';
import { useAllCategories } from '@/hooks/use-categories';
import { CategoryPanel } from './category-panel';
import { ProductAdminPanel } from './product-admin-panel';
import { ProductCategoryPanel } from './product-category-panel';
import { ServiceAdminPanel } from './service-admin-panel';
import { PermissionBlock } from './states';

const TABS = [
  { id: 'kategori', label: 'Kategori' },
  { id: 'produk', label: 'Produk' },
];

/**
 * Katalog: what a business line sells.
 *
 * A kedai line keeps products and the categories they are filed under, split
 * across two tabs so neither list has to fight the other for the width. A
 * salon line has no categories at all, so it gets its service list instead.
 *
 * Nothing here is cached between visits. Returning to Kasir re-reads the
 * catalogue, so a price changed on this screen is the price charged, and an
 * item archived here is gone from the till.
 */
export function KatalogScreen() {
  const { user, line, onSessionExpired } = useSession();

  const manages = user.role === 'owner' || user.role === 'admin';
  const salon = line.type === 'salon';
  const enabled = manages && !salon;

  // The category tab is the default: it is where the two panels that have
  // always lived on this screen are, and it is the shorter of the two jobs.
  const [tab, setTab] = useState('kategori');

  // Two counters, each telling the other tab that the server state it shows
  // has moved: a rename changes the labels products are filed under, and a
  // product write changes the count a category may be archived on.
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [productRevision, setProductRevision] = useState(0);

  // Passing null keeps the request from being made at all for a salon line or
  // a cashier, rather than making it and hiding the answer.
  const catalogue = useAllCategories(enabled ? line.id : null, {
    onUnauthorized: onSessionExpired,
  });

  const reloadCatalogue = catalogue.reload;

  const onCategoryChanged = useCallback(() => {
    reloadCatalogue();
    setProductRevision((value) => value + 1);
  }, [reloadCatalogue]);

  const onProductChanged = useCallback(() => {
    reloadCatalogue();
    setCategoryRevision((value) => value + 1);
  }, [reloadCatalogue]);

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Katalog</h1>
        <p className="meta">{line.name}</p>
      </div>

      {!manages ? (
        <PermissionBlock>
          Pengaturan katalog hanya dapat dibuka oleh pemilik dan admin. Akun {user.name} dapat
          menggunakan halaman Kasir dan Struk.
        </PermissionBlock>
      ) : salon ? (
        <ServiceAdminPanel line={line} onSessionExpired={onSessionExpired} />
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Bagian katalog">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`katalog-tab-${entry.id}`}
                className="tab"
                aria-selected={tab === entry.id}
                aria-controls={`katalog-panel-${entry.id}`}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {/* Only the chosen tab is mounted. A hidden list that keeps polling
              and keeps its own page number would answer for state the user
              cannot see; re-entering a tab simply re-reads the server. */}
          {tab === 'kategori' ? (
            <div
              className="katalog"
              role="tabpanel"
              id="katalog-panel-kategori"
              aria-labelledby="katalog-tab-kategori"
            >
              <CategoryPanel
                line={line}
                revision={categoryRevision}
                onChanged={onCategoryChanged}
                onSessionExpired={onSessionExpired}
              />
              <ProductCategoryPanel
                line={line}
                catalogue={catalogue}
                revision={productRevision}
                onChanged={onProductChanged}
                onSessionExpired={onSessionExpired}
              />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="katalog-panel-produk"
              aria-labelledby="katalog-tab-produk"
            >
              <ProductAdminPanel
                line={line}
                catalogue={catalogue}
                revision={productRevision}
                onChanged={onProductChanged}
                onSessionExpired={onSessionExpired}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}
