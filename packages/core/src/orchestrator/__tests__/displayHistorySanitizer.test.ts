import { describe, it, expect } from 'vitest';
import { sanitizeHistoryForDisplay, stripSystemReminders } from '../displayHistorySanitizer.js';

describe('displayHistorySanitizer', () => {
  describe('stripSystemReminders', () => {
    it('removes a complete span', () => {
      expect(stripSystemReminders('a <system-reminder>hide</system-reminder> b')).toBe('a  b');
    });
    it('returns empty when the text is ONLY a reminder', () => {
      expect(stripSystemReminders('<system-reminder>x</system-reminder>')).toBe('');
    });
    it('removes multiple spans (non-greedy)', () => {
      expect(stripSystemReminders('<system-reminder>a</system-reminder>keep<system-reminder>b</system-reminder>')).toBe('keep');
    });
    it('passes through text with no reminder unchanged', () => {
      expect(stripSystemReminders('just an answer')).toBe('just an answer');
    });
    it('handles multi-line reminder bodies', () => {
      expect(stripSystemReminders('<system-reminder>\nline1\nline2\n</system-reminder>')).toBe('');
    });
  });

  describe('sanitizeHistoryForDisplay', () => {
    it('drops a pure-reminder text block appended to a tool_result (the lift-nudge leak)', () => {
      const hist = [{
        uuid: 'a', type: 'user',
        message: { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'file1\nfile2' },
          { type: 'text', text: '<system-reminder>\nYour tool set has expanded. 42 more tools exist.\n</system-reminder>' },
        ] },
      }];
      const out = sanitizeHistoryForDisplay(hist);
      expect(out[0].message.content).toHaveLength(1);
      expect(out[0].message.content[0].type).toBe('tool_result');
    });

    it('does NOT mutate the model-facing originals', () => {
      const block = { type: 'text', text: '<system-reminder>x</system-reminder>' };
      const hist = [{ message: { role: 'user', content: [{ type: 'tool_result', content: 'r' }, block] } }];
      sanitizeHistoryForDisplay(hist);
      expect(hist[0].message.content).toHaveLength(2);
      expect(hist[0].message.content[1].text).toContain('system-reminder');
    });

    it('returns clean messages BY REFERENCE (no needless copy)', () => {
      const clean = { message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } };
      const out = sanitizeHistoryForDisplay([clean]);
      expect(out[0]).toBe(clean);
    });

    it('strips a reminder embedded in string content', () => {
      const hist = [{ message: { role: 'user', content: 'pre <system-reminder>hide</system-reminder> post' } }];
      expect(sanitizeHistoryForDisplay(hist)[0].message.content).toBe('pre  post');
    });

    it('strips only the reminder span from a mixed text block, keeping the rest', () => {
      const hist = [{ message: { role: 'user', content: [
        { type: 'text', text: 'real answer <system-reminder>hide</system-reminder>' },
      ] } }];
      const out = sanitizeHistoryForDisplay(hist);
      expect(out[0].message.content[0].text).toBe('real answer');
    });
  });
});
