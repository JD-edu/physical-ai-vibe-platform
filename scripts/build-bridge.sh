#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cmake -S physical/bridge-server -B physical/bridge-server/build -DCMAKE_BUILD_TYPE=Release
cmake --build physical/bridge-server/build --parallel 4
