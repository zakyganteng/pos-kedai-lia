package config

import (
	"pos/internal/lib"
	"strings"
	"testing"
)

func TestConfigurationRejectsProductionMocksAndBadSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres:///test")
	t.Setenv("APP_ENV", "production")
	t.Setenv("PAYMENT_PROVIDER", "mock")
	if _, e := Load(); e == nil {
		t.Fatal("production mock enabled")
	}
	t.Setenv("APP_ENV", "test")
	t.Setenv("PAYMENT_BASE_URL", "http://127.0.0.1:19091")
	t.Setenv("PAYMENT_API_KEY", "test-key")
	t.Setenv("PAYMENT_WEBHOOK_SECRET", "short")
	if _, e := Load(); e == nil {
		t.Fatal("weak webhook secret")
	}
	t.Setenv("PAYMENT_WEBHOOK_SECRET", "test-only-at-least-16-bytes")
	if _, e := Load(); e != nil {
		t.Fatal(e)
	}
	t.Setenv("SESSION_TTL", "24h")
	if _, e := Load(); e == nil {
		t.Fatal("long session accepted")
	}
}

func TestProviderURLValidation(t *testing.T) {
	for _, v := range []string{"file:///etc/passwd", "http://user:pass@example.test", "http://example.test?secret=1", "http://example.test#fragment", "not-url"} {
		if e := providerURL(v, "test"); e == nil {
			t.Error("accepted", v)
		}
	}
	if providerURL("http://example.test", "production") == nil {
		t.Fatal("production HTTP accepted")
	}
}

func TestNotificationTemplateConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres:///test")
	t.Setenv("APP_ENV", "test")
	c, e := Load()
	if e != nil || c.NotificationTemplate != lib.DefaultNotificationTemplate {
		t.Fatal(c.NotificationTemplate, e)
	}
	t.Setenv("NOTIFICATION_TEMPLATE", "Sale {{saleId}} on {{businessLineId}} total {{total}}")
	if c, e = Load(); e != nil || c.NotificationTemplate != "Sale {{saleId}} on {{businessLineId}} total {{total}}" {
		t.Fatal(c.NotificationTemplate, e)
	}
	for _, tpl := range []string{"Leaks {{apiKey}}", "Broken {{saleId", "Tab\tcharacter", " "} {
		t.Setenv("NOTIFICATION_TEMPLATE", tpl)
		if _, e = Load(); e == nil {
			t.Errorf("accepted %q", tpl)
		} else if !strings.Contains(e.Error(), "NOTIFICATION_TEMPLATE") {
			t.Errorf("%q: unhelpful error %v", tpl, e)
		}
	}
}
