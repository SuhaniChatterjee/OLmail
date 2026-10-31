#!/usr/bin/env bash
# One-command local setup: frees the ports this project needs, starts Redis /
# Postgres / Elasticsearch in Docker, installs deps, opens an ngrok tunnel for
# the Slack OAuth callback, and runs the API, worker and frontend together.
# Ctrl-C stops the API, worker, frontend and any ngrok this script started.
#
# Options (env vars):
#   NO_TUNNEL=1        skip ngrok (Slack connect won't work, everything else will)
#   NGROK_DOMAIN=...   use this ngrok domain instead of the account default
#   NGROK_AUTHTOKEN=.. save this ngrok authtoken first (ngrok is brew-installed if missing);
#                      also read from NGROK_AUTHTOKEN in backend/.env
#   NO_KILL=1          don't stop processes/containers that hold our ports
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV="$ROOT/backend/.env"
FRONTEND_ENV="$ROOT/frontend/.env"
RUN_DIR="$ROOT/.run"

API_PORT=4000
WEB_PORT=5173
INFRA_PORTS="6379 54329 9200"
PIDS=()

mkdir -p "$RUN_DIR"
cd "$ROOT"

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }
die()  { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

# --- .env helpers -------------------------------------------------------------

get_env() { # file key
  awk -F= -v k="$2" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' "$1"
}

set_env() { # file key value: replaces the line, or appends it if missing
  local tmp
  tmp="$(mktemp)"
  awk -v k="$2" -v v="$3" '
    BEGIN { done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$1" > "$tmp"
  mv "$tmp" "$1"
}

default_env() { # file key value: only fills in empty/missing values
  [ -n "$(get_env "$1" "$2")" ] || { set_env "$1" "$2" "$3"; log "Set $2 in $(basename "$(dirname "$1")")/.env"; }
}

# --- process helpers ----------------------------------------------------------

kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  trap - INT TERM EXIT
  echo
  log "Stopping API, worker, frontend${NGROK_STARTED:+ and ngrok}..."
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill_tree "$pid"; done
  wait 2>/dev/null || true
  log "Stopped. Docker services are still running (make infra-down to stop them)."
  exit 0
}

# Runs a command in the background with every output line prefixed by a tag.
start() { # tag dir command...
  local tag=$1 dir=$2
  shift 2
  { (cd "$dir" && exec "$@") 2>&1 | awk -v p="$tag" '{ print p " " $0; fflush() }'; } &
  PIDS+=($!)
}

wait_for() { # description seconds command...
  local what=$1 secs=$2 i
  shift 2
  for ((i = 0; i < secs; i++)); do
    "$@" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "$what did not become ready within ${secs}s"
}

# --- 1. prerequisites ---------------------------------------------------------

command -v node >/dev/null || die "Node.js is not installed"
command -v docker >/dev/null || die "Docker is not installed"

if ! docker info >/dev/null 2>&1; then
  if [ "$(uname)" = Darwin ]; then
    log "Starting Docker Desktop..."
    open -a Docker
    wait_for "Docker" 120 docker info
  else
    die "Docker is not running"
  fi
fi

# --- 2. env files ---------------------------------------------------------------

for f in "$BACKEND_ENV" "$FRONTEND_ENV"; do
  if [ ! -f "$f" ]; then
    cp "$f.example" "$f"
    warn "Created $(basename "$(dirname "$f")")/.env from .env.example; fill in the Google/Slack keys"
  fi
done

# Point at the Docker services from docker-compose.yml unless already set.
default_env "$BACKEND_ENV" DATABASE_URL "postgres://scheduler:scheduler@localhost:54329/scheduler"
default_env "$BACKEND_ENV" REDIS_URL "redis://localhost:6379"
default_env "$BACKEND_ENV" ELASTICSEARCH_URL "http://localhost:9200"

NGROK_AUTHTOKEN="${NGROK_AUTHTOKEN:-$(get_env "$BACKEND_ENV" NGROK_AUTHTOKEN)}"

# --- 3. free our ports ----------------------------------------------------------

# Leftover API/worker watchers from an earlier run. The worker holds no port, so
# without this an old worker would keep processing jobs next to the new one.
if pkill -f -- "$ROOT/backend/node_modules/.bin/tsx watch" 2>/dev/null; then
  warn "Stopped API/worker processes left over from a previous run"
fi

PROJECT="$(docker compose config 2>/dev/null | awk '/^name:/ { print $2; exit }')"

if [ -z "${NO_KILL:-}" ]; then
  # Containers from other projects that publish a port we need.
  for port in $INFRA_PORTS $API_PORT $WEB_PORT; do
    docker ps --filter "publish=$port" --format '{{.ID}} {{.Label "com.docker.compose.project"}} {{.Names}}' |
      while read -r id proj name; do
        [ "$proj" = "$PROJECT" ] && continue
        warn "Port $port is used by container $name; stopping it"
        docker stop "$id" >/dev/null
      done
  done
  # Local processes (old dev servers etc.) on the API / frontend ports.
  for port in $API_PORT $WEB_PORT; do
    for pid in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
      warn "Port $port is used by PID $pid ($(ps -o comm= -p "$pid" | xargs basename)); stopping it"
      kill "$pid" 2>/dev/null || true
    done
  done
  sleep 1
fi

# --- 4. infrastructure ------------------------------------------------------------

log "Starting Redis, Postgres and Elasticsearch..."
docker compose up -d
wait_for "Postgres" 60 docker compose exec -T postgres pg_isready -U scheduler
wait_for "Redis" 30 docker compose exec -T redis redis-cli ping
log "Waiting for Elasticsearch (can take ~30s on first start)..."
wait_for "Elasticsearch" 120 curl -sf "http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=1s"

# --- 5. dependencies ----------------------------------------------------------------

for dir in backend frontend; do
  if [ ! -d "$dir/node_modules" ] || [ "$dir/package-lock.json" -nt "$dir/node_modules/.package-lock.json" ]; then
    log "Installing $dir dependencies..."
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
done

# --- 6. ngrok tunnel for the Slack OAuth callback ------------------------------------

trap cleanup INT TERM EXIT

# Prints the public https URL of an ngrok tunnel to our API port, if one is running.
find_tunnel() {
  local p
  for p in 4040 4041 4042 4043; do
    curl -sf "http://127.0.0.1:$p/api/tunnels" 2>/dev/null |
      node -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          const t = JSON.parse(s).tunnels.find((t) => t.public_url.startsWith("https") && /:'"$API_PORT"'$/.test(t.config.addr));
          if (t) console.log(t.public_url);
        });' && return 0
  done
  return 0
}

if [ -z "${NO_TUNNEL:-}" ] && ! command -v ngrok >/dev/null && command -v brew >/dev/null; then
  log "Installing ngrok (brew install ngrok)"
  brew install ngrok || warn "brew install ngrok failed"
fi
if command -v ngrok >/dev/null && [ -n "${NGROK_AUTHTOKEN:-}" ]; then
  log "Saving NGROK_AUTHTOKEN to the ngrok config"
  ngrok config add-authtoken "$NGROK_AUTHTOKEN" >/dev/null
fi

PUBLIC_URL="http://localhost:$API_PORT"
if [ -n "${NO_TUNNEL:-}" ]; then
  warn "NO_TUNNEL set: Slack connect needs an https URL and will not work"
elif ! command -v ngrok >/dev/null; then
  warn "ngrok is not installed (brew install ngrok): Slack connect will not work"
elif ! ngrok config check >/dev/null 2>&1 || ! grep -qs authtoken "$(ngrok config check 2>/dev/null | sed -n 's/.*at \(.*\)$/\1/p')"; then
  warn "ngrok has no authtoken: run NGROK_AUTHTOKEN=<token> make dev (or ngrok config add-authtoken <token>). Slack connect will not work"
else
  TUNNEL="$(find_tunnel)"
  if [ -n "$TUNNEL" ]; then
    log "Reusing the ngrok tunnel that is already running (not started by this script)"
  else
    log "Starting ngrok: ngrok http $API_PORT${NGROK_DOMAIN:+ --url $NGROK_DOMAIN} (log: .run/ngrok.log)"
    ngrok http "$API_PORT" ${NGROK_DOMAIN:+--url "$NGROK_DOMAIN"} --log "$RUN_DIR/ngrok.log" >/dev/null 2>&1 &
    PIDS+=($!)
    NGROK_STARTED=1
    for _ in $(seq 1 20); do
      TUNNEL="$(find_tunnel)"
      [ -n "$TUNNEL" ] && break
      sleep 1
    done
    [ -n "$TUNNEL" ] || warn "ngrok did not start; see .run/ngrok.log. Continuing without it."
  fi
  [ -n "$TUNNEL" ] && PUBLIC_URL="$TUNNEL"
fi

OLD_REDIRECT="$(get_env "$BACKEND_ENV" SLACK_REDIRECT_URI)"
NEW_REDIRECT="$PUBLIC_URL/api/integrations/slack/callback"
set_env "$BACKEND_ENV" PUBLIC_API_URL "$PUBLIC_URL"
set_env "$BACKEND_ENV" SLACK_REDIRECT_URI "$NEW_REDIRECT"
SLACK_URL_CHANGED=""
if [ "$OLD_REDIRECT" != "$NEW_REDIRECT" ] && [ -n "$(get_env "$BACKEND_ENV" SLACK_CLIENT_ID)" ]; then
  SLACK_URL_CHANGED=1
fi

# --- 7. app ---------------------------------------------------------------------------

log "Starting API, worker and frontend..."
start "$(printf '\033[36m[api]   \033[0m')" backend npm run dev
start "$(printf '\033[35m[worker]\033[0m')" backend npm run dev:worker
start "$(printf '\033[34m[web]   \033[0m')" frontend npm run dev -- --port "$WEB_PORT" --strictPort

wait_for "API" 60 curl -sf "http://localhost:$API_PORT/api/health"
wait_for "Frontend" 30 curl -sf "http://localhost:$WEB_PORT"

cat <<EOF

$(printf '\033[1;32m')Everything is running.$(printf '\033[0m')
  App              http://localhost:$WEB_PORT
  API              http://localhost:$API_PORT
  Queue dashboard  $PUBLIC_URL/admin/queues
  Slack callback   $NEW_REDIRECT
  ngrok inspector  http://127.0.0.1:4040

Press Ctrl-C to stop.
EOF
if [ -n "$SLACK_URL_CHANGED" ]; then
  warn "The public URL changed. In your Slack app → OAuth & Permissions → Redirect URLs, add:"
  warn "  $NEW_REDIRECT"
fi
echo

wait
