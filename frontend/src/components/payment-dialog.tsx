'use client';

import { useId, useState } from 'react';
import { rupiah } from '@/lib/format';
import type { IntegrationStatus, SaleCreateInput } from '@/lib/types';
import type { DraftApi } from '@/hooks/use-draft';
import { useResource } from '@/hooks/use-paged';
import { RECORDS_CHECKED, type CheckoutPhase, type PaymentMethod } from '@/hooks/use-checkout';
import { CheckoutRecovery } from './checkout-recovery';
import { Dialog } from './dialog';
import { Notice } from './states';

type SaleItemInput = SaleCreateInput['items'][number];

type IntegrationsResponse = {
  payment: IntegrationStatus;
  notification: IntegrationStatus;
  productionReady: boolean;
};

type PaymentDialogProps = {
  open: boolean;
  draft: DraftApi;
  phase: CheckoutPhase;
  canReadIntegrations: boolean;
  onSubmit: (
    body: SaleCreateInput,
    snapshot: { total: number; itemCount: number; method: PaymentMethod },
  ) => void;
  onRetrySame: () => void;
  onAbandon: (acknowledgement: typeof RECORDS_CHECKED) => void;
  onDismissOutcome: () => void;
  onClose: () => void;
};

function buildBody(draft: DraftApi, method: PaymentMethod, cashReceived: number): SaleCreateInput {
  const items: SaleItemInput[] = draft.draft.items.map((item) => {
    const line: SaleItemInput = {
      itemType: item.itemType,
      itemId: item.itemId,
      quantity: item.quantity,
    };
    return line;
  });

  const body: SaleCreateInput = { items, paymentMethod: method };
  if (draft.draft.customerId !== null) body.customerId = draft.draft.customerId;
  if (method === 'cash') body.cashReceived = cashReceived;
  return body;
}

export function PaymentDialog({
  open,
  draft,
  phase,
  canReadIntegrations,
  onSubmit,
  onRetrySame,
  onAbandon,
  onDismissOutcome,
  onClose,
}: PaymentDialogProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [cashText, setCashText] = useState('');
  const cashId = useId();

  const integrations = useResource<IntegrationsResponse>(
    open && canReadIntegrations ? '/integrations' : null,
    { errorMessage: 'Status integrasi belum dapat dibaca.' },
  );

  const total = draft.total;
  const cashReceived = Number.parseInt(cashText.replace(/[^\d]/g, ''), 10);
  const cashValid = Number.isSafeInteger(cashReceived) && cashReceived >= total && cashReceived <= 1_000_000_000_000;
  const changeEstimate = cashValid ? cashReceived - total : 0;

  const sending = phase.name === 'sending';
  const frozen = phase.name === 'unresolved' || phase.name === 'conflict';
  const rejected = phase.name === 'rejected' ? phase : null;

  const canSubmit = !sending && !frozen && !draft.isEmpty && (method === 'qris' || cashValid);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(buildBody(draft, method, cashReceived), {
      total,
      itemCount: draft.itemCount,
      method,
    });
  };

  const paymentProvider = integrations.value?.payment ?? null;

  return (
    <Dialog
      open={open}
      title={frozen ? 'Transaksi belum selesai' : 'Pembayaran'}
      // Closing is always allowed and never cancels or abandons anything. The
      // same recovery controls stay on the kasir page behind this dialog.
      onClose={onClose}
      footer={
        frozen || sending ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Tutup tanpa membatalkan
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Kembali ke pesanan
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
              Selesaikan pembayaran
            </button>
          </>
        )
      }
    >
      <div className="order-total-row">
        <span className="order-total-label">Total</span>
        <span className="order-total-value money">{rupiah(total)}</span>
      </div>
      <p className="meta">
        {draft.itemCount} item dalam {draft.draft.items.length} jenis. Jumlah akhir ditentukan oleh
        server.
      </p>

      {frozen || sending ? (
        <CheckoutRecovery phase={phase} onRetrySame={onRetrySame} onAbandon={onAbandon} />
      ) : null}

      {rejected !== null ? (
        <Notice tone="error" title="Server menolak pesanan ini" live="assertive">
          <p className="meta">{rejected.failure.message}</p>
          {rejected.failure.fieldErrors.length > 0 ? (
            <ul className="stack-sm">
              {rejected.failure.fieldErrors.map((entry) => (
                <li className="meta" key={`${entry.field}:${entry.message}`}>
                  {entry.field}: {entry.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="meta">Tidak ada transaksi yang dibuat. Perbaiki pesanan lalu kirim lagi.</p>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary" onClick={onDismissOutcome}>
              Perbaiki pesanan
            </button>
          </div>
        </Notice>
      ) : null}

      {frozen || sending ? null : (
        <>
          <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label">Metode pembayaran</legend>
            <div className="method-list">
              <label className="method-option">
                <input
                  type="radio"
                  name="metode-pembayaran"
                  value="cash"
                  checked={method === 'cash'}
                  onChange={() => setMethod('cash')}
                />
                <span className="method-option-body">
                  <span className="method-option-name">Tunai</span>
                  <span className="meta">Terima uang dan catat kembaliannya.</span>
                </span>
              </label>

              <label className="method-option">
                <input
                  type="radio"
                  name="metode-pembayaran"
                  value="qris"
                  checked={method === 'qris'}
                  onChange={() => setMethod('qris')}
                />
                <span className="method-option-body">
                  <span className="method-option-name">QRIS</span>
                  <span className="meta">
                    Server membuat kode QR. Pembayaran baru dianggap berhasil setelah server
                    mengonfirmasinya.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {method === 'qris' ? (
            <p className="meta">
              {!canReadIntegrations
                ? 'Status penyedia QRIS tidak dapat diperiksa dengan akun ini. Pembayaran tetap dapat dicoba, dan jika penyedia sedang tidak aktif server akan menolaknya dengan jelas.'
                : integrations.loading
                  ? 'Memeriksa status penyedia pembayaran.'
                  : integrations.forbidden
                    ? 'Status penyedia QRIS tidak dapat diperiksa dengan akun ini. Pembayaran tetap dapat dicoba.'
                    : integrations.error !== null
                      ? `Status penyedia QRIS belum dapat dibaca: ${integrations.error} Pembayaran tetap dapat dicoba.`
                      : paymentProvider === null
                        ? 'Status penyedia QRIS tidak tersedia. Pembayaran tetap dapat dicoba.'
                        : paymentProvider.configured
                          ? `Penyedia pembayaran terkonfigurasi: ${paymentProvider.provider}. Status ini hanya soal konfigurasi, bukan jaminan koneksi.`
                          : `Penyedia pembayaran (${paymentProvider.provider}) belum dikonfigurasi di server, jadi permintaan QRIS kemungkinan besar ditolak.`}
            </p>
          ) : null}

          {method === 'cash' ? (
            <div className="field">
              <label className="field-label" htmlFor={cashId}>
                Uang diterima
              </label>
              <input
                id={cashId}
                className="input input-money"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={13}
                value={cashText}
                aria-invalid={cashText !== '' && !cashValid}
                aria-describedby={`${cashId}-hint`}
                onChange={(event) => setCashText(event.target.value.replace(/[^\d]/g, '').slice(0, 13))}
              />
              <span className="field-hint" id={`${cashId}-hint`}>
                Masukkan jumlah rupiah bulat, minimal {rupiah(total)}.
              </span>
              {cashText !== '' && !cashValid ? (
                <span className="field-error" role="status">
                  Uang diterima harus berupa rupiah bulat, minimal {rupiah(total)} dan maksimal {rupiah(1_000_000_000_000)}.
                </span>
              ) : null}
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCashText(String(total))}
                >
                  Uang pas
                </button>
              </div>
              <div className="cash-keypad" role="group" aria-label="Keypad uang diterima">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(digit => (
                  <button type="button" className="btn btn-secondary" key={digit}
                    aria-label={`Masukkan digit ${digit}`}
                    onClick={() => setCashText(current => (current === '0' ? String(digit) : `${current}${digit}`).slice(0, 13))}>
                    {digit}
                  </button>
                ))}
                <button type="button" className="btn btn-secondary" aria-label="Hapus nominal" onClick={() => setCashText('')}>Hapus</button>
                <button type="button" className="btn btn-secondary" aria-label="Masukkan digit 0"
                  onClick={() => setCashText(current => (current === '0' ? '0' : `${current}0`).slice(0, 13))}>0</button>
                <button type="button" className="btn btn-secondary" aria-label="Hapus digit terakhir"
                  onClick={() => setCashText(current => current.slice(0, -1))}>⌫</button>
              </div>
              {cashValid ? (
                <p className="meta" role="status">
                  Perkiraan kembalian {rupiah(changeEstimate)}. Kembalian resmi diambil dari struk
                  yang dikeluarkan server.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
