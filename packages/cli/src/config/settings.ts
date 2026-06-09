/**
 * Settings module for Nexus Cortex CLI
 *
 * Provides type definitions for settings management.
 */

export enum SettingScope {
  User = 'user',
  Project = 'project',
  Extension = 'extension',
}

export type LoadableSettingScope = SettingScope.User | SettingScope.Project;

export interface GeneralSettings {
  vimMode?: boolean;
  disableUpdateNag?: boolean;
  theme?: string;
}

export interface UISettings {
  useFullWidth?: boolean;
  codeBlockStyle?: 'default' | 'minimal' | 'full';
  showLineNumbers?: boolean;
  useAlternateBuffer?: boolean;
}

export interface ModelSettings {
  defaultModel?: string;
  temperature?: number;
}

export interface MergedSettings {
  general?: GeneralSettings;
  ui?: UISettings;
  model?: ModelSettings;
}

export interface LoadedSettings {
  merged: MergedSettings;
  setValue: (scope: SettingScope, key: string, value: unknown) => Promise<void>;
  getValue: (key: string) => unknown;
  reload: () => Promise<void>;
}

/**
 * Create default loaded settings
 */
export function createDefaultSettings(): LoadedSettings {
  return {
    merged: {
      general: {
        vimMode: false,
        disableUpdateNag: false,
      },
      ui: {
        useFullWidth: true,
      },
      model: {},
    },
    setValue: async () => {},
    getValue: () => undefined,
    reload: async () => {},
  };
}
