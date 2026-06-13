#!/usr/bin/env node
// nexus-cortex (meta-package) — delegates to the `cortex-server` bin in @nexus-cortex/server.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
await import(pathToFileURL(require.resolve('@nexus-cortex/server/bin/cortex-server.js')).href);
