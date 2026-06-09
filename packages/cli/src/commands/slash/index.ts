/**
 * Slash Command System
 *
 * Re-exports from @nexus-cortex/core plus CLI-specific UI components.
 *
 * @module commands/slash
 */

// Core library re-exports
export * from './SlashCommandRegistry.js';
export * from './SlashCommandParser.js';

// CLI-specific UI components
export { CommandPalette, commandPalette, type PaletteOptions } from './CommandPalette.js';
