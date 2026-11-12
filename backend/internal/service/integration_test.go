package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"pos/internal/adapters"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const kedai = "11111111-1111-4111-8111-111111111111"
const salon = "22222222-2222-4222-8222-222222222222"
const secret = "integration-only-webhook-secret"
const defaultOwnerEmail = "owner@owner.com"
const defaultOwnerPassword = "owner-password-123"

type testPayment struct {
	mu       sync.Mutex
	intents  map[string]model.Intent
	failOnce bool
	Calls    int
	now      func() time.Time
}

func (*testPayment) Name() string { return "mock" }
func (p *testPayment) Verify(b []byte, sig string) error {
	return adapters.NewMock("", "", secret).Verify(b, sig)
}
func (p *testPayment) Create(ctx context.Context, sale model.Sale) (model.Intent, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Calls++
	intent, ok := p.intents[sale.ID]
	if !ok {
		intent = model.Intent{PaymentID: "external-" + sale.ID, MerchantReference: sale.ID, Amount: sale.Total, Currency: "IDR", Status: "pending", QRContent: "MOCK-ONLY-" + sale.ID, ExpiresAt: p.now().Add(23 * time.Hour)}
		p.intents[sale.ID] = intent
	}
	if p.failOnce {
		p.failOnce = false
		return model.Intent{}, errors.New("simulated lost external response")
	}
	return intent, nil
}

type testNotification struct {
	mu           sync.Mutex
	Calls        int
	Fail         bool
	Delivered    map[string]string
	Destinations map[string]string
}

func (*testNotification) Name() string { return "http" }
func (n *testNotification) Send(ctx context.Context, key, dest, message string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.Calls++
	if n.Fail {
		return errors.New("provider down")
	}
	n.Delivered[key] = message
	n.Destinations[key] = dest
	return nil
}

type fixture struct {
	svc          *Service
	repo         *repo.Repo
	sql          *pgxpool.Pool
	owner        model.User
	payment      *testPayment
	notification *testNotification
}

// setup migrates a disposable database with an empty catalog: the one-shot menu seed
// (schema_migrations version 5) is marked applied up front. Use setupWithMenu to run it.
func setup(t *testing.T) *fixture {
	t.Helper()
	return setupDB(t, false)
}

func setupWithMenu(t *testing.T) *fixture {
	t.Helper()
	return setupDB(t, true)
}

func setupDB(t *testing.T, seedMenu bool) *fixture {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to a PostgreSQL database-creation account for isolated integration tests")
	}
	ctx := context.Background()
	admin, e := pgx.Connect(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	name := fmt.Sprintf("lia_pos_it_%d_%d", os.Getpid(), time.Now().UnixNano())
	if _, e = admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); e != nil {
		admin.Close(ctx)
		t.Fatal(e)
	}
	dsn, e := isolatedDSN(url, name)
	if e != nil {
		t.Fatal(e)
	}
	r, e := repo.Open(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	pool, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		pool.Close()
		r.Close()
		if _, e := admin.Exec(context.Background(), "DROP DATABASE "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)"); e != nil {
			t.Error(e)
		}
		admin.Close(context.Background())
	})
	var actual string
	if e = pool.QueryRow(ctx, "SELECT current_database()").Scan(&actual); e != nil || actual != name || actual == "postgres" || strings.HasPrefix(actual, "template") {
		t.Fatalf("REFUSING migration: expected disposable %s, got %s (%v)", name, actual, e)
	}
	if !seedMenu {
		if _, e = pool.Exec(ctx, "CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(version) VALUES(5)"); e != nil {
			t.Fatal(e)
		}
	}
	if e = r.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = r.Migrate(ctx); e != nil {
		t.Fatal("migrations not replay-safe", e)
	}
	zone, _ := time.LoadLocation("Asia/Jakarta")
	p := &testPayment{intents: map[string]model.Intent{}, now: func() time.Time { return time.Now().UTC() }}
	n := &testNotification{Delivered: map[string]string{}, Destinations: map[string]string{}}
	s := New(r, p, n, 30*time.Minute, zone, "+6281234567890", lib.DefaultNotificationTemplate)
	owner, e := r.UserByEmail(ctx, defaultOwnerEmail)
	if e != nil {
		t.Fatal("default owner missing after migration", e)
	}
	return &fixture{s, r, pool, owner, p, n}
}

func isolatedDSN(base, name string) (string, error) {
	if !strings.HasPrefix(name, "lia_pos_it_") || name == "postgres" || strings.ContainsAny(name, " /\"'") {
		return "", fmt.Errorf("refusing non-disposable database")
	}
	u, e := url.Parse(base)
	if e != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		return "", fmt.Errorf("TEST_DATABASE_URL must be a postgres URL")
	}
	u.Path = "/" + name
	return u.String(), nil
}

func TestIsolatedDSNGuard(t *testing.T) {
	dsn, e := isolatedDSN("postgres:///postgres?host=/tmp&sslmode=disable", "lia_pos_it_123_456")
	if e != nil {
		t.Fatal(e)
	}
	cfg, e := pgx.ParseConfig(dsn)
	if e != nil || cfg.Database != "lia_pos_it_123_456" {
		t.Fatal(cfg, e)
	}
	for _, name := range []string{"postgres", "template1", "existing", "lia_pos_it_bad/name"} {
		if _, e = isolatedDSN("postgres:///postgres", name); e == nil {
			t.Fatal("unsafe database accepted", name)
		}
	}
}

func rawMap(v any) map[string]json.RawMessage {
	b, _ := json.Marshal(v)
	var m map[string]json.RawMessage
	json.Unmarshal(b, &m)
	return m
}

func (f *fixture) product(t *testing.T, stock int64) model.Product {
	t.Helper()
	ctx := context.Background()
	b, e := f.svc.CatalogSave(ctx, f.owner, "products", kedai, "", rawMap(map[string]any{"sku": lib.ID(), "name": "Coffee", "unit": "cup", "price": 15000, "stockTracked": true}), false)
	if e != nil {
		t.Fatal(e)
	}
	p, e := lib.Decode[model.Product](b)
	if e != nil {
		t.Fatal(e)
	}
	if stock > 0 {
		if _, e = f.svc.Adjust(ctx, f.owner, kedai, MovementInput{ProductID: p.ID, Type: "receive", QuantityDelta: stock, Reason: "Integration fixture"}); e != nil {
			t.Fatal(e)
		}
	}
	return p
}

func (f *fixture) service(t *testing.T) model.Service {
	t.Helper()
	b, e := f.svc.CatalogSave(context.Background(), f.owner, "services", salon, "", rawMap(map[string]any{"name": "Haircut", "price": 50000}), false)
	if e != nil {
		t.Fatal(e)
	}
	p, _ := lib.Decode[model.Service](b)
	return p
}

func input(p model.Product, method string, qty int) dto.SaleInput {
	v := dto.SaleInput{Items: []dto.ItemInput{{ItemType: "product", ItemID: p.ID, Quantity: qty}}, PaymentMethod: method}
	if method == "cash" {
		cash := p.Price * int64(qty)
		v.CashReceived = &cash
	}
	return v
}

func eventFor(sale model.Sale, status string, at time.Time) dto.Event {
	return dto.Event{EventID: lib.ID(), PaymentID: "external-" + sale.ID, MerchantReference: sale.ID, Amount: sale.Total, Currency: "IDR", Status: status, OccurredAt: at}
}

func webhook(f *fixture, event dto.Event) (string, error) {
	b, _ := json.Marshal(event)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(b)
	return f.svc.Webhook(context.Background(), "mock", event.EventID, hex.EncodeToString(mac.Sum(nil)), b)
}

func requireStatus(t *testing.T, e error, status int) {
	t.Helper()
	var de *lib.Error
	if !errors.As(e, &de) || de.Status != status {
		t.Fatalf("want status %d got %v", status, e)
	}
}

func TestPostgresCashAtomicConcurrencyAndSnapshots(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 5)
	var paid atomic.Int64
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1))
			if e == nil {
				paid.Add(1)
			} else {
				var de *lib.Error
				if !errors.As(e, &de) || de.Status != 409 {
					errs <- e
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
	if paid.Load() != 5 {
		t.Fatalf("sold %d of 5", paid.Load())
	}
	stock, e := f.repo.Stock(ctx, p.ID, false)
	if e != nil || stock.Quantity != 0 || stock.ReservedQuantity != 0 {
		t.Fatal(stock, e)
	}
	var sum, count int64
	if e = f.sql.QueryRow(ctx, `SELECT sum((body->>'quantityDelta')::bigint),count(*) FROM records WHERE kind='movements' AND body->>'productId'=$1`, p.ID).Scan(&sum, &count); e != nil || sum != 0 || count != 6 {
		t.Fatal(sum, count, e)
	}
	_, e = f.svc.Adjust(ctx, f.owner, kedai, MovementInput{ProductID: p.ID, Type: "receive", QuantityDelta: 10, Reason: "Refill"})
	if e != nil {
		t.Fatal(e)
	}
	key := lib.ID()
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "cash", 2))
	if e != nil {
		t.Fatal(e)
	}
	again, e := f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "cash", 2))
	if e != nil || again.ID != sale.ID {
		t.Fatal(again, e)
	}
	_, e = f.svc.CreateSale(ctx, f.owner, kedai, key, input(p, "cash", 1))
	requireStatus(t, e, 409)
	if _, e = f.svc.CatalogSave(ctx, f.owner, "products", "", p.ID, rawMap(map[string]any{"name": "Renamed", "price": 20000, "active": false}), false); e != nil {
		t.Fatal(e)
	}
	saved, e := f.svc.Sale(ctx, f.owner, sale.ID)
	if e != nil || saved.Total != 30000 || saved.Items[0].DisplayName != "Coffee" {
		t.Fatal(saved, e)
	}
	before, _ := f.repo.Stock(ctx, p.ID, false)
	_, e = f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1))
	requireStatus(t, e, 409)
	after, _ := f.repo.Stock(ctx, p.ID, false)
	if before.Quantity != after.Quantity {
		t.Fatal("failed checkout changed stock")
	}
	date := f.svc.Now().In(f.svc.Zone).Format("2006-01-02")
	report, e := f.svc.SalesReport(ctx, f.owner, kedai, date, date, "item")
	if e != nil || report.TotalSales != 105000 || report.TransactionCount != 6 || len(report.Groups) != 1 || report.Groups[0].Key != p.ID || report.Groups[0].Count != 6 {
		t.Fatal(report, e)
	}
	csv, e := f.svc.SalesCSV(ctx, f.owner, kedai, date, date)
	if e != nil || !strings.HasPrefix(string(csv), "saleId,businessLineId,createdAt,paymentMethod,total\n") || len(strings.Split(strings.TrimSpace(string(csv)), "\n")) != 7 {
		t.Fatal(string(csv), e)
	}
}

func TestPostgresQRWebhookReservationsAndReplay(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 3)
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 2))
	if e != nil {
		t.Fatal(e)
	}
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 3 || stock.ReservedQuantity != 2 {
		t.Fatal(stock)
	}
	_, e = f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 2))
	requireStatus(t, e, 409)
	mismatch := eventFor(sale, "succeeded", f.svc.Now())
	mismatch.Amount++
	_, e = webhook(f, mismatch)
	requireStatus(t, e, 409)
	b, _ := json.Marshal(eventFor(sale, "succeeded", f.svc.Now()))
	_, e = f.svc.Webhook(ctx, "mock", "wrong", "bad-signature", b)
	requireStatus(t, e, 401)
	event := eventFor(sale, "succeeded", f.svc.Now())
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, e := webhook(f, event); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	saved, e := f.svc.Sale(ctx, f.owner, sale.ID)
	if e != nil || saved.Status != "paid" {
		t.Fatal(saved, e)
	}
	stock, _ = f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 1 || stock.ReservedQuantity != 0 {
		t.Fatal(stock)
	}
	event.Amount++
	_, e = webhook(f, event)
	requireStatus(t, e, 409)
	var movements, notifications int
	f.sql.QueryRow(ctx, `SELECT count(*) FROM records WHERE kind='movements' AND body->>'saleId'=$1`, sale.ID).Scan(&movements)
	f.sql.QueryRow(ctx, `SELECT count(*) FROM records WHERE kind='notifications' AND body->>'saleId'=$1`, sale.ID).Scan(&notifications)
	if movements != 1 || notifications != 1 {
		t.Fatal(movements, notifications)
	}
	failed, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = webhook(f, eventFor(failed, "failed", f.svc.Now())); e != nil {
		t.Fatal(e)
	}
	if _, e = webhook(f, eventFor(failed, "succeeded", f.svc.Now())); e == nil {
		t.Fatal("late success reopened failed")
	}
	stock, _ = f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 1 || stock.ReservedQuantity != 0 {
		t.Fatal(stock)
	}
}

func TestPostgresLostIntentRecoveryAndStaleEvidence(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 1)
	f.payment.failOnce = true
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	requireStatus(t, e, 502)
	if sale.Payment.ExpiresAt != nil || sale.Payment.GatewayReference != nil {
		t.Fatal("unknown intent received invented expiry", sale.Payment)
	}
	ev := eventFor(sale, "succeeded", f.svc.Now())
	outcome, e := webhook(f, ev)
	if e != nil || outcome != "unresolved" {
		t.Fatal(outcome, e)
	}
	base := f.svc.Now()
	f.svc.Now = func() time.Time { return base.Add(time.Hour) }
	if e = f.svc.Expire(ctx); e != nil {
		t.Fatal(e)
	}
	stock, _ := f.repo.Stock(ctx, p.ID, false)
	if stock.ReservedQuantity != 1 {
		t.Fatal("live external intent reservation released", stock)
	}
	if e = f.svc.RecoverIntents(ctx); e != nil {
		t.Fatal(e)
	}
	saved, e := f.svc.Sale(ctx, f.owner, sale.ID)
	if e != nil || saved.Status != "paid" {
		t.Fatal(saved, e)
	}
	stock, _ = f.repo.Stock(ctx, p.ID, false)
	if stock.Quantity != 0 || stock.ReservedQuantity != 0 {
		t.Fatal(stock)
	}
	outcome, e = webhook(f, ev)
	if e != nil || outcome != "duplicate" {
		t.Fatal(outcome, e)
	}
	stale := eventFor(saved, "failed", f.svc.Now().Add(-48*time.Hour))
	outcome, e = webhook(f, stale)
	requireStatus(t, e, 409)
	if outcome != "stale" {
		t.Fatal(outcome)
	}
	var recorded string
	if e = f.sql.QueryRow(ctx, "SELECT body->>'outcome' FROM payment_events WHERE event_id=$1", stale.EventID).Scan(&recorded); e != nil || recorded != "stale" {
		t.Fatal(recorded, e)
	}
}

func TestPostgresQueueConcurrentLifecycleAndScoping(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	svc := f.service(t)
	numbers := make(chan int, 20)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			q, e := f.svc.CreateQueue(ctx, f.owner, salon, lib.ID(), dto.QueueInput{ServiceIDs: []string{svc.ID}})
			if e != nil {
				t.Error(e)
				return
			}
			numbers <- q.QueueNumber
		}()
	}
	wg.Wait()
	close(numbers)
	seen := map[int]bool{}
	for n := range numbers {
		if seen[n] {
			t.Fatal("duplicate daily number", n)
		}
		seen[n] = true
	}
	if len(seen) != 20 {
		t.Fatal(len(seen))
	}
	key := lib.ID()
	q, e := f.svc.CreateQueue(ctx, f.owner, salon, key, dto.QueueInput{ServiceIDs: []string{svc.ID}})
	if e != nil {
		t.Fatal(e)
	}
	again, e := f.svc.CreateQueue(ctx, f.owner, salon, key, dto.QueueInput{ServiceIDs: []string{svc.ID}})
	if e != nil || again.ID != q.ID {
		t.Fatal(again, e)
	}
	_, e = f.svc.PatchQueue(ctx, f.owner, q.ID, rawMap(map[string]any{"status": "completed"}))
	requireStatus(t, e, 409)
	if _, e = f.svc.PatchQueue(ctx, f.owner, q.ID, rawMap(map[string]any{"status": "in_service"})); e != nil {
		t.Fatal(e)
	}
	cash := int64(50000)
	sale, e := f.svc.CreateSale(ctx, f.owner, salon, lib.ID(), dto.SaleInput{Items: []dto.ItemInput{{ItemType: "service", ItemID: svc.ID, Quantity: 1}}, PaymentMethod: "cash", CashReceived: &cash})
	if e != nil {
		t.Fatal(e)
	}
	q, e = f.svc.PatchQueue(ctx, f.owner, q.ID, rawMap(map[string]any{"status": "completed", "saleId": sale.ID}))
	if e != nil || q.SaleID == nil {
		t.Fatal(q, e)
	}
	u := f.owner
	u.BusinessLines = u.BusinessLines[:1]
	_, e = f.svc.Sale(ctx, u, sale.ID)
	requireStatus(t, e, 403)
	if _, e = f.svc.CatalogSave(ctx, f.owner, "services", kedai, "", rawMap(map[string]any{"name": "Wrong", "price": 1}), false); e == nil {
		t.Fatal("wrong line type")
	}
}

func TestPostgresRevocableSessionsAndDemotedOwnerRace(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	session, e := f.svc.Login(ctx, f.owner.Email, defaultOwnerPassword)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.svc.Authenticate(ctx, session.AccessToken); e != nil {
		t.Fatal(e)
	}
	if e = f.svc.Logout(ctx, session.AccessToken); e != nil {
		t.Fatal(e)
	}
	_, e = f.svc.Authenticate(ctx, session.AccessToken)
	requireStatus(t, e, 401)
	_, e = f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Other owner", "email": "second@example.test", "password": "Other-Owner-Password!", "role": "owner", "businessLineIds": []string{kedai, salon}}), false)
	if e != nil {
		t.Fatal(e)
	}
	locked := make(chan struct{})
	release := make(chan struct{})
	demotion := make(chan error, 1)
	go func() {
		demotion <- f.repo.WithinTx(ctx, func(r *repo.Repo) error {
			if e := r.Lock(ctx, "users"); e != nil {
				return e
			}
			actor := f.owner
			actor.Role = "admin"
			if e := r.SaveUser(ctx, actor, false); e != nil {
				return e
			}
			close(locked)
			<-release
			return nil
		})
	}()
	<-locked
	queued := make(chan error, 1)
	go func() {
		_, e := f.svc.UserSave(ctx, f.owner, f.owner.ID, rawMap(map[string]any{"role": "owner"}), false)
		queued <- e
	}()
	close(release)
	if e = <-demotion; e != nil {
		t.Fatal(e)
	}
	requireStatus(t, <-queued, 403)
	fresh, e := f.repo.User(ctx, f.owner.ID)
	if e != nil || fresh.Role != "admin" {
		t.Fatal(fresh, e)
	}
}

func TestPostgresDatabaseInvariantGuards(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 2)
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1))
	if e != nil {
		t.Fatal(e)
	}
	mustReject := func(query string, args ...any) {
		t.Helper()
		if _, e := f.sql.Exec(ctx, query, args...); e == nil {
			t.Fatalf("DB accepted invariant violation: %s", query)
		}
	}
	mustReject(`UPDATE records SET body=body-'price' WHERE id=$1`, p.ID)
	mustReject(`UPDATE records SET body=jsonb_set(body,'{active}','null') WHERE id=$1`, p.ID)
	mustReject(`UPDATE records SET body=body-'currency' WHERE id=$1`, sale.Payment.ID)
	mustReject(`UPDATE records SET body=jsonb_set(body,'{payment,amount}','1') WHERE id=$1`, sale.ID)
	mustReject(`UPDATE records SET body=jsonb_set(body,'{total}','1') WHERE id=$1`, sale.ID)
	mustReject(`UPDATE records SET body=jsonb_set(body,'{amount}','1') WHERE id=$1`, sale.Payment.ID)
	mustReject(`UPDATE records SET body=jsonb_set(body,'{reason}','"tampered"') WHERE kind='movements'`)
	mustReject(`DELETE FROM records WHERE kind='movements'`)
	mustReject(`UPDATE sale_items SET quantity=2 WHERE sale_id=$1`, sale.ID)
	mustReject(`DELETE FROM sale_items WHERE sale_id=$1`, sale.ID)
	wrong := lib.ID()
	person := model.Person{ID: wrong, BusinessLineID: salon, Name: "Wrong line customer", Active: true, CreatedAt: f.svc.Now(), UpdatedAt: f.svc.Now()}
	if e = f.repo.Put(ctx, "customers", wrong, salon, person, true); e != nil {
		t.Fatal(e)
	}
	mustReject(`UPDATE records SET body=jsonb_set(body,'{customerId}',to_jsonb($2::text)) WHERE id=$1`, sale.ID, wrong)
	bad := lib.ID()
	mustReject(`INSERT INTO records(id,kind,line_id,body) VALUES($1,'products',$2,jsonb_build_object('id',$1::text,'businessLineId',$2::text,'createdAt',now()::text,'name','bad'))`, bad, kedai)
	if e = f.repo.Ping(ctx); e != nil {
		t.Fatal(e)
	}
}

func TestPostgresOutboxClaimsRetryAndStablePayload(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 20)
	for i := 0; i < 12; i++ {
		if _, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1)); e != nil {
			t.Fatal(e)
		}
	}
	var wg sync.WaitGroup
	jobs := make(chan []model.Delivery, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			claimed, e := f.repo.ClaimDeliveries(ctx, 8, f.svc.Now())
			if e != nil {
				t.Error(e)
			}
			jobs <- claimed
		}()
	}
	wg.Wait()
	close(jobs)
	seen := map[string]bool{}
	all := []model.Delivery{}
	for batch := range jobs {
		for _, job := range batch {
			if seen[job.ID] {
				t.Fatal("double worker claim")
			}
			seen[job.ID] = true
			all = append(all, job)
		}
	}
	if len(all) != 12 {
		t.Fatal(len(all))
	}
	job := all[0]
	oldToken := job.ClaimToken
	job.ClaimToken = lib.ID()
	if e := f.repo.FinishDelivery(ctx, job, true, false, "", f.svc.Now()); e != nil {
		t.Fatal(e)
	}
	var state string
	f.sql.QueryRow(ctx, "SELECT status FROM outbox_jobs WHERE notification_id=$1", job.ID).Scan(&state)
	if state != "queued" {
		t.Fatal("stale worker finished job")
	}
	job.ClaimToken = oldToken
	if e := f.repo.FinishDelivery(ctx, job, false, false, "PROVIDER_DELIVERY_FAILED", f.svc.Now()); e != nil {
		t.Fatal(e)
	}
	f.svc.Destination = "+6289999999999"
	if e := f.svc.Deliver(ctx); e != nil {
		t.Fatal(e)
	}
	f.notification.mu.Lock()
	destination := f.notification.Destinations[job.ID]
	f.notification.mu.Unlock()
	if destination != "+6281234567890" {
		t.Fatal("retry destination mutated", destination)
	}
	if _, e := f.sql.Exec(ctx, "UPDATE outbox_jobs SET destination='changed' WHERE notification_id=$1", job.ID); e == nil {
		t.Fatal("mutable outbox payload")
	}
	f.svc.Notification = adapters.DisabledNotification{}
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1))
	if e != nil {
		t.Fatal(e)
	}
	var status string
	f.sql.QueryRow(ctx, "SELECT body->>'status' FROM records WHERE kind='notifications' AND body->>'saleId'=$1", sale.ID).Scan(&status)
	if status != "failed" {
		t.Fatal("disabled success", status)
	}
}

func TestPostgresNotificationTemplateAndRetryMetadata(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	f.svc.Template = "Lia POS {{businessLineId}}: sale {{saleId}} collected IDR {{total}}."
	p := f.product(t, 5)
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 2))
	if e != nil {
		t.Fatal(e)
	}
	want := fmt.Sprintf("Lia POS %s: sale %s collected IDR %d.", kedai, sale.ID, sale.Total)
	var notificationID, stored, destination string
	if e = f.sql.QueryRow(ctx, `SELECT id::text FROM records WHERE kind='notifications' AND body->>'saleId'=$1`, sale.ID).Scan(&notificationID); e != nil {
		t.Fatal(e)
	}
	if e = f.sql.QueryRow(ctx, `SELECT message,destination FROM outbox_jobs WHERE notification_id=$1`, notificationID).Scan(&stored, &destination); e != nil {
		t.Fatal(e)
	}
	if stored != want {
		t.Fatalf("outbox message %q, want %q", stored, want)
	}
	if destination != "+6281234567890" {
		t.Fatal(destination)
	}
	if e = f.svc.Deliver(ctx); e != nil {
		t.Fatal(e)
	}
	f.notification.mu.Lock()
	delivered := f.notification.Delivered[notificationID]
	f.notification.mu.Unlock()
	if delivered != want {
		t.Fatalf("delivered %q, want %q", delivered, want)
	}

	failing, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1))
	if e != nil {
		t.Fatal(e)
	}
	var failingID string
	if e = f.sql.QueryRow(ctx, `SELECT id::text FROM records WHERE kind='notifications' AND body->>'saleId'=$1`, failing.ID).Scan(&failingID); e != nil {
		t.Fatal(e)
	}
	original := fmt.Sprintf("Lia POS %s: sale %s collected IDR %d.", kedai, failing.ID, failing.Total)
	f.notification.Fail = true
	for i := 0; i < 5; i++ {
		base := f.svc.Now()
		f.svc.Now = func() time.Time { return base.Add(time.Hour) }
		if e = f.svc.Deliver(ctx); e != nil {
			t.Fatal(e)
		}
	}
	var status string
	if e = f.sql.QueryRow(ctx, `SELECT status FROM outbox_jobs WHERE notification_id=$1`, failingID).Scan(&status); e != nil || status != "failed" {
		t.Fatal(status, e)
	}
	f.notification.Fail = false
	f.svc.Template = "Completely different {{saleId}}"
	if e = f.svc.RetryNotification(ctx, f.owner, failingID); e != nil {
		t.Fatal(e)
	}
	if e = f.sql.QueryRow(ctx, `SELECT message FROM outbox_jobs WHERE notification_id=$1`, failingID).Scan(&stored); e != nil {
		t.Fatal(e)
	}
	if stored != original {
		t.Fatalf("retry rewrote payload: %q, want %q", stored, original)
	}

	f.svc.Notification = adapters.DisabledNotification{}
	f.svc.Destination = ""
	disabled, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 1))
	if e != nil {
		t.Fatal(e)
	}
	var disabledID string
	var masked *string
	if e = f.sql.QueryRow(ctx, `SELECT id::text,body->>'destinationMasked' FROM records WHERE kind='notifications' AND body->>'saleId'=$1`, disabled.ID).Scan(&disabledID, &masked); e != nil {
		t.Fatal(e)
	}
	if masked != nil {
		t.Fatal("disabled notification claimed a destination", *masked)
	}
	var jobs int
	f.sql.QueryRow(ctx, `SELECT count(*) FROM outbox_jobs WHERE notification_id=$1`, disabledID).Scan(&jobs)
	if jobs != 0 {
		t.Fatal("disabled notification queued a job")
	}
	if e = f.svc.RetryNotification(ctx, f.owner, disabledID); e == nil {
		t.Fatal("retry succeeded while the provider was disabled")
	}
	f.svc.Notification = f.notification
	f.svc.Destination = "+6287777777777"
	f.svc.Template = lib.DefaultNotificationTemplate
	if e = f.svc.RetryNotification(ctx, f.owner, disabledID); e != nil {
		t.Fatal(e)
	}
	if e = f.sql.QueryRow(ctx, `SELECT body->>'destinationMasked' FROM records WHERE kind='notifications' AND id=$1`, disabledID).Scan(&masked); e != nil {
		t.Fatal(e)
	}
	if masked == nil || *masked != "***7777" {
		t.Fatal("retry metadata does not describe the queued destination", masked)
	}
	if e = f.sql.QueryRow(ctx, `SELECT message,destination FROM outbox_jobs WHERE notification_id=$1`, disabledID).Scan(&stored, &destination); e != nil {
		t.Fatal(e)
	}
	if destination != "+6287777777777" || stored != fmt.Sprintf("Payment confirmed. Sale %s, IDR %d.", disabled.ID, disabled.Total) {
		t.Fatal(destination, stored)
	}
}

func TestPostgresWebhookProviderMetadata(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 5)
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if e != nil {
		t.Fatal(e)
	}
	foreign := eventFor(sale, "succeeded", f.svc.Now())
	foreign.Provider = "some-other-gateway"
	if _, e = webhook(f, foreign); e == nil {
		t.Fatal("event from a foreign provider accepted")
	}
	requireStatus(t, e, 400)
	saved, e := f.svc.Sale(ctx, f.owner, sale.ID)
	if e != nil || saved.Payment.Status != "pending" {
		t.Fatal(saved.Payment.Status, e)
	}
	var events int
	f.sql.QueryRow(ctx, `SELECT count(*) FROM payment_events WHERE event_id=$1`, foreign.EventID).Scan(&events)
	if events != 0 {
		t.Fatal("rejected event was persisted")
	}
	event := eventFor(sale, "succeeded", f.svc.Now())
	event.Provider = "mock"
	outcome, e := webhook(f, event)
	if e != nil || outcome != "applied" {
		t.Fatal(outcome, e)
	}
	if saved, e = f.svc.Sale(ctx, f.owner, sale.ID); e != nil || saved.Status != "paid" {
		t.Fatal(saved, e)
	}
	if outcome, e = webhook(f, event); e != nil || outcome != "duplicate" {
		t.Fatal(outcome, e)
	}
	other, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if e != nil {
		t.Fatal(e)
	}
	plain := eventFor(other, "succeeded", f.svc.Now())
	if plain.Provider != "" {
		t.Fatal("fixture unexpectedly set provider")
	}
	if outcome, e = webhook(f, plain); e != nil || outcome != "applied" {
		t.Fatal(outcome, e)
	}
}

func TestPostgresReconciliationSearchAndOutcomeFilter(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	p := f.product(t, 10)
	applied, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if e != nil {
		t.Fatal(e)
	}
	appliedEvent := eventFor(applied, "succeeded", f.svc.Now())
	if outcome, e := webhook(f, appliedEvent); e != nil || outcome != "applied" {
		t.Fatal(outcome, e)
	}
	mismatched, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "qris", 1))
	if e != nil {
		t.Fatal(e)
	}
	mismatchEvent := eventFor(mismatched, "failed", f.svc.Now())
	mismatchEvent.Amount++
	if _, e = webhook(f, mismatchEvent); e == nil {
		t.Fatal("amount mismatch confirmed")
	}
	unmatched := dto.Event{EventID: lib.ID(), PaymentID: "external-orphan", MerchantReference: lib.ID(), Amount: 15000, Currency: "IDR", Status: "succeeded", OccurredAt: f.svc.Now()}
	if _, e = webhook(f, unmatched); e == nil {
		t.Fatal("unmatched event accepted")
	}

	list := func(u model.User, filter dto.Filter) dto.Page {
		t.Helper()
		filter.Kind = "reconciliation"
		filter.LineID = kedai
		filter.Page, filter.Limit = 1, 20
		page, e := f.svc.List(ctx, u, filter)
		if e != nil {
			t.Fatal(e)
		}
		return page
	}
	ids := func(page dto.Page) []string {
		out := []string{}
		for _, b := range page.Data {
			v, e := lib.Decode[model.Reconciliation](b)
			if e != nil {
				t.Fatal(e)
			}
			out = append(out, v.EventID)
		}
		return out
	}
	all := list(f.owner, dto.Filter{})
	if all.Pagination.Total != 3 || len(all.Data) != 3 {
		t.Fatal("owner should see matched and unmatched events", all.Pagination)
	}
	for _, tt := range []struct {
		filter dto.Filter
		want   []string
	}{
		{dto.Filter{Outcome: "applied"}, []string{appliedEvent.EventID}},
		{dto.Filter{Outcome: "mismatch"}, []string{mismatchEvent.EventID}},
		{dto.Filter{Outcome: "unmatched"}, []string{unmatched.EventID}},
		{dto.Filter{Outcome: "stale"}, []string{}},
		{dto.Filter{Status: "succeeded"}, []string{unmatched.EventID, appliedEvent.EventID}},
		{dto.Filter{Status: "failed"}, []string{mismatchEvent.EventID}},
		{dto.Filter{Search: appliedEvent.EventID}, []string{appliedEvent.EventID}},
		{dto.Filter{Search: strings.ToUpper(appliedEvent.EventID)}, []string{appliedEvent.EventID}},
		{dto.Filter{Search: applied.ID}, []string{appliedEvent.EventID}},
		{dto.Filter{Search: "external-" + applied.ID}, []string{appliedEvent.EventID}},
		{dto.Filter{Search: "EXTERNAL-ORPHAN"}, []string{unmatched.EventID}},
		{dto.Filter{Search: "no-such-reference"}, []string{}},
		{dto.Filter{Outcome: "applied", Search: mismatched.ID}, []string{}},
	} {
		page := list(f.owner, tt.filter)
		got := ids(page)
		if page.Pagination.Total != len(tt.want) {
			t.Errorf("%+v: total %d, want %d", tt.filter, page.Pagination.Total, len(tt.want))
		}
		if len(got) != len(tt.want) {
			t.Errorf("%+v: got %v, want %v", tt.filter, got, tt.want)
			continue
		}
		seen := map[string]bool{}
		for _, v := range got {
			seen[v] = true
		}
		for _, v := range tt.want {
			if !seen[v] {
				t.Errorf("%+v: missing %s in %v", tt.filter, v, got)
			}
		}
	}

	page := list(f.owner, dto.Filter{})
	page.Pagination.Limit = 2
	paged, e := f.svc.List(ctx, f.owner, dto.Filter{Kind: "reconciliation", LineID: kedai, Page: 1, Limit: 2, Status: "succeeded"})
	if e != nil || paged.Pagination.Total != 2 || paged.Pagination.TotalPages != 1 || len(paged.Data) != 2 {
		t.Fatal(paged.Pagination, e)
	}

	admin, e := f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Line admin", "email": "admin@example.test", "password": "Integration-Only-Password!", "role": "admin", "businessLineIds": []string{kedai}}), false)
	if e != nil {
		t.Fatal(e)
	}
	scoped := list(admin, dto.Filter{})
	if scoped.Pagination.Total != 2 {
		t.Fatal("admin reconciliation scope", scoped.Pagination)
	}
	for _, id := range ids(scoped) {
		if id == unmatched.EventID {
			t.Fatal("admin saw an unmatched event")
		}
	}
	cashier, e := f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Line cashier", "email": "cashier@example.test", "password": "Integration-Only-Password!", "role": "cashier", "businessLineIds": []string{kedai}}), false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.svc.List(ctx, cashier, dto.Filter{Kind: "reconciliation", LineID: kedai, Page: 1, Limit: 20}); e == nil {
		t.Fatal("cashier read the reconciliation view")
	}
	requireStatus(t, e, 403)
}

func TestPostgresAdminVoidSaleAndStockReversal(t *testing.T) {
	ctx := context.Background()
	f := setup(t)

	bp, e := f.svc.CatalogSave(ctx, f.owner, "products", kedai, "", rawMap(map[string]any{
		"sku":          "VOID-COFFEE-" + lib.ID()[:8],
		"name":         "Voidable Coffee",
		"unit":         "cup",
		"price":        15000,
		"stockTracked": true,
	}), false)
	if e != nil {
		t.Fatal(e)
	}
	p, _ := lib.Decode[model.Product](bp)

	if _, e = f.svc.Adjust(ctx, f.owner, kedai, MovementInput{ProductID: p.ID, Type: "receive", QuantityDelta: 5, Reason: "Initial batch"}); e != nil {
		t.Fatal(e)
	}

	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 2))
	if e != nil || sale.Status != "paid" {
		t.Fatalf("failed to create paid sale: %v", e)
	}

	st, e := f.svc.Inventory(ctx, f.owner, kedai, false)
	if e != nil || len(st) == 0 {
		t.Fatal(e)
	}
	var currentStock int64
	for _, s := range st {
		if s.ProductID == p.ID {
			currentStock = s.Quantity
		}
	}
	if currentStock != 3 {
		t.Fatalf("expected stock 3 after sale, got %d", currentStock)
	}

	cashier, e := f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Void Cashier", "email": "void_cashier@example.test", "password": "Integration-Only-Password!", "role": "cashier", "businessLineIds": []string{kedai}}), false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.svc.VoidSale(ctx, cashier, sale.ID, "Cashier attempt"); e == nil {
		t.Fatal("expected cashier void attempt to fail with forbidden")
	}
	requireStatus(t, e, 403)

	admin, e := f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Void Admin", "email": "void_admin@example.test", "password": "Integration-Only-Password!", "role": "admin", "businessLineIds": []string{kedai}}), false)
	if e != nil {
		t.Fatal(e)
	}

	voided, e := f.svc.VoidSale(ctx, admin, sale.ID, "Customer cancel request")
	if e != nil {
		t.Fatalf("admin void failed: %v", e)
	}
	if voided.Status != "voided" || voided.Payment.Status != "voided" {
		t.Fatalf("expected voided status, got sale=%s payment=%s", voided.Status, voided.Payment.Status)
	}

	st, e = f.svc.Inventory(ctx, f.owner, kedai, false)
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range st {
		if s.ProductID == p.ID {
			currentStock = s.Quantity
		}
	}
	if currentStock != 5 {
		t.Fatalf("expected stock restored to 5, got %d", currentStock)
	}

	if _, e = f.svc.VoidSale(ctx, admin, sale.ID, "Double void"); e == nil {
		t.Fatal("expected double void to fail")
	}
	requireStatus(t, e, 409)
}

func TestPostgresDefaultOwnerAddsCashiers(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	users, e := f.repo.Users(ctx)
	if e != nil || len(users) != 1 {
		t.Fatal("fresh database must contain only the default owner", users, e)
	}
	if u := users[0]; u.Email != defaultOwnerEmail || u.Role != "owner" || !u.Active || len(u.BusinessLines) != 2 {
		t.Fatalf("unexpected default owner %+v", u)
	}
	if _, e = f.svc.Login(ctx, defaultOwnerEmail, defaultOwnerPassword); e != nil {
		t.Fatal(e)
	}
	cashier, e := f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Kedai cashier", "email": "kedai_cashier@example.test", "password": "Cashier-Password-123", "role": "cashier", "businessLineIds": []string{kedai}}), false)
	if e != nil || cashier.Role != "cashier" || len(cashier.BusinessLines) != 1 {
		t.Fatal(cashier, e)
	}
	if _, e = f.svc.Login(ctx, "kedai_cashier@example.test", "Cashier-Password-123"); e != nil {
		t.Fatal(e)
	}
	_, e = f.svc.UserSave(ctx, cashier, "", rawMap(map[string]any{"name": "Other cashier", "email": "other_cashier@example.test", "password": "Cashier-Password-123", "role": "cashier", "businessLineIds": []string{kedai}}), false)
	requireStatus(t, e, 403)
	_, e = f.svc.Users(ctx, cashier, 1, 20, "")
	requireStatus(t, e, 403)
	if _, e = f.svc.UserSave(ctx, f.owner, f.owner.ID, rawMap(map[string]any{"email": "renamed_owner@example.test"}), false); e != nil {
		t.Fatal(e)
	}
	if e = f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = f.repo.UserByEmail(ctx, defaultOwnerEmail); !lib.IsNotFound(e) {
		t.Fatal("re-running migrations recreated the default owner", e)
	}
	if users, e = f.repo.Users(ctx); e != nil || len(users) != 2 {
		t.Fatal(users, e)
	}
}

func TestPostgresUsersRequireExistingOwner(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	for _, stmt := range []string{"DELETE FROM user_lines", "DELETE FROM users"} {
		if _, e := f.sql.Exec(ctx, stmt); e != nil {
			t.Fatal(e)
		}
	}
	_, e := f.svc.UserSave(ctx, model.User{Role: "owner"}, "", rawMap(map[string]any{"name": "Anonymous", "email": "anonymous@example.test", "password": "Anonymous-Password-123", "role": "owner", "businessLineIds": []string{kedai}}), false)
	requireStatus(t, e, 403)
	if e = f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = f.svc.Login(ctx, defaultOwnerEmail, defaultOwnerPassword); e != nil {
		t.Fatal("empty users table must get the default owner back", e)
	}
}
