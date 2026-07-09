/**
 * HF Space lifecycle management.
 *
 * When the harness is configured to run inference through a paid Hugging Face
 * Space (the `hf-space` provider transport), a dedicated-GPU Space bills by the
 * hour for as long as it is RUNNING — even while idle. To avoid paying for an
 * idle GPU, the server resumes the Space on startup and pauses it on shutdown,
 * but ONLY when the chosen model (DEFAULT_MODEL_ID or HELPER_MODEL_ID) actually
 * is the hf-space model. ZeroGPU / free hardware ignores pause/resume harmlessly,
 * so this is a no-op cost-wise there.
 *
 * Gate (all must hold):
 *   - HF_SPACE_ID is set
 *   - HF_SPACE_AUTO_LIFECYCLE !== 'false'  (escape hatch; default on)
 *   - DEFAULT_MODEL_ID === hf-space id  OR  HELPER_MODEL_ID === hf-space id
 *     where hf-space id = HF_SPACE_MODEL_ID || 'hf-space'
 *
 * Auth uses HF_TOKEN (normalized from HUGGINGFACE_TOKEN/HUGGINGFACE_API_KEY at
 * server boot). A write token is required to pause/restart a Space.
 */
import chalk from 'chalk';

const HF_API_BASE = 'https://huggingface.co/api/spaces';

function hfToken(): string | undefined {
  return process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || process.env.HUGGINGFACE_API_KEY;
}

/**
 * True when the server should manage the HF Space GPU billing for this run.
 * Returns the resolved space id so callers can log it, or null when disabled.
 */
export function hfSpaceToManage(): string | null {
  const spaceId = process.env.HF_SPACE_ID;
  if (!spaceId) return null;
  if (process.env.HF_SPACE_AUTO_LIFECYCLE === 'false') return null;

  const hfModelId = process.env.HF_SPACE_MODEL_ID || 'hf-space';
  const chosen = [process.env.DEFAULT_MODEL_ID, process.env.HELPER_MODEL_ID].filter(Boolean);
  if (!chosen.includes(hfModelId)) return null;

  if (!hfToken()) {
    console.log(chalk.yellow(`[HF-SPACE] ${spaceId} is the chosen model but HF_TOKEN is not set — cannot manage GPU billing.`));
    return null;
  }
  return spaceId;
}

async function callSpaceAction(spaceId: string, action: 'restart' | 'pause'): Promise<boolean> {
  const token = hfToken();
  if (!token) return false;
  try {
    const res = await fetch(`${HF_API_BASE}/${spaceId}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log(chalk.yellow(`[HF-SPACE] ${action} ${spaceId} → HTTP ${res.status} ${body.slice(0, 200)}`));
      return false;
    }
    return true;
  } catch (err: any) {
    console.log(chalk.yellow(`[HF-SPACE] ${action} ${spaceId} failed: ${err?.message || err}`));
    return false;
  }
}

/**
 * Resume (restart) the managed Space so the GPU is warming while the server
 * boots. Non-blocking by design — the first inference request tolerates a cold
 * Space, and we never want billing management to delay server startup.
 */
export function resumeHFSpaceIfManaged(): void {
  const spaceId = hfSpaceToManage();
  if (!spaceId) return;
  console.log(chalk.cyan(`[HF-SPACE] Resuming ${spaceId} (GPU billing starts; paused again on shutdown)…`));
  void callSpaceAction(spaceId, 'restart').then((ok) => {
    if (ok) console.log(chalk.green(`[HF-SPACE] ${spaceId} resume requested.`));
  });
}

/**
 * Pause the managed Space to stop GPU billing. Awaited on shutdown so the
 * pause request is actually sent before the process exits.
 */
export async function pauseHFSpaceIfManaged(): Promise<void> {
  const spaceId = hfSpaceToManage();
  if (!spaceId) return;
  console.log(chalk.cyan(`[HF-SPACE] Pausing ${spaceId} to stop GPU billing…`));
  const ok = await callSpaceAction(spaceId, 'pause');
  if (ok) console.log(chalk.green(`[HF-SPACE] ${spaceId} paused.`));
}
