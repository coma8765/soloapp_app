#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -x "$APP_DIR/build/planet_server" ]]; then
  "$APP_DIR/scripts/build.sh"
fi
cd "$APP_DIR"
exec "$APP_DIR/build/planet_server" "--port=${1:-3000}" "--host=${2:-127.0.0.1}" "--nav=$APP_DIR/server/data/lakes.json" "--web=$APP_DIR/public"
