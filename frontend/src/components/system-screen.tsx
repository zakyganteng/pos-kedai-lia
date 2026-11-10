'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isOwner } from '@/lib/nav';
import type { IntegrationStatus, Integrations } from '@/lib/types';
import { useSession } from '@/hooks/use-session';
import { useResource } from '@/hooks/use-paged';
import { describeFailure, isUnauthorized } from '@/hooks/use-api-error';
import {
  ErrorBlock,
  LoadingBlock,
  Notice,
  PermissionBlock,
  StatusBadge,
} from './states';

type ProbeState =
  | { kind: 'loading' }
  | { kind: 'ok'; status: string }
  | { kind: 'down'; message: string };

type Probes = { live: ProbeState; ready: ProbeState };

const LOADING: ProbeState = { kind: 'loading' };
const INITIAL: Probes = { live: LOADING, ready: LOADING };

/**
 * Liveness and readiness, each read on its own.
 *
 * A readiness 503 is an answer, not a transport failure: the service replied
 * that it is not ready, and the backend's message is what gets shown.
 *
 * Results carry the attempt that produced them, so a re-check shows both
 * probes as pending again without writing state from the effect body, and a
 * late answer from a previous attempt is dropped instead of overwriting a
 * newer one.
 */
function useHealth(onSessionExpired: () => void, enabled: boolean) {
  const [loaded, setLoaded] = useState<{ token: number } & Probes>({ token: 0, ...INITIAL });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    const probe = async (path: string): Promise<ProbeState> => {
      try {
        const answer = await api<{ status?: string }>(path);
        return { kind: 'ok', status: answer?.status ?? '' };
      } catch (caught: unknown) {
        if (isUnauthorized(caught)) onSessionExpired();
        return { kind: 'down', message: describeFailure(caught).message };
      }
    };

    const settle = (which: 'live' | 'ready', state: ProbeState) =>
      setLoaded((current) =>
        current.token === attempt
          ? { ...current, [which]: state }
          : { token: attempt, ...INITIAL, [which]: state },
      );

    void probe('/health/live').then((state) => {
      if (!stopped) settle('live', state);
    });
    void probe('/health/ready').then((state) => {
      if (!stopped) settle('ready', state);
    });

    return () => {
      stopped = true;
    };
  }, [attempt, enabled, onSessionExpired]);

  const recheck = useCallback(() => setAttempt((value) => value + 1), []);
  const probes: Probes = loaded.token === attempt ? loaded : INITIAL;
  return { probes, recheck };
}

function IntegrationCard({
  title,
  status,
  explanation,
}: {
  title: string;
  status: IntegrationStatus;
  explanation: string;
}) {
  return (
    <section className="stat-card" aria-label={title}>
      <h3 className="stat-label">{title}</h3>
      <p className="stat-value">{status.provider}</p>
      <div className="btn-row">
        <StatusBadge
          label={status.configured ? 'Terkonfigurasi' : 'Belum dikonfigurasi'}
          tone={status.configured ? 'success' : 'warning'}
        />
        {status.productionSupported ? null : (
          <StatusBadge label="Bukan untuk produksi" tone="error" />
        )}
      </div>
      <p className="meta">{explanation}</p>
      <p className="meta">
        {status.configured
          ? 'Server melaporkan konfigurasi ini terisi. Ini bukan jaminan bahwa penyedia dapat dihubungi.'
          : 'Server melaporkan konfigurasi ini kosong, sehingga tidak ada pengiriman nyata yang terjadi.'}
      </p>
    </section>
  );
}

function ProbeRow({
  label,
  state,
  okLabel,
  downLabel,
  note,
}: {
  label: string;
  state: ProbeState;
  okLabel: string;
  downLabel: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <h3 className="stat-label">{label}</h3>
      {state.kind === 'loading' ? (
        <LoadingBlock label="Memeriksa…" />
      ) : state.kind === 'ok' ? (
        <>
          <p className="stat-value">{okLabel}</p>
          <StatusBadge label={okLabel} tone="success" />
        </>
      ) : (
        <>
          <p className="stat-value">{downLabel}</p>
          <StatusBadge label={downLabel} tone="error" />
          <p className="meta">{state.message}</p>
        </>
      )}
      <p className="meta">{note}</p>
    </div>
  );
}

/**
 * Sistem: what the server says about its own payment and notification
 * configuration, plus its liveness and readiness probes.
 *
 * Every value here is the server's answer. The screen never claims an
 * integration works; it only repeats what the backend reports, including the
 * fact that none of it is certified for production use.
 */
export function SystemScreen() {
  const { user, line, onSessionExpired } = useSession();
  const owner = isOwner(user.role);

  const integrations = useResource<Integrations>(owner ? '/integrations' : null, {
    onUnauthorized: onSessionExpired,
    errorMessage: 'Status integrasi belum dapat dimuat.',
  });
  const { probes, recheck } = useHealth(onSessionExpired, owner);

  if (!owner) {
    return (
      <main className="pos-main" id="konten">
        <div className="page-head">
          <h1 className="page-title">Sistem</h1>
          <p className="meta">{line.name}</p>
        </div>
        <PermissionBlock>
          Halaman sistem hanya dapat dibuka oleh pemilik. Akun {user.name} tidak dapat melihat
          status integrasi server.
        </PermissionBlock>
      </main>
    );
  }

  const value = integrations.value;

  return (
    <main className="pos-main" id="konten">
      <div className="page-head">
        <h1 className="page-title">Sistem</h1>
        <p className="meta">{line.name}</p>
      </div>

      <section className="section" aria-labelledby="integrasi-judul">
        <h2 className="section-title" id="integrasi-judul">
          Integrasi
        </h2>

        {integrations.loading ? <LoadingBlock label="Memuat status integrasi…" /> : null}

        {integrations.forbidden ? (
          <PermissionBlock>Status integrasi hanya dapat dibaca oleh pemilik.</PermissionBlock>
        ) : null}

        {integrations.error !== null ? (
          <ErrorBlock
            title="Status integrasi belum dapat dimuat."
            message={integrations.error}
            onRetry={integrations.reload}
          />
        ) : null}

        {value !== null ? (
          <>
            <Notice tone="warning" title="Integrasi ini belum siap untuk produksi.">
              <p className="meta">
                Server menandai dirinya belum siap produksi, dan kedua integrasi di bawah ini
                menyatakan tidak didukung untuk produksi. Keduanya adalah adaptor pengembangan:
                tidak ada sertifikasi QRIS maupun WhatsApp di belakangnya. Jangan dipakai untuk
                menagih uang pelanggan sungguhan.
              </p>
            </Notice>

            <div className="stat-grid">
              <IntegrationCard
                title="Pembayaran"
                status={value.payment}
                explanation="Penyedia pembayaran yang dipakai untuk QRIS. Pembayaran tunai tidak melewati penyedia."
              />
              <IntegrationCard
                title="Notifikasi WhatsApp"
                status={value.notification}
                explanation="Penyedia pengiriman struk WhatsApp. Bila tidak aktif, permintaan kirim ulang pada halaman Notifikasi ditolak."
              />
            </div>
          </>
        ) : null}
      </section>

      <section className="section" aria-labelledby="kesehatan-judul">
        <h2 className="section-title" id="kesehatan-judul">
          Kesehatan server
        </h2>

        <div className="stat-grid">
          <ProbeRow
            label="Proses (liveness)"
            state={probes.live}
            okLabel="Hidup"
            downLabel="Tidak menjawab"
            note="Menjawab bahwa proses server masih berjalan."
          />
          <ProbeRow
            label="Kesiapan (readiness)"
            state={probes.ready}
            okLabel="Siap"
            downLabel="Tidak siap"
            note="Mencakup koneksi basis data dan versi skema. Jawaban 503 berarti server menyatakan dirinya belum siap."
          />
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={recheck}>
            Periksa ulang
          </button>
        </div>

        <p className="meta">
          Halaman ini membaca konfigurasi dan pemeriksaan mandiri server, bukan konektivitas nyata
          ke penyedia pembayaran atau WhatsApp.
        </p>
      </section>
    </main>
  );
}
