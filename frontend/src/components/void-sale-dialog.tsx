'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { rupiah } from '@/lib/format';
import type { Sale } from '@/lib/types';
import { useMutation } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { WriteError } from './states';

/** Matches the backend's reason bounds, so the field never refuses a legal reason. */
const REASON_MAX = 300;

type VoidSaleDialogProps = {
  sale: Sale;
  open: boolean;
  onClose: () => void;
  /** Called after the server confirms the void, so the sale can be re-read. */
  onVoided: () => void;
  onSessionExpired: () => void;
};

/**
 * Confirms voiding a paid sale.
 *
 * The void is irreversible and moves money out of the reports, so the reason
 * is required and the consequences are spelled out before the button. The
 * dialog stays open on a refusal, carrying the backend's own reason: a sale
 * the server declined to void must never be shown as cancelled.
 */
export function VoidSaleDialog({
  sale,
  open,
  onClose,
  onVoided,
  onSessionExpired,
}: VoidSaleDialogProps) {
  const [reason, setReason] = useState('');
  const mutate = useMutation({ onUnauthorized: onSessionExpired });

  const key = `void:${sale.id}`;
  const failure = mutate.failureOf(key);
  const busy = mutate.isPending(key);
  const trimmed = reason.trim();
  const reasonError = failure?.fieldErrors.find((entry) => entry.field === 'reason') ?? null;

  const close = () => {
    mutate.clear(key);
    setReason('');
    onClose();
  };

  const submit = async () => {
    if (trimmed === '') return;
    const ok = await mutate.run(key, async () => {
      await api<Sale>(`/sales/${encodeURIComponent(sale.id)}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: trimmed }),
      });
    });
    if (!ok) return;
    setReason('');
    onVoided();
  };

  return (
    <Dialog
      open={open}
      title="Batalkan transaksi"
      onClose={busy ? undefined : close}
      footer={
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>
            Kembali
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || trimmed === ''}
            onClick={() => void submit()}
          >
            {busy ? 'Membatalkan…' : 'Batalkan transaksi'}
          </button>
        </>
      }
    >
      <p>
        Transaksi sebesar {rupiah(sale.total)} akan dibatalkan setelah pembayaran diterima.
      </p>
      <div className="stack-sm">
        <p className="meta">Nilainya dikeluarkan dari laporan penjualan.</p>
        <p className="meta">
          Stok item yang dipantau dikembalikan dengan catatan pergerakan yang terekam.
        </p>
        <p className="meta">Pembatalan ini tidak dapat dibatalkan kembali.</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="void-alasan">
          Alasan pembatalan
        </label>
        <textarea
          id="void-alasan"
          className="textarea"
          value={reason}
          maxLength={REASON_MAX}
          required
          aria-invalid={reasonError !== null ? true : undefined}
          aria-describedby="void-alasan-petunjuk"
          onChange={(event) => setReason(event.target.value)}
        />
        <p className="field-hint" id="void-alasan-petunjuk">
          Wajib diisi, 1 sampai {REASON_MAX} karakter. Alasan tersimpan bersama transaksi.
        </p>
        {reasonError !== null ? <p className="field-error">{reasonError.message}</p> : null}
      </div>

      {failure !== null ? (
        <>
          <WriteError
            failure={failure}
            unchangedNote="Transaksi ini masih tercatat lunas dan belum dibatalkan."
            onRecheck={() => {
              mutate.clear(key);
              onClose();
              onVoided();
            }}
          />
          {failure.status === 409 ? (
            <p className="meta">
              Hanya transaksi lunas dengan pembayaran terkonfirmasi yang dapat dibatalkan. Status
              transaksi ini sudah berubah di server; muat ulang struk untuk melihat keadaannya.
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
