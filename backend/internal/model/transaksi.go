package model

import "time"

type Transaksi struct {
	ID             string    `json:"id"`
	OutletID       string    `json:"outlet_id"`
	PenggunaID     string    `json:"pengguna_id"`
	KodeTransaksi  string    `json:"kode_transaksi"`
	Tanggal        time.Time `json:"tanggal"`
	Total          float64   `json:"total"`
	Status         string    `json:"status"` // "pending", "selesai", "dibatalkan"
}

// KaryawanID & DurasiMenit cuma keisi kalau item-nya bertipe service
type DetailTransaksi struct {
	ID           string  `json:"id"`
	TransaksiID  string  `json:"transaksi_id"`
	ItemID       string  `json:"item_id"`
	KaryawanID   *string `json:"karyawan_id,omitempty"`
	Jumlah       int     `json:"jumlah"`
	HargaSatuan  float64 `json:"harga_satuan"`
	Subtotal     float64 `json:"subtotal"`
	DurasiMenit  *int    `json:"durasi_menit,omitempty"`
}

type Pembayaran struct {
	ID          string     `json:"id"`
	TransaksiID string     `json:"transaksi_id"`
	Metode      string     `json:"metode"` // "tunai" atau "qris"
	Status      string     `json:"status"` // "menunggu", "berhasil", "gagal"
	QrisID      *string    `json:"qris_id,omitempty"`
	QrString    *string    `json:"qr_string,omitempty"`
	PaidAt      *time.Time `json:"paid_at,omitempty"`
}

type Pengeluaran struct {
	ID           string    `json:"id"`
	OutletID     string    `json:"outlet_id"`
	DicatatOleh  string    `json:"dicatat_oleh"`
	Kategori     string    `json:"kategori"`
	Jumlah       float64   `json:"jumlah"`
	Tanggal      time.Time `json:"tanggal"`
	Keterangan   string    `json:"keterangan"`
}
