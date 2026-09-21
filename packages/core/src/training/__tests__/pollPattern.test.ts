/**
 * R135 HB-POLL-LOOP (2026-09-13): recognize a poll-and-wait Bash command (a wait + a READ-ONLY probe)
 * so the loop stack never blocks the last executor on legitimate monitoring. Conservative: when
 * unsure, it is NOT a poll.
 */
import { describe, it, expect } from 'vitest';
import { detectPollPattern } from '../pollPattern.js';

describe('detectPollPattern — the TB4.0 ctr-optimization evidence commands are polls', () => {
  const CFG = 'http://localhost:5000/api/v1/config';

  it('sleep N; curl GET | python3 -c print(...)', () => {
    const r = detectPollPattern(`sleep 115; curl -s ${CFG} | python3 -c "import sys,json;print(json.load(sys.stdin)['eval_window'])"`);
    expect(r.isPoll).toBe(true);
    expect(r.waitSec).toBe(115);
    expect(r.probe).toContain('localhost:5000/api/v1/config');
  });

  it('sleep N; curl -s URL (a different wait, the same probe identity)', () => {
    const a = detectPollPattern(`sleep 130; curl -s ${CFG}`);
    const b = detectPollPattern(`sleep 115; curl -s ${CFG} | python3 -c "import sys,json;print(json.load(sys.stdin)['x'])"`);
    expect(a.isPoll).toBe(true);
    expect(a.waitSec).toBe(130);
    expect(a.probe).toBe(b.probe); // the wait and the pipe consumer are not part of the probe identity
  });

  it('sleep N; cd /tmp && python3 -c "import requests; requests.get(...); print(...)"', () => {
    const r = detectPollPattern(`sleep 180; cd /tmp && python3 -c "import requests; r=requests.get('http://localhost:5000/api/v1/metrics'); print(r.json()['ctr'])"`);
    expect(r.isPoll).toBe(true);
    expect(r.waitSec).toBe(180);
    expect(r.probe).toContain('localhost:5000/api/v1/metrics');
  });

  it('sleep N; echo t1; sleep N; curl … sums the waits', () => {
    const r = detectPollPattern(`sleep 115; echo t1; sleep 115; curl -s ${CFG}`);
    expect(r.isPoll).toBe(true);
    expect(r.waitSec).toBe(230);
  });

  it('until/while … sleep loops are polls (per-iteration wait)', () => {
    expect(detectPollPattern('until curl -sf http://localhost:5000/health; do sleep 5; done')).toMatchObject({ isPoll: true, waitSec: 5 });
    expect(detectPollPattern('while ! nc -z localhost 5432; do sleep 2; done')).toMatchObject({ isPoll: true, waitSec: 2 });
    expect(detectPollPattern("timeout 300 bash -c 'until curl -sf localhost:5000/health; do sleep 5; done'").isPoll).toBe(true);
  });

  it('sleep + status probes of every listed family are polls', () => {
    for (const cmd of [
      'sleep 60; docker ps',
      'sleep 60; docker logs --tail 20 web',
      'sleep 30; tail -n 20 /tmp/train.log',
      'sleep 30; cat /tmp/progress.json',
      'sleep 10; test -f /tmp/done',
      'sleep 10; ls -la /app/output',
      'sleep 5; kubectl get pods',
      'sleep 20; systemctl status nginx',
      'sleep 3; nc -z localhost 5432',
      'sleep 3; ss -ltnp',
      'sleep 3; netstat -tln',
      'sleep 5; pgrep -f train.py',
      'sleep 5; ps aux | grep train',
      'sleep 5; stat /tmp/out.bin',
      'sleep 5; wget -qO- http://localhost:8080/status',
      'sleep 5; http GET localhost:8080/status',
      'sleep 5; curl -s -X GET http://localhost:8080/status',
      'sleep 5; curl -s http://localhost:8080/status -o /tmp/status.json',
      'sleep 5; curl -s http://localhost:8080/status > /tmp/status.json',
      'sleep 5 && curl -s http://localhost:8080/status 2>/dev/null',
      'sleep 2m; curl -s http://localhost:8080/status',
    ]) {
      expect(detectPollPattern(cmd).isPoll, cmd).toBe(true);
    }
    expect(detectPollPattern('sleep 2m; curl -s http://localhost:8080/status').waitSec).toBe(120);
  });

  it('a bare read-only probe with no wait is NOT a poll on its own but carries the probe identity', () => {
    const r = detectPollPattern('curl -s http://localhost:5000/api/v1/config');
    expect(r.isPoll).toBe(false);
    expect(r.waitSec).toBeUndefined();
    expect(r.probe).toContain('localhost:5000/api/v1/config');
  });
});

describe('detectPollPattern — negatives (conservative: not a poll)', () => {
  it.each([
    ['curl -X POST http://localhost:5000/api/v1/config -d \'{"a":1}\''],
    ['sleep 5; curl -X POST http://localhost:5000/api/v1/config -d \'{"a":1}\''],
    ['sleep 5; curl -s -X PUT http://localhost:5000/api/v1/config'],
    ['sleep 5; curl -s --request DELETE http://localhost:5000/api/v1/config'],
    ['sleep 5; curl -s http://localhost:5000/api/v1/config --data-binary @/tmp/body.json'],
    ['sleep 5; curl -s http://localhost:5000/api/v1/config -o /app/config.json'],
    ['sleep 5; curl -s http://localhost:5000/api/v1/config > /app/config.json'],
    ['sleep 5; wget --post-data "a=1" http://localhost:5000/api/v1/config'],
    ['sleep 5; wget http://localhost:5000/big.tar.gz'],
    ['sleep 5; http POST localhost:8080/config a=1'],
    ['sleep 5; python3 train.py'],
    ['sleep 5; python3 -c "open(\'/app/out.txt\',\'w\').write(\'x\')"'],
    ['sleep 5; python3 -c "import requests; requests.post(\'http://localhost:5000/api/v1/config\', json={\'a\': 1})"'],
    ['sleep 5; python3 -c "import subprocess; subprocess.run([\'make\'])"'],
    ['make test'],
    ['sleep 5; make'],
    ['sleep 5; npm test'],
    ['sleep 5; pytest -x'],
    ['sleep 5 && pip install requests'],
    ['sleep 5; apt-get install -y jq'],
    ['sleep 5; rm -rf /tmp/x'],
    ['sleep 5; mv /tmp/a /tmp/b'],
    ['sleep 5; cp /tmp/a /app/b'],
    ['sleep 5; git commit -am x'],
    ['sleep 5; git push'],
    ['sleep 5; sed -i "s/a/b/" /app/x.py'],
    ['sleep 5; tee /app/out.txt < /tmp/in.txt'],
    ['sleep 5; docker run -d web'],
    ['sleep 5; kubectl apply -f x.yaml'],
    ['sleep 5; systemctl restart nginx'],
    ['sleep 5; kill -9 1234'],
    ['sleep 5; bash run.sh'],
    ['sleep 5; ./run.sh'],
    ['sleep 120'],
    ['sleep 5; echo done'],
    [''],
  ])('%s', (cmd) => {
    expect(detectPollPattern(cmd).isPoll).toBe(false);
  });

  it('a plain executing command carries no probe identity', () => {
    expect(detectPollPattern('python3 train.py').probe).toBeUndefined();
    expect(detectPollPattern('make test').probe).toBeUndefined();
  });
});

describe('R177: prototype-key command heads never throw (takens-embedding-lean: `constructor` typed at the shell aborted the turn loop)', () => {
  it.each([['constructor'], ['constructor foo'], ['toString status'], ['__proto__ ps'], ['hasOwnProperty logs'], ['valueOf; sleep 5']])('%s', (cmd) => {
    expect(() => detectPollPattern(cmd)).not.toThrow();
    expect(detectPollPattern(cmd).isPoll).toBe(false);
  });
  it('a real verb tool still classifies', () => {
    expect(detectPollPattern('docker ps; sleep 5').isPoll).toBe(true);
  });
});
