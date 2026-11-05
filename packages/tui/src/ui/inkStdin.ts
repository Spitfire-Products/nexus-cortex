/**
 * Ink overlays mounted with an imperative render() from fuzzycortex's readline loop can come up DEAF: process.stdin's TTY handle is
 * stopped (Node stops it on 'pause' — rl.pause() / the raw input's teardown) and Ink's 'readable' listener does not always restart it
 * (it only schedules a read when the stream is not already marked readable-listening, which a listener removed and re-added in the
 * same tick leaves set). Symptom: the dialog draws but no key reaches useInput (2026-11-02: /secrets and /config in fuzzycortex;
 * probe showed _handle.reading=false, no 'readable' events). read(0) is the public way to restart the handle; harmless when it runs.
 * Call it right after render().
 */
export function wakeStdinForInk(): void {
  setImmediate(() => {
    try { if (process.stdin.isTTY) process.stdin.read(0); } catch { /* stdin closed — nothing to wake */ }
  });
}
