/**
 * Ink-based Menu Picker for fuzzycortex
 *
 * This wraps the same MenuRenderer component used in neoncortex,
 * providing a unified visual experience across both CLI modes.
 *
 * Uses Ink's render() to display the React component from within
 * the readline-based fuzzycortex interactive loop.
 */

import React from 'react';
import { render } from 'ink';
import { MenuRenderer } from '../ink-ui/components/MenuRenderer.js';
import type { InteractiveMenuDefinition, MenuResult } from '@nexus-cortex/core';

// Re-export types for convenience
export type { InteractiveMenuDefinition, MenuResult };

interface MenuPickerAppProps {
  definition: InteractiveMenuDefinition;
  initialValues: Record<string, unknown>;
  onComplete: (result: MenuResult) => void;
  onLiveUpdate?: (key: string, value: unknown) => Promise<void>;
}

/**
 * Wrapper component that handles the menu lifecycle
 */
const MenuPickerApp: React.FC<MenuPickerAppProps> = ({
  definition,
  initialValues,
  onComplete,
  onLiveUpdate,
}) => {
  return (
    <MenuRenderer
      definition={definition}
      initialValues={initialValues}
      onComplete={onComplete}
      onLiveUpdate={onLiveUpdate}
      isActive={true}
    />
  );
};

/**
 * Show an interactive menu using Ink rendering
 *
 * This creates an Ink app, renders the MenuRenderer,
 * and returns when the user completes the menu.
 */
export async function showInteractiveMenu(
  definition: InteractiveMenuDefinition,
  initialValues: Record<string, unknown>,
  onLiveUpdate?: (key: string, value: unknown) => Promise<void>
): Promise<MenuResult> {
  return new Promise((resolve) => {
    // Create the Ink app
    const { unmount, waitUntilExit } = render(
      <MenuPickerApp
        definition={definition}
        initialValues={initialValues}
        onComplete={(result) => {
          unmount();
          resolve(result);
        }}
        onLiveUpdate={onLiveUpdate}
      />
    );

    // Handle cleanup on exit
    waitUntilExit().catch(() => {
      resolve({
        action: 'cancel',
        changes: {},
        hasChanges: false,
      });
    });
  });
}
