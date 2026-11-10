'use client';

import { useSession } from '@/hooks/use-session';
import { canManage } from '@/lib/nav';
import { PersonAdmin } from './person-admin';

/**
 * Staf: the per-line roster of people a salon service can be attributed to.
 *
 * Every role may read the list, since the kasir and antrean screens pick from
 * it. Only an owner or admin may add, edit or archive, so a cashier sees the
 * rows read-only instead of buttons the backend would refuse.
 */
export function StaffScreen() {
  const { user, line, onSessionExpired } = useSession();
  const manages = canManage(user.role);

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Staf</h1>
        <p className="meta">{line.name}</p>
      </div>

      <p className="meta">
        Staf dicatat pada layanan salon: satu staf dapat dipilih saat menambah antrean dan saat
        menyelesaikan pembayaran di kasir, lalu muncul pada laporan penjualan per staf. Produk
        kedai tidak membawa atribusi staf.
      </p>
      {manages ? null : (
        <p className="meta">
          Akun kasir dapat melihat daftar ini. Penambahan, perubahan dan pengarsipan staf
          dilakukan pemilik atau admin.
        </p>
      )}

      <PersonAdmin
        line={line}
        resource="/staff"
        noun="staf"
        idPrefix="staf"
        withPhone={false}
        canCreate={manages}
        canEdit={manages}
        onSessionExpired={onSessionExpired}
      />
    </main>
  );
}
