/** 2026-11-13: screen capture / synthetic input / app scripting through Bash always asks; since 11-14 also with the desktop surface on (the prompt points at the desktop tool). */
import { describe, it, expect, afterEach, vi } from 'vitest';

// 11-14 (macbook step 5b): with the desktop surface ON, Bash screencapture/osascript ran with no prompt — around the desktop tool's stop
// latch, failsafe and audit. The surface is mocked ON for the whole file so every case proves the guard no longer depends on it.
vi.mock('../../../config/localDesktop.js', () => ({ resolveDesktop: () => ({ mode: 'real', using: true, reason: 'mocked on' }) }));
import { nativeAutomationCategory, blacklistPolicy } from '../DefaultPolicies.js';

const ev = (command: string) => blacklistPolicy.evaluate({ toolName: 'Bash', toolInput: { command } } as any);

describe('nativeAutomationCategory', () => {
  it('flags what the M2 session ran', () => {
    expect(nativeAutomationCategory('screencapture -x /tmp/_probe_cap.png')).toBe('screen capture');
    expect(nativeAutomationCategory("cat > _cgtest.py <<'EOF'\ncg.CGEventPost(0, ev)\nEOF\npython3 _cgtest.py")).toBe('synthetic mouse/keyboard input');
    expect(nativeAutomationCategory(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`)).toBe('app or UI scripting (AppleScript/JXA)');
    expect(nativeAutomationCategory(`osascript -e 'tell application "Safari" to do JavaScript "document.title" in document 1'`)).toBeDefined();
    expect(nativeAutomationCategory('safaridriver -p 4444 &')).toBeDefined();
    expect(nativeAutomationCategory('cliclick c:100,200')).toBeDefined();
    expect(nativeAutomationCategory('shortcuts run "Resize Image"')).toBeDefined();
  });
  it('leaves ordinary commands alone', () => {
    expect(nativeAutomationCategory('ls -la ~/Desktop')).toBeUndefined();
    // 11-14 (macbook C9 + the operator granted node full Automation on the m2): ANY osascript/osacompile through Bash is native
    // automation now — a .scpt file, a direct `tell application "Finder"` and keyword-free JXA all slipped the old pattern list
    expect(nativeAutomationCategory(`osascript -e 'display notification "done"'`)).toBeDefined();
    expect(nativeAutomationCategory('osascript ~/bat/x.scpt')).toBeDefined();
    expect(nativeAutomationCategory(`osascript -e 'tell application "Finder" to activate'`)).toBeDefined();
    expect(nativeAutomationCategory(`osascript -l JavaScript -e 'Application("Finder").activate()'`)).toBeDefined();
    expect(nativeAutomationCategory('osacompile -o x.scpt x.applescript && osascript x.scpt')).toBeDefined();
    expect(nativeAutomationCategory('open -a Numbers report.csv')).toBeUndefined();
    expect(nativeAutomationCategory('git commit -m "click handler fix"')).toBeUndefined();
  });
});

describe('blacklist policy', () => {
  const saved = process.env.NEXUS_DESKTOP;
  afterEach(() => { if (saved === undefined) delete process.env.NEXUS_DESKTOP; else process.env.NEXUS_DESKTOP = saved; });
  it('always asks (blacklist tier) without the desktop surface', async () => {
    delete process.env.NEXUS_DESKTOP;
    const r = await ev('screencapture -x /tmp/a.png');
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe('blacklist');
  });
  it('passes through to the normal policies for ordinary commands', async () => {
    delete process.env.NEXUS_DESKTOP;
    expect((await ev('ls')).allowed).toBe(true);
  });
  it('still asks with the desktop surface ON and points at the desktop tool', async () => {
    const r = await ev('screencapture -x /tmp/a.png');
    expect(r.allowed).toBe(false);
    expect(r.tier).toBe('blacklist');
    expect(String(r.reason)).toMatch(/desktop tool/);
  });
});
