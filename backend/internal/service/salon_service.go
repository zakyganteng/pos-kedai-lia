package service

import (
	"context"
	"encoding/json"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/validation"
	"strings"
	"unicode/utf8"
)

func (s *Service) GetSalonService(ctx context.Context, u model.User, id string) (model.Service, error) {
	b, line, err := s.Repo.Get(ctx, "services", id, false)
	if err != nil {
		return model.Service{}, err
	}
	if err = Authorize(u, line, "salon"); err != nil {
		return model.Service{}, err
	}
	return lib.Decode[model.Service](b)
}

func (s *Service) SaveSalonService(ctx context.Context, u model.User, line, id string, m map[string]json.RawMessage, archive bool) (model.Service, error) {
	if err := Admin(u); err != nil {
		return model.Service{}, err
	}
	create := id == ""
	if create {
		if err := Authorize(u, line, "salon"); err != nil {
			return model.Service{}, err
		}
		id = lib.ID()
	}
	var out model.Service
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		var old json.RawMessage
		if !create {
			var err error
			old, line, err = r.Get(ctx, "services", id, true)
			if err != nil {
				return err
			}
			if err = Authorize(u, line, "salon"); err != nil {
				return err
			}
		}
		now := s.Now()
		if archive {
			m = map[string]json.RawMessage{"active": json.RawMessage("false")}
		}
		req := []string{}
		if create {
			req = []string{"name", "price"}
		}
		if err := validation.Fields(m, []string{"name", "description", "durationMinutes", "price", "active"}, req); err != nil {
			return err
		}
		p := model.Service{ID: id, BusinessLineID: line, Active: true, CreatedAt: now}
		if !create {
			if err := json.Unmarshal(old, &p); err != nil {
				return err
			}
		}
		if err := validation.Value(m, "name", &p.Name); err != nil {
			return err
		}
		if err := validation.Value(m, "price", &p.Price); err != nil {
			return err
		}
		if err := validation.Value(m, "active", &p.Active); err != nil {
			return err
		}
		if b, ok := m["description"]; ok {
			if err := json.Unmarshal(b, &p.Description); err != nil {
				return lib.Invalid("Invalid description")
			}
		}
		if b, ok := m["durationMinutes"]; ok {
			if err := json.Unmarshal(b, &p.DurationMinutes); err != nil {
				return lib.Invalid("Invalid durationMinutes")
			}
		}
		if !validation.Text(p.Name, 160) || p.Price < 0 || p.Price > lib.MaxAmount || (p.Description != nil && utf8.RuneCountInString(*p.Description) > 1000) || (p.DurationMinutes != nil && (*p.DurationMinutes < 1 || *p.DurationMinutes > 1440)) {
			return lib.Invalid("Invalid service fields")
		}
		p.Name = strings.TrimSpace(p.Name)
		p.UpdatedAt = now
		if err := r.Put(ctx, "services", id, line, p, create); err != nil {
			return err
		}
		out = p
		return nil
	})
	return out, err
}
