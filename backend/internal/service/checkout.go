package service

import (
	"context"
	"encoding/json"
	"errors"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/validation"
	"time"
)

type MovementInput = dto.MovementInput

func (s *Service) CreateSale(ctx context.Context, u model.User, line, key string, input dto.SaleInput) (model.Sale, error) {
	if err := Authorize(u, line, ""); err != nil {
		return model.Sale{}, err
	}
	if len(input.Items) < 1 || len(input.Items) > 100 {
		return model.Sale{}, lib.Invalid("Sale requires 1 to 100 items")
	}
	if input.PaymentMethod != "cash" && input.PaymentMethod != "qris" {
		return model.Sale{}, lib.Invalid("Invalid payment method")
	}
	if input.PaymentMethod == "cash" && (input.CashReceived == nil || *input.CashReceived < 0 || *input.CashReceived > lib.MaxAmount) {
		return model.Sale{}, lib.Invalid("cashReceived required within allowed bounds")
	}
	if input.PaymentMethod == "qris" && input.CashReceived != nil {
		return model.Sale{}, lib.Invalid("cashReceived is only valid for cash")
	}
	scope := u.ID + ":" + line + ":sale"
	fp := fingerprint(input)
	var sale model.Sale
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		id, err := replay(ctx, r, scope, key, fp)
		if err != nil {
			return err
		}
		if id != "" {
			b, _, e := r.Get(ctx, "sales", id, false)
			if e != nil {
				return e
			}
			sale, e = lib.Decode[model.Sale](b)
			return e
		}
		if input.PaymentMethod == "qris" && s.Payment.Name() == "disabled" {
			return &lib.Error{Status: 503, Code: "PAYMENT_UNAVAILABLE", Message: "Payment provider is disabled"}
		}
		if err = optionalReference(ctx, r, "customers", input.CustomerID, line); err != nil {
			return err
		}
		now := s.Now()
		sale = model.Sale{ID: lib.ID(), BusinessLineID: line, CustomerID: input.CustomerID, CashierID: u.ID, Status: "pending_payment", Items: []model.Item{}, CashReceived: input.CashReceived, CreatedAt: now}
		sale.Payment = model.Payment{ID: lib.ID(), SaleID: sale.ID, Method: input.PaymentMethod, Status: "pending", Currency: "IDR", CreatedAt: now}
		seen := map[string]bool{}
		for _, v := range sortedItems(input.Items) {
			if !lib.UUID(v.ItemID) || v.Quantity < 1 || v.Quantity > 1000 || (v.ItemType != "product" && v.ItemType != "service") {
				return lib.Invalid("Invalid sale item")
			}
			if seen[v.ItemID] {
				return lib.Invalid("Combine duplicate item quantities before checkout")
			}
			seen[v.ItemID] = true
			kind := "products"
			if v.ItemType == "service" {
				kind = "services"
			}
			if err = Authorize(u, line, expected(kind)); err != nil {
				return err
			}
			if v.ItemType == "product" && v.StaffID != nil {
				return lib.Invalid("Only salon services can have staff")
			}
			if err = optionalReference(ctx, r, "staff", v.StaffID, line); err != nil {
				return err
			}
			b, itemLine, e := r.Get(ctx, kind, v.ItemID, true)
			if e != nil {
				return e
			}
			if itemLine != line {
				return lib.Forbidden()
			}
			var p struct {
				Name         string `json:"name"`
				Price        int64  `json:"price"`
				Active       bool   `json:"active"`
				StockTracked bool   `json:"stockTracked"`
			}
			if e = json.Unmarshal(b, &p); e != nil {
				return e
			}
			if !p.Active {
				return lib.Conflict("Archived item cannot be sold")
			}
			amount, e := lib.Money(p.Price, v.Quantity)
			if e != nil {
				return e
			}
			if sale.Total > lib.MaxAmount-amount {
				return lib.Invalid("Sale total exceeds allowed bounds")
			}
			sale.Total += amount
			sale.Items = append(sale.Items, model.Item{ID: lib.ID(), ItemType: v.ItemType, ItemID: v.ItemID, DisplayName: p.Name, UnitPrice: p.Price, Quantity: v.Quantity, LineTotal: amount, StaffID: v.StaffID, StockTracked: p.StockTracked})
			if p.StockTracked {
				st, e := r.Stock(ctx, v.ItemID, true)
				if e != nil {
					return e
				}
				if st.Quantity-st.ReservedQuantity < int64(v.Quantity) {
					return lib.Conflict("Insufficient available stock")
				}
				if input.PaymentMethod == "qris" {
					st.ReservedQuantity += int64(v.Quantity)
				} else {
					st.Quantity -= int64(v.Quantity)
				}
				if e = r.SaveStock(ctx, st); e != nil {
					return e
				}
				if input.PaymentMethod == "cash" {
					if e = s.movement(ctx, r, u.ID, line, v.ItemID, sale.ID, -int64(v.Quantity), "sale", "Cash sale"); e != nil {
						return e
					}
				}
			}
		}
		sale.Subtotal = sale.Total
		sale.Payment.Amount = sale.Total
		if input.PaymentMethod == "cash" {
			if *input.CashReceived < sale.Total {
				return lib.Invalid("Cash received is below sale total")
			}
			change := *input.CashReceived - sale.Total
			sale.ChangeDue = &change
			sale.Status = "paid"
			sale.Payment.Status = "confirmed"
			sale.Payment.ConfirmedAt = &now
			sale.Payment.ExpiresAt = nil
		}
		if err = s.saveSale(ctx, r, sale, true); err != nil {
			return err
		}
		if err = r.SaveIdempotency(ctx, scope, key, fp, sale.ID); err != nil {
			return err
		}
		if sale.Status == "paid" {
			return s.enqueue(ctx, r, sale)
		}
		return nil
	})
	if err != nil {
		return sale, err
	}
	if sale.Payment.Method == "qris" && sale.Payment.Status == "pending" && sale.Payment.QRContent == nil {
		sale, err = s.startIntent(ctx, sale.ID)
	}
	return sale, err
}

func (s *Service) startIntent(ctx context.Context, id string) (model.Sale, error) {
	var sale model.Sale
	var providerErr error
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, _, e := r.Get(ctx, "sales", id, true)
		if e != nil {
			return e
		}
		sale, e = lib.Decode[model.Sale](b)
		if e != nil {
			return e
		}
		if sale.Payment.Status != "pending" || sale.Payment.QRContent != nil {
			return nil
		}
		intent, e := s.Payment.Create(ctx, sale)
		sale.Payment.IntentAttempts++
		if e != nil || intent.MerchantReference != sale.ID || intent.Amount != sale.Total || intent.Currency != "IDR" || intent.Status != "pending" || len(intent.PaymentID) < 1 || len(intent.PaymentID) > 200 || len(intent.QRContent) < 1 || len(intent.QRContent) > 4096 || intent.ExpiresAt.IsZero() || !intent.ExpiresAt.After(sale.CreatedAt) || intent.ExpiresAt.After(s.Now().Add(24*time.Hour)) {
			providerErr = &lib.Error{Status: 502, Code: "PAYMENT_PROVIDER_ERROR", Message: "Payment intent unresolved; automatic recovery is scheduled, retry with the same idempotency key"}
			code := "INTENT_UNRESOLVED"
			sale.Payment.IntentError = &code
			backoff := sale.Payment.IntentAttempts
			if backoff > 7 {
				backoff = 7
			}
			next := s.Now().Add(time.Duration(1<<uint(backoff-1)) * 15 * time.Second)
			sale.Payment.NextIntentAt = &next
			return s.saveSale(ctx, r, sale, false)
		}
		sale.Payment.NextIntentAt = nil
		sale.Payment.IntentError = nil
		sale.Payment.GatewayReference = &intent.PaymentID
		sale.Payment.QRContent = &intent.QRContent
		expires := intent.ExpiresAt.UTC()
		sale.Payment.ExpiresAt = &expires
		return s.saveSale(ctx, r, sale, false)
	})
	if err != nil {
		return sale, err
	}
	if providerErr == nil {
		if err = s.reconcileRecovered(ctx, id); err != nil {
			return sale, err
		}
		b, _, e := s.Repo.Get(ctx, "sales", id, false)
		if e == nil {
			sale, e = lib.Decode[model.Sale](b)
		}
		if e != nil {
			return sale, e
		}
	}
	return sale, providerErr
}

func (s *Service) saveSale(ctx context.Context, r *repo.Repo, sale model.Sale, create bool) error {
	if err := r.Put(ctx, "sales", sale.ID, sale.BusinessLineID, sale, create); err != nil {
		return err
	}
	return r.Put(ctx, "payments", sale.Payment.ID, sale.BusinessLineID, sale.Payment, create)
}

func (s *Service) Sale(ctx context.Context, u model.User, id string) (model.Sale, error) {
	b, line, err := s.Repo.Get(ctx, "sales", id, false)
	if err != nil {
		return model.Sale{}, err
	}
	if err = Authorize(u, line, ""); err != nil {
		return model.Sale{}, err
	}
	return lib.Decode[model.Sale](b)
}

func (s *Service) VoidSale(ctx context.Context, u model.User, id string, reason string) (model.Sale, error) {
	if err := Admin(u); err != nil {
		return model.Sale{}, err
	}
	if !validation.Text(reason, 300) {
		return model.Sale{}, lib.Invalid("A non-empty void reason up to 300 characters is required")
	}
	var out model.Sale
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, line, err := r.Get(ctx, "sales", id, true)
		if err != nil {
			return err
		}
		if err = Authorize(u, line, ""); err != nil {
			return err
		}
		sale, err := lib.Decode[model.Sale](b)
		if err != nil {
			return err
		}
		if sale.Status != "paid" || sale.Payment.Status != "confirmed" {
			return lib.Conflict("Only paid confirmed sales can be voided")
		}
		for _, v := range sale.Items {
			if !v.StockTracked {
				continue
			}
			st, e := r.Stock(ctx, v.ItemID, true)
			if e != nil {
				return e
			}
			st.Quantity += int64(v.Quantity)
			if e = r.SaveStock(ctx, st); e != nil {
				return e
			}
			if e = s.movement(ctx, r, u.ID, line, v.ItemID, sale.ID, int64(v.Quantity), "adjustment", "Sale voided: "+reason); e != nil {
				return e
			}
		}
		sale.Status = "voided"
		sale.Payment.Status = "voided"
		if err = s.saveSale(ctx, r, sale, false); err != nil {
			return err
		}
		out = sale
		return nil
	})
	return out, err
}

func (s *Service) PaymentState(ctx context.Context, u model.User, id string) (model.Payment, error) {
	b, line, err := s.Repo.Get(ctx, "payments", id, false)
	if err != nil {
		return model.Payment{}, err
	}
	if err = Authorize(u, line, ""); err != nil {
		return model.Payment{}, err
	}
	return lib.Decode[model.Payment](b)
}

func (s *Service) applyPayment(ctx context.Context, r *repo.Repo, sale *model.Sale, to string, at time.Time) error {
	if !lib.PaymentTransition(sale.Payment.Status, to) {
		return lib.Conflict("Terminal payment state cannot be reopened")
	}
	for _, v := range sale.Items {
		if !v.StockTracked {
			continue
		}
		st, e := r.Stock(ctx, v.ItemID, true)
		if e != nil {
			return e
		}
		if st.ReservedQuantity < int64(v.Quantity) {
			return errors.New("reservation ledger inconsistent")
		}
		st.ReservedQuantity -= int64(v.Quantity)
		if to == "confirmed" {
			st.Quantity -= int64(v.Quantity)
		}
		if e = r.SaveStock(ctx, st); e != nil {
			return e
		}
		if to == "confirmed" {
			if e = s.movement(ctx, r, sale.CashierID, sale.BusinessLineID, v.ItemID, sale.ID, -int64(v.Quantity), "sale", "Verified QR payment"); e != nil {
				return e
			}
		}
	}
	sale.Payment.Status = to
	if to == "confirmed" {
		sale.Status = "paid"
		at = at.UTC()
		sale.Payment.ConfirmedAt = &at
	} else {
		sale.Status = "cancelled"
	}
	if e := s.saveSale(ctx, r, *sale, false); e != nil {
		return e
	}
	if to == "confirmed" {
		return s.enqueue(ctx, r, *sale)
	}
	return nil
}

func (s *Service) Webhook(ctx context.Context, provider, key, signature string, body []byte) (string, error) {
	if provider != s.Payment.Name() || provider == "disabled" {
		return "", lib.Unauthorized
	}
	if err := s.Payment.Verify(body, signature); err != nil {
		return "", lib.Unauthorized
	}
	var event dto.Event
	if err := strict(body, &event); err != nil {
		return "", err
	}
	if !validation.Text(event.EventID, 200) || key != event.EventID || !validation.Text(event.PaymentID, 200) || !lib.UUID(event.MerchantReference) || event.Amount < 0 || event.Amount > lib.MaxAmount || event.Currency == "" || (event.Status != "succeeded" && event.Status != "failed" && event.Status != "expired") || event.OccurredAt.IsZero() {
		return "", lib.Invalid("Invalid normalized payment event")
	}
	if event.Provider != "" && (event.Provider != provider || !validation.Text(event.Provider, 40)) {
		return "", lib.Invalid("Event provider does not match the verifying adapter")
	}
	bodyHash := hash(string(body))
	outcome := ""
	var resultErr error
	err := s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		if e := r.Lock(ctx, "event:"+event.EventID); e != nil {
			return e
		}
		old, e := r.Event(ctx, event.EventID)
		if e == nil {
			if old != bodyHash {
				return lib.Conflict("Event identifier reused with changed content")
			}
			outcome = "duplicate"
			return nil
		}
		if !errors.Is(e, lib.NotFound) {
			return e
		}
		meta := model.Reconciliation{ID: lib.ID(), EventID: event.EventID, SaleID: event.MerchantReference, ProviderStatus: event.Status, ProviderPaymentID: event.PaymentID, Amount: event.Amount, Currency: event.Currency, OccurredAt: event.OccurredAt.UTC(), CreatedAt: s.Now()}
		b, line, e := r.Get(ctx, "sales", event.MerchantReference, true)
		if errors.Is(e, lib.NotFound) {
			meta.Outcome = "unmatched"
			outcome = meta.Outcome
			resultErr = lib.Conflict("Webhook has no matching sale")
			return r.SaveEvent(ctx, meta, bodyHash, "")
		}
		if e != nil {
			return e
		}
		sale, e := lib.Decode[model.Sale](b)
		if e != nil {
			return e
		}
		to := event.Status
		if to == "succeeded" {
			to = "confirmed"
		}
		if event.OccurredAt.Before(s.Now().Add(-24*time.Hour)) || event.OccurredAt.After(s.Now().Add(5*time.Minute)) {
			meta.Outcome = "stale"
			resultErr = lib.Conflict("Stale or future event retained for review")
		} else if sale.Payment.Method == "qris" && sale.Payment.GatewayReference == nil && event.Amount == sale.Total && event.Currency == "IDR" {
			meta.Outcome = "unresolved"
		} else if sale.Payment.Method != "qris" || sale.Payment.GatewayReference == nil || *sale.Payment.GatewayReference != event.PaymentID || event.Amount != sale.Total || event.Currency != "IDR" {
			meta.Outcome = "mismatch"
			resultErr = lib.Conflict("Webhook payment reference, amount or currency mismatch")
		} else if sale.Payment.Status == to {
			meta.Outcome = "duplicate_state"
		} else if !lib.PaymentTransition(sale.Payment.Status, to) {
			meta.Outcome = "terminal_conflict"
			resultErr = lib.Conflict("Late or conflicting terminal event requires review")
		} else {
			meta.Outcome = "applied"
			if e = s.applyPayment(ctx, r, &sale, to, event.OccurredAt); e != nil {
				return e
			}
		}
		outcome = meta.Outcome
		return r.SaveEvent(ctx, meta, bodyHash, line)
	})
	if err != nil {
		return outcome, err
	}
	return outcome, resultErr
}

func (s *Service) Expire(ctx context.Context) error {
	ids, e := s.Repo.DuePayments(ctx, s.Now())
	if e != nil {
		return e
	}
	for _, id := range ids {
		e = s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
			b, _, e := r.Get(ctx, "sales", id, true)
			if e != nil {
				return e
			}
			sale, e := lib.Decode[model.Sale](b)
			if e != nil {
				return e
			}
			if sale.Payment.Status != "pending" || sale.Payment.ExpiresAt == nil || sale.Payment.ExpiresAt.After(s.Now()) {
				return nil
			}
			return s.applyPayment(ctx, r, &sale, "expired", s.Now())
		})
		if e != nil {
			return e
		}
	}
	return nil
}
