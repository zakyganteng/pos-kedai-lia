package service

import (
	"context"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/validation"
)

func (s *Service) movement(ctx context.Context, r *repo.Repo, actor, line, product, sale string, delta int64, kind, reason string) error {
	var saleID *string
	if sale != "" {
		saleID = &sale
	}
	m := model.Movement{ID: lib.ID(), ProductID: product, Type: kind, QuantityDelta: delta, Reason: reason, ActorID: actor, SaleID: saleID, CreatedAt: s.Now()}
	return r.Put(ctx, "movements", m.ID, line, m, true)
}

func (s *Service) Adjust(ctx context.Context, u model.User, line string, v dto.MovementInput) (model.Movement, error) {
	if err := Authorize(u, line, "food_beverage"); err != nil {
		return model.Movement{}, err
	}
	if err := Admin(u); err != nil {
		return model.Movement{}, err
	}
	if v.Type == "adjustment" && u.Role != "owner" {
		return model.Movement{}, lib.Forbidden()
	}
	if !lib.UUID(v.ProductID) || (v.Type != "receive" && v.Type != "adjustment") || v.QuantityDelta == 0 || v.QuantityDelta > lib.MaxStock || v.QuantityDelta < -lib.MaxStock || !validation.Text(v.Reason, 300) || (v.Type == "receive" && v.QuantityDelta < 0) || (v.LowStockThreshold != nil && (*v.LowStockThreshold < 0 || *v.LowStockThreshold > lib.MaxStock)) {
		return model.Movement{}, lib.Invalid("Invalid stock movement")
	}
	var out model.Movement
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, l, e := r.Get(ctx, "products", v.ProductID, true)
		if e != nil {
			return e
		}
		if l != line {
			return lib.Forbidden()
		}
		p, e := lib.Decode[model.Product](b)
		if e != nil {
			return e
		}
		if !p.StockTracked {
			return lib.Conflict("Product does not track stock")
		}
		st, e := r.Stock(ctx, v.ProductID, true)
		if e != nil {
			return e
		}
		quantity := st.Quantity + v.QuantityDelta
		if quantity < st.ReservedQuantity || quantity > lib.MaxStock {
			return lib.Conflict("Adjustment would violate stock or reservation bounds")
		}
		st.Quantity = quantity
		if v.LowStockThreshold != nil {
			st.LowStockThreshold = *v.LowStockThreshold
		}
		if e = r.SaveStock(ctx, st); e != nil {
			return e
		}
		out = model.Movement{ID: lib.ID(), ProductID: v.ProductID, Type: v.Type, QuantityDelta: v.QuantityDelta, Reason: v.Reason, ActorID: u.ID, CreatedAt: s.Now()}
		return r.Put(ctx, "movements", out.ID, line, out, true)
	})
	return out, err
}

func (s *Service) Inventory(ctx context.Context, u model.User, line string, low bool) ([]model.Stock, error) {
	if err := Authorize(u, line, "food_beverage"); err != nil {
		return nil, err
	}
	return s.Repo.Stocks(ctx, line, low)
}
