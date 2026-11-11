package handler

import (
	"net/http"
	"net/http/httptest"
	"pos/internal/service"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func newTestContext(req *http.Request) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	return c, w
}

func TestStrictJSONBoundary(t *testing.T) {
	for _, s := range []string{`{"name":"a","name":"b"}`, `{"items":[{"quantity":1,"quantity":2}]}`, `{"name":"a"} {"other":1}`, `null`, `[]`, `{bad}`, `{`, `{"name":`, `{"name":"a"`, `{"items":[`, `}`, `""`, `1`} {
		if e := uniqueJSON([]byte(s)); e == nil {
			t.Errorf("accepted %s", s)
		}
	}
	if e := uniqueJSON([]byte(`{"name":"a","items":[{"quantity":1}]}`)); e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest("POST", "/", strings.NewReader(`{"wrong":1}`))
	req.Header.Set("Content-Type", "application/json")
	var value struct {
		Name string `json:"name"`
	}
	c, _ := newTestContext(req)
	if e := decode(c, &value); e == nil {
		t.Fatal("unknown JSON field accepted")
	}
}

func TestLoginLimiterDoesNotBlockSharedProxyAccounts(t *testing.T) {
	l := limiter{}
	for i := 0; i < 15; i++ {
		if !l.Allow("proxy", "attacker@example.test") {
			t.Fatal("early limit")
		}
	}
	if l.Allow("proxy", "attacker@example.test") {
		t.Fatal("missing account-pair limit")
	}
	if !l.Allow("proxy", "cashier@example.test") {
		t.Fatal("shared IP locked unrelated cashier")
	}
}

func TestPaginationValidation(t *testing.T) {
	for _, q := range []string{"page=0", "page=-1", "page=1000001", "limit=101", "limit=0", "page=no"} {
		r := httptest.NewRequest("GET", "/?"+q, nil)
		if _, _, e := pagination(r); e == nil {
			t.Errorf("accepted %s", q)
		}
	}
}

func TestActiveFilterIsRejectedWhereUnsupported(t *testing.T) {
	a := &API{Service: &service.Service{}}
	line := "11111111-1111-4111-8111-111111111111"
	for _, kind := range []string{"products", "services", "customers"} {
		r := httptest.NewRequest("GET", "/?businessLineId="+line+"&active=true", nil)
		c, _ := newTestContext(r)
		f, e := a.filter(c, kind)
		if e != nil || f.Active == nil || !*f.Active {
			t.Errorf("%s: %v %v", kind, f.Active, e)
		}
	}
	for _, kind := range []string{"reconciliation", "notifications", "sales", "queue", "movements"} {
		r := httptest.NewRequest("GET", "/?businessLineId="+line+"&active=true", nil)
		c, _ := newTestContext(r)
		if _, e := a.filter(c, kind); e == nil {
			t.Errorf("%s accepted an unsupported active filter", kind)
		}
		r = httptest.NewRequest("GET", "/?businessLineId="+line, nil)
		c2, _ := newTestContext(r)
		if _, e := a.filter(c2, kind); e != nil {
			t.Errorf("%s: %v", kind, e)
		}
	}
}

func TestReconciliationQueryValidation(t *testing.T) {
	a := &API{Service: &service.Service{}}
	line := "11111111-1111-4111-8111-111111111111"
	for _, q := range []string{"outcome=not-an-outcome", "outcome=paid", "outcome=APPLIED", "status=succeeded", "status=confirmed", "active=true", "limit=101", "search=" + strings.Repeat("x", 101)} {
		r := httptest.NewRequest("GET", "/?businessLineId="+line+"&"+q, nil)
		c, _ := newTestContext(r)
		if _, e := a.filter(c, "reconciliation"); e == nil {
			t.Errorf("accepted %s", q)
		}
	}
	for _, outcome := range []string{"applied", "duplicate_state", "mismatch", "terminal_conflict", "unmatched", "stale", "unresolved"} {
		r := httptest.NewRequest("GET", "/?businessLineId="+line+"&outcome="+outcome, nil)
		c, _ := newTestContext(r)
		f, e := a.filter(c, "reconciliation")
		if e != nil || f.Outcome != outcome {
			t.Errorf("%s: %q %v", outcome, f.Outcome, e)
		}
	}
	for _, search := range []string{"abc", "ABC-123"} {
		r := httptest.NewRequest("GET", "/?businessLineId="+line+"&search="+search, nil)
		c, _ := newTestContext(r)
		f, e := a.filter(c, "reconciliation")
		if e != nil || f.Search != search || f.Status != "" {
			t.Errorf("%s: %+v %v", search, f, e)
		}
	}
}
