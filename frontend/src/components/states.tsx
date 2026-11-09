'use client';

import type { ReactNode } from 'react';
import type { MutationFailure } from '@/hooks/use-mutation';

export function LoadingBlock({ label }: { label: string }) {
  return (
    <p className="meta" role="status">
      {label}
    </p>
  );
}

export function EmptyBlock({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="notice">
      <p className="notice-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorBlock({
  title,
  message,
  onRetry,
  retryLabel = 'Coba lagi',
}: {
  title: string;
  message?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="notice notice-error" role="alert">
      <p className="notice-title">{title}</p>
      {message ? <p className="meta">{message}</p> : null}
      {onRetry ? (
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PermissionBlock({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-warning">
      <p className="notice-title">Akun ini tidak memiliki akses</p>
      <p className="meta">{children}</p>
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
  actions,
  live,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  live?: 'polite' | 'assertive';
}) {
  const toneClass = tone === 'neutral' ? '' : ` notice-${tone}`;
  return (
    <div
      className={`notice${toneClass}`}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live={live}
    >
      <p className="notice-title">{title}</p>
      {children}
      {actions ? <div className="btn-row">{actions}</div> : null}
    </div>
  );
}

/**
 * Why a write did not go through.
 *
 * A refusal and a lost response are different facts. When the server said no,
 * the record is unchanged and the screen may say so. When the response was
 * lost, the write may already have been applied, so the only honest line is
 * that the outcome is unknown, with a way to go and look.
 */
export function WriteError({
  failure,
  unchangedNote,
  onRecheck,
}: {
  failure: MutationFailure;
  /** What is still true after the server definitively refused the write. */
  unchangedNote: string;
  /** Re-reads the record. An uncertain write can only be settled by looking. */
  onRecheck: () => void;
}) {
  if (failure.uncertain) {
    return (
      <div className="write-error" role="alert">
        <p className="field-error">
          {failure.message} Hasil permintaan ini belum dikonfirmasi server, jadi perubahan bisa
          saja sudah tersimpan.
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={onRecheck}>
            Periksa ke server
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="write-error" role="alert">
      <p className="field-error">
        {failure.message} {unchangedNote}
      </p>
    </div>
  );
}

/** Status word plus colour. Colour is never the only signal. */
export function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
}) {
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

export function paymentTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'confirmed') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'failed' || status === 'expired') return 'error';
  return 'neutral';
}

export function saleTone(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'paid') return 'success';
  if (status === 'pending_payment') return 'warning';
  if (status === 'voided' || status === 'cancelled') return 'error';
  return 'neutral';
}
