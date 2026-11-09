package service

import (
	"context"
	"encoding/json"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
)

func (s *Service) List(ctx context.Context, u model.User, f dto.Filter) (dto.Page, error) {
	if err := Authorize(u, f.LineID, expected(f.Kind)); err != nil {
		return dto.Page{}, err
	}
	if f.Kind == "notifications" || f.Kind == "reconciliation" {
		if err := Admin(u); err != nil {
			return dto.Page{}, err
		}
	}
	if f.Kind == "reconciliation" && u.Role == "owner" {
		f.IncludeUnmatched = true
	}
	p, err := s.Repo.List(ctx, f)
	if err != nil {
		return p, err
	}
	for i, b := range p.Data {
		p.Data[i], err = enrich(ctx, s.Repo, f.Kind, b)
		if err != nil {
			return p, err
		}
	}
	return p, nil
}

func (s *Service) CatalogGet(ctx context.Context, u model.User, kind, id string) (json.RawMessage, error) {
	switch kind {
	case "products":
		p, err := s.GetProduct(ctx, u, id)
		if err != nil {
			return nil, err
		}
		return json.Marshal(p)
	case "services":
		svc, err := s.GetSalonService(ctx, u, id)
		if err != nil {
			return nil, err
		}
		return json.Marshal(svc)
	case "customers":
		c, err := s.GetCustomer(ctx, u, id)
		if err != nil {
			return nil, err
		}
		return json.Marshal(c)
	case "staff":
		st, err := s.GetStaff(ctx, u, id)
		if err != nil {
			return nil, err
		}
		return json.Marshal(st)
	default:
		return nil, lib.NotFound
	}
}

func (s *Service) CatalogSave(ctx context.Context, u model.User, kind, line, id string, m map[string]json.RawMessage, archive bool) (json.RawMessage, error) {
	switch kind {
	case "products":
		p, err := s.SaveProduct(ctx, u, line, id, m, archive)
		if err != nil {
			return nil, err
		}
		return json.Marshal(p)
	case "services":
		svc, err := s.SaveSalonService(ctx, u, line, id, m, archive)
		if err != nil {
			return nil, err
		}
		return json.Marshal(svc)
	case "customers":
		c, err := s.SaveCustomer(ctx, u, line, id, m, archive)
		if err != nil {
			return nil, err
		}
		return json.Marshal(c)
	case "staff":
		st, err := s.SaveStaff(ctx, u, line, id, m, archive)
		if err != nil {
			return nil, err
		}
		return json.Marshal(st)
	default:
		return nil, lib.NotFound
	}
}

func enrich(ctx context.Context, r *repo.Repo, kind string, b json.RawMessage) (json.RawMessage, error) {
	if kind != "products" {
		return b, nil
	}
	p, err := lib.Decode[model.Product](b)
	if err != nil {
		return nil, err
	}
	st, err := r.Stock(ctx, p.ID, false)
	if err != nil {
		return nil, err
	}
	p.StockOnHand = st.Quantity
	p.ReservedQuantity = st.ReservedQuantity
	return json.Marshal(p)
}
