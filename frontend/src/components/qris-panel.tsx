'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { dateTime, paymentLabel } from '@/lib/format';
import type { Payment } from '@/lib/types';
import { Notice, StatusBadge, paymentTone } from './states';

/**
 * Payload markers used by non production gateways.
 *
 * The first is produced by the repository's own mock gateway fixture; the
 * second is the prefix a mock build may use. Anything else is rendered without
 * any claim about where it came from, because the POS cannot verify that.
 */
const DEVELOPMENT_MARKERS = ['TEST-ONLY-NOT-A-PAYABLE-QR:', 'MOCK'];

function looksLikeDevelopmentPayload(content: string): boolean {
  const upper = content.trim().toUpperCase();
  return DEVELOPMENT_MARKERS.some((marker) => upper.startsWith(marker));
}

type QrisPanelProps = {
  payment: Payment;
  polling: boolean;
  statusCheckFailed: boolean;
  onCheckNow: () => void;
};

export function QrisPanel({ payment, polling, statusCheckFailed, onCheckNow }: QrisPanelProps) {
  const content = payment.qrContent ?? null;
  const [rendered, setRendered] = useState<{ content: string; url: string | null } | null>(null);

  useEffect(() => {
    if (content === null) return;
    let stale = false;
    QRCode.toDataURL(content, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      // Pure black on white keeps scanner contrast at its best.
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!stale) setRendered({ content, url });
      })
      .catch(() => {
        if (!stale) setRendered({ content, url: null });
      });
    return () => {
      stale = true;
    };
  }, [content]);

  const url = rendered !== null && rendered.content === content ? rendered.url : null;
  const developmentPayload = content !== null && looksLikeDevelopmentPayload(content);

  return (
    <section className="stack" aria-labelledby="qris-heading">
      <h2 className="section-title" id="qris-heading">
        Pembayaran QRIS
      </h2>

      <p>
        <StatusBadge label={paymentLabel(payment.status)} tone={paymentTone(payment.status)} />
      </p>

      {content === null ? (
        <Notice tone="warning" title="Kode QR belum tersedia dari server" live="polite">
          <p className="meta">
            Server belum mengirimkan isi kode QR untuk pembayaran ini. Status pembayaran tetap
            dipantau. Jangan membuat pesanan baru untuk transaksi yang sama.
          </p>
        </Notice>
      ) : (
        <div className="qr-frame">
          {developmentPayload ? (
            <p className="qr-test-banner">
              Kode uji coba, bukan QRIS yang dapat dibayar. Isi kode ini berasal dari gateway
              pengembangan.
            </p>
          ) : null}

          {url === null ? (
            <>
              <p className="meta" role="status">
                {rendered?.content === content ? 'Kode QR belum dapat digambar di perangkat ini.' : 'Menyiapkan kode QR…'}
              </p>
              <p className="qr-raw">{content}</p>
            </>
          ) : (
            // The payload is a data URL generated in the browser from the exact
            // string the server issued. next/image would add a loader and
            // optimisation pipeline around bytes that must stay untouched for
            // the code to scan, so a plain img is the correct element here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              width={320}
              height={320}
              alt={developmentPayload ? 'Kode QR uji coba yang tidak dapat dibayar.' : 'Kode QR pembayaran dari server.'}
            />
          )}

          {payment.expiresAt ? (
            <p className="meta">Berlaku sampai {dateTime(payment.expiresAt)}.</p>
          ) : null}
        </div>
      )}

      {payment.status === 'pending' ? (
        <Notice tone="warning" title="Menunggu konfirmasi pembayaran." live="polite">
          <p className="meta">
            {polling
              ? 'Status diperiksa ulang ke server secara berkala. Struk lunas hanya muncul setelah server mengonfirmasi pembayaran.'
              : 'Status terakhir dari server masih menunggu konfirmasi.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={onCheckNow}>
              Periksa status sekarang
            </button>
          </div>
        </Notice>
      ) : null}

      {statusCheckFailed ? (
        <Notice tone="warning" title="Status pembayaran belum dapat diperiksa." live="polite">
          <p className="meta">
            Pemeriksaan terakhir ke server gagal. Keadaan yang ditampilkan adalah jawaban server
            yang terakhir diterima. Kegagalan pemeriksaan bukan berarti pembayarannya gagal, jadi
            jangan membuat permintaan pembayaran baru.
          </p>
        </Notice>
      ) : null}

      {payment.intentError ? (
        <p className="meta">Catatan pemulihan dari server: {payment.intentError}</p>
      ) : null}
    </section>
  );
}
