// Tipe-tipe ini SENGAJA ditulis manual biar persis sama dengan struct Go di
// backend/internal/model/. Kalau kamu ubah model di backend, ingat untuk
// update juga tipe yang cocok di sini.

export type Role = "owner" | "admin" | "kasir";

export interface Pengguna {
  id: string;
  nama: string;
  email: string;
  role: Role;
}

export interface Item {
  id: string;
  outlet_id: string;
  nama: string;
  type: "product" | "service";
  harga: number;
  created_at: string;
}

export interface Transaksi {
  id: string;
  outlet_id: string;
  pengguna_id: string;
  kode_transaksi: string;
  tanggal: string;
  total: number;
  status: "pending" | "selesai" | "dibatalkan";
}
