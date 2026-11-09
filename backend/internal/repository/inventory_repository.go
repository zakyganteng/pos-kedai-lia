package repository

import "database/sql"

type InventoryRepository struct {
	db *sql.DB
}

func NewInventoryRepository(db *sql.DB) *InventoryRepository {
	return &InventoryRepository{db: db}
}

func (r *InventoryRepository) CreateForItem(itemID string) error {
	_, err := r.db.Exec(`INSERT INTO inventory (item_id, stok) VALUES ($1, 0)`, itemID)
	return err
}

func (r *InventoryRepository) UpdateStok(itemID string, stok int) error {
	_, err := r.db.Exec(`UPDATE inventory SET stok = $1, updated_at = now() WHERE item_id = $2`, stok, itemID)
	return err
}
