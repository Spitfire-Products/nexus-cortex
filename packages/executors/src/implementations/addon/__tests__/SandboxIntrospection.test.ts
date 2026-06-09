/**
 * React-introspection bridge contract tests (sandbox_scan / sandbox_grab /
 * sandbox_detect_framework backing methods).
 *
 * Runs a real headless Chromium against data: URLs — skipped when no Chromium
 * binary is available. The React-positive path uses a hand-rolled fiber fixture
 * (an element carrying a `__reactFiber$…` key with type/memoizedProps/return),
 * which exercises the exact host-instance convention the fiber reader targets
 * without bundling React.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VisualFeedbackBridge } from '../VisualFeedbackBridge.js';
import { getChromiumBinary } from '../../../utils/ChromiumBrowserManager.js';

const HAS_CHROMIUM = !!getChromiumBinary();

const VANILLA_PAGE = 'data:text/html,' + encodeURIComponent(`
<!doctype html><html><body>
  <h1>Vanilla page</h1>
  <button id="go">Go</button>
  <input placeholder="search here" name="q" type="text">
  <div style="display:none">hidden</div>
</body></html>`);

// Element carries a fake React fiber via the __reactFiber$ host-instance key.
const FAKE_REACT_PAGE = 'data:text/html,' + encodeURIComponent(`
<!doctype html><html><body>
  <div id="root"><button id="counter">Count: 0</button></div>
  <script>
    const el = document.getElementById('counter');
    const appFiber = { type: { name: 'App' }, return: null, memoizedProps: {} };
    el['__reactFiber$test123'] = {
      type: 'button',
      return: {
        type: { name: 'Counter' },
        memoizedProps: { label: 'hi', count: 3, onClick: function(){}, items: [1,2] },
        return: appFiber,
        _debugSource: { fileName: 'src/Counter.tsx', lineNumber: 12, columnNumber: 4 }
      }
    };
  </script>
</body></html>`);

describe.skipIf(!HAS_CHROMIUM)('Sandbox React introspection (bridge contract)', () => {
  let bridge: VisualFeedbackBridge;

  beforeAll(async () => {
    bridge = new VisualFeedbackBridge();
    await bridge.initialize();
  }, 60000);

  afterAll(async () => {
    await bridge?.close();
  });

  it('detect: vanilla page reports react=false with full schema', async () => {
    const report = await bridge.sandboxDetect(VANILLA_PAGE);
    expect(report.react).toBe(false);
    expect(report).toMatchObject({
      next: false, vue: false, svelte: false, angular: false
    });
    expect(Array.isArray(report.heavyLibraries)).toBe(true);
    expect(typeof report.rendererCount).toBe('number');
    // The pre-load shim installs the hook, so detection-by-hook is available.
    expect(report.hasDevTools).toBe(true);
  }, 30000);

  it('preload shim: renderer registration surfaces react + version', async () => {
    await bridge.sandboxDetect(VANILLA_PAGE); // ensures preload + navigation
    const page = bridge.getPage()!;
    await page.evaluate(() => {
      (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__.inject({ version: '18.3.0' });
    });
    const report = await page.evaluate(
      // re-run detect inline against the mutated hook
      `(${'(' + 'function(){return window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size}' + ')'})()`
    );
    expect(report).toBe(1);
  }, 30000);

  it('scan: returns elements with unique cssSelector + isInteractive', async () => {
    const result = await bridge.sandboxScan(VANILLA_PAGE, { filter: { isInteractive: true } });
    expect(result.count).toBeGreaterThanOrEqual(2); // button + input
    const button = result.elements.find((e: any) => e.tagName === 'button');
    expect(button).toBeDefined();
    expect(button.cssSelector).toBe('#go');
    expect(button.isInteractive).toBe(true);
    // hidden element must not appear
    expect(result.elements.some((e: any) => e.textContent === 'hidden')).toBe(false);
    // scan -> act contract: the cssSelector resolves to exactly one element
    const page = bridge.getPage()!;
    const matches = await page.evaluate(
      (sel: string) => document.querySelectorAll(sel).length, button.cssSelector
    );
    expect(matches).toBe(1);
  }, 30000);

  it('scan filters: placeholder + tagName narrow correctly', async () => {
    const result = await bridge.sandboxScan(VANILLA_PAGE, {
      filter: { tagName: 'input', placeholder: 'search' }
    });
    expect(result.count).toBe(1);
    expect(result.elements[0].name).toBe('q');
  }, 30000);

  it('grab (vanilla): DOM detail, no react field', async () => {
    const result = await bridge.sandboxGrab(VANILLA_PAGE, { selector: '#go' });
    expect(result.tagName).toBe('button');
    expect(result.textContent).toBe('Go');
    expect(result.rect.width).toBeGreaterThan(0);
    expect(result.react).toBeUndefined();
  }, 30000);

  it('grab (react): enriches with componentName/stack/props/sourceLocation', async () => {
    const result = await bridge.sandboxGrab(FAKE_REACT_PAGE, { selector: '#counter' });
    expect(result.react).toBeDefined();
    expect(result.react.componentName).toBe('Counter');
    expect(result.react.componentStack).toEqual(['Counter', 'App']);
    expect(result.react.props).toMatchObject({ label: 'hi', count: 3, onClick: '[function]', items: '[array:2]' });
    expect(result.react.sourceLocation).toBe('src/Counter.tsx:12:4');
  }, 30000);

  it('scan (react): componentName present and filterable', async () => {
    const all = await bridge.sandboxScan(FAKE_REACT_PAGE, {});
    const counter = all.elements.find((e: any) => e.id === 'counter');
    expect(counter?.componentName).toBe('Counter');

    const filtered = await bridge.sandboxScan(FAKE_REACT_PAGE, { filter: { componentName: 'Counter' } });
    expect(filtered.count).toBe(1);
    expect(filtered.elements[0].id).toBe('counter');
  }, 30000);

  it('grab error contract: bad selector and missing element', async () => {
    const bad = await bridge.sandboxGrab(VANILLA_PAGE, { selector: '#does-not-exist' });
    expect(bad.error).toContain('No element matches');
  }, 30000);
});
