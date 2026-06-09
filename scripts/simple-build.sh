#!/bin/bash
# Simple linear build script for Nexus Cortex
# Tests if circular dependency is truly eliminated after /types refactor
# Location: scripts/simple-build.sh
# Usage: bash scripts/simple-build.sh

set -e  # Exit on error

# Add nix to PATH if available
if [ -d "$HOME/.nix-profile/bin" ]; then
  export PATH="$HOME/.nix-profile/bin:$PATH"
fi

# Ensure we're in the root directory
cd "$(dirname "$0")/.."

echo "🧹 Cleaning build artifacts..."
rm -rf packages/types/dist packages/core/dist packages/executors/dist packages/server/dist packages/cli/dist

echo "📦 Building types package..."
cd packages/types && npm run build && cd ../..

echo "📦 Building executors package..."
cd packages/executors && npm run build && cd ../..

echo "📦 Building core package (includes system message copy)..."
cd packages/core && npm run build && cd ../..

echo "📦 Building server..."
cd packages/server && npm run build && cd ../..

echo "📦 Building CLI..."
cd packages/cli && npm run build && cd ../..

echo "✅ Build complete!"
echo ""
echo "Server ready: cd packages/server && node dist/index.js"
echo "CLI ready: cd packages/cli && node dist/index.js"
