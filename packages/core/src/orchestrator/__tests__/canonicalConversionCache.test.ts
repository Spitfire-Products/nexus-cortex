/**
 * Round 5 (parallel-bench output): canonical conversion prefix-cache.
 *
 * `convertToCanonicalMessages` walks the entire message history every call,
 * from 4 sites. Messages 0..N-2 are immutable (persisted append-only JSONL,
 * uuid-keyed) so we cache them by uuid. The LAST message is always
 * recomputed because (1) it can be the substituted `userMessageForApi` with
 * per-turn `cache_control`, (2) budget signals can be appended in-place
 * between iterations, (3) the orphan-repair pass may mutate it.
 *
 * Repair runs on the merged array — never cached past repair.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createOrchestrator } from '../OrchestratorFactory.js';
import type { CortexOrchestrator } from '../CortexOrchestrator.js';
import type { Message } from '../../session/MessageTypes.js';

describe('convertToCanonicalMessages — prefix cache (Round 5)', () => {
  let orchestrator: CortexOrchestrator;

  beforeEach(async () => {
    orchestrator = await createOrchestrator({
      defaultModelId: 'claude-sonnet-4-5',
      projectPath: '/tmp/test-canonical-cache',
      storageDir: '/tmp/test-canonical-cache/.cortex',
      debug: false,
    });
    await orchestrator.createSession('/tmp/test-canonical-cache');
  });

  const mkUser = (uuid: string, text: string): Message => ({
    uuid,
    parentUuid: null,
    timestamp: new Date().toISOString(),
    sessionId: 's1',
    type: 'user',
    message: { role: 'user', content: text },
  } as any);

  it('prefix messages share content array with cache (shallow-cloned wrapper, same content ref)', () => {
    const convert = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const history = [
      mkUser('uuid-A', 'msg A'),
      mkUser('uuid-B', 'msg B'),
      mkUser('uuid-C', 'msg C'),
    ];
    const r1 = convert(history);
    const r2 = convert(history);
    // Index 0 and 1 (prefix): wrapper is shallow-cloned (different refs) but
    // content array is shared (cache value)
    expect(r2[0]).not.toBe(r1[0]); // wrapper cloned
    expect(r2[0].content).toBe(r1[0].content); // content shared
    expect(r2[0].uuid).toBe('uuid-A');
    expect(r2[1].uuid).toBe('uuid-B');
    // Last message → always recomputed → fresh wrapper AND fresh content
    expect(r2[2]).not.toBe(r1[2]);
    expect(r2[2].content).toEqual(r1[2].content);
  });

  it('grows the history → former tail becomes prefix and is now cached', () => {
    const convert = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const m1 = mkUser('uuid-1', 'first');
    const m2 = mkUser('uuid-2', 'second');
    const m3 = mkUser('uuid-3', 'third');

    // First call: history = [m1, m2]. m1 cached, m2 is tail (not cached)
    const r1 = convert([m1, m2]);
    expect(r1[0].uuid).toBe('uuid-1');
    expect(r1[1].uuid).toBe('uuid-2');

    // Second call: history = [m1, m2, m3]. m1 cached, m2 now becomes prefix
    // and gets cached on miss, m3 is new tail.
    const r2 = convert([m1, m2, m3]);
    // m1 cached → shared content ref with r1[0]
    expect(r2[0].content).toBe(r1[0].content);
    // m2 was NOT cached during r1 (it was the tail), so r2[1].content is
    // freshly produced and now cached.
    const m2ContentRef = r2[1].content;
    // Third call: m2 is cached → returns shared content ref
    const r3 = convert([m1, m2, m3]);
    expect(r3[1].content).toBe(m2ContentRef);
  });

  it('messages without uuid bypass cache (recomputed every call, no crash)', () => {
    const convert = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const noUuid = { ...mkUser('placeholder', 'x'), uuid: undefined } as any;
    const tail = mkUser('uuid-tail', 'last');
    const r1 = convert([noUuid, tail]);
    const r2 = convert([noUuid, tail]);
    // No uuid → no cache entry → fresh reference each time
    expect(r2[0]).not.toBe(r1[0]);
    expect(r2[0].content).toEqual(r1[0].content);
  });

  // Round 6 (Opus self-audit finding): synthetic repair uuids must be
  // collision-safe. The old `synthetic_repair_${Date.now()}` was
  // millisecond-granular and aliased under parallel dispatch.
  it('synthetic repair uuids are collision-safe across rapid back-to-back repairs', () => {
    const convert = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const orphanA: Message = {
      uuid: 'asst-A',
      parentUuid: null,
      timestamp: new Date().toISOString(),
      sessionId: 's1',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu-A', name: 'X', input: {} }],
      },
    } as any;
    const orphanB: Message = { ...orphanA, uuid: 'asst-B', message: { ...orphanA.message, content: [{ type: 'tool_use', id: 'tu-B', name: 'Y', input: {} }] } } as any;

    // Force two repair passes — orphans have no following user msg so the
    // synthetic-uuid branch fires.
    const r1 = convert([orphanA]);
    const r2 = convert([orphanB]);
    const synA = r1.find((m: any) => typeof m.uuid === 'string' && m.uuid.startsWith('synthetic_repair_'));
    const synB = r2.find((m: any) => typeof m.uuid === 'string' && m.uuid.startsWith('synthetic_repair_'));
    expect(synA).toBeDefined();
    expect(synB).toBeDefined();
    // Distinct uuids — uuidv4 collision probability is effectively zero
    expect(synA.uuid).not.toBe(synB.uuid);
    // And each synthetic carries the correct tool_use_id for its own session
    expect((synA.content[0] as any).toolResult.tool_use_id).toBe('tu-A');
    expect((synB.content[0] as any).toolResult.tool_use_id).toBe('tu-B');
  });

  // Round 6: canonicalConversionCache must clear on session reset.
  it('createSession clears the canonical conversion cache (no leak across sessions)', async () => {
    const convert = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);
    const m = mkUser('uuid-cross', 'sessionA');
    const tail = mkUser('uuid-tail', 'tail');
    const r1 = convert([m, tail]);
    const contentRef = r1[0].content;

    // Confirm cache hit before reset
    const r2 = convert([m, tail]);
    expect(r2[0].content).toBe(contentRef);

    // Reset session — should wipe cache
    await orchestrator.createSession('/tmp/test-canonical-cache');

    // After reset, the same uuid produces a fresh content array (cache cleared)
    const r3 = convert([m, tail]);
    expect(r3[0].content).not.toBe(contentRef);
  });

  it('repair pass runs after merge and does NOT poison cached prefix entries', () => {
    // Build a history where an assistant in the PREFIX has an orphaned
    // tool_use and the following user message in the prefix has no
    // matching tool_result. Repair will mutate that user message's content
    // in place (line 5775). The shallow-clone-on-cache-hit ensures the
    // cache entry stays clean across calls.
    const orphanAssistant: Message = {
      uuid: 'uuid-orphan',
      parentUuid: null,
      timestamp: new Date().toISOString(),
      sessionId: 's1',
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tool-zzz', name: 'Read', input: { file_path: '/x' } },
        ],
      },
    } as any;
    const midUser = mkUser('uuid-mid', 'response from user');
    const tail = mkUser('uuid-tail', 'continuation');
    const history = [orphanAssistant, midUser, tail];

    const convert = (orchestrator as any).convertToCanonicalMessages.bind(orchestrator);

    const r1 = convert(history);
    // Repair prepended synthetic tool_results into midUser's content (the
    // canonical, in-array wrapper — not the cache entry).
    const r1Mid = r1.find((m: any) => m.uuid === 'uuid-mid');
    expect(r1Mid).toBeDefined();
    const hasRepairInMid =
      Array.isArray(r1Mid.content) &&
      r1Mid.content.some((b: any) => b.type === 'tool_result' && b.toolResult?.is_error);
    expect(hasRepairInMid).toBe(true);

    // Second call: cache hit for midUser must NOT carry the repair bleed-over.
    // The repair pass re-runs and re-prepends synthetic tool_results — but
    // only into the freshly returned shallow-cloned wrapper, never twice
    // into the cached object.
    const r2 = convert(history);
    const r2Mid = r2.find((m: any) => m.uuid === 'uuid-mid');
    const toolResults = r2Mid.content.filter(
      (b: any) => b.type === 'tool_result' && b.toolResult?.is_error,
    );
    // Exactly one synthetic tool_result — not two (which would indicate
    // double-repair from a cache-bleed).
    expect(toolResults).toHaveLength(1);
  });
});
