#!/bin/sh
# Canonical workspace inventory (CORTEX_INVENTORY=1, dark, 2026-09-29). Vendored by prepack to <pkg>/.cortex/inventory beside the orient
# scaffold. ONE mechanical, read-only picture of the task workspace that feeds BOTH the action model (orient prints it) and the steering models
# (the lift planner / EndTurn judge environment report). Evidence (r-orient-deficiencies-2026-09-29, r-steering-input-truncation-2026-09-29):
# flaky MiMo / TB4.0 / TB2.1 pairs diverge in the first 30 actions on workspace knowledge — the checker or contract not surfaced, a deep or
# out-of-workdir asset never shown (the lift plan names an asset only when orient showed it: TB4 0/6 vs 4/4), a listed file whose ROLE was not
# understood (a raw weights blob, a comma-decimal data file, a .dat that is a ZIP), the site-packages copy shadowing the workspace copy, a
# declared dependency silently missing.
# RULES: read-only (writes nothing, anywhere); no secrets (the task's own env comes from /proc/1/environ, harness vars and anything named
# *KEY*/*TOKEN*/*SECRET*/*PASSWORD* are dropped/redacted — transcripts are banked); priority sections are never capped; every capped section
# ends with "… N more … — <exact command>" so nothing is silently truncated. Always exits 0.
W="${1:-$(pwd)}"
cd "$W" 2>/dev/null || { echo "== WORKSPACE INVENTORY: $W (not accessible) =="; exit 0; }
PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null)
if [ -z "$PY" ]; then
  # No interpreter: the shell-only inventory (structure + roles by name + env + services). Still no silent truncation.
  echo "== WORKSPACE INVENTORY: $W (shell-only: no python on this box) =="
  PRUNE='( -name .git -o -name node_modules -o -name __pycache__ -o -name .venv -o -name venv -o -name .cortex -o -name .cache ) -prune -o'
  # shellcheck disable=SC2086
  N=$(find . $PRUNE -type f -print 2>/dev/null | wc -l | tr -d ' ')
  echo "files: $N (excluding .git node_modules __pycache__ venvs .cortex .cache)"
  echo "-- directories (file counts) --"
  # shellcheck disable=SC2086
  find . -maxdepth 3 $PRUNE -type d -print 2>/dev/null | sed 's#^\./##' | grep -v '^\.$' | sort | head -60 | while read -r d; do
    printf '  %s/ (%s)\n' "$d" "$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"; done
  echo "-- files at depth <= 3 --"
  # shellcheck disable=SC2086
  L=$(find . -maxdepth 3 $PRUNE -type f -print 2>/dev/null | sed 's#^\./##' | sort)
  C=$(printf '%s\n' "$L" | grep -c . )
  printf '%s\n' "$L" | head -150 | sed 's/^/  /'
  [ "$C" -gt 150 ] && echo "  … $((C-150)) more files at depth <= 3 not shown — list all: find . -type f -not -path './.git/*'"
  for d in /shared /data /mnt /srv /workspace /input /inputs /output /outputs; do
    [ -d "$d" ] && [ "$d" != "$W" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ] && echo "-- outside the workdir: $d ($(find "$d" -maxdepth 4 -type f 2>/dev/null | head -2000 | wc -l | tr -d ' ') files, first 2000 / depth 4 counted) — list: find $d -type f"
  done
  exit 0
fi
exec "$PY" - "$W" <<'PYINV'
import ast, json, os, re, subprocess, sys

W = os.path.abspath(sys.argv[1])
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '.cortex', '.cache', '.pytest_cache', '.mypy_cache', '.tox', '.npm',
             '.gradle', '.m2', 'site-packages', 'dist-packages', '.idea', '.vscode', '.addon-tools'}
MAX_WALK = 60000
# Output is bucketed per section and emitted DECISIVE-FIRST (2026-09-29): the model reads orient through `| head -50/-100` in ~93% of sessions
# (504/541, .bench/mimo/boot-prompt-audit.py) and cut the inventory in 8/17 cw sessions — so what decides a task (how it is checked, which
# copy of the code runs, missing deps, services, data outside the workdir) comes before the long per-file listing. Computation order is unchanged.
SECTIONS, CUR = {}, ['header']
EMIT = ['header', 'checked', 'python', 'node', 'services', 'outside', 'structure', 'files', 'env']


def sec(name):
    CUR[0] = name


def p(line):
    SECTIONS.setdefault(CUR[0], []).append(line)


def rel(x):
    return os.path.relpath(x, W)


def more(n, what, cmd):
    return f'  … {n} more {what} not shown — {cmd}'


# ---------------------------------------------------------------- walk (bounded; never follows symlinked dirs)
files, dirs = [], {}
walked = 0
truncated_walk = False
for dp, dns, fns in os.walk(W, topdown=True, followlinks=False):
    dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.endswith('.egg-info'))
    r = rel(dp)
    dirs[r] = len(fns)
    for f in sorted(fns):
        fp = os.path.join(dp, f)
        try:
            st = os.lstat(fp)
        except OSError:
            continue
        files.append((rel(fp), st.st_size))
        walked += 1
        if walked >= MAX_WALK:
            truncated_walk = True
            break
    if truncated_walk:
        break

# ---------------------------------------------------------------- role classification + peeks
SCRIPT = re.compile(r'\.(py|sh|bash|js|mjs|cjs|ts|tsx|rb|pl|go|rs|c|cc|cpp|h|hpp|java|kt|r|jl|lua|php|swift|scala|m)$', re.I)
DOC = re.compile(r'\.(md|rst|txt|adoc|pdf|html?|docx?|odt)$', re.I)
DATA = re.compile(r'\.(csv|tsv|jsonl|ndjson|json|parquet|feather|arrow|npy|npz|pkl|pickle|h5|hdf5|db|sqlite3?|xlsx?|xml|ya?ml|toml|ini|cfg|'
                  r'dat|bin|raw|gz|zip|tar|tgz|bz2|xz|7z|fa|fasta|fastq|bam|sam|vcf|bed|gff3?|pdb|cif|wav|mp3|flac|png|jpe?g|gif|bmp|tiff?|svg|'
                  r'stl|step|stp|obj|ply|glb|gltf|ckpt|pt|pth|safetensors|onnx|gguf|mat|nc|log|ttf|otf|woff2?)$', re.I)
CHECKER = re.compile(r'(check|verif|validat|grade|grader|probe|evaluat|eval|scor|judge|assert|audit|regression|smoke|harness|contract_runner|'
                     r'run_tests?|run_[a-z0-9_-]+|workflow|diagnos|benchmark|bench)[^/]*\.(py|sh|js|ts|mjs)$', re.I)
CONTRACT = re.compile(r'(contract|schema|spec|expected|golden|reference|cases|fixture|sample_output|example_output|output_format|interface|'
                      r'requirements?_spec|acceptance)[^/]*\.(json|ya?ml|toml|md|txt|csv|jsonl)$|(^|/)(CONTRACT|SPEC|REPAIR_CONTRACT|'
                      r'ACCEPTANCE)[^/]*$', re.I)
TESTF = re.compile(r'(^|/)(tests?|spec|__tests__)/|(^|/)test_[^/]+$|_test\.[a-z]+$|\.test\.[a-z]+$|\.spec\.[a-z]+$', re.I)
MANIFEST = re.compile(r'(^|/)(requirements[^/]*\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile|environment\.ya?ml|package\.json|Cargo\.toml|'
                      r'go\.mod|Gemfile|pom\.xml|build\.gradle|CMakeLists\.txt|Makefile|Dockerfile|docker-compose[^/]*\.ya?ml|tox\.ini|pytest\.ini|'
                      r'conftest\.py|\.env\.example)$', re.I)
VENDOR = re.compile(r'(^|/)(vendor|third_party|external|deps|_offline_deps|offline_deps|runtime_compat|wheels)/', re.I)


def role(path):
    if CHECKER.search(path) and not TESTF.search(path): return 'checker/runner'
    if CONTRACT.search(path): return 'contract/spec'
    if MANIFEST.search(path): return 'manifest/config'
    if TESTF.search(path): return 'test'
    if SCRIPT.search(path): return 'source'
    if DOC.search(path) or re.search(r'(^|/)(README|NOTES|INSTRUCTIONS|TODO|CHANGELOG|LICENSE)[^/]*$', path, re.I): return 'doc'
    if DATA.search(path): return 'data'
    return 'other'


def head_bytes(path, n=4096):
    try:
        with open(os.path.join(W, path), 'rb') as fh:
            return fh.read(n)
    except OSError:
        return b''


MAGIC = [(b'PK\x03\x04', 'zip archive'), (b'\x1f\x8b', 'gzip'), (b'BZh', 'bzip2'), (b'\xfd7zXZ', 'xz'), (b'7z\xbc\xaf', '7z'),
         (b'\x89PNG', 'png image'), (b'\xff\xd8\xff', 'jpeg image'), (b'GIF8', 'gif image'), (b'%PDF', 'pdf'), (b'SQLite format 3', 'sqlite db'),
         (b'\x7fELF', 'ELF binary'), (b'\x93NUMPY', 'numpy array'), (b'\x80\x02', 'pickle'), (b'\x80\x04', 'pickle'), (b'\x80\x05', 'pickle'),
         (b'RIFF', 'riff (wav/avi)'), (b'ustar', 'tar')]


def human(n):
    for u in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or u == 'GB':
            return f'{n:.0f}{u}' if u == 'B' else f'{n:.1f}{u}'
        n /= 1024


def peek(path, size, rl):
    b = head_bytes(path)
    if not b:
        return 'empty' if size == 0 else ''
    for sig, name in MAGIC:
        if b.startswith(sig) or (sig == b'ustar' and b[257:262] == b'ustar'):
            ext = os.path.splitext(path)[1].lower()
            expect = {'.zip': 'zip', '.gz': 'gzip', '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.pdf': 'pdf', '.db': 'sqlite',
                      '.sqlite': 'sqlite', '.npy': 'numpy', '.pkl': 'pickle', '.tar': 'tar', '.xz': 'xz', '.bz2': 'bzip2', '.wav': 'riff'}
            mism = ext and ext in expect and expect[ext] not in name
            unexpected = ext and ext not in expect and name not in ('ELF binary',)
            tag = name + (f' (NOTE: content is {name}, not what "{ext}" suggests)' if (mism or unexpected) else '')
            return tag
    try:
        t = b.decode('utf-8')
    except UnicodeDecodeError:
        nz = sum(1 for c in b[:512] if c == 0)
        return f'binary ({nz} NUL bytes in first 512; e.g. raw array / weights / packed data)'
    lines = t.splitlines()
    if rl == 'data' or re.search(r'\.(csv|tsv|dat|txt)$', path, re.I):
        first = next((l for l in lines if l.strip()), '')[:160]
        body = [l for l in lines[:12] if l.strip()][1:6]
        note = ''
        if any(re.search(r'\d,\d', l) and ';' in l for l in body): note = ' (NOTE: ";"-separated with comma decimals, e.g. ' + body[0][:40] + ')'
        elif any(re.match(r'^\s*-?\d+,\d+[\s\t]+-?\d+,\d+', l) for l in body): note = ' (NOTE: comma decimals, e.g. ' + body[0][:40] + ')'
        if path.lower().endswith(('.json',)) or first.lstrip().startswith(('{', '[')):
            try:
                with open(os.path.join(W, path), encoding='utf-8') as fh:
                    obj = json.load(fh) if size < 2_000_000 else None
                if isinstance(obj, dict): return 'json object, keys: ' + ', '.join(list(obj)[:14]) + (' …' if len(obj) > 14 else '')
                if isinstance(obj, list): return f'json array[{len(obj)}]' + (', item keys: ' + ', '.join(list(obj[0])[:12]) if obj and isinstance(obj[0], dict) else '')
            except Exception:
                pass
        return f'first line: {first}{note}' if first else 'text'
    if rl in ('source', 'checker/runner', 'test'):
        if path.endswith('.py'):
            try:
                src = open(os.path.join(W, path), encoding='utf-8', errors='replace').read() if size < 2_000_000 else t
                tree = ast.parse(src)
                defs = [n.name for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))]
                main = '__main__' in src
                return (('defines: ' + ', '.join(defs[:10]) + (' …' if len(defs) > 10 else '')) if defs else 'no top-level defs') + \
                       (' | runnable (__main__)' if main else '') + f' | {src.count(chr(10))} lines'
            except Exception:
                pass
        defs = re.findall(r'^(?:export\s+)?(?:async\s+)?(?:function|class|def|fn|func|interface|struct)\s+([A-Za-z_][\w]*)', t, re.M)
        return ('defines: ' + ', '.join(defs[:10]) if defs else f'{len(lines)}+ lines')
    if rl == 'doc':
        first = next((l.strip('# ').strip() for l in lines if l.strip()), '')
        return f'"{first[:120]}"'
    return ''


classified = [(f, s, role(f)) for f, s in files]
by_role = {}
for f, s, r in classified:
    by_role.setdefault(r, []).append((f, s))

# ---------------------------------------------------------------- header
p(f'== WORKSPACE INVENTORY: {W} ==')
p(f'{len(files)} files in {len(dirs)} dirs (excluded: ' + ', '.join(sorted(SKIP_DIRS)[:8]) + ' …)' +
  (f' — WALK STOPPED at {MAX_WALK} files; the rest is not listed — find . -type f | wc -l' if truncated_walk else ''))
counts = ', '.join(f'{r} {len(v)}' for r, v in sorted(by_role.items(), key=lambda kv: -len(kv[1])))
p('by role: ' + counts)

# ---------------------------------------------------------------- 1. verification + contracts (PRIORITY — never capped)
sec('checked')
chk = by_role.get('checker/runner', []); con = by_role.get('contract/spec', [])
if chk or con:
    p('-- HOW THIS TASK IS CHECKED (task-shipped checkers/runners and contracts — read these before building) --')
    for f, s in chk:
        src = head_bytes(f, 200_000).decode('utf-8', 'replace')
        usage = next((l.strip() for l in src.splitlines() if re.search(r'usage|^ *Run:|add_argument|sys\.argv|getopts', l, re.I)), '')
        writes = sorted(set(re.findall(r'["\']([\w./-]+\.(?:json|jsonl|csv|txt|md|yaml|yml|html|png))["\']', src)))[:6]
        consts = sorted(set(re.findall(r'["\']?(schema[_-]?version|SCHEMA[_A-Z]*|output_schema[_a-z]*)["\']?\s*[:=]\s*["\']?([\w.:-]+)', src)))[:4]
        line = f'  [checker] {f} ({human(s)})'
        if VENDOR.search(f): line += ' — inside a vendored project'
        p(line)
        if usage: p(f'      usage: {usage[:160]}')
        if writes: p('      references: ' + ', '.join(writes))
        if consts: p('      constants: ' + ', '.join(f'{a}={b}' for a, b in consts))
    for f, s in con:
        p(f'  [contract] {f} ({human(s)}) — {peek(f, s, "data" if not f.lower().endswith(".md") else "doc")}'[:260])
    tests = sorted({os.path.dirname(f) for f, _ in by_role.get('test', []) if os.path.dirname(f)})
    if tests:
        shown = tests[:12]
        p('  test dirs: ' + ', '.join(shown) + (f' (+{len(tests)-12} more — find . -type d -name "test*")' if len(tests) > 12 else ''))

# ---------------------------------------------------------------- 2. structure: every dir with counts (capped with marker)
sec('structure')
p('-- STRUCTURE (dir: files directly inside) --')
dl = sorted(d for d in dirs if d != '.')
top = [d for d in dl if d.count('/') <= 1]
for d in top[:60]:
    sub = sum(1 for x in dl if x.startswith(d + '/'))
    p(f'  {d}/ ({dirs[d]} files' + (f', {sub} subdirs' if sub else '') + ')')
if len(top) > 60:
    p(more(len(top) - 60, 'directories at depth <= 2', 'find . -maxdepth 2 -type d'))
deep = [d for d in dl if d.count('/') > 1]
if deep:
    p(f'  ({len(deep)} deeper directories — find . -mindepth 3 -type d)')

# ---------------------------------------------------------------- 3. files by role with a peek (priority roles in full, bulk capped)
sec('files')
CAPS = {'source': 40, 'doc': 30, 'data': 40, 'manifest/config': 30, 'test': 20, 'other': 20}
ORDER = ['doc', 'manifest/config', 'source', 'data', 'test', 'other']
for r in ORDER:
    items = by_role.get(r, [])
    if not items: continue
    # task files before vendored ones; shallow before deep
    items = sorted(items, key=lambda x: (bool(VENDOR.search(x[0])), x[0].count('/'), x[0]))
    cap = CAPS[r]
    p(f'-- {r.upper()} ({len(items)}) --')
    for f, s in items[:cap]:
        pk = peek(f, s, r) if r in ('doc', 'data', 'source', 'other', 'manifest/config') else ''
        p(f'  {f} ({human(s)})' + (f' — {pk}' if pk else ''))
    if len(items) > cap:
        vend = sum(1 for f, _ in items[cap:] if VENDOR.search(f))
        p(more(len(items) - cap, f'{r} files' + (f' ({vend} in vendored trees)' if vend else ''),
               f'list: find . -type f | grep -v -e .git/ -e node_modules  (role here = {r})'))

# ---------------------------------------------------------------- 4. python: which interpreter, which copy of the code runs, missing deps
sec('python')
def run(cmd, timeout=20):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=W)
        return (r.stdout or '') + (r.stderr or '')
    except Exception as e:
        return ''


p('-- PYTHON --')
p(f'  interpreter: {sys.executable} ({sys.version.split()[0]})' + (f' | VIRTUAL_ENV={os.environ.get("VIRTUAL_ENV")}' if os.environ.get('VIRTUAL_ENV') else ''))
pkgs = []
for d in sorted(dirs):
    parts = d.split('/')
    if d == '.' or len(parts) > 4: continue
    if os.path.isfile(os.path.join(W, d, '__init__.py')) and not os.path.isfile(os.path.join(W, os.path.dirname(d) or '.', '__init__.py')):
        pkgs.append(d)
pkgs = [x for x in pkgs if not TESTF.search(x + '/')][:12]
for d in pkgs:
    name = os.path.basename(d); parent = os.path.dirname(d) or '.'
    res = run([sys.executable, '-c', f'import {name},os;print(os.path.abspath({name}.__file__))'], 20).strip().splitlines()
    where = res[-1] if res else ''
    ws_copy = os.path.join(W, d)
    if where.startswith(ws_copy):
        p(f'  import {name} → the workspace copy ({d}/)')
    elif where.startswith('/'):
        p(f'  import {name} → {where}  ⚠ NOT the workspace copy ({d}/) — run with PYTHONPATH={os.path.join(W, parent)} to use/test the workspace code')
    else:
        err = next((l for l in res if 'Error' in l), 'fails')
        p(f'  import {name} (workspace {d}/) → {err[:120]} from {W}; with PYTHONPATH={os.path.join(W, parent)} it resolves to the workspace copy')
extra = sorted(d for d in dirs if re.search(r'(^|/)(_?offline_deps|runtime_compat|wheels|vendor_deps)$', d, re.I))[:6]
if extra:
    p('  dependency dirs shipped with the task: ' + ', '.join(extra) + ' (add to PYTHONPATH / pip install --no-index --find-links as appropriate)')
# declared vs installed
declared = []
for f, _ in by_role.get('manifest/config', []):
    if VENDOR.search(f) and f.count('/') > 2: continue
    b = os.path.basename(f).lower()
    try:
        txt = open(os.path.join(W, f), encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    if b.startswith('requirements') and b.endswith('.txt'):
        declared += [(re.split(r'[<>=!~\[; ]', l.strip())[0], f) for l in txt.splitlines() if l.strip() and not l.strip().startswith(('#', '-'))]
    elif b == 'pyproject.toml':
        m = re.search(r'dependencies\s*=\s*\[(.*?)\]', txt, re.S)
        if m: declared += [(re.split(r'[<>=!~\[; ]', x.strip().strip('"\''))[0], f) for x in m.group(1).split(',') if x.strip().strip('"\'')]
missing = []
if declared:
    try:
        from importlib import metadata as md
        have = {re.sub(r'[-_.]+', '-', (d.metadata['Name'] or '').lower()) for d in md.distributions()}
    except Exception:
        have = set()
    for name, src in declared:
        if name and re.sub(r'[-_.]+', '-', name.lower()) not in have:
            missing.append(f'{name} ({src})')
    missing = sorted(set(missing))
    if missing:
        p('  declared but NOT installed: ' + ', '.join(missing[:30]) + (f' … +{len(missing)-30} more' if len(missing) > 30 else ''))
    else:
        p(f'  all {len(declared)} declared python dependencies are installed')

# ---------------------------------------------------------------- 5. node
sec('node')
pj = [f for f, _ in by_role.get('manifest/config', []) if os.path.basename(f) == 'package.json' and f.count('/') <= 2 and 'node_modules' not in f]
for f in pj[:3]:
    try:
        o = json.load(open(os.path.join(W, f)))
    except Exception:
        continue
    deps = list((o.get('dependencies') or {})) + list((o.get('devDependencies') or {}))
    nm = os.path.join(W, os.path.dirname(f), 'node_modules')
    miss = [d for d in deps if not os.path.isdir(os.path.join(nm, d))]
    scripts = list((o.get('scripts') or {}))
    p(f'-- NODE {f}: scripts: ' + (', '.join(scripts[:12]) or 'none') + f' | {len(deps)} deps' +
      (f', NOT installed: {", ".join(miss[:20])}' + (' …' if len(miss) > 20 else '') if miss else (', node_modules present' if os.path.isdir(nm) else ', no node_modules')))

# ---------------------------------------------------------------- 6. task environment (from the container's own init env; secrets redacted)
sec('env')
BOILER = {'PATH', 'HOME', 'HOSTNAME', 'TERM', 'SHLVL', 'PWD', 'OLDPWD', '_', 'LANG', 'LC_ALL', 'DEBIAN_FRONTEND', 'container', 'GPG_KEY',
          'PYTHON_VERSION', 'PYTHON_SHA256', 'PYTHON_PIP_VERSION', 'PYTHON_GET_PIP_URL', 'PYTHON_GET_PIP_SHA256', 'PYTHON_SETUPTOOLS_VERSION',
          'NODE_VERSION', 'YARN_VERSION', 'LS_COLORS', 'SSL_CERT_DIR', 'SSL_CERT_FILE', 'NVIDIA_VISIBLE_DEVICES', 'NVIDIA_DRIVER_CAPABILITIES'}
HARNESS = re.compile(r'^(CORTEX_|TB2_|MENTORSHIP_|HELPER_|VISION_|NEXUS_|OMNI|ANTHROPIC|OPENAI|DEEPSEEK|XAI|GROQ|GEMINI|GOOGLE_API|MISTRAL|'
                     r'TYPESAFE|HF_|HUGGING|MODEL_|DEFAULT_MODEL|MAX_TOOL|TOOL_TIMEOUT|ENABLE_WEBTOOLS|CANON_|NODE_OPTIONS|NPM_|BENCH_|HARBOR)')
SECRET = re.compile(r'(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)', re.I)
env = {}
try:
    raw = open('/proc/1/environ', 'rb').read().split(b'\0')
    for kv in raw:
        if b'=' in kv:
            k, v = kv.split(b'=', 1); env[k.decode('utf-8', 'replace')] = v.decode('utf-8', 'replace')
    src_note = 'from the container init process'
except Exception:
    src_note = None
if src_note is not None:
    keep = []
    for k in sorted(env):
        if k in BOILER or HARNESS.search(k): continue
        v = env[k]
        if SECRET.search(k): v = '<redacted>'
        keep.append(f'{k}={v[:120]}')
    if keep:
        p(f'-- TASK ENVIRONMENT ({src_note}; boilerplate and harness variables omitted, secrets redacted) --')
        for kv in keep[:40]: p('  ' + kv)
        if len(keep) > 40: p(more(len(keep) - 40, 'variables', 'cat /proc/1/environ | tr "\\0" "\\n"'))

# ---------------------------------------------------------------- 7. services + paths outside the workdir
sec('services')
hosts = []
try:
    for l in open('/etc/hosts'):
        parts = l.split()
        if len(parts) >= 2 and not parts[0].startswith(('#', '127.', '::1', 'fe00', 'ff0')):
            hosts += [h for h in parts[1:] if not re.match(r'^[0-9a-f]{12}$', h) and h not in ('localhost',)]
except OSError:
    pass
ports = []
for f in ('/proc/net/tcp', '/proc/net/tcp6'):
    try:
        for l in open(f).read().splitlines()[1:]:
            x = l.split()
            if len(x) > 3 and x[3] == '0A':
                ports.append(int(x[1].split(':')[1], 16))
    except OSError:
        pass
urlvars = [f'{k}={env[k][:80]}' for k in sorted(env) if re.search(r'(HOST|PORT|URL|URI|ENDPOINT|ADDR)', k) and not HARNESS.search(k) and not SECRET.search(k)]
if hosts or ports or urlvars:
    p('-- SERVICES --')
    if hosts: p('  other hosts on this network: ' + ', '.join(sorted(set(hosts))[:20]))
    if ports: p('  listening locally: ' + ', '.join(str(x) for x in sorted(set(ports))[:20]))
    for u in urlvars[:12]: p('  ' + u)
sec('outside')
outside = []
for d in ('/shared', '/data', '/mnt', '/srv', '/workspace', '/input', '/inputs', '/output', '/outputs', '/reference', '/resources', '/task', '/opt/task'):
    if os.path.isdir(d) and not W.startswith(d) and not d.startswith(W):
        n, capped = 0, False
        try:
            for dp, dns, fs in os.walk(d, followlinks=False):  # bounded: a large mount must never stall the inventory
                n += len(fs)
                if n >= 2000 or dp.count('/') - d.count('/') >= 4:
                    capped = True; break
        except Exception:
            pass
        if n: outside.append(f'{d} ({n}{"+" if capped else ""} files)')
if outside:
    p('-- OUTSIDE THE WORKDIR (task data may live here) -- ' + ', '.join(outside) + ' — list: find <dir> -type f | head -100')
print('\n'.join(line for name in EMIT for line in SECTIONS.get(name, [])))
PYINV
