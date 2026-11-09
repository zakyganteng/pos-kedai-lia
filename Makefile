.DEFAULT_GOAL := help
.PHONY: help dev up down logs ps build psql backup restore test frontend-dev frontend-check frontend-e2e

TARGET ?= pos_restore_check

help:
	@echo 'make dev      Build and start db + backend + frontend'
	@echo '              POS http://localhost:3000'
	@echo 'make frontend-dev    Run Next.js locally (npm install in frontend first)'
	@echo 'make frontend-check  Typecheck, lint, unit tests, and production build'
	@echo 'make frontend-e2e    Browser checks against a disposable database + real API'
	@echo '              API http://127.0.0.1:8080/api/v1, login owner@owner.com / owner-password-123'
	@echo 'make down     Stop containers; keeps the database volume'
	@echo 'make logs     Follow db and backend logs'
	@echo 'make ps       Show container status'
	@echo 'make build    Build the backend and frontend images'
	@echo 'make psql     Open psql on the pos database'
	@echo 'make backup FILE=path/pos.dump'
	@echo 'make restore FILE=path/pos.dump [TARGET=pos_restore_check]   Restore into a new database'
	@echo 'make test     Backend vet and race tests'

dev up:
	docker compose up -d --build --wait
	@echo "POS http://localhost:$$(docker compose port frontend 3000 | awk -F: '{print $$NF}')"
	@echo "API http://$$(docker compose port backend 8080)/api/v1  login owner@owner.com / owner-password-123"

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

build:
	docker compose build backend frontend

psql:
	docker compose exec db psql -U postgres -d pos

backup:
	@test -n "$(FILE)" || { echo 'usage: make backup FILE=path/pos.dump'; exit 2; }
	@test ! -e "$(FILE)" || { echo '$(FILE) already exists'; exit 2; }
	umask 077; docker compose exec -T db pg_dump -U postgres -d pos -Fc > "$(FILE).tmp" && mv "$(FILE).tmp" "$(FILE)" || { rm -f "$(FILE).tmp"; exit 1; }

restore:
	@test -n "$(FILE)" || { echo 'usage: make restore FILE=path/pos.dump [TARGET=pos_restore_check]'; exit 2; }
	docker compose exec -T db createdb -U postgres "$(TARGET)"
	docker compose exec -T db pg_restore -U postgres -d "$(TARGET)" --no-owner --no-privileges --single-transaction < "$(FILE)"

test:
	cd backend && go vet ./... && go test -race ./...

frontend-dev:
	cd frontend && npm run dev

frontend-check:
	cd frontend && npm run typecheck && npm run lint && npm test && npm run build

frontend-e2e:
	cd frontend && npm run test:e2e
