/**
 * L-05 onboarding block — content honesty + shown-once marker contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { onboardingLines, shouldShowOnboarding, markOnboardingShown } from '../tuiOnboarding';
import { keymapFooterHint } from '../tuiKeymap';

describe('onboardingLines', () => {
  it('ends with the surface keymap footer (L-08: hints come from the table)', () => {
    for (const surface of ['ink-app', 'ink-chat', 'chalk'] as const) {
      const lines = onboardingLines(surface);
      expect(lines[lines.length - 1]).toBe(keymapFooterHint(surface));
    }
  });

  it('advertises only features that exist (no @file / !shell — unimplemented)', () => {
    const text = onboardingLines('chalk').join('\n');
    expect(text).not.toMatch(/@file/);
    expect(text).not.toMatch(/!shell/);
    expect(text).toContain('/help');
    expect(text).toContain('/model');
  });
});

describe('shown-once marker', () => {
  // The config dir is injected: vitest worker threads proxy process.env, so
  // os.homedir() cannot be steered via $HOME here (it reads the C-level
  // environ) — production callers use the default (~/.cortex).
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-onboard-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows on a fresh machine, then never again after marking', () => {
    expect(shouldShowOnboarding(tmpDir)).toBe(true);
    markOnboardingShown(tmpDir);
    expect(shouldShowOnboarding(tmpDir)).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'onboarded'))).toBe(true);
  });
});
