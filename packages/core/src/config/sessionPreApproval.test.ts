/**
 * The one-shot pre-approval handoff (vault task T3, defect D2 + rev 4): the floor's dialog records the answer, releaseSite
 * consumes it. In memory only, TTL 30 s, single use, injectable clock — and BOUND to the vault entry (importedAt) and the
 * session that answered, so a mismatched take can neither consume it nor burn it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  notePreApproval, takePreApproval, clearPreApprovals, PRE_APPROVAL_TTL_MS, releaseSite,
} from './sessionRelease.js';

const SITE = 'github.com';
const AT = 1700000000000;
const SID = 's1';

beforeEach(() => clearPreApprovals());

describe('notePreApproval / takePreApproval', () => {
  it('hands the recorded scope to the next take of the SAME site + entry + session', () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'always', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBe('always');
  });

  it('is consumed exactly once', () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'session', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBe('session');
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBeUndefined();
  });

  it('a pre-approval for site A cannot release site B (and B\'s take leaves A\'s answer in place)', () => {
    notePreApproval({ site: 'a.example.com', importedAt: AT, sessionId: SID, scope: 'always', now: 1000 });
    expect(takePreApproval({ site: 'b.example.com', importedAt: AT, sessionId: SID, now: 1000 })).toBeUndefined();
    expect(takePreApproval({ site: 'a.example.com', importedAt: AT, sessionId: SID, now: 1000 })).toBe('always');
  });

  it('cannot release a RE-IMPORTED site: the same site with a different importedAt is a different entry', () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'always', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT + 999, sessionId: SID, now: 1000 })).toBeUndefined();
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBe('always');
  });

  it('cannot be consumed with ANOTHER sessionId, nor WITHOUT one', () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'once', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: 's2', now: 1000 })).toBeUndefined();
    expect(takePreApproval({ site: SITE, importedAt: AT, now: 1000 })).toBeUndefined();
    // ...and the mismatched takes did not burn it
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBe('once');
  });

  it('a note with no sessionId records nothing (it could never be consumed)', () => {
    notePreApproval({ site: SITE, importedAt: AT, scope: 'always', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBeUndefined();
  });

  it('expires after the TTL and is dropped', () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'always', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 + PRE_APPROVAL_TTL_MS + 1 })).toBeUndefined();
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBeUndefined();
  });

  it('never records "no" (nothing to release, nothing to remember)', () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'no' as unknown as 'once', now: 1000 });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBeUndefined();
  });
});

describe('a pre-approval is created ONLY by an interactive dialog answer', () => {
  it('releaseSite with NO sessionId consumes nothing: the tool\'s own ask is used (fail closed)', async () => {
    notePreApproval({ site: SITE, importedAt: AT, sessionId: SID, scope: 'always', now: 1000 });
    // No vault here, so the release returns early — the take is the thing under test.
    const ask = vi.fn();
    await releaseSite(SITE, 'once', { send: async () => ({}) } as never, {
      ask: ask as never, vaultFile: '/nonexistent/vault.enc', logFile: '/nonexistent/log', grantsFile: '/nonexistent/grants.json',
    });
    expect(takePreApproval({ site: SITE, importedAt: AT, sessionId: SID, now: 1000 })).toBe('always');
  });
});
