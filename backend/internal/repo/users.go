package repo

import (
	"context"
	"pos/internal/lib"
	"pos/internal/model"
	"time"

	"github.com/jmoiron/sqlx"
)

func (r *Repo) Lines(ctx context.Context) ([]model.Line, error) {
	out := []model.Line{}
	err := sqlx.SelectContext(ctx, r.q, &out, "SELECT id::text AS id, code, name, type FROM business_lines ORDER BY code")
	return out, err
}

func (r *Repo) userQuery(ctx context.Context, where string, arg any) (model.User, error) {
	var u model.User
	err := sqlx.GetContext(ctx, r.q, &u, "SELECT id::text AS id, name, email, password_hash, role, active FROM users WHERE "+where, arg)
	if err != nil {
		return u, dbError(err)
	}
	u.BusinessLines = []model.Line{}
	err = sqlx.SelectContext(ctx, r.q, &u.BusinessLines, "SELECT b.id::text AS id, b.code, b.name, b.type FROM user_lines ul JOIN business_lines b ON b.id=ul.line_id WHERE ul.user_id=$1 ORDER BY b.code", u.ID)
	if err != nil {
		return u, err
	}
	return u, nil
}

func (r *Repo) User(ctx context.Context, id string) (model.User, error) {
	return r.userQuery(ctx, "id=$1", id)
}

func (r *Repo) UserByEmail(ctx context.Context, email string) (model.User, error) {
	return r.userQuery(ctx, "email=$1", email)
}

func (r *Repo) Users(ctx context.Context) ([]model.User, error) {
	var ids []string
	if err := sqlx.SelectContext(ctx, r.q, &ids, "SELECT id::text FROM users ORDER BY name,id"); err != nil {
		return nil, err
	}
	users := []model.User{}
	for _, id := range ids {
		u, e := r.User(ctx, id)
		if e != nil {
			return nil, e
		}
		users = append(users, u)
	}
	return users, nil
}

func (r *Repo) SaveUser(ctx context.Context, u model.User, create bool) error {
	var err error
	if create {
		_, err = r.q.ExecContext(ctx, "INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,$6)", u.ID, u.Name, u.Email, u.PasswordHash, u.Role, u.Active)
	} else {
		_, err = r.q.ExecContext(ctx, "UPDATE users SET name=$2,email=$3,password_hash=$4,role=$5,active=$6 WHERE id=$1", u.ID, u.Name, u.Email, u.PasswordHash, u.Role, u.Active)
	}
	if err != nil {
		return dbError(err)
	}
	if _, err = r.q.ExecContext(ctx, "DELETE FROM user_lines WHERE user_id=$1", u.ID); err != nil {
		return err
	}
	for _, l := range u.BusinessLines {
		if _, err = r.q.ExecContext(ctx, "INSERT INTO user_lines(user_id,line_id) VALUES($1,$2)", u.ID, l.ID); err != nil {
			return dbError(err)
		}
	}
	return nil
}

func (r *Repo) CreateSession(ctx context.Context, hash, user string, expires time.Time) error {
	_, err := r.q.ExecContext(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", hash, user, expires)
	return err
}

func (r *Repo) SessionUser(ctx context.Context, hash string) (model.User, error) {
	var id string
	err := sqlx.GetContext(ctx, r.q, &id, "SELECT s.user_id::text FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.revoked_at IS NULL AND u.active", hash)
	if err != nil {
		return model.User{}, lib.Unauthorized
	}
	return r.User(ctx, id)
}

func (r *Repo) RevokeSession(ctx context.Context, hash string) error {
	_, err := r.q.ExecContext(ctx, "UPDATE sessions SET revoked_at=now() WHERE token_hash=$1", hash)
	return err
}

func (r *Repo) RevokeUserSessions(ctx context.Context, id string) error {
	_, err := r.q.ExecContext(ctx, "UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", id)
	return err
}
