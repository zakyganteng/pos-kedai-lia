package repo

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jmoiron/sqlx"
)

// GetShared reads a record and holds a shared row lock on it until the transaction ends.
// Assigning a product to a category takes this lock so that a concurrent archive of the same
// category, which holds the row's exclusive lock through its own UPDATE, cannot interleave.
func (r *Repo) GetShared(ctx context.Context, kind, id string) (json.RawMessage, string, error) {
	var row struct {
		Body   []byte `db:"body"`
		LineID string `db:"line_id"`
	}
	err := sqlx.GetContext(ctx, r.q, &row, "SELECT body, line_id::text AS line_id FROM records WHERE kind=$1 AND id=$2 FOR SHARE", kind, id)
	return row.Body, row.LineID, dbError(err)
}

// CategoryProductCount counts every product assigned to one category, active or archived.
func (r *Repo) CategoryProductCount(ctx context.Context, line, category string) (int, error) {
	var n int
	err := sqlx.GetContext(ctx, r.q, &n, "SELECT count(*) FROM records WHERE kind='products' AND line_id=$1 AND body->>'categoryId'=$2", line, strings.ToLower(category))
	return n, dbError(err)
}

// CategoryProductCounts returns the assigned-product count for every category of one business
// line in a single pass, so listing categories does not issue a query per row.
func (r *Repo) CategoryProductCounts(ctx context.Context, line string) (map[string]int, error) {
	rows, err := r.q.QueryxContext(ctx, "SELECT body->>'categoryId' AS category_id, count(*) AS total FROM records WHERE kind='products' AND line_id=$1 AND body->>'categoryId' IS NOT NULL GROUP BY 1", line)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var total int
		if err = rows.Scan(&id, &total); err != nil {
			return nil, err
		}
		out[id] = total
	}
	return out, rows.Err()
}

// CategoryNameTaken reports whether another category in the same business line already uses the
// name, compared case-insensitively with whitespace trimmed and collapsed. Archived categories
// keep their name reserved. The category_names unique index is the authority; this is the check
// that turns the collision into a readable error before the index fires.
func (r *Repo) CategoryNameTaken(ctx context.Context, line, name, excludeID string) (bool, error) {
	var taken bool
	err := sqlx.GetContext(ctx, r.q, &taken,
		"SELECT EXISTS(SELECT 1 FROM records WHERE kind='categories' AND line_id=$1 AND lower(regexp_replace(btrim(body->>'name'),'\\s+',' ','g'))=lower($2) AND id<>$3::uuid)",
		line, name, excludeID)
	return taken, dbError(err)
}
