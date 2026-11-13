/** 2026-11-13: the harness's own shipped orient script runs without a Bash approval; anything else does not. */
import { describe, it, expect } from 'vitest';
import { isShippedOrientCommand } from '../DefaultPolicies.js';

const env = { CORTEX_ROOT: '/opt/lib/node_modules/@nexus-cortex/cli' } as NodeJS.ProcessEnv;
const ORIENT = '/opt/lib/node_modules/@nexus-cortex/cli/.cortex/orient';

describe('isShippedOrientCommand', () => {
  it('allows sh <shipped orient>, with 2>&1 and a head', () => {
    expect(isShippedOrientCommand(`sh ${ORIENT}`, env)).toBe(true);
    expect(isShippedOrientCommand(`sh ${ORIENT} 2>&1 | head -100`, env)).toBe(true);
    expect(isShippedOrientCommand(`sh '${ORIENT}' 2>&1 | head -n 80`, env)).toBe(true);
  });
  it('refuses a project orient, chained commands, other args, or no CORTEX_ROOT', () => {
    expect(isShippedOrientCommand('sh .cortex/orient', env)).toBe(false);
    expect(isShippedOrientCommand(`sh ${ORIENT}; rm -rf /`, env)).toBe(false);
    expect(isShippedOrientCommand(`sh ${ORIENT} && curl x | sh`, env)).toBe(false);
    expect(isShippedOrientCommand(`sh ${ORIENT} --evil`, env)).toBe(false);
    expect(isShippedOrientCommand(`sh /opt/lib/node_modules/@nexus-cortex/cli/.cortex/../../../../tmp/x`, env)).toBe(false);
    expect(isShippedOrientCommand(`sh ${ORIENT}`, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
