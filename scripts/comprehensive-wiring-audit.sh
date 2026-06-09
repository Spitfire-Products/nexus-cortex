#!/bin/bash
#
# Comprehensive Wiring Audit Script
# Checks every .ts file to see where it's imported and used
#

set -e

CORE_DIR="packages/core/src"
EXEC_DIR="packages/executors/src"
OUTPUT="/home/runner/workspace/nexus-cortex/COMPLETE_WIRING_AUDIT.md"

echo "# Nexus Cortex Complete Wiring Audit" > "$OUTPUT"
echo "**Generated:** $(date)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "## Executive Summary" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Count files
CORE_COUNT=$(find "$CORE_DIR" -name "*.ts" -type f | grep -v ".test.ts" | grep -v ".spec.ts" | wc -l)
EXEC_COUNT=$(find "$EXEC_DIR" -name "*.ts" -type f 2>/dev/null | grep -v ".test.ts" | grep -v ".spec.ts" | wc -l)
TOTAL_COUNT=$((CORE_COUNT + EXEC_COUNT))

echo "- **Total Files**: $TOTAL_COUNT" >> "$OUTPUT"
echo "  - Core Package: $CORE_COUNT files" >> "$OUTPUT"
echo "  - Executors Package: $EXEC_COUNT files" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Function to check if file is imported
check_imports() {
    local file="$1"
    local package_base="$2"

    # Get filename without extension
    local filename=$(basename "$file" .ts)
    local filepath=$(echo "$file" | sed "s|$package_base/||")
    local filebase=$(dirname "$filepath")

    # Convert to import path
    local import_name="${filebase}/${filename}"
    import_name=$(echo "$import_name" | sed 's|^\./||')

    # Search for imports in both packages
    local import_count=0

    # Check direct imports from this file
    import_count=$(grep -r "from.*${filename}.js" "$CORE_DIR" "$EXEC_DIR" 2>/dev/null | grep -v "$file:" | grep -v ".test.ts:" | wc -l)

    # Also check for imports from directory index
    if [[ "$filename" == "index" ]]; then
        local dir_name=$(basename "$filebase")
        local dir_imports=$(grep -r "from.*${dir_name}'" "$CORE_DIR" "$EXEC_DIR" 2>/dev/null | grep -v "$file:" | grep -v ".test.ts:" | wc -l)
        import_count=$((import_count + dir_imports))
    fi

    echo "$import_count"
}

# Function to get file category
get_category() {
    local file="$1"

    if [[ "$file" == *"/index.ts" ]]; then
        echo "BARREL_EXPORT"
    elif [[ "$file" == *".interface.ts" ]]; then
        echo "INTERFACE"
    elif [[ "$file" == */types/* ]]; then
        echo "TYPE_DEFINITION"
    elif [[ "$file" == */cards/* ]]; then
        echo "MODEL_CARD"
    elif [[ "$file" == */configurators/* ]]; then
        echo "CONFIGURATOR"
    elif [[ "$file" == */implementations/* ]]; then
        echo "EXECUTOR_IMPL"
    elif [[ "$file" == *"Factory.ts" ]] || [[ "$file" == *"Registry.ts" ]]; then
        echo "SINGLETON"
    elif [[ "$file" == */utils/* ]]; then
        echo "UTILITY"
    elif [[ "$file" == */adapters/* ]]; then
        echo "ADAPTER"
    elif [[ "$file" == */tools/* ]]; then
        echo "TOOL_DEF"
    elif [[ "$file" == *"test"* ]] || [[ "$file" == *"__tests__"* ]]; then
        echo "TEST_FIXTURE"
    else
        echo "COMPONENT"
    fi
}

echo "## Detailed Analysis" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Counters
WIRED=0
ORPHANED=0
TYPE_ONLY=0

# Arrays to hold orphaned files
declare -a ORPHANED_FILES
declare -a UNDERUSED_FILES

echo "### Core Package Files ($CORE_COUNT files)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| File | Category | Imports | Status |" >> "$OUTPUT"
echo "|------|----------|---------|--------|" >> "$OUTPUT"

# Process core files
while IFS= read -r file; do
    category=$(get_category "$file")
    import_count=$(check_imports "$file" "$CORE_DIR")

    # Determine status
    if [[ "$category" == "INTERFACE" ]] || [[ "$category" == "TYPE_DEFINITION" ]]; then
        status="TYPE_ONLY"
        TYPE_ONLY=$((TYPE_ONLY + 1))
    elif [[ "$import_count" -eq 0 ]]; then
        status="⚠️ ORPHANED"
        ORPHANED=$((ORPHANED + 1))
        ORPHANED_FILES+=("$file")
    elif [[ "$import_count" -lt 2 ]] && [[ "$category" != "BARREL_EXPORT" ]] && [[ "$category" != "MODEL_CARD" ]]; then
        status="⚠️ UNDERUSED"
        UNDERUSED_FILES+=("$file")
        WIRED=$((WIRED + 1))
    else
        status="✅ WIRED"
        WIRED=$((WIRED + 1))
    fi

    # Shorten filename for readability
    short_file=$(echo "$file" | sed "s|packages/core/src/||")

    echo "| $short_file | $category | $import_count | $status |" >> "$OUTPUT"

done < <(find "$CORE_DIR" -name "*.ts" -type f | grep -v ".test.ts" | grep -v ".spec.ts" | sort)

echo "" >> "$OUTPUT"
echo "### Executors Package Files ($EXEC_COUNT files)" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| File | Category | Imports | Status |" >> "$OUTPUT"
echo "|------|----------|---------|--------|" >> "$OUTPUT"

# Process executor files
while IFS= read -r file; do
    category=$(get_category "$file")
    import_count=$(check_imports "$file" "$EXEC_DIR")

    # Determine status
    if [[ "$category" == "INTERFACE" ]] || [[ "$category" == "TYPE_DEFINITION" ]]; then
        status="TYPE_ONLY"
        TYPE_ONLY=$((TYPE_ONLY + 1))
    elif [[ "$import_count" -eq 0 ]]; then
        status="⚠️ ORPHANED"
        ORPHANED=$((ORPHANED + 1))
        ORPHANED_FILES+=("$file")
    elif [[ "$import_count" -lt 2 ]] && [[ "$category" != "BARREL_EXPORT" ]] && [[ "$category" == "EXECUTOR_IMPL" ]]; then
        status="⚠️ UNDERUSED"
        UNDERUSED_FILES+=("$file")
        WIRED=$((WIRED + 1))
    else
        status="✅ WIRED"
        WIRED=$((WIRED + 1))
    fi

    # Shorten filename for readability
    short_file=$(echo "$file" | sed "s|packages/executors/src/||")

    echo "| $short_file | $category | $import_count | $status |" >> "$OUTPUT"

done < <(find "$EXEC_DIR" -name "*.ts" -type f 2>/dev/null | grep -v ".test.ts" | grep -v ".spec.ts" | sort)

echo "" >> "$OUTPUT"

# Summary stats
echo "## Summary Statistics" >> "$OUTPUT"
echo "" >> "$OUTPUT"
echo "| Status | Count | Percentage |" >> "$OUTPUT"
echo "|--------|-------|------------|" >> "$OUTPUT"

WIRED_PCT=$(( (WIRED * 100) / TOTAL_COUNT ))
ORPHANED_PCT=$(( (ORPHANED * 100) / TOTAL_COUNT ))
TYPE_PCT=$(( (TYPE_ONLY * 100) / TOTAL_COUNT ))

echo "| ✅ Wired | $WIRED | ${WIRED_PCT}% |" >> "$OUTPUT"
echo "| ⚠️ Orphaned | $ORPHANED | ${ORPHANED_PCT}% |" >> "$OUTPUT"
echo "| 📘 Type-Only | $TYPE_ONLY | ${TYPE_PCT}% |" >> "$OUTPUT"
echo "| **Total** | **$TOTAL_COUNT** | **100%** |" >> "$OUTPUT"

echo "" >> "$OUTPUT"

# List orphaned files
if [ ${#ORPHANED_FILES[@]} -gt 0 ]; then
    echo "## 🚨 Orphaned Files (Not Imported Anywhere)" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    echo "These files are not imported by any other file and may be dead code:" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    for orphaned_file in "${ORPHANED_FILES[@]}"; do
        echo "- \`$orphaned_file\`" >> "$OUTPUT"
    done
    echo "" >> "$OUTPUT"
fi

# List underused files
if [ ${#UNDERUSED_FILES[@]} -gt 0 ]; then
    echo "## ⚠️ Underused Files (Single Import Only)" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    echo "These files have only 1 import and may need review:" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
    for underused_file in "${UNDERUSED_FILES[@]}"; do
        echo "- \`$underused_file\`" >> "$OUTPUT"
    done
    echo "" >> "$OUTPUT"
fi

echo "Report generated: $OUTPUT"
