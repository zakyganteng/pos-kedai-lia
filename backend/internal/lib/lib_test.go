package lib

import (
	"strings"
	"testing"
)

func TestMoneyBounds(t *testing.T) {
	for _, tt := range []struct {
		price int64
		qty   int
		want  int64
		valid bool
	}{{15000, 2, 30000, true}, {0, 1000, 0, true}, {MaxAmount, 1, MaxAmount, true}, {MaxAmount, 2, 0, false}, {-1, 1, 0, false}, {1, 0, 0, false}, {1, 1001, 0, false}, {MaxAmount + 1, 1, 0, false}} {
		got, e := Money(tt.price, tt.qty)
		if (e == nil) != tt.valid || got != tt.want {
			t.Errorf("Money(%d,%d)=%d,%v", tt.price, tt.qty, got, e)
		}
	}
}

func TestTransitions(t *testing.T) {
	for _, from := range []string{"pending", "confirmed", "failed", "expired"} {
		for _, to := range []string{"pending", "confirmed", "failed", "expired"} {
			want := from == "pending" && to != "pending"
			if PaymentTransition(from, to) != want {
				t.Errorf("payment %s -> %s", from, to)
			}
		}
	}
	if !QueueTransition("waiting", "in_service") || !QueueTransition("in_service", "completed") || !QueueTransition("waiting", "cancelled") || QueueTransition("waiting", "completed") || QueueTransition("completed", "waiting") {
		t.Fatal("queue transition policy")
	}
}

func TestUUID(t *testing.T) {
	if !UUID(ID()) || UUID("anything") || UUID("11111111-1111-4111-1111-111111111111") {
		t.Fatal("UUID validation")
	}
}

func TestNotificationTemplateValidation(t *testing.T) {
	valid := []string{
		DefaultNotificationTemplate,
		"Sale {{saleId}} on line {{businessLineId}} collected IDR {{total}}.",
		"No placeholders at all",
		"Braces { and } alone are literal",
	}
	for _, tpl := range valid {
		if e := ValidateNotificationTemplate(tpl); e != nil {
			t.Errorf("rejected valid template %q: %v", tpl, e)
		}
	}
	invalid := []string{
		"",
		"   ",
		"Leaks {{password}}",
		"Leaks {{destination}}",
		"Malformed {{saleId",
		"Malformed saleId}}",
		"Nested {{{{saleId}}}}",
		"Control\u0007character",
		"Newlines\nare control characters",
		strings.Repeat("x", MaxNotificationTemplate+1),
	}
	for _, tpl := range invalid {
		if e := ValidateNotificationTemplate(tpl); e == nil {
			t.Errorf("accepted invalid template %q", tpl)
		}
	}
	if e := ValidateNotificationTemplate(strings.Repeat("x", MaxNotificationTemplate)); e != nil {
		t.Fatal(e)
	}
}

func TestRenderNotification(t *testing.T) {
	values := map[string]string{"saleId": "sale-1", "total": "25000", "businessLineId": "line-1"}
	got := RenderNotification("Sale {{saleId}} line {{businessLineId}} IDR {{total}}.", values)
	if got != "Sale sale-1 line line-1 IDR 25000." {
		t.Fatal(got)
	}
	if got = RenderNotification(DefaultNotificationTemplate, values); got != "Payment confirmed. Sale sale-1, IDR 25000." {
		t.Fatal(got)
	}
	got = RenderNotification("{{saleId}}", map[string]string{"saleId": "{{total}}", "total": "999"})
	if got != "{{total}}" {
		t.Fatal("rendered value was re-interpreted:", got)
	}
	if got = RenderNotification("{{unknown}}", values); got != "{{unknown}}" {
		t.Fatal(got)
	}
}
