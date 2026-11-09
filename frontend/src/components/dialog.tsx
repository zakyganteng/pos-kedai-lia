'use client';

import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portals need a document. These report false on the server, true after hydration. */
const noSubscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  /** Core callers allow closing without cancelling or abandoning an operation. */
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  labelledById?: string;
};

/**
 * Modal dialog with Escape handling, focus containment and focus restoration.
 * The header and footer sit outside the scrolling content body. Closing a
 * payment dialog never discards its frozen request or its recovery controls.
 */
export function Dialog({ open, title, description, onClose, children, footer }: DialogProps) {
  const mounted = useSyncExternalStore(noSubscribe, onClient, onServer);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => onClose?.(), [onClose]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (panel === null) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && onClose) {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (panel === null) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, close]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 className="dialog-title" id={titleId}>
            {title}
          </h2>
          {onClose ? (
            <button type="button" className="btn btn-secondary" onClick={close}>
              Tutup
            </button>
          ) : null}
        </div>
        <div className="dialog-body" role="region" aria-label={`Isi dialog ${title}`} tabIndex={0}>
          {description ? (
            <p className="meta" id={descriptionId}>
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? <div className="dialog-actions">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
