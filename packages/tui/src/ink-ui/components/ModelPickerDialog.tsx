/**
 * Model Picker Dialog Component
 *
 * Interactive model selection dialog with details panel.
 * Shared between neoncortex (Ink) implementations.
 *
 * For chalk-based implementations, see ChalkModelPicker.ts
 *
 * @module ink-ui/components/ModelPickerDialog
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';
import type { ModelDisplayInfo } from '@nexus-cortex/core';

export interface ModelPickerDialogProps {
  /** List of available models */
  models: ModelDisplayInfo[];

  /** Currently selected model ID */
  currentModelId: string;

  /** Callback when a model is selected */
  onSelect: (modelId: string) => void;

  /** Callback when selection is cancelled */
  onCancel: () => void;

  /** Whether models are currently loading */
  loading?: boolean;
}

/**
 * Model Picker Dialog Component
 *
 * Simple flat list - no dynamic grouping to avoid Ink rendering issues.
 * Uses Static for the list to prevent re-render glitches.
 */
export const ModelPickerDialog: React.FC<ModelPickerDialogProps> = ({
  models,
  currentModelId,
  onSelect,
  onCancel,
  loading = false,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(() => {
    const idx = models.findIndex(m => m.id === currentModelId);
    return Math.max(0, idx);
  });

  // Memoize to prevent recalculation
  const selectedModel = useMemo(() => models[selectedIndex] || models[0], [models, selectedIndex]);

  useInput((input, key) => {
    if (loading) return;

    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => Math.min(models.length - 1, i + 1));
      return;
    }

    const num = parseInt(input, 10);
    if (num >= 1 && num <= 9 && num <= models.length) {
      setSelectedIndex(num - 1);
      return;
    }

    if (key.return && selectedModel) {
      onSelect(selectedModel.id);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }
  });

  // Fixed window size - always show exactly this many rows
  const VISIBLE_ROWS = 12;

  // Calculate scroll window with stable bounds
  const scrollWindow = useMemo(() => {
    const total = models.length;
    if (total <= VISIBLE_ROWS) {
      return { start: 0, end: total };
    }

    // Keep selection centered when possible
    const halfWindow = Math.floor(VISIBLE_ROWS / 2);
    let start = selectedIndex - halfWindow;
    let end = selectedIndex + halfWindow + (VISIBLE_ROWS % 2);

    // Clamp to bounds
    if (start < 0) {
      start = 0;
      end = VISIBLE_ROWS;
    } else if (end > total) {
      end = total;
      start = total - VISIBLE_ROWS;
    }

    return { start, end };
  }, [models.length, selectedIndex]);

  // Build display rows - memoized
  const displayRows = useMemo(() => {
    const rows: Array<{
      key: string;
      model: ModelDisplayInfo;
      index: number;
      isSelected: boolean;
      isCurrent: boolean;
    }> = [];

    for (let i = scrollWindow.start; i < scrollWindow.end; i++) {
      const model = models[i];
      if (model) {
        rows.push({
          key: `row-${i}-${model.id}`,
          model,
          index: i,
          isSelected: i === selectedIndex,
          isCurrent: model.id === currentModelId,
        });
      }
    }

    return rows;
  }, [models, scrollWindow, selectedIndex, currentModelId]);

  const aboveCount = scrollWindow.start;
  const belowCount = models.length - scrollWindow.end;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={Colors.AccentBlue}
      paddingX={2}
      paddingY={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <Text color={Colors.AccentBlue} bold>
           Select Model ({models.length} available)
        </Text>
        {loading && <Text dimColor> loading...</Text>}
      </Box>

      {loading ? (
        <Box height={VISIBLE_ROWS + 2}>
          <Text dimColor>Loading models...</Text>
        </Box>
      ) : (
        <Box flexDirection="row">
          {/* Left: Model list - fixed height */}
          <Box flexDirection="column" width={44}>
            {aboveCount > 0 && (
              <Text dimColor>    ↑ {aboveCount} more</Text>
            )}
            {aboveCount === 0 && <Text> </Text>}

            {displayRows.map((row) => (
              <Text key={row.key}>
                <Text color={row.isSelected ? Colors.AccentCyan : undefined} bold={row.isSelected}>
                  {row.isSelected ? '❯ ' : ' '}
                </Text>
                <Text color={row.isSelected ? Colors.AccentCyan : (row.isCurrent ? Colors.AccentGreen : undefined)}>
                  {(row.model.displayName || row.model.id).slice(0, 32)}
                </Text>
                {row.model.supportsReasoning && <Text color={Colors.AccentPurple}> ⚡</Text>}
                {row.isCurrent && <Text dimColor> ●</Text>}
              </Text>
            ))}

            {belowCount > 0 && (
              <Text dimColor>    ↓ {belowCount} more</Text>
            )}
            {belowCount === 0 && <Text> </Text>}
          </Box>

          {/* Right: Details panel - fixed height */}
          <Box flexDirection="column" width={30} paddingLeft={1}>
            <Text bold color={Colors.AccentBlue}>Details</Text>
            <Box
              borderStyle="single"
              borderColor={Colors.Gray}
              flexDirection="column"
              paddingX={1}
              height={8}
            >
              {selectedModel && (
                <>
                  <Text><Text color={Colors.AccentCyan}>ID:</Text> {selectedModel.id.slice(0, 20)}</Text>
                  <Text><Text color={Colors.AccentCyan}>Provider:</Text> {selectedModel.provider}</Text>
                  <Text><Text color={Colors.AccentCyan}>Context:</Text> {selectedModel.contextWindow ? `${(selectedModel.contextWindow / 1000).toFixed(0)}K` : 'N/A'}</Text>
                  <Text><Text color={Colors.AccentCyan}>Cost:</Text> ${selectedModel.inputCost ?? '?'}/${selectedModel.outputCost ?? '?'}</Text>
                  {selectedModel.supportsReasoning && (
                    <Text color={Colors.AccentPurple}>⚡ Reasoning</Text>
                  )}
                </>
              )}
            </Box>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate • Enter select • Esc cancel</Text>
      </Box>
    </Box>
  );
};

export default ModelPickerDialog;
