/**
 * React artifact builder — turns a user component into a static directory served by
 * the existing http-server path. Two modes (react_artifact_templates_plan.md):
 *
 *  - 'cdn'     : single index.html, React dev UMD + @babel/standalone, JSX compiled in the
 *                browser with development:true so React records _debugSource (scan/grab see
 *                componentName + props + a sourceLocation of `App.tsx:line`). Zero deps.
 *  - 'bundled' : esbuild bundles src/* (react/react-dom resolved from THIS package — no
 *                per-artifact npm install) with real source maps + jsxDev, so grab's
 *                sourceLocation points at real `src/App.tsx:line:col`. Optional dep; falls
 *                back to 'cdn' when esbuild is unavailable.
 *
 * Both write index.html and let CreateArtifactTool serve via `npx http-server`.
 */
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);

export interface ReactBuildOptions {
  /** The user's entry component source. Should define (or default-export) `App`. */
  code: string;
  /** Extra source modules for bundled mode, e.g. { path: 'components/Button.tsx', code }. */
  additionalFiles?: Array<{ path: string; code: string }>;
  /** Force a mode. Default: 'bundled' if esbuild is installed, else 'cdn'. */
  reactMode?: 'cdn' | 'bundled';
  /** Pin the CDN React version (cdn mode). Default 18. */
  cdnReactVersion?: string;
}

export interface ReactBuildResult {
  mode: 'cdn' | 'bundled';
  warnings: string[];
}

/** Ensure the entry source default-exports an `App` (idempotent). */
function ensureDefaultExport(code: string): string {
  if (/export\s+default/.test(code)) return code;
  if (/(?:function|const|let|class)\s+App\b/.test(code)) {
    return `${code}\nexport default App;\n`;
  }
  return code; // user wrote their own structure; leave as-is
}

/** CDN mode: strip module syntax React can't run inline (imports of react / export kw). */
function stripForInlineScript(code: string): string {
  return code
    .replace(/^\s*import\s+[^;]*?from\s+['"]react(?:-dom)?(?:\/[^'"]*)?['"];?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+function\b/gm, 'function')
    .replace(/^\s*export\s+default\s+class\b/gm, 'class')
    .replace(/^\s*export\s+default\s+/gm, 'const __default = ')
    .replace(/^\s*export\s+/gm, '');
}

function isBundledAvailable(): boolean {
  try {
    require_.resolve('esbuild');
    require_.resolve('react');
    require_.resolve('react-dom');
    return true;
  } catch {
    return false;
  }
}

export async function buildReactArtifact(
  artifactPath: string,
  opts: ReactBuildOptions
): Promise<ReactBuildResult> {
  const warnings: string[] = [];
  let mode = opts.reactMode ?? (isBundledAvailable() ? 'bundled' : 'cdn');

  if (mode === 'bundled' && !isBundledAvailable()) {
    warnings.push('Bundled mode requested but esbuild/react not installed — falling back to CDN mode.');
    mode = 'cdn';
  }

  if (mode === 'bundled') {
    try {
      await buildBundled(artifactPath, opts);
      return { mode: 'bundled', warnings };
    } catch (err) {
      warnings.push(`esbuild bundle failed (${(err as Error).message}); falling back to CDN mode.`);
      mode = 'cdn';
    }
  }

  await buildCdn(artifactPath, opts, warnings);
  return { mode: 'cdn', warnings };
}

async function buildCdn(
  artifactPath: string,
  opts: ReactBuildOptions,
  warnings: string[]
): Promise<void> {
  if (opts.additionalFiles?.length) {
    warnings.push('additionalFiles are ignored in CDN mode — use bundled mode for multi-file artifacts.');
  }
  const version = opts.cdnReactVersion ?? '18';
  const userSource = stripForInlineScript(ensureDefaultExport(opts.code));

  // Keep the user source verbatim in a non-executing block; a bootstrap compiles it with
  // @babel/standalone using development:true (records JSX _debugSource), then renders <App/>.
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React Artifact</title>
  <script crossorigin src="https://unpkg.com/react@${version}/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@${version}/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/plain" id="cortex-app-source">${escapeForScript(userSource)}</script>
  <script>
    (function () {
      try {
        var src = document.getElementById('cortex-app-source').textContent;
        var out = Babel.transform(src, {
          presets: [['react', { development: true }], 'typescript'],
          filename: 'App.tsx'
        }).code;
        // Indirect eval -> global scope, so 'App' is reachable by the render call below.
        (0, eval)(out);
        var Root = (typeof App !== 'undefined') ? App
          : (typeof __default !== 'undefined') ? __default : null;
        if (!Root) throw new Error('No App component found. Name your component "App" or default-export it.');
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Root));
      } catch (e) {
        document.getElementById('root').innerHTML =
          '<pre style="color:#c00;white-space:pre-wrap">React artifact error:\\n' +
          String(e && e.message || e) + '</pre>';
        console.error('[react-artifact]', e);
      }
    })();
  </script>
</body>
</html>
`;
  await fs.writeFile(join(artifactPath, 'index.html'), html);
}

/** Re-run esbuild for an already-scaffolded bundled artifact (src/main.tsx present). */
async function runEsbuild(artifactPath: string): Promise<void> {
  const esbuild = require_('esbuild') as typeof import('esbuild');
  // Resolve react/react-dom from THIS package's node_modules — never per-artifact install.
  const reactNodeModules = join(dirname(require_.resolve('react/package.json')), '..');
  await esbuild.build({
    entryPoints: [join(artifactPath, 'src', 'main.tsx')],
    bundle: true,
    outfile: join(artifactPath, 'dist', 'bundle.js'),
    sourcemap: true,                 // dist/bundle.js.map references src/*.tsx
    jsx: 'automatic',
    jsxDev: true,                    // emit jsxDEV(...) with __source -> grab.sourceLocation
    format: 'iife',
    target: 'es2020',
    define: { 'process.env.NODE_ENV': '"development"' },
    nodePaths: [reactNodeModules],   // bare 'react'/'react-dom' resolve here
    logLevel: 'silent'
  });
}

/**
 * Re-bundle a bundled React artifact after a source edit (Phase 3). No-op for CDN or
 * non-React artifacts. Returns whether a bundle was produced.
 */
export async function rebuildReactBundle(
  artifactPath: string
): Promise<{ rebuilt: boolean; error?: string }> {
  try {
    await fs.access(join(artifactPath, 'src', 'main.tsx'));
  } catch {
    return { rebuilt: false };               // not a bundled React artifact
  }
  if (!isBundledAvailable()) {
    return { rebuilt: false, error: 'esbuild not available' };
  }
  try {
    await runEsbuild(artifactPath);
    return { rebuilt: true };
  } catch (err) {
    return { rebuilt: false, error: (err as Error).message };
  }
}

async function buildBundled(artifactPath: string, opts: ReactBuildOptions): Promise<void> {
  const srcDir = join(artifactPath, 'src');
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(join(srcDir, 'App.tsx'), ensureDefaultExport(opts.code));
  await fs.writeFile(
    join(srcDir, 'main.tsx'),
    `import { createRoot } from 'react-dom/client';\n` +
    `import App from './App';\n` +
    `const el = document.getElementById('root');\n` +
    `if (el) createRoot(el).render(<App />);\n`
  );
  for (const f of opts.additionalFiles ?? []) {
    const dest = join(srcDir, f.path);
    await fs.mkdir(dirname(dest), { recursive: true });
    await fs.writeFile(dest, f.code);
  }

  await runEsbuild(artifactPath);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>React Artifact</title>
</head>
<body>
  <div id="root"></div>
  <script src="./dist/bundle.js"></script>
</body>
</html>
`;
  await fs.writeFile(join(artifactPath, 'index.html'), html);
}

/** Make user source safe inside a <script> block (only </script> can break out). */
function escapeForScript(code: string): string {
  return code.replace(/<\/script>/gi, '<\\/script>');
}
