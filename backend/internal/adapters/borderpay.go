package adapters

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"pos/internal/lib"
	"pos/internal/model"
	"strings"
	"time"
)

type Borderpay struct {
	BaseURL, APIKey, WebhookToken, ProjectSlug string
	Client                                     *http.Client
}

func NewBorderpay(base, key, token, slug string) *Borderpay {
	return &Borderpay{strings.TrimRight(base, "/"), key, token, slug, client()}
}

func (*Borderpay) Name() string { return "borderpay" }

func (p *Borderpay) mode() string {
	if strings.HasPrefix(p.APIKey, "bp_test_") {
		return "test"
	}
	if strings.HasPrefix(p.APIKey, "bp_live_") {
		return "live"
	}
	return ""
}

type BorderpayError struct {
	Status int
}

func (e *BorderpayError) Error() string {
	return fmt.Sprintf("borderpay request failed (HTTP %d)", e.Status)
}

func (e *BorderpayError) Retryable() bool {
	return e.Status == http.StatusRequestTimeout || e.Status == http.StatusTooManyRequests || e.Status >= 500
}

func (p *Borderpay) request(ctx context.Context, method, path string, body any, result any) error {
	var b []byte
	var err error
	if body != nil {
		b, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, p.BaseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := p.Client.Do(req)
	if err != nil {
		return fmt.Errorf("borderpay transport: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		return &BorderpayError{Status: res.StatusCode}
	}
	if err = decodeLimited(res.Body, result); err != nil {
		return fmt.Errorf("borderpay response: %w", err)
	}
	return nil
}

func (p *Borderpay) Create(ctx context.Context, sale model.Sale) (model.Intent, error) {
	if !lib.UUID(sale.ID) || sale.Total < 1 || sale.Total > lib.MaxAmount || p.mode() == "" {
		return model.Intent{}, errors.New("invalid borderpay payment request")
	}
	var response struct {
		Type         string     `json:"type"`
		Reference    string     `json:"reference_id"`
		Status       string     `json:"status"`
		Mode         string     `json:"mode"`
		Amount       int64      `json:"amount"`
		CustomerPays *int64     `json:"customer_pays"`
		QR           string     `json:"qr_string"`
		ExpiresAt    *time.Time `json:"expires_at"`
	}
	body := struct {
		Amount    int64  `json:"amount"`
		Method    string `json:"method"`
		Reference string `json:"reference_id"`
	}{sale.Total, "qris", sale.ID}
	err := p.request(ctx, http.MethodPost, "/payments", body, &response)
	if err != nil {
		var rejected *BorderpayError
		if errors.As(err, &rejected) && rejected.Status == http.StatusConflict {
			status, lookupErr := p.Lookup(ctx, sale.ID)
			if lookupErr == nil && status.Status != "pending" && status.OrderAmount == sale.Total {
				return model.Intent{PaymentID: sale.ID, MerchantReference: sale.ID, Amount: status.OrderAmount, Currency: "IDR", Status: status.Status, Mode: status.Mode, CustomerPays: &status.CustomerPays}, nil
			}
			if lookupErr != nil {
				return model.Intent{}, lookupErr
			}
		}
		return model.Intent{}, err
	}
	status, err := borderpayStatus(response.Status)
	if err != nil {
		return model.Intent{}, err
	}
	if response.Type != "charge" || response.Reference != sale.ID || response.Amount != sale.Total || response.Mode != p.mode() || response.CustomerPays == nil || *response.CustomerPays < sale.Total || *response.CustomerPays > lib.MaxAmount {
		return model.Intent{}, errors.New("borderpay payment identity or amount mismatch")
	}
	if status == "pending" && (response.QR == "" || len(response.QR) > 4096 || response.ExpiresAt == nil || !response.ExpiresAt.After(sale.CreatedAt) || response.ExpiresAt.After(time.Now().Add(24*time.Hour))) {
		return model.Intent{}, errors.New("borderpay pending payment lacks valid QR or expiry")
	}
	intent := model.Intent{PaymentID: sale.ID, MerchantReference: sale.ID, Amount: sale.Total, Currency: "IDR", Status: status, QRContent: response.QR, Mode: response.Mode, CustomerPays: response.CustomerPays}
	if response.ExpiresAt != nil {
		intent.ExpiresAt = response.ExpiresAt.UTC()
	}
	return intent, nil
}

func (p *Borderpay) Lookup(ctx context.Context, reference string) (model.ProviderPayment, error) {
	if !lib.UUID(reference) || p.mode() == "" {
		return model.ProviderPayment{}, errors.New("invalid borderpay reference or mode")
	}
	var response struct {
		Reference    string     `json:"reference_id"`
		Method       string     `json:"method"`
		Status       string     `json:"status"`
		OrderAmount  *int64     `json:"order_amount"`
		CustomerPays *int64     `json:"customer_pays"`
		PaidAt       *time.Time `json:"paid_at"`
	}
	if err := p.request(ctx, http.MethodGet, "/payments/"+url.PathEscape(reference), nil, &response); err != nil {
		return model.ProviderPayment{}, err
	}
	status, err := borderpayStatus(response.Status)
	if err != nil {
		return model.ProviderPayment{}, err
	}
	if response.Reference != reference || response.Method != "qris" || response.OrderAmount == nil || *response.OrderAmount < 1 || *response.OrderAmount > lib.MaxAmount || response.CustomerPays == nil || *response.CustomerPays < *response.OrderAmount || *response.CustomerPays > lib.MaxAmount {
		return model.ProviderPayment{}, errors.New("invalid borderpay status identity or amounts")
	}
	return model.ProviderPayment{Reference: reference, Mode: p.mode(), Status: status, OrderAmount: *response.OrderAmount, CustomerPays: *response.CustomerPays, PaidAt: response.PaidAt}, nil
}

func (p *Borderpay) Verify(_ []byte, token string) error {
	if p.WebhookToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(p.WebhookToken)) != 1 {
		return errors.New("invalid borderpay webhook token")
	}
	return nil
}

func (p *Borderpay) DecodeWebhook(body []byte, eventHeader, modeHeader string) (model.ProviderEvent, error) {
	var event struct {
		Event string `json:"event"`
		Mode  string `json:"mode"`
		Data  struct {
			Slug      string `json:"slug"`
			Mode      string `json:"mode"`
			Reference string `json:"reference_id"`
			OrderID   string `json:"order_id"`
			Status    string `json:"status"`
			Amount    int64  `json:"amount"`
			Method    string `json:"method"`
		} `json:"data"`
	}
	if err := decodeLimited(bytes.NewReader(body), &event); err != nil {
		return model.ProviderEvent{}, err
	}
	status, err := borderpayStatus(event.Data.Status)
	if err != nil || status == "pending" || event.Event != "payment."+event.Data.Status || (eventHeader != "" && eventHeader != event.Event) || (modeHeader != "" && modeHeader != event.Mode) || event.Mode != p.mode() || (event.Data.Mode != "" && event.Data.Mode != event.Mode) || p.ProjectSlug == "" || event.Data.Slug != p.ProjectSlug || !lib.UUID(event.Data.Reference) || (event.Data.OrderID != "" && event.Data.OrderID != event.Data.Reference) || event.Data.Method != "qris" || event.Data.Amount < 1 || event.Data.Amount > lib.MaxAmount {
		return model.ProviderEvent{}, errors.New("invalid borderpay webhook event, project, or mode")
	}
	return model.ProviderEvent{Reference: event.Data.Reference, Mode: event.Mode, Status: status, Amount: event.Data.Amount}, nil
}

func borderpayStatus(status string) (string, error) {
	switch status {
	case "pending", "failed", "expired":
		return status, nil
	case "paid":
		return "confirmed", nil
	default:
		return "", errors.New("unsupported borderpay payment status; manual reconciliation required")
	}
}
