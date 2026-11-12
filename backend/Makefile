DATABASE_URL ?= postgres://postgres:password@localhost:5432/postgres?sslmode=disable

.PHONY: build run test migrate migrate-up migrate-down

build:
	go build -o pos ./cmd/pos

run:
	DATABASE_URL="$(DATABASE_URL)" APP_ENV=development go run ./cmd/pos serve

test:
	go test ./...

migrate: migrate-up

# Always use the embedded migrator: the golang-migrate CLI is incompatible with this
# project's schema_migrations table.
migrate-up:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/pos migrate

migrate-down:
	DATABASE_URL="$(DATABASE_URL)" go run ./cmd/pos migrate-down
