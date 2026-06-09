/**
 * DeepSeek Model Cards
 * Auto-exported for easy discovery
 *
 * Parity with nexus-terminal CORTEX (CortexModelRegistry.ts lines 347-368).
 * api.deepseek.com only accepts these 4 model names as of 2026-05-13:
 *   - deepseek-v4-pro
 *   - deepseek-v4-flash
 *   - deepseek-reasoner (DeepSeek's stable alias for the R1 reasoning model)
 *   - deepseek-chat (stable alias for the current chat model)
 *
 * Removed cards (rejected by API with explicit "supported model names are ..." error):
 *   - deepseek-r1-0528, deepseek-v3.1, deepseek-v3.1-thinking,
 *     deepseek-v3.2, deepseek-v3.2-speciale, deepseek-coder
 *
 * If DeepSeek brings any of these back, the simplest restore is `git revert`
 * of the deletion commit.
 */

export { deepseekV4Pro } from './deepseek-v4-pro.js';
export { deepseekV4Flash } from './deepseek-v4-flash.js';
export { deepseekReasoner } from './deepseek-reasoner.js';
export { deepseekChat } from './deepseek-chat.js';
