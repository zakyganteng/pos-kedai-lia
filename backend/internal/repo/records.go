package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"pos/internal/dto"
	"pos/internal/model"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

func (r *Repo) Get(ctx context.Context, kind, id string, lock bool) (json.RawMessage, string, error) {
	query := "SELECT body, line_id::text AS line_id FROM records WHERE kind=$1 AND id=$2"
	if lock {
		query += " FOR UPDATE"
	}
	var row struct {
		Body   []byte `db:"body"`
		LineID string `db:"line_id"`
	}
	err := sqlx.GetContext(ctx, r.q, &row, query, kind, id)
	return row.Body, row.LineID, dbError(err)
}

func (r *Repo) Put(ctx context.Context, kind, id, line string, v any, create bool) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if create {
		_, err = r.q.ExecContext(ctx, "INSERT INTO records(id,kind,line_id,body) VALUES($1,$2,$3,$4)", id, kind, line, b)
	} else {
		_, err = r.q.ExecContext(ctx, "UPDATE records SET body=$4 WHERE id=$1 AND kind=$2 AND line_id=$3", id, kind, line, b)
	}
	if err != nil {
		return dbError(err)
	}
	if create && kind == "products" {
		_, err = r.q.ExecContext(ctx, "INSERT INTO inventory(product_id) VALUES($1)", id)
	}
	return dbError(err)
}

func (r *Repo) List(ctx context.Context, f dto.Filter) (dto.Page, error) {
	table := "records"
	clauses := " WHERE kind=$1 AND line_id=$2"
	args := []any{f.Kind, f.LineID}
	searchKeys := []string{"name", "sku"}
	statusKey := "status"
	if f.Kind == "categories" {
		searchKeys = []string{"name"}
	}
	if f.Kind == "reconciliation" {
		table = "payment_events"
		clauses = " WHERE line_id=$1"
		if f.IncludeUnmatched {
			clauses = " WHERE (line_id=$1 OR line_id IS NULL)"
		}
		args = []any{f.LineID}
		searchKeys = []string{"eventId", "saleId", "providerPaymentId"}
		statusKey = "providerStatus"
	}
	add := func(expr string, v any) {
		args = append(args, v)
		clauses += " AND " + fmt.Sprintf(expr, len(args))
	}
	if f.Search != "" {
		args = append(args, f.Search)
		n := len(args)
		matches := make([]string, 0, len(searchKeys))
		for _, k := range searchKeys {
			matches = append(matches, fmt.Sprintf("body->>'%s' ILIKE '%%'||$%d||'%%'", k, n))
		}
		clauses += " AND (" + strings.Join(matches, " OR ") + ")"
	}
	if f.Active != nil {
		add("(body->>'active')::boolean=$%d", *f.Active)
	}
	if f.Status != "" {
		add("body->>'"+statusKey+"'=$%d", f.Status)
	}
	if f.Outcome != "" {
		add("body->>'outcome'=$%d", f.Outcome)
	}
	if f.Date != "" {
		add("body->>'date'=$%d", f.Date)
	}
	if f.ProductID != "" {
		add("body->>'productId'=$%d", f.ProductID)
	}
	if f.CategoryID != "" {
		add("body->>'categoryId'=$%d", strings.ToLower(f.CategoryID))
	}
	if f.Uncategorized != nil {
		if *f.Uncategorized {
			clauses += " AND body->>'categoryId' IS NULL"
		} else {
			clauses += " AND body->>'categoryId' IS NOT NULL"
		}
	}
	if f.From != nil {
		add("created_at >= $%d", *f.From)
	}
	if f.To != nil {
		add("created_at < $%d", *f.To)
	}
	var total int
	if err := sqlx.GetContext(ctx, r.q, &total, "SELECT count(*) FROM "+table+clauses, args...); err != nil {
		return dto.Page{}, err
	}
	page := f.Page
	limit := f.Limit
	if page == 0 {
		page = 1
	}
	if limit == 0 {
		limit = 20
	}
	args = append(args, limit, (page-1)*limit)
	order := " ORDER BY created_at DESC,id DESC"
	if f.Kind == "categories" {
		order = " ORDER BY lower(body->>'name'),id"
	}
	if f.Kind == "reconciliation" {
		order = " ORDER BY created_at DESC,event_id DESC"
	}
	if f.Kind == "queue" {
		order = " ORDER BY (body->>'queueNumber')::integer,id"
	}
	query := "SELECT body FROM " + table + clauses + order + fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args))
	rows, err := r.q.QueryxContext(ctx, query, args...)
	if err != nil {
		return dto.Page{}, err
	}
	defer rows.Close()
	out := dto.Page{
		Data:       []json.RawMessage{},
		Pagination: dto.Pagination{Page: page, Limit: limit, Total: total, TotalPages: (total + limit - 1) / limit},
	}
	for rows.Next() {
		var b []byte
		if err = rows.Scan(&b); err != nil {
			return out, err
		}
		out.Data = append(out.Data, b)
	}
	return out, rows.Err()
}

func (r *Repo) Idempotency(ctx context.Context, scope, key string) (string, string, error) {
	var row struct {
		RecordID    string `db:"record_id"`
		Fingerprint string `db:"fingerprint"`
	}
	err := sqlx.GetContext(ctx, r.q, &row, "SELECT record_id::text AS record_id, fingerprint FROM idempotency WHERE scope=$1 AND key=$2", scope, key)
	return row.RecordID, row.Fingerprint, dbError(err)
}

func (r *Repo) SaveIdempotency(ctx context.Context, scope, key, fp, id string) error {
	_, err := r.q.ExecContext(ctx, "INSERT INTO idempotency(scope,key,fingerprint,record_id) VALUES($1,$2,$3,$4)", scope, key, fp, id)
	return dbError(err)
}

func (r *Repo) NextQueue(ctx context.Context, line, date string) (int, error) {
	var n int
	err := sqlx.GetContext(ctx, r.q, &n, "INSERT INTO queue_counters(line_id,business_date,last_number) VALUES($1,$2,1) ON CONFLICT(line_id,business_date) DO UPDATE SET last_number=queue_counters.last_number+1 RETURNING last_number", line, date)
	return n, err
}

func (r *Repo) SaveEvent(ctx context.Context, e model.Reconciliation, hash, line string) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	var l any
	if line != "" {
		l = line
	}
	_, err = r.q.ExecContext(ctx, "INSERT INTO payment_events(event_id,body_hash,line_id,body) VALUES($1,$2,$3,$4)", e.EventID, hash, l, b)
	return dbError(err)
}

func (r *Repo) Event(ctx context.Context, id string) (string, error) {
	var h string
	err := sqlx.GetContext(ctx, r.q, &h, "SELECT body_hash FROM payment_events WHERE event_id=$1", id)
	return h, dbError(err)
}

func (r *Repo) DuePayments(ctx context.Context, now time.Time) ([]string, error) {
	ids := []string{}
	err := sqlx.SelectContext(ctx, r.q, &ids, "SELECT body->>'saleId' FROM records WHERE kind='payments' AND body->>'status'='pending' AND (body->>'expiresAt')::timestamptz<=$1 LIMIT 100", now)
	return ids, err
}
