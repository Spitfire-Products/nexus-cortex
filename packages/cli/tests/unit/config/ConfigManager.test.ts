/**
 * Unit tests for ConfigManager
 * Target: 100% coverage
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager, CLIConfig } from '../../../src/config/ConfigManager.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { homedir } from 'os';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn()
}));

// Mock os
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock/home')
}));

const DEFAULT_CONFIG: CLIConfig = {
  serverUrl: 'http://localhost:4000',
  theme: 'default',
  timeout: 30000,
  maxRetries: 3,
  logLevel: 'error'
};

describe('ConfigManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ConfigManager.clearCache();
  });

  afterEach(() => {
    ConfigManager.clearCache();
  });

  describe('load()', () => {
    test('should load config from file when it exists', () => {
      const customConfig: CLIConfig = {
        ...DEFAULT_CONFIG,
        serverUrl: 'http://custom:5000',
        defaultModel: 'claude-sonnet-4'
      };

      (readFileSync as any).mockReturnValue(JSON.stringify(customConfig));

      const result = ConfigManager.load();

      expect(result).toEqual(customConfig);
      expect(readFileSync).toHaveBeenCalledWith('/mock/home/.cortex/config.json', 'utf-8');
    });

    test('should use defaults when file does not exist', () => {
      const error: any = new Error('File not found');
      error.code = 'ENOENT';
      (readFileSync as any).mockImplementation(() => {
        throw error;
      });

      const result = ConfigManager.load();

      expect(result).toEqual(DEFAULT_CONFIG);
    });

    test('should use defaults when file contains invalid JSON', () => {
      (readFileSync as any).mockImplementation(() => {
        throw new SyntaxError('Invalid JSON');
      });

      const result = ConfigManager.load();

      expect(result).toEqual(DEFAULT_CONFIG);
    });

    test('should merge with defaults when partial config', () => {
      const partialConfig = {
        serverUrl: 'http://custom:5000',
        theme: 'minimal'
      };

      (readFileSync as any).mockReturnValue(JSON.stringify(partialConfig));

      const result = ConfigManager.load();

      expect(result).toEqual({
        ...DEFAULT_CONFIG,
        serverUrl: 'http://custom:5000',
        theme: 'minimal'
      });
    });

    test('should use defaults when config is invalid', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const invalidConfig = {
        serverUrl: 'http://custom:5000',
        theme: 'invalid-theme', // Invalid theme
        timeout: 30000,
        maxRetries: 3,
        logLevel: 'error'
      };

      (readFileSync as any).mockReturnValue(JSON.stringify(invalidConfig));

      const result = ConfigManager.load();

      expect(result).toEqual(DEFAULT_CONFIG);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Invalid config file, using defaults');

      consoleWarnSpy.mockRestore();
    });

    test('should cache config on first load', () => {
      const customConfig: CLIConfig = {
        ...DEFAULT_CONFIG,
        serverUrl: 'http://cached:5000'
      };

      (readFileSync as any).mockReturnValue(JSON.stringify(customConfig));

      // First load
      const result1 = ConfigManager.load();
      expect(readFileSync).toHaveBeenCalledTimes(1);

      // Second load should use cache
      const result2 = ConfigManager.load();
      expect(readFileSync).toHaveBeenCalledTimes(1); // Still only 1 call
      expect(result2).toEqual(result1);
    });

    test('should throw on unexpected file system errors', () => {
      const error = new Error('Permission denied');
      (readFileSync as any).mockImplementation(() => {
        throw error;
      });

      expect(() => ConfigManager.load()).toThrow('Permission denied');
    });
  });

  describe('save()', () => {
    test('should save valid config to file', async () => {
      const config: CLIConfig = {
        ...DEFAULT_CONFIG,
        serverUrl: 'http://save-test:5000'
      };

      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);

      await ConfigManager.save(config);

      expect(mkdir).toHaveBeenCalledWith('/mock/home/.cortex', { recursive: true });
      expect(writeFile).toHaveBeenCalledWith(
        '/mock/home/.cortex/config.json',
        JSON.stringify(config, null, 2),
        'utf-8'
      );
    });

    test('should update cache after saving', async () => {
      const config: CLIConfig = {
        ...DEFAULT_CONFIG,
        serverUrl: 'http://cached:5000'
      };

      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);

      await ConfigManager.save(config);

      // Next load should use cache
      (readFileSync as any).mockImplementation(() => {
        throw new Error('Should not be called');
      });

      const result = ConfigManager.load();
      expect(result).toEqual(config);
    });

    test('should reject invalid config', async () => {
      const invalidConfig: any = {
        serverUrl: 'http://test:5000',
        theme: 'invalid-theme',
        timeout: 30000,
        maxRetries: 3,
        logLevel: 'error'
      };

      await expect(ConfigManager.save(invalidConfig)).rejects.toThrow('Invalid configuration');
    });
  });

  describe('get()', () => {
    test('should get specific config value', () => {
      (readFileSync as any).mockReturnValue(JSON.stringify(DEFAULT_CONFIG));

      expect(ConfigManager.get('serverUrl')).toBe('http://localhost:4000');
      expect(ConfigManager.get('theme')).toBe('default');
      expect(ConfigManager.get('timeout')).toBe(30000);
    });

    test('should get optional config value', () => {
      const config: CLIConfig = {
        ...DEFAULT_CONFIG,
        defaultModel: 'claude-sonnet-4'
      };

      (readFileSync as any).mockReturnValue(JSON.stringify(config));
      ConfigManager.clearCache();

      expect(ConfigManager.get('defaultModel')).toBe('claude-sonnet-4');
    });
  });

  describe('set()', () => {
    test('should set specific config value', async () => {
      (readFileSync as any).mockReturnValue(JSON.stringify(DEFAULT_CONFIG));
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);

      await ConfigManager.set('serverUrl', 'http://new:6000');

      expect(writeFile).toHaveBeenCalled();
      const savedConfig = JSON.parse((writeFile as any).mock.calls[0][1]);
      expect(savedConfig.serverUrl).toBe('http://new:6000');
    });

    test('should set optional config value', async () => {
      (readFileSync as any).mockReturnValue(JSON.stringify(DEFAULT_CONFIG));
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);

      await ConfigManager.set('defaultModel', 'claude-opus-4');

      const savedConfig = JSON.parse((writeFile as any).mock.calls[0][1]);
      expect(savedConfig.defaultModel).toBe('claude-opus-4');
    });
  });

  describe('reset()', () => {
    test('should reset config to defaults', async () => {
      (mkdir as any).mockResolvedValue(undefined);
      (writeFile as any).mockResolvedValue(undefined);

      await ConfigManager.reset();

      expect(writeFile).toHaveBeenCalled();
      const savedConfig = JSON.parse((writeFile as any).mock.calls[0][1]);
      expect(savedConfig).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('validate()', () => {
    test('should validate correct config', () => {
      expect(ConfigManager.validate(DEFAULT_CONFIG)).toBe(true);
    });

    test('should validate config with optional fields', () => {
      const config: CLIConfig = {
        ...DEFAULT_CONFIG,
        defaultModel: 'claude-sonnet-4'
      };

      expect(ConfigManager.validate(config)).toBe(true);
    });

    test('should reject missing serverUrl', () => {
      const config: any = { ...DEFAULT_CONFIG };
      delete config.serverUrl;

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject invalid serverUrl type', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        serverUrl: 12345
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject missing theme', () => {
      const config: any = { ...DEFAULT_CONFIG };
      delete config.theme;

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject invalid theme value', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        theme: 'invalid'
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject invalid timeout type', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        timeout: 'not-a-number'
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject negative timeout', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        timeout: -100
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject invalid maxRetries type', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        maxRetries: 'not-a-number'
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject negative maxRetries', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        maxRetries: -1
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject missing logLevel', () => {
      const config: any = { ...DEFAULT_CONFIG };
      delete config.logLevel;

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject invalid logLevel value', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        logLevel: 'invalid'
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });

    test('should reject invalid defaultModel type', () => {
      const config: any = {
        ...DEFAULT_CONFIG,
        defaultModel: 12345
      };

      expect(ConfigManager.validate(config)).toBe(false);
    });
  });

  describe('Utility methods', () => {
    test('should clear cache', () => {
      (readFileSync as any).mockReturnValue(JSON.stringify(DEFAULT_CONFIG));

      // Load to populate cache
      ConfigManager.load();
      expect(readFileSync).toHaveBeenCalledTimes(1);

      // Clear cache
      ConfigManager.clearCache();

      // Load again should read from file
      ConfigManager.load();
      expect(readFileSync).toHaveBeenCalledTimes(2);
    });

    test('should get config path', () => {
      expect(ConfigManager.getConfigPath()).toBe('/mock/home/.cortex/config.json');
    });

    test('should set custom config path', () => {
      ConfigManager.setConfigPath('/custom/path/config.json');
      expect(ConfigManager.getConfigPath()).toBe('/custom/path/config.json');

      // Reset to default
      ConfigManager.setConfigPath('/mock/home/.cortex/config.json');
    });
  });
});
