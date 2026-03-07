#!/bin/bash
# Launch a fresh test instance of Clawchestra alongside your real one.
# The test instance has a different app identifier, settings path, and "[TEST]" title.
# Your real Clawchestra is completely untouched.
#
# Usage:
#   ./scripts/test-instance.sh        # launch test instance
#   ./scripts/reset-test.sh           # wipe test data for fresh onboarding

set -euo pipefail
cd "$(dirname "$0")/.."

CONF="src-tauri/tauri.conf.json"
BACKUP="src-tauri/tauri.conf.json.backup"
TEST_DATA="$HOME/Library/Application Support/Clawchestra-Test"

# Safety: don't run if backup already exists (means a previous run crashed)
if [ -f "$BACKUP" ]; then
  echo "Found leftover backup — restoring original config first."
  mv "$BACKUP" "$CONF"
fi

# Back up the real config
cp "$CONF" "$BACKUP"

restore() {
  echo ""
  echo "Restoring original config..."
  mv "$BACKUP" "$CONF"
  echo "Done. Your real Clawchestra config is restored."
}
trap restore EXIT INT TERM

# Patch for test instance:
#   - Different identifier (separate Tauri app data)
#   - "[TEST]" in product name and title bar
#   - Port 5174 (so it doesn't clash with a running dev server on 5173)
sed -i '' \
  -e 's/"identifier": "ai.clawchestra.desktop"/"identifier": "ai.clawchestra.desktop.test"/' \
  -e 's/"productName": "Clawchestra"/"productName": "Clawchestra [TEST]"/' \
  -e 's/"title": "Clawchestra"/"title": "Clawchestra [TEST]"/' \
  -e 's/"beforeDevCommand": "pnpm dev"/"beforeDevCommand": "pnpm dev --port 5174"/' \
  -e 's|http://localhost:5173|http://localhost:5174|' \
  "$CONF"

# Create test data dir if needed
mkdir -p "$TEST_DATA"

echo "============================================"
echo "  CLAWCHESTRA [TEST] INSTANCE"
echo "============================================"
echo ""
echo "  Identifier:  ai.clawchestra.desktop.test"
echo "  Settings:    $TEST_DATA/settings.json"
echo "  Title bar:   Clawchestra [TEST]"
echo "  Dev server:  localhost:5174"
echo ""
echo "  Your real Clawchestra is untouched."
echo "  Press Ctrl+C to stop and restore config."
echo ""
echo "  To wipe and re-test onboarding:"
echo "    1. Ctrl+C here"
echo "    2. ./scripts/reset-test.sh"
echo "    3. ./scripts/test-instance.sh"
echo "============================================"
echo ""

# Point settings at the test directory so it gets fresh onboarding state
export CLAWCHESTRA_SETTINGS_PATH="$TEST_DATA/settings.json"

pnpm tauri dev
