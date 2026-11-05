import { describe, it, expect } from 'vitest';
import { withUserRequest } from '../CortexOrchestrator.js';

describe('browse delegate carries the user request', () => {
  const user = 'Use the browser to go to carmax.com and complete this task: See Nissan and Honda cars for sale near Kentwood, MI 49512.';
  it('appends the request when the parent task dropped the scope', () => {
    const out = withUserRequest('Open https://www.carmax.com/cars/honda/nissan in a fresh browser and report the count.', user);
    expect(out).toContain('near Kentwood, MI 49512');
    expect(out).toContain("The user's original request");
  });
  it('does not duplicate a request the task already contains, and is a no-op without user text', () => {
    expect(withUserRequest(`Do this: ${user}`, user)).toBe(`Do this: ${user}`);
    expect(withUserRequest('task', '')).toBe('task');
  });
});
