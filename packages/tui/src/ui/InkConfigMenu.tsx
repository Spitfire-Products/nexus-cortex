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
  SettingsLoader,
  SettingsWriter,
  setGlobalSetting,
  getGlobalConfigDir,
  getShippedDefault,
  getRuntimeConfigEntry,
  isLiveToggleable,
} from '@nexus-cortex/core';
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

// projectPath is accepted for API compatibility but no longer used — harness config is
// GLOBAL (~/.cortex/.env), read/written regardless of the invoking directory.
const ConfigMenu: React.FC<ConfigMenuProps> = ({ onClose, onUpdateRuntimeConfig }) => {
  const flatList = buildFlatList();
  const selectableIndices = flatList.map((item, i) => item.type === 'setting' ? i : -1).filter(i => i >= 0);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [scrollOffset, setScrollOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Harness config is GLOBAL (~/.cortex/.env), identical from any directory — read and
  // write it, not a cwd/project .env. Stable instances: rebuilt-per-render objects defeat
  // useCallback dependency checks.
  const loader = useMemo(() => new SettingsLoader(getGlobalConfigDir()), []);
  // Keys the user has overridden in ~/.cortex/.env (recomputed after each change) — used
  // to mark rows as "override" vs flowing from the shipped default.
  const overrideKeys = useMemo(() => new Set(loader.getOverriddenKeys()), [loader, refreshKey]);

  const termHeight = process.stdout.rows || 30;
  const maxVisible = Math.max(5, termHeight - 8);

  const currentFlatIdx = selectableIndices[selectedIdx] ?? 0;
  const currentItem = flatList[currentFlatIdx];
  const currentSetting = currentItem?.setting;

  const applyChange = useCallback((setting: SettingMetadata, newValue: string) => {
    // Sparse override to the GLOBAL ~/.cortex/.env (surgical — one line, preserving the
    // rest). Only levers the user deliberately changes are stored; everything else keeps
    // flowing from the shipped .env.defaults and updates on upgrade.
    setGlobalSetting(setting.key as any, newValue);
    process.env[setting.key] = newValue;

    const entry = getRuntimeConfigEntry(setting.key);
    if (entry?.tier === 'config' && entry.mapper && onUpdateRuntimeConfig) {
      onUpdateRuntimeConfig(entry.mapper(newValue));
    }

    setRefreshKey(k => k + 1);
  }, [onUpdateRuntimeConfig]);

  const doReset = useCallback(() => {
    // Reset = REMOVE the user's lever override lines (API keys preserved) so every lever
    // falls back to the shipped default and rejoins the upgrade flow.
    new SettingsWriter(getGlobalConfigDir()).backup();
    const results = loader.resetAllToDefaults();
    const removed = Object.keys(results);

    // Live-apply: restore each removed lever to its shipped default from .env.defaults.
    for (const key of removed) {
      const def = getShippedDefault(key as any);
      process.env[key] = def;
      const entry = getRuntimeConfigEntry(key);
      if (entry?.tier === 'config' && entry.mapper && onUpdateRuntimeConfig) {
        onUpdateRuntimeConfig(entry.mapper(def));
      }
    }

    setStatusMsg(`[OK] ${removed.length} override${removed.length === 1 ? '' : 's'} removed — levers now follow the latest shipped defaults (API keys preserved)`);
    setRefreshKey(k => k + 1);
  }, [loader, onUpdateRuntimeConfig]);

  const resetOne = useCallback(() => {
    if (!currentSetting || currentSetting.secret) return;
    if (!overrideKeys.has(currentSetting.key)) {
      setStatusMsg(`${currentSetting.displayName} is already at the shipped default`);
      return;
    }
    // Remove just this override → the lever falls back to the latest shipped default.
    loader.remove(currentSetting.key as any);
    const def = getShippedDefault(currentSetting.key as any);
    process.env[currentSetting.key] = def;
    const entry = getRuntimeConfigEntry(currentSetting.key);
    if (entry?.tier === 'config' && entry.mapper && onUpdateRuntimeConfig) {
      onUpdateRuntimeConfig(entry.mapper(def));
    }
    setStatusMsg(`[OK] ${currentSetting.displayName} reset to shipped default (${def})`);
    setRefreshKey(k => k + 1);
  }, [currentSetting, overrideKeys, loader, onUpdateRuntimeConfig]);

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

    if (input === 'd' || input === 'D') {
      resetOne();
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
            <Box width={3}>
              <Text color={Colors.AccentCyan}>
                {overrideKeys.has(s.key) && !s.secret ? '●' : ' '}
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
            Reset ALL levers to the latest shipped defaults? API keys preserved, backup saved. (y/N)
          </Text>
        ) : (
          <Text dimColor>
            {editMode
              ? 'Type value, Enter to save, ESC to cancel'
              : 'Arrows · Space/Enter toggle · d reset one · r reset all · ● = your override · ESC/q close'}
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
