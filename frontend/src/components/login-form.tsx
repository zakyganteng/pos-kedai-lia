'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, sessionApi } from '@/lib/api';
import type { CurrentUser } from '@/lib/types';

type SessionCreated = { user: CurrentUser; expiresAt: string };

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (email.trim() === '' || password === '') {
      setError('Masukkan email dan kata sandi.');
      return;
    }
    if (!event.currentTarget.checkValidity()) {
      setError('Masukkan alamat email yang valid.');
      return;
    }
    setBusy(true);
    setError(null);

    sessionApi<SessionCreated>('POST', { email, password })
      .then(() => {
        // Nothing is wiped here. Every per counter key is namespaced by user
        // id, so a new user inherits nothing, and a returning user keeps the
        // unresolved attempt they still need to settle.
        setPassword('');
        router.replace('/kasir');
      })
      .catch((caught: unknown) => {
        setBusy(false);
        if (caught instanceof ApiError) {
          if (caught.status === 401) {
            setError('Email atau kata sandi tidak cocok.');
            return;
          }
          if (caught.status === 429) {
            setError('Terlalu banyak percobaan masuk. Tunggu beberapa saat lalu coba lagi.');
            return;
          }
          if (caught.status === 0) {
            setError('Server tidak dapat dihubungi. Periksa koneksi lalu coba lagi.');
            return;
          }
          setError(caught.message);
          return;
        }
        setError('Terjadi kesalahan yang tidak dikenali.');
      });
  };

  return (
    <main className="login-page" id="konten">
      <section className="login-panel">
        <h1 className="page-title">Lia POS</h1>
        <p className="meta">Masuk untuk membuka kasir Kedai Lia 287 dan Lia Salon.</p>

        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="input"
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="login-password">
              Kata sandi
            </label>
            <input
              id="login-password"
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error !== null ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}

          <button type="submit" className="btn btn-primary btn-pay" disabled={busy}>
            {busy ? 'Memproses' : 'Masuk'}
          </button>
        </form>
      </section>
    </main>
  );
}
