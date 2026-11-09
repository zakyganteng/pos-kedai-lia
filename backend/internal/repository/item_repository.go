package repository

import (
	"database/sql"

	"github.com/username/pos-kedai-lia/backend/internal/model"
)

type ItemRepository struct {
	db *sql.DB
}

func NewItemRepository(db *sql.DB) *ItemRepository {
	return &ItemRepository{db: db}
}

func (r *ItemRepository) Create(item model.Item) (model.Item, error) {
	query := `INSERT INTO item (outlet_id, nama, type, harga)
	          VALUES ($1, $2, $3, $4)
	          RETURNING id, created_at`
	err := r.db.QueryRow(query, item.OutletID, item.Nama, item.Type, item.Harga).
		Scan(&item.ID, &item.CreatedAt)
	return item, err
}

func (r *ItemRepository) FindAll(outletID string) ([]model.Item, error) {
	query := `SELECT id, outlet_id, nama, type, harga, created_at
	          FROM item WHERE outlet_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(query, outletID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []model.Item{}
	for rows.Next() {
		var it model.Item
		if err := rows.Scan(&it.ID, &it.OutletID, &it.Nama, &it.Type, &it.Harga, &it.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

func (r *ItemRepository) FindByID(id string) (model.Item, error) {
	var it model.Item
	query := `SELECT id, outlet_id, nama, type, harga, created_at FROM item WHERE id = $1`
	err := r.db.QueryRow(query, id).
		Scan(&it.ID, &it.OutletID, &it.Nama, &it.Type, &it.Harga, &it.CreatedAt)
	return it, err
}

func (r *ItemRepository) Update(item model.Item) error {
	query := `UPDATE item SET nama = $1, type = $2, harga = $3 WHERE id = $4`
	_, err := r.db.Exec(query, item.Nama, item.Type, item.Harga, item.ID)
	return err
}

func (r *ItemRepository) Delete(id string) error {
	_, err := r.db.Exec(`DELETE FROM item WHERE id = $1`, id)
	return err
}
