#!/bin/bash
# Nexus Cortex Build Script
# Builds all packages in dependency order
# Updated: 2025-11-16
# Location: scripts/build.sh
# Usage: bash scripts/build.sh

set -e  # Exit on error

# Add nix to PATH if available
if [ -d "$HOME/.nix-profile/bin" ]; then
  export PATH="$HOME/.nix-profile/bin:$PATH"
fi

# Ensure we're in the root directory
cd "$(dirname "$0")/.."

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXUS CORTEX BUILD SYSTEM"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Clean all build artifacts
echo "Cleaning Nexus Cortex build artifacts..."
rm -rf packages/types/dist \
       packages/executors/dist \
       packages/core/dist \
       packages/server/dist \
       packages/cli/dist \
       packages/tui/dist

# Build types (no dependencies)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[1/6] Building Nexus Cortex Types Package"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd packages/types
npm run build
cd ../..

# Build executors PASS 1 (will fail on core imports - expected)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[2/6] Building Nexus Cortex Executors (Pass 1 - Partial)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd packages/executors
npm run build || true  # Allow errors - partial build is expected
cd ../..

# Build core (includes system message copy via copy-assets)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[3/6] Building Nexus Cortex Core Library"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd packages/core
npm run clean
tsc
npm run copy-assets
cd ../..

# Build executors PASS 2 (now core is available)
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[4/6] Rebuilding Nexus Cortex Executors (Pass 2 - Complete)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd packages/executors
rm -rf dist
npm run build
cd ../..

# Build server
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[5/6] Building Nexus Cortex Server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd packages/server
npm run build
cd ../..

# Build CLI
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[6/7] Building Nexus Cortex CLI (headless)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd packages/cli
npm run build
cd ../..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "[7/7] Building Nexus Cortex TUI (React/Ink) — depends on cli"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -d packages/tui ]; then
  cd packages/tui
  npm run build
  cd ../..
else
  echo "[SKIP] packages/tui not present (Release 2 package — engine-only checkout)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "NEXUS CORTEX BUILD COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Nexus Cortex Build Summary:"
echo "  * Types Package     -> packages/types/dist"
echo "  * Executors Package -> packages/executors/dist"
echo "  * Core Library      -> packages/core/dist (includes system messages)"
echo "  * V4 Server         -> packages/server/dist"
echo "  * V4 CLI            -> packages/cli/dist"
echo ""
bash scripts/link-global.sh || echo "[WARN] global link step skipped"
echo ""
echo "Nexus Cortex Ready to Run:"
echo "  V4 Server: cd packages/server && PORT=4000 node dist/index.js"
echo "  V4 CLI:    cd packages/cli && node dist/index.js"
echo ""
