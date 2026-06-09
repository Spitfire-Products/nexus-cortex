/**
 * Mentorship Config Service
 *
 * Implements ConfigService for mentorship settings.
 * Provides a menu definition that can be rendered by any CLI UI.
 */

import type {
  ConfigService,
  InteractiveMenuDefinition,
  MenuSection,
  MenuItem,
  MenuValidationResult
} from '../ui/menu-types.js';
import { createStandardActions } from '../ui/menu-types.js';
import { SettingsLoader } from './SettingsLoader.js';
import { SettingsWriter } from './SettingsWriter.js';
import { SETTINGS_METADATA, DEFAULT_SETTINGS, type SettingMetadata } from './SettingsSchema.js';

/**
 * Mentorship configuration interface
 */
export interface MentorshipConfig {
  enabled: boolean;
  triggerOnError: boolean;
  errorThreshold: 'low' | 'medium' | 'high';
  keywordsEnabled: boolean;
  customKeywords: string;
  helperModel: string;
  turnBasedEnabled: boolean;
  turnInterval: number;
  interleavedThinking: boolean;
  patternDetection: boolean;
  patternThreshold: number;
  /** Index signature for Record<string, unknown> compatibility */
  [key: string]: boolean | string | number;
}

/**
 * Map of config keys to environment variable keys
 */
const CONFIG_KEY_MAP: Record<keyof MentorshipConfig, string> = {
  enabled: 'MENTORSHIP_ENABLED',
  triggerOnError: 'MENTORSHIP_TRIGGER_ON_ERROR',
  errorThreshold: 'MENTORSHIP_ERROR_THRESHOLD',
  keywordsEnabled: 'MENTORSHIP_KEYWORDS_ENABLED',
  customKeywords: 'MENTORSHIP_CUSTOM_KEYWORDS',
  helperModel: 'MENTORSHIP_HELPER_MODEL',
  turnBasedEnabled: 'MENTORSHIP_TURN_BASED_ENABLED',
  turnInterval: 'MENTORSHIP_TURN_INTERVAL',
  interleavedThinking: 'MENTORSHIP_INTERLEAVED_THINKING',
  patternDetection: 'MENTORSHIP_PATTERN_DETECTION',
  patternThreshold: 'MENTORSHIP_PATTERN_THRESHOLD'
};

/**
 * Reverse map: env key to config key
 */
const ENV_KEY_MAP: Record<string, keyof MentorshipConfig> = Object.entries(CONFIG_KEY_MAP)
  .reduce((acc, [configKey, envKey]) => {
    acc[envKey] = configKey as keyof MentorshipConfig;
    return acc;
  }, {} as Record<string, keyof MentorshipConfig>);

/**
 * MentorshipConfigService implements ConfigService for mentorship settings
 */
export class MentorshipConfigService implements ConfigService<MentorshipConfig> {
  private loader: SettingsLoader;
  private writer: SettingsWriter;

  constructor(projectPath: string = process.cwd()) {
    this.loader = new SettingsLoader(projectPath);
    this.writer = new SettingsWriter(projectPath);
  }

  /**
   * Get current mentorship configuration
   */
  getConfig(): MentorshipConfig {
    const env = this.loader.getEnvironment();

    return {
      enabled: env.MENTORSHIP_ENABLED === 'true',
      triggerOnError: env.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
      errorThreshold: env.MENTORSHIP_ERROR_THRESHOLD as 'low' | 'medium' | 'high',
      keywordsEnabled: env.MENTORSHIP_KEYWORDS_ENABLED === 'true',
      customKeywords: env.MENTORSHIP_CUSTOM_KEYWORDS,
      helperModel: env.MENTORSHIP_HELPER_MODEL,
      turnBasedEnabled: env.MENTORSHIP_TURN_BASED_ENABLED === 'true',
      turnInterval: parseInt(env.MENTORSHIP_TURN_INTERVAL) || 10,
      interleavedThinking: env.MENTORSHIP_INTERLEAVED_THINKING === 'true',
      patternDetection: env.MENTORSHIP_PATTERN_DETECTION === 'true',
      patternThreshold: parseInt(env.MENTORSHIP_PATTERN_THRESHOLD) || 3
    };
  }

  /**
   * Update mentorship configuration
   */
  async setConfig(config: Partial<MentorshipConfig>): Promise<void> {
    const updates: Record<string, string> = {};

    for (const [key, value] of Object.entries(config)) {
      const envKey = CONFIG_KEY_MAP[key as keyof MentorshipConfig];
      if (envKey && value !== undefined) {
        if (typeof value === 'boolean') {
          updates[envKey] = value ? 'true' : 'false';
        } else if (typeof value === 'number') {
          updates[envKey] = value.toString();
        } else {
          updates[envKey] = value;
        }
      }
    }

    this.writer.update(updates as any);
    this.loader.reload();
  }

  /**
   * Get a single config value
   */
  getValue<K extends keyof MentorshipConfig>(key: K): MentorshipConfig[K] {
    return this.getConfig()[key];
  }

  /**
   * Set a single config value
   */
  async setValue<K extends keyof MentorshipConfig>(key: K, value: MentorshipConfig[K]): Promise<void> {
    await this.setConfig({ [key]: value } as Partial<MentorshipConfig>);
  }

  /**
   * Generate menu definition from settings metadata
   */
  getMenuDefinition(): InteractiveMenuDefinition {
    const mentorshipMetadata = SETTINGS_METADATA.filter(m => m.category === 'mentorship');

    // Group items into sections
    const sections: MenuSection[] = [
      {
        id: 'master',
        title: 'Master Controls',
        icon: '!',
        items: this.createMenuItems(mentorshipMetadata.filter(m =>
          m.key === 'MENTORSHIP_ENABLED' || m.key === 'MENTORSHIP_HELPER_MODEL'
        ))
      },
      {
        id: 'triggers',
        title: 'Error Triggers',
        description: 'Configure when mentorship activates',
        items: this.createMenuItems(mentorshipMetadata.filter(m =>
          m.key === 'MENTORSHIP_TRIGGER_ON_ERROR' ||
          m.key === 'MENTORSHIP_ERROR_THRESHOLD' ||
          m.key === 'MENTORSHIP_PATTERN_DETECTION' ||
          m.key === 'MENTORSHIP_PATTERN_THRESHOLD'
        ))
      },
      {
        id: 'keywords',
        title: 'Keyword Triggers',
        description: 'Manual activation via @keywords',
        items: this.createMenuItems(mentorshipMetadata.filter(m =>
          m.key === 'MENTORSHIP_KEYWORDS_ENABLED' ||
          m.key === 'MENTORSHIP_CUSTOM_KEYWORDS'
        ))
      },
      {
        id: 'periodic',
        title: 'Periodic Review',
        description: 'Automatic turn-based mentorship',
        items: this.createMenuItems(mentorshipMetadata.filter(m =>
          m.key === 'MENTORSHIP_TURN_BASED_ENABLED' ||
          m.key === 'MENTORSHIP_TURN_INTERVAL'
        ))
      },
      {
        id: 'advanced',
        title: 'Advanced',
        collapsed: true,
        items: this.createMenuItems(mentorshipMetadata.filter(m =>
          m.key === 'MENTORSHIP_INTERLEAVED_THINKING'
        ))
      }
    ];

    return {
      id: 'mentorship',
      title: 'Mentorship Configuration',
      description: 'Configure AI-to-AI reactive mentorship system',
      icon: '#',
      sections: sections.filter(s => s.items.length > 0),
      actions: createStandardActions(),
      footer: 'Arrow keys: navigate | Space/Enter: toggle | s: save | r: reset | Esc: cancel'
    };
  }

  /**
   * Create menu items from settings metadata
   */
  private createMenuItems(metadata: SettingMetadata[]): MenuItem[] {
    const config = this.getConfig();

    return metadata.map(m => {
      const configKey = ENV_KEY_MAP[m.key];
      const currentValue = configKey ? config[configKey] : undefined;

      switch (m.type) {
        case 'boolean':
          return {
            type: 'toggle' as const,
            key: m.key,
            label: m.displayName,
            description: m.description,
            value: currentValue === true,
            liveUpdate: true
          };

        case 'choice':
          return {
            type: 'select' as const,
            key: m.key,
            label: m.displayName,
            description: m.description,
            value: currentValue as string || m.default || '',
            choices: (m.choices || []).map(c => ({
              label: c,
              value: c
            })),
            liveUpdate: true
          };

        case 'number':
          return {
            type: 'number' as const,
            key: m.key,
            label: m.displayName,
            description: m.description,
            value: typeof currentValue === 'number' ? currentValue : parseInt(m.default || '0'),
            min: m.key === 'MENTORSHIP_TURN_INTERVAL' ? 1 : 2,
            max: m.key === 'MENTORSHIP_TURN_INTERVAL' ? 50 : 10,
            liveUpdate: false
          };

        case 'string':
          return {
            type: 'text' as const,
            key: m.key,
            label: m.displayName,
            description: m.description,
            value: currentValue as string || m.default || '',
            placeholder: m.description,
            liveUpdate: false
          };

        default:
          return {
            type: 'info' as const,
            key: m.key,
            label: m.displayName,
            description: m.description,
            value: String(currentValue || m.default || '')
          };
      }
    });
  }

  /**
   * Validate a value for a given key
   */
  validateValue(key: string, value: unknown): MenuValidationResult {
    const metadata = SETTINGS_METADATA.find(m => m.key === key);

    if (!metadata) {
      return { valid: true };
    }

    // Type validation
    if (metadata.type === 'boolean' && typeof value !== 'boolean') {
      return { valid: false, error: 'Must be true or false' };
    }

    if (metadata.type === 'number') {
      const num = typeof value === 'number' ? value : parseInt(String(value));
      if (isNaN(num)) {
        return { valid: false, error: 'Must be a number' };
      }
    }

    if (metadata.type === 'choice' && metadata.choices) {
      if (!metadata.choices.includes(String(value))) {
        return { valid: false, error: `Must be one of: ${metadata.choices.join(', ')}` };
      }
    }

    // Custom validation
    if (metadata.validation) {
      const result = metadata.validation(String(value));
      if (result !== true) {
        return { valid: false, error: result };
      }
    }

    return { valid: true };
  }

  /**
   * Get default mentorship configuration
   */
  getDefaultConfig(): MentorshipConfig {
    return {
      enabled: DEFAULT_SETTINGS.MENTORSHIP_ENABLED === 'true',
      triggerOnError: DEFAULT_SETTINGS.MENTORSHIP_TRIGGER_ON_ERROR === 'true',
      errorThreshold: DEFAULT_SETTINGS.MENTORSHIP_ERROR_THRESHOLD as 'low' | 'medium' | 'high',
      keywordsEnabled: DEFAULT_SETTINGS.MENTORSHIP_KEYWORDS_ENABLED === 'true',
      customKeywords: DEFAULT_SETTINGS.MENTORSHIP_CUSTOM_KEYWORDS,
      helperModel: DEFAULT_SETTINGS.MENTORSHIP_HELPER_MODEL,
      turnBasedEnabled: DEFAULT_SETTINGS.MENTORSHIP_TURN_BASED_ENABLED === 'true',
      turnInterval: parseInt(DEFAULT_SETTINGS.MENTORSHIP_TURN_INTERVAL),
      interleavedThinking: DEFAULT_SETTINGS.MENTORSHIP_INTERLEAVED_THINKING === 'true',
      patternDetection: DEFAULT_SETTINGS.MENTORSHIP_PATTERN_DETECTION === 'true',
      patternThreshold: parseInt(DEFAULT_SETTINGS.MENTORSHIP_PATTERN_THRESHOLD)
    };
  }

  /**
   * Reset mentorship configuration to defaults
   */
  async resetToDefaults(): Promise<void> {
    await this.setConfig(this.getDefaultConfig());
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    this.loader.reload();
  }

  /**
   * Quick enable mentorship with sensible defaults
   */
  async quickEnable(): Promise<void> {
    await this.setConfig({
      enabled: true,
      triggerOnError: true,
      errorThreshold: 'medium',
      patternDetection: true
    });
  }

  /**
   * Quick disable mentorship
   */
  async quickDisable(): Promise<void> {
    await this.setConfig({ enabled: false });
  }

  /**
   * Get a summary of current configuration for display
   */
  getSummary(): {
    status: 'enabled' | 'disabled';
    triggers: string[];
    helperModel: string;
  } {
    const config = this.getConfig();

    const triggers: string[] = [];
    if (config.triggerOnError) {
      triggers.push(`Errors (${config.errorThreshold}+)`);
    }
    if (config.keywordsEnabled) {
      triggers.push('Keywords');
    }
    if (config.turnBasedEnabled) {
      triggers.push(`Every ${config.turnInterval} turns`);
    }
    if (config.patternDetection) {
      triggers.push(`Pattern (${config.patternThreshold}+ similar)`);
    }

    return {
      status: config.enabled ? 'enabled' : 'disabled',
      triggers: triggers.length > 0 ? triggers : ['None configured'],
      helperModel: config.helperModel
    };
  }
}
