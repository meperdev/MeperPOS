#!/usr/bin/env bash
# Local PostgreSQL for MeperPOS.
#
# The database is the `postgres` service of backend/docker-compose.yml; this is
# the one command the project needs, so nobody has to remember the container
# name or whether the daemon is running.
#
#   npm run db:up      start (and create on first run)
#   npm run db:status  is it up?
#   npm run db:down    stop
#   npm run db:logs    follow the server log
set -euo pipefail

cd "$(dirname "$0")/.."
action="${1:-up}"
service="postgres"

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

run_docker() {
  if docker_available; then
    docker "$@"
  elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
    # Interactive shell: ask once instead of failing with a socket error.
    sudo docker "$@"
  else
    cat >&2 <<'EOF'
Docker no es accesible sin sudo (tu usuario no está en el grupo `docker`).

Arréglalo una vez y reinicia la sesión:

    sudo usermod -aG docker "$USER"

Mientras tanto, ejecuta el mismo comando con sudo:

    sudo docker compose up -d postgres
EOF
    exit 1
  fi
}

case "$action" in
  up)
    run_docker compose up -d "$service"
    run_docker compose ps "$service"
    ;;
  down)
    run_docker compose stop "$service"
    ;;
  status)
    run_docker compose ps "$service"
    ;;
  logs)
    run_docker compose logs -f "$service"
    ;;
  *)
    echo "uso: db.sh [up|down|status|logs]" >&2
    exit 2
    ;;
esac
