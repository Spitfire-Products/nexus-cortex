/**
 * R136 HB-NEARDUP-SCRIPT-SHAPE — command identity for the similarity near-dup lens.
 * Script identity (the executed file / inline body) dominates the shell wrapper shape.
 */
import { describe, it, expect } from 'vitest';
import { extractCommandIdentity, commandIdentityDiffers, commandIdentityDigest } from '../commandIdentity.js';
import { classifyToolOutcome } from '../toolOutcome.js';

describe('extractCommandIdentity', () => {
  it('pulls the script after an interpreter, ignoring the cd/timeout wrapper and redirects', () => {
    const id = extractCommandIdentity('cd /app && timeout 300 python3 -u /tmp/search.py 2>/dev/null');
    expect(id.scriptPaths).toEqual(['/tmp/search.py']);
    expect(id.inlineCodeHash).toBeUndefined();
    expect(id.wrapper).not.toContain('/tmp/search.py');
    expect(id.wrapper).toContain('timeout #');
  });

  it('identical script with different flags / numbers → same identity', () => {
    const a = extractCommandIdentity('cd /app && timeout 300 python3 -u /tmp/search.py --lr 0.01 2>&1 | grep -v warn');
    const b = extractCommandIdentity('cd /app && timeout 600 python3 -u /tmp/search.py --lr 0.1 --epochs 3');
    expect(a.scriptPaths).toEqual(b.scriptPaths);
    expect(commandIdentityDiffers(a, b)).toBe(false);
  });

  it('different scripts under one wrapper → different identity', () => {
    const a = extractCommandIdentity('cd /app && timeout 300 python3 -u /tmp/unfused.py 2>&1 | grep -vE "warn|deprec"');
    const b = extractCommandIdentity('cd /app && timeout 300 python3 -u /tmp/moe_search.py 2>&1 | grep -v warn');
    expect(a.scriptPaths).toEqual(['/tmp/unfused.py']);
    expect(b.scriptPaths).toEqual(['/tmp/moe_search.py']);
    expect(commandIdentityDiffers(a, b)).toBe(true);
  });

  it('covers node / bash / ./binary / absolute binary / cargo run --bin / make target / pytest path / npm run', () => {
    expect(extractCommandIdentity('node scripts/build.js --watch').scriptPaths).toEqual(['scripts/build.js']);
    expect(extractCommandIdentity('bash ./run_tests.sh -v').scriptPaths).toEqual(['./run_tests.sh']);
    expect(extractCommandIdentity('./solver --input data.txt').scriptPaths).toEqual(['./solver']);
    expect(extractCommandIdentity('/usr/local/bin/tool -x 3').scriptPaths).toEqual(['/usr/local/bin/tool']);
    expect(extractCommandIdentity('cargo run --release --bin bench -- --n 5').scriptPaths).toEqual(['bench', 'run']);
    expect(extractCommandIdentity('make -j4 test').scriptPaths).toEqual(['test']);
    expect(extractCommandIdentity('pytest -x tests/test_a.py::test_one -q').scriptPaths).toEqual(['tests/test_a.py::test_one']);
    expect(extractCommandIdentity('npm run build').scriptPaths).toEqual(['build']);
    expect(extractCommandIdentity('python3 -m pytest tests/unit -q').scriptPaths).toEqual(['pytest', 'tests/unit']);
    expect(commandIdentityDiffers(extractCommandIdentity('make test'), extractCommandIdentity('make build'))).toBe(true);
  });

  it('plain commands (ls / grep / git) carry no identity and never claim to differ', () => {
    const a = extractCommandIdentity('ls -la /app');
    const b = extractCommandIdentity('grep -rn foo /app/src');
    expect(a.scriptPaths).toEqual([]);
    expect(a.inlineCodeHash).toBeUndefined();
    expect(commandIdentityDiffers(a, b)).toBe(false);
  });

  it('two different -c bodies → different inline hashes → different identity', () => {
    const a = extractCommandIdentity('cd /app && timeout 300 python3 -u -c "import torch\nsd = torch.load(\'ckpt.pt\')\nprint(sd.keys())" 2>&1 | grep -v warn');
    const b = extractCommandIdentity('cd /app && timeout 300 python3 -u -c "import json, glob\nfor f in glob.glob(\'*.json\'):\n    print(f, json.load(open(f))[\'loss\'])" 2>&1 | grep -v warn');
    expect(a.inlineCodeHash).toBeDefined();
    expect(b.inlineCodeHash).toBeDefined();
    expect(a.inlineCodeHash).not.toBe(b.inlineCodeHash);
    expect(a.scriptPaths).toEqual([]);
    expect(commandIdentityDiffers(a, b)).toBe(true);
  });

  it('a minor edit of the same -c body (the gcode grind) is the SAME identity', () => {
    const body = "import re; lines=open('t.gcode').read().splitlines(); pts=[l for l in lines if l.startswith('G1')]; print(len(pts))";
    const a = extractCommandIdentity(`cd /app && python3 -c "${body}"`);
    const b = extractCommandIdentity(`cd /app && python3 -c "${body.replace('len(pts)', 'len(pts)+1')}"`);
    expect(a.inlineCodeHash).not.toBe(b.inlineCodeHash);
    expect(commandIdentityDiffers(a, b)).toBe(false);
  });

  it('node -e / bash -c bodies are inline code', () => {
    const n = extractCommandIdentity('node -e "console.log(require(\'./pkg.json\').version)"');
    expect(n.inlineCodeHash).toBeDefined();
    expect(n.scriptPaths).toEqual([]);
    const s = extractCommandIdentity('bash -c "for i in 1 2 3; do echo $i; done"');
    expect(s.inlineCodeHash).toBeDefined();
    expect(commandIdentityDiffers(n, s)).toBe(true);
  });

  it('heredoc bodies are inline code (python3 - <<EOF, cat > file <<EOF)', () => {
    const a = extractCommandIdentity("cd /app && python3 - <<'EOF'\nimport os\nprint(os.listdir('.'))\nEOF");
    const b = extractCommandIdentity("cd /app && python3 - <<'EOF'\nimport sys\nprint(sys.version)\nEOF");
    expect(a.inlineCodeHash).toBeDefined();
    expect(a.inlineCodeHash).not.toBe(b.inlineCodeHash);
    expect(a.wrapper).not.toContain('listdir');
    expect(commandIdentityDiffers(a, b)).toBe(true);
    const w1 = extractCommandIdentity("cat > /tmp/a.py <<EOF\nx = 1\nEOF");
    const w2 = extractCommandIdentity("cat > /tmp/a.py <<EOF\ny = 2\nEOF");
    expect(w1.inlineCodeHash).not.toBe(w2.inlineCodeHash);
  });

  it('classifyToolOutcome carries commandIdentity for Bash only', () => {
    const o = classifyToolOutcome('Bash', { command: 'python3 /tmp/x.py' }, { content: 'ok' });
    expect(o.commandIdentity?.scriptPaths).toEqual(['/tmp/x.py']);
    expect(classifyToolOutcome('Write', { file_path: '/x', content: 'y' }, { content: 'ok' }).commandIdentity).toBeUndefined();
    expect(classifyToolOutcome('Read', { file_path: '/x' }, { content: 'ok' }).commandIdentity).toBeUndefined();
  });

  it('commandIdentityDigest (R136b): short stable digest for scripts / inline code, undefined without identity', () => {
    const a = commandIdentityDigest(extractCommandIdentity('cd /app && timeout 300 python3 -u /tmp/search.py 2>/dev/null'));
    const a2 = commandIdentityDigest(extractCommandIdentity('cd /app && timeout 600 python3 -u /tmp/search.py --seed 4 2>&1 | grep -v warn'));
    const b = commandIdentityDigest(extractCommandIdentity('cd /app && timeout 300 python3 -u /tmp/unfused.py 2>/dev/null'));
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
    expect(commandIdentityDigest(extractCommandIdentity('node -e "console.log(1)"'))).toBeUndefined(); // inline-only: scripts-only digest
    expect(commandIdentityDigest(extractCommandIdentity('ls -la /app'))).toBeUndefined();
    expect(commandIdentityDigest(undefined)).toBeUndefined();
  });
});

