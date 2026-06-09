#!/bin/bash

# check-dependencies.sh
# Verifies all system and Node.js dependencies for Nexus Cortex

set -e

echo "🔍 Nexus Cortex Dependency Check"
echo "=================================="
echo

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

REQUIRED_ISSUES=0
OPTIONAL_ISSUES=0

# Check function
check_required() {
  local name=$1
  local command=$2

  if eval "$command" &>/dev/null; then
    local version=$(eval "$command" 2>/dev/null || echo "unknown")
    echo -e "${GREEN}✅${NC} $name: $version"
    return 0
  else
    echo -e "${RED}❌${NC} $name: Not found (REQUIRED)"
    ((REQUIRED_ISSUES++))
    return 1
  fi
}

check_optional() {
  local name=$1
  local command=$2
  local purpose=$3

  if eval "$command" &>/dev/null; then
    local version=$(eval "$command" 2>/dev/null || echo "installed")
    echo -e "${GREEN}✅${NC} $name: $version"
    return 0
  else
    echo -e "${YELLOW}⚠️${NC}  $name: Not found (optional - $purpose)"
    ((OPTIONAL_ISSUES++))
    return 1
  fi
}

echo "Required Dependencies"
echo "---------------------"

# Node.js
check_required "Node.js" "node --version"

# npm
check_required "npm" "npm --version"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}❌${NC} Not in nexus-cortex directory!"
  echo "Please run from: nexus-cortex/"
  exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}⚠️${NC}  node_modules not found - run 'npm install' first"
  REQUIRED_ISSUES=$((REQUIRED_ISSUES + 1))
else
  check_required "Dependencies installed" "test -d node_modules"
fi

# Playwright package
if [ -d "packages/executors/node_modules/playwright" ] || [ -d "node_modules/playwright" ]; then
  PLAYWRIGHT_VERSION=$(npm list playwright 2>/dev/null | grep playwright@ | head -n1 | sed 's/.*playwright@//' | sed 's/ .*//' || echo "installed")
  echo -e "${GREEN}✅${NC} Playwright package: $PLAYWRIGHT_VERSION"
else
  echo -e "${RED}❌${NC} Playwright package: Not found in node_modules"
  REQUIRED_ISSUES=$((REQUIRED_ISSUES + 1))
fi

echo
echo "Highly Recommended"
echo "------------------"

# Chromium
if npx playwright install --dry-run chromium 2>&1 | grep -q "is already installed"; then
  echo -e "${GREEN}✅${NC} Chromium browser: Installed"
elif [ -f "$HOME/.cache/ms-playwright/chromium-1194/chrome-linux/chrome" ]; then
  echo -e "${GREEN}✅${NC} Chromium browser: Installed (detected manually)"
else
  echo -e "${YELLOW}⚠️${NC}  Chromium browser: Not found"
  echo "   Install with: npx playwright install chromium"
  OPTIONAL_ISSUES=$((OPTIONAL_ISSUES + 1))
fi

echo
echo "Optional Features"
echo "-----------------"

# Tmux
if command -v tmux &>/dev/null; then
  TMUX_VERSION=$(tmux -V 2>/dev/null || echo "installed")
  echo -e "${GREEN}✅${NC} Tmux: $TMUX_VERSION"
else
  echo -e "${YELLOW}⚠️${NC}  Tmux: Not found (enables persistent terminal sessions)"
  echo "   Ubuntu/Debian: apt-get install tmux"
  echo "   macOS: brew install tmux"
  OPTIONAL_ISSUES=$((OPTIONAL_ISSUES + 1))
fi

# Docker
check_optional "Docker" "docker --version" "future sandboxing feature"

echo
echo "=================================="

# Summary
if [ $REQUIRED_ISSUES -eq 0 ]; then
  echo -e "${GREEN}✅ All required dependencies met!${NC}"
else
  echo -e "${RED}❌ $REQUIRED_ISSUES required dependencies missing${NC}"
fi

if [ $OPTIONAL_ISSUES -gt 0 ]; then
  echo -e "${YELLOW}⚠️  $OPTIONAL_ISSUES optional dependencies missing${NC}"
fi

echo
echo "Status Summary:"
echo "---------------"

# Determine overall status
if [ $REQUIRED_ISSUES -eq 0 ]; then
  if [ -f "$HOME/.cache/ms-playwright/chromium-1194/chrome-linux/chrome" ] || npx playwright install --dry-run chromium 2>&1 | grep -q "is already installed"; then
    if command -v tmux &>/dev/null; then
      echo "🎉 FULLY READY - All features available"
    else
      echo "✅ READY FOR DEVELOPMENT - Core + visual features available"
      echo "   (Tmux optional for persistent sessions)"
    fi
  else
    echo "✅ READY FOR CORE FEATURES"
    echo "   Run: npx playwright install chromium (for visual features)"
  fi
else
  echo "❌ NOT READY - Install missing required dependencies"
  exit 1
fi

echo
echo "To start development:"
echo "  npm run build    # Build TypeScript"
echo "  npm start        # Start server"
echo

exit 0
