package service

import (
	"context"
	"encoding/json"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/validation"
)

func (s *Service) CreateQueue(ctx context.Context, u model.User, line, key string, input dto.QueueInput) (model.Queue, error) {
	if err := Authorize(u, line, "salon"); err != nil {
		return model.Queue{}, err
	}
	if len(input.ServiceIDs) < 1 || len(input.ServiceIDs) > 20 || (input.Note != nil && len(*input.Note) > 300) {
		return model.Queue{}, lib.Invalid("Queue requires 1 to 20 services and a note up to 300 bytes")
	}
	scope := u.ID + ":" + line + ":queue"
	fp := fingerprint(input)
	var q model.Queue
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		id, e := replay(ctx, r, scope, key, fp)
		if e != nil {
			return e
		}
		if id != "" {
			b, _, e := r.Get(ctx, "queue", id, false)
			if e != nil {
				return e
			}
			q, e = lib.Decode[model.Queue](b)
			return e
		}
		if e = optionalReference(ctx, r, "customers", input.CustomerID, line); e != nil {
			return e
		}
		seen := map[string]bool{}
		for _, id := range input.ServiceIDs {
			if seen[id] {
				return lib.Invalid("Duplicate service")
			}
			seen[id] = true
			if e = reference(ctx, r, "services", id, line); e != nil {
				return e
			}
		}
		date := s.Now().In(s.Zone).Format("2006-01-02")
		number, e := r.NextQueue(ctx, line, date)
		if e != nil {
			return e
		}
		q = model.Queue{ID: lib.ID(), BusinessLineID: line, QueueNumber: number, Date: date, CustomerID: input.CustomerID, ServiceIDs: input.ServiceIDs, Note: input.Note, Status: "waiting", CreatedAt: s.Now()}
		if e = r.Put(ctx, "queue", q.ID, line, q, true); e != nil {
			return e
		}
		return r.SaveIdempotency(ctx, scope, key, fp, q.ID)
	})
	return q, err
}

func (s *Service) PatchQueue(ctx context.Context, u model.User, id string, m map[string]json.RawMessage) (model.Queue, error) {
	if err := validation.Fields(m, []string{"status", "saleId"}, nil); err != nil {
		return model.Queue{}, err
	}
	var q model.Queue
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, line, e := r.Get(ctx, "queue", id, true)
		if e != nil {
			return e
		}
		if e = Authorize(u, line, "salon"); e != nil {
			return e
		}
		q, e = lib.Decode[model.Queue](b)
		if e != nil {
			return e
		}
		if q.Status == "cancelled" {
			return lib.Conflict("Cancelled queue entry cannot change")
		}
		if _, ok := m["status"]; ok {
			var to string
			if e = validation.Value(m, "status", &to); e != nil {
				return e
			}
			if !lib.QueueTransition(q.Status, to) {
				return lib.Conflict("Invalid queue status transition")
			}
			q.Status = to
			now := s.Now()
			if to == "in_service" {
				q.StartedAt = &now
			}
			if to == "completed" || to == "cancelled" {
				q.CompletedAt = &now
			}
		}
		if v, ok := m["saleId"]; ok {
			if q.Status != "completed" {
				return lib.Conflict("Only completed queue entries can link a sale")
			}
			var saleID *string
			if e = json.Unmarshal(v, &saleID); e != nil || saleID == nil || !lib.UUID(*saleID) {
				return lib.Invalid("A valid saleId is required")
			}
			if q.SaleID != nil && *q.SaleID != *saleID {
				return lib.Conflict("Queue sale link is immutable")
			}
			b, l, e := r.Get(ctx, "sales", *saleID, false)
			if e != nil {
				return e
			}
			if l != line {
				return lib.Forbidden()
			}
			sale, e := lib.Decode[model.Sale](b)
			if e != nil {
				return e
			}
			if sale.Status != "paid" {
				return lib.Conflict("Queue requires a confirmed salon sale")
			}
			if q.CustomerID != nil && (sale.CustomerID == nil || *sale.CustomerID != *q.CustomerID) {
				return lib.Conflict("Queue and sale customer differ")
			}
			found := map[string]bool{}
			for _, item := range sale.Items {
				found[item.ItemID] = true
			}
			for _, id := range q.ServiceIDs {
				if !found[id] {
					return lib.Conflict("Sale does not include requested queue services")
				}
			}
			q.SaleID = saleID
		}
		return r.Put(ctx, "queue", id, line, q, false)
	})
	return q, err
}
