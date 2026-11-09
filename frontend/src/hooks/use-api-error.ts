'use client';

import { ApiError, PAYMENT_UNAVAILABLE, isUnresolvedWrite } from '@/lib/api';

/** How a failed write should be treated when deciding whether it is safe to
 *  send a *new* request. "uncertain" means the server may or may not have
 *  committed the work, so the same idempotency key must be reused. */
export type FailureKind = 'uncertain' | 'definitive' | 'conflict' | 'payment_unavailable';

export type Failure = {
  kind: FailureKind;
  status: number;
  code: string;
  message: string;
  fieldErrors: { field: string; message: string }[];
  requestId?: string;
};

const GENERIC = 'Terjadi kesalahan yang tidak dikenali.';

function fieldErrorsOf(details: unknown): { field: string; message: string }[] {
  if (!Array.isArray(details)) return [];
  return details.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const field = (entry as { field?: unknown }).field;
    const message = (entry as { message?: unknown }).message;
    if (typeof field !== 'string' || typeof message !== 'string') return [];
    return [{ field, message }];
  });
}

export function describeFailure(error: unknown): Failure {
  if (error instanceof ApiError) {
    const { status, code, message, requestId } = error;
    const fieldErrors = fieldErrorsOf(error.details);
    const base = { status, code, message: message || GENERIC, fieldErrors, requestId };

    // Classification of write outcomes lives in lib/api so the client and this
    // screen logic cannot drift apart.
    if (isUnresolvedWrite(error)) return { ...base, kind: 'uncertain' };
    // Refused inside the transaction, before anything was written.
    if (status === 503 && code === PAYMENT_UNAVAILABLE) {
      return { ...base, kind: 'payment_unavailable' };
    }
    // Either a real state conflict or a key reused with a different body.
    // Both require looking at the records before spending a new key.
    if (status === 409) return { ...base, kind: 'conflict' };
    if (status >= 400) return { ...base, kind: 'definitive' };
    return { ...base, kind: 'uncertain' };
  }

  if (error instanceof Error) {
    return {
      kind: 'uncertain',
      status: 0,
      code: 'NETWORK_ERROR',
      message: error.message || GENERIC,
      fieldErrors: [],
    };
  }

  return { kind: 'uncertain', status: 0, code: 'UNKNOWN', message: GENERIC, fieldErrors: [] };
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/** Message for read-only screens, where every failure is just "try again". */
export function readErrorMessage(error: unknown, fallback: string): string {
  const failure = describeFailure(error);
  if (failure.status === 0) return 'Tidak dapat menghubungi server.';
  return failure.message || fallback;
}
