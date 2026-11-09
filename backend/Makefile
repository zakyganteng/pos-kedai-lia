DATABASE_URL ?= postgres://postgres:password@localhost:5432/postgres?sslmode=disable
MIGRATIONS_DIR ?= file://migrations

.PHONY: build run test migrate migrate-up migrate-down

build:
	go build -o pos ./cmd/pos

run:
	DATABASE_URL="$(DATABASE_URL)" APP_ENV=development go run ./cmd/pos serve

test:
	go test ./...

migrate: migrate-up

migrate-up:
	@if command -v migrate >/dev/null 2>&1; then \
		migrate -path migrations -database "$(DATABASE_URL)" up; \
	else \
		DATABASE_URL="$(DATABASE_URL)" go run ./cmd/pos migrate; \
	fi

migrate-down:
	@if command -v migrate >/dev/null 2>&1; then \
		migrate -path migrations -database "$(DATABASE_URL)" down -all; \
	else \
		DATABASE_URL="$(DATABASE_URL)" go run ./cmd/pos migrate-down; \
	fi
