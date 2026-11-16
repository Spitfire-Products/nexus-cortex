/**
 * /signins for fuzzycortex — mounts the SAME SigninsDialog neoncortex uses (ink-ui/components/SigninsDialog.tsx) through an imperative Ink
 * render, like InkSecretsDialog. Returns the value-free notices so the caller prints them after the dialog closes.
 */
import { render } from 'ink';
import { wakeStdinForInk } from './inkStdin.js';
import { SigninsDialog } from '../ink-ui/components/SigninsDialog.js';

export async function showSigninsDialog(sessionId?: string): Promise<string[]> {
  const notices: string[] = [];
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <SigninsDialog sessionId={sessionId} onNotice={(t) => notices.push(t)} onClose={() => { unmount(); resolve(notices); }} />,
    );
    wakeStdinForInk();
    waitUntilExit().catch(() => resolve(notices));
  });
}

export default showSigninsDialog;
