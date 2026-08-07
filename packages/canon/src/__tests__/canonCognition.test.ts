/**
 * canonCognition — the §27l graph's cognition dimension. Tests the PURE core
 * (extractCognition): turn grouping, the three confidence-tagged edge types,
 * the join to source_file via an injected resolver, and — the load-bearing
 * property — that a thought node is never a secret-leak vector (structural by
 * default; label + opt-in text always scrubbed).
 */
import { describe, it, expect } from 'vitest';
import { extractCognition } from '../canonCognition.js';
import { scrubSecrets } from '../canonSync.js';

const SF = 'canon/claude-code/sess-1.jsonl';

// Two reasoning-bearing turns of one session: turn 1 reasons then reads a file
// (its owning path resolves to a file node), turn 2 reasons then calls a
// non-file tool. Plus a no-reasoning assistant turn that must NOT emit a thought.
const RECORDS = [
  { type: 'assistant', timeline: { sessionId: 'sess-1', turnNumber: 1 },
    message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'I should read the config. The key is sk-ABCDEFGHIJKLMNOP123456 do not leak.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/config.ts' } },
    ] } },
  { type: 'assistant', timeline: { sessionId: 'sess-1', turnNumber: 2 },
    message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'Now let me search the codebase for the handler.' },
      { type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'handler' } },
    ] } },
  // No reasoning here → no thought node for turn 3.
  { type: 'assistant', timeline: { sessionId: 'sess-1', turnNumber: 3 },
    message: { role: 'assistant', content: [
      { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'ls' } },
    ] } },
  // Redacted-only turn → thought with structural label, no text.
  { type: 'assistant', timeline: { sessionId: 'sess-1', turnNumber: 4 },
    message: { role: 'assistant', content: [
      { type: 'redacted_thinking', data: 'opaque' },
    ] } },
];

// A resolver that only owns /repo/**, mirroring canonGraph's ownerOf → file node.
const resolveFile = (abs: string): string | undefined =>
  abs.startsWith('/repo/') ? `file:${abs.slice('/repo/'.length)}` : undefined;

describe('extractCognition — pure core', () => {
  it('emits one thought per reasoning-bearing turn (and none for tool-only turns)', () => {
    const r = extractCognition(RECORDS, { sessionSourceFile: SF, scrub: scrubSecrets, resolveFile });
    const thoughtNodes = r.nodes.filter((n) => n.node_type === 'thought');
    expect(r.thoughts).toBe(3); // turns 1, 2, 4 — turn 3 has no reasoning
    expect(thoughtNodes.map((n) => n.id).sort()).toEqual([
      'thought:sess-1:1', 'thought:sess-1:2', 'thought:sess-1:4',
    ]);
    // Keyed on session_id + turn — the join discipline.
    const t1 = thoughtNodes.find((n) => n.id === 'thought:sess-1:1')!;
    expect(t1.session_id).toBe('sess-1');
    expect(t1.turn).toBe(1);
    expect(t1.block_type).toBe('thinking');
    expect(t1.char_count).toBeGreaterThan(0);
    expect(t1.token_count).toBe(Math.ceil((t1.char_count as number) / 4));
  });

  it('NEVER leaks a secret: label is scrubbed and no raw text by default', () => {
    const r = extractCognition(RECORDS, { sessionSourceFile: SF, scrub: scrubSecrets, resolveFile });
    const t1 = r.nodes.find((n) => n.id === 'thought:sess-1:1')!;
    // Default: structural only — no `text` field.
    expect(t1.text).toBeUndefined();
    // The label is derived from thinking text BUT scrubbed — the sk- key is gone.
    expect(String(t1.label)).not.toContain('sk-ABCDEFGHIJKLMNOP123456');
    expect(String(t1.label)).toContain('[redacted:sk]');
    // Whole node, serialized, carries no raw secret.
    expect(JSON.stringify(t1)).not.toContain('sk-ABCDEFGHIJKLMNOP123456');
  });

  it('opt-in text is included but STILL scrubbed', () => {
    const r = extractCognition(RECORDS, { sessionSourceFile: SF, scrub: scrubSecrets, resolveFile, includeThoughtText: true });
    const t1 = r.nodes.find((n) => n.id === 'thought:sess-1:1')!;
    expect(typeof t1.text).toBe('string');
    expect(String(t1.text)).toContain('read the config');
    expect(String(t1.text)).not.toContain('sk-ABCDEFGHIJKLMNOP123456');
    expect(String(t1.text)).toContain('[redacted:sk]');
  });

  it('redacted-only turn → structural label, no text even opt-in', () => {
    const r = extractCognition(RECORDS, { sessionSourceFile: SF, scrub: scrubSecrets, resolveFile, includeThoughtText: true });
    const t4 = r.nodes.find((n) => n.id === 'thought:sess-1:4')!;
    expect(t4.block_type).toBe('redacted');
    expect(t4.label).toBe('[redacted] sess-1#4');
    expect(t4.text).toBeUndefined(); // no text to include
  });

  it('builds the three confidence-tagged edge types with the right grades', () => {
    const r = extractCognition(RECORDS, { sessionSourceFile: SF, scrub: scrubSecrets, resolveFile });

    // thought → tool_call, EXTRACTED (highest value, same-turn).
    const toolEdge = r.links.find((l) => l.relation === 'reasoned_for' && l.source === 'thought:sess-1:1');
    expect(toolEdge).toMatchObject({ target: 'tool:t1', confidence: 'EXTRACTED', confidence_score: 1.0, source_file: SF, weight: 1.0 });
    expect(r.nodes.find((n) => n.id === 'tool:t1')).toMatchObject({ node_type: 'tool_call', label: 'Read' });

    // thought → source_file, INFERRED (transitive via the tool call).
    const fileEdge = r.links.find((l) => l.relation === 'reasoned_about' && l.source === 'thought:sess-1:1');
    expect(fileEdge).toMatchObject({ target: 'file:src/config.ts', confidence: 'INFERRED', confidence_score: 0.5 });
    expect(r.fileLinks).toContainEqual({ thought: 'thought:sess-1:1', tool: 'tool:t1', absPath: '/repo/src/config.ts' });

    // thought → thought continuity, INFERRED, between consecutive reasoning turns.
    const contEdges = r.links.filter((l) => l.relation === 'continues');
    expect(contEdges).toHaveLength(2); // 1→2, 2→4
    expect(contEdges[0]).toMatchObject({ source: 'thought:sess-1:1', target: 'thought:sess-1:2', confidence: 'INFERRED' });
    expect(contEdges[1]).toMatchObject({ source: 'thought:sess-1:2', target: 'thought:sess-1:4' });

    expect(r.toolEdges).toBe(2);
    expect(r.fileEdges).toBe(1);   // only the /repo file resolves; Grep/Bash have no file input
    expect(r.continuityEdges).toBe(2);
  });

  it('without a resolver: fileLinks reported, no source_file edges', () => {
    const r = extractCognition(RECORDS, { sessionSourceFile: SF, scrub: scrubSecrets });
    expect(r.links.some((l) => l.relation === 'reasoned_about')).toBe(false);
    expect(r.fileEdges).toBe(0);
    expect(r.fileLinks).toContainEqual({ thought: 'thought:sess-1:1', tool: 'tool:t1', absPath: '/repo/src/config.ts' });
  });

  it('aggregates reasoning + tool_use split across records of the same turn', () => {
    const split = [
      { type: 'assistant', timeline: { sessionId: 's2', turnNumber: 1 },
        message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan' }] } },
      { type: 'assistant', timeline: { sessionId: 's2', turnNumber: 1 },
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x1', name: 'Write', input: { file_path: '/repo/a.ts' } }] } },
    ];
    const r = extractCognition(split, { sessionSourceFile: SF, scrub: scrubSecrets, resolveFile });
    expect(r.thoughts).toBe(1);
    expect(r.links.find((l) => l.relation === 'reasoned_for')).toMatchObject({ source: 'thought:s2:1', target: 'tool:x1' });
    expect(r.links.find((l) => l.relation === 'reasoned_about')).toMatchObject({ source: 'thought:s2:1', target: 'file:a.ts' });
  });
});
