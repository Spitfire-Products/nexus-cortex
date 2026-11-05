/**
 * /secrets for fuzzycortex — mounts the SAME SecretsDialog neoncortex uses (ink-ui/components/SecretsDialog.tsx) through an imperative
 * Ink render, like showConfigMenu. Returns the value-free notices ("stored GITHUB_TOKEN") so the caller can print them after the dialog
 * closes; values never leave the dialog.
 */
import { render } from 'ink';
import { wakeStdinForInk } from './inkStdin.js';
import { SecretsDialog } from '../ink-ui/components/SecretsDialog.js';

export async function showSecretsDialog(): Promise<string[]> {
  const notices: string[] = [];
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <SecretsDialog onNotice={(t) => notices.push(t)} onClose={() => { unmount(); resolve(notices); }} />,
    );
    wakeStdinForInk();
    waitUntilExit().catch(() => resolve(notices));
  });
}

export default showSecretsDialog;
