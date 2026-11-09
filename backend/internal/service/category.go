package service

import (
	"context"
	"encoding/json"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/validation"
	"strings"
)

// CategoryName trims the name and collapses every run of internal whitespace to one space.
// Uniqueness is decided on this normalized form, case-insensitively, by the category_names index.
func CategoryName(v string) string { return strings.Join(strings.Fields(v), " ") }

func (s *Service) GetCategory(ctx context.Context, u model.User, id string) (model.Category, error) {
	b, line, err := s.Repo.Get(ctx, "categories", id, false)
	if err != nil {
		return model.Category{}, err
	}
	if err = Authorize(u, line, "food_beverage"); err != nil {
		return model.Category{}, err
	}
	c, err := lib.Decode[model.Category](b)
	if err != nil {
		return model.Category{}, err
	}
	c.ProductCount, err = s.Repo.CategoryProductCount(ctx, line, id)
	return c, err
}

// ListCategories pages the categories of one food & beverage line. Every role assigned to the
// line may read them; only owners and admins may change them.
func (s *Service) ListCategories(ctx context.Context, u model.User, f dto.Filter) (dto.Page, error) {
	f.Kind = "categories"
	if err := Authorize(u, f.LineID, "food_beverage"); err != nil {
		return dto.Page{}, err
	}
	p, err := s.Repo.List(ctx, f)
	if err != nil {
		return p, err
	}
	counts, err := s.Repo.CategoryProductCounts(ctx, f.LineID)
	if err != nil {
		return p, err
	}
	for i, b := range p.Data {
		c, err := lib.Decode[model.Category](b)
		if err != nil {
			return p, err
		}
		c.ProductCount = counts[c.ID]
		if p.Data[i], err = json.Marshal(c); err != nil {
			return p, err
		}
	}
	return p, nil
}

// SaveCategory creates, renames, archives or restores a category. Archiving is refused while any
// product is still assigned, counting archived products too; the category_references trigger
// repeats that check under a row lock so concurrent writers cannot slip past it.
func (s *Service) SaveCategory(ctx context.Context, u model.User, line, id string, m map[string]json.RawMessage, archive bool) (model.Category, error) {
	if err := Admin(u); err != nil {
		return model.Category{}, err
	}
	create := id == ""
	if create {
		if err := Authorize(u, line, "food_beverage"); err != nil {
			return model.Category{}, err
		}
		id = lib.ID()
	}
	var out model.Category
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		var old json.RawMessage
		if !create {
			var err error
			old, line, err = r.Get(ctx, "categories", id, true)
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
		allowed := []string{"name"}
		required := []string{}
		if create {
			required = []string{"name"}
		} else {
			allowed = append(allowed, "active")
		}
		if err := validation.Fields(m, allowed, required); err != nil {
			return err
		}
		c := model.Category{ID: id, BusinessLineID: line, Active: true, CreatedAt: now}
		if !create {
			if err := json.Unmarshal(old, &c); err != nil {
				return err
			}
		}
		if err := validation.Value(m, "name", &c.Name); err != nil {
			return err
		}
		if err := validation.Value(m, "active", &c.Active); err != nil {
			return err
		}
		if !validation.Text(c.Name, 160) {
			return lib.Invalid("Category name must be 1 to 160 characters without control characters")
		}
		c.Name = CategoryName(c.Name)
		taken, err := r.CategoryNameTaken(ctx, line, c.Name, id)
		if err != nil {
			return err
		}
		if taken {
			return lib.Conflict("Another category in this business line already uses that name")
		}
		count, err := r.CategoryProductCount(ctx, line, id)
		if err != nil {
			return err
		}
		if !c.Active && count > 0 {
			return lib.Conflict("Category still has products assigned; reassign them first")
		}
		c.ProductCount = 0
		c.UpdatedAt = now
		if err := r.Put(ctx, "categories", id, line, c, create); err != nil {
			return err
		}
		c.ProductCount = count
		out = c
		return nil
	})
	return out, err
}

// resolveCategory validates a product's category reference and holds a shared lock on the
// category row for the rest of the transaction.
func resolveCategory(ctx context.Context, r *repo.Repo, line, id string) error {
	b, categoryLine, err := r.GetShared(ctx, "categories", id)
	if err != nil {
		return err
	}
	if categoryLine != line {
		return lib.Forbidden()
	}
	c, err := lib.Decode[model.Category](b)
	if err != nil {
		return err
	}
	if !c.Active {
		return lib.Conflict("Category is archived; restore it or choose another")
	}
	return nil
}
