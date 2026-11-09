package service

import (
	"context"
	"encoding/json"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/validation"
	"strings"
)

func (s *Service) GetProduct(ctx context.Context, u model.User, id string) (model.Product, error) {
	b, line, err := s.Repo.Get(ctx, "products", id, false)
	if err != nil {
		return model.Product{}, err
	}
	if err = Authorize(u, line, "food_beverage"); err != nil {
		return model.Product{}, err
	}
	p, err := lib.Decode[model.Product](b)
	if err != nil {
		return model.Product{}, err
	}
	st, err := s.Repo.Stock(ctx, p.ID, false)
	if err != nil {
		return model.Product{}, err
	}
	p.StockOnHand = st.Quantity
	p.ReservedQuantity = st.ReservedQuantity
	return p, nil
}

func (s *Service) SaveProduct(ctx context.Context, u model.User, line, id string, m map[string]json.RawMessage, archive bool) (model.Product, error) {
	if err := Admin(u); err != nil {
		return model.Product{}, err
	}
	create := id == ""
	if create {
		if err := Authorize(u, line, "food_beverage"); err != nil {
			return model.Product{}, err
		}
		id = lib.ID()
	}
	var out model.Product
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		var old json.RawMessage
		if !create {
			var err error
			old, line, err = r.Get(ctx, "products", id, true)
			if err != nil {
				return err
			}
			if err = Authorize(u, line, "food_beverage"); err != nil {
				return err
			}
		}
		now := s.Now()
		if archive {
			m = map[string]json.RawMessage{"active": json.RawMessage("false")}
		}
		allowed := []string{"sku", "name", "unit", "price", "stockTracked", "categoryId"}
		required := []string{}
		if create {
			required = []string{"sku", "name", "unit", "price", "stockTracked"}
		} else {
			allowed = append(allowed, "active")
		}
		if err := validation.Fields(m, allowed, required); err != nil {
			return err
		}
		p := model.Product{ID: id, BusinessLineID: line, Active: true, CreatedAt: now}
		if !create {
			if err := json.Unmarshal(old, &p); err != nil {
				return err
			}
		}
		before := p.StockTracked
		for k, v := range map[string]any{"sku": &p.SKU, "name": &p.Name, "unit": &p.Unit, "price": &p.Price, "stockTracked": &p.StockTracked, "active": &p.Active} {
			if err := validation.Raw(m, k, v); err != nil {
				return err
			}
		}
		if !validation.Text(p.SKU, 80) || !validation.Text(p.Name, 160) || !validation.Text(p.Unit, 40) || p.Price < 0 || p.Price > lib.MaxAmount {
			return lib.Invalid("Invalid product fields")
		}
		if err := assignCategory(m, &p); err != nil {
			return err
		}
		// Re-checked on every write, not only when categoryId changes, because the record is
		// re-validated by the category_references trigger on every UPDATE as well.
		if p.CategoryID != nil {
			if err := resolveCategory(ctx, r, line, *p.CategoryID); err != nil {
				return err
			}
		}
		p.SKU = strings.TrimSpace(p.SKU)
		p.Name = strings.TrimSpace(p.Name)
		p.Unit = strings.TrimSpace(p.Unit)
		if !create && before != p.StockTracked {
			st, err := r.Stock(ctx, id, true)
			if err != nil {
				return err
			}
			if st.Quantity != 0 || st.ReservedQuantity != 0 {
				return lib.Conflict("Stock tracking can change only when stock and reservations are zero")
			}
		}
		p.UpdatedAt = now
		if err := r.Put(ctx, "products", id, line, p, create); err != nil {
			return err
		}
		st, err := r.Stock(ctx, p.ID, false)
		if err != nil {
			return err
		}
		p.StockOnHand = st.Quantity
		p.ReservedQuantity = st.ReservedQuantity
		out = p
		return nil
	})
	return out, err
}

// assignCategory applies the nullable categoryId field. An explicit JSON null detaches the
// product from its category; an absent field leaves the current assignment untouched.
func assignCategory(m map[string]json.RawMessage, p *model.Product) error {
	b, ok := m["categoryId"]
	if !ok {
		return nil
	}
	if string(b) == "null" {
		p.CategoryID = nil
		return nil
	}
	var id string
	if err := json.Unmarshal(b, &id); err != nil || !lib.UUID(id) {
		return lib.Invalid("categoryId must be a UUID or null")
	}
	id = strings.ToLower(id)
	p.CategoryID = &id
	return nil
}
