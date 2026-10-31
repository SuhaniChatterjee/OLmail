.DEFAULT_GOAL := dev
.PHONY: dev dev-local install infra infra-down stop build typecheck lint reindex logs-infra

## Run everything: ports, Docker services, deps, ngrok, API, worker, frontend
dev:
	@./scripts/dev.sh

## Same, without the ngrok tunnel (Slack connect won't work)
dev-local:
	@NO_TUNNEL=1 ./scripts/dev.sh

## Install backend and frontend dependencies
install:
	cd backend && npm install
	cd frontend && npm install

## Start / stop Redis, Postgres and Elasticsearch only
infra:
	docker compose up -d

infra-down:
	docker compose stop

## Stop the app (API, worker, frontend, ngrok) and the Docker services
stop:
	-@pkill -f 'tsx watch src/server.ts' || true
	-@pkill -f 'tsx watch src/worker.ts' || true
	-@lsof -nP -t -iTCP:5173 -sTCP:LISTEN | xargs kill 2>/dev/null || true
	-@pkill -f 'ngrok http 4000' || true
	docker compose stop

## Production build of both apps
build:
	cd backend && npm run build
	cd frontend && npm run build

typecheck:
	cd backend && npm run typecheck
	cd frontend && npx tsc -b

lint:
	cd frontend && npm run lint

## Rebuild the Elasticsearch index from Postgres
reindex:
	cd backend && npm run reindex

logs-infra:
	docker compose logs -f

