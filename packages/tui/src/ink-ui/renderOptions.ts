/**
 * Ink render options for the TUIs (R265 TUI-STREAM-FLICKER, 2026-10-19).
 *
 * Ink's default writer erases and rewrites the WHOLE dynamic region on every frame (up to
 * 30 fps) — on a streaming turn that is the flicker; incrementalRendering rewrites only the
 * lines that changed. Levers (core SettingsSchema): CORTEX_TUI_INCREMENTAL_RENDER ('false' =
 * legacy), CORTEX_TUI_MAX_FPS (default 20; 0 = unthrottled). Read from process.env after
 * bootstrapEnv so the .env chain applies.
 */
export interface TuiRenderOptions {
  incrementalRendering: boolean;
  maxFps: number;
}

export function tuiRenderOptions(env: NodeJS.ProcessEnv = process.env): TuiRenderOptions {
  const inc = (env.CORTEX_TUI_INCREMENTAL_RENDER ?? '').trim().toLowerCase();
  const fpsRaw = Number((env.CORTEX_TUI_MAX_FPS ?? '').trim());
  return {
    incrementalRendering: !(inc === 'false' || inc === '0' || inc === 'off'),
    maxFps: Number.isFinite(fpsRaw) && (env.CORTEX_TUI_MAX_FPS ?? '').trim() !== '' ? Math.max(0, Math.floor(fpsRaw)) : 20,
  };
}

/**
 * Lines the live streaming turn may occupy: rows − reserve − siblings (R265). 0 reserve = no cap (Infinity).
 * `siblingRows` = the height of everything else in Ink's dynamic region right now (approval dialog, sub-agent
 * panel): Ink clears the WHOLE terminal and rewrites the full history on every frame once the dynamic region
 * reaches `rows` (ink.js `lastOutputHeight >= stdout.rows` → clearTerminal), so the sum must stay below it.
 */
export function streamViewportBudget(rows: number | undefined, env: NodeJS.ProcessEnv = process.env, siblingRows = 0): number {
  const raw = (env.CORTEX_TUI_STREAM_VIEWPORT_RESERVE ?? '').trim();
  const reserve = raw === '' ? 12 : Math.max(0, Math.floor(Number(raw)) || 0);
  if (reserve === 0) return Number.POSITIVE_INFINITY;
  return Math.max(4, (rows && rows > 0 ? rows : 24) - reserve - Math.max(0, Math.floor(siblingRows)));
}
