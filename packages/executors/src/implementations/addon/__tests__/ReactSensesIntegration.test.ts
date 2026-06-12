/**
 * Phase-3 React senses integration: SandboxComponentTree + SandboxRenderTrace against a
 * REAL bundled React app (esbuild) served by an in-process static server and driven
 * through Chromium. Skips automatically when esbuild/react or Chromium are unavailable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { buildReactArtifact } from '../ReactArtifactBuilder.js';
import { VisualFeedbackBridge } from '../VisualFeedbackBridge.js';
import { getChromiumBinary } from '../../../utils/ChromiumBrowserManager.js';

const require_ = createRequire(import.meta.url);
const HAS_ESBUILD = (() => { try { require_.resolve('esbuild'); require_.resolve('react'); return true; } catch { return false; } })();
const HAS_CHROMIUM = !!getChromiumBinary();
// Opt-in (ENABLE_BROWSER_TESTS=true), like ENABLE_SMOKE_TESTS: this suite launches a
// real Chromium and esbuild-bundles a React app — heavyweight for the default
// `npm test` a fresh clone runs. Capability guards still apply when enabled.
const RUN = HAS_ESBUILD && HAS_CHROMIUM && process.env.ENABLE_BROWSER_TESTS === 'true';

const COUNTER_APP = `import { useState } from 'react';
function Counter(){ const [n,setN]=useState(0); return <button id="c" onClick={()=>setN(n+1)}>Count: {n}</button>; }
function App(){ return <div><h1>Demo</h1><Counter/></div>; }
export default App;`;

describe.skipIf(!RUN)('React senses (tree + render trace) integration', () => {
  let dir: string;
  let srv: HttpServer;
  let bridge: VisualFeedbackBridge;
  let url: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'react-senses-'));
    await buildReactArtifact(dir, { code: COUNTER_APP, reactMode: 'bundled' });
    // In-process static server on an EPHEMERAL port. The previous setup
    // (`npx http-server` on a fixed port) had three failure modes that produced a
    // phantom "regression": npx downloading http-server mid-test (network), the
    // boot-poll accepting a response from ANY server on the port (a zombie from an
    // interrupted earlier run served a deleted dir → blank page → "No React tree
    // found"), and kill() orphaning the npx→sh→node grandchild, CREATING that
    // zombie. An in-process server can't collide, can't be foreign, can't orphan.
    const MIME: Record<string, string> = {
      '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json',
    };
    srv = createServer(async (req, res) => {
      try {
        const reqPath = (req.url ?? '/').split('?')[0]!;
        const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
        const filePath = join(dir, rel);
        if (!filePath.startsWith(dir)) { res.writeHead(403); res.end(); return; }
        const body = await fs.readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404); res.end();
      }
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const addr = srv.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
    // Sanity: this exact server serves OUR artifact (not a fixed-port assumption).
    const probe = await fetch(`${url}/dist/bundle.js`);
    if (!probe.ok) throw new Error(`artifact server not serving the bundle (HTTP ${probe.status})`);
    bridge = new VisualFeedbackBridge();
    await bridge.initialize();
  }, 60000);

  afterAll(async () => {
    await bridge?.close();
    await new Promise<void>((resolve) => (srv ? srv.close(() => resolve()) : resolve()));
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
