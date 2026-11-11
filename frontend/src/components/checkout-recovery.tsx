'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { rupiah } from '@/lib/format';
import { RECORDS_CHECKED, type CheckoutPhase } from '@/hooks/use-checkout';
import { Notice } from './states';

/**
 * The recovery surface for a checkout whose outcome is unknown.
 *
 * It is rendered both inside the payment dialog and, persistently, on the
 * kasir page, so closing the dialog never hides the controls that can resolve
 * the sale. Closing anything here sends no request and abandons nothing.
 */
export function CheckoutRecovery({
  phase,
  onRetrySame,
  onAbandon,
}: {
  phase: CheckoutPhase;
  onRetrySame: () => void;
  onAbandon: (acknowledgement: typeof RECORDS_CHECKED) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const ackId = useId();

  if (phase.name === 'sending') {
    return (
      <Notice tone="warning" title="Mengirim pesanan ke server." live="polite">
        <p className="meta">
          Jangan menutup peramban sampai jawabannya diterima. Transaksi senilai{' '}
          {rupiah(phase.attempt.snapshot.total)} sedang diproses.
        </p>
      </Notice>
    );
  }

  if (phase.name !== 'unresolved' && phase.name !== 'conflict') return null;

  const conflict = phase.name === 'conflict';
  const manualReview = phase.failure.code === 'CHECKOUT_FORMAT_CHANGED';

  return (
    <div className="stack">
      <Notice
        tone="error"
        title={
          manualReview
            ? 'Permintaan lama perlu diperiksa'
            : conflict
              ? 'Server menolak permintaan ini karena bentrok keadaan'
              : 'Hasil permintaan pembayaran belum diketahui'
        }
        live="assertive"
      >
        <p className="meta">{phase.failure.message}</p>
        <p className="meta">
          Transaksi senilai {rupiah(phase.attempt.snapshot.total)} mungkin sudah tercatat di server,
          mungkin juga belum. Jangan membuat pesanan baru sebelum hal ini jelas.
        </p>
        {manualReview ? null : (
          <p className="meta">
            Tombol kirim ulang memakai kunci permintaan yang sama, sehingga server mengulang hasil
            aslinya dan tidak membuat transaksi kedua.
          </p>
        )}
        {phase.failure.requestId === undefined ? null : (
          <p className="meta">Kode permintaan: {phase.failure.requestId}</p>
        )}
        <div className="btn-row">
          {manualReview ? null : (
            <button type="button" className="btn btn-primary" onClick={onRetrySame}>
              Kirim ulang permintaan yang sama
            </button>
          )}
          <Link className="btn btn-secondary" href="/struk">
            Periksa daftar struk
          </Link>
        </div>
      </Notice>

      <details className="stack-sm">
        <summary>Permintaan ini sudah saya periksa dan tidak ada transaksinya</summary>
        <p className="meta">
          Membuang permintaan ini melepas kunci idempotensinya. Jika ternyata transaksinya memang
          tercatat, pesanan berikutnya akan menjadi transaksi kedua dan pelanggan dapat tertagih dua
          kali.
        </p>
        <label className="method-option" htmlFor={ackId}>
          <input
            id={ackId}
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span className="method-option-body">
            <span className="method-option-name">
              Saya sudah membuka daftar struk dan transaksi ini tidak ada di sana
            </span>
          </span>
        </label>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-danger"
            disabled={!acknowledged}
            onClick={() => {
              onAbandon(RECORDS_CHECKED);
              setAcknowledged(false);
            }}
          >
            Buang permintaan ini
          </button>
        </div>
      </details>
    </div>
  );
}
