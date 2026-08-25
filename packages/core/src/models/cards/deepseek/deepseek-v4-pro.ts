/**
 * DeepSeek V4 Pro (deepseek-v4-pro)
 * DeepSeek's flagship V4 model — 1.6T total / 49B active params, 1M context
 *
 * Best for: Complex reasoning, coding, deep analysis
 * Cost: $0.50 input / $2.00 output per million tokens
 * Supersedes deepseek-reasoner. Dual-mode (thinking/non-thinking).
 */

import { createDeepSeekModelConfig } from '../../configurators/DeepSeekConfigurator.js';
import type { ModelConfig } from '../../ModelConfig.interface.js';

export const deepseekV4Pro: ModelConfig = createDeepSeekModelConfig({
  id: 'deepseek-v4-pro',
  displayName: 'DeepSeek V4 Pro',
  family: 'deepseek-v4',

  // Home-door anchor (P4pro sweep 2026-08-17: bash-edit 366 tok vs control 616
  // (-41%) vs bash-plus 612 (no effect) — the dsh 2-tool shape is the DeepSeek
  // family door; the bash-plus hedge was measured worthless on pro).
  anchorProfile: 'bash-edit',
  // Flip-rerun verdict (2026-08-25, .bench/distill-flip/VERDICT-FLIP.md): with the
  // full guard build, lifted 80.9% vs persist+guards 74.2% on TB2 — pro-class
  // confirms 'lifted'. (Flash tied 66.3/66.3 with persist CHEAPER only when the
  // EndTurn gate rides along — a profile combo, so the flash card stays unset.)
  frameProfile: 'lifted',
  // P6c/P6e/P6f/P6g family verdict (2026-08-18): boot-observation minimal beats
  // the full corpus at equal accuracy on short AND long tasks, both members
  // (BASH_PLUS_SPEC P6 series). Env levers override per session.
  promptPreset: 'boot-minimal',
  contextWindow: 1000000,
  outputTokens: 65536,
  inputCost: 0.50,
  outputCost: 2.0,
  reasoning: {
    supported: true,
    format: 'reasoning_content',
    extractionMethod: 'separate_field',
    pattern: 'interleaved'
  }
});
