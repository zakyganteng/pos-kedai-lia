package service

import (
	"context"
	"encoding/json"
	"errors"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/crypto"
	"pos/pkg/validation"
	"strings"
	"time"
)

const DefaultJWTSecret = "pos-default-jwt-secret-key-32bytes"

type Service struct {
	Repo         *repo.Repo
	Payment      model.PaymentProvider
	Notification model.NotificationProvider
	TTL          time.Duration
	Zone         *time.Location
	Destination  string
	Template     string
	JWTSecret    string
	Now          func() time.Time
	dummy        []byte
}

func New(r *repo.Repo, p model.PaymentProvider, n model.NotificationProvider, ttl time.Duration, zone *time.Location, destination, template string) *Service {
	dummy := crypto.DummyBcryptHash(lib.ID())
	if strings.TrimSpace(template) == "" {
		template = lib.DefaultNotificationTemplate
	}
	return &Service{
		Repo:         r,
		Payment:      p,
		Notification: n,
		TTL:          ttl,
		Zone:         zone,
		Destination:  destination,
		Template:     template,
		JWTSecret:    DefaultJWTSecret,
		Now:          func() time.Time { return time.Now().UTC() },
		dummy:        dummy,
	}
}

func hash(v string) string { return crypto.SHA256(v) }

func Authorize(u model.User, line, expected string) error {
	for _, l := range u.BusinessLines {
		if l.ID == line {
			if expected != "" && l.Type != expected {
				return lib.Invalid("Resource not supported by this business line")
			}
			return nil
		}
	}
	return lib.Forbidden()
}

func Admin(u model.User) error {
	if u.Role != "owner" && u.Role != "admin" {
		return lib.Forbidden()
	}
	return nil
}

func Owner(u model.User) error {
	if u.Role != "owner" {
		return lib.Forbidden()
	}
	return nil
}

func expected(kind string) string {
	switch kind {
	case "products", "inventory", "movements", "categories":
		return "food_beverage"
	case "services", "queue":
		return "salon"
	}
	return ""
}

func fingerprint(v any) string { b, _ := json.Marshal(v); return hash(string(b)) }

func replay(ctx context.Context, r *repo.Repo, scope, key, fp string) (string, error) {
	if key == "" || len(key) > 200 || !validation.Text(key, 200) {
		return "", lib.Invalid("X-Idempotency-Key required, maximum 200 characters")
	}
	if e := r.Lock(ctx, scope+":"+key); e != nil {
		return "", e
	}
	id, original, e := r.Idempotency(ctx, scope, key)
	if errors.Is(e, lib.NotFound) {
		return "", nil
	}
	if e != nil {
		return "", e
	}
	if original != fp {
		return "", lib.Conflict("Idempotency key was already used with a different request")
	}
	return id, nil
}
