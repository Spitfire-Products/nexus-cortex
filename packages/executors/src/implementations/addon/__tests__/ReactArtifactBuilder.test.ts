/**
 * React artifact builder contract tests (Path A CDN + Path C esbuild bundle).
 * Writes into a temp dir and asserts the produced static files. The bundled-mode
 * tests skip automatically if esbuild/react aren't installed (optionalDependencies).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createRequire } from 'module';
import { buildReactArtifact, rebuildReactBundle } from '../ReactArtifactBuilder.js';

const require_ = createRequire(import.meta.url);
const HAS_ESBUILD = (() => { try { require_.resolve('esbuild'); require_.resolve('react'); return true; } catch { return false; } })();

const COMPONENT = `
function App() {
  return <div><h1>Hello</h1><button id="go">Go</button></div>;
}
`;

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(join(tmpdir(), 'react-artifact-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('buildReactArtifact — CDN mode (Path A)', () => {
  it('emits a single self-contained index.html with React UMD + Babel + the component', async () => {
    const result = await buildReactArtifact(dir, { code: COMPONENT, reactMode: 'cdn' });
    expect(result.mode).toBe('cdn');
    const html = await fs.readFile(join(dir, 'index.html'), 'utf-8');
    expect(html).toContain('react.development.js');
    expect(html).toContain('@babel/standalone');
    expect(html).toContain('development: true');     // dev JSX transform => _debugSource
    expect(html).toContain('<div id="root">');
    expect(html).toContain('function App()');
    // No bundle dir in CDN mode
    await expect(fs.access(join(dir, 'dist'))).rejects.toBeTruthy();
  });

  it('strips react imports and export-default so inline eval stays valid', async () => {
    const withImports = `import React from 'react';\nexport default function App() { return <p>hi</p>; }`;
    await buildReactArtifact(dir, { code: withImports, reactMode: 'cdn' });
    const html = await fs.readFile(join(dir, 'index.html'), 'utf-8');
    const scriptBlock = html.split('id="cortex-app-source"')[1].split('</script>')[0];
    expect(scriptBlock).not.toContain("import React");
    expect(scriptBlock).not.toContain('export default');
    expect(scriptBlock).toContain('function App()');
  });

  it('warns when additionalFiles are passed in CDN mode', async () => {
    const result = await buildReactArtifact(dir, {
      code: COMPONENT, reactMode: 'cdn',
      additionalFiles: [{ path: 'x.tsx', code: 'export const x = 1;' }]
    });
    expect(result.warnings.join(' ')).toMatch(/additionalFiles are ignored/i);
  });
});

describe.skipIf(!HAS_ESBUILD)('buildReactArtifact — bundled mode (Path C)', () => {
  it('esbuild-bundles src into dist/bundle.js with a source map referencing src/App.tsx', async () => {
    const result = await buildReactArtifact(dir, { code: COMPONENT, reactMode: 'bundled' });
    expect(result.mode).toBe('bundled');

    const html = await fs.readFile(join(dir, 'index.html'), 'utf-8');
    expect(html).toContain('./dist/bundle.js');
    expect(html).toContain('<div id="root">');

    const bundle = await fs.readFile(join(dir, 'dist', 'bundle.js'), 'utf-8');
    expect(bundle.length).toBeGreaterThan(1000);          // react is bundled in
    expect(bundle).toMatch(/jsxDEV|react/i);              // dev runtime present

    const map = JSON.parse(await fs.readFile(join(dir, 'dist', 'bundle.js.map'), 'utf-8'));
    expect(map.sources.some((s: string) => s.includes('src/App.tsx'))).toBe(true);

    // Source written for the model to edit / for source-mapped grab
    expect(await fs.readFile(join(dir, 'src', 'App.tsx'), 'utf-8')).toContain('function App()');
    expect(await fs.readFile(join(dir, 'src', 'main.tsx'), 'utf-8')).toContain('createRoot');
  });

  it('rebuildReactBundle re-runs esbuild and reflects an edited source', async () => {
    await buildReactArtifact(dir, { code: COMPONENT, reactMode: 'bundled' });
    const before = await fs.readFile(join(dir, 'dist', 'bundle.js'), 'utf-8');
    expect(before).not.toContain('REBUILT-MARKER');

    // Edit the source as ModifySandbox would, then rebuild.
    await fs.writeFile(join(dir, 'src', 'App.tsx'),
      `function App(){ return <div id="REBUILT-MARKER">changed</div>; }\nexport default App;\n`);
    const res = await rebuildReactBundle(dir);
    expect(res.rebuilt).toBe(true);

    const after = await fs.readFile(join(dir, 'dist', 'bundle.js'), 'utf-8');
    expect(after).toContain('REBUILT-MARKER');
  });

  it('rebuildReactBundle is a no-op for a non-bundled (CDN) dir', async () => {
    await buildReactArtifact(dir, { code: COMPONENT, reactMode: 'cdn' });
    const res = await rebuildReactBundle(dir);
    expect(res.rebuilt).toBe(false);
  });

  it('supports multi-file imports via additionalFiles', async () => {
    const app = `import { Label } from './components/Label';\nfunction App(){ return <Label/>; }`;
    const result = await buildReactArtifact(dir, {
      code: app, reactMode: 'bundled',
      additionalFiles: [{ path: 'components/Label.tsx', code: 'export function Label(){ return <span>L</span>; }' }]
    });
    expect(result.mode).toBe('bundled');
    expect(result.warnings).toHaveLength(0);
    const bundle = await fs.readFile(join(dir, 'dist', 'bundle.js'), 'utf-8');
    expect(bundle).toContain('span');   // Label component bundled in
  });
});
