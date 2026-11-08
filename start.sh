#!/usr/bin/env bash
# Seedbox launcher
cd "$(dirname "$0")"
export PORT="${PORT:-3000}"
export ROOT_DIR="${ROOT_DIR:-$HOME}"
echo "Starting beats-rename on port $PORT, ROOT_DIR=$ROOT_DIR"
exec node server.js
