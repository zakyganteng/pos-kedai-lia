'use client';

import Link from 'next/link';
import { rupiah } from '@/lib/format';
import { useSession } from '@/hooks/use-session';
import { useSale } from '@/hooks/use-sale';
import { forgetPendingSale } from '@/hooks/use-checkout';
import { QrisPanel } from './qris-panel';
import { Receipt, isPrintable } from './receipt';
import { ErrorBlock, LoadingBlock, Notice, PermissionBlock } from './states';

export function ReceiptDetail({ saleId }: { saleId: string }) {
  const { line, lines, workspace, requestLineChange, onSessionExpired } = useSession();
  const result = useSale(saleId, { onSessionExpired });
  const sale = result.sale;

  if (result.loading) {
    return (
      <main className="pos-main" id="konten">
        <LoadingBlock label="Memuat struk…" />
      </main>
    );
  }

  if (result.notFound) {
    return (
      <main className="pos-main" id="konten">
        <Notice tone="warning" title="Struk tidak ditemukan">
          <p className="meta">
            Transaksi ini tidak ada, atau tidak terlihat oleh akun dan unit usaha yang sedang
            dipilih.
          </p>
          <div className="btn-row">
            <Link className="btn btn-secondary" href="/struk">
              Kembali ke daftar struk
            </Link>
          </div>
        </Notice>
      </main>
    );
  }

  if (result.forbidden) {
    return (
      <main className="pos-main" id="konten">
        <PermissionBlock>
          Akun ini tidak memiliki akses ke transaksi tersebut.
        </PermissionBlock>
        <div className="btn-row" style={{ marginTop: 'var(--s4)' }}>
          <Link className="btn btn-secondary" href="/struk">
            Kembali ke daftar struk
          </Link>
        </div>
      </main>
    );
  }

  if (result.error !== null || sale === null) {
    return (
      <main className="pos-main" id="konten">
        <ErrorBlock
          title="Struk belum dapat dimuat."
          message={result.error}
          onRetry={result.reload}
        />
      </main>
    );
  }

  // A sale from another business line must not be rendered against the
  // currently selected one: names and context would be wrong.
  if (sale.businessLineId !== line.id) {
    const owner = lines.find((entry) => entry.id === sale.businessLineId) ?? null;
    return (
      <main className="pos-main" id="konten">
        <Notice tone="warning" title="Struk ini milik unit usaha lain">
          <p className="meta">
            {owner === null
              ? 'Transaksi ini tercatat pada unit usaha yang tidak ditugaskan ke akun ini.'
              : `Transaksi ini tercatat pada ${owner.name}, sedangkan unit usaha yang sedang dipilih adalah ${line.name}.`}
          </p>
          <div className="btn-row">
            {owner === null ? null : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => requestLineChange(owner.id)}
              >
                Pindah ke {owner.name}
              </button>
            )}
            <Link className="btn btn-secondary" href="/struk">
              Kembali ke daftar struk
            </Link>
          </div>
        </Notice>
      </main>
    );
  }

  const payment = sale.payment;
  const pendingQris = payment?.status === 'pending' && payment.method === 'qris';
  const pendingCash = payment?.status === 'pending' && payment.method === 'cash';
  const printable = isPrintable(sale);

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Struk</h1>
        <p className="meta">{line.name}</p>
      </div>

      {pendingQris && payment ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <QrisPanel
            payment={payment}
            polling={result.polling}
            statusCheckFailed={result.statusCheckFailed}
            onCheckNow={result.reload}
          />
        </div>
      ) : null}

      {pendingCash ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="warning" title="Menunggu konfirmasi pembayaran." live="polite">
            <p className="meta">
              Server belum mencatat pembayaran tunai ini sebagai berhasil. Struk lunas hanya muncul
              setelah server mengonfirmasinya.
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-secondary" onClick={result.reload}>
                Periksa status sekarang
              </button>
            </div>
          </Notice>
        </div>
      ) : null}

      {!pendingQris && result.statusCheckFailed ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="warning" title="Status pembayaran belum dapat diperiksa." live="polite">
            <p className="meta">
              Keadaan yang ditampilkan adalah jawaban server yang terakhir diterima. Kegagalan
              pemeriksaan bukan berarti pembayarannya gagal.
            </p>
          </Notice>
        </div>
      ) : null}

      {printable ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="success" title="Pembayaran berhasil." live="polite">
            <p className="meta">
              Server mengonfirmasi pembayaran sebesar {rupiah(sale.total)}.
            </p>
          </Notice>
        </div>
      ) : null}

      <Receipt sale={sale} line={line} />

      <div className="btn-row no-print" style={{ marginTop: 'var(--s4)' }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!printable}
          onClick={() => window.print()}
        >
          Cetak struk
        </button>
        <Link
          className="btn btn-secondary"
          href="/kasir"
          onClick={() => {
            if (payment?.status !== 'pending') forgetPendingSale(workspace, sale.id);
          }}
        >
          Kembali ke kasir
        </Link>
        <Link className="btn btn-secondary" href="/struk">
          Daftar struk
        </Link>
      </div>

      {printable ? null : (
        <p className="meta no-print" style={{ marginTop: 'var(--s2)' }}>
          Struk hanya dapat dicetak setelah server mengonfirmasi pembayaran dan transaksi berstatus
          lunas.
        </p>
      )}
    </main>
  );
}
