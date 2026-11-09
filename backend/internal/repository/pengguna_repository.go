package repository

import (
	"database/sql"

	"github.com/username/pos-kedai-lia/backend/internal/model"
)

type PenggunaRepository struct {
	db *sql.DB
}

func NewPenggunaRepository(db *sql.DB) *PenggunaRepository {
	return &PenggunaRepository{db: db}
}

func (r *PenggunaRepository) Create(p model.Pengguna) (model.Pengguna, error) {
	query := `INSERT INTO pengguna (outlet_id, nama, email, password_hash, role)
	          VALUES ($1, $2, $3, $4, $5)
	          RETURNING id, created_at`
	err := r.db.QueryRow(query, p.OutletID, p.Nama, p.Email, p.PasswordHash, p.Role).
		Scan(&p.ID, &p.CreatedAt)
	return p, err
}

func (r *PenggunaRepository) FindByEmail(email string) (model.Pengguna, error) {
	var p model.Pengguna
	query := `SELECT id, outlet_id, nama, email, password_hash, role, created_at
	          FROM pengguna WHERE email = $1`
	err := r.db.QueryRow(query, email).
		Scan(&p.ID, &p.OutletID, &p.Nama, &p.Email, &p.PasswordHash, &p.Role, &p.CreatedAt)
	return p, err
}
