package service

import (
	"context"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"strconv"
	"strings"
	"time"
)

func mask(destination string) *string {
	if destination == "" {
		return nil
	}
	suffix := destination
	if len(destination) > 4 {
		suffix = destination[len(destination)-4:]
	}
	masked := "***" + suffix
	return &masked
}

func (s *Service) message(sale model.Sale) string {
	tpl := s.Template
	if strings.TrimSpace(tpl) == "" {
		tpl = lib.DefaultNotificationTemplate
	}
	return lib.RenderNotification(tpl, map[string]string{
		"saleId":         sale.ID,
		"total":          strconv.FormatInt(sale.Total, 10),
		"businessLineId": sale.BusinessLineID,
	})
}

func (s *Service) enqueue(ctx context.Context, r *repo.Repo, sale model.Sale) error {
	n := model.Notification{ID: lib.ID(), SaleID: sale.ID, Status: "queued", DestinationMasked: mask(s.Destination), CreatedAt: s.Now()}
	if s.Notification.Name() == "disabled" || s.Destination == "" {
		n.Status = "failed"
		code := "NOTIFICATION_DISABLED"
		n.LastError = &code
	}
	if e := r.Put(ctx, "notifications", n.ID, sale.BusinessLineID, n, true); e != nil {
		return e
	}
	if n.Status == "failed" {
		return nil
	}
	_, e := r.QueueDelivery(ctx, n.ID, s.Destination, s.message(sale))
	return e
}

func (s *Service) RetryNotification(ctx context.Context, u model.User, id string) error {
	if err := Admin(u); err != nil {
		return err
	}
	return s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		b, line, e := r.Get(ctx, "notifications", id, true)
		if e != nil {
			return e
		}
		if e = Authorize(u, line, ""); e != nil {
			return e
		}
		n, e := lib.Decode[model.Notification](b)
		if e != nil {
			return e
		}
		if n.Status != "failed" {
			return lib.Conflict("Only failed notifications can be retried")
		}
		if s.Notification.Name() == "disabled" || s.Destination == "" {
			return &lib.Error{Status: 503, Code: "NOTIFICATION_DISABLED", Message: "Notification provider is disabled"}
		}
		b, _, e = r.Get(ctx, "sales", n.SaleID, false)
		if e != nil {
			return e
		}
		sale, e := lib.Decode[model.Sale](b)
		if e != nil {
			return e
		}
		destination, e := r.QueueDelivery(ctx, n.ID, s.Destination, s.message(sale))
		if e != nil {
			return e
		}
		n.Status = "queued"
		n.LastError = nil
		n.DestinationMasked = mask(destination)
		return r.Put(ctx, "notifications", id, line, n, false)
	})
}

func (s *Service) Deliver(ctx context.Context) error {
	jobs, e := s.Repo.ClaimDeliveries(ctx, 8, s.Now())
	if e != nil {
		return e
	}
	for _, job := range jobs {
		sendErr := s.Notification.Send(ctx, job.ID, job.Destination, job.Message)
		success := sendErr == nil
		failed := !success && (job.Failures+1 >= 5 || s.Notification.Name() == "disabled")
		code := ""
		if !success {
			code = "PROVIDER_DELIVERY_FAILED"
		}
		if s.Notification.Name() == "disabled" {
			code = "NOTIFICATION_DISABLED"
		}
		next := s.Now().Add(time.Duration(1<<uint(job.Failures)) * 30 * time.Second)
		if e = s.Repo.FinishDelivery(ctx, job, success, failed, code, next); e != nil {
			return e
		}
	}
	return nil
}

func (s *Service) Integrations(u model.User) (any, error) {
	if err := Owner(u); err != nil {
		return nil, err
	}
	status := func(provider string, configured bool) map[string]any {
		return map[string]any{"provider": provider, "configured": configured, "productionSupported": provider == "borderpay"}
	}
	return map[string]any{
		"payment":         status(s.Payment.Name(), s.Payment.Name() != "disabled"),
		"notification":    status(s.Notification.Name(), s.Notification.Name() != "disabled" && s.Destination != ""),
		"productionReady": false,
	}, nil
}
