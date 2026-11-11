package service

import (
	"context"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"time"
)

func (s *Service) borderpay() (model.PaymentReconciler, error) {
	p, ok := s.Payment.(model.PaymentReconciler)
	if s.Payment.Name() != "borderpay" || !ok {
		return nil, &lib.Error{Status: 503, Code: "PAYMENT_UNAVAILABLE", Message: "Borderpay is not configured"}
	}
	return p, nil
}

func providerFailure() error {
	return &lib.Error{Status: 502, Code: "PAYMENT_PROVIDER_ERROR", Message: "Borderpay status could not be verified; retry later or review reconciliation"}
}

type paymentEventData struct {
	dto.Event
	Mode         string
	CustomerPays *int64
}

func (s *Service) providerMatches(payment model.Payment, event paymentEventData) bool {
	if event.Provider != "borderpay" {
		return payment.Provider == "" || payment.Provider == s.Payment.Name()
	}
	return payment.Provider == "borderpay" && (payment.GatewayMode == "" || payment.GatewayMode == event.Mode) &&
		(payment.CustomerPays == nil || (event.CustomerPays != nil && *payment.CustomerPays == *event.CustomerPays))
}

func (s *Service) borderpayEvent(payment model.ProviderPayment, source string) paymentEventData {
	at := s.Now()
	if payment.PaidAt != nil {
		at = payment.PaidAt.UTC()
	}
	status := payment.Status
	if status == "confirmed" {
		status = "succeeded"
	}
	return paymentEventData{
		Event: dto.Event{
			EventID:  hash("borderpay:" + source + ":" + payment.Mode + ":" + payment.Reference + ":" + payment.Status),
			Provider: "borderpay", PaymentID: payment.Reference, MerchantReference: payment.Reference,
			Amount: payment.OrderAmount, Currency: "IDR", Status: status, OccurredAt: at,
		},
		Mode: payment.Mode, CustomerPays: &payment.CustomerPays,
	}
}

func (s *Service) BorderpayWebhook(ctx context.Context, token, eventHeader, modeHeader string, body []byte) (string, error) {
	if s.Payment.Name() != "borderpay" || s.Payment.Verify(body, token) != nil {
		return "", lib.Unauthorized
	}
	p, err := s.borderpay()
	if err != nil {
		return "", err
	}
	notice, err := p.DecodeWebhook(body, eventHeader, modeHeader)
	if err != nil {
		return "", lib.Invalid("Invalid Borderpay webhook")
	}
	payment, err := p.Lookup(ctx, notice.Reference)
	if err != nil {
		return "", providerFailure()
	}
	if payment.Mode != notice.Mode || payment.CustomerPays != notice.Amount || payment.Status == "pending" || (notice.Status == "confirmed" && payment.Status != "confirmed") {
		return "", lib.Conflict("Borderpay webhook differs from authenticated payment status")
	}
	event := s.borderpayEvent(payment, "webhook:"+notice.Status)
	return s.paymentEvent(ctx, event, fingerprint(notice))
}

func (s *Service) refreshBorderpay(ctx context.Context, saleID string) error {
	p, err := s.borderpay()
	if err != nil {
		return err
	}
	var sale model.Sale
	claimed := false
	err = s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, _, e := r.Get(ctx, "sales", saleID, true)
		if e != nil {
			return e
		}
		sale, e = lib.Decode[model.Sale](b)
		if e != nil {
			return e
		}
		if sale.Payment.Provider != "borderpay" {
			return lib.Conflict("Payment belongs to a different provider")
		}
		if sale.Payment.GatewayReference == nil || (sale.Payment.Status != "pending" && sale.Payment.Status != "expired") {
			return nil
		}
		if sale.Payment.NextStatusAt != nil && sale.Payment.NextStatusAt.After(s.Now()) {
			if sale.Payment.StatusError != nil {
				return providerFailure()
			}
			return nil
		}
		next := s.Now().Add(15 * time.Second)
		sale.Payment.NextStatusAt = &next
		claimed = true
		return s.saveSale(ctx, r, sale, false)
	})
	if err != nil || !claimed {
		return err
	}
	payment, err := p.Lookup(ctx, saleID)
	if err != nil {
		if saveErr := s.borderpayStatusError(ctx, saleID, true); saveErr != nil {
			return saveErr
		}
		return providerFailure()
	}
	event := s.borderpayEvent(payment, "lookup")
	if payment.OrderAmount != sale.Total || !s.providerMatches(sale.Payment, event) {
		if saveErr := s.borderpayStatusError(ctx, saleID, true); saveErr != nil {
			return saveErr
		}
		return lib.Conflict("Borderpay status does not match the stored order, mode, or customer total")
	}
	if sale.Payment.StatusError != nil {
		if err = s.borderpayStatusError(ctx, saleID, false); err != nil {
			return err
		}
	}
	if payment.Status == "pending" {
		return nil
	}
	_, err = s.paymentEvent(ctx, event, fingerprint(payment))
	return err
}

func (s *Service) borderpayStatusError(ctx context.Context, saleID string, failed bool) error {
	return s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, _, err := r.Get(ctx, "sales", saleID, true)
		if err != nil {
			return err
		}
		sale, err := lib.Decode[model.Sale](b)
		if err != nil {
			return err
		}
		sale.Payment.StatusError = nil
		if failed && (sale.Payment.Status == "pending" || sale.Payment.Status == "expired") {
			code := "STATUS_LOOKUP_FAILED"
			sale.Payment.StatusError = &code
		}
		return s.saveSale(ctx, r, sale, false)
	})
}
