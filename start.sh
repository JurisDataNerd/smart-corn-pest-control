#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo " Starting Smart Trap AI System (Backend + Frontend)"
echo "=========================================================="

# If Bun is installed, run via Bun monorepo command
if command -v bun >/dev/null 2>&1; then
    exec bun run dev
fi

# Fallback: Trap to kill background processes on exit
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# 1. Start Backend on port 8000
echo "[1/2] Launching FastAPI Backend on http://localhost:8000..."
export PYTHONPATH="$DIR"
./backend/venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Wait for backend to be responsive
sleep 2

# 2. Start Frontend on port 5173
echo "[2/2] Launching React Dashboard on http://localhost:5173..."
cd "$DIR/frontend"
npm run dev -- --port 5173 &
FRONTEND_PID=$!

echo ""
echo "=========================================================="
echo " Smart Trap AI is ready!"
echo "   - Web Dashboard:  http://localhost:5173"
echo "   - API Swagger:    http://localhost:8000/api/v1/docs"
echo "=========================================================="
echo "Press Ctrl+C to stop all services."

wait
