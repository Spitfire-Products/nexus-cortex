/**
 * Chalk-based Model Picker for Nexus Cortex (fuzzycortex)
 *
 * Interactive terminal UI for selecting AI models using raw terminal input.
 * Matches the neoncortex ModelPickerDialog layout exactly:
 * - Rounded border around entire dialog
 * - Model list on left with scroll indicators
 * - Details panel on right in bordered box
 */

import chalk from 'chalk';
import { ThemeManager } from '@nexus-cortex/cli/dist/themes/ThemeManager.js';
import { persistModelForPlatform, type Platform } from '@nexus-cortex/cli/dist/themes/colors.js';
import type { ModelDisplayInfo, ModelPickerResult } from '@nexus-cortex/core';

// Re-export for convenience
export type { ModelDisplayInfo, ModelPickerResult };

// Platform identifier for fuzzycortex CLI
const PLATFORM: Platform = 'fuzzycortex';

// ANSI escape codes
const ESC = '\x1b';
const CSI = `${ESC}[`;

const ANSI = {
  clearScreen: `${CSI}2J`,
  cursorHome: `${CSI}H`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
};

/**
 * Format context window size (e.g., 128000 -> "128K")
 */
function formatContextWindow(tokens?: number): string {
  if (!tokens) return 'N/A';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
  return `${Math.round(tokens / 1000)}K`;
}

/**
 * Format cost (e.g., 3.0 -> "$3.00")
 */
function formatCost(cost?: number): string {
  if (cost === undefined || cost === null) return '?';
  if (cost === 0) return 'Free';
  return `$${cost}`;
}

/**
 * Draw the model picker UI matching neoncortex layout
 */
function drawModelPicker(
  models: ModelDisplayInfo[],
  selectedIndex: number,
  currentModelId: string,
  terminalWidth: number
): number {
  const theme = ThemeManager.getThemeForPlatform(PLATFORM);
  const boxWidth = Math.min(76, terminalWidth - 4);
  const listWidth = 42;
  const detailsWidth = 27;
  const lines: string[] = [];

  // Visible rows for the list
  const VISIBLE_ROWS = 12;

  // Calculate scroll window - keep selection centered
  let scrollStart = 0;
  let scrollEnd = models.length;

  if (models.length > VISIBLE_ROWS) {
    const halfWindow = Math.floor(VISIBLE_ROWS / 2);
    scrollStart = selectedIndex - halfWindow;
    scrollEnd = selectedIndex + halfWindow + (VISIBLE_ROWS % 2);

    if (scrollStart < 0) {
      scrollStart = 0;
      scrollEnd = VISIBLE_ROWS;
    } else if (scrollEnd > models.length) {
      scrollEnd = models.length;
      scrollStart = models.length - VISIBLE_ROWS;
    }
  }

  const aboveCount = scrollStart;
  const belowCount = models.length - scrollEnd;

  // Get selected model for details panel
  const selectedModel = models[selectedIndex];

  // Colors from theme
  const borderColor = theme.colors.info;
  const accentColor = theme.colors.info;
  const highlightColor = theme.colors.success;
  const mutedColor = theme.colors.muted;
  const primaryColor = theme.colors.primary;

  // Box characters
  const topLeft = '╭';
  const topRight = '╮';
  const bottomLeft = '╰';
  const bottomRight = '╯';
  const horizontal = '─';
  const vertical = '│';

  // Top border
  lines.push(borderColor(topLeft + horizontal.repeat(boxWidth - 2) + topRight));

  // Empty line
  lines.push(borderColor(vertical) + ' '.repeat(boxWidth - 2) + borderColor(vertical));

  // Header:  Select Model (77 available)
  const headerText = ` Select Model (${models.length} available)`;
  const headerPadding = boxWidth - 2 - headerText.length;
  lines.push(borderColor(vertical) + primaryColor(headerText) + ' '.repeat(Math.max(0, headerPadding)) + borderColor(vertical));

  // Empty line
  lines.push(borderColor(vertical) + ' '.repeat(boxWidth - 2) + borderColor(vertical));

  // Build the list and details side by side
  // Row format: │  [list item padded to listWidth]  [details panel]  │

  // Pre-build details panel lines
  const detailLines: string[] = [];
  detailLines.push(primaryColor('Details'));
  detailLines.push(mutedColor('┌' + '─'.repeat(detailsWidth - 2) + '┐'));

  if (selectedModel) {
    // ID line
    const idLabel = accentColor('ID:');
    detailLines.push(mutedColor('│ ') + idLabel + ' '.repeat(detailsWidth - 4 - 3) + mutedColor('│'));
    const idValue = selectedModel.id.slice(0, detailsWidth - 4);
    detailLines.push(mutedColor('│ ') + idValue + ' '.repeat(Math.max(0, detailsWidth - 4 - idValue.length)) + mutedColor('│'));

    // Provider line
    const providerText = `Provider: ${selectedModel.provider}`;
    detailLines.push(mutedColor('│ ') + accentColor('Provider: ') + selectedModel.provider + ' '.repeat(Math.max(0, detailsWidth - 4 - providerText.length)) + mutedColor('│'));

    // Context line
    const contextText = `Context: ${formatContextWindow(selectedModel.contextWindow)}`;
    detailLines.push(mutedColor('│ ') + accentColor('Context: ') + formatContextWindow(selectedModel.contextWindow) + ' '.repeat(Math.max(0, detailsWidth - 4 - contextText.length)) + mutedColor('│'));

    // Cost line
    const costText = `Cost: ${formatCost(selectedModel.inputCost)}/${formatCost(selectedModel.outputCost)}`;
    detailLines.push(mutedColor('│ ') + accentColor('Cost: ') + `${formatCost(selectedModel.inputCost)}/${formatCost(selectedModel.outputCost)}` + ' '.repeat(Math.max(0, detailsWidth - 4 - costText.length)) + mutedColor('│'));

    // Reasoning indicator
    if (selectedModel.supportsReasoning) {
      const reasoningText = '⚡ Reasoning';
      detailLines.push(mutedColor('│ ') + chalk.hex('#d19a66')(reasoningText) + ' '.repeat(Math.max(0, detailsWidth - 4 - reasoningText.length)) + mutedColor('│'));
    } else {
      detailLines.push(mutedColor('│') + ' '.repeat(detailsWidth - 2) + mutedColor('│'));
    }
  } else {
    // Empty details
    for (let i = 0; i < 6; i++) {
      detailLines.push(mutedColor('│') + ' '.repeat(detailsWidth - 2) + mutedColor('│'));
    }
  }
  detailLines.push(mutedColor('└' + '─'.repeat(detailsWidth - 2) + '┘'));

  // Now build combined rows
  let detailRowIndex = 0;

  // Up arrow row
  const upArrowText = aboveCount > 0 ? mutedColor(` ↑ ${aboveCount} more`) : '';
  const upArrowPadded = upArrowText + ' '.repeat(Math.max(0, listWidth - (aboveCount > 0 ? 10 + String(aboveCount).length : 0)));
  const detailHeader = detailLines[detailRowIndex++] || '';
  lines.push(borderColor(vertical) + upArrowPadded + ' ' + detailHeader + ' '.repeat(Math.max(0, boxWidth - 2 - listWidth - 2 - stripAnsi(detailHeader).length)) + borderColor(vertical));

  // Model rows with details panel
  for (let i = scrollStart; i < scrollEnd; i++) {
    const model = models[i];
    if (!model) continue;

    const isSelected = i === selectedIndex;
    const isCurrent = model.id === currentModelId;

    // Build model line
    let modelLine = ' ';

    // Selection indicator
    if (isSelected) {
      modelLine += accentColor('❯ ');
    } else {
      modelLine += ' ';
    }

    // Model name (truncated to fit)
    const displayName = (model.displayName || model.id).slice(0, 30);
    if (isSelected) {
      modelLine += accentColor(displayName);
    } else if (isCurrent) {
      modelLine += highlightColor(displayName);
    } else {
      modelLine += displayName;
    }

    // Reasoning indicator
    if (model.supportsReasoning) {
      modelLine += chalk.hex('#d19a66')(' ⚡');
    }

    // Current indicator
    if (isCurrent) {
      modelLine += mutedColor(' ●');
    }

    // Pad model line to listWidth
    const modelLineLen = stripAnsi(modelLine).length;
    const modelLinePadded = modelLine + ' '.repeat(Math.max(0, listWidth - modelLineLen));

    // Get corresponding detail line
    const detailLine = detailLines[detailRowIndex++] || '';
    const detailLineLen = stripAnsi(detailLine).length;
    const rightPadding = Math.max(0, boxWidth - 2 - listWidth - 2 - detailLineLen);

    lines.push(borderColor(vertical) + modelLinePadded + ' ' + detailLine + ' '.repeat(rightPadding) + borderColor(vertical));
  }

  // Fill remaining rows if list is shorter
  while (detailRowIndex < detailLines.length) {
    const emptyModelLine = ' '.repeat(listWidth);
    const detailLine = detailLines[detailRowIndex++] || '';
    const detailLineLen = stripAnsi(detailLine).length;
    const rightPadding = Math.max(0, boxWidth - 2 - listWidth - 2 - detailLineLen);
    lines.push(borderColor(vertical) + emptyModelLine + ' ' + detailLine + ' '.repeat(rightPadding) + borderColor(vertical));
  }

  // Down arrow row
  const downArrowText = belowCount > 0 ? mutedColor(` ↓ ${belowCount} more`) : '';
  const downArrowPadded = downArrowText + ' '.repeat(Math.max(0, listWidth - (belowCount > 0 ? 10 + String(belowCount).length : 0)));
  const remainingDetailLine = detailLines[detailRowIndex++] || '';
  const remainingDetailLen = stripAnsi(remainingDetailLine).length;
  lines.push(borderColor(vertical) + downArrowPadded + ' ' + remainingDetailLine + ' '.repeat(Math.max(0, boxWidth - 2 - listWidth - 2 - remainingDetailLen)) + borderColor(vertical));

  // Empty line
  lines.push(borderColor(vertical) + ' '.repeat(boxWidth - 2) + borderColor(vertical));

  // Footer: ↑↓ navigate • Enter select • Esc cancel
  const footerText = ' ↑↓ navigate • Enter select • Esc cancel';
  const footerPadding = boxWidth - 2 - footerText.length;
  lines.push(borderColor(vertical) + mutedColor(footerText) + ' '.repeat(Math.max(0, footerPadding)) + borderColor(vertical));

  // Empty line
  lines.push(borderColor(vertical) + ' '.repeat(boxWidth - 2) + borderColor(vertical));

  // Bottom border
  lines.push(borderColor(bottomLeft + horizontal.repeat(boxWidth - 2) + bottomRight));

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
 * Strip ANSI escape codes for length calculation
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Interactive model picker using raw terminal input
 */
export async function showModelPicker(
  models: ModelDisplayInfo[],
  currentModelId: string
): Promise<ModelPickerResult> {
  return new Promise((resolve) => {
    if (models.length === 0) {
      resolve({ selected: false });
      return;
    }

    let selectedIndex = models.findIndex(m => m.id === currentModelId);
    if (selectedIndex === -1) selectedIndex = 0;

    const terminalWidth = process.stdout.columns || 80;

    // Initial draw
    drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);

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

    const handleData = async (data: Buffer) => {
      const str = data.toString();

      // Up arrow or k (vim)
      if (str === '\x1b[A' || str === 'k') {
        if (selectedIndex > 0) {
          selectedIndex--;
          drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        }
        return;
      }

      // Down arrow or j (vim)
      if (str === '\x1b[B' || str === 'j') {
        if (selectedIndex < models.length - 1) {
          selectedIndex++;
          drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        }
        return;
      }

      // Home key or g (vim) - go to first
      if (str === '\x1b[H' || str === '\x1b[1~' || str === '\x1bOH' || str === 'g') {
        selectedIndex = 0;
        drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        return;
      }

      // End key or G (vim) - go to last
      if (str === '\x1b[F' || str === '\x1b[4~' || str === '\x1bOF' || str === 'G') {
        selectedIndex = models.length - 1;
        drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        return;
      }

      // Page Up - jump 5 up
      if (str === '\x1b[5~') {
        selectedIndex = Math.max(0, selectedIndex - 5);
        drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        return;
      }

      // Page Down - jump 5 down
      if (str === '\x1b[6~') {
        selectedIndex = Math.min(models.length - 1, selectedIndex + 5);
        drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        return;
      }

      // Number keys 1-9 for quick selection
      const num = parseInt(str, 10);
      if (num >= 1 && num <= 9 && num <= models.length) {
        selectedIndex = num - 1;
        drawModelPicker(models, selectedIndex, currentModelId, terminalWidth);
        return;
      }

      // Enter - select model
      if (str === '\r' || str === '\n') {
        const selectedModel = models[selectedIndex];
        cleanup();

        if (selectedModel) {
          // Persist model choice for fuzzycortex platform
          persistModelForPlatform(PLATFORM, selectedModel.id);
          resolve({ selected: true, modelId: selectedModel.id });
        } else {
          resolve({ selected: false });
        }
        return;
      }

      // Escape or q - exit without changing
      if (str === '\x1b' || str === 'q' || str === 'Q') {
        cleanup();
        resolve({ selected: false });
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

/**
 * Run the model picker with models from the orchestrator client
 */
export async function runModelPicker(
  models: ModelDisplayInfo[],
  currentModelId: string,
  onSelect: (modelId: string) => Promise<void>
): Promise<void> {
  const theme = ThemeManager.getThemeForPlatform(PLATFORM);

  const result = await showModelPicker(models, currentModelId);

  if (result.selected && result.modelId) {
    console.log();
    console.log(theme.colors.muted(`... Switching to ${result.modelId}...`));

    try {
      await onSelect(result.modelId);
      console.log(theme.colors.success(`✓ Switched to model: ${result.modelId}`));
      console.log(theme.colors.muted('Model saved to fuzzycortex configuration'));
      console.log();
    } catch (error: any) {
      console.log(theme.colors.error(`Error switching model: ${error.message}`));
      console.log();
    }
  } else {
    console.log(theme.colors.muted('\nExited model picker'));
  }
}
