/**
 * System Message Management Command
 *
 * Entry point for /system-message slash command
 * Launches interactive menu for managing system messages
 * with AI-powered message creation and editing assistance
 */

import React from 'react';
import { render } from 'ink';
import { SystemMessageStore } from '@nexus-cortex/core/system-messages/SystemMessageStore.js';
import {
  InteractiveMenu,
  type SystemMessageProfileGenerator,
  type ConversationalMessageCreator,
  type ConversationMessage,
  type ConversationalMessageResponse,
} from './InteractiveMenu.js';
import { OrchestratorClient } from '@nexus-cortex/cli/dist/orchestrator/OrchestratorClient.js';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Configuration for system message command
 */
export interface SystemMessageCommandConfig {
  /** Runtime directory (.cortex/system-messages) */
  runtimeDir: string;

  /** Builtin messages directory (packages/core/dist/system-messages) */
  builtinDir: string;

  /** Optional workspace directory (.cortex/workspace-messages) */
  workspaceDir?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Optional initial message ID to select */
  initialMessageId?: string;

  /** Orchestrator client for AI generation */
  orchestratorClient?: OrchestratorClient;
}

/**
 * System prompt for generating system message profiles
 */
const SYSTEM_MESSAGE_GENERATOR_PROMPT = `You are an expert at designing system messages for an AI CLI assistant.

Given a user's description of what they want a system message to do, generate a complete system message.

IMPORTANT: Your response must be ONLY valid JSON with no markdown code fences or other text.

The JSON must have exactly these fields:
{
  "id": "message-id-in-kebab-case",
  "type": "instruction|constraint|context|template",
  "displayName": "Human Readable Name",
  "description": "A clear, concise description of what this message does (max 200 chars)",
  "priority": 50,
  "content": "The full markdown content of the system message"
}

Message Types:
- instruction: Guidance on how to approach tasks, methodologies, best practices
- constraint: Boundaries, limitations, what NOT to do, safety guidelines
- context: Background information, project context, domain knowledge
- template: Reusable patterns, formats, structures for outputs

Guidelines for the content:
1. Use clear markdown formatting with headers and bullet points
2. Be specific and actionable
3. Include examples where helpful
4. Use appropriate structure for the message type
5. Keep instructions focused and non-redundant
6. For constraints, be clear about what is NOT allowed
7. For context, provide relevant background that guides behavior
8. For templates, include clear placeholders and usage examples

Priority Guidelines:
- 90-100: Critical constraints and safety rules (loaded first)
- 70-89: Core behavioral instructions
- 50-69: General guidance and context
- 30-49: Preferences and style guides
- 10-29: Optional enhancements
- 1-9: Low priority additions

The id should be:
- Lowercase, hyphenated (kebab-case)
- Descriptive but concise (max 48 chars)
- No special characters except hyphens`;

/**
 * System message domain categories for intelligent question generation
 */
interface MessageDomain {
  keywords: string[];
  suggestedType: 'instruction' | 'constraint' | 'context' | 'template';
  suggestedPriority: number;
  followUpQuestions: string[];
  domainName: string;
}

const SYSTEM_MESSAGE_DOMAINS: MessageDomain[] = [
  {
    domainName: 'coding-style',
    keywords: ['code', 'style', 'format', 'naming', 'convention', 'lint', 'prettier', 'eslint', 'syntax'],
    suggestedType: 'instruction',
    suggestedPriority: 60,
    followUpQuestions: [
      'What programming languages should this style guide cover?',
      'Should it enforce specific naming conventions (camelCase, snake_case, etc.)?',
      'Are there specific patterns to encourage or avoid?',
    ],
  },
  {
    domainName: 'safety',
    keywords: ['safe', 'security', 'danger', 'restrict', 'block', 'prevent', 'limit', 'careful', 'warning'],
    suggestedType: 'constraint',
    suggestedPriority: 95,
    followUpQuestions: [
      'What specific actions or behaviors should be restricted?',
      'Should it be a hard block or a warning with confirmation?',
      'Are there any exceptions where the restriction should not apply?',
    ],
  },
  {
    domainName: 'output-format',
    keywords: ['output', 'format', 'response', 'template', 'structure', 'json', 'markdown', 'report'],
    suggestedType: 'template',
    suggestedPriority: 50,
    followUpQuestions: [
      'What format should the output be in? (JSON, markdown, structured text)',
      'Should it include specific sections or fields?',
      'Are there examples of ideal output you want to match?',
    ],
  },
  {
    domainName: 'project-context',
    keywords: ['project', 'codebase', 'context', 'background', 'about', 'describe', 'understand', 'architecture'],
    suggestedType: 'context',
    suggestedPriority: 55,
    followUpQuestions: [
      'What are the key components or modules the AI should understand?',
      'Are there specific patterns or conventions unique to this project?',
      'What external dependencies or APIs should be documented?',
    ],
  },
  {
    domainName: 'behavior',
    keywords: ['behave', 'act', 'persona', 'tone', 'voice', 'personality', 'manner', 'approach', 'style'],
    suggestedType: 'instruction',
    suggestedPriority: 70,
    followUpQuestions: [
      'What tone should the AI use? (professional, casual, technical, friendly)',
      'Should it have a specific persona or character?',
      'Are there communication styles to adopt or avoid?',
    ],
  },
  {
    domainName: 'task-specific',
    keywords: ['task', 'workflow', 'process', 'procedure', 'step', 'guide', 'how to', 'method'],
    suggestedType: 'instruction',
    suggestedPriority: 65,
    followUpQuestions: [
      'What specific task or workflow should this guide the AI through?',
      'Are there checkpoints or validations during the process?',
      'What defines success for this task?',
    ],
  },
  {
    domainName: 'testing',
    keywords: ['test', 'testing', 'spec', 'verification', 'validation', 'check', 'coverage', 'quality'],
    suggestedType: 'instruction',
    suggestedPriority: 60,
    followUpQuestions: [
      'What testing framework or patterns should be followed?',
      'What types of tests are most important? (unit, integration, e2e)',
      'Are there specific coverage goals or quality metrics?',
    ],
  },
  {
    domainName: 'documentation',
    keywords: ['document', 'doc', 'comment', 'readme', 'explain', 'jsdoc', 'docstring', 'api doc'],
    suggestedType: 'instruction',
    suggestedPriority: 55,
    followUpQuestions: [
      'What documentation format is preferred? (JSDoc, TypeDoc, inline comments)',
      'What should always be documented vs. left implicit?',
      'Are there templates or examples to follow?',
    ],
  },
  {
    domainName: 'error-handling',
    keywords: ['error', 'exception', 'handle', 'catch', 'fail', 'fallback', 'retry', 'recover'],
    suggestedType: 'instruction',
    suggestedPriority: 70,
    followUpQuestions: [
      'What error handling patterns should be followed?',
      'Should errors be logged, reported, or silently handled?',
      'Are there specific error messages or formats to use?',
    ],
  },
  {
    domainName: 'performance',
    keywords: ['performance', 'optimize', 'fast', 'efficient', 'cache', 'memory', 'speed', 'benchmark'],
    suggestedType: 'instruction',
    suggestedPriority: 60,
    followUpQuestions: [
      'What performance metrics are most important? (latency, memory, CPU)',
      'Are there specific optimization patterns to use or avoid?',
      'Should there be performance budgets or thresholds?',
    ],
  },
];

/**
 * Analyze user description to detect domain and context
 */
function analyzeMessageDescription(description: string): {
  detectedDomains: MessageDomain[];
  suggestedType: 'instruction' | 'constraint' | 'context' | 'template';
  suggestedPriority: number;
  contextualQuestions: string[];
} {
  const lowerDesc = description.toLowerCase();
  const detectedDomains: MessageDomain[] = [];

  // Find matching domains
  for (const domain of SYSTEM_MESSAGE_DOMAINS) {
    const matchCount = domain.keywords.filter((kw) => lowerDesc.includes(kw)).length;
    if (matchCount > 0) {
      detectedDomains.push(domain);
    }
  }

  // Sort by relevance (more keyword matches = more relevant)
  detectedDomains.sort((a, b) => {
    const aMatches = a.keywords.filter((kw) => lowerDesc.includes(kw)).length;
    const bMatches = b.keywords.filter((kw) => lowerDesc.includes(kw)).length;
    return bMatches - aMatches;
  });

  // Determine suggested type and priority from most relevant domain
  let suggestedType: 'instruction' | 'constraint' | 'context' | 'template' = 'instruction';
  let suggestedPriority = 50;

  if (detectedDomains.length > 0) {
    const primaryDomain = detectedDomains[0];
    if (primaryDomain) {
      suggestedType = primaryDomain.suggestedType;
      suggestedPriority = primaryDomain.suggestedPriority;
    }
  }

  // Build contextual questions based on detected domains
  const contextualQuestions: string[] = [];
  if (detectedDomains.length > 0) {
    const primaryDomain = detectedDomains[0];
    if (primaryDomain) {
      contextualQuestions.push(...primaryDomain.followUpQuestions);
    }
  }

  // Add generic but useful questions if we don't have domain-specific ones
  if (contextualQuestions.length === 0) {
    contextualQuestions.push(
      `What type of system message should this be? (instruction for how-to, constraint for limitations, context for background info, template for output formats)`,
      'What priority should this message have relative to other system messages?',
      'Are there specific examples or scenarios you want to guide behavior for?',
    );
  }

  return {
    detectedDomains,
    suggestedType,
    suggestedPriority,
    contextualQuestions,
  };
}

/**
 * System prompt for generating the final system message profile
 */
const PROFILE_GENERATOR_PROMPT = `You are an expert at designing system messages for an AI CLI assistant.

Based on the conversation below, generate a complete system message profile.

Your response must be ONLY valid JSON with this exact structure:
{
  "id": "message-id-kebab-case",
  "type": "instruction|constraint|context|template",
  "displayName": "Human Readable Name",
  "description": "A clear, concise description (max 200 chars)",
  "priority": 50,
  "content": "# Message Title\\n\\nFull markdown content with proper formatting, headers, bullet points, and examples..."
}

Message Types:
- instruction: How-to guidance, methodologies, best practices
- constraint: Boundaries, limitations, safety rules
- context: Background info, project context, domain knowledge
- template: Reusable output patterns and formats

Priority levels (1-100, higher = loaded first):
- 90-100: Critical constraints
- 70-89: Core instructions
- 50-69: General guidance
- 30-49: Preferences
- 10-29: Optional

Guidelines:
- The id should be lowercase, hyphenated, max 48 chars
- The content should be well-formatted markdown
- Include clear structure with headers and bullet points
- Be specific and actionable
- Add examples where helpful

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

/**
 * System prompt for AI-assisted editing
 */
const EDIT_ASSISTANT_PROMPT = `You are an expert at improving and refining system messages for an AI CLI assistant.

You will be given the current content of a system message and the user's request for how to modify it.

Your response must be ONLY valid JSON with this exact structure:
{
  "content": "The complete updated markdown content of the system message",
  "summary": "A brief 1-2 sentence summary of what was changed"
}

Guidelines for modifications:
1. Preserve the overall structure and purpose of the message
2. Make the requested changes clearly and precisely
3. Maintain proper markdown formatting
4. Keep the content focused and non-redundant
5. If adding new sections, integrate them naturally
6. If removing content, ensure remaining content is coherent
7. Improve clarity and specificity when possible

IMPORTANT: Return ONLY valid JSON. The "content" should be the full updated message, not just the changes.`;

/**
 * Create an AI profile generator using the orchestrator
 */
function createProfileGenerator(
  orchestratorClient: OrchestratorClient
): SystemMessageProfileGenerator {
  return async (description: string) => {
    const prompt = `Create a system message for the following description:

"${description}"

Remember: Respond with ONLY valid JSON, no markdown code fences.`;

    try {
      const response = await orchestratorClient.sendMessage(prompt, {
        system: SYSTEM_MESSAGE_GENERATOR_PROMPT,
        temperature: 0.7,
      });

      // Extract the response text
      let responseText = '';
      if (typeof response === 'string') {
        responseText = response;
      } else if (response && typeof response === 'object') {
        if ('text' in response) {
          responseText = response.text as string;
        } else if ('content' in response && Array.isArray(response.content)) {
          for (const block of response.content) {
            if (block && typeof block === 'object' && 'text' in block) {
              responseText += block.text;
            }
          }
        }
      }

      // Try to extract JSON from the response
      let jsonStr = responseText.trim();

      // Remove markdown code fences if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1]?.trim() || jsonStr;
      }

      // Find JSON object boundaries
      const startBrace = jsonStr.indexOf('{');
      const endBrace = jsonStr.lastIndexOf('}');
      if (startBrace !== -1 && endBrace !== -1) {
        jsonStr = jsonStr.slice(startBrace, endBrace + 1);
      }

      // Parse the JSON
      const profile = JSON.parse(jsonStr);

      // Validate required fields
      if (!profile.id || typeof profile.id !== 'string') {
        throw new Error('Invalid profile: missing or invalid id');
      }
      if (!profile.type || !['instruction', 'constraint', 'context', 'template'].includes(profile.type)) {
        throw new Error('Invalid profile: missing or invalid type');
      }
      if (!profile.content || typeof profile.content !== 'string') {
        throw new Error('Invalid profile: missing or invalid content');
      }

      // Sanitize id
      const safeId = profile.id
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);

      return {
        id: safeId || `message-${Date.now()}`,
        type: profile.type,
        displayName: profile.displayName || safeId,
        description: (profile.description || description).slice(0, 200),
        priority: typeof profile.priority === 'number' ? profile.priority : 50,
        content: profile.content,
      };
    } catch (error: any) {
      // If JSON parsing fails, create a fallback profile
      console.error('Failed to parse AI response:', error.message);

      const analysis = analyzeMessageDescription(description);
      const safeId = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || `message-${Date.now()}`;

      return {
        id: safeId,
        type: analysis.suggestedType,
        displayName: description.slice(0, 50),
        description: description.slice(0, 200),
        priority: analysis.suggestedPriority,
        content: `# ${description.slice(0, 50)}\n\n${description}\n\n## Guidelines\n\n- Follow the instructions above\n- Be thorough and consistent\n- Ask for clarification when needed`,
      };
    }
  };
}

/**
 * Create a conversational message creator using the orchestrator
 */
function createConversationalCreator(
  orchestratorClient: OrchestratorClient
): ConversationalMessageCreator {
  return async (
    messages: ConversationMessage[]
  ): Promise<ConversationalMessageResponse> => {
    const userMessages = messages.filter((m) => m.role === 'user');
    const exchangeCount = Math.floor(messages.length / 2);

    // First message - analyze and ask first contextual question
    if (messages.length === 1 && userMessages[0]) {
      const initialDescription = userMessages[0].content;
      const analysis = analyzeMessageDescription(initialDescription);

      // Pick the most relevant question based on domain analysis
      if (analysis.contextualQuestions.length > 0) {
        const firstQuestion = analysis.contextualQuestions[0];
        return {
          type: 'question',
          question: firstQuestion || `What specific behavior should this system message guide?`,
        };
      }
    }

    // Second exchange - ask another contextual question
    if (exchangeCount === 1 && userMessages[0]) {
      const initialDescription = userMessages[0].content;
      const analysis = analyzeMessageDescription(initialDescription);

      // Get the second question
      if (analysis.contextualQuestions.length > 1) {
        const secondQuestion = analysis.contextualQuestions[1];
        return {
          type: 'question',
          question: secondQuestion || 'What priority should this message have relative to other system messages?',
        };
      }
    }

    // Third exchange or more - generate the profile using AI
    if (exchangeCount >= 2 || messages.length >= 4) {
      // Build conversation summary for AI
      const conversationSummary = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
        .join('\n\n');

      const prompt = `Based on this conversation, generate a complete system message profile:

${conversationSummary}

Generate the JSON profile now. Remember: ONLY valid JSON, no other text.`;

      try {
        const response = await orchestratorClient.sendMessage(prompt, {
          system: PROFILE_GENERATOR_PROMPT,
          temperature: 0.7,
        });

        // Extract the response text
        let responseText = '';
        if (typeof response === 'string') {
          responseText = response;
        } else if (response && typeof response === 'object') {
          if ('text' in response) {
            responseText = response.text as string;
          } else if ('content' in response && Array.isArray(response.content)) {
            for (const block of response.content) {
              if (block && typeof block === 'object' && 'text' in block) {
                responseText += block.text;
              }
            }
          }
        }

        // Extract JSON from response
        let jsonStr = responseText.trim();

        // Remove markdown code fences if present
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          jsonStr = jsonMatch[1]?.trim() || jsonStr;
        }

        // Find JSON object
        const startBrace = jsonStr.indexOf('{');
        const endBrace = jsonStr.lastIndexOf('}');
        if (startBrace !== -1 && endBrace !== -1) {
          jsonStr = jsonStr.slice(startBrace, endBrace + 1);
        }

        const profile = JSON.parse(jsonStr);

        // Validate and sanitize
        if (!profile.id || !profile.type || !profile.content) {
          throw new Error('Missing required profile fields');
        }

        const safeId = String(profile.id)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/--+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48);

        return {
          type: 'profile',
          profile: {
            id: safeId || `message-${Date.now()}`,
            type: profile.type,
            displayName: profile.displayName || safeId,
            description: String(profile.description || '').slice(0, 200),
            priority: typeof profile.priority === 'number' ? profile.priority : 50,
            content: String(profile.content),
          },
        };
      } catch (error: any) {
        // Fallback: generate a reasonable profile from conversation
        console.error('AI profile generation failed:', error.message);

        const initialDescription = userMessages[0]?.content || 'custom message';
        const allUserInput = userMessages.map((m) => m.content).join(' ');
        const analysis = analyzeMessageDescription(allUserInput);

        const safeId = initialDescription
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 48) || `message-${Date.now()}`;

        return {
          type: 'profile',
          profile: {
            id: safeId,
            type: analysis.suggestedType,
            displayName: initialDescription.slice(0, 50),
            description: initialDescription.slice(0, 200),
            priority: analysis.suggestedPriority,
            content: `# ${initialDescription.slice(0, 50)}

## Overview

${allUserInput}

## Guidelines

- Follow the instructions described above
- Be thorough and consistent in applying these guidelines
- Ask for clarification when the situation is ambiguous

## Examples

Consider these scenarios when applying this guidance:
- Standard cases should follow the main guidelines
- Edge cases may require additional consideration`,
          },
        };
      }
    }

    // Fallback - ask a contextual question based on what we know
    const allText = userMessages.map((m) => m.content).join(' ');
    const analysis = analyzeMessageDescription(allText);

    // Try to find an unused question
    const questionIndex = Math.min(exchangeCount, analysis.contextualQuestions.length - 1);
    const question = analysis.contextualQuestions[questionIndex] ||
      'What examples or scenarios should this system message address?';

    return {
      type: 'question',
      question,
    };
  };
}

/**
 * Create an AI edit assistant using the orchestrator
 */
function createEditAssistant(
  orchestratorClient: OrchestratorClient
): (currentContent: string, editRequest: string) => Promise<{ content: string; summary: string }> {
  return async (currentContent: string, editRequest: string) => {
    const prompt = `Current system message content:

\`\`\`markdown
${currentContent}
\`\`\`

User's modification request: "${editRequest}"

Generate the updated content as JSON. Remember: ONLY valid JSON, no other text.`;

    try {
      const response = await orchestratorClient.sendMessage(prompt, {
        system: EDIT_ASSISTANT_PROMPT,
        temperature: 0.7,
      });

      // Extract the response text
      let responseText = '';
      if (typeof response === 'string') {
        responseText = response;
      } else if (response && typeof response === 'object') {
        if ('text' in response) {
          responseText = response.text as string;
        } else if ('content' in response && Array.isArray(response.content)) {
          for (const block of response.content) {
            if (block && typeof block === 'object' && 'text' in block) {
              responseText += block.text;
            }
          }
        }
      }

      // Extract JSON from response
      let jsonStr = responseText.trim();

      // Remove markdown code fences if present
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1]?.trim() || jsonStr;
      }

      // Find JSON object
      const startBrace = jsonStr.indexOf('{');
      const endBrace = jsonStr.lastIndexOf('}');
      if (startBrace !== -1 && endBrace !== -1) {
        jsonStr = jsonStr.slice(startBrace, endBrace + 1);
      }

      const result = JSON.parse(jsonStr);

      if (!result.content || typeof result.content !== 'string') {
        throw new Error('Invalid response: missing content');
      }

      return {
        content: result.content,
        summary: result.summary || 'Content updated based on your request',
      };
    } catch (error: any) {
      console.error('AI edit failed:', error.message);
      throw new Error(`AI edit failed: ${error.message}`);
    }
  };
}

/**
 * Run system message management command
 *
 * @param config - Command configuration
 */
export async function runSystemMessageCommand(config: SystemMessageCommandConfig): Promise<void> {
  // Ensure runtime directory exists
  await fs.mkdir(config.runtimeDir, { recursive: true });
  await fs.mkdir(path.join(config.runtimeDir, 'messages'), { recursive: true });

  // Initialize store
  const store = new SystemMessageStore({
    builtinDir: config.builtinDir,
    runtimeDir: config.runtimeDir,
    workspaceDir: config.workspaceDir,
    enableWatching: true,
    debug: config.debug || false,
  });

  await store.initialize();

  // Create AI generators if orchestrator is available
  let generateProfile: SystemMessageProfileGenerator | undefined;
  let conversationalCreator: ConversationalMessageCreator | undefined;
  let editAssistant: ((content: string, request: string) => Promise<{ content: string; summary: string }>) | undefined;

  if (config.orchestratorClient) {
    generateProfile = createProfileGenerator(config.orchestratorClient);
    conversationalCreator = createConversationalCreator(config.orchestratorClient);
    editAssistant = createEditAssistant(config.orchestratorClient);
  }

  // Render interactive menu
  const { unmount, waitUntilExit } = render(
    React.createElement(InteractiveMenu, {
      store,
      runtimeDir: config.runtimeDir,
      builtinDir: config.builtinDir,
      initialMessageId: config.initialMessageId,
      generateProfile,
      conversationalCreator,
      editAssistant,
      onExit: () => {
        // Use unmount for graceful return to CLI instead of exit() which kills the process
        unmount();
      },
    })
  );

  // Wait for user to exit
  await waitUntilExit();

  // Cleanup
  await store.destroy();
}

/**
 * Create and run system message command with context-aware paths
 *
 * Uses the core library's ContextResolver to determine where to store/read customizations:
 * - Workspace context: {workspaceRoot}/.cortex/system-messages/
 * - Project context: {projectDir}/.cortex/system-messages/
 * - Global context: ~/.cortex/system-messages/
 *
 * Built-in messages always come from the installed package location.
 *
 * @param cwd - Current working directory (typically process.cwd())
 * @param options - Additional options
 */
export async function createSystemMessageCommand(
  cwd: string,
  options: {
    debug?: boolean;
    initialMessageId?: string;
    orchestratorClient?: OrchestratorClient;
  } = {}
): Promise<void> {
  // Use core library's ContextResolver for consistent context-aware path resolution
  const { resolveContext } = await import('@nexus-cortex/core/utils/ContextResolver.js');
  const context = resolveContext({ cwd, debug: options.debug });

  // Runtime directory from context resolver (systemMessagesDir is the full path)
  const runtimeDir = context.systemMessagesDir;

  // Builtin directory: find relative to installed package using import.meta.url
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const currentFile = fileURLToPath(import.meta.url);
  // From packages/cli/dist/commands/system-message, go to packages/core/dist/system-messages
  const cliDistDir = dirname(dirname(dirname(currentFile))); // packages/cli/dist
  const packagesDir = dirname(dirname(cliDistDir)); // packages/
  const builtinDir = join(packagesDir, 'core', 'dist', 'system-messages');

  // Check if builtin directory exists
  try {
    await fs.access(builtinDir);
  } catch {
    throw new Error(
      `Builtin messages directory not found at ${builtinDir}. ` +
        `Please build the core package first: npm run build`
    );
  }

  if (options.debug) {
    console.log(`[SystemMessage] Context level: ${context.contextLevel}`);
    console.log(`[SystemMessage] Context root: ${context.contextRoot}`);
    console.log(`[SystemMessage] Runtime dir: ${runtimeDir}`);
    console.log(`[SystemMessage] Builtin dir: ${builtinDir}`);
  }

  await runSystemMessageCommand({
    runtimeDir,
    builtinDir,
    debug: options.debug,
    initialMessageId: options.initialMessageId,
    orchestratorClient: options.orchestratorClient,
  });
}

/**
 * Export components for external use
 */
export { InteractiveMenu } from './InteractiveMenu.js';
export { EditorLauncher } from './EditorLauncher.js';
export type {
  SystemMessageProfileGenerator,
  ConversationalMessageCreator,
  ConversationMessage,
  ConversationalMessageResponse,
  GeneratedMessageProfile,
} from './InteractiveMenu.js';
