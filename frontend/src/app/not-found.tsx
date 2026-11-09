import Link from "next/link";

export default function NotFound() {
  return <main className="login-page">
    <section className="login-panel">
      <h1>Halaman tidak ditemukan</h1>
      <p>Alamat ini tidak tersedia di Lia POS.</p>
      <Link href="/kasir">Kembali ke kasir</Link>
    </section>
  </main>;
}
