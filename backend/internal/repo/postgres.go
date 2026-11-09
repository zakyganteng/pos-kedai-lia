package repo

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"pos/internal/lib"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
	"github.com/lib/pq"
)

//go:embed schema.sql category_schema.sql
var schema embed.FS

type Repo struct {
	db *sqlx.DB
	tx *sqlx.Tx
	q  sqlx.ExtContext
}

func Open(ctx context.Context, url string) (*Repo, error) {
	db, err := sqlx.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, err
	}
	return &Repo{db: db, q: db}, nil
}

func (r *Repo) DB() *sqlx.DB { return r.db }

func (r *Repo) Close() {
	if r.db != nil {
		r.db.Close()
	}
}

func (r *Repo) Ping(ctx context.Context) error {
	if err := r.db.PingContext(ctx); err != nil {
		return err
	}
	var ready bool
	err := sqlx.GetContext(ctx, r.q, &ready, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=4) AND to_regclass('sale_items') IS NOT NULL AND to_regclass('outbox_jobs') IS NOT NULL")
	if err != nil {
		return err
	}
	if !ready {
		return errors.New("schema missing or outdated")
	}
	return nil
}

// Migrate applies the base schema and then every additive schema file, in order, inside one
// transaction. The base file re-creates shared trigger functions on every run, so the additive
// files that extend them must always be replayed afterwards.
func (r *Repo) Migrate(ctx context.Context) error {
	files := []string{"schema.sql", "category_schema.sql"}
	statements := make([]string, 0, len(files))
	for _, name := range files {
		b, err := schema.ReadFile(name)
		if err != nil {
			return err
		}
		statements = append(statements, string(b))
	}
	return r.WithinTx(ctx, func(txRepo *Repo) error {
		if err := txRepo.Lock(ctx, "migrations"); err != nil {
			return err
		}
		for _, s := range statements {
			if _, err := txRepo.q.ExecContext(ctx, s); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repo) MigrateDown(ctx context.Context, downSQL string) error {
	return r.WithinTx(ctx, func(txRepo *Repo) error {
		if err := txRepo.Lock(ctx, "migrations"); err != nil {
			return err
		}
		_, err := txRepo.q.ExecContext(ctx, downSQL)
		return err
	})
}

func dbError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return lib.NotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return lib.Conflict("Duplicate record")
		case "23503", "23514":
			return lib.Conflict("Record constraint violated")
		case "40001", "40P01":
			return lib.Conflict("Concurrent update; retry request")
		}
	}
	var pqErr *pq.Error
	if errors.As(err, &pqErr) {
		switch string(pqErr.Code) {
		case "23505":
			return lib.Conflict("Duplicate record")
		case "23503", "23514":
			return lib.Conflict("Record constraint violated")
		case "40001", "40P01":
			return lib.Conflict("Concurrent update; retry request")
		}
	}
	return err
}

func (r *Repo) WithinTx(ctx context.Context, fn func(*Repo) error) error {
	if r.tx != nil {
		return fn(r)
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	txRepo := &Repo{db: r.db, tx: tx, q: tx}
	if err = fn(txRepo); err != nil {
		return dbError(err)
	}
	return dbError(tx.Commit())
}

func (r *Repo) Lock(ctx context.Context, key string) error {
	_, err := r.q.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", key)
	return err
}
