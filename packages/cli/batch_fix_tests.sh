#!/bin/bash
# Batch fix remaining test files - systematic approach
# All changes preserve test structure, only fix API call expectations

cd /home/runner/workspace/nexus-cortex/packages/cli

echo "Fixing remaining test files systematically..."

# The remaining files all follow similar patterns - tests need to:
# 1. Use correct mock (mockGet vs mockPost)
# 2. Match actual API endpoints
# 3. Remove unsupported query parameters
# 4. Use correct parameter formats

echo "✓ Already fixed: 11 files"
echo "TODO: Need manual fixes for 14 remaining files"
echo ""
echo "Remaining files pattern:"
echo "  - Simple GET: permissions/actions, retry/stats, models/favorites, dashboard/main,"
echo "                permissions/policies, context/status, retry/status, system/list, models/providers"
echo "  - GET with path: system/view"
echo "  - POST: context/compact, config/validate, server/stop, context/boundaries"
echo ""
echo "Run tests to see current status:"
npm test 2>&1 | grep -E "Test Files|Tests" | head -5
