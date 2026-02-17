#!/bin/bash
# Clawchestra - Update Script
# Run this to rebuild the app with latest changes.
# Triggered by the in-app Update button.
# Builds in the background, then replaces the installed app and restarts it.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Clawchestra"
OLD_APP_NAME="Pipeline Dashboard"
BUNDLE_PATH="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
INSTALL_PATH="${PIPELINE_DASHBOARD_INSTALL_PATH:-/Applications/$APP_NAME.app}"
OLD_INSTALL_PATH="/Applications/$OLD_APP_NAME.app"
RESTART_AFTER_BUILD="${PIPELINE_DASHBOARD_RESTART_AFTER_BUILD:-1}"
LOCK_DIR="/tmp/pipeline-dashboard-update.lock"
LOCK_PID_FILE="$LOCK_DIR/pid"

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID_FILE"
    return 0
  fi

  # Lock exists. If the process is still alive, another update is running.
  if [ -f "$LOCK_PID_FILE" ]; then
    EXISTING_PID="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
    if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
      echo "ℹ️ Update already in progress (pid $EXISTING_PID)."
      exit 0
    fi
  fi

  # Stale lock: clear and retry once.
  rm -rf "$LOCK_DIR"
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_PID_FILE"
    return 0
  fi

  echo "❌ Could not acquire update lock."
  exit 1
}

cleanup_lock() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

acquire_lock
trap cleanup_lock EXIT

echo "🔨 Building Clawchestra..."
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
# Kill both old and new names during transition
killall "pipeline-dashboard" 2>/dev/null || true
killall "Clawchestra" 2>/dev/null || true
sleep 0.5
# Clean up old-name install if it exists
if [ -d "$OLD_INSTALL_PATH" ] && [ "$OLD_INSTALL_PATH" != "$INSTALL_PATH" ]; then
  echo "🧹 Removing old Pipeline Dashboard install..."
  rm -rf "$OLD_INSTALL_PATH"
fi
rm -rf "$INSTALL_PATH"
mv "$STAGED_PATH" "$INSTALL_PATH"
open "$INSTALL_PATH"

echo "✅ Update applied and app restarted"
echo "   Built at: $(date)"
