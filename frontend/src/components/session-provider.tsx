'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { sessionApi } from '@/lib/api';
import type { BusinessLine, CurrentUser } from '@/lib/types';
import { SessionContext, type SessionValue } from '@/hooks/use-session';
import {
  clearRoutineStored,
  getStoredJson,
  hasFrozenAttempt,
  setStoredString,
  storageKeys,
  useStoredString,
} from '@/hooks/use-storage';
import { parseDraft } from '@/hooks/use-draft';
import { describeFailure, isUnauthorized } from '@/hooks/use-api-error';
import { AppHeader } from './app-header';
import { Dialog } from './dialog';
import { ErrorBlock, LoadingBlock, Notice } from './states';

type LoadState =
  | { name: 'loading' }
  | { name: 'ready'; user: CurrentUser }
  | { name: 'expired' }
  | { name: 'error'; message: string };

const NO_USER_KEY = 'lia-pos.line.__none__';

type Switch = { to: BusinessLine; draftItems: number };

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<LoadState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pendingSwitch, setPendingSwitch] = useState<Switch | null>(null);
  const [logoutWarning, setLogoutWarning] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    sessionApi<CurrentUser>('GET')
      .then((user) => {
        if (stale) return;
        setLoaded({ name: 'ready', user });
      })
      .catch((caught: unknown) => {
        if (stale) return;
        if (isUnauthorized(caught)) {
          setLoaded({ name: 'expired' });
          router.replace('/login');
          return;
        }
        setLoaded({ name: 'error', message: describeFailure(caught).message });
      });
    return () => {
      stale = true;
    };
  }, [attempt, router]);

  const state: LoadState = loaded ?? { name: 'loading' };
  const user = state.name === 'ready' ? state.user : null;
  const lines = useMemo(() => user?.businessLines ?? [], [user]);

  const lineKey = user === null ? NO_USER_KEY : storageKeys.selectedLine(user.id);
  const rememberedLineId = useStoredString(lineKey);

  // The remembered id is only honoured when it is still an assigned line.
  const line = useMemo(
    () => lines.find((entry) => entry.id === rememberedLineId) ?? lines[0] ?? null,
    [lines, rememberedLineId],
  );

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  }, []);

  const onSessionExpired = useCallback(() => {
    setLoaded({ name: 'expired' });
    router.replace('/login');
  }, [router]);

  const runLogout = useCallback(() => {
    setLogoutWarning(false);
    setLoggingOut(true);
    setLogoutError(null);
    sessionApi<void>('DELETE')
      .then(() => {
        // Drafts and the line choice go; an unresolved attempt stays, scoped
        // to this user, so it can still be resolved after signing back in.
        clearRoutineStored();
        router.replace('/login');
      })
      .catch((caught: unknown) => {
        if (isUnauthorized(caught)) {
          clearRoutineStored();
          router.replace('/login');
          return;
        }
        setLoggingOut(false);
        setLogoutError(describeFailure(caught).message);
      });
  }, [router]);

  const lineRef = useMemo(
    () => (user === null || line === null ? null : { userId: user.id, lineId: line.id }),
    [user, line],
  );

  const logout = useCallback(() => {
    if (lineRef !== null && hasFrozenAttempt(lineRef)) {
      setLogoutWarning(true);
      return;
    }
    runLogout();
  }, [lineRef, runLogout]);

  const commitLine = useCallback(
    (next: BusinessLine) => {
      if (user === null) return;
      setStoredString(storageKeys.selectedLine(user.id), next.id);
      setPendingSwitch(null);
    },
    [user],
  );

  const requestLineChange = useCallback(
    (nextId: string) => {
      if (user === null || line === null) return;
      const next = lines.find((entry) => entry.id === nextId);
      if (next === undefined || next.id === line.id) return;
      const draft = getStoredJson(
        storageKeys.draft({ userId: user.id, lineId: line.id }),
        parseDraft,
      );
      if (draft.items.length > 0) {
        setPendingSwitch({ to: next, draftItems: draft.items.length });
        return;
      }
      commitLine(next);
    },
    [user, line, lines, commitLine],
  );

  const value: SessionValue | null = useMemo(() => {
    if (user === null || line === null) return null;
    return {
      user,
      lines,
      line,
      workspace: { userId: user.id, lineId: line.id },
      requestLineChange,
      logout,
      loggingOut,
      onSessionExpired,
    };
  }, [user, lines, line, requestLineChange, logout, loggingOut, onSessionExpired]);

  if (state.name === 'loading') {
    return (
      <main className="pos-main" id="konten">
        <LoadingBlock label="Memuat sesi…" />
      </main>
    );
  }

  if (state.name === 'expired') {
    return (
      <main className="pos-main" id="konten">
        <Notice tone="warning" title="Sesi Anda telah berakhir" live="polite">
          <p className="meta">Mengarahkan ke halaman masuk.</p>
        </Notice>
      </main>
    );
  }

  if (state.name === 'error') {
    return (
      <main className="pos-main" id="konten">
        <ErrorBlock title="Sesi belum dapat dimuat." message={state.message} onRetry={retry} />
      </main>
    );
  }

  if (value === null) {
    return (
      <main className="pos-main" id="konten">
        <Notice tone="warning" title="Belum ada unit usaha yang ditugaskan">
          <p className="meta">
            Akun {state.user.name} belum ditugaskan ke unit usaha mana pun, jadi kasir belum dapat
            dibuka. Hubungi pemilik untuk mendapatkan akses.
          </p>
        </Notice>
        <div className="btn-row" style={{ marginTop: 'var(--s4)' }}>
          <button type="button" className="btn btn-secondary" onClick={logout} disabled={loggingOut}>
            Keluar
          </button>
        </div>
        {logoutError !== null ? (
          <div style={{ marginTop: 'var(--s4)' }}>
            <ErrorBlock title="Belum dapat keluar." message={logoutError} onRetry={logout} />
          </div>
        ) : null}
      </main>
    );
  }

  return (
    <SessionContext.Provider value={value}>
      <a className="skip-link" href="#konten">
        Lewati ke konten utama
      </a>
      <AppHeader />
      {logoutError !== null ? (
        <div className="pos-main" style={{ paddingBottom: 0 }}>
          <ErrorBlock title="Belum dapat keluar." message={logoutError} onRetry={logout} />
        </div>
      ) : null}
      {/* Keying on the workspace remounts the screen when the user or the
          selected line changes, so no search box, filter or review toggle from
          one counter leaks into the other. Drafts and unresolved attempts live
          in the store, keyed by the same pair, so nothing is lost. */}
      <Fragment key={`${value.user.id}\u0000${value.line.id}`}>{children}</Fragment>
      <Dialog
        open={logoutWarning}
        title="Masih ada permintaan pembayaran yang belum jelas hasilnya"
        onClose={() => setLogoutWarning(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setLogoutWarning(false)}
            >
              Tetap di sini
            </button>
            <button type="button" className="btn btn-primary" onClick={runLogout}>
              Keluar sekarang
            </button>
          </>
        }
      >
        <p>
          Satu permintaan pembayaran di {value.line.name} belum diketahui hasilnya. Permintaan itu
          tidak dihapus saat Anda keluar.
        </p>
        <p className="meta">
          Permintaan tersimpan atas nama {value.user.name} dan hanya muncul kembali ketika akun yang
          sama masuk lagi di peramban ini. Pengguna lain tidak dapat melihat atau mengirim ulang
          permintaan tersebut.
        </p>
        <p className="meta">
          Lebih aman menyelesaikannya sekarang lewat tombol kirim ulang di halaman kasir, atau
          memeriksa daftar struk terlebih dahulu.
        </p>
      </Dialog>

      <Dialog
        open={pendingSwitch !== null}
        title="Pindah unit usaha?"
        onClose={() => setPendingSwitch(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPendingSwitch(null)}
            >
              Tetap di {value.line.name}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => pendingSwitch !== null && commitLine(pendingSwitch.to)}
            >
              Pindah ke {pendingSwitch?.to.name}
            </button>
          </>
        }
      >
        <p>
          Pesanan {value.line.name} masih berisi {pendingSwitch?.draftItems} jenis item yang belum
          diselesaikan.
        </p>
        <p className="meta">
          Pesanan itu tidak ikut berpindah dan tidak dihapus. Pesanan tetap tersimpan untuk{' '}
          {value.line.name} dan muncul kembali ketika Anda kembali ke unit usaha tersebut.
        </p>
      </Dialog>
    </SessionContext.Provider>
  );
}
