#!/usr/bin/env node
// nexus-cortex (meta-package) — delegates to the `cortex-launch` bin in @nexus-cortex/tui (the React/Ink terminal UIs),
// which is installed as a dependency so `npm install -g nexus-cortex` / `cortex update` carry the TUIs too (2026-10-18).
// Args flow through via the shared process.argv.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
await import(pathToFileURL(require.resolve('@nexus-cortex/tui/bin/launcher.js')).href);
