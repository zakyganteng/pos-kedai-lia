'use client';

import { useSession } from '@/hooks/use-session';
import { canManage } from '@/lib/nav';
import { PersonAdmin } from './person-admin';

/**
 * Pelanggan: the per-line customer roster.
 *
 * Every role may look one up and add one, because a cashier meets a new
 * customer at the counter. Only an owner or admin may edit or archive, which
 * is exactly what the backend enforces, so a cashier sees the rows read-only
 * rather than buttons that would be refused.
 */
export function CustomerScreen() {
  const { user, line, onSessionExpired } = useSession();
  const manages = canManage(user.role);

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Pelanggan</h1>
        <p className="meta">{line.name}</p>
      </div>

      <p className="meta">
        Pelanggan dipakai untuk menandai transaksi di kasir dan antrean salon. Nomor telepon
        bersifat opsional dan harus unik pada unit usaha ini.
        {manages ? '' : ' Akun kasir dapat menambah pelanggan, sedangkan perubahan dan pengarsipan dilakukan pemilik atau admin.'}
      </p>

      <PersonAdmin
        line={line}
        resource="/customers"
        noun="pelanggan"
        idPrefix="pelanggan"
        withPhone
        canCreate
        canEdit={manages}
        onSessionExpired={onSessionExpired}
      />
    </main>
  );
}
