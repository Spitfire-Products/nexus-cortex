/**
 * Run a canon function with console muted (and optionally captured).
 *
 * The graduated nexus-canon functions report via console.log/error as CLI
 * verbs. Inside a tool executor that output must not interleave with the
 * harness's own stdout/TUI render — the model gets results via the tool
 * result instead. Console is swapped only for the call and always restored.
 */
export async function mutedConsole<T>(fn: () => Promise<T>): Promise<T>;
export async function mutedConsole<T>(
  fn: () => Promise<T>,
  opts: { captureOutput: true },
): Promise<{ result: T; output: string }>;
export async function mutedConsole<T>(
  fn: () => Promise<T>,
  opts?: { captureOutput?: boolean },
): Promise<T | { result: T; output: string }> {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const captured: string[] = [];
  const sink = (...a: unknown[]): void => {
    captured.push(a.map((x) => (typeof x === 'string' ? x : String(x))).join(' '));
  };
  console.log = sink as typeof console.log;
  console.warn = sink as typeof console.warn;
  console.error = sink as typeof console.error;
  try {
    const result = await fn();
    return opts?.captureOutput ? { result, output: captured.join('\n') } : result;
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
}
