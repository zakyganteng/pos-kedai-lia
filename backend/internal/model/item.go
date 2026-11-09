package model

import "time"

type Item struct {
	ID        string    `json:"id"`
	OutletID  string    `json:"outlet_id"`
	Nama      string    `json:"nama"`
	Type      string    `json:"type"`
	Harga     float64   `json:"harga"`
	CreatedAt time.Time `json:"created_at"`
}

type Inventory struct {
	ID        string    `json:"id"`
	ItemID    string    `json:"item_id"`
	Stok      int       `json:"stok"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Karyawan struct {
	ID        string    `json:"id"`
	OutletID  string    `json:"outlet_id"`
	Nama      string    `json:"nama"`
	NoHP      string    `json:"no_hp"`
	Posisi    string    `json:"posisi"`
	CreatedAt time.Time `json:"created_at"`
}
