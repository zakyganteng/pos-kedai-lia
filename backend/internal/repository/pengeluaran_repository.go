package repository

import (
	"database/sql"
	"pos-kedai-lia/backend/internal/model"
)

// PengeluaranRepository adalah struktur yang menyimpan koneksi database
type PengeluaranRepository struct {
	DB *sql.DB
}

// NewPengeluaranRepository berfungsi untuk membuat instance repository baru
func NewPengeluaranRepository(db *sql.DB) *PengeluaranRepository {
	return &PengeluaranRepository{DB: db}
}

// TambahPengeluaran untuk menyimpan data pengeluaran baru ke database PostgreSQL
func (r *PengeluaranRepository) TambahPengeluaran(p model.Pengeluaran) error {
	query := `
		INSERT INTO pengeluaran (id, outlet_id, dicatat_oleh, kategori, jumlah, tanggal, keterangan)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	// Menjalankan query ke database
	_, err := r.DB.Exec(query, p.ID, p.OutletID, p.DicatatOleh, p.Kategori, p.Jumlah, p.Tanggal, p.Keterangan)
	return err
}

// AmbilSemuaPengeluaran untuk mengambil daftar pengeluaran, diurutkan dari yang terbaru
func (r *PengeluaranRepository) AmbilSemuaPengeluaran() ([]model.Pengeluaran, error) {
	query := `SELECT id, outlet_id, dicatat_oleh, kategori, jumlah, tanggal, keterangan FROM pengeluaran ORDER BY tanggal DESC`
	
	rows, err := r.DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close() // Pastikan koneksi ditutup setelah selesai

	var hasil []model.Pengeluaran
	
	// Membaca baris data satu per satu
	for rows.Next() {
		var p model.Pengeluaran
		if err := rows.Scan(&p.ID, &p.OutletID, &p.DicatatOleh, &p.Kategori, &p.Jumlah, &p.Tanggal, &p.Keterangan); err != nil {
			return nil, err
		}
		hasil = append(hasil, p)
	}
	
	return hasil, nil
}