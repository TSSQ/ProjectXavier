#!/usr/bin/env bash
# SessionStart hook: make sure a fresh Claude Code (web) session can run the
# BDD test suite, typecheck, and lint. Installs dependencies if missing.
set -euo pipefail

cd "$(dirname "$0")/../.."

if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  npm ci --legacy-peer-deps || npm install --legacy-peer-deps
fi

echo "ProjectXavier ready. Useful commands:"
echo "  npm test         # BDD suite (jest-cucumber)"
echo "  npm run typecheck"
echo "  npm run lint"
echo "  npm start        # Expo dev server"
