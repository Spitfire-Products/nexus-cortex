/**
 * Ink-based Model Picker for fuzzycortex
 *
 * This wraps the same ModelPickerDialog component used in neoncortex,
 * providing a unified visual experience across both CLI modes.
 *
 * Uses Ink's render() to display the React component from within
 * the readline-based fuzzycortex interactive loop.
 */

import React from 'react';
import { render } from 'ink';
import { ModelPickerDialog } from '../ink-ui/components/ModelPickerDialog.js';
import { persistModelForPlatform, type Platform } from '@nexus-cortex/cli/dist/themes/colors.js';
import type { ModelDisplayInfo, ModelPickerResult } from '@nexus-cortex/core';

// Re-export types for convenience
export type { ModelDisplayInfo, ModelPickerResult };

// Platform identifier
const PLATFORM: Platform = 'fuzzycortex';

interface ModelPickerAppProps {
  models: ModelDisplayInfo[];
  currentModelId: string;
  onComplete: (result: ModelPickerResult) => void;
}

/**
 * Wrapper component that handles the picker lifecycle
 */
const ModelPickerApp: React.FC<ModelPickerAppProps> = ({
  models,
  currentModelId,
  onComplete,
}) => {

  const handleSelect = (modelId: string) => {
    // Persist model choice for fuzzycortex platform
    persistModelForPlatform(PLATFORM, modelId);
    onComplete({ selected: true, modelId });
  };

  const handleCancel = () => {
    onComplete({ selected: false });
  };

  return (
    <ModelPickerDialog
      models={models}
      currentModelId={currentModelId}
      onSelect={handleSelect}
      onCancel={handleCancel}
      loading={false}
    />
  );
};

/**
 * Show the model picker using Ink rendering
 *
 * This creates an Ink app, renders the ModelPickerDialog,
 * and returns when the user makes a selection or cancels.
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

    // Create the Ink app
    const { unmount, waitUntilExit } = render(
      <ModelPickerApp
        models={models}
        currentModelId={currentModelId}
        onComplete={(result) => {
          unmount();
          resolve(result);
        }}
      />
    );

    // Handle cleanup on exit
    waitUntilExit().catch(() => {
      resolve({ selected: false });
    });
  });
}

/**
 * Run the model picker with callback for model switching
 */
export async function runModelPicker(
  models: ModelDisplayInfo[],
  currentModelId: string,
  onSelect: (modelId: string) => Promise<void>
): Promise<void> {
  const result = await showModelPicker(models, currentModelId);

  if (result.selected && result.modelId) {
    await onSelect(result.modelId);
  }
}
