#!/bin/bash
# Test Server Startup Script
# Starts server with YOLO=false for permission testing
# Usage: ./scripts/test-server.sh

set -e  # Exit on error

# Add nix to PATH if available
if [ -d "$HOME/.nix-profile/bin" ]; then
  export PATH="$HOME/.nix-profile/bin:$PATH"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🧪 Starting Nexus Cortex Test Server"
echo "============================================="
echo ""
echo "Purpose: Test auto-approve actions feature"
echo "Mode: YOLO=false (permissions ENABLED)"
echo ""

# Build first
echo "📦 Building project..."
cd "$ROOT_DIR"
./scripts/quick-build.sh
echo ""

# Start server WITHOUT YOLO
echo "🔥 Starting test server..."
echo ""
echo "Server Configuration:"
echo "  Port: 4000"
echo "  YOLO Mode: FALSE (permissions enabled)"
echo "  Debug: TRUE (shows permission logs)"
echo "  Auto-Approve: Based on interactive/piped context"
echo ""
echo "Available Endpoints:"
echo "  GET  /health              - Server health"
echo "  GET  /v1/approval-mode    - Get approval mode"
echo "  POST /v1/approval-mode    - Toggle auto-approve"
echo "  POST /v1/messages         - Main LLM endpoint"
echo ""
echo "Testing Guide: TESTING_AUTO_APPROVE_ACTIONS.md"
echo ""
echo "Press Ctrl+C to stop the server"
echo "============================================="
echo ""

# Start with YOLO=false and DEBUG=true
cd "$ROOT_DIR/packages/server"
YOLO=false DEBUG=true npm run dev
