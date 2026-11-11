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

func (s *Service) GetCustomer(ctx context.Context, u model.User, id string) (model.Person, error) {
	return s.getPerson(ctx, u, "customers", id)
}

func (s *Service) SaveCustomer(ctx context.Context, u model.User, line, id string, m map[string]json.RawMessage, archive bool) (model.Person, error) {
	return s.savePerson(ctx, u, "customers", line, id, m, archive)
}

func (s *Service) getPerson(ctx context.Context, u model.User, kind, id string) (model.Person, error) {
	b, line, err := s.Repo.Get(ctx, kind, id, false)
	if err != nil {
		return model.Person{}, err
	}
	if err = Authorize(u, line, ""); err != nil {
		return model.Person{}, err
	}
	return lib.Decode[model.Person](b)
}

func (s *Service) savePerson(ctx context.Context, u model.User, kind, line, id string, m map[string]json.RawMessage, archive bool) (model.Person, error) {
	create := id == ""
	if !(kind == "customers" && create) {
		if err := Admin(u); err != nil {
			return model.Person{}, err
		}
	}
	if create {
		if err := Authorize(u, line, ""); err != nil {
			return model.Person{}, err
		}
		id = lib.ID()
	}
	var out model.Person
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		var old json.RawMessage
		if !create {
			var err error
			old, line, err = r.Get(ctx, kind, id, true)
			if err != nil {
				return err
			}
			if err = Authorize(u, line, ""); err != nil {
				return err
			}
		}
		now := s.Now()
		if archive {
			m = map[string]json.RawMessage{"active": json.RawMessage("false")}
		}
		allowed := []string{"name", "active"}
		if kind == "customers" {
			allowed = append(allowed, "phone")
		}
		req := []string{}
		if create {
			req = []string{"name"}
		}
		if err := validation.Fields(m, allowed, req); err != nil {
			return err
		}
		p := model.Person{ID: id, BusinessLineID: line, Active: true, CreatedAt: now}
		if !create {
			if err := json.Unmarshal(old, &p); err != nil {
				return err
			}
		}
		if err := validation.Value(m, "name", &p.Name); err != nil {
			return err
		}
		if err := validation.Value(m, "active", &p.Active); err != nil {
			return err
		}
		if b, ok := m["phone"]; ok {
			if err := json.Unmarshal(b, &p.Phone); err != nil {
				return lib.Invalid("Invalid phone")
			}
		}
		if !validation.Text(p.Name, 160) {
			return lib.Invalid("Invalid name")
		}
		p.Name = strings.TrimSpace(p.Name)
		var err error
		p.Phone, err = validation.Phone(p.Phone)
		if err != nil {
			return err
		}
		p.UpdatedAt = now
		if err = r.Put(ctx, kind, id, line, p, create); err != nil {
			return err
		}
		out = p
		return nil
	})
	return out, err
}
