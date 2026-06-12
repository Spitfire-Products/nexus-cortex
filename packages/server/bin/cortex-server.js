#!/usr/bin/env node

/**
 * Nexus Cortex - Main startup script.
 * Imports the server module and starts it EXPLICITLY: when loaded through this
 * wrapper, the module's own direct-run check (realpath of argv[1]) points at
 * this file, not the module — so the wrapper must call main().
 */

import('../dist/index.js')
  .then((m) => m.main())
  .catch(err => {
    console.error('Failed to start Nexus Cortex:', err);
    process.exit(1);
  });
