#!/bin/bash
# Pipeline Dashboard - Update Script
# Run this to rebuild the app with latest changes.
# Triggered by the in-app Update button.
# Builds in the background, then replaces the installed app and restarts it.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Pipeline Dashboard"
BUNDLE_PATH="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
INSTALL_PATH="${PIPELINE_DASHBOARD_INSTALL_PATH:-/Applications/$APP_NAME.app}"
RESTART_AFTER_BUILD="${PIPELINE_DASHBOARD_RESTART_AFTER_BUILD:-1}"

echo "🔨 Building Pipeline Dashboard..."
cd "$SCRIPT_DIR"

# Ensure cargo and pnpm are in PATH
source ~/.cargo/env 2>/dev/null || true
export PATH="/opt/homebrew/bin:$PATH"

# Build app bundle only (no DMG).
pnpm tauri build --bundles app

if [ ! -d "$BUNDLE_PATH" ]; then
  echo "❌ Build failed - no app bundle found at: $BUNDLE_PATH"
  exit 1
fi

if [ "$RESTART_AFTER_BUILD" != "1" ]; then
  echo "✅ Build complete (restart disabled)"
  echo "   Built at: $(date)"
  exit 0
fi

TARGET_DIR="$(dirname "$INSTALL_PATH")"
STAGED_PATH="$TARGET_DIR/.${APP_NAME}.updated.app"

echo "📦 Staging updated app at: $STAGED_PATH"
rm -rf "$STAGED_PATH"
cp -R "$BUNDLE_PATH" "$STAGED_PATH"

echo "🔁 Applying update and restarting app..."
killall "pipeline-dashboard" 2>/dev/null || true
sleep 0.5
rm -rf "$INSTALL_PATH"
mv "$STAGED_PATH" "$INSTALL_PATH"
open "$INSTALL_PATH"

echo "✅ Update applied and app restarted"
echo "   Built at: $(date)"
