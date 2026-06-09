/**
 * Chalk-based Menu Renderer for Nexus Cortex
 *
 * Generic renderer for InteractiveMenuDefinition that works with any menu.
 * Uses raw terminal input for interactive navigation.
 */

import chalk from 'chalk';
import type {
  InteractiveMenuDefinition,
  MenuItem,
  MenuResult,
  MenuRenderer
} from '@nexus-cortex/core';
import {
  isToggleItem,
  isSelectItem,
  isNumberItem,
  isTextItem,
  isActionItem,
  isInfoItem,
  shouldLiveUpdate
} from '@nexus-cortex/core';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';

// ANSI escape codes
const ESC = '\x1b';
const CSI = `${ESC}[`;

const ANSI = {
  clearLine: `${CSI}2K`,
  clearToEnd: `${CSI}0K`,
  clearScreen: `${CSI}2J`,
  cursorUp: (n: number) => `${CSI}${n}A`,
  cursorDown: (n: number) => `${CSI}${n}B`,
  cursorToColumn: (n: number) => `${CSI}${n}G`,
  cursorHome: `${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  saveCursor: `${ESC}7`,
  restoreCursor: `${ESC}8`,
};

// Platform identifier
const PLATFORM = 'fuzzycortex' as const;

/**
 * State for menu editing
 */
interface MenuState {
  selectedSectionIndex: number;
  selectedItemIndex: number;
  values: Record<string, unknown>;
  editingItem: string | null;
  editBuffer: string;
  expandedSections: Set<string>;
}

/**
 * Create flat item list from sections
 */
function flattenItems(definition: InteractiveMenuDefinition, expandedSections: Set<string>): Array<{
  item: MenuItem;
  sectionId: string;
  isSection: boolean;
  sectionTitle?: string;
}> {
  const items: Array<{
    item: MenuItem;
    sectionId: string;
    isSection: boolean;
    sectionTitle?: string;
  }> = [];

  for (const section of definition.sections) {
    // Add section header
    items.push({
      item: { type: 'info', key: `section_${section.id}`, label: section.title, value: '' },
      sectionId: section.id,
      isSection: true,
      sectionTitle: section.title
    });

    // Add items if expanded or not collapsed by default
    const isExpanded = section.collapsed ? expandedSections.has(section.id) : true;
    if (isExpanded) {
      for (const item of section.items) {
        items.push({ item, sectionId: section.id, isSection: false });
      }
    }
  }

  return items;
}

/**
 * Render a toggle item
 */
function renderToggle(item: MenuItem & { type: 'toggle' }, isSelected: boolean, theme: any): string {
  const value = item.value;
  const indicator = value ? chalk.green('[ON]') : chalk.red('[OFF]');
  const label = isSelected ? theme.colors.primary(item.label) : theme.colors.text(item.label);
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  return ` ${selector}${label.padEnd(35)} ${indicator}`;
}

/**
 * Render a select item
 */
function renderSelect(item: MenuItem & { type: 'select' }, isSelected: boolean, theme: any): string {
  const value = item.value || '(none)';
  const indicator = theme.colors.info(`[${value}]`);
  const label = isSelected ? theme.colors.primary(item.label) : theme.colors.text(item.label);
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  return ` ${selector}${label.padEnd(35)} ${indicator}`;
}

/**
 * Render a number item
 */
function renderNumber(item: MenuItem & { type: 'number' }, isSelected: boolean, isEditing: boolean, editBuffer: string, theme: any): string {
  let valueStr: string;
  if (isEditing) {
    valueStr = theme.colors.warning(`[${editBuffer}_]`);
  } else {
    valueStr = theme.colors.info(`[${item.value}]`);
  }
  const label = isSelected ? theme.colors.primary(item.label) : theme.colors.text(item.label);
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  return ` ${selector}${label.padEnd(35)} ${valueStr}`;
}

/**
 * Render a text item
 */
function renderText(item: MenuItem & { type: 'text' }, isSelected: boolean, isEditing: boolean, editBuffer: string, theme: any): string {
  let valueStr: string;
  if (isEditing) {
    const displayValue = item.secret ? '*'.repeat(editBuffer.length) : editBuffer;
    valueStr = theme.colors.warning(`[${displayValue}_]`);
  } else {
    const displayValue = item.secret && item.value ? '****' : (item.value || '(empty)');
    valueStr = theme.colors.info(`[${displayValue}]`);
  }
  const label = isSelected ? theme.colors.primary(item.label) : theme.colors.text(item.label);
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  return ` ${selector}${label.padEnd(35)} ${valueStr}`;
}

/**
 * Render an action item
 */
function renderAction(item: MenuItem & { type: 'action' }, isSelected: boolean, theme: any): string {
  const actionText = item.destructive
    ? chalk.red(`[${item.actionLabel}]`)
    : theme.colors.secondary(`[${item.actionLabel}]`);
  const label = isSelected ? theme.colors.primary(item.label) : theme.colors.text(item.label);
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  return ` ${selector}${label.padEnd(35)} ${actionText}`;
}

/**
 * Render an info item
 */
function renderInfo(item: MenuItem & { type: 'info' }, isSelected: boolean, theme: any): string {
  const label = isSelected ? theme.colors.primary(item.label) : theme.colors.muted(item.label);
  const value = item.value ? theme.colors.muted(` ${item.value}`) : '';
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  return ` ${selector}${label}${value}`;
}

/**
 * Render a section header
 */
function renderSectionHeader(title: string, isExpanded: boolean, isSelected: boolean, theme: any): string {
  const icon = isExpanded ? '[-]' : '[+]';
  const selector = isSelected ? theme.colors.primary('> ') : ' ';
  const headerText = isSelected
    ? chalk.bold(theme.colors.primary(` ${icon} ${title}`))
    : chalk.bold(theme.colors.text(` ${icon} ${title}`));
  return `${selector}${headerText}`;
}

/**
 * Render a menu item
 */
function renderMenuItem(
  item: MenuItem,
  isSelected: boolean,
  isEditing: boolean,
  editBuffer: string,
  theme: any
): string {
  if (isToggleItem(item)) {
    return renderToggle(item, isSelected, theme);
  }
  if (isSelectItem(item)) {
    return renderSelect(item, isSelected, theme);
  }
  if (isNumberItem(item)) {
    return renderNumber(item, isSelected, isEditing, editBuffer, theme);
  }
  if (isTextItem(item)) {
    return renderText(item, isSelected, isEditing, editBuffer, theme);
  }
  if (isActionItem(item)) {
    return renderAction(item, isSelected, theme);
  }
  if (isInfoItem(item)) {
    return renderInfo(item, isSelected, theme);
  }
  // Fallback for any unhandled item types
  return ` ${(item as MenuItem).label}`;
}

/**
 * Draw the menu UI
 */
function drawMenu(
  definition: InteractiveMenuDefinition,
  state: MenuState,
  terminalWidth: number
): number {
  const theme = ThemeManager.getThemeForPlatform(PLATFORM);
  const width = Math.min(80, terminalWidth);
  const lines: string[] = [];

  // Flatten items for rendering
  const flatItems = flattenItems(definition, state.expandedSections);

  // Header
  lines.push('');
  const icon = definition.icon || '#';
  lines.push(chalk.bold(theme.colors.primary(` ${icon} ${definition.title}`)));
  if (definition.description) {
    lines.push(theme.colors.muted(` ${definition.description}`));
  }
  lines.push(theme.colors.muted('-'.repeat(width)));
  lines.push('');

  // Render items
  let globalIndex = 0;
  for (const { item, sectionId, isSection, sectionTitle } of flatItems) {
    const isSelected = globalIndex === state.selectedItemIndex;

    if (isSection) {
      // Section header
      const section = definition.sections.find(s => s.id === sectionId);
      const isExpanded = section?.collapsed ? state.expandedSections.has(sectionId) : true;
      lines.push(renderSectionHeader(sectionTitle || '', isExpanded, isSelected, theme));
      lines.push('');
    } else {
      // Regular item
      const isEditing = state.editingItem === item.key;
      const itemWithValue = { ...item };

      // Update value from state
      if (state.values[item.key] !== undefined) {
        (itemWithValue as any).value = state.values[item.key];
      }

      lines.push(renderMenuItem(itemWithValue, isSelected, isEditing, state.editBuffer, theme));

      // Show description if selected
      if (isSelected && item.description) {
        lines.push(theme.colors.muted(` ${item.description}`));
      }
    }

    globalIndex++;
  }

  // Footer
  lines.push('');
  lines.push(theme.colors.muted('-'.repeat(width)));

  // Actions and help
  const actionHints = definition.actions
    .map(a => `${a.shortcut}: ${a.label}`)
    .join(' | ');
  lines.push(theme.colors.muted(` ${actionHints}`));

  if (definition.footer) {
    lines.push(theme.colors.muted(` ${definition.footer}`));
  }
  lines.push('');

  // Clear screen and draw
  process.stdout.write(ANSI.hideCursor);
  process.stdout.write(ANSI.cursorHome);
  process.stdout.write(ANSI.clearScreen);

  for (const line of lines) {
    process.stdout.write(line + '\n');
  }

  return lines.length;
}

/**
 * ChalkMenuRenderer - Interactive menu renderer using raw terminal input
 */
export class ChalkMenuRenderer implements MenuRenderer {
  async render(
    definition: InteractiveMenuDefinition,
    initialValues: Record<string, unknown>,
    onLiveUpdate?: (key: string, value: unknown) => Promise<void>
  ): Promise<MenuResult> {
    return new Promise((resolve) => {
      // Initialize state
      const state: MenuState = {
        selectedSectionIndex: 0,
        selectedItemIndex: 0,
        values: { ...initialValues },
        editingItem: null,
        editBuffer: '',
        expandedSections: new Set()
      };

      // Initialize expanded sections (non-collapsed by default)
      for (const section of definition.sections) {
        if (!section.collapsed) {
          state.expandedSections.add(section.id);
        }
      }

      const terminalWidth = process.stdout.columns || 80;
      const originalValues = { ...initialValues };

      // Initial draw
      drawMenu(definition, state, terminalWidth);

      // Get flat items for navigation
      const getFlatItems = () => flattenItems(definition, state.expandedSections);

      // Enable raw mode
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const cleanup = () => {
        process.stdin.removeListener('data', handleData);
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // Ignore
          }
        }
        process.stdout.write(ANSI.showCursor);
        process.stdout.write(ANSI.clearScreen);
        process.stdout.write(ANSI.cursorHome);
      };

      const getChanges = (): Record<string, unknown> => {
        const changes: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(state.values)) {
          if (value !== originalValues[key]) {
            changes[key] = value;
          }
        }
        return changes;
      };

      const handleData = async (data: Buffer) => {
        const str = data.toString();
        const flatItems = getFlatItems();

        // Handle editing mode
        if (state.editingItem) {
          // Enter - confirm edit
          if (str === '\r' || str === '\n') {
            const item = flatItems[state.selectedItemIndex]?.item;
            if (item && (isNumberItem(item) || isTextItem(item))) {
              let newValue: unknown = state.editBuffer;
              if (isNumberItem(item)) {
                newValue = parseInt(state.editBuffer) || item.value;
              }
              state.values[item.key] = newValue;

              if (shouldLiveUpdate(item) && onLiveUpdate) {
                await onLiveUpdate(item.key, newValue);
              }
            }
            state.editingItem = null;
            state.editBuffer = '';
            drawMenu(definition, state, terminalWidth);
            return;
          }

          // Escape - cancel edit
          if (str === '\x1b') {
            state.editingItem = null;
            state.editBuffer = '';
            drawMenu(definition, state, terminalWidth);
            return;
          }

          // Backspace
          if (str === '\x7f' || str === '\x08') {
            state.editBuffer = state.editBuffer.slice(0, -1);
            drawMenu(definition, state, terminalWidth);
            return;
          }

          // Regular character
          if (str.length === 1 && str.charCodeAt(0) >= 32) {
            state.editBuffer += str;
            drawMenu(definition, state, terminalWidth);
            return;
          }

          return;
        }

        // Normal navigation mode

        // Up arrow or k (vim)
        if (str === '\x1b[A' || str === 'k') {
          if (state.selectedItemIndex > 0) {
            state.selectedItemIndex--;
            drawMenu(definition, state, terminalWidth);
          }
          return;
        }

        // Down arrow or j (vim)
        if (str === '\x1b[B' || str === 'j') {
          if (state.selectedItemIndex < flatItems.length - 1) {
            state.selectedItemIndex++;
            drawMenu(definition, state, terminalWidth);
          }
          return;
        }

        // Home key - go to first
        if (str === '\x1b[H' || str === '\x1b[1~' || str === '\x1bOH' || str === 'g') {
          state.selectedItemIndex = 0;
          drawMenu(definition, state, terminalWidth);
          return;
        }

        // End key - go to last
        if (str === '\x1b[F' || str === '\x1b[4~' || str === '\x1bOF' || str === 'G') {
          state.selectedItemIndex = flatItems.length - 1;
          drawMenu(definition, state, terminalWidth);
          return;
        }

        // Tab - next section
        if (str === '\t') {
          // Find next section header
          for (let i = state.selectedItemIndex + 1; i < flatItems.length; i++) {
            if (flatItems[i]?.isSection) {
              state.selectedItemIndex = i;
              drawMenu(definition, state, terminalWidth);
              break;
            }
          }
          return;
        }

        // Space or Enter - interact with item
        if (str === ' ' || str === '\r' || str === '\n') {
          const current = flatItems[state.selectedItemIndex];
          if (!current) return;

          // Toggle section collapse
          if (current.isSection) {
            if (state.expandedSections.has(current.sectionId)) {
              state.expandedSections.delete(current.sectionId);
            } else {
              state.expandedSections.add(current.sectionId);
            }
            drawMenu(definition, state, terminalWidth);
            return;
          }

          const item = current.item;

          // Toggle boolean
          if (isToggleItem(item)) {
            const newValue = !state.values[item.key];
            state.values[item.key] = newValue;

            if (shouldLiveUpdate(item) && onLiveUpdate) {
              await onLiveUpdate(item.key, newValue);
            }

            drawMenu(definition, state, terminalWidth);
            return;
          }

          // Cycle select options
          if (isSelectItem(item)) {
            const currentValue = state.values[item.key] as string;
            const currentIndex = item.choices.findIndex(c => c.value === currentValue);
            const nextIndex = (currentIndex + 1) % item.choices.length;
            const newValue = item.choices[nextIndex]?.value || currentValue;
            state.values[item.key] = newValue;

            if (shouldLiveUpdate(item) && onLiveUpdate) {
              await onLiveUpdate(item.key, newValue);
            }

            drawMenu(definition, state, terminalWidth);
            return;
          }

          // Enter edit mode for number/text
          if (isNumberItem(item) || isTextItem(item)) {
            state.editingItem = item.key;
            state.editBuffer = String(state.values[item.key] || '');
            drawMenu(definition, state, terminalWidth);
            return;
          }

          // Action items
          if (isActionItem(item)) {
            cleanup();
            resolve({
              action: item.key,
              changes: getChanges(),
              hasChanges: Object.keys(getChanges()).length > 0
            });
            return;
          }

          return;
        }

        // Save - s/S key
        if (str === 's' || str === 'S') {
          cleanup();
          resolve({
            action: 'save',
            changes: getChanges(),
            hasChanges: Object.keys(getChanges()).length > 0
          });
          return;
        }

        // Reset - r key
        if (str === 'r' || str === 'R') {
          cleanup();
          resolve({
            action: 'reset',
            changes: {},
            hasChanges: false
          });
          return;
        }

        // Escape or q - cancel
        if (str === '\x1b' || str === 'q' || str === 'Q') {
          cleanup();
          resolve({
            action: 'cancel',
            changes: {},
            hasChanges: false
          });
          return;
        }

        // Ctrl+C - exit
        if (str === '\x03') {
          cleanup();
          process.kill(process.pid, 'SIGINT');
          return;
        }
      };

      process.stdin.on('data', handleData);
    });
  }
}

/**
 * Create a ChalkMenuRenderer instance
 */
export function createChalkMenuRenderer(): ChalkMenuRenderer {
  return new ChalkMenuRenderer();
}

/**
 * Helper to show a menu and handle the result
 */
export async function showInteractiveMenu(
  definition: InteractiveMenuDefinition,
  initialValues: Record<string, unknown>,
  onLiveUpdate?: (key: string, value: unknown) => Promise<void>
): Promise<MenuResult> {
  const renderer = createChalkMenuRenderer();
  return renderer.render(definition, initialValues, onLiveUpdate);
}
