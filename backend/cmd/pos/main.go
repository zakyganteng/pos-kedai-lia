package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"pos/internal/adapters"
	"pos/internal/config"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/internal/route"
	"pos/internal/service"
	"syscall"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("startup failed", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	c, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	connectCtx, stop := context.WithTimeout(ctx, 10*time.Second)
	r, err := repo.Open(connectCtx, c.DatabaseURL)
	stop()
	if err != nil {
		return fmt.Errorf("database connection failed")
	}
	defer r.Close()
	command := "serve"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if command == "migrate" || command == "migrate-up" {
		if err = runMigrate(ctx, r, c.DatabaseURL, true); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
		logger.Info("migrations applied")
		return nil
	}
	if command == "migrate-down" {
		if err = runMigrate(ctx, r, c.DatabaseURL, false); err != nil {
			return fmt.Errorf("migration down failed: %w", err)
		}
		logger.Info("migrations rolled back")
		return nil
	}
	var payment model.PaymentProvider = adapters.DisabledPayment{}
	if c.PaymentProvider == "mock" {
		payment = adapters.NewMock(c.PaymentBaseURL, c.PaymentAPIKey, c.WebhookSecret)
	} else if c.PaymentProvider == "borderpay" {
		payment = adapters.NewBorderpay(c.PaymentBaseURL, c.PaymentAPIKey, c.WebhookSecret, c.PaymentProjectSlug)
	}
	var notification model.NotificationProvider = adapters.DisabledNotification{}
	if c.NotificationProvider == "http" {
		notification = adapters.NewNotification(c.NotificationBaseURL, c.NotificationAPIKey)
	}
	s := service.New(r, payment, notification, c.SessionTTL, c.Zone, c.Destination, c.NotificationTemplate)
	s.JWTSecret = c.JWTSecret
	if command != "serve" {
		return fmt.Errorf("usage: pos [serve|migrate|migrate-down]")
	}

	server := &http.Server{
		Addr:              c.Addr,
		Handler:           route.New(s, logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if e := s.RecoverIntents(ctx); e != nil && ctx.Err() == nil {
					logger.Error("intent recovery failed", "errorType", fmt.Sprintf("%T", e))
				}
				if e := s.Expire(ctx); e != nil && ctx.Err() == nil {
					logger.Error("payment expiry failed", "errorType", fmt.Sprintf("%T", e))
				}
				if e := s.Deliver(ctx); e != nil && ctx.Err() == nil {
					logger.Error("outbox worker failed", "errorType", fmt.Sprintf("%T", e))
				}
			}
		}
	}()
	serveErrors := make(chan error, 1)
	go func() { logger.Info("listening", "address", c.Addr); serveErrors <- server.ListenAndServe() }()
	select {
	case <-ctx.Done():
	case err = <-serveErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			cancel()
			<-workerDone
			return err
		}
	}
	cancel()
	shutdownCtx, end := context.WithTimeout(context.Background(), 15*time.Second)
	defer end()
	err = server.Shutdown(shutdownCtx)
	<-workerDone
	return err
}

func runMigrate(ctx context.Context, r *repo.Repo, dbURL string, up bool) error {
	if m, err := migrate.New("file://migrations", dbURL); err == nil {
		defer m.Close()
		if up {
			if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
				return err
			}
			return nil
		}
		if err := m.Down(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
			return err
		}
		return nil
	}
	if up {
		return r.Migrate(ctx)
	}
	b, err := os.ReadFile("migrations/000001_init.down.sql")
	if err != nil {
		return err
	}
	return r.MigrateDown(ctx, string(b))
}
