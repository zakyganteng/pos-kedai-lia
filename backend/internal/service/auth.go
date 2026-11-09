package service

import (
	"context"
	"encoding/json"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/crypto"
	"pos/pkg/jwt"
	"pos/pkg/paging"
	"pos/pkg/validation"
	"strings"
)

func (s *Service) Login(ctx context.Context, email, password string) (dto.SessionResponse, error) {
	if len(email) > 254 || len(password) > 72 || len(password) < 1 {
		return dto.SessionResponse{}, lib.Unauthorized
	}
	u, err := s.Repo.UserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	candidate := s.dummy
	if err == nil {
		candidate = []byte(u.PasswordHash)
	}
	valid := crypto.ComparePassword(string(candidate), password)
	if err != nil || !valid || !u.Active {
		return dto.SessionResponse{}, lib.Unauthorized
	}
	token, expires, err := jwt.Generate(s.JWTSecret, u.ID, u.Role, lib.ID(), s.TTL, s.Now())
	if err != nil {
		return dto.SessionResponse{}, err
	}
	err = s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		if e := r.Lock(ctx, "user:"+u.ID); e != nil {
			return e
		}
		fresh, e := r.User(ctx, u.ID)
		if e != nil {
			return e
		}
		if !fresh.Active || fresh.PasswordHash != u.PasswordHash {
			return lib.Unauthorized
		}
		u = fresh
		return r.CreateSession(ctx, hash(token), u.ID, expires)
	})
	return dto.SessionResponse{AccessToken: token, TokenType: "Bearer", ExpiresAt: expires, User: u}, err
}

func (s *Service) Authenticate(ctx context.Context, token string) (model.User, error) {
	if _, err := jwt.Verify(s.JWTSecret, token); err != nil {
		return model.User{}, lib.Unauthorized
	}
	return s.Repo.SessionUser(ctx, hash(token))
}

func (s *Service) Logout(ctx context.Context, token string) error {
	return s.Repo.RevokeSession(ctx, hash(token))
}

func (s *Service) UserSave(ctx context.Context, actor model.User, id string, m map[string]json.RawMessage, disable bool) (model.User, error) {
	if err := Owner(actor); err != nil {
		return model.User{}, err
	}
	create := id == ""
	if create {
		id = lib.ID()
	}
	if disable {
		m = map[string]json.RawMessage{"active": json.RawMessage("false")}
	}
	req := []string{}
	if create {
		req = []string{"name", "email", "password", "role", "businessLineIds"}
	}
	if err := validation.Fields(m, []string{"name", "email", "password", "role", "active", "businessLineIds"}, req); err != nil {
		return model.User{}, err
	}
	var out model.User
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		if e := r.Lock(ctx, "users"); e != nil {
			return e
		}
		if actor.ID == "" {
			return lib.Forbidden()
		}
		fresh, e := r.User(ctx, actor.ID)
		if e != nil {
			return e
		}
		if !fresh.Active || fresh.Role != "owner" {
			return lib.Forbidden()
		}
		if e := r.Lock(ctx, "user:"+id); e != nil {
			return e
		}
		u := model.User{ID: id, Active: true}
		if !create {
			var e error
			u, e = r.User(ctx, id)
			if e != nil {
				return e
			}
		}
		old := u
		for k, v := range map[string]any{"name": &u.Name, "email": &u.Email, "role": &u.Role, "active": &u.Active} {
			if e := validation.Raw(m, k, v); e != nil {
				return e
			}
		}
		if !validation.Text(u.Name, 160) {
			return lib.Invalid("Invalid user name or email")
		}
		normEmail, e := validation.Email(u.Email)
		if e != nil {
			return lib.Invalid("Invalid email")
		}
		u.Email = normEmail
		if u.Role != "owner" && u.Role != "admin" && u.Role != "cashier" {
			return lib.Invalid("Invalid role")
		}
		if b, ok := m["password"]; ok {
			var password string
			if e = json.Unmarshal(b, &password); e != nil || len(password) < 12 || len(password) > 72 {
				return lib.Invalid("Password must contain 12 to 72 bytes")
			}
			hashed, e := crypto.HashPassword(password)
			if e != nil {
				return e
			}
			u.PasswordHash = hashed
		}
		if b, ok := m["businessLineIds"]; ok {
			var ids []string
			if e = json.Unmarshal(b, &ids); e != nil || len(ids) < 1 || len(ids) > 2 {
				return lib.Invalid("Assign one or two business lines")
			}
			lines, e := r.Lines(ctx)
			if e != nil {
				return e
			}
			u.BusinessLines = []model.Line{}
			seen := map[string]bool{}
			for _, id := range ids {
				if !lib.UUID(id) || seen[id] {
					return lib.Invalid("Invalid or duplicate business line")
				}
				seen[id] = true
				found := false
				for _, l := range lines {
					if id == l.ID {
						u.BusinessLines = append(u.BusinessLines, l)
						found = true
					}
				}
				if !found {
					return lib.Invalid("Unknown business line")
				}
			}
		}
		if !create && old.Role == "owner" && old.Active && (!u.Active || u.Role != "owner") {
			users, e := r.Users(ctx)
			if e != nil {
				return e
			}
			owners := 0
			for _, v := range users {
				if v.Active && v.Role == "owner" {
					owners++
				}
			}
			if owners <= 1 {
				return lib.Conflict("Cannot disable or demote the last active owner")
			}
		}
		if e = r.SaveUser(ctx, u, create); e != nil {
			return e
		}
		if !create {
			if e = r.RevokeUserSessions(ctx, id); e != nil {
				return e
			}
		}
		out = u
		return nil
	})
	return out, err
}

func (s *Service) UserGet(ctx context.Context, actor model.User, id string) (model.User, error) {
	if e := Owner(actor); e != nil {
		return model.User{}, e
	}
	return s.Repo.User(ctx, id)
}

func (s *Service) Users(ctx context.Context, u model.User, page, limit int, search string) (dto.Page, error) {
	if err := Owner(u); err != nil {
		return dto.Page{}, err
	}
	users, err := s.Repo.Users(ctx)
	if err != nil {
		return dto.Page{}, err
	}
	matches := []json.RawMessage{}
	for _, v := range users {
		if search != "" && !strings.Contains(strings.ToLower(v.Name+" "+v.Email), strings.ToLower(search)) {
			continue
		}
		b, _ := json.Marshal(v)
		matches = append(matches, b)
	}
	return paging.Paginate(matches, page, limit), nil
}
