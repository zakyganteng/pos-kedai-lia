'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/hooks/use-session';
import { useAllCategories } from '@/hooks/use-categories';
import { CategoryPanel } from './category-panel';
import { ProductCategoryPanel } from './product-category-panel';
import { Notice, PermissionBlock } from './states';

/**
 * Katalog: create, rename, archive and restore the categories of one business
 * line, and put each product into one.
 *
 * Nothing here is cached between visits. Returning to Kasir re-reads the
 * category list, so a name changed on this screen is the name on the filter
 * chips, and a category archived here is gone from them.
 */
export function KatalogScreen() {
  const { user, line, onSessionExpired } = useSession();

  const manages = user.role === 'owner' || user.role === 'admin';
  const salon = line.type === 'salon';
  const enabled = manages && !salon;

  // Two counters, each telling the other panel that the server state it shows
  // has moved: a rename changes the labels products are assigned to, and an
  // assignment changes the product count a category is archived on.
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

  const onAssignmentChanged = useCallback(() => {
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
        <Notice tone="neutral" title={`${line.name} tidak menggunakan kategori`}>
          <p className="meta">
            Kategori hanya berlaku untuk produk kedai. Layanan salon dipilih langsung dari
            daftarnya di halaman kasir.
          </p>
          <p className="meta">
            Beralihlah ke unit usaha kedai lewat pilihan di bagian atas halaman untuk mengatur
            kategori produknya.
          </p>
          <div className="btn-row">
            <Link className="btn btn-secondary" href="/kasir">
              Buka Kasir
            </Link>
          </div>
        </Notice>
      ) : (
        <div className="katalog">
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
            onChanged={onAssignmentChanged}
            onSessionExpired={onSessionExpired}
          />
        </div>
      )}
    </main>
  );
}
