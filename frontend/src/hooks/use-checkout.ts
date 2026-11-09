'use client';

import { useCallback, useRef, useState } from 'react';
import { api, newIdempotencyKey } from '@/lib/api';
import type { Sale, SaleCreateInput } from '@/lib/types';
import { describeFailure, isUnauthorized, type Failure } from './use-api-error';
import {
  clearStored,
  getStoredJson,
  setStoredJson,
  storageKeys,
  useStoredJson,
  type Workspace,
} from './use-storage';

export type PaymentMethod = SaleCreateInput['paymentMethod'];

export type AttemptSnapshot = {
  total: number;
  itemCount: number;
  method: PaymentMethod;
  startedAt: string;
};

export type CheckoutAttempt = {
  /** The X-Idempotency-Key. Stable for the whole life of one logical sale. */
  key: string;
  userId: string;
  lineId: string;
  /** Frozen at submit time and never recomputed while the outcome is unknown. */
  body: SaleCreateInput;
  snapshot: AttemptSnapshot;
};

type StoredAttempt = CheckoutAttempt & { state: 'sending' | 'unresolved' | 'conflict' };

export type CheckoutPhase =
  | { name: 'idle' }
  | { name: 'sending'; attempt: CheckoutAttempt }
  /** No usable answer. The sale may or may not exist. Same key only. */
  | { name: 'unresolved'; attempt: CheckoutAttempt; failure: Failure }
  /** The server refused before creating anything, so the order can be edited. */
  | { name: 'rejected'; attempt: CheckoutAttempt; failure: Failure }
  /** 409: a state conflict, or a key reused with a different body. Inspect first. */
  | { name: 'conflict'; attempt: CheckoutAttempt; failure: Failure }
  | { name: 'created'; sale: Sale };

/** Required argument for dropping a frozen attempt, so it cannot happen by accident. */
export const RECORDS_CHECKED = 'records-checked' as const;

export type PendingSaleNote = {
  saleId: string;
  paymentId: string;
  total: number;
  createdAt: string;
};

const RELOADED_MID_REQUEST: Failure = {
  kind: 'uncertain',
  status: 0,
  code: 'REQUEST_UNRESOLVED',
  message: 'Halaman berpindah atau dimuat ulang sebelum jawaban server diterima.',
  fieldErrors: [],
};

function parseStoredAttempt(value: unknown): StoredAttempt | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<StoredAttempt>;
  if (typeof raw.key !== 'string' || raw.key === '') return null;
  if (typeof raw.userId !== 'string' || typeof raw.lineId !== 'string') return null;
  if (typeof raw.body !== 'object' || raw.body === null) return null;
  const snapshot = raw.snapshot;
  return {
    key: raw.key,
    userId: raw.userId,
    lineId: raw.lineId,
    body: raw.body as SaleCreateInput,
    state: raw.state === 'conflict' ? 'conflict' : 'unresolved',
    snapshot: {
      total: typeof snapshot?.total === 'number' ? snapshot.total : 0,
      itemCount: typeof snapshot?.itemCount === 'number' ? snapshot.itemCount : 0,
      method: snapshot?.method === 'qris' ? 'qris' : 'cash',
      startedAt: typeof snapshot?.startedAt === 'string' ? snapshot.startedAt : '',
    },
  };
}

function parsePendingSales(value: unknown): PendingSaleNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const note = entry as Partial<PendingSaleNote>;
    if (typeof note.saleId !== 'string' || note.saleId === '') return [];
    return [
      {
        saleId: note.saleId,
        paymentId: typeof note.paymentId === 'string' ? note.paymentId : '',
        total: typeof note.total === 'number' ? note.total : 0,
        createdAt: typeof note.createdAt === 'string' ? note.createdAt : '',
      },
    ];
  });
}

/** Sales left with an open payment, so they can be resumed from the records screen. */
export function usePendingSales(workspace: Workspace): PendingSaleNote[] {
  return useStoredJson(storageKeys.pendingSales(workspace), parsePendingSales);
}

export function forgetPendingSale(workspace: Workspace, saleId: string): void {
  const key = storageKeys.pendingSales(workspace);
  const rest = getStoredJson(key, parsePendingSales).filter((note) => note.saleId !== saleId);
  if (rest.length === 0) clearStored(key);
  else setStoredJson(key, rest);
}

function rememberPendingSale(workspace: Workspace, sale: Sale): void {
  const key = storageKeys.pendingSales(workspace);
  const note: PendingSaleNote = {
    saleId: sale.id,
    paymentId: sale.payment?.id ?? '',
    total: sale.total,
    createdAt: sale.createdAt,
  };
  const rest = getStoredJson(key, parsePendingSales).filter((entry) => entry.saleId !== sale.id);
  setStoredJson(key, [note, ...rest].slice(0, 20));
}

type Transient =
  | { kind: 'sending'; key: string }
  | { kind: 'failed'; key: string; failure: Failure }
  | { kind: 'rejected'; attempt: CheckoutAttempt; failure: Failure }
  | { kind: 'created'; sale: Sale }
  | null;

/**
 * Owns the one sale at a time submission state machine.
 *
 * Rules enforced here:
 *  - the idempotency key and the request body are frozen together in the
 *    store, so a retry after a dropped connection or a reload replays the
 *    original request instead of buying a second sale;
 *  - a new key is only minted after an outcome the server definitively
 *    refused, or after the cashier explicitly confirms they checked the
 *    records;
 *  - a submission in flight cannot be submitted again;
 *  - the frozen attempt is stored under the signed in user and the selected
 *    line, so nobody else can inherit or replay it.
 */
export function useCheckout(workspace: Workspace, options: { onSessionExpired: () => void }) {
  const checkoutKey = storageKeys.checkout(workspace);
  const stored = useStoredJson(checkoutKey, parseStoredAttempt);
  const [transient, setTransient] = useState<Transient>(null);
  const [scope, setScope] = useState(checkoutKey);
  const inFlight = useRef(false);
  const onSessionExpired = options.onSessionExpired;

  // Switching user or business line starts a clean transient view of a
  // different workspace. The frozen attempt itself lives under its own key.
  if (scope !== checkoutKey) {
    setScope(checkoutKey);
    setTransient(null);
  }

  const send = useCallback(
    async (attempt: CheckoutAttempt) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setStoredJson(checkoutKey, { ...attempt, state: 'sending' } satisfies StoredAttempt);
      setTransient({ kind: 'sending', key: attempt.key });

      try {
        const sale = await api<Sale>(`/sales?businessLineId=${encodeURIComponent(attempt.lineId)}`, {
          method: 'POST',
          headers: { 'X-Idempotency-Key': attempt.key },
          body: JSON.stringify(attempt.body),
        });
        clearStored(checkoutKey);
        // A committed sale invalidates the draft it came from, so the next
        // customer starts clean even if the cashier never returns to kasir.
        clearStored(storageKeys.draft(workspace));
        if (sale.payment?.status === 'pending') rememberPendingSale(workspace, sale);
        setTransient({ kind: 'created', sale });
      } catch (caught: unknown) {
        const failure = describeFailure(caught);

        if (isUnauthorized(caught)) {
          // The sale outcome is still unknown, so the frozen attempt stays put
          // for the same user to resolve after signing back in.
          setStoredJson(checkoutKey, { ...attempt, state: 'unresolved' } satisfies StoredAttempt);
          setTransient({ kind: 'failed', key: attempt.key, failure });
          onSessionExpired();
          return;
        }

        if (failure.kind === 'uncertain') {
          setStoredJson(checkoutKey, { ...attempt, state: 'unresolved' } satisfies StoredAttempt);
          setTransient({ kind: 'failed', key: attempt.key, failure });
          return;
        }

        if (failure.kind === 'conflict') {
          setStoredJson(checkoutKey, { ...attempt, state: 'conflict' } satisfies StoredAttempt);
          setTransient({ kind: 'failed', key: attempt.key, failure });
          return;
        }

        // Validation refused, or the payment provider refused before anything
        // was committed. Nothing exists, so the order may be corrected.
        clearStored(checkoutKey);
        setTransient({ kind: 'rejected', attempt, failure });
      } finally {
        inFlight.current = false;
      }
    },
    [checkoutKey, workspace, onSessionExpired],
  );

  let phase: CheckoutPhase;
  if (transient?.kind === 'created') {
    phase = { name: 'created', sale: transient.sale };
  } else if (stored !== null) {
    const { state, ...attempt } = stored;
    if (transient?.kind === 'sending' && transient.key === stored.key) {
      phase = { name: 'sending', attempt };
    } else {
      const failure =
        transient?.kind === 'failed' && transient.key === stored.key
          ? transient.failure
          : RELOADED_MID_REQUEST;
      phase =
        state === 'conflict'
          ? { name: 'conflict', attempt, failure }
          : { name: 'unresolved', attempt, failure };
    }
  } else if (transient?.kind === 'rejected') {
    phase = { name: 'rejected', attempt: transient.attempt, failure: transient.failure };
  } else {
    phase = { name: 'idle' };
  }

  /** Starts a brand new logical sale. Refused while an outcome is unknown. */
  const submit = useCallback(
    (body: SaleCreateInput, snapshot: Omit<AttemptSnapshot, 'startedAt'>) => {
      if (inFlight.current) return;
      if (getStoredJson(checkoutKey, parseStoredAttempt) !== null) return;
      void send({
        key: newIdempotencyKey(),
        userId: workspace.userId,
        lineId: workspace.lineId,
        body,
        snapshot: { ...snapshot, startedAt: new Date().toISOString() },
      });
    },
    [checkoutKey, workspace, send],
  );

  /** Re-sends the identical body under the identical key. Always safe. */
  const retrySame = useCallback(() => {
    const frozen = getStoredJson(checkoutKey, parseStoredAttempt);
    if (frozen === null) return;
    const { state, ...attempt } = frozen;
    void state;
    void send(attempt);
  }, [checkoutKey, send]);

  /**
   * Drops the frozen attempt. The caller must pass RECORDS_CHECKED, which the
   * UI only supplies after the cashier confirms they looked the transaction up
   * in Struk. Abandoning without that check risks charging twice.
   */
  const abandonAttempt = useCallback(
    (acknowledgement: typeof RECORDS_CHECKED) => {
      if (acknowledgement !== RECORDS_CHECKED) return;
      clearStored(checkoutKey);
      setTransient(null);
    },
    [checkoutKey],
  );

  /** Clears a definitive rejection so the order can be corrected. */
  const dismissOutcome = useCallback(() => {
    setTransient((current) =>
      current?.kind === 'rejected' || current?.kind === 'created' ? null : current,
    );
  }, []);

  const blocked = phase.name === 'sending' || phase.name === 'unresolved' || phase.name === 'conflict';

  return { phase, blocked, submit, retrySame, abandonAttempt, dismissOutcome };
}
