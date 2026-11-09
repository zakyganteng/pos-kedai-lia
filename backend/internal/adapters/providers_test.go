package adapters

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"pos/internal/lib"
	"pos/internal/model"
	"testing"
	"time"
)

func TestExternalMockBoundary(t *testing.T) {
	sale := model.Sale{ID: lib.ID(), Total: 30000}
	provider := "mock"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/payments" || r.Header.Get("Authorization") != "Bearer external-test-key" || r.Header.Get("Idempotency-Key") != sale.ID || r.Header.Get("X-Idempotency-Key") != sale.ID {
			t.Error("provider request contract")
		}
		var b map[string]any
		json.NewDecoder(r.Body).Decode(&b)
		if b["merchantReference"] != sale.ID || b["amount"] != float64(30000) || b["currency"] != "IDR" {
			t.Error(b)
		}
		json.NewEncoder(w).Encode(map[string]any{"paymentId": "external-ref", "provider": provider, "merchantReference": sale.ID, "amount": 30000, "currency": "IDR", "status": "pending", "qrPayload": "MOCK-ONLY-PAYLOAD", "expiresAt": time.Now().UTC().Add(time.Hour)})
	}))
	defer server.Close()
	p := NewMock(server.URL, "external-test-key", "sixteen-byte-test-secret")
	intent, e := p.Create(context.Background(), sale)
	if e != nil || intent.QRContent != "MOCK-ONLY-PAYLOAD" || intent.PaymentID != "external-ref" {
		t.Fatal(intent, e)
	}
	body := []byte(`{"eventId":"123"}`)
	mac := hmac.New(sha256.New, []byte(p.WebhookSecret))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))
	if p.Verify(body, "sha256="+sig) != nil || p.Verify(append(body, ' '), sig) == nil || p.Verify(body, "00") == nil {
		t.Fatal("signature boundary")
	}
	provider = "some-other-gateway"
	if _, e = p.Create(context.Background(), sale); e == nil {
		t.Fatal("intent from a different gateway accepted")
	}
	provider = ""
	if intent, e = p.Create(context.Background(), sale); e != nil || intent.PaymentID != "external-ref" {
		t.Fatal("response without provider metadata rejected", intent, e)
	}
}

func TestNotificationNeverFabricatesDelivery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "queued", "messageId": "pending"})
	}))
	defer server.Close()
	p := NewNotification(server.URL, "key")
	if p.Send(context.Background(), "id", "+6281234567890", "message") == nil {
		t.Fatal("queued response claimed sent")
	}
	if (DisabledNotification{}).Send(context.Background(), "id", "", "message") == nil {
		t.Fatal("disabled claimed success")
	}
}
