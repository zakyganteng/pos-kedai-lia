"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getItems, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Item } from "@/types";

const OUTLET_KEDAI = "11111111-1111-1111-1111-111111111111";

function formatRupiah(angka: number) {
  return "Rp" + angka.toLocaleString("id-ID");
}

export default function DashboardPage() {
  const { token, pengguna, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State untuk Keranjang
  const [cart, setCart] = useState<{ item: Item; qty: number }[]>([]);

  useEffect(() => {
    if (!authLoading && !token) {
      router.push("/login");
    }
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    getItems(token, OUTLET_KEDAI)
      .then(setItems)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Gagal memuat menu");
      })
      .finally(() => setLoadingItems(false));
  }, [token]);

  // Fungsi tambah ke keranjang
  const addToCart = (selectedItem: Item) => {
    setCart((prev) => {
      const exists = prev.find((c) => c.item.id === selectedItem.id);
      if (exists) {
        return prev.map((c) =>
          c.item.id === selectedItem.id ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [...prev, { item: selectedItem, qty: 1 }];
    });
  };

  // --- KODE BARU: Fungsi kurangi dari keranjang ---
  const kurangiPesanan = (itemId: string) => {
    setCart((prev) => {
      // Cari item yang ingin dikurangi
      const existingItem = prev.find((c) => c.item.id === itemId);
      
      // Jika jumlahnya 1, maka hapus dari keranjang
      if (existingItem?.qty === 1) {
        return prev.filter((c) => c.item.id !== itemId);
      }
      
      // Jika lebih dari 1, kurangi jumlahnya 1
      return prev.map((c) =>
        c.item.id === itemId ? { ...c, qty: c.qty - 1 } : c
      );
    });
  };
  // ------------------------------------------------

  // Hitung Total
  const totalHarga = cart.reduce((total, c) => total + c.item.harga * c.qty, 0);

  // Fungsi untuk tombol Bayar
  const handleBayarPesanan = () => {
    console.log("Data pesanan yang siap dikirim ke backend:", cart);
    alert("Mantap! Cek Console browser ya.");
  };

  if (authLoading || !token) {
    return <div style={{ padding: 24 }}>Memuat...</div>;
  }

  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#f5f5f4" }}>
      
      {/* Sisi Kiri: Daftar Menu */}
      <div style={{ flex: 2, padding: 24, overflowY: "auto", borderRight: "1px solid #d6d3d1" }}>
        <div className="header" style={{ marginBottom: 20 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>Halo, {pengguna?.nama}</h2>
            <span className="badge">{pengguna?.role}</span>
          </div>
          <button onClick={logout} style={{ width: "auto", background: "#78716c", marginTop: 0, padding: "8px 16px" }}>
            Keluar
          </button>
        </div>

        <h3 style={{ marginBottom: 16 }}>Menu Kedai Lia 287 & Salon Lia</h3>

        {error && <div className="error">{error}</div>}
        {loadingItems && <p>Memuat menu...</p>}

        {/* Grid Menu agar tampil ke samping */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {items.map((item) => (
            <div 
              className="item-card" 
              key={item.id} 
              onClick={() => addToCart(item)}
              style={{ display: "block", cursor: "pointer", margin: 0 }}
            >
              <div className="nama" style={{ marginBottom: 4 }}>{item.nama}</div>
              <div className="type" style={{ marginBottom: 8 }}>{item.type === "product" ? "Produk" : "Layanan"}</div>
              <div className="harga">{formatRupiah(item.harga)}</div>
            </div>
          ))}
        </div>

        {!loadingItems && items.length === 0 && !error && (
          <p style={{ color: "#78716c" }}>Belum ada item.</p>
        )}
      </div>

      {/* Sisi Kanan: Keranjang Pesanan */}
      <div style={{ flex: 1, padding: 24, backgroundColor: "white", display: "flex", flexDirection: "column" }}>
        <h3 style={{ marginBottom: 20 }}>Rincian Pesanan</h3>
        
        <div style={{ flex: 1, overflowY: "auto" }}>
          {cart.length === 0 ? (
            <p style={{ color: "#a8a29e", textAlign: "center", marginTop: 40 }}>Keranjang kosong</p>
          ) : (
            cart.map((c) => (
              <div key={c.item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed #e7e5e4" }}>
                
                {/* Info Nama Menu */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.item.nama}</div>
                  <div style={{ fontSize: 12, color: "#78716c" }}>{formatRupiah(c.item.harga)}</div>
                </div>

                {/* --- KODE BARU: Tombol Plus Minus --- */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginRight: "16px" }}>
                  <button 
                    onClick={() => kurangiPesanan(c.item.id)}
                    style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1px solid #d6d3d1", backgroundColor: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}
                  >
                    -
                  </button>
                  <span style={{ fontWeight: "bold", width: "20px", textAlign: "center" }}>{c.qty}</span>
                  <button 
                    onClick={() => addToCart(c.item)}
                    style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1px solid #1e7e72", backgroundColor: "#1e7e72", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold" }}
                  >
                    +
                  </button>
                </div>
                {/* ------------------------------------ */}

                {/* Subtotal Harga Item */}
                <div style={{ fontWeight: 600, minWidth: "80px", textAlign: "right" }}>
                  {formatRupiah(c.item.harga * c.qty)}
                </div>
                
              </div>
            ))
          )}
        </div>

        <div style={{ borderTop: "2px solid #e7e5e4", paddingTop: 16, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 18, fontWeight: "bold" }}>
            <span>Total</span>
            <span>{formatRupiah(totalHarga)}</span>
          </div>
          <button 
            onClick={handleBayarPesanan}
            style={{ width: "100%", padding: 16, fontSize: 16, backgroundColor: "#1e7e72", color: "white", borderRadius: "8px", border: "none", cursor: cart.length === 0 ? "not-allowed" : "pointer", opacity: cart.length === 0 ? 0.5 : 1 }} 
            disabled={cart.length === 0}
          >
            Bayar Pesanan
          </button>
        </div>
      </div>

    </div>
  );
}