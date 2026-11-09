package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"pos/internal/model"
	"pos/pkg/crypto"
	"strings"
	"time"
)

type DisabledPayment struct{}

func (DisabledPayment) Name() string { return "disabled" }
func (DisabledPayment) Create(context.Context, model.Sale) (model.Intent, error) {
	return model.Intent{}, errors.New("payment provider disabled")
}
func (DisabledPayment) Verify([]byte, string) error { return errors.New("payment provider disabled") }

type MockPayment struct {
	BaseURL, APIKey, WebhookSecret string
	Client                         *http.Client
}

func NewMock(base, key, secret string) *MockPayment {
	return &MockPayment{strings.TrimRight(base, "/"), key, secret, client()}
}

func client() *http.Client {
	return &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (*MockPayment) Name() string { return "mock" }

func (p *MockPayment) Create(ctx context.Context, sale model.Sale) (model.Intent, error) {
	b, e := json.Marshal(map[string]any{"merchantReference": sale.ID, "amount": sale.Total, "currency": "IDR"})
	if e != nil {
		return model.Intent{}, e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, p.BaseURL+"/payments", bytes.NewReader(b))
	if e != nil {
		return model.Intent{}, e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Idempotency-Key", sale.ID)
	req.Header.Set("X-Idempotency-Key", sale.ID)
	res, e := p.Client.Do(req)
	if e != nil {
		return model.Intent{}, e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 201 {
		return model.Intent{}, errors.New("provider rejected intent")
	}
	var result struct {
		model.Intent
		Provider  string `json:"provider"`
		QRPayload string `json:"qrPayload"`
	}
	if e = decodeLimited(res.Body, &result); e != nil {
		return model.Intent{}, e
	}
	if result.Provider != "" && result.Provider != p.Name() {
		return model.Intent{}, errors.New("provider response identifies a different gateway")
	}
	if result.QRContent == "" {
		result.QRContent = result.QRPayload
	} else if result.QRPayload != "" && result.QRContent != result.QRPayload {
		return model.Intent{}, errors.New("conflicting QR payload fields")
	}
	return result.Intent, nil
}

func (p *MockPayment) Verify(body []byte, signature string) error {
	return crypto.VerifyHMACSHA256(body, signature, p.WebhookSecret)
}

func decodeLimited(r io.Reader, v any) error {
	b, e := io.ReadAll(io.LimitReader(r, 65537))
	if e != nil {
		return e
	}
	if len(b) > 65536 {
		return errors.New("provider response too large")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	if e = d.Decode(v); e != nil {
		return e
	}
	var extra any
	if e = d.Decode(&extra); e != io.EOF {
		return errors.New("multiple provider response values")
	}
	return nil
}
