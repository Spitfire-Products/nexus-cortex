import { createExecutorRegistry } from './dist/index.js';

const registry = createExecutorRegistry({
  workingDirectory: process.cwd(),
  enableSandbox: false,
  allowedCommands: []
});

const stopSandbox = registry.getExecutor('StopSandbox');
const createAddonEnhanced = registry.getExecutor('CreateAddonEnhanced');

console.log('✅ StopSandbox registered:', !!stopSandbox);
if (stopSandbox) {
  console.log('   Tool name:', stopSandbox.name);
  console.log('   Display name:', stopSandbox.displayName);
  console.log('   Description:', stopSandbox.description.substring(0, 60) + '...');
}

console.log('\n✅ CreateAddonEnhanced registered:', !!createAddonEnhanced);
if (createAddonEnhanced) {
  console.log('   Tool name:', createAddonEnhanced.name);
  console.log('   Display name:', createAddonEnhanced.displayName);
  console.log('   Description:', createAddonEnhanced.description.substring(0, 60) + '...');
}

if (!stopSandbox || !createAddonEnhanced) {
  console.log('\n❌ Missing registrations!');
  process.exit(1);
}

console.log('\n✅ Both addon executors successfully registered!');
