package repo

import (
	"context"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"time"

	"github.com/jmoiron/sqlx"
)

func (r *Repo) Report(ctx context.Context, line string, from, to time.Time, group, zone string) (int64, int, []dto.ReportGroup, error) {
	groupSQL := `SELECT to_char(created_at AT TIME ZONE $4,'YYYY-MM-DD') AS key,sum((body->>'total')::bigint) AS amount,count(*) AS count FROM selected GROUP BY 1`
	args := []any{line, from, to, zone}
	switch group {
	case "paymentMethod":
		groupSQL = `SELECT body->'payment'->>'method' AS key,sum((body->>'total')::bigint) AS amount,count(*) AS count FROM selected GROUP BY 1`
		args = args[:3]
	case "item", "staff":
		key := "i.item_id::text"
		if group == "staff" {
			key = "COALESCE(i.staff_id::text,'unassigned')"
		}
		groupSQL = `SELECT ` + key + ` AS key,sum(i.line_total) AS amount,count(DISTINCT r.id) AS count FROM sale_items i JOIN selected r ON r.id=i.sale_id GROUP BY 1`
		args = args[:3]
	}
	query := `WITH selected AS MATERIALIZED (SELECT id,created_at,body FROM records WHERE kind='sales' AND line_id=$1 AND body->>'status'='paid' AND created_at >= $2 AND created_at < $3), totals AS (SELECT COALESCE(sum((body->>'total')::bigint),0) AS amount,count(*) AS count FROM selected), groups AS (` + groupSQL + `) SELECT t.amount,t.count,g.key,g.amount,g.count FROM totals t LEFT JOIN groups g ON true ORDER BY g.key`
	rows, e := r.q.QueryxContext(ctx, query, args...)
	if e != nil {
		return 0, 0, nil, e
	}
	defer rows.Close()
	var amount int64
	var count int
	groups := []dto.ReportGroup{}
	for rows.Next() {
		var key *string
		var groupAmount *int64
		var groupCount *int
		if e = rows.Scan(&amount, &count, &key, &groupAmount, &groupCount); e != nil {
			return 0, 0, nil, e
		}
		if key != nil {
			groups = append(groups, dto.ReportGroup{Key: *key, Amount: *groupAmount, Count: *groupCount})
		}
	}
	return amount, count, groups, rows.Err()
}

func (r *Repo) ConfirmedSales(ctx context.Context, line string, from, to time.Time, limit int) ([]model.Sale, error) {
	var rawBodies [][]byte
	err := sqlx.SelectContext(ctx, r.q, &rawBodies, `SELECT body FROM records WHERE kind='sales' AND line_id=$1 AND body->>'status'='paid' AND created_at >= $2 AND created_at < $3 ORDER BY created_at,id LIMIT $4`, line, from, to, limit)
	if err != nil {
		return nil, err
	}
	out := make([]model.Sale, 0, len(rawBodies))
	for _, b := range rawBodies {
		sale, e := lib.Decode[model.Sale](b)
		if e != nil {
			return nil, e
		}
		out = append(out, sale)
	}
	return out, nil
}
