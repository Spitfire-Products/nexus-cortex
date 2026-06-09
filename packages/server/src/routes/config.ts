/**
 * /config routes — read and write .env settings via HTTP
 *
 * GET  /config        — summary (providers, model, debug, mentorship)
 * GET  /config/keys   — list all setting keys
 * GET  /config/:key   — get single value (masks secrets)
 * PUT  /config/:key   — set value, hot-apply when possible
 */
import { Router, Request, Response } from 'express';
import {
  SettingsLoader,
  SettingsWriter,
  SETTINGS_METADATA,
  getRuntimeConfigEntry,
  isLiveToggleable,
} from '@nexus-cortex/core';
import { getServerOrchestrator } from './messages.js';

export const configRouter = Router();

function getProjectPath(): string {
  return process.env.PROJECT_PATH || process.cwd();
}

configRouter.get('/config', (req: Request, res: Response) => {
  try {
    const loader = new SettingsLoader(getProjectPath());
    const summary = loader.getSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

configRouter.get('/config/keys', (_req: Request, res: Response) => {
  const keys = SETTINGS_METADATA.map(s => s.key);
  res.json({ keys });
});

configRouter.get('/config/:key', (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const meta = SETTINGS_METADATA.find(s => s.key === key);
    const loader = new SettingsLoader(getProjectPath());
    const value = loader.get(key as any) || process.env[key] || '';

    const masked = meta?.secret && value.length > 8
      ? value.substring(0, 4) + '...' + value.substring(value.length - 4)
      : value;

    res.json({ key, value: masked, live: isLiveToggleable(key) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

configRouter.put('/config/:key', (req: Request, res: Response) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      res.status(400).json({ error: 'Missing "value" in request body' });
      return;
    }

    const writer = new SettingsWriter(getProjectPath());
    writer.update({ [key]: String(value) } as any);
    process.env[key] = String(value);

    const entry = getRuntimeConfigEntry(key);
    if (entry?.tier === 'config' && entry.mapper) {
      const orchestrator = getServerOrchestrator();
      if (orchestrator) {
        orchestrator.updateRuntimeConfig(entry.mapper(String(value)));
      }
    }

    const live = isLiveToggleable(key);
    res.json({ key, value: String(value), live, applied: live });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
