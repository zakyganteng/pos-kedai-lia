package repository

import "database/sql"

type PembayaranRepository struct {
	db *sql.DB
}

func NewPembayaranRepository(db *sql.DB) *PembayaranRepository {
	return &PembayaranRepository{db: db}
}

func (r *PembayaranRepository) Create(transaksiID, metode, status string, qrisID, qrString *string) (string, error) {
	var id string
	err := r.db.QueryRow(
		`INSERT INTO pembayaran (transaksi_id, metode, status, qris_id, qr_string)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		transaksiID, metode, status, qrisID, qrString,
	).Scan(&id)
	return id, err
}

func (r *PembayaranRepository) FindByTransaksiID(transaksiID string) (id, metode, status string, qrisID, qrString *string, err error) {
	err = r.db.QueryRow(
		`SELECT id, metode, status, qris_id, qr_string FROM pembayaran WHERE transaksi_id = $1`,
		transaksiID,
	).Scan(&id, &metode, &status, &qrisID, &qrString)
	return
}

func (r *PembayaranRepository) FindByQrisID(qrisID string) (id, transaksiID string, err error) {
	err = r.db.QueryRow(
		`SELECT id, transaksi_id FROM pembayaran WHERE qris_id = $1`, qrisID,
	).Scan(&id, &transaksiID)
	return
}

func (r *PembayaranRepository) MarkBerhasil(qrisID string) (transaksiID string, err error) {
	err = r.db.QueryRow(
		`UPDATE pembayaran SET status = 'berhasil', paid_at = now()
		 WHERE qris_id = $1 RETURNING transaksi_id`, qrisID,
	).Scan(&transaksiID)
	return
}
