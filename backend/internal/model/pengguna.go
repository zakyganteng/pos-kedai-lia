package model

import "time"

type Outlet struct {
	ID             string    `json:"id"`
	Nama           string    `json:"nama"`
	KategoriUsaha  string    `json:"kategori_usaha"` // "kedai" atau "salon"
	Alamat         string    `json:"alamat"`
	CreatedAt      time.Time `json:"created_at"`
}

type Pengguna struct {
	ID           string    `json:"id"`
	OutletID     *string   `json:"outlet_id"` // null = Owner, akses semua outlet
	Nama         string    `json:"nama"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // jangan pernah ikut kekirim di response JSON
	Role         string    `json:"role"` // "owner", "admin", "kasir"
	CreatedAt    time.Time `json:"created_at"`
}
