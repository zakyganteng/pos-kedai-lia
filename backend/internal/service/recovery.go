package service

import (
	"context"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
)

func (s *Service) RecoverIntents(ctx context.Context) error {
	ids, e := s.Repo.DueIntents(ctx, s.Now())
	if e != nil {
		return e
	}
	for _, id := range ids {
		_, e = s.startIntent(ctx, id)
		if e != nil {
			if de, ok := e.(*lib.Error); ok && de.Status == 502 {
				continue
			}
			return e
		}
	}
	return nil
}

func (s *Service) reconcileRecovered(ctx context.Context, id string) error {
	return s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, _, e := r.Get(ctx, "sales", id, true)
		if e != nil {
			return e
		}
		sale, e := lib.Decode[model.Sale](b)
		if e != nil {
			return e
		}
		if sale.Payment.GatewayReference == nil {
			return nil
		}
		events, e := r.PendingEvents(ctx, id)
		if e != nil {
			return e
		}
		for _, event := range events {
			to := event.ProviderStatus
			if to == "succeeded" {
				to = "confirmed"
			}
			if event.ProviderPaymentID != *sale.Payment.GatewayReference || event.Amount != sale.Total || event.Currency != "IDR" {
				event.Outcome = "mismatch"
			} else if sale.Payment.Status == to {
				event.Outcome = "duplicate_state"
			} else if !lib.PaymentTransition(sale.Payment.Status, to) {
				event.Outcome = "terminal_conflict"
			} else {
				if e = s.applyPayment(ctx, r, &sale, to, event.OccurredAt); e != nil {
					return e
				}
				event.Outcome = "applied"
			}
			if e = r.UpdateEvent(ctx, event); e != nil {
				return e
			}
		}
		return nil
	})
}
