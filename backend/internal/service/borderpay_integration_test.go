package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"pos/internal/adapters"
	"pos/internal/lib"
	"pos/internal/model"
	"strings"
	"sync"
	"testing"
	"time"
)

type borderpayFixturePayment struct {
	amount, customerPays int64
	status               string
	expires              time.Time
}

type borderpayFixtureGateway struct {
	mu           sync.Mutex
	payments     map[string]borderpayFixturePayment
	createCalls  int
	lookupCalls  int
	loseResponse bool
	rejectCreate int
	rejectLookup int
}

func borderpaySetup(t *testing.T) (*fixture, *borderpayFixtureGateway) {
	t.Helper()
	f := setup(t)
	g := &borderpayFixtureGateway{payments: map[string]borderpayFixturePayment{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer bp_test_integration-fixture" {
			t.Error("missing provider authorization")
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/payments" {
			g.createCalls++
			if g.rejectCreate != 0 {
				w.WriteHeader(g.rejectCreate)
				return
			}
			var body struct {
				Amount    int64  `json:"amount"`
				Method    string `json:"method"`
				Reference string `json:"reference_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Method != "qris" {
				t.Error("incorrect provider payload", err)
			}
			p, exists := g.payments[body.Reference]
			if !exists {
				p = borderpayFixturePayment{body.Amount, body.Amount + 1000, "pending", time.Now().UTC().Add(30 * time.Minute)}
				g.payments[body.Reference] = p
			}
			if g.loseResponse {
				g.loseResponse = false
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			response := map[string]any{"type": "charge", "reference_id": body.Reference, "amount": p.amount, "customer_pays": p.customerPays, "mode": "test", "status": p.status}
			if p.status == "pending" {
				response["qr_string"] = "TEST-ONLY-QR-" + body.Reference
				response["expires_at"] = p.expires
			}
			json.NewEncoder(w).Encode(response)
			return
		}
		g.lookupCalls++
		if g.rejectLookup != 0 {
			w.WriteHeader(g.rejectLookup)
			return
		}
		ref := strings.TrimPrefix(r.URL.Path, "/api/v1/payments/")
		p, ok := g.payments[ref]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		response := map[string]any{"reference_id": ref, "amount": p.customerPays, "order_amount": p.amount, "customer_pays": p.customerPays, "method": "qris", "status": p.status}
		if p.status == "paid" {
			response["paid_at"] = time.Now().UTC().Truncate(time.Second)
		}
		json.NewEncoder(w).Encode(response)
	}))
	t.Cleanup(server.Close)
	f.svc.Payment = adapters.NewBorderpay(server.URL+"/api/v1", "bp_test_integration-fixture", secret, "integration-shop")
	return f, g
}

func (g *borderpayFixtureGateway) setStatus(reference, status string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.payments[reference]
	p.status = status
	g.payments[reference] = p
}

func borderpayBody(sale model.Sale, status string, amount int64) []byte {
	b, _ := json.Marshal(map[string]any{
		"event": "payment." + status, "mode": "test",
		"data": map[string]any{"slug": "integration-shop", "reference_id": sale.ID, "order_id": sale.ID, "status": status, "amount": amount, "method": "qris"},
	})
	return b
}

func TestPostgresBorderpayWebhookAndIdempotency(t *testing.T) {
	f, g := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 3)
	key := lib.ID()
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "qris", 2))
	if err != nil || sale.Payment.Provider != "borderpay" || sale.Payment.GatewayMode != "test" || sale.Payment.CustomerPays == nil || *sale.Payment.CustomerPays != 31000 || sale.Payment.GatewayReference == nil || *sale.Payment.GatewayReference != sale.ID {
		t.Fatal(sale.Payment, err)
	}
	if _, err = f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "qris", 2)); err != nil || g.createCalls != 1 {
		t.Fatal("duplicate provider charge", g.createCalls, err)
	}
	body := borderpayBody(sale, "paid", 31000)
	if _, err = f.svc.BorderpayWebhook(ctx, "wrong", "", "", body); err == nil {
		t.Fatal("forged token accepted")
	}
	_, err = f.svc.BorderpayWebhook(ctx, secret, "", "", body)
	requireStatus(t, err, 409)
	g.setStatus(sale.ID, "paid")
	_, err = f.svc.BorderpayWebhook(ctx, secret, "", "", borderpayBody(sale, "paid", 30000))
	requireStatus(t, err, 409)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := f.svc.BorderpayWebhook(ctx, secret, "payment.paid", "test", body); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	saved, err := f.svc.Sale(ctx, f.owner, sale.ID)
	if err != nil || saved.Status != "paid" || saved.Payment.Status != "confirmed" {
		t.Fatal(saved, err)
	}
	stock, err := f.repo.Stock(ctx, p.ID, false)
	if err != nil || stock.Quantity != 1 || stock.ReservedQuantity != 0 {
		t.Fatal(stock, err)
	}
	var movements, notifications int
	if err = f.sql.QueryRow(ctx, `SELECT count(*) FROM records WHERE kind='movements' AND body->>'saleId'=$1`, sale.ID).Scan(&movements); err != nil {
		t.Fatal(err)
	}
	if err = f.sql.QueryRow(ctx, `SELECT count(*) FROM records WHERE kind='notifications' AND body->>'saleId'=$1`, sale.ID).Scan(&notifications); err != nil || movements != 1 || notifications != 1 {
		t.Fatal(movements, notifications, err)
	}
}

func TestPostgresBorderpayStatusPollingAndExpiry(t *testing.T) {
	f, g := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 2)
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.svc.Sale(ctx, f.owner, sale.ID); err != nil || g.lookupCalls != 0 {
		t.Fatal("poll throttling failed", err)
	}
	now := f.svc.Now().Add(16 * time.Second)
	f.svc.Now = func() time.Time { return now }
	g.setStatus(sale.ID, "paid")
	saved, err := f.svc.Sale(ctx, f.owner, sale.ID)
	if err != nil || saved.Status != "paid" || g.lookupCalls != 1 {
		t.Fatal("sale polling did not confirm payment", saved, err)
	}
	f.svc.Now = func() time.Time { return time.Now().UTC() }
	sale, err = f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if err != nil {
		t.Fatal(err)
	}
	now = sale.Payment.ExpiresAt.Add(time.Minute)
	f.svc.Now = func() time.Time { return now }
	if err = f.svc.Expire(ctx); err != nil {
		t.Fatal(err)
	}
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.ReservedQuantity != 1 {
		t.Fatal("local clock released an externally pending payment", stock)
	}
	g.setStatus(sale.ID, "expired")
	now = now.Add(16 * time.Second)
	if err = f.svc.Expire(ctx); err != nil {
		t.Fatal(err)
	}
	stock, _ = f.repo.Stock(ctx, p.ID, false)
	if stock.ReservedQuantity != 0 {
		t.Fatal("verified expiry did not release stock", stock)
	}
	g.setStatus(sale.ID, "paid")
	out, err := f.svc.BorderpayWebhook(ctx, secret, "", "", borderpayBody(sale, "paid", 16000))
	if err != nil || out != "applied" {
		t.Fatal("late paid event was not applied", out, err)
	}
	stock, _ = f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 0 || stock.ReservedQuantity != 0 {
		t.Fatal("late confirmation double-released reservations", stock)
	}
}

func TestPostgresBorderpayLostPaidIntentRecovery(t *testing.T) {
	f, g := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 1)
	g.loseResponse = true
	key := lib.ID()
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "qris", 1))
	requireStatus(t, err, 502)
	g.setStatus(sale.ID, "paid")
	out, err := f.svc.BorderpayWebhook(ctx, secret, "", "", borderpayBody(sale, "paid", 16000))
	if err != nil || out != "unresolved" {
		t.Fatal(out, err)
	}
	now := f.svc.Now().Add(time.Minute)
	f.svc.Now = func() time.Time { return now }
	if err = f.svc.RecoverIntents(ctx); err != nil {
		t.Fatal(err)
	}
	saved, err := f.svc.Sale(ctx, f.owner, sale.ID)
	if err != nil || saved.Status != "paid" || g.createCalls != 2 || len(g.payments) != 1 {
		t.Fatal("lost response created a new charge or failed recovery", saved, err)
	}
	if _, err = f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "qris", 1)); err != nil || g.createCalls != 2 {
		t.Fatal("replayed paid order was charged again", err)
	}
}

func TestPostgresBorderpayLateStockConflictRetained(t *testing.T) {
	f, g := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 1)
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if err != nil {
		t.Fatal(err)
	}
	g.setStatus(sale.ID, "expired")
	if _, err = f.svc.BorderpayWebhook(ctx, secret, "", "", borderpayBody(sale, "expired", 16000)); err != nil {
		t.Fatal(err)
	}
	if _, err = f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1)); err != nil {
		t.Fatal(err)
	}
	g.setStatus(sale.ID, "paid")
	_, err = f.svc.BorderpayWebhook(ctx, secret, "", "", borderpayBody(sale, "paid", 16000))
	requireStatus(t, err, 409)
	var conflicts int
	if err = f.sql.QueryRow(ctx, `SELECT count(*) FROM payment_events WHERE body->>'saleId'=$1 AND body->>'outcome'='terminal_conflict'`, sale.ID).Scan(&conflicts); err != nil || conflicts != 1 {
		t.Fatal("late stock conflict was not retained", conflicts, err)
	}
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 0 || stock.ReservedQuantity != 0 {
		t.Fatal("late payment oversold stock", stock)
	}
}

func TestPostgresBorderpayProviderFailuresAndImmutableTotals(t *testing.T) {
	f, g := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 2)
	g.rejectCreate = http.StatusUnauthorized
	key := lib.ID()
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "qris", 1))
	requireStatus(t, err, 502)
	if sale.Payment.IntentError == nil || *sale.Payment.IntentError != "INTENT_REJECTED" || sale.Payment.NextIntentAt != nil {
		t.Fatal("permanent rejection scheduled for blind retry", sale.Payment)
	}
	if err = f.svc.RecoverIntents(ctx); err != nil || g.createCalls != 1 {
		t.Fatal("unauthorized create retried automatically", g.createCalls, err)
	}
	g.rejectCreate = 0
	sale, err = f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "qris", 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.sql.Exec(ctx, `UPDATE records SET body=jsonb_set(body,'{customerPays}','1'::jsonb) WHERE kind='payments' AND id=$1`, sale.Payment.ID); err == nil {
		t.Fatal("persisted customer total was mutable")
	}
	g.rejectLookup = http.StatusTooManyRequests
	now := f.svc.Now().Add(16 * time.Second)
	f.svc.Now = func() time.Time { return now }
	_, err = f.svc.PaymentState(ctx, f.owner, sale.Payment.ID)
	requireStatus(t, err, 502)
	lookups := g.lookupCalls
	_, err = f.svc.Sale(ctx, f.owner, sale.ID)
	requireStatus(t, err, 502)
	if g.lookupCalls != lookups {
		t.Fatal("failed status was retried before backoff elapsed")
	}
	g.rejectLookup = 0
	now = now.Add(16 * time.Second)
	if _, err = f.svc.Sale(ctx, f.owner, sale.ID); err != nil {
		t.Fatal("status failure did not clear after successful verification", err)
	}
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.ReservedQuantity != 1 {
		t.Fatal("provider failure released stock", stock)
	}
}

func TestPostgresBorderpayDoesNotAcknowledgeFailedPersistence(t *testing.T) {
	f, g := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 1)
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if err != nil {
		t.Fatal(err)
	}
	g.setStatus(sale.ID, "paid")
	_, err = f.sql.Exec(ctx, `CREATE FUNCTION reject_test_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test persistence failure'; END $$;
		CREATE TRIGGER reject_test_payment_event BEFORE INSERT ON payment_events FOR EACH ROW EXECUTE FUNCTION reject_test_payment_event()`)
	if err != nil {
		t.Fatal(err)
	}
	body := borderpayBody(sale, "paid", 16000)
	if _, err = f.svc.BorderpayWebhook(ctx, secret, "", "", body); err == nil {
		t.Fatal("failed persistence was acknowledged")
	}
	b, _, err := f.repo.Get(ctx, "sales", sale.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := lib.Decode[model.Sale](b)
	if err != nil || saved.Status != "pending_payment" {
		t.Fatal("sale update escaped rollback", saved, err)
	}
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 1 || stock.ReservedQuantity != 1 {
		t.Fatal("stock update escaped rollback", stock)
	}
	var notifications int
	if err = f.sql.QueryRow(ctx, `SELECT count(*) FROM records WHERE kind='notifications' AND body->>'saleId'=$1`, sale.ID).Scan(&notifications); err != nil || notifications != 0 {
		t.Fatal("notification escaped rollback", notifications, err)
	}
	if _, err = f.sql.Exec(ctx, `DROP TRIGGER reject_test_payment_event ON payment_events`); err != nil {
		t.Fatal(err)
	}
	if out, err := f.svc.BorderpayWebhook(ctx, secret, "", "", body); err != nil || out != "applied" {
		t.Fatal("retry after failed persistence did not recover", out, err)
	}
}

func TestPostgresBorderpayExpiryRequiresOriginalProvider(t *testing.T) {
	f, _ := borderpaySetup(t)
	ctx := context.Background()
	p := f.product(t, 1)
	sale, err := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if err != nil {
		t.Fatal(err)
	}
	now := sale.Payment.ExpiresAt.Add(time.Minute)
	f.svc.Now = func() time.Time { return now }
	f.svc.Payment = adapters.DisabledPayment{}
	requireStatus(t, f.svc.Expire(ctx), 503)
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 1 || stock.ReservedQuantity != 1 {
		t.Fatal("disabling a provider released a potentially payable QR", stock)
	}
}

func TestBorderpayEmbeddedMigrationMatchesVersionedMigration(t *testing.T) {
	embedded, err := os.ReadFile("../repo/payment_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	versioned, err := os.ReadFile("../../migrations/000006_borderpay.up.sql")
	if err != nil || string(embedded) != string(versioned) {
		t.Fatal("embedded and versioned Borderpay migrations differ", err)
	}
}
