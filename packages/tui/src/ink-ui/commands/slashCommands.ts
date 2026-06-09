/**
 * Slash Command Registry for Neocortex Command Palette
 *
 * This module wraps the core library's slashCommandRegistry to provide
 * command suggestions for the neoncortex UI. All command definitions
 * come from @nexus-cortex/core, ensuring consistency with fuzzycortex.
 *
 * @module ink-ui/commands/slashCommands
 */

import { slashCommandRegistry } from '@nexus-cortex/core';

/**
 * Flatten commands with their full paths for search
 * (Compatible interface for CommandSuggestions component)
 */
export interface FlatCommand {
  fullPath: string;      // e.g., "/models switch"
  command: string;       // e.g., "models"
  subcommand?: string;   // e.g., "switch"
  description: string;
  category: string;
}

/**
 * Get flattened list of all commands (including subcommands)
 * Uses core library's slashCommandRegistry
 */
export function getFlatCommands(): FlatCommand[] {
  const flat: FlatCommand[] = [];
  const commands = slashCommandRegistry.getAllCommands();

  for (const cmd of commands) {
    // Add main command
    flat.push({
      fullPath: `/${cmd.name}`,
      command: cmd.name,
      description: cmd.description,
      category: cmd.category,
    });

    // Add subcommands
    if (cmd.subcommands) {
      for (const sub of cmd.subcommands) {
        flat.push({
          fullPath: `/${cmd.name} ${sub.name}`,
          command: cmd.name,
          subcommand: sub.name,
          description: sub.description,
          category: cmd.category,
        });
      }
    }
  }

  return flat;
}

/**
 * Simple fuzzy match scoring
 * Returns score 0-100, higher is better match
 */
export function fuzzyMatch(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact match
  if (t === q) return 100;

  // Starts with query
  if (t.startsWith(q)) return 90;

  // Contains query as substring
  if (t.includes(q)) return 70;

  // Fuzzy: all query chars appear in order
  let qi = 0;
  let score = 0;
  let consecutive = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += consecutive * 2; // Reward consecutive matches
    } else {
      consecutive = 0;
    }
  }

  if (qi === q.length) {
    // All query chars found
    return Math.min(60, 30 + score);
  }

  return 0;
}

/**
 * Search commands with fuzzy matching
 */
export function searchCommands(query: string): FlatCommand[] {
  // Remove leading slash if present
  const q = query.startsWith('/') ? query.slice(1) : query;

  if (!q) {
    // Return all commands sorted by category
    return getFlatCommands();
  }

  const flat = getFlatCommands();
  const results: Array<{ cmd: FlatCommand; score: number }> = [];

  for (const cmd of flat) {
    // Match against fullPath (without /)
    const pathWithoutSlash = cmd.fullPath.slice(1);
    const score = fuzzyMatch(q, pathWithoutSlash);

    if (score > 0) {
      results.push({ cmd, score });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.map(r => r.cmd);
}

/**
 * Get suggestions for partial input
 * Note: Default maxResults is high (200) to allow scrolling through all commands
 */
export function getSuggestions(input: string, maxResults: number = 200): FlatCommand[] {
  if (!input.startsWith('/')) {
    return [];
  }

  return searchCommands(input).slice(0, maxResults);
}
