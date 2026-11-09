"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="login-page">
    <section className="login-panel" role="alert">
      <h1>Halaman belum dapat ditampilkan</h1>
      <p>Coba muat kembali halaman ini. Jika sedang melakukan pembayaran, periksa transaksi yang tersimpan sebelum membuat pesanan baru.</p>
      <button type="button" onClick={reset}>Muat kembali</button>
      <Link href="/struk">Periksa transaksi</Link>
    </section>
  </main>;
}
