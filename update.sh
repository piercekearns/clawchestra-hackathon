#!/bin/bash
# Pipeline Dashboard - Update Script
# Run this to rebuild the app with latest changes

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Pipeline Dashboard"
BUNDLE_PATH="$SCRIPT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME.app"
INSTALL_PATH="/Applications/$APP_NAME.app"

echo "🔨 Building Pipeline Dashboard..."
cd "$SCRIPT_DIR"

# Ensure cargo and pnpm are in PATH
source ~/.cargo/env 2>/dev/null || true
export PATH="/opt/homebrew/bin:$PATH"

# Build the app bundle only (skip DMG - faster and doesn't pop open)
pnpm tauri build --bundles app

if [ -d "$BUNDLE_PATH" ]; then
    echo "📦 Installing to /Applications..."
    
    # Remove old version
    if [ -d "$INSTALL_PATH" ]; then
        rm -rf "$INSTALL_PATH"
    fi
    
    # Copy new version
    cp -R "$BUNDLE_PATH" "$INSTALL_PATH"
    
    echo "✅ Updated! Restarting app..."
    echo "   Built at: $(date)"
    
    # Kill old app and open new one
    killall "pipeline-dashboard" 2>/dev/null || true
    sleep 0.5
    open "/Applications/$APP_NAME.app"
else
    echo "❌ Build failed - no app bundle found"
    exit 1
fi
