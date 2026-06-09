/**
 * Interactive Configurator
 *
 * CLI tool for interactive configuration setup
 */

import * as readline from 'readline';
import type { EnvironmentVariables, SettingMetadata } from './SettingsSchema.js';
import { SETTINGS_METADATA, getSettingsByCategory, validateSetting } from './SettingsSchema.js';
import { SettingsLoader } from './SettingsLoader.js';
import { SettingsWriter } from './SettingsWriter.js';

/**
 * Create readline interface
 */
function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input
 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt with hidden input (for passwords/secrets)
 */
async function promptSecret(question: string): Promise<string> {
  return new Promise(resolve => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    // Disable echo
    if ((stdin as any).setRawMode) {
      (stdin as any).setRawMode(true);
    }

    stdout.write(question);

    let input = '';
    const onData = (char: Buffer) => {
      const c = char.toString();

      if (c === '\n' || c === '\r' || c === '\u0004') {
        // Enter or Ctrl+D
        stdout.write('\n');
        (stdin as any).setRawMode(false);
        stdin.removeListener('data', onData);
        resolve(input);
      } else if (c === '\u0003') {
        // Ctrl+C
        process.exit(0);
      } else if (c === '\u007f' || c === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        input += c;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Prompt with choices
 */
async function promptChoice(
  rl: readline.Interface,
  question: string,
  choices: string[],
  defaultValue?: string
): Promise<string> {
  console.log(question);
  choices.forEach((choice, index) => {
    const marker = choice === defaultValue ? '>' : ' ';
    console.log(` ${marker} ${index + 1}. ${choice}`);
  });

  while (true) {
    const answer = await prompt(rl, `Select (1-${choices.length})${defaultValue ? ` [default: ${defaultValue}]` : ''}: `);

    if (answer === '' && defaultValue) {
      return defaultValue;
    }

    const index = parseInt(answer) - 1;
    if (index >= 0 && index < choices.length && choices[index] !== undefined) {
      return choices[index];
    }

    console.log(`Invalid choice. Please enter a number between 1 and ${choices.length}.`);
  }
}

/**
 * Prompt for boolean
 */
async function promptBoolean(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean = false
): Promise<boolean> {
  const answer = await prompt(rl, `${question} (y/n) [${defaultValue ? 'y' : 'n'}]: `);

  if (answer === '') {
    return defaultValue;
  }

  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * Prompt for setting value
 */
async function promptForSetting(
  rl: readline.Interface,
  setting: SettingMetadata,
  currentValue?: string
): Promise<string> {
  const defaultDisplay = currentValue || setting.default || '';

  // Format question
  let question = `${setting.displayName}`;
  if (setting.description) {
    console.log(`\n ${setting.description}`);
  }

  // Handle different types
  switch (setting.type) {
    case 'boolean': {
      const current = currentValue === 'true' || setting.default === 'true';
      const result = await promptBoolean(rl, question, current);
      return result ? 'true' : 'false';
    }

    case 'choice': {
      if (!setting.choices || setting.choices.length === 0) {
        throw new Error(`No choices defined for ${setting.key}`);
      }
      return await promptChoice(rl, question, setting.choices, defaultDisplay);
    }

    case 'secret': {
      const value = await promptSecret(`${question}: `);
      if (value === '' && defaultDisplay) {
        return defaultDisplay;
      }
      return value;
    }

    case 'string':
    case 'number':
    default: {
      const value = await prompt(rl, `${question} [${defaultDisplay}]: `);
      if (value === '' && defaultDisplay) {
        return defaultDisplay;
      }
      return value;
    }
  }
}

/**
 * Configure category of settings
 */
async function configureCategory(
  rl: readline.Interface,
  category: SettingMetadata['category'],
  loader: SettingsLoader
): Promise<Partial<EnvironmentVariables>> {
  const settings = getSettingsByCategory(category);
  const config: Partial<EnvironmentVariables> = {};

  console.log(`\n${'='.repeat(60)}`);
  console.log(` ${category.toUpperCase().replace(/_/g, ' ')}`);
  console.log('='.repeat(60));

  for (const setting of settings) {
    const currentValue = loader.get(setting.key);

    while (true) {
      const value = await promptForSetting(rl, setting, currentValue);

      // Validate
      const validation = validateSetting(setting.key, value);
      if (validation === true) {
        config[setting.key] = value;
        break;
      } else {
        console.log(`[ERROR] Invalid value: ${validation}`);
        console.log('Please try again.');
      }
    }
  }

  return config;
}

/**
 * Interactive Configurator Class
 */
export class InteractiveConfigurator {
  private loader: SettingsLoader;
  private writer: SettingsWriter;

  constructor(projectPath: string = process.cwd()) {
    this.loader = new SettingsLoader(projectPath);
    this.writer = new SettingsWriter(projectPath);
  }

  /**
   * Run full interactive configuration
   */
  async configure(): Promise<void> {
    const rl = createInterface();

    try {
      console.log('\n' + '='.repeat(60));
      console.log(' Nexus Cortex - Interactive Configuration');
      console.log('='.repeat(60));
      console.log('\nThis wizard will help you configure Nexus Cortex.');
      console.log('Press Ctrl+C at any time to cancel.\n');

      // Show current configuration summary
      const summary = this.loader.getSummary();
      console.log('Current configuration:');
      console.log(` - Default Model: ${summary.defaultModel}`);
      console.log(` - Helper Model: ${summary.helperModel}`);
      console.log(` - Configured Providers: ${summary.providers.length > 0 ? summary.providers.join(', ') : 'None'}`);
      console.log(` - Mentorship: ${summary.mentorshipEnabled ? 'Enabled' : 'Disabled'}`);
      console.log(` - Debug: ${summary.debugEnabled ? 'Enabled' : 'Disabled'}`);

      const continueConfig = await promptBoolean(rl, '\nConfigure settings?', true);
      if (!continueConfig) {
        console.log('Configuration cancelled.');
        rl.close();
        return;
      }

      // Ask which categories to configure
      const categories: { key: SettingMetadata['category']; name: string }[] = [
        { key: 'api_keys', name: 'API Keys' },
        { key: 'models', name: 'Model Configuration' },
        { key: 'system', name: 'System Settings' },
        { key: 'mentorship', name: 'Reactive Mentorship' },
        { key: 'context', name: 'Context Management' },
        { key: 'session', name: 'Session Configuration' }
      ];

      console.log('\nSelect categories to configure:');
      const selectedCategories: SettingMetadata['category'][] = [];

      for (const category of categories) {
        const configure = await promptBoolean(rl, `Configure ${category.name}?`, category.key === 'api_keys' || category.key === 'models');
        if (configure) {
          selectedCategories.push(category.key);
        }
      }

      if (selectedCategories.length === 0) {
        console.log('No categories selected. Configuration cancelled.');
        rl.close();
        return;
      }

      // Configure selected categories
      let allConfig: Partial<EnvironmentVariables> = {};

      for (const category of selectedCategories) {
        const categoryConfig = await configureCategory(rl, category, this.loader);
        allConfig = { ...allConfig, ...categoryConfig };
      }

      // Confirmation
      console.log('\n' + '='.repeat(60));
      console.log(' Configuration Summary');
      console.log('='.repeat(60));

      const changedSettings = Object.entries(allConfig).filter(([key, value]) => {
        const current = this.loader.get(key as keyof EnvironmentVariables);
        return value !== current;
      });

      if (changedSettings.length === 0) {
        console.log('No changes made.');
      } else {
        console.log(`\n${changedSettings.length} setting(s) will be updated:`);
        for (const [key, value] of changedSettings) {
          const metadata = SETTINGS_METADATA.find(s => s.key === key);
          const displayValue = metadata?.secret ? '********' : value;
          console.log(` - ${key}: ${displayValue}`);
        }
      }

      const saveConfig = await promptBoolean(rl, '\nSave configuration?', true);

      if (saveConfig) {
        // Backup existing config
        const backup = this.writer.backup();
        if (backup) {
          console.log(`[OK] Backup created: ${backup}`);
        }

        // Save new configuration
        this.writer.update(allConfig);
        console.log('[OK] Configuration saved successfully!');

        // Reload to verify
        this.loader.reload();
        const newSummary = this.loader.getSummary();
        console.log('\nNew configuration:');
        console.log(` - Default Model: ${newSummary.defaultModel}`);
        console.log(` - Helper Model: ${newSummary.helperModel}`);
        console.log(` - Configured Providers: ${newSummary.providers.length > 0 ? newSummary.providers.join(', ') : 'None'}`);
        console.log(` - Mentorship: ${newSummary.mentorshipEnabled ? 'Enabled' : 'Disabled'}`);
      } else {
        console.log('Configuration not saved.');
      }

    } catch (error: any) {
      console.error(`\n[ERROR] Configuration error: ${error.message}`);
    } finally {
      rl.close();
    }
  }

  /**
   * Quick setup for API keys only
   */
  async quickSetupApiKeys(): Promise<void> {
    const rl = createInterface();

    try {
      console.log('\n' + '='.repeat(60));
      console.log(' Quick API Key Setup');
      console.log('='.repeat(60));
      console.log('\nConfigure your API keys to use different AI providers.\n');

      const config = await configureCategory(rl, 'api_keys', this.loader);

      const saveConfig = await promptBoolean(rl, '\nSave API keys?', true);

      if (saveConfig) {
        this.writer.update(config);
        console.log('[OK] API keys saved successfully!');
      }

    } catch (error: any) {
      console.error(`\n[ERROR] Error: ${error.message}`);
    } finally {
      rl.close();
    }
  }

  /**
   * Quick setup for mentorship
   */
  async quickSetupMentorship(): Promise<void> {
    const rl = createInterface();

    try {
      console.log('\n' + '='.repeat(60));
      console.log(' Quick Mentorship Setup');
      console.log('='.repeat(60));
      console.log('\nConfigure reactive mentorship features.\n');

      const config = await configureCategory(rl, 'mentorship', this.loader);

      const saveConfig = await promptBoolean(rl, '\nSave mentorship configuration?', true);

      if (saveConfig) {
        this.writer.update(config);
        console.log('[OK] Mentorship configuration saved!');
      }

    } catch (error: any) {
      console.error(`\n[ERROR] Error: ${error.message}`);
    } finally {
      rl.close();
    }
  }
}
