/**
 * ModelPicker Component
 * Interactive UI for selecting AI models with provider grouping
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import { CortexClient } from '@nexus-cortex/cli/dist/client/CortexClient.js';

export interface Model {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  description?: string;
  pricing?: {
    input: number;
    output: number;
  };
}

export interface ModelPickerProps {
  serverUrl?: string;
  onSelect: (model: Model) => void;
  onExit: () => void;
  currentModel?: string;
}

interface SelectItem {
  label: string;
  value: any;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({
  serverUrl = 'http://localhost:4000',
  onSelect,
  onExit,
  currentModel,
}) => {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  useEffect(() => {
    const client = new CortexClient(serverUrl);

    client
      .get('/models')
      .then((data: any) => {
        // Handle both array and object with models property
        const modelList = Array.isArray(data) ? data : data.models || [];
        setModels(modelList);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [serverUrl]);

  // Group models by provider
  const providerGroups = useMemo(() => {
    const grouped: Record<string, Model[]> = {};
    models.forEach((model) => {
      const provider = model.provider || 'unknown';
      if (!grouped[provider]) {
        grouped[provider] = [];
      }
      grouped[provider].push(model);
    });
    return grouped;
  }, [models]);

  // Loading state
  if (loading) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan">
          <Spinner type="dots" /> Loading models...
        </Text>
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">✗ Error loading models: {error}</Text>
        <Text color="gray" dimColor>
          Press any key to exit
        </Text>
      </Box>
    );
  }

  // No models found
  if (models.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">⚠ No models available</Text>
        <Text color="gray" dimColor>
          Check your API keys configuration
        </Text>
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Press any key to exit
          </Text>
        </Box>
      </Box>
    );
  }

  // Provider selection view
  if (!selectedProvider) {
    const providerItems: SelectItem[] = Object.keys(providerGroups).map((provider) => ({
      label: `${provider} (${(providerGroups[provider] || []).length} models)`,
      value: provider,
    }));

    // Add back/exit option
    providerItems.push({ label: '← Exit', value: null });

    const handleProviderSelect = (item: SelectItem) => {
      if (item.value) {
        setSelectedProvider(item.value);
      } else {
        onExit();
      }
    };

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
           Model Picker - Select Provider
        </Text>
        <Text color="gray" dimColor>
          Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit
        </Text>
        <Box marginTop={1}>
          <SelectInput items={providerItems} onSelect={handleProviderSelect} />
        </Box>
      </Box>
    );
  }

  // Model selection view
  const providerModels = selectedProvider ? (providerGroups[selectedProvider] || []) : [];
  const modelItems: SelectItem[] = providerModels.map((model) => {
    const isCurrent = currentModel === model.id;
    const currentIndicator = isCurrent ? ' (current)' : '';
    const contextInfo = `${(model.contextWindow / 1000).toFixed(0)}K tokens`;

    return {
      label: `${model.name}${currentIndicator} - ${contextInfo}`,
      value: model,
    };
  });

  // Add back option
  modelItems.push({ label: '← Back to providers', value: 'back' });

  const handleModelSelect = (item: SelectItem) => {
    if (item.value === 'back') {
      setSelectedProvider(null);
    } else if (item.value) {
      onSelect(item.value);
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
         Model Picker - {selectedProvider}
      </Text>
      <Text color="gray" dimColor>
        Use ↑/↓ to navigate, Enter to select, Ctrl+C to exit
      </Text>
      <Box marginTop={1}>
        <SelectInput items={modelItems} onSelect={handleModelSelect} />
      </Box>
    </Box>
  );
};
