'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { count } from '@/lib/format';
import type { BusinessLine, InventoryMovement, Product } from '@/lib/types';
import { buildQuery } from '@/hooks/use-paged';
import { useMutation } from '@/hooks/use-mutation';
import { Dialog } from './dialog';
import { EmptyBlock, WriteError } from './states';

/** Matches the backend's bounds so the form never refuses a legal value. */
const REASON_MAX = 300;
const AMOUNT_MAX = 1000000000;

type StockMovementDialogProps = {
  line: BusinessLine;
  /** Only an owner may record an adjustment; admin may only receive. */
  owner: boolean;
  /** Stock-tracked products offered in the select; normally the active ones. */
  products: Product[];
  productsLoading: boolean;
  /** Preselected product, or '' when opened from the toolbar. */
  initialProductId: string;
  onClose: () => void;
  /** Called after the server confirms the movement. */
  onRecorded: () => void;
  onSessionExpired: () => void;
};

/** Positive integer within the backend's magnitude bounds, or null. */
function parseAmount(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > AMOUNT_MAX) return null;
  return value;
}

function parseThreshold(raw: string): number | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > AMOUNT_MAX) return null;
  return value;
}

/**
 * Records one receipt or adjustment.
 *
 * A reduction is entered as a direction plus a positive amount, so nobody has
 * to type a minus sign on a counter touchscreen, and the signed delta the
 * backend wants is built here. The dialog stays open on a refusal carrying
 * the backend's own reason: stock the server declined to move is never shown
 * as moved.
 */
export function StockMovementDialog({
  line,
  owner,
  products,
  productsLoading,
  initialProductId,
  onClose,
  onRecorded,
  onSessionExpired,
}: StockMovementDialogProps) {
  const [type, setType] = useState<'receive' | 'adjustment'>('receive');
  const [productId, setProductId] = useState(initialProductId);
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [threshold, setThreshold] = useState('');

  const mutate = useMutation({ onUnauthorized: onSessionExpired });
  const key = 'movement';
  const failure = mutate.failureOf(key);
  const busy = mutate.isPending(key);

  const sorted = useMemo(
    () => products.slice().sort((left, right) => left.name.localeCompare(right.name, 'id-ID')),
    [products],
  );
  const selected = sorted.find((product) => product.id === productId) ?? null;

  const parsedAmount = parseAmount(amount);
  const parsedThreshold = threshold.trim() === '' ? null : parseThreshold(threshold);
  const thresholdInvalid = threshold.trim() !== '' && parsedThreshold === null;
  const trimmedReason = reason.trim();

  const signedDelta =
    parsedAmount === null
      ? null
      : type === 'receive' || direction === 'increase'
        ? parsedAmount
        : -parsedAmount;

  // The product reference carries the figures the backend last confirmed, so
  // the preview is an arithmetic statement about known stock, not a guess.
  const onHand = selected?.stockOnHand;
  const reserved = selected?.reservedQuantity ?? 0;
  const expected = onHand === undefined || signedDelta === null ? null : onHand + signedDelta;
  const belowZero = expected !== null && expected < 0;
  const belowReserved = expected !== null && !belowZero && expected < reserved;

  const fieldError = (field: string) =>
    failure?.fieldErrors.find((entry) => entry.field === field) ?? null;

  const canSubmit =
    !busy &&
    productId !== '' &&
    parsedAmount !== null &&
    trimmedReason !== '' &&
    !thresholdInvalid;

  const submit = async () => {
    if (!canSubmit || signedDelta === null) return;
    const ok = await mutate.run(key, async () => {
      await api<InventoryMovement>(
        `/inventory/movements${buildQuery({ businessLineId: line.id })}`,
        {
          method: 'POST',
          body: JSON.stringify({
            productId,
            type,
            quantityDelta: signedDelta,
            reason: trimmedReason,
            ...(parsedThreshold === null ? {} : { lowStockThreshold: parsedThreshold }),
          }),
        },
      );
    });
    if (!ok) return;
    onRecorded();
  };

  const noProducts = !productsLoading && sorted.length === 0;

  return (
    <Dialog
      open
      title={owner ? 'Catat penerimaan atau penyesuaian' : 'Catat penerimaan barang'}
      description={`Perubahan tercatat di buku stok ${line.name} dan tidak dapat dihapus.`}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Batal
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit || noProducts}
            onClick={() => void submit()}
          >
            {busy ? 'Menyimpan…' : 'Simpan pergerakan'}
          </button>
        </>
      }
    >
      {noProducts ? (
        <EmptyBlock title="Belum ada produk yang stoknya dipantau.">
          <p className="meta">
            Pemantauan stok diaktifkan per produk di halaman Katalog. Aktifkan dulu di sana, lalu
            catat penerimaan pertamanya di sini.
          </p>
        </EmptyBlock>
      ) : null}

      <div className="form-grid">
        {owner ? (
          <div className="field span-2" role="radiogroup" aria-labelledby="stok-jenis-label">
            <span className="field-label" id="stok-jenis-label">
              Jenis pergerakan
            </span>
            <div className="check-list">
              <label className="check-row" htmlFor="stok-jenis-receive">
                <input
                  id="stok-jenis-receive"
                  type="radio"
                  name="stok-jenis"
                  value="receive"
                  checked={type === 'receive'}
                  onChange={() => setType('receive')}
                />
                Penerimaan — barang masuk, selalu menambah stok
              </label>
              <label className="check-row" htmlFor="stok-jenis-adjustment">
                <input
                  id="stok-jenis-adjustment"
                  type="radio"
                  name="stok-jenis"
                  value="adjustment"
                  checked={type === 'adjustment'}
                  onChange={() => setType('adjustment')}
                />
                Penyesuaian — koreksi hitungan, dapat menambah atau mengurangi
              </label>
            </div>
          </div>
        ) : (
          <p className="meta span-2">
            Jenis pergerakan: Penerimaan. Penyesuaian stok hanya dapat dicatat oleh pemilik.
          </p>
        )}

        <div className="field span-2">
          <label className="field-label" htmlFor="stok-produk">
            Produk
          </label>
          <select
            id="stok-produk"
            className="select"
            value={productId}
            required
            aria-invalid={fieldError('productId') !== null ? true : undefined}
            onChange={(event) => setProductId(event.target.value)}
          >
            <option value="">
              {productsLoading ? 'Memuat produk…' : 'Pilih produk yang stoknya dipantau'}
            </option>
            {sorted.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.sku}
                {product.active ? '' : ' (diarsipkan)'}
              </option>
            ))}
          </select>
          {fieldError('productId') !== null ? (
            <p className="field-error">{fieldError('productId')?.message}</p>
          ) : null}
        </div>

        {type === 'adjustment' ? (
          <div className="field" role="radiogroup" aria-labelledby="stok-arah-label">
            <span className="field-label" id="stok-arah-label">
              Arah penyesuaian
            </span>
            <div className="check-list">
              <label className="check-row" htmlFor="stok-arah-tambah">
                <input
                  id="stok-arah-tambah"
                  type="radio"
                  name="stok-arah"
                  value="increase"
                  checked={direction === 'increase'}
                  onChange={() => setDirection('increase')}
                />
                Tambah
              </label>
              <label className="check-row" htmlFor="stok-arah-kurangi">
                <input
                  id="stok-arah-kurangi"
                  type="radio"
                  name="stok-arah"
                  value="decrease"
                  checked={direction === 'decrease'}
                  onChange={() => setDirection('decrease')}
                />
                Kurangi
              </label>
            </div>
          </div>
        ) : null}

        <div className="field">
          <label className="field-label" htmlFor="stok-jumlah">
            Jumlah{selected === null ? '' : ` (${selected.unit})`}
          </label>
          <input
            id="stok-jumlah"
            className="input"
            type="number"
            inputMode="numeric"
            min={1}
            max={AMOUNT_MAX}
            step={1}
            value={amount}
            required
            aria-invalid={
              (amount !== '' && parsedAmount === null) || fieldError('quantityDelta') !== null
                ? true
                : undefined
            }
            aria-describedby="stok-jumlah-petunjuk"
            onChange={(event) => setAmount(event.target.value)}
          />
          <p className="field-hint" id="stok-jumlah-petunjuk">
            Isi angka positif. {type === 'adjustment'
              ? 'Arah di sebelah kiri menentukan menambah atau mengurangi.'
              : 'Penerimaan selalu menambah stok.'}
          </p>
          {amount !== '' && parsedAmount === null ? (
            <p className="field-error">Jumlah harus bilangan bulat 1 sampai {count(AMOUNT_MAX)}.</p>
          ) : null}
          {fieldError('quantityDelta') !== null ? (
            <p className="field-error">{fieldError('quantityDelta')?.message}</p>
          ) : null}
        </div>

        <div className="field span-2">
          <label className="field-label" htmlFor="stok-alasan">
            Alasan
          </label>
          <textarea
            id="stok-alasan"
            className="textarea"
            value={reason}
            maxLength={REASON_MAX}
            required
            aria-invalid={fieldError('reason') !== null ? true : undefined}
            aria-describedby="stok-alasan-petunjuk"
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="field-hint" id="stok-alasan-petunjuk">
            Wajib diisi, 1 sampai {REASON_MAX} karakter. Contoh: kiriman supplier 9 Nov, atau
            koreksi setelah stock opname.
          </p>
          {fieldError('reason') !== null ? (
            <p className="field-error">{fieldError('reason')?.message}</p>
          ) : null}
        </div>

        <div className="field span-2">
          <label className="field-label" htmlFor="stok-ambang">
            Ambang stok menipis (opsional)
          </label>
          <input
            id="stok-ambang"
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={AMOUNT_MAX}
            step={1}
            value={threshold}
            aria-invalid={thresholdInvalid || fieldError('lowStockThreshold') !== null ? true : undefined}
            aria-describedby="stok-ambang-petunjuk"
            onChange={(event) => setThreshold(event.target.value)}
          />
          <p className="field-hint" id="stok-ambang-petunjuk">
            Kosongkan untuk membiarkan ambang yang berlaku sekarang
            {selected === null ? '' : ' pada produk ini'}. Produk ditandai menipis saat jumlah
            tersedia tidak lebih dari ambang ini.
          </p>
          {thresholdInvalid ? (
            <p className="field-error">Ambang harus bilangan bulat 0 sampai {count(AMOUNT_MAX)}.</p>
          ) : null}
          {fieldError('lowStockThreshold') !== null ? (
            <p className="field-error">{fieldError('lowStockThreshold')?.message}</p>
          ) : null}
        </div>
      </div>

      {selected !== null && onHand !== undefined ? (
        <p className="meta" role="status">
          Stok fisik tercatat sekarang: {count(onHand)} {selected.unit}
          {reserved > 0 ? `, ${count(reserved)} di antaranya sedang ditahan pembayaran` : ''}.
          {expected !== null
            ? ` Perkiraan setelah disimpan: ${count(expected)} ${selected.unit}.`
            : ''}
        </p>
      ) : null}

      {belowZero ? (
        <p className="field-error">
          Pengurangan ini membuat stok menjadi negatif, dan akan ditolak server.
        </p>
      ) : null}

      {belowReserved ? (
        <p className="field-error">
          Hasilnya lebih kecil dari {count(reserved)} yang sedang ditahan pembayaran berjalan, dan
          akan ditolak server.
        </p>
      ) : null}

      {failure !== null ? (
        <WriteError
          failure={failure}
          unchangedNote="Stok produk ini belum berubah."
          onRecheck={() => {
            mutate.clear(key);
            onRecorded();
          }}
        />
      ) : null}
    </Dialog>
  );
}
