package repo

import (
	"context"
	"pos/internal/model"

	"github.com/jmoiron/sqlx"
)

func (r *Repo) Stock(ctx context.Context, id string, lock bool) (model.Stock, error) {
	query := "SELECT i.product_id::text AS product_id, r.body->>'name' AS product_name, i.quantity, i.reserved, i.threshold FROM inventory i JOIN records r ON r.id=i.product_id WHERE i.product_id=$1"
	if lock {
		query += " FOR UPDATE OF i"
	}
	var s model.Stock
	err := sqlx.GetContext(ctx, r.q, &s, query, id)
	s.AvailableQuantity = s.Quantity - s.ReservedQuantity
	return s, dbError(err)
}

func (r *Repo) SaveStock(ctx context.Context, s model.Stock) error {
	_, err := r.q.ExecContext(ctx, "UPDATE inventory SET quantity=$2,reserved=$3,threshold=$4 WHERE product_id=$1", s.ProductID, s.Quantity, s.ReservedQuantity, s.LowStockThreshold)
	return dbError(err)
}

func (r *Repo) Stocks(ctx context.Context, line string, low bool) ([]model.Stock, error) {
	query := "SELECT i.product_id::text AS product_id, r.body->>'name' AS product_name, i.quantity, i.reserved, i.threshold FROM inventory i JOIN records r ON r.id=i.product_id WHERE r.line_id=$1 AND (r.body->>'stockTracked')::boolean AND (NOT $2::boolean OR i.quantity-i.reserved<=i.threshold) ORDER BY r.body->>'name',r.id"
	out := []model.Stock{}
	if err := sqlx.SelectContext(ctx, r.q, &out, query, line, low); err != nil {
		return nil, err
	}
	for i := range out {
		out[i].AvailableQuantity = out[i].Quantity - out[i].ReservedQuantity
	}
	return out, nil
}
