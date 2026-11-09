'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { rupiah } from '@/lib/format';
import { useSession } from '@/hooks/use-session';
import { useDraft } from '@/hooks/use-draft';
import { useCheckout, usePendingSales } from '@/hooks/use-checkout';
import { Catalog } from './catalog';
import { CheckoutRecovery } from './checkout-recovery';
import { OrderPanel } from './order-panel';
import { PaymentDialog } from './payment-dialog';
import { Notice } from './states';

export function CheckoutScreen() {
  const { user, line, workspace, onSessionExpired } = useSession();
  const router = useRouter();
  const draft = useDraft(workspace);
  const checkout = useCheckout(workspace, { onSessionExpired });
  const pending = usePendingSales(workspace);

  const [phoneView, setPhoneView] = useState<'catalog' | 'order'>('catalog');
  const [payRequested, setPayRequested] = useState(false);

  const createdSaleId = checkout.phase.name === 'created' ? checkout.phase.sale.id : null;
  useEffect(() => {
    if (createdSaleId === null) return;
    router.push(`/struk/${createdSaleId}`);
  }, [createdSaleId, router]);

  const blockedReason = checkout.blocked
    ? 'Selesaikan dulu permintaan pembayaran yang belum jelas hasilnya di bagian atas halaman.'
    : draft.isEmpty
      ? 'Tambahkan minimal satu item sebelum lanjut ke pembayaran.'
      : null;

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Kasir</h1>
        <p className="meta">
          {line.name} · {user.name}
        </p>
      </div>

      {/* The dialog carries the same controls while it is open, so only one
          copy is ever on the page. */}
      {checkout.blocked && !payRequested ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <CheckoutRecovery
            phase={checkout.phase}
            onRetrySame={checkout.retrySame}
            onAbandon={checkout.abandonAttempt}
          />
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div style={{ marginBottom: 'var(--s4)' }}>
          <Notice tone="warning" title="Ada pembayaran yang belum selesai" live="polite">
            <ul className="stack-sm">
              {pending.map((note) => (
                <li key={note.saleId}>
                  <Link className="record-link" href={`/struk/${note.saleId}`}>
                    Lanjutkan pembayaran {rupiah(note.total)}
                  </Link>
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}

      <div className="checkout" data-phone-view={phoneView}>
        <Catalog
          line={line}
          quantityOf={draft.quantityOf}
          isFull={draft.isFull}
          locked={checkout.blocked}
          onAdd={draft.addItem}
          onSessionExpired={onSessionExpired}
        />

        <OrderPanel
          line={line}
          draft={draft}
          onCheckout={() => setPayRequested(true)}
          checkoutDisabled={draft.isEmpty || checkout.blocked}
          locked={checkout.blocked}
          checkoutBlockedReason={blockedReason}
          onBackToCatalog={() => setPhoneView('catalog')}
          onSessionExpired={onSessionExpired}
        />
      </div>

      {phoneView === 'catalog' ? (
        <div className="review-bar">
          <span className="review-bar-total">
            <span className="meta">{draft.itemCount} item</span>
            <strong className="money">{rupiah(draft.total)}</strong>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setPhoneView('order')}
            disabled={draft.isEmpty}
          >
            Tinjau pesanan
          </button>
        </div>
      ) : null}

      <PaymentDialog
        open={payRequested}
        draft={draft}
        phase={checkout.phase}
        canReadIntegrations={user.role === 'owner'}
        onSubmit={checkout.submit}
        onRetrySame={checkout.retrySame}
        onAbandon={checkout.abandonAttempt}
        onDismissOutcome={checkout.dismissOutcome}
        onClose={() => setPayRequested(false)}
      />
    </main>
  );
}
