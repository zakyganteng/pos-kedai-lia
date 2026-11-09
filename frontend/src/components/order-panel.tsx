'use client';

import { useState } from 'react';
import { rupiah } from '@/lib/format';
import type { BusinessLine, Staff } from '@/lib/types';
import type { DraftApi } from '@/hooks/use-draft';
import { MAX_QUANTITY, MIN_QUANTITY } from '@/hooks/use-draft';
import { buildQuery, useDebounced, usePaged } from '@/hooks/use-paged';
import { CustomerPicker } from './customer-picker';
import { Dialog } from './dialog';

const STAFF_PAGE_SIZE = 50;

type OrderPanelProps = {
  line: BusinessLine;
  draft: DraftApi;
  onCheckout: () => void;
  checkoutDisabled: boolean;
  locked: boolean;
  checkoutBlockedReason: string | null;
  onBackToCatalog: () => void;
  onSessionExpired: () => void;
};

export function OrderPanel({
  line, draft, onCheckout, checkoutDisabled, locked, checkoutBlockedReason,
  onBackToCatalog, onSessionExpired,
}: OrderPanelProps) {
  const salon = line.type === 'salon';
  const [customerOpen, setCustomerOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const settledStaffSearch = useDebounced(staffSearch);
  const staff = usePaged<Staff>(
    salon ? `/staff${buildQuery({
      businessLineId: line.id, active: true, page: 1, limit: STAFF_PAGE_SIZE,
      search: settledStaffSearch.trim() || undefined,
    })}` : null,
    { onUnauthorized: onSessionExpired, errorMessage: 'Daftar staf belum dapat dimuat.' },
  );
  const staffTotal = staff.pagination?.total ?? staff.items.length;
  const staffTruncated = staffTotal > staff.items.length;
  const hasServiceItems = draft.draft.items.some(item => item.itemType === 'service');

  return (
    <section className="checkout-order panel" aria-labelledby="order-heading">
      <div className="order-head">
        <div>
          <h2 className="section-title" id="order-heading">Pesanan</h2>
          <span className="meta">{draft.itemCount} item</span>
        </div>
        <button type="button" className="btn btn-secondary back-to-catalog" onClick={onBackToCatalog}>
          Kembali ke katalog
        </button>
      </div>

      <div className="order-content stack" role="region" aria-label="Item dan pelanggan pesanan" tabIndex={0}>
        {salon && hasServiceItems && !staff.forbidden ? (
          <div className="field">
            <label className="field-label" htmlFor="staff-search">Cari staf</label>
            <input id="staff-search" className="input" type="search" autoComplete="off"
              value={staffSearch} disabled={locked} onChange={event => setStaffSearch(event.target.value)} />
            <span className="field-hint">
              {staffTruncated
                ? `Menampilkan ${staff.items.length} dari ${staffTotal} staf. Persempit pencarian untuk menemukan staf lainnya.`
                : `Menampilkan seluruh ${staffTotal} staf aktif unit usaha ini.`}
            </span>
          </div>
        ) : null}

        {draft.isEmpty ? (
          <p className="meta">Belum ada item. Pilih produk atau layanan untuk memulai.</p>
        ) : (
          <ul className="order-lines">
            {draft.draft.items.map(item => (
              <li className="order-line" key={item.itemId}>
                <span className="order-line-name">{item.name}</span>
                <span className="order-line-total money">{rupiah(item.unitPrice * item.quantity)}</span>
                <span className="meta" style={{ gridColumn: '1 / -1' }}>{rupiah(item.unitPrice)} per item</span>
                <div className="order-line-controls">
                  <div className="field">
                    <label className="field-label" htmlFor={`qty-${item.itemId}`}>Jumlah</label>
                    <div className="stepper">
                      <button type="button" aria-label={`Kurangi jumlah ${item.name}`}
                        disabled={locked || item.quantity <= MIN_QUANTITY}
                        onClick={() => draft.setQuantity(item.itemId, item.quantity - 1)}>
                        <span aria-hidden="true">&minus;</span>
                      </button>
                      <input id={`qty-${item.itemId}`} type="number" inputMode="numeric"
                        min={MIN_QUANTITY} max={MAX_QUANTITY} step={1} value={item.quantity}
                        disabled={locked} aria-label={`Jumlah ${item.name}`}
                        onChange={event => {
                          const next = Number.parseInt(event.target.value, 10);
                          if (!Number.isNaN(next)) draft.setQuantity(item.itemId, next);
                        }} />
                      <button type="button" aria-label={`Tambah jumlah ${item.name}`}
                        disabled={locked || item.quantity >= MAX_QUANTITY}
                        onClick={() => draft.setQuantity(item.itemId, item.quantity + 1)}>
                        <span aria-hidden="true">+</span>
                      </button>
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary remove-item"
                    aria-label={`Hapus ${item.name}`} disabled={locked}
                    onClick={() => draft.removeItem(item.itemId)}>Hapus</button>
                </div>
                {salon && item.itemType === 'service' ? (
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label className="field-label" htmlFor={`staff-${item.itemId}`}>Staf untuk {item.name}</label>
                    <select id={`staff-${item.itemId}`} className="select" value={item.staffId ?? ''}
                      disabled={locked || staff.forbidden || (staff.loading && staff.initial)}
                      onChange={event => {
                        const id = event.target.value;
                        const chosen = staff.items.find(entry => entry.id === id);
                        draft.setStaff(item.itemId, id === '' ? null : id, chosen?.name ?? null);
                      }}>
                      <option value="">Tanpa staf</option>
                      {staff.items.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                    </select>
                    {staff.forbidden ? <span className="field-hint">Akun ini tidak memiliki akses daftar staf; layanan dikirim tanpa atribusi staf.</span> : null}
                    {staff.error !== null ? (
                      <span className="field-hint">{staff.error}{' '}
                        <button type="button" className="btn btn-secondary" onClick={staff.reload}>Coba lagi</button>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <div className="stack-sm">
          <span className="field-label">Pelanggan (opsional)</span>
          <span>{draft.draft.customerName ?? 'Tanpa pelanggan'}</span>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => setCustomerOpen(true)}>
              {draft.draft.customerId === null ? 'Pilih pelanggan' : 'Ganti pelanggan'}
            </button>
            {draft.draft.customerId === null ? null : (
              <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => draft.setCustomer(null, null)}>
                Lepas pelanggan
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="order-summary stack-sm">
        <div className="order-total-row">
          <span className="order-total-label">Total sementara</span>
          <span className="order-total-value money">{rupiah(draft.total)}</span>
        </div>
        <p className="meta">Total akhir dihitung oleh server saat pembayaran.</p>
        {checkoutBlockedReason !== null && locked ? <p className="field-error" role="status">{checkoutBlockedReason}</p> : null}
        <button type="button" className="btn btn-primary btn-pay" onClick={onCheckout} disabled={checkoutDisabled}>
          Lanjut ke pembayaran
        </button>
        {draft.isEmpty ? null : (
          <button type="button" className="btn btn-secondary" disabled={locked} onClick={() => setClearOpen(true)}>
            Kosongkan pesanan
          </button>
        )}
      </div>

      <CustomerPicker open={customerOpen} lineId={line.id} selectedId={draft.draft.customerId}
        onPick={draft.setCustomer} onClose={() => setCustomerOpen(false)} onSessionExpired={onSessionExpired} />
      <Dialog open={clearOpen} title="Kosongkan pesanan?" onClose={() => setClearOpen(false)} footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={() => setClearOpen(false)}>Simpan pesanan</button>
          <button type="button" className="btn btn-danger" onClick={() => {
            if (!locked) draft.clear();
            setClearOpen(false);
          }}>Ya, kosongkan pesanan</button>
        </>
      }>
        <p>{draft.itemCount} item akan dihapus dari pesanan ini. Tidak ada transaksi atau pembayaran yang dibatalkan.</p>
      </Dialog>
    </section>
  );
}
