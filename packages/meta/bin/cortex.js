#!/usr/bin/env node
// nexus-cortex (meta-package) — delegates to the real `cortex` bin in @nexus-cortex/cli,
// which is installed as a dependency. Args flow through via the shared process.argv.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
await import(pathToFileURL(require.resolve('@nexus-cortex/cli/bin/cortex.js')).href);
