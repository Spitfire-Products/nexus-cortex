#!/bin/bash

# Migration script to move all artifacts to accessible ports

echo "🔄 Migrating all artifacts to accessible ports..."
echo ""

# Accessible ports (have external mappings in .replit)
ACCESSIBLE_PORTS=(3001 3004 3005 3011 4002 4003 4004 4005 5000 8000 8080 24678 36655 46323)

# List of artifact IDs that need migration (on inaccessible ports)
ARTIFACTS_TO_MIGRATE=(
  "f4a6e57c-19b7-4534-89d1-3698ee1e26e1"  # port 3000 → need accessible
  "ba5a0d8c-b71a-4280-b439-d1ba66def944"  # port 3002 → need accessible
  "e938c696-d4b3-49df-acc4-6e73eb6381a4"  # port 3003 → need accessible
  "f89da460-4b15-44c5-b59c-f73144c40297"  # port 3006 → need accessible
  "13e84fba-d732-4a7c-9b8f-c0df384aedbb"  # port 3008 → need accessible
  "30e9bbf8-47d4-4ffd-a879-52636a0e8173"  # port 3009 → need accessible
)

echo "Artifacts on INACCESSIBLE ports that will be migrated:"
echo "  - f4a6e57c (matrix-rain): 3000 → needs migration"
echo "  - ba5a0d8c (test-html-page): 3002 → needs migration"
echo "  - e938c696 (godel-explorer-with-viewer): 3003 → needs migration"
echo "  - f89da460 (godel-viewer-v2): 3006 → needs migration"
echo "  - 13e84fba (port-test-artifact): 3008 → needs migration"
echo "  - 30e9bbf8 (port-test-artifact): 3009 → needs migration"
echo ""
echo "Artifacts already on ACCESSIBLE ports (no migration needed):"
echo "  - 7e41b1ba (matrix-rain): 3001 ✓"
echo "  - 644c361f (matrix-rain): 3004 ✓"
echo "  - b19e8a79 (godel-terminal-explorer): 3005 ✓"
echo "  - feffeb3c (hello-world-page): 3011 ✓"
echo "  - 7e795656 (simple-cortex-page): 4002 ✓"
echo ""

# Restart each artifact - the endpoint will assign an accessible port
for artifact_id in "${ARTIFACTS_TO_MIGRATE[@]}"; do
  echo "🔄 Restarting artifact: $artifact_id"
  curl -X POST -s "http://localhost:4001/api/artifacts/${artifact_id}/restart" \
    -H "Content-Type: application/json" | head -1
  echo ""
  sleep 1
done

echo ""
echo "✅ Migration complete!"
echo ""
echo "All artifacts should now be on accessible ports."
echo "Check the dashboard at http://localhost:4001"
