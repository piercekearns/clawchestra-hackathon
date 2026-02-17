#!/bin/bash
# Pipeline Dashboard - Update Script
# Run this to rebuild the app with latest changes.
# This script does NOT install, relaunch, or kill the running app.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔨 Building Pipeline Dashboard..."
cd "$SCRIPT_DIR"

# Ensure cargo and pnpm are in PATH
source ~/.cargo/env 2>/dev/null || true
export PATH="/opt/homebrew/bin:$PATH"

# Build without bundle to avoid /Applications side effects.
npx tauri build --no-bundle

echo "✅ Build complete (no bundle)"
echo "   Built at: $(date)"
