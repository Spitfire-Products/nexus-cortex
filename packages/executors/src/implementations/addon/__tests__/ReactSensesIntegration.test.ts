/**
 * Phase-3 React senses integration: SandboxComponentTree + SandboxRenderTrace against a
 * REAL bundled React app (esbuild) served by http-server and driven through Chromium.
 * Skips automatically when esbuild/react or Chromium are unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { buildReactArtifact } from '../ReactArtifactBuilder.js';
import { VisualFeedbackBridge } from '../VisualFeedbackBridge.js';
import { getChromiumBinary } from '../../../utils/ChromiumBrowserManager.js';

const require_ = createRequire(import.meta.url);
const HAS_ESBUILD = (() => { try { require_.resolve('esbuild'); require_.resolve('react'); return true; } catch { return false; } })();
const HAS_CHROMIUM = !!getChromiumBinary();
const RUN = HAS_ESBUILD && HAS_CHROMIUM;

const PORT = 3486;
const COUNTER_APP = `import { useState } from 'react';
function Counter(){ const [n,setN]=useState(0); return <button id="c" onClick={()=>setN(n+1)}>Count: {n}</button>; }
function App(){ return <div><h1>Demo</h1><Counter/></div>; }
export default App;`;

describe.skipIf(!RUN)('React senses (tree + render trace) integration', () => {
  let dir: string;
  let srv: ChildProcess;
  let bridge: VisualFeedbackBridge;
  const url = `http://localhost:${PORT}`;

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'react-senses-'));
    await buildReactArtifact(dir, { code: COUNTER_APP, reactMode: 'bundled' });
    srv = spawn('npx', ['http-server', dir, '-p', String(PORT), '-c-1', '--silent'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 2500));
    bridge = new VisualFeedbackBridge();
    await bridge.initialize();
  }, 60000);

  afterAll(async () => {
    await bridge?.close();
    srv?.kill('SIGKILL');
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  it('component tree returns the App -> Counter hierarchy with source files', async () => {
    const result = await bridge.sandboxComponentTree(url, {});
    expect(result.error).toBeUndefined();
    expect(result.componentCount).toBeGreaterThanOrEqual(2);
    const app = result.tree.find((n: any) => n.name === 'App');
    expect(app).toBeDefined();
    expect(app.source).toMatch(/src\/main\.tsx/);
    const counter = app.children?.find((n: any) => n.name === 'Counter');
    expect(counter).toBeDefined();
    expect(counter.source).toMatch(/src\/App\.tsx/);
  }, 30000);

  it('render trace counts re-renders driven by interaction (react-scan role)', async () => {
    await bridge.sandboxTraceStart(url);
    const page = bridge.getPage()!;
    for (let i = 0; i < 3; i++) { await page.click('#c'); await page.waitForTimeout(80); }
    const report = await bridge.sandboxTraceReport(url, { stop: true });
    expect(report.error).toBeUndefined();
    expect(report.totalCommits).toBe(3);
    const counter = report.components.find((c: any) => c.name === 'Counter');
    expect(counter).toBeDefined();
    expect(counter.renders).toBe(3);
    expect(report.stopped).toBe(true);
  }, 30000);

  it('render trace survives a same-origin reload between start and stop (InteractWithSandbox case)', async () => {
    await bridge.sandboxTraceStart(url);
    const page = bridge.getPage()!;
    // InteractWithSandbox captures a snapshot (page.goto -> reload) around the click;
    // the sessionStorage-backed trace must survive that.
    await bridge.captureSnapshot(url);
    await page.click('#c'); await page.waitForTimeout(80);
    await bridge.captureSnapshot(url);
    const report = await bridge.sandboxTraceReport(url, { stop: true });
    expect(report.totalCommits).toBeGreaterThanOrEqual(1);
    expect(report.components.some((c: any) => c.name === 'Counter')).toBe(true);
  }, 40000);

  it('tree reports a clean error on a non-React page', async () => {
    const plain = 'data:text/html,' + encodeURIComponent('<!DOCTYPE html><html><body><h1>Plain</h1></body></html>');
    const tree = await bridge.sandboxComponentTree(plain, {});
    expect(tree.error).toMatch(/No React tree/i);
  }, 30000);
});
