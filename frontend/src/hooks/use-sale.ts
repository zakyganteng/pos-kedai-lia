'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Sale } from '@/lib/types';
import { describeFailure, isForbidden, isUnauthorized } from './use-api-error';

export function isPaymentPending(sale: Sale | null): boolean {
  return sale !== null && sale.payment?.status === 'pending';
}

type Loaded = {
  /** The sale this record describes. Refreshing does not invalidate it. */
  saleKey: string;
  sale: Sale | null;
  error: string | null;
  notFound: boolean;
  forbidden: boolean;
  /** A check failed. Any sale shown is the last answer the server gave. */
  statusCheckFailed: boolean;
};

export type SaleResult = {
  sale: Sale | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  forbidden: boolean;
  statusCheckFailed: boolean;
  /** The payment is still open and the status is being re-checked. */
  polling: boolean;
  reload: () => void;
};

const FIRST_INTERVAL_MS = 3000;
const BACKOFF_MS = [5000, 8000, 13000, 21000, 30000];

/**
 * Loads one sale and, while its payment is still pending, keeps asking the
 * server.
 *
 * A failed check is never reported as a failed payment. The last state the
 * server gave is preserved, including across a manual refresh, and the check
 * failure is surfaced on its own so nobody is tempted to charge twice.
 */
export function useSale(
  saleId: string | null,
  options: { onSessionExpired: () => void },
): SaleResult {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onSessionExpired = options.onSessionExpired;
  const saleKey = saleId ?? 'idle';

  useEffect(() => {
    if (saleId === null) return;
    let stopped = false;
    let timer = 0;
    let failures = 0;

    const replace = (patch: Omit<Loaded, 'saleKey'>) => setLoaded({ saleKey: saleId, ...patch });

    /** Keeps a sale already on screen; only reports that the check failed. */
    const degrade = (message: string) =>
      setLoaded((previous) =>
        previous !== null && previous.saleKey === saleId && previous.sale !== null
          ? { ...previous, statusCheckFailed: true }
          : {
              saleKey: saleId,
              sale: null,
              error: message,
              notFound: false,
              forbidden: false,
              statusCheckFailed: false,
            },
      );

    const run = async (first: boolean): Promise<void> => {
      try {
        const fresh = await api<Sale>(`/sales/${encodeURIComponent(saleId)}`);
        if (stopped) return;
        failures = 0;
        replace({
          sale: fresh,
          error: null,
          notFound: false,
          forbidden: false,
          statusCheckFailed: false,
        });
        if (fresh.payment?.status === 'pending') {
          timer = window.setTimeout(() => void run(false), FIRST_INTERVAL_MS);
        }
      } catch (caught: unknown) {
        if (stopped) return;

        if (isUnauthorized(caught)) {
          replace({
            sale: null,
            error: 'Sesi Anda telah berakhir.',
            notFound: false,
            forbidden: false,
            statusCheckFailed: false,
          });
          onSessionExpired();
          return;
        }
        if (isForbidden(caught)) {
          replace({
            sale: null,
            error: null,
            notFound: false,
            forbidden: true,
            statusCheckFailed: false,
          });
          return;
        }
        if (caught instanceof ApiError && caught.status === 404) {
          replace({
            sale: null,
            error: null,
            notFound: true,
            forbidden: false,
            statusCheckFailed: false,
          });
          return;
        }

        degrade(describeFailure(caught).message);
        if (first) return;

        const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
        failures += 1;
        timer = window.setTimeout(() => void run(false), wait);
      }
    };

    void run(true);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [saleId, attempt, onSessionExpired]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const current = loaded !== null && loaded.saleKey === saleKey ? loaded : null;

  return {
    sale: current?.sale ?? null,
    loading: saleId !== null && current === null,
    error: current?.error ?? null,
    notFound: current?.notFound ?? false,
    forbidden: current?.forbidden ?? false,
    statusCheckFailed: current?.statusCheckFailed ?? false,
    polling: isPaymentPending(current?.sale ?? null),
    reload,
  };
}
