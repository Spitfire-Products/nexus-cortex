#!/bin/bash
# Quick build script for Nexus Cortex
# Updated: Simplified after types refactor
# Location: scripts/quick-build.sh
# Usage: bash scripts/quick-build.sh

set -e  # Exit on error

# Add nix to PATH if available (for tmux and other nix-installed tools)
if [ -d "$HOME/.nix-profile/bin" ]; then
  export PATH="$HOME/.nix-profile/bin:$PATH"
fi

# Ensure we're in the root directory
cd "$(dirname "$0")/.."

echo "🧹 Cleaning build artifacts..."
rm -rf packages/types/dist packages/core/dist packages/executors/dist packages/server/dist packages/cli/dist

echo "📦 Building types package..."
cd packages/types && npm run build
cd ../..

echo "📦 Building executors package (pass 1 - may show core import errors)..."
cd packages/executors && npm run build 2>&1 | grep -v "@cortex/core" || true
cd ../..

echo "📦 Building core package (includes system message copy)..."
cd packages/core && npm run build
cd ../..

echo "📦 Rebuilding executors package (pass 2 - all imports resolved)..."
cd packages/executors
rm -rf dist  # Clean dist from pass 1
npm run build
cd ../..

echo "📦 Building server..."
cd packages/server && npm run build
cd ../..

echo "📦 Building CLI..."
cd packages/cli && npm run build
cd ../..

echo "✅ Build complete!"
echo ""
echo "Server ready: cd packages/server && node dist/index.js"
echo "CLI ready: cd packages/cli && node dist/index.js"
