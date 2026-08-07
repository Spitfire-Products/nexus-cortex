/**
 * InkConfigMenu — Interactive settings browser
 *
 * Renders all SETTINGS_METADATA grouped by category with current values.
 * Booleans toggle with Space/Enter. Choices cycle with Space/Enter.
 * Numbers/strings edited inline. Changes write to .env, set process.env,
 * and call updateRuntimeConfig for config-stored keys.
 *
 * Used by both neoncortex (inline overlay) and cortex-cli (imperative render).
 */

import React, { useState, useCallback, useMemo } from 'react';
import { render, Box, Text, useInput } from 'ink';
import {
  SETTINGS_METADATA,
  type SettingMetadata,
  type EnvironmentVariables,
  SettingsLoader,
  SettingsWriter,
  DEFAULT_SETTINGS,
  getRuntimeConfigEntry,
  isLiveToggleable,
} from '@nexus-cortex/core';

const API_KEY_FIELDS = SETTINGS_METADATA
  .filter(s => s.category === 'api_keys')
  .map(s => s.key);
import { Colors } from '@nexus-cortex/cli/dist/themes/colors.js';

const CATEGORY_LABELS: Record<string, string> = {
  api_keys: 'API Keys',
  models: 'Models',
  system: 'System',
  mentorship: 'Mentorship',
  context: 'Context Management',
  session: 'Session',
  loop_control: 'Loop Control',
  server_side_tools: 'Tools & Execution',
  model_router: 'Model Router',
  agent_workspace: 'Agent Workspace',
  training: 'Training & Audit',
  runtime: 'Runtime',
};

const CATEGORY_ORDER = [
  'models',
  'system',
  'runtime',
  'loop_control',
  'context',
  'mentorship',
  'server_side_tools',
  'model_router',
  'training',
  'session',
  'agent_workspace',
  'api_keys',
];

interface FlatItem {
  type: 'header' | 'setting';
  category?: string;
  setting?: SettingMetadata;
}

function buildFlatList(): FlatItem[] {
  const items: FlatItem[] = [];
  for (const cat of CATEGORY_ORDER) {
    const settings = SETTINGS_METADATA.filter(s => s.category === cat);
    if (settings.length === 0) continue;
    items.push({ type: 'header', category: cat });
    for (const s of settings) {
      items.push({ type: 'setting', setting: s });
    }
  }
  return items;
}

function getCurrentValue(key: string, loader: SettingsLoader): string {
  const fromEnv = process.env[key];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return loader.get(key as any) || '';
}

function formatValue(setting: SettingMetadata, value: string): string {
  if (setting.secret && value) {
    return value.length > 8
      ? value.substring(0, 4) + '...' + value.substring(value.length - 4)
      : '***';
  }
  if (setting.type === 'boolean') {
    return value === 'true' ? 'ON' : 'OFF';
  }
  if (!value && setting.default) {
    return setting.default;
  }
  return value || '(not set)';
}

interface ConfigMenuProps {
  onClose: () => void;
  projectPath: string;
  onUpdateRuntimeConfig?: (updates: Record<string, unknown>) => void;
}

const ConfigMenu: React.FC<ConfigMenuProps> = ({ onClose, projectPath, onUpdateRuntimeConfig }) => {
  const flatList = buildFlatList();
  const selectableIndices = flatList.map((item, i) => item.type === 'setting' ? i : -1).filter(i => i >= 0);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Stable instances: rebuilt-per-render objects defeat useCallback dependency checks.
  const loader = useMemo(() => new SettingsLoader(projectPath), [projectPath]);
  const writer = useMemo(() => new SettingsWriter(projectPath), [projectPath]);

  const termHeight = process.stdout.rows || 30;
  const maxVisible = Math.max(5, termHeight - 8);

  const currentFlatIdx = selectableIndices[selectedIdx] ?? 0;
  const currentItem = flatList[currentFlatIdx];
  const currentSetting = currentItem?.setting;

  const applyChange = useCallback((setting: SettingMetadata, newValue: string) => {
    writer.update({ [setting.key]: newValue } as any);
    process.env[setting.key] = newValue;

    const entry = getRuntimeConfigEntry(setting.key);
    if (entry?.tier === 'config' && entry.mapper && onUpdateRuntimeConfig) {
      onUpdateRuntimeConfig(entry.mapper(newValue));
    }

    setRefreshKey(k => k + 1);
  }, [writer, onUpdateRuntimeConfig]);

  const doReset = useCallback(() => {
    // Preserve API keys; reset everything else to benchmark-proven defaults.
    const preserved: Partial<EnvironmentVariables> = {};
    for (const key of API_KEY_FIELDS) {
      const val = process.env[key] || loader.get(key as any);
      if (val) preserved[key as keyof EnvironmentVariables] = val;
    }

    const resetEnv: Partial<EnvironmentVariables> = { ...DEFAULT_SETTINGS, ...preserved };

    writer.backup();
    writer.write(resetEnv);

    for (const [key, val] of Object.entries(resetEnv)) {
      process.env[key] = val as string;
      const entry = getRuntimeConfigEntry(key);
      if (entry?.tier === 'config' && entry.mapper && onUpdateRuntimeConfig) {
        onUpdateRuntimeConfig(entry.mapper(val as string));
      }
    }

    const preservedCount = Object.keys(preserved).length;
    setStatusMsg(`[OK] Reset to optimal defaults (${preservedCount} API keys preserved, backup saved)`);
    setRefreshKey(k => k + 1);
  }, [writer, loader, onUpdateRuntimeConfig]);

  const toggleOrCycle = useCallback(() => {
    if (!currentSetting) return;
    if (currentSetting.secret) return;

    const current = getCurrentValue(currentSetting.key, loader);

    if (currentSetting.type === 'boolean') {
      applyChange(currentSetting, current === 'true' ? 'false' : 'true');
    } else if (currentSetting.type === 'choice' && currentSetting.choices) {
      const idx = currentSetting.choices.indexOf(current);
      const next = (idx + 1) % currentSetting.choices.length;
      applyChange(currentSetting, currentSetting.choices[next]!);
    } else {
      setEditBuffer(current);
      setEditMode(true);
    }
  }, [currentSetting, loader, applyChange]);

  useInput((input, key) => {
    if (editMode && currentSetting) {
      if (key.escape) {
        setEditMode(false);
        return;
      }
      if (key.return) {
        if (editBuffer.trim()) {
          applyChange(currentSetting, editBuffer.trim());
        }
        setEditMode(false);
        return;
      }
      if (key.backspace || key.delete) {
        setEditBuffer(b => b.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setEditBuffer(b => b + input);
        return;
      }
      return;
    }

    // Reset confirmation gate — intercepts all other input while active.
    if (resetConfirm) {
      if (input === 'y' || input === 'Y' || key.return) {
        doReset();
        setResetConfirm(false);
      } else {
        setResetConfirm(false);
        setStatusMsg('Reset cancelled');
      }
      return;
    }

    if (key.escape || input === 'q') {
      onClose();
      return;
    }

    if (input === 'r' || input === 'R') {
      setResetConfirm(true);
      setStatusMsg('');
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIdx(i => {
        const next = i > 0 ? i - 1 : selectableIndices.length - 1;
        const flatIdx = selectableIndices[next]!;
        if (flatIdx < scrollOffset) setScrollOffset(flatIdx > 0 ? flatIdx - 1 : 0);
        return next;
      });
    } else if (key.downArrow || input === 'j') {
      setSelectedIdx(i => {
        const next = i < selectableIndices.length - 1 ? i + 1 : 0;
        const flatIdx = selectableIndices[next]!;
        if (flatIdx >= scrollOffset + maxVisible) setScrollOffset(flatIdx - maxVisible + 2);
        if (next === 0) setScrollOffset(0);
        return next;
      });
    } else if (key.return || input === ' ') {
      toggleOrCycle();
    }
  });

  const visibleItems = flatList.slice(scrollOffset, scrollOffset + maxVisible);
  const showScrollUp = scrollOffset > 0;
  const showScrollDown = scrollOffset + maxVisible < flatList.length;

  const descriptionText = currentSetting?.description || '';
  const liveLabel = currentSetting ? (isLiveToggleable(currentSetting.key) ? '(live)' : '(restart required)') : '';

  // Force re-read on refresh
  void refreshKey;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.AccentCyan}>━━━ Configuration Settings ━━━</Text>
      </Box>

      {showScrollUp && <Text color={Colors.Gray}>  ▲ more</Text>}

      {visibleItems.map((item, vIdx) => {
        const flatIdx = scrollOffset + vIdx;

        if (item.type === 'header') {
          return (
            <Box key={`h-${item.category}`} marginTop={vIdx > 0 ? 1 : 0}>
              <Text bold color={Colors.AccentGreen}>
                {CATEGORY_LABELS[item.category!] || item.category}
              </Text>
            </Box>
          );
        }

        const s = item.setting!;
        const isSelected = flatIdx === currentFlatIdx;
        const value = getCurrentValue(s.key, loader);
        const display = formatValue(s, value);
        const live = isLiveToggleable(s.key);

        if (isSelected && editMode) {
          return (
            <Box key={s.key}>
              <Text color={Colors.AccentCyan}>{'> '}</Text>
              <Text color={Colors.AccentCyan}>{s.displayName}: </Text>
              <Text color={Colors.AccentYellow}>{editBuffer}</Text>
              <Text color={Colors.Gray}>{'█'}</Text>
            </Box>
          );
        }

        return (
          <Box key={s.key}>
            <Text color={isSelected ? Colors.AccentCyan : Colors.Gray}>
              {isSelected ? '> ' : ' '}
            </Text>
            <Box width={35}>
              <Text color={isSelected ? Colors.White : Colors.Gray} wrap="truncate">
                {s.displayName}
              </Text>
            </Box>
            <Box width={25}>
              <Text
                color={
                  s.type === 'boolean'
                    ? value === 'true' ? Colors.AccentGreen : Colors.Gray
                    : Colors.AccentYellow
                }
                wrap="truncate"
              >
                {display}
              </Text>
            </Box>
            <Text color={live ? Colors.AccentGreen : Colors.Gray} dimColor={!live}>
              {live ? 'live' : 'restart'}
            </Text>
          </Box>
        );
      })}

      {showScrollDown && <Text color={Colors.Gray}>  ▼ more</Text>}

      <Box marginTop={1} flexDirection="column">
        <Text color={Colors.Gray} wrap="wrap">
          {descriptionText}
        </Text>
        {currentSetting && (
          <Text dimColor>
            {currentSetting.key} {liveLabel}
          </Text>
        )}
      </Box>

      {statusMsg && (
        <Box marginTop={1}>
          <Text color={Colors.AccentGreen}>{statusMsg}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        {resetConfirm ? (
          <Text color={Colors.AccentYellow}>
            Reset ALL settings to optimal defaults? API keys preserved, backup saved. (y/N)
          </Text>
        ) : (
          <Text dimColor>
            {editMode
              ? 'Type value, Enter to save, ESC to cancel'
              : 'Arrows navigate · Space/Enter toggle · r reset defaults · ESC/q close'}
          </Text>
        )}
      </Box>
    </Box>
  );
};

/**
 * Show interactive config menu (imperative entry point for cortex-cli)
 */
export async function showConfigMenu(
  projectPath: string,
  onUpdateRuntimeConfig?: (updates: Record<string, unknown>) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const { unmount, waitUntilExit } = render(
      <ConfigMenu
        projectPath={projectPath}
        onUpdateRuntimeConfig={onUpdateRuntimeConfig}
        onClose={() => {
          unmount();
          resolve();
        }}
      />
    );

    waitUntilExit().catch(() => {
      resolve();
    });
  });
}

export { ConfigMenu };
export default showConfigMenu;
