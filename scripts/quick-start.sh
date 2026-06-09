#!/bin/bash
# Quick Start Script (Skip Build if Already Built)
# Only rebuilds if source files are newer than dist/
# Usage: ./scripts/quick-start.sh

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "⚡ Quick Start Nexus Cortex Server"
echo "===================================="
echo ""

cd "$ROOT_DIR"

# Function to check if rebuild is needed
needs_rebuild() {
    local package=$1
    local src_dir="$ROOT_DIR/packages/$package/src"
    local dist_dir="$ROOT_DIR/packages/$package/dist"

    # If dist doesn't exist, rebuild needed
    if [ ! -d "$dist_dir" ]; then
        return 0  # true (needs rebuild)
    fi

    # Check if any src file is newer than dist
    if [ -n "$(find "$src_dir" -newer "$dist_dir" -type f 2>/dev/null)" ]; then
        return 0  # true (needs rebuild)
    fi

    return 1  # false (no rebuild needed)
}

# Check core
echo "Checking @cortex/core..."
if needs_rebuild "core"; then
    echo "  ↻ Source changed, rebuilding..."
    cd packages/core && npm run build > /dev/null 2>&1
    echo "  ✅ Core rebuilt"
else
    echo "  ✅ Core up-to-date"
fi
echo ""

# Check executors
echo "Checking @cortex/executors..."
if needs_rebuild "executors"; then
    echo "  ↻ Source changed, rebuilding..."
    cd "$ROOT_DIR/packages/executors"
    rm -rf dist
    npm run build > /dev/null 2>&1
    echo "  ✅ Executors rebuilt"
else
    echo "  ✅ Executors up-to-date"
fi
echo ""

# Check server
echo "Checking @cortex/server..."
if needs_rebuild "server"; then
    echo "  ↻ Source changed, rebuilding..."
    cd "$ROOT_DIR/packages/server" && npm run build > /dev/null 2>&1
    echo "  ✅ Server rebuilt"
else
    echo "  ✅ Server up-to-date"
fi
echo ""

# Always copy system message files (they might have changed)
echo "Checking system message files..."
mkdir -p "$ROOT_DIR/packages/core/dist/system-messages/messages"
cp -r "$ROOT_DIR/packages/core/src/system-messages/"* "$ROOT_DIR/packages/core/dist/system-messages/"
echo "  ✅ System messages synchronized"
echo ""

# Start server
echo "🚀 Starting server on http://localhost:4000"
echo "Press Ctrl+C to stop"
echo "===================================="
echo ""

cd "$ROOT_DIR/packages/server"
npm run dev
