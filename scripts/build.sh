#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPTIONS=(-DCMAKE_BUILD_TYPE=Release)
if [[ -f "$APP_DIR/.cache/datachannel-src/CMakeLists.txt" ]]; then
  OPTIONS+=("-DFETCHCONTENT_SOURCE_DIR_DATACHANNEL=$APP_DIR/.cache/datachannel-src")
fi
cmake -S "$APP_DIR/server" -B "$APP_DIR/build" "${OPTIONS[@]}" "$@"
cmake --build "$APP_DIR/build" --parallel "${BUILD_JOBS:-4}"
ctest --test-dir "$APP_DIR/build" --output-on-failure
