'use client';

import { dateTime, paymentLabel, rupiah, saleLabel } from '@/lib/format';
import type { BusinessLine, Sale } from '@/lib/types';
import { StatusBadge, paymentTone, saleTone } from './states';

const METHOD_LABEL: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
};

export function isPrintable(sale: Sale): boolean {
  return sale.status === 'paid' && sale.payment?.status === 'confirmed';
}

/**
 * Receipt built only from values the server persisted on the sale.
 * Printing is black on white and carries no screen decoration.
 */
export function Receipt({ sale, line }: { sale: Sale; line: BusinessLine | null }) {
  const payment = sale.payment;

  return (
    <article className="receipt" aria-labelledby="receipt-heading">
      <header className="receipt-head">
        <h2 className="receipt-shop" id="receipt-heading">
          {line?.name ?? 'Lia POS'}
        </h2>
        <p className="meta">{dateTime(sale.createdAt)}</p>
        <p className="meta">Nomor transaksi {sale.id}</p>
      </header>

      <div className="btn-row no-print" style={{ marginBottom: 'var(--s3)' }}>
        <StatusBadge label={saleLabel(sale.status)} tone={saleTone(sale.status)} />
        {payment ? (
          <StatusBadge label={paymentLabel(payment.status)} tone={paymentTone(payment.status)} />
        ) : null}
      </div>

      <div className="receipt-table-scroll" role="region" aria-label="Rincian item struk" tabIndex={0}>
      <table className="receipt-table">
        <caption className="sr-only">Rincian item transaksi</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="num">
              Jml
            </th>
            <th scope="col" className="num">
              Harga
            </th>
            <th scope="col" className="num">
              Jumlah
            </th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.displayName}
              </td>
              <td className="num">{item.quantity}</td>
              <td className="num">{rupiah(item.unitPrice)}</td>
              <td className="num">{rupiah(item.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div style={{ marginTop: 'var(--s3)' }}>
        <div className="receipt-sum">
          <span>Subtotal</span>
          <span>{rupiah(sale.subtotal)}</span>
        </div>
        <div className="receipt-sum receipt-sum-strong">
          <span>Total</span>
          <span>{rupiah(sale.total)}</span>
        </div>
        {typeof sale.cashReceived === 'number' ? (
          <div className="receipt-sum">
            <span>Uang diterima</span>
            <span>{rupiah(sale.cashReceived)}</span>
          </div>
        ) : null}
        {typeof sale.changeDue === 'number' ? (
          <div className="receipt-sum">
            <span>Kembalian</span>
            <span>{rupiah(sale.changeDue)}</span>
          </div>
        ) : null}
      </div>

      <hr className="divider-line" />

      <dl className="stack-sm">
        <div className="receipt-sum">
          <dt>Metode</dt>
          <dd>{payment ? (METHOD_LABEL[payment.method] ?? payment.method) : 'Tidak tersedia'}</dd>
        </div>
        <div className="receipt-sum">
          <dt>Status pembayaran</dt>
          <dd>{payment ? paymentLabel(payment.status) : 'Tidak tersedia'}</dd>
        </div>
        <div className="receipt-sum">
          <dt>Status transaksi</dt>
          <dd>{saleLabel(sale.status)}</dd>
        </div>
        {payment?.confirmedAt ? (
          <div className="receipt-sum">
            <dt>Dikonfirmasi</dt>
            <dd>{dateTime(payment.confirmedAt)}</dd>
          </div>
        ) : null}
        {payment?.gatewayReference ? (
          <div className="receipt-sum">
            <dt>Referensi penyedia</dt>
            <dd>{payment.gatewayReference}</dd>
          </div>
        ) : null}
      </dl>

    </article>
  );
}
