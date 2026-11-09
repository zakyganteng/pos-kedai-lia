package repository

import (
	"database/sql"

	"github.com/username/pos-kedai-lia/backend/internal/model"
)

type TransaksiRepository struct {
	db *sql.DB
}

func NewTransaksiRepository(db *sql.DB) *TransaksiRepository {
	return &TransaksiRepository{db: db}
}

// CreateWithDetail menyimpan transaksi beserta semua detail item-nya
// dalam SATU database transaction (istilah "transaction" di sini beda
// dengan "transaksi" bisnis kita, ini istilah teknis database).
// Kalau salah satu detail gagal disimpan, semuanya dibatalkan (rollback),
// jadi nggak akan ada transaksi "setengah jadi" di database.
func (r *TransaksiRepository) CreateWithDetail(trx model.Transaksi, details []model.DetailTransaksi) (model.Transaksi, []model.DetailTransaksi, error) {
	dbTx, err := r.db.Begin()
	if err != nil {
		return model.Transaksi{}, nil, err
	}
	defer dbTx.Rollback() // no-op kalau sudah Commit

	err = dbTx.QueryRow(
		`INSERT INTO transaksi (outlet_id, pengguna_id, kode_transaksi, total, status)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id, tanggal`,
		trx.OutletID, trx.PenggunaID, trx.KodeTransaksi, trx.Total, trx.Status,
	).Scan(&trx.ID, &trx.Tanggal)
	if err != nil {
		return model.Transaksi{}, nil, err
	}

	for i := range details {
		details[i].TransaksiID = trx.ID
		err = dbTx.QueryRow(
			`INSERT INTO detail_transaksi (transaksi_id, item_id, karyawan_id, jumlah, harga_satuan, subtotal, durasi_menit)
			 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
			details[i].TransaksiID, details[i].ItemID, details[i].KaryawanID,
			details[i].Jumlah, details[i].HargaSatuan, details[i].Subtotal, details[i].DurasiMenit,
		).Scan(&details[i].ID)
		if err != nil {
			return model.Transaksi{}, nil, err
		}

		// Kurangi stok kalau item ini bertipe product (item bertipe service dilewati)
		res, err := dbTx.Exec(
			`UPDATE inventory SET stok = stok - $1, updated_at = now()
			 WHERE item_id = $2 AND stok >= $1`,
			details[i].Jumlah, details[i].ItemID,
		)
		if err != nil {
			return model.Transaksi{}, nil, err
		}
		affected, _ := res.RowsAffected()
		rows, err := dbTx.Query(`SELECT 1 FROM inventory WHERE item_id = $1`, details[i].ItemID)
		if err != nil {
			return model.Transaksi{}, nil, err
		}
		hasInventory := rows.Next()
		rows.Close()
		if hasInventory && affected == 0 {
			return model.Transaksi{}, nil, ErrStokTidakCukup
		}
	}

	if err := dbTx.Commit(); err != nil {
		return model.Transaksi{}, nil, err
	}

	return trx, details, nil
}

func (r *TransaksiRepository) FindByID(id string) (model.Transaksi, error) {
	var trx model.Transaksi
	err := r.db.QueryRow(
		`SELECT id, outlet_id, pengguna_id, kode_transaksi, tanggal, total, status
		 FROM transaksi WHERE id = $1`, id,
	).Scan(&trx.ID, &trx.OutletID, &trx.PenggunaID, &trx.KodeTransaksi, &trx.Tanggal, &trx.Total, &trx.Status)
	return trx, err
}

func (r *TransaksiRepository) FindDetailByTransaksiID(transaksiID string) ([]model.DetailTransaksi, error) {
	rows, err := r.db.Query(
		`SELECT id, transaksi_id, item_id, karyawan_id, jumlah, harga_satuan, subtotal, durasi_menit
		 FROM detail_transaksi WHERE transaksi_id = $1`, transaksiID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var details []model.DetailTransaksi
	for rows.Next() {
		var d model.DetailTransaksi
		if err := rows.Scan(&d.ID, &d.TransaksiID, &d.ItemID, &d.KaryawanID, &d.Jumlah, &d.HargaSatuan, &d.Subtotal, &d.DurasiMenit); err != nil {
			return nil, err
		}
		details = append(details, d)
	}
	return details, rows.Err()
}

func (r *TransaksiRepository) FindAll(outletID string) ([]model.Transaksi, error) {
	rows, err := r.db.Query(
		`SELECT id, outlet_id, pengguna_id, kode_transaksi, tanggal, total, status
		 FROM transaksi WHERE outlet_id = $1 ORDER BY tanggal DESC`, outletID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	trxs := []model.Transaksi{}
	for rows.Next() {
		var t model.Transaksi
		if err := rows.Scan(&t.ID, &t.OutletID, &t.PenggunaID, &t.KodeTransaksi, &t.Tanggal, &t.Total, &t.Status); err != nil {
			return nil, err
		}
		trxs = append(trxs, t)
	}
	return trxs, rows.Err()
}

func (r *TransaksiRepository) UpdateStatus(id, status string) error {
	_, err := r.db.Exec(`UPDATE transaksi SET status = $1 WHERE id = $2`, status, id)
	return err
}
