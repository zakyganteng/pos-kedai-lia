'use client';

import { useState } from 'react';
import type { Customer } from '@/lib/types';
import { buildQuery, useDebounced, useFilteredPage, usePaged } from '@/hooks/use-paged';
import { Dialog } from './dialog';
import { EmptyBlock, ErrorBlock, LoadingBlock } from './states';

const PAGE_SIZE = 10;

type CustomerPickerProps = {
  open: boolean;
  lineId: string;
  selectedId: string | null;
  onPick: (customerId: string | null, customerName: string | null) => void;
  onClose: () => void;
  onSessionExpired: () => void;
};

export function CustomerPicker({
  open,
  lineId,
  selectedId,
  onPick,
  onClose,
  onSessionExpired,
}: CustomerPickerProps) {
  const [search, setSearch] = useState('');
  const settled = useDebounced(search);
  const [page, setPage] = useFilteredPage(`${lineId}\u0000${settled}`);

  const query = buildQuery({
    businessLineId: lineId,
    active: true,
    page,
    limit: PAGE_SIZE,
    search: settled.trim() || undefined,
  });
  const customers = usePaged<Customer>(open ? `/customers${query}` : null, {
    onUnauthorized: onSessionExpired,
    errorMessage: 'Daftar pelanggan belum dapat dimuat.',
  });

  const totalPages = customers.pagination?.totalPages ?? 1;

  return (
    <Dialog
      open={open}
      title="Pilih pelanggan"
      description="Pelanggan bersifat opsional. Transaksi tetap dapat diselesaikan tanpa memilih pelanggan."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              onPick(null, null);
              onClose();
            }}
          >
            Tanpa pelanggan
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="customer-search">
          Cari nama atau nomor telepon
        </label>
        <input
          id="customer-search"
          className="input"
          type="search"
          autoComplete="off"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {customers.loading && customers.initial ? <LoadingBlock label="Memuat pelanggan…" /> : null}

      {customers.forbidden ? (
        <EmptyBlock title="Akun ini tidak memiliki akses ke data pelanggan." />
      ) : null}

      {customers.error !== null ? (
        <ErrorBlock
          title="Daftar pelanggan belum dapat dimuat."
          message={customers.error}
          onRetry={customers.reload}
        />
      ) : null}

      {!customers.loading &&
      customers.error === null &&
      !customers.forbidden &&
      customers.items.length === 0 ? (
        <EmptyBlock
          title={
            settled.trim() === ''
              ? 'Belum ada pelanggan tersimpan pada unit usaha ini.'
              : 'Tidak ada hasil untuk pencarian ini.'
          }
        />
      ) : null}

      {customers.items.length > 0 ? (
        <ul className="record-list">
          {customers.items.map((customer) => {
            const current = customer.id === selectedId;
            return (
              <li key={customer.id}>
                <button
                  type="button"
                  className="catalog-item"
                  aria-pressed={current}
                  onClick={() => {
                    onPick(customer.id, customer.name);
                    onClose();
                  }}
                >
                  <span className="catalog-item-name">
                    {current ? '\u2713 ' : ''}
                    {customer.name}
                  </span>
                  <span className="meta">{customer.phone ?? 'Tanpa nomor telepon'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {totalPages > 1 ? (
        <nav className="pager" aria-label="Halaman daftar pelanggan">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(page - 1)}
            disabled={page <= 1 || customers.loading}
          >
            Sebelumnya
          </button>
          <span className="meta" role="status">
            Halaman {customers.pagination?.page ?? page} dari {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || customers.loading}
          >
            Berikutnya
          </button>
        </nav>
      ) : null}
    </Dialog>
  );
}
