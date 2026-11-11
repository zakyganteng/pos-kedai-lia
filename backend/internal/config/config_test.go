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

func TestBorderpayConfiguration(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres:///test")
	t.Setenv("APP_ENV", "production")
	t.Setenv("PAYMENT_PROVIDER", "borderpay")
	t.Setenv("PAYMENT_BASE_URL", "")
	t.Setenv("PAYMENT_API_KEY", "bp_test_configuration-fixture")
	t.Setenv("PAYMENT_WEBHOOK_SECRET", "test-only-verification-token")
	t.Setenv("PAYMENT_PROJECT_SLUG", "test-shop")
	t.Setenv("NOTIFICATION_PROVIDER", "disabled")
	c, err := Load()
	if err != nil || c.PaymentBaseURL != "https://borderpay.id/api/v1" || c.PaymentProjectSlug != "test-shop" {
		t.Fatal(c.PaymentBaseURL, err)
	}
	for _, tc := range []struct{ key, value string }{
		{"PAYMENT_API_KEY", "invalid-key"}, {"PAYMENT_API_KEY", "bp_test_"}, {"PAYMENT_API_KEY", "bp_live_bad\nheader"},
		{"PAYMENT_WEBHOOK_SECRET", ""}, {"PAYMENT_WEBHOOK_SECRET", "short"}, {"PAYMENT_PROJECT_SLUG", ""},
		{"PAYMENT_BASE_URL", "http://borderpay.id/api/v1"}, {"PAYMENT_BASE_URL", "https://borderpay.id/api/v1?key=value"},
	} {
		t.Run(tc.key+tc.value, func(t *testing.T) {
			t.Setenv(tc.key, tc.value)
			if _, err := Load(); err == nil {
				t.Fatal("invalid Borderpay configuration accepted")
			}
		})
	}
	t.Setenv("APP_ENV", "test")
	t.Setenv("PAYMENT_BASE_URL", "http://127.0.0.1:19091/api/v1")
	if _, err = Load(); err != nil {
		t.Fatal("local test double rejected", err)
	}
	t.Setenv("PAYMENT_API_KEY", "bp_live_configuration-fixture")
	if _, err = Load(); err == nil {
		t.Fatal("live credentials sent over HTTP")
	}
}
