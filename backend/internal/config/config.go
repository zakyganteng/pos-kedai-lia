package config

import (
	"fmt"
	"net/url"
	"os"
	"pos/internal/lib"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL, Addr, Env, PaymentProvider, PaymentBaseURL, PaymentAPIKey, WebhookSecret, NotificationProvider, NotificationBaseURL, NotificationAPIKey, Destination, NotificationTemplate, JWTSecret string
	SessionTTL                                                                                                                                                                                         time.Duration
	Zone                                                                                                                                                                                               *time.Location
	PaymentProjectSlug                                                                                                                                                                                 string
}

func env(key, fallback string) string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v
}

func Load() (Config, error) {
	c := Config{
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		Addr:                 env("HTTP_ADDR", ":8080"),
		Env:                  env("APP_ENV", "development"),
		PaymentProvider:      env("PAYMENT_PROVIDER", "disabled"),
		PaymentBaseURL:       os.Getenv("PAYMENT_BASE_URL"),
		PaymentAPIKey:        os.Getenv("PAYMENT_API_KEY"),
		WebhookSecret:        os.Getenv("PAYMENT_WEBHOOK_SECRET"),
		PaymentProjectSlug:   os.Getenv("PAYMENT_PROJECT_SLUG"),
		NotificationProvider: env("NOTIFICATION_PROVIDER", "disabled"),
		NotificationBaseURL:  os.Getenv("NOTIFICATION_BASE_URL"),
		NotificationAPIKey:   os.Getenv("NOTIFICATION_API_KEY"),
		Destination:          os.Getenv("NOTIFICATION_DESTINATION"),
		NotificationTemplate: env("NOTIFICATION_TEMPLATE", lib.DefaultNotificationTemplate),
		JWTSecret:            env("JWT_SECRET", "pos-default-jwt-secret-key-32bytes"),
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL required")
	}
	if e := lib.ValidateNotificationTemplate(c.NotificationTemplate); e != nil {
		return c, fmt.Errorf("NOTIFICATION_TEMPLATE: %s; supported placeholders are %s", e.Error(), strings.Join(lib.NotificationPlaceholders, ", "))
	}
	if c.Env != "development" && c.Env != "test" && c.Env != "production" {
		return c, fmt.Errorf("APP_ENV must be development, test, or production")
	}
	var e error
	c.SessionTTL, e = time.ParseDuration(env("SESSION_TTL", "30m"))
	if e != nil || c.SessionTTL < time.Minute || c.SessionTTL > time.Hour {
		return c, fmt.Errorf("SESSION_TTL must be between 1m and 1h")
	}
	c.Zone, e = time.LoadLocation(env("BUSINESS_TIMEZONE", "Asia/Jakarta"))
	if e != nil {
		return c, fmt.Errorf("invalid BUSINESS_TIMEZONE")
	}
	if c.PaymentProvider != "disabled" && c.PaymentProvider != "mock" && c.PaymentProvider != "borderpay" {
		return c, fmt.Errorf("PAYMENT_PROVIDER must be disabled, mock, or borderpay")
	}
	if c.NotificationProvider != "disabled" && c.NotificationProvider != "http" {
		return c, fmt.Errorf("unsupported NOTIFICATION_PROVIDER: real vendor not integrated")
	}
	if c.Env == "production" && (c.PaymentProvider == "mock" || c.NotificationProvider == "http") {
		return c, fmt.Errorf("development adapters cannot run in production; real vendors are release dependencies")
	}
	if c.PaymentProvider == "borderpay" {
		if (!strings.HasPrefix(c.PaymentAPIKey, "bp_test_") && !strings.HasPrefix(c.PaymentAPIKey, "bp_live_")) || len(c.PaymentAPIKey) <= 8 || strings.ContainsAny(c.PaymentAPIKey, " \t\r\n") {
			return c, fmt.Errorf("borderpay requires a bp_test_ or bp_live_ PAYMENT_API_KEY")
		}
		if len(c.WebhookSecret) < 16 || strings.TrimSpace(c.WebhookSecret) != c.WebhookSecret || strings.ContainsAny(c.WebhookSecret, "\r\n") || strings.TrimSpace(c.PaymentProjectSlug) == "" || len(c.PaymentProjectSlug) > 100 {
			return c, fmt.Errorf("borderpay requires PAYMENT_PROJECT_SLUG and PAYMENT_WEBHOOK_SECRET (16+ bytes)")
		}
		if c.PaymentBaseURL == "" {
			c.PaymentBaseURL = "https://borderpay.id/api/v1"
		}
		if e = providerURL(c.PaymentBaseURL, c.Env); e != nil {
			return c, fmt.Errorf("PAYMENT_BASE_URL: %w", e)
		}
		u, _ := url.Parse(c.PaymentBaseURL)
		if u.Scheme != "https" && !(c.Env == "test" && strings.HasPrefix(c.PaymentAPIKey, "bp_test_") && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1")) {
			return c, fmt.Errorf("borderpay requires HTTPS (HTTP loopback allowed only in APP_ENV=test with a test key)")
		}
	}
	if c.PaymentProvider == "mock" {
		if len(c.PaymentAPIKey) < 1 || len(c.WebhookSecret) < 16 {
			return c, fmt.Errorf("mock requires PAYMENT_API_KEY and PAYMENT_WEBHOOK_SECRET (16+ bytes)")
		}
		if e = providerURL(c.PaymentBaseURL, c.Env); e != nil {
			return c, fmt.Errorf("PAYMENT_BASE_URL: %w", e)
		}
	}
	if c.NotificationProvider == "http" {
		if c.NotificationAPIKey == "" || c.Destination == "" {
			return c, fmt.Errorf("http notification requires API key and destination")
		}
		if e = providerURL(c.NotificationBaseURL, c.Env); e != nil {
			return c, fmt.Errorf("NOTIFICATION_BASE_URL: %w", e)
		}
	}
	return c, nil
}

func providerURL(raw, environment string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return fmt.Errorf("absolute HTTP(S) URL without user info, query, or fragment required")
	}
	if u.Scheme == "http" && environment == "production" {
		return fmt.Errorf("HTTPS required")
	}
	if strings.ContainsAny(raw, "\r\n") {
		return fmt.Errorf("invalid URL")
	}
	return nil
}
