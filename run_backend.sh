#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "========================================================"
echo " Starting Smart Trap AI - Backend Engine (FastAPI)"
echo "========================================================"

export PYTHONPATH="$DIR"
./backend/venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
