package route

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"pos/internal/adapters"
	"pos/internal/service"
	"strings"
	"testing"
)

func TestMalformedJSONBodyIsClientError(t *testing.T) {
	h := New(&service.Service{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, target := range []string{"/api/v1/auth/login", "/api/v1/webhooks/payments/mock"} {
		for _, body := range []string{`{`, `{"email":`, `{"email":"a@b.test"`, ``, `[]`, `{"a":1,"a":2}`, `{"a":1} {"b":2}`} {
			req := httptest.NewRequest("POST", target, strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Idempotency-Key", "regression-key")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("%s body %q: status %d, want 400", target, body, rec.Code)
			}

			var payload struct {
				Error struct {
					Code      string `json:"code"`
					Message   string `json:"message"`
					RequestID string `json:"requestId"`
				} `json:"error"`
			}
			if e := json.Unmarshal(rec.Body.Bytes(), &payload); e != nil {
				t.Fatalf("%s body %q: %v (%s)", target, body, e, rec.Body.String())
			}
			if payload.Error.Code != "VALIDATION_ERROR" || payload.Error.RequestID == "" {
				t.Errorf("%s body %q: %+v", target, body, payload.Error)
			}
		}
	}
	req := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader(`{"email":"a@b.test","password":"x"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatal("missing Content-Type accepted", rec.Code)
	}
}

func TestBorderpayWebhookUsesVendorHeaders(t *testing.T) {
	p := adapters.NewBorderpay("", "bp_test_route-fixture", "test-only-verification-token", "test-shop")
	h := New(&service.Service{Payment: p}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	for _, tc := range []struct {
		token string
		want  int
	}{{"", 401}, {"wrong", 401}, {"test-only-verification-token", 400}} {
		req := httptest.NewRequest("POST", "/api/v1/webhooks/payments/borderpay", strings.NewReader(`{"event":"payment.paid","mode":"live","data":{}}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-borderpay-token", tc.token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatal("Borderpay header dispatch failed", rec.Code, tc.want)
		}
	}
}
