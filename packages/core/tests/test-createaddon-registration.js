/**
 * Quick test to verify CreateAddonTool is registered
 */

import { createExecutorRegistry } from './dist/tools/ExecutorRegistry.js';

const config = {
  workingDirectory: '/tmp/test',
  enableSandbox: false,
  allowedCommands: []
};

const registry = createExecutorRegistry(config);

console.log('Total executors registered:', registry.getExecutorCount());
console.log('');

// Check if CreateAddonTool is registered
const hasCreateAddon = registry.hasExecutor('CreateAddonTool');
console.log('✓ CreateAddonTool registered:', hasCreateAddon);

if (hasCreateAddon) {
  const executor = registry.getExecutor('CreateAddonTool');
  console.log('  - Name:', executor.name);
  console.log('  - Display Name:', executor.displayName);
  console.log('  - Description:', executor.description.substring(0, 60) + '...');
}

// Check other addon tools
console.log('');
console.log('Other addon tools:');
const addonTools = [
  'CreateAddonTool',
  'InteractWithSandbox',
  'ModifySandbox',
  'InspectSandbox',
  'StopSandbox'
];

addonTools.forEach(toolName => {
  const registered = registry.hasExecutor(toolName);
  console.log(`  ${registered ? '✓' : '✗'} ${toolName}`);
});

console.log('');
console.log('All registered tool names:');
console.log(registry.getExecutorNames().sort().join(', '));
