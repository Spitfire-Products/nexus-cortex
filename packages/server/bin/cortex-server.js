#!/usr/bin/env node

/**
 * Nexus Cortex - Main startup script
 */

import('../dist/index.js').catch(err => {
  console.error('Failed to start Nexus Cortex:', err);
  process.exit(1);
});
