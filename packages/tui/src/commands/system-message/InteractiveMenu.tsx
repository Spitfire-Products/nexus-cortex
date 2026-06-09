/**
 * Interactive System Message Menu
 *
 * Ink-based terminal UI for managing system messages
 * Provides list view, navigation, CRUD operations, and AI-powered creation/editing
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import type { SystemMessage, MessageType } from '@nexus-cortex/core/system-messages/types.js';
import { SystemMessageStore } from '@nexus-cortex/core/system-messages/SystemMessageStore.js';
import { InlineEditor } from './InlineEditor.js';
import * as path from 'path';

/**
 * Menu state
 */
type MenuState =
  | 'list'
  | 'confirm'
  | 'loading'
  | 'editing'
  | 'edit-choice' // Choose between direct edit or AI-assisted
  | 'edit-priority' // Confirm/change priority before editing
  | 'ai-edit-request' // Enter AI edit request
  | 'ai-edit-processing' // AI processing edit request
  | 'create-priority' // Step 1: Select priority for new message
  | 'create-description' // Step 2: Enter initial description
  | 'create-conversation' // Step 3: Multi-turn conversation with AI
  | 'create-generating';    // Step 4: AI generating final message

/**
 * Priority presets for easy selection
 * Lower priority number = injected first (matches injection system)
 * Priority 0 = excluded from injection entirely
 */
const PRIORITY_PRESETS = [
  { value: 0, label: 'Disabled (0)', description: 'Excluded from injection - message will not be loaded' },
  { value: 1, label: 'Critical (1)', description: 'Safety rules - injected first (before everything)' },
  { value: 5, label: 'High (5)', description: 'Core behavioral instructions - after system prompt' },
  { value: 8, label: 'Medium (8)', description: 'General guidance - after core messages' },
  { value: 15, label: 'Low (15)', description: 'Preferences - after periodic reminders (10)' },
  { value: 50, label: 'Optional (50)', description: 'Optional enhancements - injected last' },
];

/**
 * Conversation message for multi-turn creation
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Generated message profile (from conversational creator)
 */
export interface GeneratedMessageProfile {
  id: string;
  type: MessageType;
  displayName: string;
  description: string;
  priority: number;
  content: string;
}

/**
 * Conversational response from AI during message creation
 */
export interface ConversationalMessageResponse {
  type: 'question' | 'profile';
  question?: string;
  profile?: GeneratedMessageProfile;
}

/**
 * One-shot message profile generator function type
 */
export type SystemMessageProfileGenerator = (
  description: string
) => Promise<GeneratedMessageProfile>;

/**
 * Conversational message creator function type
 */
export type ConversationalMessageCreator = (
  messages: ConversationMessage[]
) => Promise<ConversationalMessageResponse>;

/**
 * Edit assistant function type
 */
export type EditAssistantFn = (
  currentContent: string,
  editRequest: string
) => Promise<{ content: string; summary: string }>;

/**
 * Confirmation prompt types
 */
type ConfirmAction =
  | { type: 'reset'; messageId: string }
  | { type: 'delete'; messageId: string }
  | { type: 'create' }
  | { type: 'save-ai-edit'; messageId: string; newContent: string };

/**
 * Props for InteractiveMenu
 */
export interface InteractiveMenuProps {
  /** System message store instance */
  store: SystemMessageStore;

  /** Runtime directory path */
  runtimeDir: string;

  /** Builtin directory path */
  builtinDir: string;

  /** Optional initial message ID to select */
  initialMessageId?: string;

  /** Function to generate message profile using AI */
  generateProfile?: SystemMessageProfileGenerator;

  /** Function for conversational message creation */
  conversationalCreator?: ConversationalMessageCreator;

  /** Function for AI-assisted editing */
  editAssistant?: EditAssistantFn;

  /** Callback when user exits the menu (enables graceful return to CLI) */
  onExit?: () => void;
}

/**
 * Interactive System Message Menu Component
 */
export const InteractiveMenu: React.FC<InteractiveMenuProps> = ({
  store,
  runtimeDir,
  builtinDir,
  initialMessageId,
  generateProfile,
  conversationalCreator,
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
  const [messages, setMessages] = useState<SystemMessage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuState, setMenuState] = useState<MenuState>('list');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Editing state
  const [editingMessage, setEditingMessage] = useState<SystemMessage | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [editingFilePath, setEditingFilePath] = useState<string>('');

  // AI edit state
  const [aiEditRequest, setAiEditRequest] = useState<string>('');
  const [aiEditResult, setAiEditResult] = useState<{ content: string; summary: string } | null>(null);

  // Creation state
  const [createDescription, setCreateDescription] = useState<string>('');
  const [generatingMessage, setGeneratingMessage] = useState<string>('');

  // Conversation state for multi-turn creation
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationInput, setConversationInput] = useState<string>('');
  const [conversationThinking, setConversationThinking] = useState<boolean>(false);

  // Edit choice state
  const [editChoiceIndex, setEditChoiceIndex] = useState(0);

  // Priority selection state
  const [prioritySelectIndex, setPrioritySelectIndex] = useState(3); // Default to Medium (8)
  const [selectedPriority, setSelectedPriority] = useState(8);
  const [customPriorityInput, setCustomPriorityInput] = useState<string>('');
  const [showCustomPriority, setShowCustomPriority] = useState(false);

  // Load messages on mount
  useEffect(() => {
    loadMessages();

    // Subscribe to store changes for hot-reload
    const listener = () => {
      loadMessages();
    };

    store.onChange(listener);

    return () => {
      store.removeListener(listener);
    };
  }, []);

  // Set initial selection
  useEffect(() => {
    if (initialMessageId && messages.length > 0) {
      const index = messages.findIndex((m) => m.id === initialMessageId);
      if (index !== -1) {
        setSelectedIndex(index);
      }
    }
  }, [messages, initialMessageId]);

  /**
   * Load messages from store
   */
  const loadMessages = () => {
    const allMessages = store.getAll();
    // Sort by priority (lower = injected first, show first in list)
    allMessages.sort((a: SystemMessage, b: SystemMessage) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority number first
      }
      return a.id.localeCompare(b.id);
    });
    setMessages(allMessages);
  };

  /**
   * Get currently selected message
   */
  const selectedMessage = messages[selectedIndex];

  /**
   * Handle keyboard input for list state
   */
  useInput((input, key) => {
    // Loading/generating state - block all input
    if (menuState === 'loading' || menuState === 'create-generating' || menuState === 'ai-edit-processing') {
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
        setSelectedIndex((prev) => Math.min(messages.length - 1, prev + 1));
        setStatusMessage('');
        setErrorMessage('');
      }

      // Actions
      else if (key.return && selectedMessage) {
        // Edit message - start with priority confirmation
        // Find the matching priority preset or use custom
        const currentPriority = selectedMessage.priority;
        const presetIndex = PRIORITY_PRESETS.findIndex(p => p.value === currentPriority);
        if (presetIndex !== -1) {
          setPrioritySelectIndex(presetIndex);
        } else {
          setPrioritySelectIndex(PRIORITY_PRESETS.length); // Custom option
        }
        setSelectedPriority(currentPriority);
        setShowCustomPriority(false);
        setCustomPriorityInput('');
        setMenuState('edit-priority');
      } else if (input === ' ' && selectedMessage) {
        // Toggle enabled state
        handleToggle(selectedMessage.id);
      } else if (input === '+') {
        // Create new message - start with priority selection
        setCreateDescription('');
        setConversationMessages([]);
        setConversationInput('');
        setPrioritySelectIndex(3); // Default to Medium (8)
        setSelectedPriority(8);
        setShowCustomPriority(false);
        setCustomPriorityInput('');
        setMenuState('create-priority');
      } else if (input.toLowerCase() === 'r' && selectedMessage) {
        // Reset to default
        if (selectedMessage.source === 'runtime' || selectedMessage.source === 'workspace') {
          setConfirmAction({ type: 'reset', messageId: selectedMessage.id });
          setMenuState('confirm');
        } else {
          setErrorMessage('Cannot reset builtin message');
        }
      } else if (input.toLowerCase() === 'd' && selectedMessage) {
        // Delete message
        if (selectedMessage.source === 'runtime') {
          setConfirmAction({ type: 'delete', messageId: selectedMessage.id });
          setMenuState('confirm');
        } else {
          setErrorMessage('Can only delete runtime messages');
        }
      } else if (input.toLowerCase() === 'q' || key.escape) {
        // Quit - use handleExit for graceful return to CLI
        handleExit();
      }
    }
  }, { isActive: menuState === 'list' || menuState === 'confirm' });

  /**
   * Handle keyboard input for edit choice state
   */
  useInput((_input, key) => {
    if (key.upArrow || key.downArrow) {
      setEditChoiceIndex((prev) => (prev === 0 ? 1 : 0));
    } else if (key.return) {
      if (editChoiceIndex === 0 && selectedMessage) {
        // Direct edit - update priority first if changed, then edit
        handleDirectEditWithPriority(selectedMessage.id, selectedPriority).catch((err) => {
          setErrorMessage(`Edit failed: ${err.message}`);
          setMenuState('list');
        });
      } else if (editChoiceIndex === 1 && selectedMessage) {
        // AI-assisted edit - update priority first if changed, then edit
        handleAiEditStartWithPriority(selectedMessage.id, selectedPriority).catch((err) => {
          setErrorMessage(`Edit failed: ${err.message}`);
          setMenuState('list');
        });
      }
    } else if (key.escape) {
      setMenuState('list');
    }
  }, { isActive: menuState === 'edit-choice' });

  /**
   * Handle keyboard input for AI edit request state (escape to cancel)
   */
  useInput((_input, key) => {
    if (key.escape) {
      setAiEditRequest('');
      setMenuState('list');
    }
  }, { isActive: menuState === 'ai-edit-request' });

  /**
   * Handle keyboard input for conversation state (escape to cancel)
   */
  useInput((_input, key) => {
    if (key.escape && !conversationThinking) {
      handleConversationCancel();
    }
  }, { isActive: menuState === 'create-conversation' || menuState === 'create-description' });

  /**
   * Handle keyboard input for priority selection (create and edit)
   */
  useInput((input, key) => {
    if (showCustomPriority) {
      // In custom priority input mode - only handle escape
      if (key.escape) {
        setShowCustomPriority(false);
        setCustomPriorityInput('');
      }
      return;
    }

    if (key.upArrow) {
      setPrioritySelectIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setPrioritySelectIndex((prev) => Math.min(PRIORITY_PRESETS.length, prev + 1)); // +1 for custom option
    } else if (key.return) {
      if (prioritySelectIndex < PRIORITY_PRESETS.length) {
        // Selected a preset
        const preset = PRIORITY_PRESETS[prioritySelectIndex];
        if (preset) {
          setSelectedPriority(preset.value);
          if (menuState === 'create-priority') {
            // Continue to description step
            setMenuState('create-description');
          } else if (menuState === 'edit-priority') {
            // Continue to edit choice
            setMenuState('edit-choice');
          }
        }
      } else {
        // Selected "Custom" option
        setShowCustomPriority(true);
        setCustomPriorityInput('');
      }
    } else if (key.escape) {
      setMenuState('list');
    } else if (input === 'c' || input === 'C') {
      // Shortcut for custom priority
      setShowCustomPriority(true);
      setCustomPriorityInput('');
    }
  }, { isActive: (menuState === 'create-priority' || menuState === 'edit-priority') && !showCustomPriority });

  /**
   * Handle custom priority input submission
   */
  const handleCustomPrioritySubmit = () => {
    const value = parseInt(customPriorityInput, 10);
    if (!isNaN(value) && value >= 1 && value <= 100) {
      setSelectedPriority(value);
      setShowCustomPriority(false);
      setCustomPriorityInput('');
      if (menuState === 'create-priority') {
        setMenuState('create-description');
      } else if (menuState === 'edit-priority') {
        setMenuState('edit-choice');
      }
    } else {
      setErrorMessage('Priority must be a number between 1 and 100');
    }
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
        case 'reset':
          await handleReset(action.messageId);
          break;
        case 'delete':
          await handleDelete(action.messageId);
          break;
        case 'create':
          await handleLegacyCreate();
          break;
        case 'save-ai-edit':
          await saveAiEdit(action.messageId, action.newContent);
          break;
      }
    } catch (error: any) {
      setErrorMessage(error.message);
    } finally {
      setMenuState('list');
    }
  };

  /**
   * Handle direct edit action - opens inline editor
   */
  const handleDirectEdit = async (messageId: string) => {
    const message = store.getMessage(messageId);
    if (!message) {
      setErrorMessage(`Message '${messageId}' not found`);
      return;
    }

    try {
      // Determine file path
      let filePath: string;

      // Special case: CORTEX.md is in .cortex/, not .cortex/system-messages/
      // Uses same lookup logic as SystemMessageStore/SystemMessageLoader:
      // 1. Project-level: {projectRoot}/.cortex/CORTEX.md
      // 2. Global fallback: ~/.cortex/CORTEX.md
      if (messageId === 'cortex') {
        const fs = await import('fs/promises');

        // Try project-level first
        const projectRoot = path.dirname(path.dirname(runtimeDir));
        const projectCortexPath = path.join(projectRoot, '.cortex', 'CORTEX.md');

        try {
          await fs.access(projectCortexPath);
          filePath = projectCortexPath;
        } catch {
          // Try global fallback
          const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
          const globalCortexPath = path.join(homeDir, '.cortex', 'CORTEX.md');

          try {
            await fs.access(globalCortexPath);
            filePath = globalCortexPath;
          } catch {
            // Neither exists - use project path (will fail later with helpful error)
            filePath = projectCortexPath;
          }
        }
      } else if (message.source === 'runtime') {
        filePath = path.join(runtimeDir, message.path);
      } else if (message.source === 'builtin') {
        // Create runtime override
        const fileName = messageId.toUpperCase() + '.md';
        filePath = path.join(runtimeDir, 'messages', fileName);

        // Copy builtin to runtime if doesn't exist
        const builtinPath = path.join(builtinDir, message.path);
        const fs = await import('fs/promises');
        try {
          await fs.access(filePath);
        } catch {
          // File doesn't exist, copy from builtin
          const content = await fs.readFile(builtinPath, 'utf-8');
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, 'utf-8');

          // Add to registry
          const { SystemMessageRegistry } = await import('@nexus-cortex/core/system-messages/SystemMessageRegistry.js');
          const registry = new SystemMessageRegistry(runtimeDir);
          await registry.load();
          const entry = SystemMessageRegistry.createEntry(
            messageId,
            message.type,
            `messages/${fileName}`,
            {
              priority: message.priority,
              description: message.metadata.description,
              displayName: message.metadata.displayName,
            }
          );
          await registry.add(entry);
        }
      } else {
        filePath = path.join(builtinDir, message.path);
      }

      // Load file content
      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');

      // Set editing state and open inline editor
      setEditingMessage(message);
      setEditingContent(content);
      setEditingFilePath(filePath);
      setMenuState('editing');
    } catch (error: any) {
      setErrorMessage(`Failed to open editor: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Start AI-assisted edit
   */
  const handleAiEditStart = async (messageId: string) => {
    const message = store.getMessage(messageId);
    if (!message) {
      setErrorMessage(`Message '${messageId}' not found`);
      return;
    }

    try {
      // Load current content
      let filePath: string;

      // Special case: CORTEX.md is in .cortex/, not .cortex/system-messages/
      if (messageId === 'cortex') {
        const projectRoot = path.dirname(path.dirname(runtimeDir));
        filePath = path.join(projectRoot, message.path);
      } else if (message.source === 'runtime') {
        filePath = path.join(runtimeDir, message.path);
      } else if (message.source === 'builtin') {
        filePath = path.join(builtinDir, message.path);
      } else {
        filePath = path.join(builtinDir, message.path);
      }

      const fs = await import('fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');

      setEditingMessage(message);
      setEditingContent(content);
      setEditingFilePath(filePath);
      setAiEditRequest('');
      setAiEditResult(null);
      setMenuState('ai-edit-request');
    } catch (error: any) {
      setErrorMessage(`Failed to load message content: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Update priority in registry if changed
   */
  const updatePriorityIfChanged = async (messageId: string, newPriority: number): Promise<void> => {
    const message = store.getMessage(messageId);
    if (!message || message.priority === newPriority) {
      return; // No change needed
    }

    try {
      // Use the store's method to update priority (handles registry + in-memory update)
      await store.updateMessagePriority(messageId, newPriority);

      // Refresh local messages state
      loadMessages();

      setStatusMessage(`Priority updated to ${newPriority}`);
    } catch (error: any) {
      console.error('Failed to update priority:', error);
      setErrorMessage(`Failed to update priority: ${error.message}`);
    }
  };

  /**
   * Handle direct edit with priority update
   */
  const handleDirectEditWithPriority = async (messageId: string, priority: number) => {
    await updatePriorityIfChanged(messageId, priority);
    await handleDirectEdit(messageId);
  };

  /**
   * Handle AI-assisted edit with priority update
   */
  const handleAiEditStartWithPriority = async (messageId: string, priority: number) => {
    await updatePriorityIfChanged(messageId, priority);
    await handleAiEditStart(messageId);
  };

  /**
   * Handle AI edit request submission
   */
  const handleAiEditSubmit = async () => {
    if (!aiEditRequest.trim() || !editAssistant || !editingMessage) {
      return;
    }

    setMenuState('ai-edit-processing');
    setErrorMessage('');

    try {
      const result = await editAssistant(editingContent, aiEditRequest);
      setAiEditResult(result);

      // Show confirmation to save
      setConfirmAction({
        type: 'save-ai-edit',
        messageId: editingMessage.id,
        newContent: result.content,
      });
      setMenuState('confirm');
    } catch (error: any) {
      setErrorMessage(`AI edit failed: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Save AI-edited content
   */
  const saveAiEdit = async (messageId: string, newContent: string) => {
    const message = store.getMessage(messageId);
    if (!message) {
      throw new Error(`Message '${messageId}' not found`);
    }

    // Determine file path
    let filePath: string;
    if (message.source === 'runtime') {
      filePath = path.join(runtimeDir, message.path);
    } else if (message.source === 'builtin') {
      // Create runtime override
      const fileName = messageId.toUpperCase() + '.md';
      filePath = path.join(runtimeDir, 'messages', fileName);

      // Ensure directory exists
      const fs = await import('fs/promises');
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Add to registry if new
      const { SystemMessageRegistry } = await import('@nexus-cortex/core/system-messages/SystemMessageRegistry.js');
      const registry = new SystemMessageRegistry(runtimeDir);
      await registry.load();

      try {
        await fs.access(filePath);
      } catch {
        // File doesn't exist, add to registry
        const entry = SystemMessageRegistry.createEntry(
          messageId,
          message.type,
          `messages/${fileName}`,
          {
            priority: message.priority,
            description: message.metadata.description,
            displayName: message.metadata.displayName,
          }
        );
        await registry.add(entry);
      }
    } else {
      throw new Error('Cannot edit workspace messages');
    }

    // Write file
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, newContent, 'utf-8');

    // Immediately reload the message in the store to pick up content changes (like displayName)
    await store.reloadMessageFile(filePath, 'runtime');

    const summary = aiEditResult?.summary || 'Content updated';
    setStatusMessage(`Message '${messageId}' updated: ${summary}`);

    // Clear editing state
    setEditingMessage(null);
    setEditingContent('');
    setEditingFilePath('');
    setAiEditRequest('');
    setAiEditResult(null);

    // Refresh list to show updated data
    loadMessages();
  };

  /**
   * Handle save from inline editor
   */
  const handleEditorSave = async (newContent: string) => {
    if (!editingFilePath || !editingMessage) {
      return;
    }

    try {
      // Write file
      const fs = await import('fs/promises');
      await fs.writeFile(editingFilePath, newContent, 'utf-8');

      // Immediately reload the message in the store to pick up content changes (like displayName)
      await store.reloadMessageFile(editingFilePath, 'runtime');

      setStatusMessage(`Message '${editingMessage.id}' saved successfully`);
      setMenuState('list');

      // Clear editing state
      setEditingMessage(null);
      setEditingContent('');
      setEditingFilePath('');

      // Refresh list to show updated data
      loadMessages();
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
    setEditingMessage(null);
    setEditingContent('');
    setEditingFilePath('');
  };

  /**
   * Handle toggle action
   */
  const handleToggle = async (messageId: string) => {
    try {
      const newState = await store.toggleEnabled(messageId);
      setStatusMessage(`Message '${messageId}' ${newState ? 'enabled' : 'disabled'}`);
      loadMessages(); // Refresh list
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  /**
   * Handle reset action
   */
  const handleReset = async (messageId: string) => {
    try {
      await store.resetToDefault(messageId);
      setStatusMessage(`Message '${messageId}' reset to default`);
      loadMessages();
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  /**
   * Handle delete action
   */
  const handleDelete = async (messageId: string) => {
    try {
      await store.deleteMessage(messageId);
      setStatusMessage(`Message '${messageId}' deleted`);
      loadMessages();

      // Adjust selection if needed
      if (selectedIndex >= messages.length - 1) {
        setSelectedIndex(Math.max(0, messages.length - 2));
      }
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  /**
   * Handle legacy create action (no AI)
   */
  const handleLegacyCreate = async () => {
    const id = `custom_${Date.now()}`;

    try {
      await store.createMessage({
        id,
        type: 'instruction',
        displayName: `Custom Message ${Date.now()}`,
        description: 'Custom system message',
        priority: 50,
      });

      setStatusMessage(`Created new message '${id}' - edit to customize`);
      loadMessages();

      // Select the new message
      const newIndex = messages.findIndex((m) => m.id === id);
      if (newIndex !== -1) {
        setSelectedIndex(newIndex);
      }
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  /**
   * Handle description submission - starts conversation
   */
  const handleDescriptionSubmit = async () => {
    if (!createDescription.trim()) {
      setErrorMessage('Please enter a description for your system message');
      return;
    }

    setErrorMessage('');

    // Start the conversation flow
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
        const response = await conversationalCreator([initialMessage]);
        setConversationThinking(false);

        if (response.type === 'profile' && response.profile) {
          // AI generated profile directly without questions
          await createMessageFromProfile(response.profile);
        } else if (response.type === 'question' && response.question) {
          // AI is asking a clarifying question
          const questionText = response.question;
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
    setGeneratingMessage('Generating system message...');

    try {
      let profile: GeneratedMessageProfile;

      if (generateProfile) {
        // Use AI to generate the profile
        profile = await generateProfile(createDescription);
      } else {
        // Fallback: Create a basic profile
        const safeId = createDescription
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48) || `message-${Date.now()}`;

        profile = {
          id: safeId,
          type: 'instruction',
          displayName: createDescription.slice(0, 50),
          description: createDescription.slice(0, 200),
          priority: 50,
          content: `# ${createDescription.slice(0, 50)}\n\n${createDescription}\n\n## Guidelines\n\n- Follow the instructions above\n- Be thorough and consistent`,
        };
      }

      await createMessageFromProfile(profile);
    } catch (error: any) {
      setErrorMessage(`Failed to create message: ${error.message}`);
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
      const response = await conversationalCreator(updatedMessages);
      setConversationThinking(false);

      if (response.type === 'profile' && response.profile) {
        // AI generated the final profile
        await createMessageFromProfile(response.profile);
      } else if (response.type === 'question' && response.question) {
        // AI is asking another clarifying question
        const questionText = response.question;
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
   * Create message from generated profile
   */
  const createMessageFromProfile = async (profile: GeneratedMessageProfile) => {
    setMenuState('create-generating');
    setGeneratingMessage('Saving system message...');

    try {
      // Create the message file
      const fileName = profile.id.toUpperCase() + '.md';
      const filePath = path.join(runtimeDir, 'messages', fileName);

      const fs = await import('fs/promises');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, profile.content, 'utf-8');

      // Add to registry
      const { SystemMessageRegistry } = await import('@nexus-cortex/core/system-messages/SystemMessageRegistry.js');
      const registry = new SystemMessageRegistry(runtimeDir);
      await registry.load();

      const entry = SystemMessageRegistry.createEntry(
        profile.id,
        profile.type,
        `messages/${fileName}`,
        {
          priority: selectedPriority, // Use user-selected priority
          description: profile.description,
          displayName: profile.displayName,
        }
      );
      await registry.add(entry);

      // Immediately reload the new message in the store
      await store.reloadMessageFile(filePath, 'runtime');

      setStatusMessage(`Created system message '${profile.id}' successfully!`);

      // Reset all creation state
      resetCreationState();
      setMenuState('list');

      // Refresh list and select the new message
      loadMessages();
      setTimeout(() => {
        const newIndex = store.getAll().findIndex((m: SystemMessage) => m.id === profile.id);
        if (newIndex !== -1) {
          setSelectedIndex(newIndex);
        }
      }, 50);
    } catch (error: any) {
      setErrorMessage(`Failed to create message: ${error.message}`);
      setMenuState('list');
    }
  };

  /**
   * Reset all creation-related state
   */
  const resetCreationState = () => {
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
   * Render priority selection
   */
  const renderPrioritySelection = () => {
    const isEditing = menuState === 'edit-priority';
    const title = isEditing
      ? `Set Priority for '${selectedMessage?.metadata?.displayName || selectedMessage?.id}'`
      : 'Step 1: Select Priority';

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">{title}</Text>
        </Box>

        {isEditing && selectedMessage && (
          <Box marginBottom={1} flexDirection="column">
            <Box>
              <Text dimColor>Current priority: </Text>
              <Text color={selectedMessage.priority === 0 ? 'red' : 'yellow'}>{selectedMessage.priority}</Text>
              {selectedMessage.priority === 0 && (
                <Text color="red" bold> (EXCLUDED FROM INJECTION)</Text>
              )}
            </Box>
          </Box>
        )}

        <Box marginBottom={1}>
          <Text>Select priority level (lower number = injected first):</Text>
        </Box>

        {/* Custom priority input mode */}
        {showCustomPriority ? (
          <Box flexDirection="column" marginBottom={1}>
            <Box borderStyle="single" borderColor="cyan" paddingX={1}>
              <Text color="cyan">Custom priority (1-100): </Text>
              <TextInput
                value={customPriorityInput}
                onChange={setCustomPriorityInput}
                onSubmit={handleCustomPrioritySubmit}
                placeholder="e.g., 75"
              />
            </Box>
            {errorMessage && (
              <Box marginTop={1}>
                <Text color="red">{errorMessage}</Text>
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="column" marginBottom={1}>
            {PRIORITY_PRESETS.map((preset, index) => {
              const isSelected = index === prioritySelectIndex;
              return (
                <Box key={preset.value} paddingLeft={isSelected ? 0 : 2}>
                  {isSelected && <Text color="cyan" bold>{'> '}</Text>}
                  <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                    {preset.label}
                  </Text>
                  <Text dimColor> - {preset.description}</Text>
                </Box>
              );
            })}
            {/* Custom option */}
            <Box paddingLeft={prioritySelectIndex === PRIORITY_PRESETS.length ? 0 : 2}>
              {prioritySelectIndex === PRIORITY_PRESETS.length && <Text color="cyan" bold>{'> '}</Text>}
              <Text bold={prioritySelectIndex === PRIORITY_PRESETS.length} color={prioritySelectIndex === PRIORITY_PRESETS.length ? 'cyan' : undefined}>
                Custom...
              </Text>
              <Text dimColor> - Enter a specific priority value</Text>
            </Box>
          </Box>
        )}

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>
            {showCustomPriority
              ? 'Enter: Confirm | Esc: Back to presets'
              : `${String.fromCharCode(8593)}/${String.fromCharCode(8595)}: Navigate | Enter: Select | C: Custom | Esc: Cancel`}
          </Text>
        </Box>
      </Box>
    );
  };

  const renderEditChoice = () => {
    if (!selectedMessage) return null;

    const choices = [
      { label: 'Edit directly', description: 'Open in inline editor for manual editing' },
      { label: 'AI-assisted edit', description: 'Describe changes and let AI update the content' },
    ];

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Edit '{selectedMessage.id}'</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>How would you like to edit this system message?</Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          {choices.map((choice, index) => {
            const isSelected = index === editChoiceIndex;
            return (
              <Box key={choice.label} paddingLeft={isSelected ? 0 : 2}>
                {isSelected && <Text color="cyan" bold>{'> '}</Text>}
                <Text bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                  {choice.label}
                </Text>
                <Text dimColor> - {choice.description}</Text>
              </Box>
            );
          })}
        </Box>

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>
            {String.fromCharCode(8593)}/{String.fromCharCode(8595)}: Navigate | Enter: Select | Esc: Cancel
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render AI edit request input
   */
  const renderAiEditRequest = () => {
    if (!editingMessage) return null;

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">AI-Assisted Edit: '{editingMessage.id}'</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text>Describe what changes you want to make:</Text>
          <Text dimColor>(e.g., "Add a section about error handling", "Make the tone more formal")</Text>
        </Box>

        <Box borderStyle="single" borderColor="cyan" paddingX={1} paddingY={0}>
          <TextInput
            value={aiEditRequest}
            onChange={setAiEditRequest}
            onSubmit={handleAiEditSubmit}
            placeholder="E.g., Add examples for edge cases, simplify the language, restructure into clearer sections..."
          />
        </Box>

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}

        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor>
            Enter: Generate Changes | Esc: Cancel
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
          <Text bold color="cyan">Processing Your Edit Request</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> AI is analyzing and updating the content...</Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>Request: "{aiEditRequest}"</Text>
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
      case 'reset':
        promptText = `Reset message '${confirmAction.messageId}' to builtin default?`;
        warningText = 'Your custom changes will be lost.';
        break;
      case 'delete':
        promptText = `Delete message '${confirmAction.messageId}'?`;
        warningText = 'This action cannot be undone.';
        break;
      case 'create':
        promptText = 'Create new custom message?';
        break;
      case 'save-ai-edit':
        promptText = `Save AI-generated changes to '${confirmAction.messageId}'?`;
        if (aiEditResult?.summary) {
          warningText = `Changes: ${aiEditResult.summary}`;
        }
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
   * Render description input step
   */
  const renderDescriptionInput = () => {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Create New System Message</Text>
        </Box>

        <Box marginBottom={1} flexDirection="column">
          <Text>Describe the system message you want to create:</Text>
          <Text dimColor>(What should it instruct, constrain, or provide context about?)</Text>
        </Box>

        <Box borderStyle="single" borderColor="cyan" paddingX={1} paddingY={0}>
          <TextInput
            value={createDescription}
            onChange={setCreateDescription}
            onSubmit={handleDescriptionSubmit}
            placeholder="E.g., A code style guide for TypeScript that enforces consistent naming conventions..."
          />
        </Box>

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{'!'} {errorMessage}</Text>
          </Box>
        )}

        <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
          <Text dimColor>
            Enter: Continue | Esc: Cancel
          </Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render conversation mode - multi-turn creation
   */
  const renderConversation = () => {
    return (
      <Box flexDirection="column" marginTop={1}>
        {/* Header */}
        <Box marginBottom={1}>
          <Text bold color="cyan">Creating System Message - Conversation</Text>
        </Box>

        <Box marginBottom={1}>
          <Text dimColor>Answer the AI's questions to refine your system message</Text>
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
   * Render generating state
   */
  const renderGenerating = () => {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Creating Your System Message</Text>
        </Box>

        <Box marginBottom={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> {generatingMessage}</Text>
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>The AI is generating a detailed system message based on your description...</Text>
        </Box>
      </Box>
    );
  };

  /**
   * Render message list
   */
  const renderList = () => {
    if (messages.length === 0) {
      return (
        <Box marginTop={1}>
          <Text dimColor>No messages found</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        {messages.map((msg, index) => {
          const isSelected = index === selectedIndex;
          const enabledIcon = msg.enabled ? String.fromCharCode(10003) : String.fromCharCode(10007);
          const sourceIcon =
            msg.source === 'runtime' ? String.fromCharCode(9998) :
            msg.source === 'workspace' ? String.fromCharCode(9881) :
            String.fromCharCode(128230);

          // Priority 0 means excluded from injection
          const isExcluded = msg.priority === 0;

          return (
            <Box key={msg.id} paddingLeft={isSelected ? 0 : 2}>
              {isSelected && <Text color="cyan" bold>{String.fromCharCode(9654)} </Text>}
              <Text color={msg.enabled ? 'green' : 'red'}>{enabledIcon}</Text>
              <Text> </Text>
              <Text>{sourceIcon}</Text>
              <Text> </Text>
              <Text bold={isSelected} color={isSelected ? 'cyan' : isExcluded ? 'gray' : undefined} strikethrough={isExcluded}>
                {msg.metadata?.displayName || msg.id}
              </Text>
              {isExcluded ? (
                <Text color="yellow"> (DISABLED - priority 0)</Text>
              ) : (
                <Text dimColor> ({msg.type}, priority: {msg.priority})</Text>
              )}
            </Box>
          );
        })}
      </Box>
    );
  };

  /**
   * Render status bar
   */
  const renderStatusBar = () => {
    const hasAI = conversationalCreator || generateProfile;

    return (
      <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Box justifyContent="space-between">
          <Text dimColor>
            {String.fromCharCode(8593)}/{String.fromCharCode(8595)}: Navigate | Enter: Edit | Space: Toggle | +: New{hasAI ? ' (AI)' : ''} | R: Reset | D: Delete | Q: Quit
          </Text>
        </Box>

        {statusMessage && (
          <Box marginTop={1}>
            <Text color="green">{String.fromCharCode(10003)} {statusMessage}</Text>
          </Box>
        )}

        {errorMessage && (
          <Box marginTop={1}>
            <Text color="red">{String.fromCharCode(10007)} {errorMessage}</Text>
          </Box>
        )}

        {selectedMessage && (
          <Box marginTop={1}>
            <Text dimColor>
              Selected: {selectedMessage.id} | Source: {selectedMessage.source} |
              {' '}Path: {selectedMessage.path}
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
            <Text bold color="cyan">System Message Manager</Text>
            <Text> </Text>
            <Text dimColor>({messages.length} messages)</Text>
            {(conversationalCreator || generateProfile) && (
              <Text color="magenta"> [AI-Assisted]</Text>
            )}
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

          {/* Priority selection (create and edit) */}
          {(menuState === 'create-priority' || menuState === 'edit-priority') && renderPrioritySelection()}

          {/* Edit choice prompt */}
          {menuState === 'edit-choice' && renderEditChoice()}

          {/* AI edit request input */}
          {menuState === 'ai-edit-request' && renderAiEditRequest()}

          {/* AI edit processing */}
          {menuState === 'ai-edit-processing' && renderAiEditProcessing()}

          {/* Confirmation prompt */}
          {menuState === 'confirm' && renderConfirmation()}

          {/* Creation - Description input */}
          {menuState === 'create-description' && renderDescriptionInput()}

          {/* Creation - Conversation mode */}
          {menuState === 'create-conversation' && renderConversation()}

          {/* Creation - Generating */}
          {menuState === 'create-generating' && renderGenerating()}

          {/* Message list */}
          {menuState === 'list' && renderList()}

          {/* Status bar */}
          {menuState === 'list' && renderStatusBar()}
        </>
      )}
    </Box>
  );
};
