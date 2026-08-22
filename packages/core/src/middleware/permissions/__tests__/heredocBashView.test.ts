/**
 * Heredoc-aware bash permission analysis (operator-commissioned 2026-08-22).
 *
 * The original early-development rule treated EVERY `<`/`>` as unsafe
 * (DefaultPolicies whitelist `/[<>]/`), so all heredocs fell out of the safe
 * whitelist — built when models were bad at heredocs. The narrow-door program
 * showed current (and our trained bash-focused) models are heredoc-proficient,
 * so the analysis becomes structural:
 *
 *  - stdin-only heredoc feeding a SAFE command (`cat <<'EOF' ... EOF`) →
 *    whitelist (it writes nothing).
 *  - heredoc + file redirect (`cat > f <<EOF`) → graylist (a WRITE — parity
 *    with the Write tool, auto-approvable), NOT a hard ejection.
 *  - null-sink redirects (`2>/dev/null`, `>/dev/null`, `2>&1`) stay safe.
 *  - dangerous-pattern scans ignore NON-INTERPRETER heredoc bodies (writing a
 *    script that CONTAINS `rm -rf ./dist` is a write, not an execution) but
 *    still scan bodies piped into interpreters (`bash <<EOF` executes them).
 */
import { describe, it, expect } from 'vitest';
import { analyzeBashCommand } from '../bashCommandView.js';
import { whitelistPolicy, blacklistPolicy } from '../DefaultPolicies.js';
import type { PermissionContext } from '../../contracts/MiddlewareContracts.js';

function ctx(command: string): PermissionContext {
  return {
    toolName: 'Bash',
    toolInput: { command },
    sessionId: 't',
    timestamp: new Date(),
  } as PermissionContext;
}

describe('analyzeBashCommand (heredoc/redirect structural view)', () => {
  it('passes plain commands through untouched', () => {
    const v = analyzeBashCommand('ls -la');
    expect(v.view).toBe('ls -la');
    expect(v.hadHeredoc).toBe(false);
    expect(v.hasFileWriteRedirect).toBe(false);
  });

  it('strips a heredoc body and reports no write for stdin-only heredoc', () => {
    const v = analyzeBashCommand("cat <<'EOF'\nrm -rf ./dist\nEOF");
    expect(v.hadHeredoc).toBe(true);
    expect(v.view).not.toContain('rm -rf');
    expect(v.hasFileWriteRedirect).toBe(false);
  });

  it('detects the write when a heredoc also redirects to a file', () => {
    const v = analyzeBashCommand("cat > conf.py <<'EOF'\nx = 1\nEOF");
    expect(v.hadHeredoc).toBe(true);
    expect(v.hasFileWriteRedirect).toBe(true);
  });

  it('treats null sinks as non-writes', () => {
    expect(analyzeBashCommand('grep -r foo . 2>/dev/null').hasFileWriteRedirect).toBe(false);
    expect(analyzeBashCommand('ls > /dev/null 2>&1').hasFileWriteRedirect).toBe(false);
  });

  it('flags interpreter-fed heredocs so danger scans keep the body', () => {
    expect(analyzeBashCommand("bash <<'EOF'\nrm -rf /\nEOF").interpreterFed).toBe(true);
    expect(analyzeBashCommand("python3 - <<'EOF'\nprint(1)\nEOF").interpreterFed).toBe(true);
    expect(analyzeBashCommand("cat <<'EOF'\nhello\nEOF").interpreterFed).toBe(false);
  });

  it('handles <<- and unquoted delimiters', () => {
    const v = analyzeBashCommand('cat <<-END\n\tindented body\nEND');
    expect(v.hadHeredoc).toBe(true);
    expect(v.view).not.toContain('indented body');
  });
});

describe('whitelistPolicy with heredocs', () => {
  it('whitelists a stdin-only heredoc on a safe command', async () => {
    const d = await whitelistPolicy.evaluate(ctx("cat <<'EOF'\nhello world\nEOF"));
    expect(d.tier).toBe('whitelist');
    expect(d.allowed).toBe(true);
  });

  it('passes a heredoc WRITE through to graylist (not whitelisted)', async () => {
    const d = await whitelistPolicy.evaluate(ctx("cat > f.txt <<'EOF'\nhello\nEOF"));
    expect(d.tier).not.toBe('whitelist');
    expect(d.allowed).toBe(true); // pass-through, graylist decides
  });

  it('still whitelists safe commands with null-sink redirects', async () => {
    const d = await whitelistPolicy.evaluate(ctx('grep -r foo . 2>/dev/null'));
    expect(d.tier).toBe('whitelist');
  });

  it('does not whitelist unsafe commands regardless of heredoc handling', async () => {
    const d = await whitelistPolicy.evaluate(ctx("npm publish <<'EOF'\ny\nEOF"));
    expect(d.tier).not.toBe('whitelist');
  });
});

describe('blacklistPolicy heredoc-body exclusion', () => {
  it('does NOT flag dangerous text inside a non-interpreter heredoc body', async () => {
    const d = await blacklistPolicy.evaluate(
      ctx("cat > deploy.sh <<'EOF'\nrm -rf ./dist\nEOF"));
    expect(d.allowed).toBe(true); // pass-through — writing text is not executing it
  });

  it('STILL flags dangerous text fed to an interpreter', async () => {
    const d = await blacklistPolicy.evaluate(ctx("bash <<'EOF'\nrm -rf /tmp/x\nEOF"));
    expect(d.allowed).toBe(false);
    expect(d.tier).toBe('blacklist');
  });

  it('still flags dangerous patterns on the command line itself', async () => {
    const d = await blacklistPolicy.evaluate(ctx('rm -rf /some/path'));
    expect(d.allowed).toBe(false);
  });
});
