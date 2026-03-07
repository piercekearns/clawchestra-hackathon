#!/bin/bash
# Wipe the test instance's data so the next launch is a fresh onboarding.
# Does NOT touch your real Clawchestra data.
#
# Usage:
#   1. Close the test instance (Ctrl+C in the terminal running test-instance.sh)
#   2. Run: ./scripts/reset-test.sh
#   3. Re-run: ./scripts/test-instance.sh

set -euo pipefail

TEST_SETTINGS="$HOME/Library/Application Support/Clawchestra-Test"
TEST_TAURI="$HOME/Library/Application Support/ai.clawchestra.desktop.test"
TEST_WINDOW_STATE="$HOME/Library/Saved Application State/ai.clawchestra.desktop.test.savedState"

for dir in "$TEST_SETTINGS" "$TEST_TAURI" "$TEST_WINDOW_STATE"; do
  if [ -d "$dir" ]; then
    rm -rf "$dir"
    echo "Wiped: $dir"
  fi
done

echo ""
echo "Next launch of test-instance.sh will be a fresh onboarding."
