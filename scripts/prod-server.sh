#!/bin/bash
# Production Server Startup Script
# Follows BUILD_GUIDE.md proper build order
# Usage: ./scripts/prod-server.sh

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting Nexus Cortex Production Server"
echo "============================================="
echo ""
echo "Build Order (per BUILD_GUIDE.md):"
echo "  1. Clean all dist/ directories"
echo "  2. Build @cortex/core"
echo "  3. Build @cortex/executors (with clean)"
echo "  4. Build @cortex/server"
echo "  5. Start production server"
echo ""

# Navigate to root
cd "$ROOT_DIR"

# Step 1: Clean all dist directories
echo "📦 Step 1: Cleaning dist/ directories..."
rm -rf packages/core/dist
rm -rf packages/executors/dist
rm -rf packages/server/dist
echo "✅ Clean complete"
echo ""

# Step 2: Build core package
echo "📦 Step 2: Building @cortex/core..."
cd packages/core
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Core build failed"
    exit 1
fi
echo "✅ Core built successfully"
echo ""

# Step 3: Build executors package (with clean)
echo "📦 Step 3: Building @cortex/executors..."
cd "$ROOT_DIR/packages/executors"
rm -rf dist  # Extra clean for circular dependency
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Executors build failed"
    exit 1
fi
echo "✅ Executors built successfully"
echo ""

# Step 4: Build server package
echo "📦 Step 4: Building @cortex/server..."
cd "$ROOT_DIR/packages/server"
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Server build failed"
    exit 1
fi
echo "✅ Server built successfully"
echo ""

# Copy system message files (TypeScript doesn't copy .json/.md)
echo "📄 Copying system message files..."
cd "$ROOT_DIR"
mkdir -p packages/core/dist/system-messages/messages
cp -r packages/core/src/system-messages/* packages/core/dist/system-messages/
echo "✅ System messages copied"
echo ""

# Step 5: Start production server
echo "🚀 Step 5: Starting production server..."
echo ""
echo "Server Configuration:"
echo "  Port: 4000"
echo "  Mode: Production (node dist/index.js)"
echo "  API Base: http://localhost:4000"
echo ""
echo "Available Endpoints:"
echo "  GET  /health         - Server health and model list"
echo "  GET  /models         - List all available models (66 total)"
echo "  POST /v1/messages    - Main LLM endpoint"
echo ""
echo "⚠️  NOTE: Production mode currently has module resolution issues"
echo "    Recommended: Use dev-server.sh for now"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================================="
echo ""

# Start production server
cd "$ROOT_DIR/packages/server"
npm start
