package repo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"pos/internal/lib"
	"pos/internal/model"
	"time"

	"github.com/jmoiron/sqlx"
)

func (r *Repo) QueueDelivery(ctx context.Context, id, destination, message string) (string, error) {
	var stored string
	e := sqlx.GetContext(ctx, r.q, &stored, `INSERT INTO outbox_jobs(notification_id,destination,message) VALUES($1,$2,$3) ON CONFLICT(notification_id) DO UPDATE SET status='queued',failures=0,next_attempt_at=now(),claim_token=NULL,lease_until=NULL WHERE outbox_jobs.status='failed' RETURNING destination`, id, destination, message)
	if errors.Is(e, sql.ErrNoRows) {
		e = sqlx.GetContext(ctx, r.q, &stored, `SELECT destination FROM outbox_jobs WHERE notification_id=$1`, id)
	}
	if e != nil {
		return "", dbError(e)
	}
	return stored, nil
}

func (r *Repo) ClaimDeliveries(ctx context.Context, limit int, now time.Time) ([]model.Delivery, error) {
	jobs := []model.Delivery{}
	e := r.WithinTx(ctx, func(txRepo *Repo) error {
		token := lib.ID()
		rows, e := txRepo.q.QueryxContext(ctx, `WITH picked AS (SELECT notification_id FROM outbox_jobs WHERE status='queued' AND next_attempt_at <= $1 AND (lease_until IS NULL OR lease_until <= $1) ORDER BY next_attempt_at,notification_id FOR UPDATE SKIP LOCKED LIMIT $2), claimed AS (UPDATE outbox_jobs j SET claim_token=$3,lease_until=$1::timestamptz+interval '2 minutes',attempts=j.attempts+1 FROM picked p WHERE j.notification_id=p.notification_id RETURNING j.*) SELECT c.notification_id::text,r.line_id::text,c.destination,c.message,c.claim_token::text,c.attempts,c.failures,r.body FROM claimed c JOIN records r ON r.id=c.notification_id`, now, limit, token)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var d model.Delivery
			var b []byte
			if e = rows.Scan(&d.ID, &d.LineID, &d.Destination, &d.Message, &d.ClaimToken, &d.Attempts, &d.Failures, &b); e != nil {
				return e
			}
			if e = json.Unmarshal(b, &d.Notification); e != nil {
				return e
			}
			jobs = append(jobs, d)
		}
		return rows.Err()
	})
	return jobs, e
}

func (r *Repo) FinishDelivery(ctx context.Context, d model.Delivery, success, failed bool, code string, next time.Time) error {
	return r.WithinTx(ctx, func(txRepo *Repo) error {
		state := "queued"
		if success {
			state = "sent"
		} else if failed {
			state = "failed"
		}
		failures := d.Failures
		if !success {
			failures++
		}
		res, e := txRepo.q.ExecContext(ctx, `UPDATE outbox_jobs SET status=$3,failures=$4,next_attempt_at=$5,lease_until=NULL,claim_token=NULL WHERE notification_id=$1 AND claim_token=$2`, d.ID, d.ClaimToken, state, failures, next)
		if e != nil {
			return e
		}
		affected, _ := res.RowsAffected()
		if affected == 0 {
			return nil
		}
		n := d.Notification
		n.Status = state
		n.AttemptCount = d.Attempts
		if success {
			n.LastError = nil
		} else {
			n.LastError = &code
		}
		return txRepo.Put(ctx, "notifications", d.ID, d.LineID, n, false)
	})
}

func (r *Repo) DueIntents(ctx context.Context, now time.Time) ([]string, error) {
	ids := []string{}
	err := sqlx.SelectContext(ctx, r.q, &ids, `SELECT body->>'saleId' FROM records WHERE kind='payments' AND body->>'status'='pending' AND body->>'method'='qris' AND ((body->>'gatewayReference' IS NULL AND (body->>'nextIntentAt' IS NULL OR (body->>'nextIntentAt')::timestamptz <= $1)) OR (body->>'gatewayReference' IS NOT NULL AND EXISTS(SELECT 1 FROM payment_events e WHERE e.body->>'saleId'=records.body->>'saleId' AND e.body->>'outcome'='unresolved'))) ORDER BY created_at,id LIMIT 20`, now)
	return ids, err
}

func (r *Repo) PendingEvents(ctx context.Context, id string) ([]model.Reconciliation, error) {
	var rawBodies [][]byte
	if err := sqlx.SelectContext(ctx, r.q, &rawBodies, `SELECT body FROM payment_events WHERE body->>'saleId'=$1 AND body->>'outcome'='unresolved' ORDER BY created_at,event_id FOR UPDATE`, id); err != nil {
		return nil, err
	}
	events := make([]model.Reconciliation, 0, len(rawBodies))
	for _, b := range rawBodies {
		v, e := lib.Decode[model.Reconciliation](b)
		if e != nil {
			return nil, e
		}
		events = append(events, v)
	}
	return events, nil
}

func (r *Repo) UpdateEvent(ctx context.Context, e model.Reconciliation) error {
	b, err := json.Marshal(e)
	if err != nil {
		return err
	}
	_, err = r.q.ExecContext(ctx, "UPDATE payment_events SET body=$2 WHERE event_id=$1", e.EventID, b)
	return dbError(err)
}
