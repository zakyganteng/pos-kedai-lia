package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type DisabledNotification struct{}

func (DisabledNotification) Name() string { return "disabled" }
func (DisabledNotification) Send(context.Context, string, string, string) error {
	return errors.New("notification disabled")
}

type HTTPNotification struct {
	BaseURL, APIKey string
	Client          *http.Client
}

func NewNotification(base, key string) *HTTPNotification {
	return &HTTPNotification{strings.TrimRight(base, "/"), key, client()}
}

func (*HTTPNotification) Name() string { return "http" }

func (p *HTTPNotification) Send(ctx context.Context, key, destination, message string) error {
	if destination == "" {
		return errors.New("destination missing")
	}
	b, e := json.Marshal(map[string]string{"destination": destination, "message": message})
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, p.BaseURL+"/messages", bytes.NewReader(b))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("X-Idempotency-Key", key)
	res, e := p.Client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return errors.New("notification rejected")
	}
	var response struct {
		Status    string `json:"status"`
		MessageID string `json:"messageId"`
	}
	if e = decodeLimited(res.Body, &response); e != nil {
		return e
	}
	if response.Status != "sent" || response.MessageID == "" {
		return errors.New("delivery not confirmed")
	}
	return nil
}
