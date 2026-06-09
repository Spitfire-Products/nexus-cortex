import { describe, it, expect } from 'vitest';
import { shouldAutoInjectMcp } from '../mcpAutoInjectPolicy.js';

describe('shouldAutoInjectMcp', () => {
  it('returns false when no servers are connected, regardless of env var', () => {
    expect(shouldAutoInjectMcp(0, undefined)).toBe(false);
    expect(shouldAutoInjectMcp(0, 'true')).toBe(false);
    expect(shouldAutoInjectMcp(0, 'false')).toBe(false);
  });

  it('returns true when servers are connected and env var is unset', () => {
    expect(shouldAutoInjectMcp(1, undefined)).toBe(true);
    expect(shouldAutoInjectMcp(5, undefined)).toBe(true);
  });

  it('returns true when servers are connected and env var is "true"', () => {
    expect(shouldAutoInjectMcp(1, 'true')).toBe(true);
  });

  it('returns false when servers are connected but env var is "false" (operator opt-out)', () => {
    expect(shouldAutoInjectMcp(1, 'false')).toBe(false);
    expect(shouldAutoInjectMcp(10, 'false')).toBe(false);
  });

  it('treats anything other than literal "false" as enabled (case-sensitive)', () => {
    expect(shouldAutoInjectMcp(1, 'False')).toBe(true);
    expect(shouldAutoInjectMcp(1, 'FALSE')).toBe(true);
    expect(shouldAutoInjectMcp(1, '0')).toBe(true);
    expect(shouldAutoInjectMcp(1, '')).toBe(true);
  });
});
