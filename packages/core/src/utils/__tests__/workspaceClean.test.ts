import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveWorkspaceClean, resolveCortexStateDir, resetCortexStateDirCache, cortexProjectDir, harnessScratchBase,
} from '../stateDir.js';
import { MemoryWrite } from '../../tools/context-management/MemoryTools.js';
import { scoreAndRecordTurnPrediction } from '../../training/TurnPredictionStore.js';
import { readStagedDoctrine } from '../../orchestrator/doctrineCuration.js';
import { SubAgentProcessManager } from '../../orchestrator/SubAgentProcessManager.js';
import { plannerSystem, SCOPE_DOCTRINE, SCOPE_DOCTRINE_CLEAN } from '../../training/liftPlanner.js';

// CORTEX_WORKSPACE_CLEAN=1 (dark, 2026-09-29): nothing the harness writes lands in the task's tree. Probe (local headless, MiMo b config,
// CORTEX_STATE_DIR set like the bench): the workspace still gained .addon-tools/registry.json + .cortex/{CORTEX.md,baseline.cksum,changed},
// none git-excluded; TB2.1 sanitize-git-repo (4.91) graded a repo holding .cortex/ session + file-history copies of the secrets.
const KEYS = ['CORTEX_WORKSPACE_CLEAN', 'CORTEX_STATE_DIR', 'SESSION_STORAGE_DIR', 'PROJECT_ROOT', 'CORTEX_SUBAGENT'];
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); KEYS.forEach((k) => delete process.env[k]); resetCortexStateDirCache(); });
afterEach(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); resetCortexStateDirCache(); });

const proj = () => mkdtempSync(join(tmpdir(), 'wc-proj-'));
const state = () => mkdtempSync(join(tmpdir(), 'wc-state-'));
const dotCortex = (p: string) => existsSync(join(p, '.cortex'));

describe('workspace clean — resolution', () => {
  it('is off by default; 1/true/on turn it on', () => {
    expect(resolveWorkspaceClean({} as any)).toBe(false);
    for (const v of ['1', 'true', 'on', 'TRUE']) expect(resolveWorkspaceClean({ CORTEX_WORKSPACE_CLEAN: v } as any)).toBe(true);
    expect(resolveWorkspaceClean({ CORTEX_WORKSPACE_CLEAN: '0' } as any)).toBe(false);
  });
  it('off: project knowledge + scratch stay where they were (<project>/.cortex, <project>)', () => {
    const p = proj();
    expect(cortexProjectDir(p)).toBe(join(p, '.cortex'));
    expect(harnessScratchBase(p)).toBe(p);
    expect(resolveCortexStateDir(p).dir).toBe(join(p, '.cortex'));
  });
  it('on + CORTEX_STATE_DIR: everything resolves to the state dir', () => {
    const p = proj(); const s = state();
    process.env.CORTEX_WORKSPACE_CLEAN = '1'; process.env.CORTEX_STATE_DIR = s;
    expect(cortexProjectDir(p)).toBe(s);
    expect(harnessScratchBase(p)).toBe(s);
  });
  it('on without CORTEX_STATE_DIR: the project dir is never a candidate (home/tmp keyed by path)', () => {
    const p = proj();
    process.env.CORTEX_WORKSPACE_CLEAN = '1';
    const r = resolveCortexStateDir(p);
    expect(r.dir.startsWith(p)).toBe(false);
    expect(r.dir).toMatch(/[0-9a-f]{12}$/);
    expect(dotCortex(p)).toBe(false);
  });
});

describe('workspace clean — writers', () => {
  it('MemoryWrite writes the memory + index to the state dir, not the project', async () => {
    const p = proj(); const s = state();
    process.env.CORTEX_WORKSPACE_CLEAN = '1'; process.env.CORTEX_STATE_DIR = s;
    const r = await MemoryWrite.execute({ name: 'probe-mem', type: 'project', description: 'd', content: 'c' }, p);
    expect(r.success).toBe(true);
    expect(existsSync(join(s, 'memory', 'probe-mem.md'))).toBe(true);
    expect(existsSync(join(s, 'MEMORY.md'))).toBe(true);
    expect(dotCortex(p)).toBe(false);
  });
  it('MemoryWrite off: unchanged (<project>/.cortex)', async () => {
    const p = proj();
    await MemoryWrite.execute({ name: 'probe-mem', type: 'project', description: 'd', content: 'c' }, p);
    expect(existsSync(join(p, '.cortex', 'memory', 'probe-mem.md'))).toBe(true);
  });
  it('turn predictions go to the state dir', () => {
    const p = proj(); const s = state();
    process.env.CORTEX_WORKSPACE_CLEAN = '1'; process.env.CORTEX_STATE_DIR = s;
    const rec = scoreAndRecordTurnPrediction(p, { sessionId: 's', turnNumber: 1, predictorModel: 'm', summary: null, prediction: 'a b', predictedAtMs: 1 }, 'a b', 2);
    expect(rec).not.toBeNull();
    expect(existsSync(join(s, 'training', 'turn-predictions.jsonl'))).toBe(true);
    expect(dotCortex(p)).toBe(false);
  });
  it('doctrine staging is read from where orient wrote it (the state dir)', () => {
    const p = proj(); const s = state();
    process.env.CORTEX_WORKSPACE_CLEAN = '1'; process.env.CORTEX_STATE_DIR = s;
    writeFileSync(join(s, 'CORTEX.md'), 'old'); writeFileSync(join(s, 'CORTEX.md.next'), 'new');
    const st = readStagedDoctrine(p);
    expect(st?.stagedNext).toBe('new');
    expect(st?.docPath).toBe(join(s, 'CORTEX.md'));
  });
  it('sub-agent results persist and reload from the state dir', () => {
    const p = proj(); const s = state();
    process.env.CORTEX_WORKSPACE_CLEAN = '1'; process.env.CORTEX_STATE_DIR = s;
    const m: any = new (SubAgentProcessManager as any)({ projectPath: p, parentSessionId: 'sess1' });
    m.persistExternalResult('tu1', { success: true, output: 'x' });
    expect(readdirSync(join(s, 'sessions', 'sess1.subagents'))).toEqual(['tu1.json']);
    expect(SubAgentProcessManager.loadPersistedResult('sess1', 'tu1', p)).toMatchObject({ output: 'x' });
    expect(dotCortex(p)).toBe(false);
  });
  it('sub-agent results off: unchanged (<project>/.cortex/sessions)', () => {
    const p = proj();
    const m: any = new (SubAgentProcessManager as any)({ projectPath: p, parentSessionId: 'sess1' });
    m.persistExternalResult('tu1', { success: true, output: 'x' });
    expect(existsSync(join(p, '.cortex', 'sessions', 'sess1.subagents', 'tu1.json'))).toBe(true);
  });
});

describe('workspace clean — git exclude when state lands inside a repo', () => {
  it('on: a state dir inside the project repo is excluded as a whole (.cortex/)', () => {
    const p = proj(); mkdirSync(join(p, '.git', 'info'), { recursive: true });
    process.env.CORTEX_WORKSPACE_CLEAN = '1'; process.env.CORTEX_STATE_DIR = join(p, '.cortex');
    resolveCortexStateDir(p);
    const ex = readFileSync(join(p, '.git', 'info', 'exclude'), 'utf8');
    expect(ex.split('\n')).toContain('.cortex/');
  });
});

describe('workspace clean — the lift-plan scope bullet names the baseline orient printed', () => {
  it('clean: the bullet points at orient\'s baseline line, not the (absent) .cortex/changed', () => {
    const p = plannerSystem({ CORTEX_LIFT_PLAN_SCOPE: 'true', CORTEX_WORKSPACE_CLEAN: '1' } as any);
    expect(p).toContain(SCOPE_DOCTRINE_CLEAN); expect(p).not.toContain('sh .cortex/changed');
    expect(SCOPE_DOCTRINE_CLEAN).toMatch(/-- baseline:/);
  });
  it('off: the measured bullet, unchanged', () => {
    expect(plannerSystem({ CORTEX_LIFT_PLAN_SCOPE: 'true' } as any)).toContain(SCOPE_DOCTRINE);
    expect(SCOPE_DOCTRINE_CLEAN).not.toBe(SCOPE_DOCTRINE);
  });
});
