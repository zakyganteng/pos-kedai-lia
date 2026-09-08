package model

import "time"

type Item struct {
	ID        string    `json:"id"`
	OutletID  string    `json:"outlet_id"`
	Nama      string    `json:"nama"`
	Type      string    `json:"type"` // "product" atau "service"
	Harga     float64   `json:"harga"`
	CreatedAt time.Time `json:"created_at"`
}

// Inventory cuma dipakai kalau Item.Type == "product"
type Inventory struct {
	ID        string    `json:"id"`
	ItemID    string    `json:"item_id"`
	Stok      int       `json:"stok"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Karyawan yang mengerjakan layanan salon, bukan akun login sistem
type Karyawan struct {
	ID        string    `json:"id"`
	OutletID  string    `json:"outlet_id"`
	Nama      string    `json:"nama"`
	NoHP      string    `json:"no_hp"`
	Posisi    string    `json:"posisi"`
	CreatedAt time.Time `json:"created_at"`
}
