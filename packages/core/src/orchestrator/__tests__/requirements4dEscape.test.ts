import { describe, it, expect } from 'vitest';
import { verifyRequirements } from '../requirementsVerification.js';

const base = { requirements: [], verification: [], userTaskText: '' };

describe('Stage 4d — mutating turn without verification', () => {
  it('Bash-only turn: an open_items reason is the accepted escape', () => {
    expect(verifyRequirements({ ...base, turnUsedMutatingTool: true, turnEditedFiles: false,
      openItems: ['No files were created or modified; this was a browsing task.'] }).ok).toBe(true);
  });
  it('Bash-only turn with no reason is still asked for one, and is not told it modified files', () => {
    const v = verifyRequirements({ ...base, turnUsedMutatingTool: true, turnEditedFiles: false, openItems: [] });
    expect(v.ok).toBe(false);
    expect(v.nudge).toContain('you ran Bash');
  });
  it('a turn that edited files must run a check whatever open_items says', () => {
    const v = verifyRequirements({ ...base, turnUsedMutatingTool: true, turnEditedFiles: true, openItems: ['could not test it'] });
    expect(v.ok).toBe(false);
    expect(v.nudge).toContain('changed files');
  });
  it('callers that do not pass turnEditedFiles keep the old strict behaviour', () => {
    expect(verifyRequirements({ ...base, turnUsedMutatingTool: true, openItems: ['reason reason'] }).ok).toBe(false);
  });
});
