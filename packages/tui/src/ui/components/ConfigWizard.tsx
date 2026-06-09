/**
 * ConfigWizard - Interactive configuration setup wizard
 *
 * Guides users through setting up their Cortex CLI configuration
 * with step-by-step prompts and validation.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { ConfigManager, CLIConfig } from '@nexus-cortex/cli/dist/config/ConfigManager.js';

type ConfigStep =
  | 'serverUrl'
  | 'theme'
  | 'timeout'
  | 'maxRetries'
  | 'logLevel'
  | 'review'
  | 'complete';

interface ConfigWizardProps {
  /** Callback when configuration is complete */
  onComplete?: (config: CLIConfig) => void;
  /** Callback when user exits wizard */
  onExit?: () => void;
}

export const ConfigWizard: React.FC<ConfigWizardProps> = ({
  onComplete,
  onExit,
}) => {
  const [currentStep, setCurrentStep] = useState<ConfigStep>('serverUrl');
  const [config, setConfig] = useState<Partial<CLIConfig>>(() => {
    // Load existing config as defaults
    try {
      return ConfigManager.load();
    } catch {
      return {
        serverUrl: 'http://localhost:4000',
        theme: 'default',
        timeout: 30000,
        maxRetries: 3,
        logLevel: 'error'
      };
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Handle Ctrl+C to exit
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onExit?.();
    }
  });

  const handleServerUrlSelect = (item: { value: string }) => {
    setConfig(prev => ({ ...prev, serverUrl: item.value }));
    setCurrentStep('theme');
  };

  const handleThemeSelect = (item: { value: 'default' | 'minimal' }) => {
    setConfig(prev => ({ ...prev, theme: item.value }));
    setCurrentStep('timeout');
  };

  const handleTimeoutSelect = (item: { value: number }) => {
    setConfig(prev => ({ ...prev, timeout: item.value }));
    setCurrentStep('maxRetries');
  };

  const handleMaxRetriesSelect = (item: { value: number }) => {
    setConfig(prev => ({ ...prev, maxRetries: item.value }));
    setCurrentStep('logLevel');
  };

  const handleLogLevelSelect = (item: { value: 'silent' | 'error' | 'info' | 'debug' }) => {
    setConfig(prev => ({ ...prev, logLevel: item.value }));
    setCurrentStep('review');
  };

  const handleReviewSelect = async (item: { value: 'save' | 'edit' | 'cancel' }) => {
    if (item.value === 'save') {
      setSaving(true);
      try {
        await ConfigManager.save(config as CLIConfig);
        setCurrentStep('complete');
        setTimeout(() => {
          onComplete?.(config as CLIConfig);
        }, 1000);
      } catch (err: any) {
        setError(err.message);
        setSaving(false);
      }
    } else if (item.value === 'edit') {
      setCurrentStep('serverUrl');
    } else {
      onExit?.();
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'serverUrl':
        return (
          <Box flexDirection="column">
            <Text color="cyan">Server URL</Text>
            <Box marginTop={1}>
              <Text dimColor>Select the Cortex server URL:</Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: 'http://localhost:4000 (default)', value: 'http://localhost:4000' },
                  { label: 'http://localhost:3000', value: 'http://localhost:3000' },
                  { label: 'http://localhost:5000', value: 'http://localhost:5000' },
                  { label: 'http://localhost:8000', value: 'http://localhost:8000' },
                ]}
                onSelect={handleServerUrlSelect}
                initialIndex={config.serverUrl === 'http://localhost:4000' ? 0 : 0}
              />
            </Box>
          </Box>
        );

      case 'theme':
        return (
          <Box flexDirection="column">
            <Text color="cyan">Color Theme</Text>
            <Box marginTop={1}>
              <Text dimColor>Choose your preferred color scheme:</Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: 'Default - Colorful output with emojis', value: 'default' },
                  { label: 'Minimal - Plain text output', value: 'minimal' },
                ]}
                onSelect={handleThemeSelect}
                initialIndex={config.theme === 'minimal' ? 1 : 0}
              />
            </Box>
          </Box>
        );

      case 'timeout':
        return (
          <Box flexDirection="column">
            <Text color="cyan">Request Timeout</Text>
            <Box marginTop={1}>
              <Text dimColor>Select timeout in milliseconds:</Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: '10 seconds (10000ms)', value: 10000 },
                  { label: '30 seconds (30000ms) - default', value: 30000 },
                  { label: '60 seconds (60000ms)', value: 60000 },
                  { label: '120 seconds (120000ms)', value: 120000 },
                  { label: '300 seconds (300000ms)', value: 300000 },
                ]}
                onSelect={handleTimeoutSelect}
                initialIndex={config.timeout === 30000 ? 1 : config.timeout === 60000 ? 2 : config.timeout === 120000 ? 3 : 1}
              />
            </Box>
          </Box>
        );

      case 'maxRetries':
        return (
          <Box flexDirection="column">
            <Text color="cyan">Max Retry Attempts</Text>
            <Box marginTop={1}>
              <Text dimColor>Select maximum retry attempts for failed requests:</Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: '0 - No retries', value: 0 },
                  { label: '1 - One retry', value: 1 },
                  { label: '2 - Two retries', value: 2 },
                  { label: '3 - Three retries (default)', value: 3 },
                  { label: '5 - Five retries', value: 5 },
                  { label: '10 - Ten retries', value: 10 },
                ]}
                onSelect={handleMaxRetriesSelect}
                initialIndex={config.maxRetries === 0 ? 0 : config.maxRetries === 1 ? 1 : config.maxRetries === 2 ? 2 : config.maxRetries === 3 ? 3 : 3}
              />
            </Box>
          </Box>
        );

      case 'logLevel':
        return (
          <Box flexDirection="column">
            <Text color="cyan">Log Level</Text>
            <Box marginTop={1}>
              <Text dimColor>Choose logging verbosity:</Text>
            </Box>
            <Box marginTop={1}>
              <SelectInput
                items={[
                  { label: 'Silent - No output', value: 'silent' },
                  { label: 'Error - Errors only (default)', value: 'error' },
                  { label: 'Info - Informational messages', value: 'info' },
                  { label: 'Debug - Verbose debugging', value: 'debug' },
                ]}
                onSelect={handleLogLevelSelect}
                initialIndex={
                  config.logLevel === 'silent' ? 0 :
                  config.logLevel === 'error' ? 1 :
                  config.logLevel === 'info' ? 2 : 3
                }
              />
            </Box>
          </Box>
        );

      case 'review':
        return (
          <Box flexDirection="column">
            <Text color="cyan">Review Configuration</Text>
            <Box marginTop={1} flexDirection="column">
              <Text>
                <Text color="green">Server URL:    </Text>
                <Text>{config.serverUrl}</Text>
              </Text>
              <Text>
                <Text color="green">Default Model: </Text>
                <Text>{config.defaultModel || '(none)'}</Text>
              </Text>
              <Text>
                <Text color="green">Theme:         </Text>
                <Text>{config.theme}</Text>
              </Text>
              <Text>
                <Text color="green">Timeout:       </Text>
                <Text>{config.timeout}ms</Text>
              </Text>
              <Text>
                <Text color="green">Max Retries:   </Text>
                <Text>{config.maxRetries}</Text>
              </Text>
              <Text>
                <Text color="green">Log Level:     </Text>
                <Text>{config.logLevel}</Text>
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>What would you like to do?</Text>
            </Box>
            <Box marginTop={1}>
              {saving ? (
                <Text>
                  <Text color="cyan"><Spinner type="dots" /></Text>
                  <Text> Saving configuration...</Text>
                </Text>
              ) : (
                <SelectInput
                  items={[
                    { label: 'Save configuration', value: 'save' },
                    { label: 'Edit values', value: 'edit' },
                    { label: 'Cancel', value: 'cancel' },
                  ]}
                  onSelect={handleReviewSelect}
                />
              )}
            </Box>
          </Box>
        );

      case 'complete':
        return (
          <Box flexDirection="column">
            <Text color="green">✓ Configuration saved successfully!</Text>
            <Box marginTop={1}>
              <Text dimColor>Configuration saved to: {ConfigManager.getConfigPath()}</Text>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta"> Cortex Configuration Wizard</Text>
      </Box>

      {renderStep()}

      {error && (
        <Box marginTop={1}>
          <Text color="red">✗ {error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};
