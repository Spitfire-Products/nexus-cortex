import { describe, it, expect } from 'vitest';
import { webTurnEvidenced } from '../endTurnResolver.js';

describe('a web turn is evidenced by its web output', () => {
  it('web results and no file writes → evidenced', () => {
    expect(webTurnEvidenced({ webContent: ['# Sub-Agent Result …'], writeInputs: [], usedFileEditTool: false }, {} as any)).toBe(true);
  });
  it('a turn that wrote files still needs a check; a turn with no web output is not a web turn', () => {
    expect(webTurnEvidenced({ webContent: ['x'], writeInputs: ['code'], usedFileEditTool: true }, {} as any)).toBe(false);
    expect(webTurnEvidenced({ webContent: [], writeInputs: [], usedFileEditTool: false }, {} as any)).toBe(false);
  });
  it('CORTEX_MEETS_CONFIRM_WEB=hold restores the hold', () => {
    expect(webTurnEvidenced({ webContent: ['x'], writeInputs: [] }, { CORTEX_MEETS_CONFIRM_WEB: 'hold' } as any)).toBe(false);
  });
});

import { webFinishStands } from '../endTurnResolver.js';
describe('accept-with-gap on a web turn stands (no finish-confirm hold)', () => {
  it('web turn → stands; coding turn → held as before; =hold restores', () => {
    expect(webFinishStands({ webContent: ['x'], writeInputs: [], usedFileEditTool: false }, {} as any)).toBe(true);
    expect(webFinishStands({ webContent: ['x'], writeInputs: ['code'], usedFileEditTool: true }, {} as any)).toBe(false);
    expect(webFinishStands({ webContent: ['x'], writeInputs: [] }, { CORTEX_FINISH_CONFIRM_WEB: 'hold' } as any)).toBe(false);
  });
});
