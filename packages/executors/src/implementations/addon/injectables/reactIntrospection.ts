/**
 * React introspection injectables for the sandbox feedback bridge.
 *
 * Browser-context scripts (serialized source strings) that give the sandbox tools
 * the same scan/grab/detect contract as the nexus-browser MCP — element results
 * carry a unique `cssSelector`, React elements are enriched with a
 * `react: { componentName, componentStack, props, sourceLocation }` field, and
 * `detect` returns the detect_framework schema. Original implementation from the
 * public React fiber conventions (`__reactFiber$*` host keys, the DevTools global
 * hook protocol) — no external code or dependencies.
 *
 * Injection model:
 *  - PRELOAD_SCRIPT runs via page.addInitScript BEFORE any page script, so the
 *    DevTools-hook shim exists before React loads (renderer/version registration)
 *    and `window.__cortexReact` is available to runtime scripts.
 *  - DETECT/SCAN/GRAB are evaluated on demand via page.evaluate and degrade
 *    gracefully on non-React pages (fiber fields simply absent).
 */

/**
 * Pre-load: minimal DevTools hook shim (only when absent) + fiber utilities.
 * The shim lets us read renderer count/version on prod React builds; the fiber
 * utilities resolve a DOM node to its React fiber via the `__reactFiber$` /
 * `__reactContainer$` host-instance keys (works without the hook, prod included).
 */
export const PRELOAD_SCRIPT = `
(() => {
  if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    let n = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      inject(renderer) { const id = ++n; this.renderers.set(id, renderer); return id; },
      on() {}, off() {}, sub() { return () => {}; },
      onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      checkDCE() {}
    };
  }

  const getFiber = (el) => {
    let node = el;
    while (node) {
      const key = Object.keys(node).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')
      );
      if (key) return node[key];
      node = node.parentElement;
    }
    return null;
  };

  const INTERNAL = /^(Fragment|Suspense|Profiler|StrictMode|Provider|Consumer|ForwardRef|Memo)$/;

  const displayName = (type) => {
    if (!type) return null;
    if (typeof type === 'string') return null; // host component (div, span...)
    return (
      type.displayName || type.name ||
      (type.render && (type.render.displayName || type.render.name)) ||
      (type.type && displayName(type.type)) || null
    );
  };

  const componentName = (fiber) => {
    let f = fiber;
    while (f) {
      const name = displayName(f.type);
      if (name && !INTERNAL.test(name)) return name;
      f = f.return;
    }
    return null;
  };

  const componentStack = (fiber, max = 10) => {
    const stack = [];
    let f = fiber;
    while (f && stack.length < max) {
      const name = displayName(f.type);
      if (name && !INTERNAL.test(name) && stack[stack.length - 1] !== name) stack.push(name);
      f = f.return;
    }
    return stack;
  };

  const serializeProps = (fiber) => {
    let f = fiber;
    while (f && typeof f.type === 'string') f = f.return; // climb to the component fiber
    const props = f && f.memoizedProps;
    if (!props || typeof props !== 'object') return null;
    const out = {};
    for (const k of Object.keys(props).slice(0, 20)) {
      if (k === 'children') continue;
      const v = props[k];
      const t = typeof v;
      if (v === null || t === 'string' || t === 'number' || t === 'boolean') out[k] = v;
      else if (t === 'function') out[k] = '[function]';
      else if (Array.isArray(v)) out[k] = '[array:' + v.length + ']';
      else if (t === 'object') out[k] = '[object]';
    }
    return out;
  };

  const sourceLocation = (fiber) => {
    let f = fiber;
    while (f) {
      const src = f._debugSource || (f._debugOwner && f._debugOwner._debugSource);
      if (src && src.fileName) {
        return src.fileName + ':' + (src.lineNumber || 0) + (src.columnNumber ? ':' + src.columnNumber : '');
      }
      f = f.return;
    }
    return null;
  };

  // Render trace (react-scan role): accumulate per-component render counts/timings across
  // React commits. The commit interceptor records work whenever tracing is enabled.
  window.__cortexRenderTrace = { enabled: false, counts: {}, totalCommits: 0, startedAt: 0 };

  // A component fiber "rendered" this commit if newly mounted, or its props/state identity
  // changed vs its previous (alternate) fiber. Profiler actualDuration (dev build) gives
  // timing when present but isn't required for the render signal.
  const didRender = (f) => {
    const alt = f.alternate;
    if (!alt) return true;                                   // mounted this commit
    if (alt.memoizedProps !== f.memoizedProps) return true;  // new props
    if (alt.memoizedState !== f.memoizedState) return true;  // new state/hooks
    return (f.actualDuration != null && f.actualDuration > 0 && f.actualDuration !== alt.actualDuration);
  };

  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const prevCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (id, root, ...rest) {
    try {
      if (root && root.current && window.__cortexReact) {
        // Always stash the LIVE root (root.current) — the container DOM key can point at a
        // stale double-buffer fiber, so the tree walker must start from here.
        window.__cortexReact.__lastRoot = root.current;
        const trace = window.__cortexRenderTrace;
        if (trace && trace.enabled) {
          trace.totalCommits++;
          const seen = new Set();
          const visit = (f) => {
            if (!f || seen.has(f)) return;
            seen.add(f);
            const name = (typeof f.type !== 'string') ? displayName(f.type) : null;
            if (name && !INTERNAL.test(name) && didRender(f)) {
              const e = trace.counts[name] || (trace.counts[name] = { renders: 0, totalDurationMs: 0 });
              e.renders++;
              if (f.actualDuration != null) e.totalDurationMs += f.actualDuration;
            }
            visit(f.child);
            visit(f.sibling);
          };
          visit(root.current);
        }
      }
    } catch (e) { /* never break React's commit */ }
    if (typeof prevCommit === 'function') return prevCommit.call(this, id, root, ...rest);
  };

  window.__cortexReact = {
    getFiber,
    info(el) {
      const fiber = getFiber(el);
      if (!fiber) return null;
      const name = componentName(fiber);
      if (!name) return null;
      return {
        componentName: name,
        componentStack: componentStack(fiber),
        props: serializeProps(fiber),
        sourceLocation: sourceLocation(fiber)
      };
    },
    // Component hierarchy (nexus-sense 'tree' role): host fibers collapsed, components only.
    tree(el, maxDepth) {
      // The container DOM key can point at a stale double-buffer fiber whose .child is null,
      // and __lastRoot may not be set yet on the very first commit. Walk from a LIVE
      // descendant host fiber (React keeps those current) and climb to the root.
      let fiber = window.__cortexReact.__lastRoot || getFiber(el);
      if (!fiber) return null;
      while (fiber.return) fiber = fiber.return;     // climb to the host root
      // If the resolved root has no child but its alternate does, use the live one.
      if (!fiber.child && fiber.alternate && fiber.alternate.child) fiber = fiber.alternate;
      const build = (f, depth) => {
        const name = (typeof f.type !== 'string') ? displayName(f.type) : null;
        const isComponent = !!name && !INTERNAL.test(name);
        let kids = [];
        if (depth < maxDepth) {
          let c = f.child;
          while (c) { kids = kids.concat(build(c, isComponent ? depth + 1 : depth)); c = c.sibling; }
        }
        if (isComponent) {
          const node = { name };
          const src = f._debugSource || (f._debugOwner && f._debugOwner._debugSource);
          if (src && src.fileName) node.source = src.fileName + ':' + (src.lineNumber || 0);
          if (kids.length) node.children = kids;
          return [node];
        }
        return kids; // host fiber: lift its component descendants up
      };
      return build(fiber, 0);
    }
  };
})();
`;

/**
 * Runtime: framework detection. Return schema matches nexus-browser
 * detect_framework: react/reactVersion/next/remix/gatsby/vue/svelte/angular/
 * compiler/hasDevTools/rendererCount/heavyLibraries.
 */
export const DETECT_SCRIPT = `
(() => {
  const w = window;
  const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const rendererCount = hook && hook.renderers ? hook.renderers.size : 0;
  let reactVersion = null;
  try {
    if (rendererCount > 0) reactVersion = hook.renderers.values().next().value.version || null;
    if (!reactVersion && w.React) reactVersion = w.React.version || null;
  } catch (e) { /* version unavailable */ }
  const react = rendererCount > 0 || !!w.React ||
    !!document.querySelector('[data-reactroot], #root [class], #app [class]') &&
    !!Object.keys(document.querySelector('#root') || {}).find((k) => k.startsWith('__react'));
  const heavy = [];
  const libs = {
    'monaco-editor': () => !!w.monaco, 'chart.js': () => !!w.Chart, three: () => !!w.THREE,
    d3: () => !!w.d3, leaflet: () => !!w.L && !!w.L.map, 'pdf.js': () => !!w.pdfjsLib
  };
  for (const [name, test] of Object.entries(libs)) { try { if (test()) heavy.push(name); } catch (e) {} }
  return {
    react: !!react,
    reactVersion,
    next: !!w.__NEXT_DATA__,
    remix: !!w.__remixContext,
    gatsby: !!w.___gatsby,
    vue: !!w.__VUE__ || !!w.__VUE_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-v-app],[data-v-]'),
    svelte: !!document.querySelector('[class*="svelte-"]'),
    angular: !!w.ng || !!document.querySelector('[ng-version]'),
    compiler: !!w.__REACT_COMPILER_RUNTIME__,
    hasDevTools: !!hook,
    rendererCount,
    heavyLibraries: heavy
  };
})()
`;

/**
 * Runtime: element discovery. Returns the nexus-browser scan element shape —
 * tagName/textContent/rect/isInteractive/relevanceScore/cssSelector (+ optional
 * componentName when React is present). Args passed via evaluate(script, args).
 */
export const SCAN_SCRIPT = `
(args) => {
  args = args || {};
  const limit = Math.max(1, Math.min(args.limit || 30, 100));
  const filter = args.filter || {};
  const includeOffscreen = !!args.includeOffscreen;
  const vw = window.innerWidth, vh = window.innerHeight;
  const region = args.region || { x: 0, y: 0, width: vw, height: vh };

  const cssSelector = (el) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
      return '#' + CSS.escape(el.id);
    }
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + CSS.escape(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    const sel = parts.join(' > ');
    try {
      if (document.querySelectorAll(sel).length === 1) return sel;
    } catch (e) {}
    return sel; // best-effort fallback (still scoped enough for most pages)
  };

  const INTERACTIVE_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary', 'option', 'label'];
  const isInteractive = (el) => {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.includes(tag)) return true;
    const role = el.getAttribute('role');
    if (role && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'slider', 'combobox'].includes(role)) return true;
    if (el.hasAttribute('onclick') || (el.tabIndex >= 0 && tag !== 'body')) return true;
    try { if (getComputedStyle(el).cursor === 'pointer') return true; } catch (e) {}
    return false;
  };

  const score = (el, rect, interactive, text) => {
    let s = 0;
    if (interactive) s += 40;
    if (text) s += 20;
    if (el.id) s += 15;
    if (el.getAttribute('name') || el.getAttribute('placeholder')) s += 10;
    if (el.getAttribute('role')) s += 5;
    const area = rect.width * rect.height;
    if (area > 5000) s += 5; else if (area > 1000) s += 2;
    return s;
  };

  const results = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'meta', 'link', 'head', 'noscript'].includes(tag)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const offscreen = rect.bottom < region.y || rect.top > region.y + region.height ||
      rect.right < region.x || rect.left > region.x + region.width;
    if (offscreen && !includeOffscreen) continue;
    let style;
    try { style = getComputedStyle(el); } catch (e) { continue; }
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const interactive = isInteractive(el);
    const text = (el.textContent || '').trim().slice(0, 50);

    if (filter.tagName && tag !== String(filter.tagName).toLowerCase()) continue;
    if (filter.isInteractive !== undefined && interactive !== filter.isInteractive) continue;
    if (filter.hasText && !text.toLowerCase().includes(String(filter.hasText).toLowerCase())) continue;
    if (filter.id && el.id !== filter.id) continue;
    if (filter.className && !el.classList.contains(filter.className)) continue;
    if (filter.placeholder && !(el.getAttribute('placeholder') || '').toLowerCase().includes(String(filter.placeholder).toLowerCase())) continue;
    if (filter.name && el.getAttribute('name') !== filter.name) continue;

    let componentName;
    if (window.__cortexReact) {
      const info = window.__cortexReact.info(el);
      if (info) componentName = info.componentName;
    }
    if (filter.componentName && componentName !== filter.componentName) continue;

    const entry = {
      tagName: tag,
      textContent: text || undefined,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      isInteractive: interactive,
      relevanceScore: score(el, rect, interactive, text),
      cssSelector: cssSelector(el)
    };
    if (el.id) entry.id = el.id;
    if (componentName) entry.componentName = componentName;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) entry.placeholder = placeholder;
    const type = el.getAttribute('type');
    if (type) entry.type = type;
    const name = el.getAttribute('name');
    if (name) entry.name = name;
    if (offscreen) entry.isOffscreen = true;
    results.push(entry);
  }

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const truncated = results.length > limit;
  return { count: Math.min(results.length, limit), elements: results.slice(0, limit), truncated };
}
`;

/**
 * Runtime: single-element content query by selector or coordinates. Returns DOM
 * detail plus `react: { componentName, componentStack, props, sourceLocation }`
 * when the element belongs to a React tree (the nexus-browser grab enrichment
 * field shape).
 */
export const GRAB_SCRIPT = `
(args) => {
  args = args || {};
  let el = null;
  if (args.selector) {
    try { el = document.querySelector(args.selector); } catch (e) { return { error: 'Invalid selector: ' + e.message }; }
    if (!el) return { error: 'No element matches selector: ' + args.selector };
  } else if (typeof args.x === 'number' && typeof args.y === 'number') {
    el = document.elementFromPoint(args.x, args.y);
    if (!el) return { error: 'No element at (' + args.x + ', ' + args.y + ')' };
  } else {
    return { error: 'Provide selector or x/y coordinates' };
  }

  const rect = el.getBoundingClientRect();
  const attrs = {};
  for (const a of el.attributes) attrs[a.name] = a.value.length > 120 ? a.value.slice(0, 120) + '…' : a.value;
  let style = {};
  try {
    const cs = getComputedStyle(el);
    style = { display: cs.display, visibility: cs.visibility, position: cs.position, color: cs.color, fontSize: cs.fontSize, cursor: cs.cursor };
  } catch (e) {}

  const parents = [];
  let p = el.parentElement;
  while (p && p !== document.body && parents.length < 4) {
    parents.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + (p.className && typeof p.className === 'string' ? '.' + p.className.split(/\\s+/).slice(0, 2).join('.') : ''));
    p = p.parentElement;
  }

  const result = {
    tagName: el.tagName.toLowerCase(),
    textContent: (el.textContent || '').trim().slice(0, args.maxLength || 500),
    attributes: attrs,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    computedStyle: style,
    parentChain: parents,
    htmlPreview: el.outerHTML.slice(0, 300)
  };

  if (window.__cortexReact) {
    const info = window.__cortexReact.info(el);
    if (info) result.react = info;
  }
  return result;
}
`;

/**
 * Runtime: component hierarchy (nexus-sense `tree` role). Walks the React fiber tree from
 * the root, host elements collapsed, components only. Args: { rootSelector?, maxDepth? }.
 */
export const TREE_SCRIPT = `
(args) => {
  args = args || {};
  if (!window.__cortexReact || !window.__cortexReact.tree) return { error: 'React introspection not available on this page' };
  // Use a LIVE descendant host element (React keeps its fiber current) rather than the
  // root container itself (whose fiber key can be a stale double-buffer fiber).
  const el = args.rootSelector ? document.querySelector(args.rootSelector)
    : (document.querySelector('#root *, #app *, [data-reactroot] *') ||
       (document.body && document.body.firstElementChild) || document.body);
  const tree = window.__cortexReact.tree(el, args.maxDepth || 8);
  if (!tree) return { error: 'No React tree found (is this a React page?)' };
  // component count + max depth summary
  let count = 0, maxDepth = 0;
  const walk = (nodes, d) => { for (const n of nodes) { count++; maxDepth = Math.max(maxDepth, d); if (n.children) walk(n.children, d + 1); } };
  walk(tree, 1);
  return { tree, componentCount: count, maxDepth };
}
`;

/** Runtime: begin a render trace (resets + enables the commit interceptor). */
export const TRACE_START_SCRIPT = `
(() => {
  if (!window.__cortexRenderTrace) return { error: 'React introspection not available on this page' };
  window.__cortexRenderTrace = { enabled: true, counts: {}, totalCommits: 0, startedAt: Date.now() };
  return { started: true };
})()
`;

/**
 * Runtime: stop (or peek) a render trace and return per-component render counts/timings,
 * sorted by render count (react-scan's "what re-rendered and how often").
 */
export const TRACE_REPORT_SCRIPT = `
(args) => {
  args = args || {};
  const t = window.__cortexRenderTrace;
  if (!t) return { error: 'React introspection not available on this page' };
  if (args.stop !== false) t.enabled = false;
  const components = Object.keys(t.counts).map((name) => ({
    name,
    renders: t.counts[name].renders,
    totalDurationMs: Math.round(t.counts[name].totalDurationMs * 100) / 100
  })).sort((a, b) => b.renders - a.renders);
  return {
    durationMs: t.startedAt ? Date.now() - t.startedAt : 0,
    totalCommits: t.totalCommits,
    components,
    stopped: args.stop !== false
  };
}
`;
