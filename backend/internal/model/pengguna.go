package model

import "time"

type Outlet struct {
	ID            string    `json:"id"`
	Nama          string    `json:"nama"`
	KategoriUsaha string    `json:"kategori_usaha"`
	Alamat        string    `json:"alamat"`
	CreatedAt     time.Time `json:"created_at"`
}

type Pengguna struct {
	ID           string    `json:"id"`
	OutletID     *string   `json:"outlet_id"`
	Nama         string    `json:"nama"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
}
