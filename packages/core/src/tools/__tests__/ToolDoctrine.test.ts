/**
 * CORTEX_TOOL_DOCTRINE=mimo-v1 (2026-09-28): the three doctrine edits BOTH MiMo doctrine mines proposed (sweep 320 sessions, verification cell
 * 255 sessions): Read over bash file viewing, no reference mining outside the workspace, dependency manifests as graded inputs. Dark lever —
 * unset = byte-identical tool descriptions.
 */
import { describe, it, expect } from 'vitest';
import { BaseToolRegistry, TOOL_DOCTRINE_MIMO_V1 } from '../registries/BaseToolRegistry.js';

const desc = (r: BaseToolRegistry, n: string) => String(r.getTool(n)?.description ?? '');

describe('CORTEX_TOOL_DOCTRINE=mimo-v1', () => {
  it('unset / unknown value: descriptions byte-identical to the shipped registry', () => {
    const base = new BaseToolRegistry({});
    for (const env of [{ CORTEX_TOOL_DOCTRINE: '' }, { CORTEX_TOOL_DOCTRINE: 'v9' }]) {
      const r = new BaseToolRegistry(env as any);
      for (const t of base.getAllTools()) expect(desc(r, t.name)).toBe(desc(base, t.name));
    }
  });
  it('every anchor exists exactly once in its tool description (a drifted anchor must fail the build, not silently no-op)', () => {
    const base = new BaseToolRegistry({});
    for (const e of TOOL_DOCTRINE_MIMO_V1) expect(desc(base, e.tool).split(e.anchor).length - 1).toBe(1);
  });
  it('mimo-v1: each edit applied after its anchor; other tools unchanged', () => {
    const base = new BaseToolRegistry({});
    const r = new BaseToolRegistry({ CORTEX_TOOL_DOCTRINE: 'mimo-v1' } as any);
    for (const e of TOOL_DOCTRINE_MIMO_V1) expect(desc(r, e.tool)).toContain(e.anchor + e.append);
    expect(desc(r, 'Read')).toMatch(/Use Read for all file inspection/);
    expect(desc(r, 'Bash')).toMatch(/parent directories, sibling projects/);
    expect(desc(r, 'Bash')).toMatch(/ad hoc for experimentation is also a manifest change/);
    const touched = new Set(TOOL_DOCTRINE_MIMO_V1.map((e) => e.tool));
    for (const t of base.getAllTools()) if (!touched.has(t.name)) expect(desc(r, t.name)).toBe(desc(base, t.name));
  });
});
