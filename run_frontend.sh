#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR/frontend"

echo "========================================================"
echo " Starting Smart Trap AI - Frontend Dashboard"
echo "========================================================"

if command -v bun >/dev/null 2>&1; then
    bun run dev
else
    npm run dev
fi
