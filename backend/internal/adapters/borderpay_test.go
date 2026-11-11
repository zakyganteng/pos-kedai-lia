package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"pos/internal/lib"
	"pos/internal/model"
	"strings"
	"testing"
	"time"
)

const borderpayToken = "test-only-borderpay-webhook-token"

func TestBorderpayQRISContract(t *testing.T) {
	sale := model.Sale{ID: lib.ID(), Total: 30000, CreatedAt: time.Now().UTC()}
	expires := sale.CreatedAt.Add(30 * time.Minute)
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") != "Bearer bp_test_fixture" || r.Header.Get("Idempotency-Key") != "" || r.Header.Get("X-Idempotency-Key") != "" {
			t.Error("incorrect Borderpay authentication or invented idempotency headers")
		}
		switch r.Method {
		case http.MethodPost:
			if r.URL.Path != "/api/v1/payments" || r.Header.Get("Content-Type") != "application/json" {
				t.Error("incorrect create URL or content type")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if len(body) != 3 || body["reference_id"] != sale.ID || body["method"] != "qris" || body["amount"] != float64(sale.Total) {
				t.Error("incorrect QRIS payload", body)
			}
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(map[string]any{"type": "charge", "reference_id": sale.ID, "amount": sale.Total, "customer_pays": 31000, "mode": "test", "status": "pending", "qr_string": "TEST-FIXTURE-QR", "expires_at": expires})
		case http.MethodGet:
			if r.URL.Path != "/api/v1/payments/"+sale.ID {
				t.Error("status did not use merchant reference")
			}
			json.NewEncoder(w).Encode(map[string]any{"reference_id": sale.ID, "amount": 31000, "order_amount": sale.Total, "customer_pays": 31000, "method": "qris", "status": "paid", "paid_at": sale.CreatedAt})
		}
	}))
	defer server.Close()
	p := NewBorderpay(server.URL+"/api/v1/", "bp_test_fixture", borderpayToken, "test-shop")
	intent, err := p.Create(context.Background(), sale)
	if err != nil || intent.PaymentID != sale.ID || intent.MerchantReference != sale.ID || intent.Amount != sale.Total || intent.Currency != "IDR" || intent.Status != "pending" || intent.QRContent != "TEST-FIXTURE-QR" || !intent.ExpiresAt.Equal(expires) || intent.Mode != "test" || intent.CustomerPays == nil || *intent.CustomerPays != 31000 {
		t.Fatal(intent, err)
	}
	status, err := p.Lookup(context.Background(), sale.ID)
	if err != nil || status.Status != "confirmed" || status.OrderAmount != 30000 || status.CustomerPays != 31000 || status.PaidAt == nil || status.Mode != "test" || requests != 2 {
		t.Fatal(status, requests, err)
	}
}

func TestBorderpayRejectsInvalidCreateResponses(t *testing.T) {
	sale := model.Sale{ID: lib.ID(), Total: 30000, CreatedAt: time.Now().UTC()}
	for _, field := range []string{"reference_id", "amount", "customer_pays", "mode", "qr_string", "expires_at", "status", "type"} {
		t.Run(field, func(t *testing.T) {
			response := map[string]any{"type": "charge", "reference_id": sale.ID, "amount": sale.Total, "customer_pays": sale.Total, "mode": "test", "status": "pending", "qr_string": "TEST-FIXTURE", "expires_at": sale.CreatedAt.Add(time.Hour)}
			response[field] = nil
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			p := NewBorderpay(server.URL, "bp_test_fixture", borderpayToken, "test-shop")
			if _, err := p.Create(context.Background(), sale); err == nil {
				t.Fatal("invalid provider response accepted")
			}
		})
	}
}

func TestBorderpayErrorsAndAlreadyPaidRecovery(t *testing.T) {
	reference := lib.ID()
	statusCode := http.StatusUnauthorized
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && statusCode == http.StatusConflict {
			json.NewEncoder(w).Encode(map[string]any{"reference_id": reference, "order_amount": 30000, "customer_pays": 30000, "method": "qris", "status": "paid"})
			return
		}
		w.WriteHeader(statusCode)
		w.Write([]byte(`{"error":{"code":"unauthorized","message":"DO-NOT-EXPOSE-PROVIDER-BODY"}}`))
	}))
	defer server.Close()
	p := NewBorderpay(server.URL, "bp_test_fixture", borderpayToken, "test-shop")
	for _, code := range []int{400, 401, 403, 422, 429, 500, 302} {
		statusCode = code
		_, err := p.Create(context.Background(), model.Sale{ID: reference, Total: 30000})
		var rejected *BorderpayError
		if !errors.As(err, &rejected) || rejected.Status != code || rejected.Retryable() != (code == 429 || code >= 500) || strings.Contains(err.Error(), "DO-NOT-EXPOSE") {
			t.Fatal(code, err)
		}
	}
	statusCode = http.StatusConflict
	intent, err := p.Create(context.Background(), model.Sale{ID: reference, Total: 30000})
	if err != nil || intent.Status != "confirmed" || intent.QRContent != "" {
		t.Fatal(intent, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = p.Lookup(ctx, reference); !errors.Is(err, context.Canceled) {
		t.Fatal("request cancellation was not preserved", err)
	}
}

func TestBorderpayWebhookBoundary(t *testing.T) {
	p := NewBorderpay("", "bp_test_fixture", borderpayToken, "test-shop")
	if p.Verify(nil, borderpayToken) != nil || p.Verify(nil, "") == nil || p.Verify(nil, borderpayToken+"wrong") == nil || NewBorderpay("", "", "", "").Verify(nil, "") == nil {
		t.Fatal("webhook token verification")
	}
	reference := lib.ID()
	valid := func() map[string]any {
		return map[string]any{"event": "payment.paid", "mode": "test", "data": map[string]any{"slug": "test-shop", "reference_id": reference, "order_id": reference, "status": "paid", "amount": 31000, "method": "qris", "fee": 1000}}
	}
	body, _ := json.Marshal(valid())
	event, err := p.DecodeWebhook(body, "payment.paid", "test")
	if err != nil || event.Reference != reference || event.Amount != 31000 || event.Status != "confirmed" {
		t.Fatal(event, err)
	}
	if _, err = p.DecodeWebhook(body, "", ""); err != nil {
		t.Fatal("optional headers were required", err)
	}
	for _, field := range []string{"slug", "mode", "reference_id", "order_id", "status", "amount", "method"} {
		t.Run(field, func(t *testing.T) {
			v := valid()
			v["data"].(map[string]any)[field] = "wrong"
			b, _ := json.Marshal(v)
			if _, err := p.DecodeWebhook(b, "", ""); err == nil {
				t.Fatal("invalid webhook accepted")
			}
		})
	}
	for _, headers := range [][2]string{{"payment.failed", "test"}, {"payment.paid", "live"}} {
		if _, err = p.DecodeWebhook(body, headers[0], headers[1]); err == nil {
			t.Fatal("conflicting headers accepted")
		}
	}
}

func TestBorderpayMalformedStatusAndBoundedResponses(t *testing.T) {
	reference := lib.ID()
	for _, body := range []string{
		`{"reference_id":"` + reference + `","method":"qris","status":"paid","amount":30000,"customer_pays":30000}`,
		`{"reference_id":"` + reference + `","method":"va","status":"paid","order_amount":30000,"customer_pays":30000}`,
		`{"reference_id":"` + reference + `","method":"qris","status":"refunded","order_amount":30000,"customer_pays":30000}`,
		`{} {}`,
		strings.Repeat(" ", 65537),
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
		p := NewBorderpay(server.URL, "bp_test_fixture", borderpayToken, "test-shop")
		_, err := p.Lookup(context.Background(), reference)
		server.Close()
		if err == nil {
			t.Fatal("invalid status response accepted")
		}
	}
}
