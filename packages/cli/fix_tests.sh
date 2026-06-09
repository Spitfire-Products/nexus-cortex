#!/bin/bash

# Script to systematically fix all remaining test files
# The pattern: Most tests were using mockPost/object parameters when implementations use mockGet/string parameters

cd /home/runner/workspace/nexus-cortex/packages/cli

echo "Fixing remaining test files..."

# Fix context/strategy.test.ts - uses both GET and POST
echo "Fix context/strategy.test.ts..."
# Already implemented correctly, just needs parameter adjustments

# Fix permissions/actions.test.ts - uses GET
echo "Fix permissions/actions.test.ts..."
# Already has mockGet, just needs to remove query parameter tests

# Fix retry/stats.test.ts - uses GET
echo "Fix retry/stats.test.ts..."
# Already has mockGet, just needs to remove query parameter tests

# Fix system/view.test.ts - uses GET with path parameter
echo "Fix system/view.test.ts..."
# Needs path parameter in GET calls

# Run tests to see remaining failures
npm test 2>&1 | grep "failed" | head -30
