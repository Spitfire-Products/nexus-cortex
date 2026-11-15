/** Generic `when` gate (2026-11-15): --mail-only depended on a script only our team has; `when` works for every npm user. */
import { describe, it, expect } from 'vitest';
import { mailGate, whenGateSync, whenGateAsync, type ScheduleJob } from './schedule.js';

const job = (o: Partial<ScheduleJob> = {}): ScheduleJob => ({ tag: '[t]', everyMin: 5, prompt: 'p', ...o });
const noMail = () => 'no new mail for x';

describe('when gate', () => {
  it('fires only when the command exits 0 AND prints something', async () => {
    expect(whenGateSync('echo work')).toBe(true);
    expect(whenGateSync('true')).toBe(false);          // exit 0, silent
    expect(whenGateSync('echo x; exit 3')).toBe(false); // prints, but fails
    expect(whenGateSync('no-such-command-xyz 2>/dev/null')).toBe(false);
    expect(await whenGateAsync('echo work')).toBe(true);
    expect(await whenGateAsync('true')).toBe(false);
  });
  it('mailGate: a job with `when` is gated by it; plain jobs always pass; mail-only unchanged', () => {
    expect(mailGate(job(), noMail)).toBe(true);
    expect(mailGate(job({ when: 'echo yes' }), noMail)).toBe(true);
    expect(mailGate(job({ when: 'true' }), noMail)).toBe(false);
    expect(mailGate(job({ mailOnly: true, mailName: 'a' }), noMail)).toBe(false);
    expect(mailGate(job({ mailOnly: true, mailName: 'a' }), () => '[01:00Z from b] hi')).toBe(true);
    expect(mailGate(job({ mailOnly: true, mailName: 'a', when: 'true' }), () => '[01:00Z from b] hi')).toBe(false);
  });
});
