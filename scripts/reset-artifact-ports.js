const fs = require('fs');
const path = require('path');

// Read registry
const registryPath = path.join(__dirname, '..', '.nexus-cortex', 'artifacts', 'registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));

// Clear all port assignments but keep artifacts
let portCounter = 3000;
for (const id in registry.artifacts) {
  const artifact = registry.artifacts[id];
  // Assign sequential ports
  artifact.port = portCounter;
  artifact.url = `http://localhost:${portCounter}`;
  portCounter++;
  console.log(`✅ ${artifact.name} → port ${artifact.port}`);
}

// Save updated registry
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
console.log(`\n✅ Updated ${Object.keys(registry.artifacts).length} artifacts with sequential ports`);
