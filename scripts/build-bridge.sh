#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cmake -S bridge-server -B bridge-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build bridge-server/build --parallel 4
