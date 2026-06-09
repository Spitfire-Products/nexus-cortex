/**
 * Interactive Agent Menu
 *
 * Ink-based terminal UI for managing Task Agent profiles.
 * Provides list view, navigation, CRUD operations, and AI-powered agent creation.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { AgentDefinition } from '@nexus-cortex/core';
import { AgentStore } from '@nexus-cortex/core';
import { InlineEditor } from '../system-message/InlineEditor.js';

/**
 * Menu state
 */
type MenuState =
  | 'list'
  | 'confirm'
  | 'loading'
  | 'editing'
  | 'viewing'
  | 'create-model' // Step 1: Select model
  | 'create-description' // Step 2: Enter initial description
  | 'create-conversation' // Step 3: Multi-turn conversation with AI
  | 'create-generating' // Step 4: AI generating final profile
  | 'edit-model' // Editing agent model
  | 'edit-choice' // Choose between direct edit or AI-assisted
  | 'ai-edit-request' // Enter AI edit request
  | 'ai-edit-processing' // AI processing edit request
  | 'ai-edit-confirm';    // Confirm AI edit changes

/**
 * Conversation message for multi-turn agent creation
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Generated agent profile (from conversational creator)
 */
export interface GeneratedAgentProfile {
  name: string;
  description: string;
  tools: string[] | 'all';
  systemPrompt: string;
}

/**
 * Confirmation prompt types
 */
type ConfirmAction =
  | { type: 'edit'; agentName: string }
  | { type: 'delete'; agentName: string };

/**
 * Model info from registry
 */
export interface ModelInfo {
  id: string;
  displayName?: string;
  owned_by?: string;
  contextWindow?: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  supportsTools?: boolean;
  reasoning?: { supported: boolean };
}

/**
 * Model listing function type
 */
export type ModelListFn = () => Promise<ModelInfo[]>;

/**
 * One-shot agent profile generator function type (legacy)
 */
export type AgentProfileGenerator = (
  description: string,
  model: string
) => Promise<GeneratedAgentProfile>;

/**
 * Conversational response from AI during agent creation
 */
export interface ConversationalAgentResponse {
  /** Response type */
  type: 'question' | 'profile';
  /** Clarifying question to ask the user */
  question?: string;
  /** Final generated profile */
  profile?: GeneratedAgentProfile;
}

/**
 * Conversational agent creator function type
 *
 * Takes the full conversation history and returns either:
 * - A clarifying question (type: 'question')
 * - A final profile (type: 'profile')
 */
export type ConversationalAgentCreator = (
  messages: ConversationMessage[],
  model: string
) => Promise<ConversationalAgentResponse>;

/**
 * Edit assistant function type
 * Takes current content and edit request, returns updated content
 */
export type EditAssistantFn = (
  currentContent: string,
  editRequest: string,
  agentName: string
) => Promise<{ content: string; summary: string }>;

/**
 * Props for InteractiveAgentMenu
 */
export interface InteractiveAgentMenuProps {
  /** Agent store instance */
  store: AgentStore;

  /** Optional initial agent name to select */
  initialAgentName?: string;

  /** Current model ID for inherit option */
  currentModel?: string;

  /** Function to generate agent profile using AI (legacy one-shot) */
  generateAgentProfile?: AgentProfileGenerator;

  /** Function for conversational agent creation with clarifying questions */
  conversationalCreator?: ConversationalAgentCreator;

  /** Function to list available models from registry */
  listModels?: ModelListFn;

  /** Function for AI-assisted editing of existing agents */
  editAssistant?: EditAssistantFn;

  /** Callback when user exits the menu (enables graceful return to CLI) */
  onExit?: () => void;
}

/**
 * Interactive Agent Menu Component
 */
export const InteractiveAgentMenu: React.FC<InteractiveAgentMenuProps> = ({
  store,
  initialAgentName,
  currentModel = 'sonnet',
  generateAgentProfile,
  conversationalCreator,
  listModels,
  editAssistant,
  onExit,
}) => {
  const { exit: inkExit } = useApp();

  // Use onExit callback if provided (for graceful return to CLI), otherwise fall back to Ink's exit
  const handleExit = () => {
    if (onExit) {
      onExit();
    } else {
      inkExit();
    }
  };
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuState, setMenuState] = useState<MenuState>('list');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Editing state
  const [editingAgent, setEditingAgent] = useState<AgentDefinition | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [editingFilePath, setEditingFilePath] = useState<string>('');

  // Edit choice state (direct vs AI-assisted)
  const [editChoiceIndex, setEditChoiceIndex] = useState(0);
  const [selectedAgentForEdit, setSelectedAgentForEdit] = useState<AgentDefinition | null>(null);

  // AI edit state
  const [aiEditRequest, setAiEditRequest] = useState<string>('');
  const [aiEditResult, setAiEditResult] = useState<{ content: string; summary: string } | null>(null);
  const [aiEditOriginalContent, setAiEditOriginalContent] = useState<string>('');

  // Viewing state
  const [viewingAgent, setViewingAgent] = useState<AgentDefinition | null>(null);

  // Model registry state
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelFilter, setModelFilter] = useState<string>('');
  const [modelSelectIndex, setModelSelectIndex] = useState(0);

  // Creation wizard state
  const [createSelectedModel, setCreateSelectedModel] = useState<string>('');
  const [createDescription, setCreateDescription] = useState<string>('');
  const [generatingMessage, setGeneratingMessage] = useState<string>('');

  // Conversation state for multi-turn agent creation
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationInput, setConversationInput] = useState<string>('');
  const [conversationThinking, setConversationThinking] = useState<boolean>(false);

  // For editing agent model
  const [editingAgentForModel, setEditingAgentForModel] = useState<AgentDefinition | null>(null);

  // Load agents on mount
  useEffect(() => {
    loadAgents();

    // Subscribe to store changes for hot-reload
    const listener = () => {
      loadAgents();
    };

    store.onChange(listener);

    return () => {
      store.removeChangeListener(listener);
    };
  }, []);

  // Set initial selection
  useEffect(() => {
    if (initialAgentName && agents.length > 0) {
      const index = agents.findIndex((a) => a.name === initialAgentName);
      if (index !== -1) {
        setSelectedIndex(index);
      }
    }
  }, [agents, initialAgentName]);

  // Load models when entering model selection mode
  useEffect(() => {
    if ((menuState === 'create-model' || menuState === 'edit-model') && listModels && availableModels.length === 0) {
      setModelsLoading(true);
      listModels()
        .then((models) => {
          setAvailableModels(models);
          setModelsLoading(false);
        })
        .catch((err) => {
          setErrorMessage(`Failed to load models: ${err.message}`);
          setModelsLoading(false);
        });
    }
  }, [menuState, listModels]);

  // Reset model selection index when filter changes
  useEffect(() => {
    setModelSelectIndex(0);
  }, [modelFilter]);

  // Compute filtered models based on filter text
  const filteredModels = useMemo(() => {
    // Add "inherit" option at the top
    const inheritOption: ModelInfo = {
      id: 'inherit',
      displayName: `Inherit (${currentModel})`,
      owned_by: 'session',
    };

    const allModels = [inheritOption, ...availableModels];

    if (!modelFilter.trim()) {
      return allModels;
    }

    const lowerFilter = modelFilter.toLowerCase();
    return allModels.filter((m) => {
      const idMatch = m.id.toLowerCase().includes(lowerFilter);
      const nameMatch = m.displayName?.toLowerCase().includes(lowerFilter);
      const providerMatch = m.owned_by?.toLowerCase().includes(lowerFilter);
      return idMatch || nameMatch || providerMatch;
    });
  }, [availableModels, modelFilter, currentModel]);

  // Max visible models in the list (for scrolling)
  const MAX_VISIBLE_MODELS = 15;

  /**
   * Load agents from store
   */
  const loadAgents = () => {
    const allAgents = store.getAll();
    // Sort by location (project first), then by name
    allAgents.sort((a: AgentDefinition, b: AgentDefinition) => {
      if (a.location !== b.location) {
        return a.location === 'project' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    setAgents(allAgents);
  };

  /**
   * Get currently selected agent
   */
  const selectedAgent = agents[selectedIndex];

  /**
   * Handle keyboard input
   */
  useInput((input, key) => {
    // Loading/generating state - block all input
    if (menuState === 'loading' || menuState === 'create-generating') {
      return;
    }

    // Viewing mode - any key returns to list
    if (menuState === 'viewing') {
      setMenuState('list');
      setViewingAgent(null);
      return;
    }

    // Model selection step (for creation or editing)
    if (menuState === 'create-model' || menuState === 'edit-model') {
      // Model selection uses TextInput for filtering, so only handle navigation keys here
      // TextInput handles text entry
      return;
    }

    // Confirmation prompt state
    if (menuState === 'confirm' && confirmAction) {
      if (input.toLowerCase() === 'y') {
        executeConfirmedAction(confirmAction);
        setMenuState('list');
        setConfirmAction(null);
      } else if (input.toLowerCase() === 'n' || key.escape) {
        setMenuState('list');
        setConfirmAction(null);
        setStatusMessage('Action cancelled');
      }
      return;
    }

    // List navigation state
    if (menuState === 'list') {
      // Navigation
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        setStatusMessage('');
        setErrorMessage('');
      } else if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(agents.length - 1, prev + 1));
        setStatusMessage('');
        setErrorMessage('');
      }

      // Actions
      else if (key.return && selectedAgent) {
        // Start edit flow - first confirm/change model
        setEditingAgentForModel(selectedAgent);
        setSelectedAgentForEdit(selectedAgent);
        setModelFilter('');
        setModelSelectIndex(0);
        setMenuState('edit-model');
      } else if (input === ' ' && selectedAgent) {
        // View details
        handleView(selectedAgent.name);
      } else if (input === '+' || input.toLowerCase() === 'n') {
        // Start creation wizard
        setModelFilter('');
        setModelSelectIndex(0);
        setCreateSelectedModel('');
        setCreateDescription('');
        setMenuState('create-model');
      } else if (input.toLowerCase() === 'm' && selectedAgent) {
        // Edit agent's model
        setEditingAgentForModel(selectedAgent);
        setModelFilter('');
        setModelSelectIndex(0);
        setMenuState('edit-model');
      } else if (input.toLowerCase() === 'd' && selectedAgent) {
        // Delete agent
        setConfirmAction({ type: 'delete', agentName: selectedAgent.name });
        setMenuState('confirm');
      } else if (input.toLowerCase() === 'q' || key.escape) {
        // Quit - use handleExit for graceful return to CLI
        handleExit();
      }
    }
  }, { isActive: menuState !== 'editing' && menuState !== 'create-description' && menuState !== 'create-model' && menuState !== 'edit-model' && menuState !== 'create-conversation' && menuState !== 'edit-choice' && menuState !== 'ai-edit-request' && menuState !== 'ai-edit-processing' && menuState !== 'ai-edit-confirm' });

  /**
   * Handle keyboard input for model selection (arrow keys and escape)
   */
  useInput((_input, key) => {
    if (key.upArrow) {
      setModelSelectIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setModelSelectIndex((prev) => Math.min(filteredModels.length - 1, prev + 1));
    } else if (key.escape) {
      handleModelSelectionCancel();
    }
  }, { isActive: menuState === 'create-model' || menuState === 'edit-model' });

  /**
   * Handle keyboard input for conversation mode (escape to cancel)
   */
  useInput((_input, key) => {
    if (key.escape && !conversationThinking) {
      handleConversationCancel();
    }
  }, { isActive: menuState === 'create-conversation' });

  /**
   * Handle keyboard input for edit choice state
   */
  useInput((_input, key) => {
    if (key.upArrow || key.downArrow) {
      setEditChoiceIndex((prev) => (prev === 0 ? 1 : 0));
    } else if (key.return) {
      if (editChoiceIndex === 0 && selectedAgentForEdit) {
        // Direct edit
        handleDirectEdit(selectedAgentForEdit.name);
      } else if (editChoiceIndex === 1 && selectedAgentForEdit) {
        // AI-assisted edit
        handleAiEditStart(selectedAgentForEdit.name);
      }
    } else if (key.escape) {
      setSelectedAgentForEdit(null);
      setMenuState('list');
    }
  }, { isActive: menuState === 'edit-choice' });

  /**
   * Handle keyboard input for AI edit request state (escape to cancel)
   */
  useInput((_input, key) => {
    if (key.escape) {
      handleAiEditCancel();
    }
  }, { isActive: menuState === 'ai-edit-request' });

  /**
   * Handle keyboard input for AI edit confirm state
   */
  useInput((input, key) => {
    if (input.toLowerCase() === 'y' || key.return) {
      handleAiEditConfirm();
    } else if (input.toLowerCase() === 'n' || key.escape) {
      handleAiEditReject();
    }
  }, { isActive: menuState === 'ai-edit-confirm' });

  /**
   * Handle description submission - starts conversation or generates directly
   */
  const handleDescriptionSubmit = async () => {
    if (!createDescription.trim()) {
      setErrorMessage('Please enter a description for your agent');
      return;
    }

    setErrorMessage('');

    // If conversational creator is available, start the conversation flow
    if (conversationalCreator) {
      const initialMessage: ConversationMessage = {
        role: 'user',
        content: createDescription,
      };
      setConversationMessages([initialMessage]);
      setConversationThinking(true);
      setMenuState('create-conversation');

      // Get first AI response (likely a clarifying question)
      try {
        const response = await conversationalCreator([initialMessage], createSelectedModel);
        setConversationThinking(false);

        if (response.type === 'profile' && response.profile) {
          // AI generated profile directly without questions
          await createAgentFromProfile(response.profile);
        } else if (response.type === 'question' && response.question) {
          // AI is asking a clarifying question
          const questionText = response.question; // Capture as string
          setConversationMessages((prev) => [
            ...prev,
            { role: 'assistant' as const, content: questionText },
          ]);
        }
      } catch (error: any) {
        setConversationThinking(false);
        setErrorMessage(`AI error: ${error.message}`);
        setMenuState('list');
      }
      return;
    }

    // Fallback to legacy one-shot generation
    setMenuState('create-generating');
    setGeneratingMessage('Generating agent profile...');

    try {
      let profile: GeneratedAgentProfile;

      if (generateAgentProfile) {
        // Use AI to generate the profile
        profile = await generateAgentProfile(createDescription, createSelectedModel);
      } else {
        // Fallback: Create a basic profile
        const safeName = createDescription
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 32) || `agent-${Date.now()}`;

        profile = {
          name: safeName,
          description: createDescription.slice(0, 200),
          tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash'],
          systemPrompt: `# ${safeName}\n\n${createDescription}\n\n## Your Role\n\nYou are a specialized agent. Follow the user's instructions carefully.\n\n## Guidelines\n\n- Be thorough and methodical\n- Explain your reasoning\n- Ask for clarification if needed`,
        };
      }

      await createAgentFromProfile(profile);
    } catch (error: any) {
      setErrorMessage(`Failed to create agent: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Handle user response in conversation flow
   */
  const handleConversationSubmit = async () => {
    if (!conversationInput.trim() || !conversationalCreator) {
      return;
    }

    // Add user message to conversation
    const userMessage: ConversationMessage = {
      role: 'user',
      content: conversationInput,
    };
    const updatedMessages = [...conversationMessages, userMessage];
    setConversationMessages(updatedMessages);
    setConversationInput('');
    setConversationThinking(true);
    setErrorMessage('');

    try {
      const response = await conversationalCreator(updatedMessages, createSelectedModel);
      setConversationThinking(false);

      if (response.type === 'profile' && response.profile) {
        // AI generated the final profile
        await createAgentFromProfile(response.profile);
      } else if (response.type === 'question' && response.question) {
        // AI is asking another clarifying question
        const questionText = response.question; // Capture as string
        setConversationMessages((prev) => [
          ...prev,
          { role: 'assistant' as const, content: questionText },
        ]);
      }
    } catch (error: any) {
      setConversationThinking(false);
      setErrorMessage(`AI error: ${error.message}`);
    }
  };

  /**
   * Create agent from generated profile
   */
  const createAgentFromProfile = async (profile: GeneratedAgentProfile) => {
    setMenuState('create-generating');
    setGeneratingMessage('Saving agent...');

    try {
      await store.createAgent({
        name: profile.name,
        description: profile.description,
        tools: profile.tools,
        model: createSelectedModel,
        systemPrompt: profile.systemPrompt,
        location: 'project',
      });

      setStatusMessage(`Created agent '${profile.name}' successfully!`);
      loadAgents();

      // Select the new agent
      setTimeout(() => {
        const newIndex = store.getAll().findIndex((a: AgentDefinition) => a.name === profile.name);
        if (newIndex !== -1) {
          setSelectedIndex(newIndex);
        }
      }, 100);

      // Reset all creation state
      resetCreationState();
      setMenuState('list');
    } catch (error: any) {
      setErrorMessage(`Failed to create agent: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Reset all creation-related state
   */
  const resetCreationState = () => {
    setModelFilter('');
    setModelSelectIndex(0);
    setCreateSelectedModel('');
    setCreateDescription('');
    setConversationMessages([]);
    setConversationInput('');
    setConversationThinking(false);
    setGeneratingMessage('');
  };

  /**
   * Cancel conversation and return to list
   */
  const handleConversationCancel = () => {
    resetCreationState();
    setMenuState('list');
  };

  /**
   * Handle model selection for creation
   */
  const handleModelSelect = (modelId: string) => {
    const resolvedModel = modelId === 'inherit' ? currentModel : modelId;
    setCreateSelectedModel(resolvedModel);
    setModelFilter('');
    setModelSelectIndex(0);
    setMenuState('create-description');
  };

  /**
   * Handle model change for existing agent
   */
  const handleAgentModelChange = async (modelId: string) => {
    if (!editingAgentForModel) return;

    const resolvedModel = modelId === 'inherit' ? currentModel : modelId;
    const isEditFlow = selectedAgentForEdit !== null;

    try {
      // Read current content and update model in frontmatter
      const content = await store.getAgentContent(editingAgentForModel.name);

      // Replace model in YAML frontmatter
      const updatedContent = content.replace(
        /^(model:\s*).+$/m,
        `$1${resolvedModel}`
      );

      await store.updateAgent(editingAgentForModel.name, updatedContent);

      setStatusMessage(`Model ${isEditFlow ? 'confirmed' : 'changed'}: '${resolvedModel}'`);
      loadAgents();
    } catch (error: any) {
      setErrorMessage(`Failed to update model: ${error.message}`);
    }

    // Reset model selection state
    setEditingAgentForModel(null);
    setModelFilter('');
    setModelSelectIndex(0);

    // If in edit flow, proceed to edit choice; otherwise return to list
    if (isEditFlow) {
      setEditChoiceIndex(0);
      setMenuState('edit-choice');
    } else {
      setMenuState('list');
    }
  };

  /**
   * Handle model filter input change
   */
  const handleModelFilterChange = (value: string) => {
    setModelFilter(value);
  };

  /**
   * Handle model filter submit (Enter key)
   */
  const handleModelFilterSubmit = () => {
    // If filter matches exactly one model or user typed full ID, select it
    const exactMatch = filteredModels.find((m) => m.id.toLowerCase() === modelFilter.toLowerCase());

    if (exactMatch) {
      if (menuState === 'create-model') {
        handleModelSelect(exactMatch.id);
      } else if (menuState === 'edit-model') {
        handleAgentModelChange(exactMatch.id);
      }
    } else if (filteredModels.length > 0 && modelSelectIndex < filteredModels.length) {
      // Select the highlighted model
      const selected = filteredModels[modelSelectIndex];
      if (selected) {
        if (menuState === 'create-model') {
          handleModelSelect(selected.id);
        } else if (menuState === 'edit-model') {
          handleAgentModelChange(selected.id);
        }
      }
    } else {
      setErrorMessage('No matching model found');
    }
  };

  /**
   * Cancel model selection
   */
  const handleModelSelectionCancel = () => {
    setModelFilter('');
    setModelSelectIndex(0);
    setEditingAgentForModel(null);
    setSelectedAgentForEdit(null); // Clear edit flow state
    setMenuState('list');
  };

  /**
   * Execute confirmed action
   */
  const executeConfirmedAction = async (action: ConfirmAction) => {
    setMenuState('loading');
    setStatusMessage('');
    setErrorMessage('');

    try {
      switch (action.type) {
        case 'edit':
          await handleEdit(action.agentName);
          break;
        case 'delete':
          await handleDelete(action.agentName);
          break;
      }
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setMenuState('list');
    }
  };

  /**
   * Handle edit action - opens inline editor (legacy, used by confirmation flow)
   */
  const handleEdit = async (agentName: string) => {
    const agent = store.getAgent(agentName);
    if (!agent) {
      setErrorMessage(`Agent '${agentName}' not found`);
      return;
    }

    try {
      const content = await store.getAgentContent(agentName);

      // Set editing state and open inline editor
      setEditingAgent(agent);
      setEditingContent(content);
      setEditingFilePath(agent.filePath);
      setMenuState('editing');
    } catch (error: any) {
      setErrorMessage(`Failed to load agent: ${error.message}`);
    }
  };

  /**
   * Handle direct edit action - opens inline editor
   */
  const handleDirectEdit = async (agentName: string) => {
    const agent = store.getAgent(agentName);
    if (!agent) {
      setErrorMessage(`Agent '${agentName}' not found`);
      return;
    }

    try {
      const content = await store.getAgentContent(agentName);

      // Clear edit choice state
      setSelectedAgentForEdit(null);

      // Set editing state and open inline editor
      setEditingAgent(agent);
      setEditingContent(content);
      setEditingFilePath(agent.filePath);
      setMenuState('editing');
    } catch (error: any) {
      setErrorMessage(`Failed to load agent: ${error.message}`);
    }
  };

  /**
   * Handle AI edit start - shows the request input
   */
  const handleAiEditStart = async (agentName: string) => {
    const agent = store.getAgent(agentName);
    if (!agent) {
      setErrorMessage(`Agent '${agentName}' not found`);
      setMenuState('list');
      return;
    }

    if (!editAssistant) {
      setErrorMessage('AI edit assistant not available');
      setMenuState('list');
      return;
    }

    try {
      const content = await store.getAgentContent(agentName);

      // Store original content for AI edit flow
      setAiEditOriginalContent(content);
      setAiEditRequest('');
      setAiEditResult(null);
      setMenuState('ai-edit-request');
    } catch (error: any) {
      setErrorMessage(`Failed to load agent: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Handle AI edit request submission
   */
  const handleAiEditSubmit = async () => {
    if (!aiEditRequest.trim() || !selectedAgentForEdit || !editAssistant) {
      return;
    }

    setErrorMessage('');
    setMenuState('ai-edit-processing');

    try {
      const result = await editAssistant(
        aiEditOriginalContent,
        aiEditRequest,
        selectedAgentForEdit.name
      );

      setAiEditResult(result);
      setMenuState('ai-edit-confirm');
    } catch (error: any) {
      setErrorMessage(`AI edit failed: ${error.message}`);
      setMenuState('ai-edit-request');
    }
  };

  /**
   * Handle AI edit confirmation - save the changes
   */
  const handleAiEditConfirm = async () => {
    if (!aiEditResult || !selectedAgentForEdit) {
      return;
    }

    try {
      await store.updateAgent(selectedAgentForEdit.name, aiEditResult.content);

      setStatusMessage(`Agent '${selectedAgentForEdit.name}' updated: ${aiEditResult.summary}`);
      loadAgents();

      // Reset state
      handleAiEditReset();
      setMenuState('list');
    } catch (error: any) {
      setErrorMessage(`Failed to save: ${error.message}`);
      setMenuState('ai-edit-confirm');
    }
  };

  /**
   * Handle AI edit rejection - discard changes
   */
  const handleAiEditReject = () => {
    setAiEditResult(null);
    setMenuState('ai-edit-request');
    setStatusMessage('Changes discarded. Try a different edit request.');
  };

  /**
   * Handle AI edit cancel - return to list
   */
  const handleAiEditCancel = () => {
    handleAiEditReset();
    setMenuState('list');
  };

  /**
   * Reset all AI edit state
   */
  const handleAiEditReset = () => {
    setSelectedAgentForEdit(null);
    setAiEditRequest('');
    setAiEditResult(null);
    setAiEditOriginalContent('');
  };

  /**
   * Handle view action - show agent details
   */
  const handleView = async (agentName: string) => {
    const agent = store.getAgent(agentName);
    if (!agent) {
      setErrorMessage(`Agent '${agentName}' not found`);
      return;
    }

    setViewingAgent(agent);
    setMenuState('viewing');
  };

  /**
   * Handle save from inline editor
   */
  const handleEditorSave = async (newContent: string) => {
    if (!editingFilePath || !editingAgent) {
      return;
    }

    try {
      await store.updateAgent(editingAgent.name, newContent);

      setStatusMessage(`Agent '${editingAgent.name}' saved successfully`);
      setMenuState('list');

      // Clear editing state
      setEditingAgent(null);
      setEditingContent('');
      setEditingFilePath('');

      // Reload agents
      loadAgents();
    } catch (error: any) {
      setErrorMessage(`Failed to save: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Handle cancel from inline editor
   */
  const handleEditorCancel = () => {
    setMenuState('list');

    // Clear editing state
    setEditingAgent(null);
    setEditingContent('');
    setEditingFilePath('');
  };

  /**
   * Handle delete action
   */
  const handleDelete = async (agentName: string) => {
    try {
      await store.deleteAgent(agentName);
      setStatusMessage(`Agent '${agentName}' deleted`);
      loadAgents();

      // Adjust selection if needed
      if (selectedIndex >= agents.length - 1) {
        setSelectedIndex(Math.max(0, agents.length - 2));
      }
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  /**
   * Render model selection step (for both creation and editing)
   */
  const renderModelSelection = () => {
    const isEditing = menuState === 'edit-model';
    const title = isEditing
      ? `Change Model for '${editingAgentForModel?.name}'`
      : 'Step 1: Select Model';

    // Calculate visible range for scrolling
    const startIndex = Math.max(0, modelSelectIndex - Math.floor(MAX_VISIBLE_MODELS / 2));
    const endIndex = Math.min(filteredModels.length, startIndex + MAX_VISIBLE_MODELS);
    const visibleModels = filteredModels.slice(startIndex, endIndex);

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{title}</Text>
        </Box>

        {/* Loading state */}
        {modelsLoading && (
          <Box marginBottom={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
            <Text> Loading models...</Text>
          </Box>
        )}

        {/* Filter/search input */}
        {!modelsLoading && (
          <>
            <Box marginBottom={1}>
              <Text dimColor>Type to filter or enter model ID:</Text>
            </Box>

            <Box borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
              <Text color="cyan">{'>'} </Text>
              <TextInput
                value={modelFilter}
                onChange={handleModelFilterChange}
                onSubmit={handleModelFilterSubmit}
                placeholder="e.g., sonnet, opus, gemini, grok..."
              />
            </Box>

            {/* Model count */}
            <Box marginBottom={1}>
              <Text dimColor>
                Showing {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''}
                {modelFilter && ` matching "${modelFilter}"`}
                {filteredModels.length > MAX_VISIBLE_MODELS && ` (scroll with arrow keys)`}
              </Text>
            </Box>

            {/* Model list */}
            <Box flexDirection="column" marginBottom={1}>
              {visibleModels.length === 0 ? (
                <Box>
                  <Text color="yellow">No models match your filter</Text>
                </Box>
              ) : (
                visibleModels.map((model, displayIndex) => {
                  const actualIndex = startIndex + displayIndex;
                  const isSelected = actualIndex === modelSelectIndex;
                  const providerLabel = model.owned_by ? `[${model.owned_by}]` : '';
                  const displayName = model.displayName || model.id;
                  const contextInfo = model.contextWindow
                    ? `${Math.round(model.contextWindow / 1000)}k ctx`
                    : '';
                  const costInfo = model.inputCostPer1M !== undefined
                    ? `$${model.inputCostPer1M.toFixed(2)}/$${model.outputCostPer1M?.toFixed(2) || '?'}`
                    : '';
                  const reasoningBadge = model.reasoning?.supported ? ' [R]' : '';

                  return (
                    <Box key={model.id} paddingLeft={isSelected ? 0 : 2}>
                      {isSelected && <Text color="cyan" bold>{'> '}</Text>}
                      <Text dimColor>{providerLabel} </Text>
                      <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                        {displayName}
                      </Text>
                      <Text color="yellow">{reasoningBadge}</Text>
                      {contextInfo && <Text dimColor> ({contextInfo})</Text>}
                      {costInfo && <Text dimColor> {costInfo}</Text>}
                    </Box>
                  );
                })
              )}
            </Box>

            {/* Scroll indicators */}
            {filteredModels.length > MAX_VISIBLE_MODELS && (
              <Box marginBottom={1}>
                <Text dimColor>
                  {startIndex > 0 ? '↑ more above ' : ''}
                  {endIndex < filteredModels.length ? '↓ more below' : ''}
                </Text>
              </Box>
            )}

            {errorMessage && (
              <Box marginBottom={1}>
                <Text color="red">{'!'} {errorMessage}</Text>
              </Box>
            )}

            <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
              <Text dimColor>
                Type: Filter | ↑/↓: Navigate | Enter: Select | Esc: Cancel
              </Text>
            </Box>
          </>
        )}
      </Box>
    );
  };

  /**
   * Render description input step
   */
  const renderDescriptionInput = () => {
    // Find the selected model info
    const selectedModelInfo = availableModels.find((m) => m.id === createSelectedModel);
    const modelDisplayName = selectedModelInfo?.displayName || createSelectedModel;

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Step 2: Describe Your Agent</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Model: </Text>
          <Text color="green">{modelDisplayName}</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text>Please describe your new agent. Be as descriptive as possible:</Text>
          <Text dimColor>(What should it do? What's its specialty? How should it behave?)</Text>
        </Box>

        <Box borderStyle="single" borderColor="cyan" paddingX={1} paddingY={0}>
          <TextInput
            value={createDescription}
            onChange={setCreateDescription}
            onSubmit={handleDescriptionSubmit}
            placeholder="E.g., A security auditor that reviews code for vulnerabilities, checks for OWASP top 10 issues, and provides remediation advice..."
          />
        </Box>

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}

        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor>
            Enter: Generate Agent | Esc: Cancel
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render generating state
   */
  const renderGenerating = () => {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Creating Your Agent</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> {generatingMessage}</Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>The AI is generating a detailed agent profile based on your description...</Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render conversation mode - multi-turn agent creation
   */
  const renderConversation = () => {
    // Find the selected model info
    const selectedModelInfo = availableModels.find((m) => m.id === createSelectedModel);
    const modelDisplayName = selectedModelInfo?.displayName || createSelectedModel;

    return (
      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">Creating Agent - Conversation</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Model: </Text>
          <Text color="green">{modelDisplayName}</Text>
          <Text dimColor> | Answer the AI's questions to refine your agent</Text>
        </Box>

        {/* Conversation history */}
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
          marginBottom={1}
        >
          {conversationMessages.map((msg, index) => (
            <Box key={index} marginBottom={index < conversationMessages.length - 1 ? 1 : 0}>
              {msg.role === 'user' ? (
                <Box>
                  <Text color="blue" bold>You: </Text>
                  <Text>{msg.content}</Text>
                </Box>
              ) : (
                <Box>
                  <Text color="magenta" bold>AI: </Text>
                  <Text>{msg.content}</Text>
                </Box>
              )}
            </Box>
          ))}

          {/* Thinking indicator */}
          {conversationThinking && (
            <Box marginTop={1}>
              <Text color="cyan">
                <Spinner type="dots" />
              </Text>
              <Text dimColor> AI is thinking...</Text>
            </Box>
          )}
        </Box>

        {/* Input for user response */}
        {!conversationThinking && (
          <Box borderStyle="single" borderColor="cyan" paddingX={1}>
            <Text color="cyan">{'>'} </Text>
            <TextInput
              value={conversationInput}
              onChange={setConversationInput}
              onSubmit={handleConversationSubmit}
              placeholder="Type your response..."
            />
          </Box>
        )}

        {/* Error message */}
        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}

        {/* Help text */}
        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor>
            Enter: Submit response | Esc: Cancel creation
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render confirmation prompt
   */
  const renderConfirmation = () => {
    if (!confirmAction) return null;

    let promptText = '';
    let warningText = '';

    switch (confirmAction.type) {
      case 'edit':
        promptText = `Edit agent '${confirmAction.agentName}'?`;
        break;
      case 'delete':
        promptText = `Delete agent '${confirmAction.agentName}'?`;
        warningText = 'This action cannot be undone.';
        break;
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="yellow">Confirmation Required</Text>
        </Box>
        <Box marginBottom={warningText ? 1 : 0}>
          <Text>{promptText}</Text>
        </Box>
        {warningText && (
          <Box marginBottom={1}>
            <Text dimColor>{warningText}</Text>
          </Box>
        )}
        <Box>
          <Text>
            Press <Text bold color="green">Y</Text> to confirm, <Text bold color="red">N</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render edit choice dialog
   */
  const renderEditChoice = () => {
    if (!selectedAgentForEdit) return null;

    const choices = [
      { label: 'Edit directly', description: 'Open in text editor' },
      { label: 'AI-assisted edit', description: 'Describe changes in natural language' },
    ];

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Edit Agent: {selectedAgentForEdit.name}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text>How would you like to edit this agent?</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {choices.map((choice, index) => {
            const isSelected = index === editChoiceIndex;
            return (
              <Box key={index} paddingLeft={isSelected ? 0 : 2}>
                {isSelected && <Text color="cyan" bold>{'> '}</Text>}
                <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                  {choice.label}
                </Text>
                <Text dimColor> - {choice.description}</Text>
              </Box>
            );
          })}
        </Box>

        {!editAssistant && editChoiceIndex === 1 && (
          <Box marginBottom={1}>
            <Text color="yellow">{'!'} AI assistant not available</Text>
          </Box>
        )}

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>
            ↑/↓: Select | Enter: Confirm | Esc: Cancel
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render AI edit request input
   */
  const renderAiEditRequest = () => {
    if (!selectedAgentForEdit) return null;

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">AI-Assisted Edit: {selectedAgentForEdit.name}</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text>Describe the changes you'd like to make:</Text>
          <Text dimColor>(e.g., "add error handling guidelines", "make it focus on TypeScript", "add a code review checklist")</Text>
        </Box>

        <Box borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan">{'>'} </Text>
          <TextInput
            value={aiEditRequest}
            onChange={setAiEditRequest}
            onSubmit={handleAiEditSubmit}
            placeholder="Describe your changes..."
          />
        </Box>

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}

        {statusMessage && (
          <Box marginTop={1}>
            <Text color="green">{'>'} {statusMessage}</Text>
          </Box>
        )}

        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor>
            Enter: Submit | Esc: Cancel
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render AI edit processing state
   */
  const renderAiEditProcessing = () => {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">AI-Assisted Edit</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Processing your edit request...</Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>The AI is updating the agent based on your description...</Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render AI edit confirmation
   */
  const renderAiEditConfirm = () => {
    if (!aiEditResult || !selectedAgentForEdit) return null;

    // Show a preview of the changes (first ~500 chars of content)
    const preview = aiEditResult.content.slice(0, 500);
    const truncated = aiEditResult.content.length > 500;

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Review AI Changes: {selectedAgentForEdit.name}</Text>
        </Box>

        <Box marginBottom={1}>
          <Text bold color="green">Summary: </Text>
          <Text>{aiEditResult.summary}</Text>
        </Box>

        <Box
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={1}
          marginBottom={1}
          flexDirection="column"
        >
          <Text bold dimColor>Updated Content Preview:</Text>
          <Text>{preview}</Text>
          {truncated && <Text dimColor>... (truncated)</Text>}
        </Box>

        <Box marginBottom={1}>
          <Text>Accept these changes?</Text>
        </Box>

        <Box>
          <Text>
            Press <Text bold color="green">Y</Text> to save, <Text bold color="red">N</Text> to try again
          </Text>
        </Box>

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}
      </Box>
    );
  };

  /**
   * Render agent list
   */
  const renderList = () => {
    if (agents.length === 0) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>No agents found</Text>
          <Box marginTop={1}>
            <Text>Press <Text bold color="cyan">+</Text> or <Text bold color="cyan">N</Text> to create a new agent</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Agents directory: {store.getProjectDir()}</Text>
          </Box>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        {agents.map((agent, index) => {
          const isSelected = index === selectedIndex;
          const locationIcon = agent.location === 'project' ? '[P]' : '[G]';
          const toolsInfo = agent.tools === 'all' ? 'all tools' : `${agent.tools.length} tools`;

          return (
            <Box key={agent.name} paddingLeft={isSelected ? 0 : 2}>
              {isSelected && <Text color="cyan" bold>{'> '}</Text>}
              <Text dimColor>{locationIcon}</Text>
              <Text> </Text>
              <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                {agent.name}
              </Text>
              <Text dimColor> ({agent.model}, {toolsInfo})</Text>
            </Box>
          );
        })}
      </Box>
    );
  };

  /**
   * Render agent detail view
   */
  const renderDetail = () => {
    if (!viewingAgent) return null;

    const toolsList = viewingAgent.tools === 'all'
      ? 'All tools'
      : viewingAgent.tools.join(', ');

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="cyan">{viewingAgent.name}</Text>
            <Text dimColor> ({viewingAgent.location})</Text>
          </Box>

          <Box marginBottom={1}>
            <Text bold>Description: </Text>
            <Text>{viewingAgent.description}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text bold>Model: </Text>
            <Text>{viewingAgent.model}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text bold>Tools: </Text>
            <Text>{toolsList}</Text>
          </Box>

          <Box marginBottom={1}>
            <Text bold>File: </Text>
            <Text dimColor>{viewingAgent.filePath}</Text>
          </Box>

          <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
            <Box flexDirection="column">
              <Text bold dimColor>System Prompt Preview:</Text>
              <Text>
                {viewingAgent.systemPrompt.slice(0, 500)}
                {viewingAgent.systemPrompt.length > 500 ? '...' : ''}
              </Text>
            </Box>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Press any key to return to list</Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render status bar
   */
  const renderStatusBar = () => {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Box justifyContent="space-between">
          <Text dimColor>
            ↑/↓: Navigate | Enter: Edit | Space: View | +/N: New | M: Model | D: Delete | Q: Quit
          </Text>
        </Box>

        {statusMessage && (
          <Box marginTop={1}>
            <Text color="green">{'>'} {statusMessage}</Text>
          </Box>
        )}

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}

        {selectedAgent && (
          <Box marginTop={1}>
            <Text dimColor>
              Selected: {selectedAgent.name} | Location: {selectedAgent.location} |
              {' '}Model: {selectedAgent.model}
            </Text>
          </Box>
        )}
      </Box>
    );
  };

  /**
   * Main render
   */
  return (
    <Box flexDirection="column" padding={menuState === 'editing' ? 0 : 1}>
      {/* Inline editor mode */}
      {menuState === 'editing' && editingContent && editingFilePath && (
        <InlineEditor
          content={editingContent}
          filePath={editingFilePath}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
        />
      )}

      {/* Normal menu views */}
      {menuState !== 'editing' && (
        <>
          {/* Header */}
          <Box borderStyle="bold" borderColor="cyan" paddingX={1}>
            <Text bold color="cyan">Task Agent Manager</Text>
            <Text> </Text>
            <Text dimColor>({agents.length} agents)</Text>
          </Box>

          {/* Loading spinner */}
          {menuState === 'loading' && (
            <Box marginTop={1}>
              <Text color="cyan">
                <Spinner type="dots" />
              </Text>
              <Text> Processing...</Text>
            </Box>
          )}

          {/* Creation wizard - Model selection */}
          {menuState === 'create-model' && renderModelSelection()}

          {/* Edit agent model */}
          {menuState === 'edit-model' && renderModelSelection()}

          {/* Creation wizard - Description input */}
          {menuState === 'create-description' && renderDescriptionInput()}

          {/* Creation wizard - Conversation mode */}
          {menuState === 'create-conversation' && renderConversation()}

          {/* Creation wizard - Generating */}
          {menuState === 'create-generating' && renderGenerating()}

          {/* Confirmation prompt */}
          {menuState === 'confirm' && renderConfirmation()}

          {/* Edit choice dialog */}
          {menuState === 'edit-choice' && renderEditChoice()}

          {/* AI edit request input */}
          {menuState === 'ai-edit-request' && renderAiEditRequest()}

          {/* AI edit processing */}
          {menuState === 'ai-edit-processing' && renderAiEditProcessing()}

          {/* AI edit confirmation */}
          {menuState === 'ai-edit-confirm' && renderAiEditConfirm()}

          {/* Agent detail view */}
          {menuState === 'viewing' && renderDetail()}

          {/* Agent list */}
          {menuState === 'list' && renderList()}

          {/* Status bar */}
          {menuState === 'list' && renderStatusBar()}
        </>
      )}
    </Box>
  );
};
