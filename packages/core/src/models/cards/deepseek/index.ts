/**
 * DeepSeek Model Cards
 * Auto-exported for easy discovery
 *
 * Active models (api.deepseek.com):
 *   - deepseek-v4-pro    — flagship; supersedes deepseek-reasoner
 *   - deepseek-v4-flash  — fast; supersedes deepseek-chat
 *
 * Removed 2026-06-10: deepseek-chat and deepseek-reasoner — DeepSeek is deprecating
 * both on 2026-07-24. Their names are kept as back-compat aliases in ModelAliasResolver
 * (deepseek-chat -> deepseek-v4-flash, deepseek-reasoner -> deepseek-v4-pro) so existing
 * configs and sessions auto-migrate to the V4 successors.
 *
 * Earlier removals (rejected by the live API as of 2026-05-13): deepseek-r1-0528,
 * deepseek-v3.1, deepseek-v3.1-thinking, deepseek-v3.2, deepseek-v3.2-speciale, deepseek-coder.
 *
 * If DeepSeek brings any of these back, the simplest restore is `git revert` of the
 * deletion commit.
 */

export { deepseekV4Pro } from './deepseek-v4-pro.js';
export { deepseekV4Flash } from './deepseek-v4-flash.js';
