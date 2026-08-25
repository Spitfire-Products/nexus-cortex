/**
 * bashFileAccess parser — the frame-coherence keystone (backlog item 6).
 * Bias under test: false NEGATIVES acceptable, false positives are not —
 * a wrongly-registered "read" weakens the read-first guard.
 */

import { describe, it, expect } from 'vitest';
import { parseBashFileAccess } from '../bashFileAccess.js';

describe('parseBashFileAccess — reads', () => {
  it('cat file', () => {
    expect(parseBashFileAccess('cat src/app.py')).toEqual({ reads: ['src/app.py'], writes: [] });
  });
  it('cat -n file (the denial-advice form)', () => {
    expect(parseBashFileAccess('cat -n gen_gates.py').reads).toEqual(['gen_gates.py']);
  });
  it('head -n 50 file skips the flag value', () => {
    const r = parseBashFileAccess('head -n 50 config.yaml');
    expect(r.reads).toEqual(['config.yaml']);
  });
  it('tail -c 100 file skips the flag value', () => {
    expect(parseBashFileAccess('tail -c 100 log.txt').reads).toEqual(['log.txt']);
  });
  it('sed -n range-print reads the file, not the script', () => {
    const r = parseBashFileAccess("sed -n '10,40p' lib/util.rs");
    expect(r.reads).toEqual(['lib/util.rs']);
    expect(r.writes).toEqual([]);
  });
  it('cat piped into grep still counts the cat read', () => {
    expect(parseBashFileAccess('cat Makefile | grep install').reads).toEqual(['Makefile']);
  });
  it('multiple files', () => {
    expect(parseBashFileAccess('cat a.txt b.txt').reads.sort()).toEqual(['a.txt', 'b.txt']);
  });
});

describe('parseBashFileAccess — writes', () => {
  it('sed -i marks the target written', () => {
    const r = parseBashFileAccess("sed -i 's/foo/bar/' server.py");
    expect(r.writes).toEqual(['server.py']);
    expect(r.reads).toEqual([]);
  });
  it('sed -i.bak variant', () => {
    expect(parseBashFileAccess("sed -i.bak 's/a/b/' x.conf").writes).toEqual(['x.conf']);
  });
  it('redirect write > and append >>', () => {
    expect(parseBashFileAccess('echo hello > out.txt').writes).toEqual(['out.txt']);
    expect(parseBashFileAccess('printf "x" >> notes.md').writes).toEqual(['notes.md']);
  });
  it('tee', () => {
    expect(parseBashFileAccess('make 2>&1 | tee build.log').writes).toContain('build.log');
  });
  it('perl -pi -e', () => {
    expect(parseBashFileAccess("perl -pi -e 's/x/y/' app.rb").writes).toEqual(['app.rb']);
  });
  it('read+write same path resolves to write (cat a > a)', () => {
    const r = parseBashFileAccess('cat a.txt > a.txt');
    expect(r.writes).toEqual(['a.txt']);
    expect(r.reads).toEqual([]);
  });
  it('heredoc target of cat > file <<EOF is a write', () => {
    const r = parseBashFileAccess("cat > script.sh <<'EOF'");
    expect(r.writes).toContain('script.sh');
    expect(r.reads).toEqual([]);
  });
});

describe('parseBashFileAccess — conservatism (no false positives)', () => {
  it('grep is NOT a read (partial content only)', () => {
    expect(parseBashFileAccess('grep cat.txt src/main.ts').reads).toEqual([]);
  });
  it('a file merely NAMED as a grep pattern arg registers nothing', () => {
    expect(parseBashFileAccess('grep -r "cat" .').reads).toEqual([]);
  });
  it('command substitution rejects everything', () => {
    expect(parseBashFileAccess('cat $(find . -name x)')).toEqual({ reads: [], writes: [] });
  });
  it('backticks reject everything', () => {
    expect(parseBashFileAccess('cat `ls`')).toEqual({ reads: [], writes: [] });
  });
  it('variables and wildcards contribute nothing', () => {
    expect(parseBashFileAccess('cat $FILE').reads).toEqual([]);
    expect(parseBashFileAccess('cat *.py').reads).toEqual([]);
    expect(parseBashFileAccess('echo x > $OUT').writes).toEqual([]);
  });
  it('/dev and /proc are never targets', () => {
    expect(parseBashFileAccess('echo x > /dev/null').writes).toEqual([]);
    expect(parseBashFileAccess('cat /proc/cpuinfo').reads).toEqual([]);
  });
  it('2>&1 stderr dup is not a file write', () => {
    expect(parseBashFileAccess('make test 2>&1').writes).toEqual([]);
  });
  it('quoted operators stay inert', () => {
    expect(parseBashFileAccess(`echo "a > b" `).writes).toEqual([]);
  });
  it('sed without -n or -i registers nothing', () => {
    expect(parseBashFileAccess("sed 's/a/b/' file.txt")).toEqual({ reads: [], writes: [] });
  });
});

describe('parseBashFileAccess — compound commands', () => {
  it('cd && cat: read registered from the second segment', () => {
    expect(parseBashFileAccess('cd /app && cat setup.py').reads).toEqual(['setup.py']);
  });
  it('cat a; sed -i b: both channels', () => {
    const r = parseBashFileAccess("cat a.py; sed -i 's/x/y/' b.py");
    expect(r.reads).toEqual(['a.py']);
    expect(r.writes).toEqual(['b.py']);
  });
});
