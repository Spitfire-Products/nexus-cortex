/**
 * Agent Management Command
 *
 * Entry point for /agent slash command
 * Launches interactive menu for managing Task Agent profiles
 * with AI-powered agent creation
 */

import React from 'react';
import { render } from 'ink';
import { AgentStore } from '@nexus-cortex/core';
import {
  InteractiveAgentMenu,
  type AgentProfileGenerator,
  type ModelListFn,
  type ConversationalAgentCreator,
  type ConversationMessage,
  type ConversationalAgentResponse,
  type EditAssistantFn,
} from './InteractiveAgentMenu.js';
import { OrchestratorClient } from '@nexus-cortex/cli/dist/orchestrator/OrchestratorClient.js';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Configuration for agent command
 */
export interface AgentCommandConfig {
  /** Project root directory */
  projectRoot: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Optional initial agent name to select */
  initialAgentName?: string;

  /** Current model ID (for inherit option) */
  currentModel?: string;

  /** Orchestrator client for AI generation */
  orchestratorClient?: OrchestratorClient;
}

/**
 * System prompt for generating agent profiles
 */
const AGENT_GENERATOR_PROMPT = `You are an expert at designing Task Agent profiles for an AI development CLI.

Given a user's description of what they want an agent to do, generate a complete agent profile.

IMPORTANT: Your response must be ONLY valid JSON with no markdown code fences or other text.

The JSON must have exactly these fields:
{
  "name": "agent-name-in-kebab-case",
  "description": "A clear, concise description of what this agent does (max 200 chars)",
  "tools": ["Tool1", "Tool2"] or "all",
  "systemPrompt": "The complete system prompt for the agent"
}

Available tools to choose from:
- Read: Read file contents
- Write: Write/create files
- Edit: Edit existing files
- Glob: Find files by pattern
- Grep: Search file contents
- Bash: Execute shell commands
- WebSearch: Search the web
- WebFetch: Fetch web pages
- TodoCreate: Create individual tasks
- TodoUpdate: Update task status by ID
- TodoList: List all tasks with progress
- AskUserQuestion: Ask user questions

Guidelines for the system prompt:
1. Start with a clear role definition ("You are a...")
2. List the agent's key responsibilities
3. Include approach/methodology section
4. Add specific guidelines and constraints
5. Define output format expectations
6. Be specific and actionable

Guidelines for tool selection:
- Only include tools the agent actually needs
- Use "all" only for agents that truly need unrestricted access
- Read-only agents: Read, Glob, Grep
- Analysis agents: Read, Glob, Grep, maybe WebSearch
- Code modification agents: Read, Write, Edit, Glob, Grep, Bash
- Research agents: Read, Glob, Grep, WebSearch, WebFetch

The name should be:
- Lowercase, hyphenated (kebab-case)
- Descriptive but concise (max 32 chars)
- No special characters except hyphens`;

/**
 * Create an AI profile generator using the orchestrator
 */
function createProfileGenerator(
  orchestratorClient: OrchestratorClient
): AgentProfileGenerator {
  return async (description: string, _selectedModel: string) => {
    const prompt = `Create an agent profile for the following description:

"${description}"

Remember: Respond with ONLY valid JSON, no markdown code fences.`;

    try {
      // Send message to orchestrator with system prompt for agent generation
      const response = await orchestratorClient.sendMessage(prompt, {
        system: AGENT_GENERATOR_PROMPT,
        temperature: 0.7,
      });

      // Extract the response text
      let responseText = '';
      if (typeof response === 'string') {
        responseText = response;
      } else if (response && typeof response === 'object') {
        // Handle streaming or complex response
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
      if (!profile.name || typeof profile.name !== 'string') {
        throw new Error('Invalid profile: missing or invalid name');
      }
      if (!profile.description || typeof profile.description !== 'string') {
        throw new Error('Invalid profile: missing or invalid description');
      }
      if (!profile.tools || (profile.tools !== 'all' && !Array.isArray(profile.tools))) {
        throw new Error('Invalid profile: missing or invalid tools');
      }
      if (!profile.systemPrompt || typeof profile.systemPrompt !== 'string') {
        throw new Error('Invalid profile: missing or invalid systemPrompt');
      }

      // Sanitize name
      const safeName = profile.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);

      return {
        name: safeName || `agent-${Date.now()}`,
        description: profile.description.slice(0, 200),
        tools: profile.tools,
        systemPrompt: profile.systemPrompt,
      };
    } catch (error: any) {
      // If JSON parsing fails, create a fallback profile
      console.error('Failed to parse AI response:', error.message);

      const safeName = description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || `agent-${Date.now()}`;

      return {
        name: safeName,
        description: description.slice(0, 200),
        tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'] as string[],
        systemPrompt: `# ${safeName}\n\n${description}\n\n## Your Role\n\nYou are a specialized agent designed to help with the tasks described above.\n\n## Guidelines\n\n- Be thorough and methodical in your approach\n- Explain your reasoning clearly\n- Ask for clarification when requirements are ambiguous\n- Focus on quality over speed`,
      };
    }
  };
}

/**
 * Agent domain categories for intelligent question generation
 */
interface AgentDomain {
  keywords: string[];
  suggestedTools: string[];
  followUpQuestions: string[];
  domainName: string;
}

const AGENT_DOMAINS: AgentDomain[] = [
  {
    domainName: 'frontend',
    keywords: ['landing', 'page', 'ui', 'ux', 'design', 'frontend', 'react', 'vue', 'html', 'css', 'website', 'web', 'interface', 'component', 'layout'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebFetch'],
    followUpQuestions: [
      'What tech stack should this agent use? (React, Vue, vanilla HTML/CSS, Tailwind, etc.)',
      'Should the agent focus on responsive design, accessibility, or specific design patterns?',
      'What style/aesthetic should the generated designs follow? (minimal, corporate, playful, dark mode, etc.)',
    ],
  },
  {
    domainName: 'backend',
    keywords: ['api', 'server', 'backend', 'database', 'rest', 'graphql', 'endpoint', 'service', 'microservice'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    followUpQuestions: [
      'What language/framework should this agent work with? (Node.js, Python, Go, etc.)',
      'Should it handle database operations, authentication, or API design?',
      'Are there specific patterns to follow? (REST, GraphQL, middleware patterns)',
    ],
  },
  {
    domainName: 'security',
    keywords: ['security', 'audit', 'vulnerability', 'pentest', 'owasp', 'scan', 'exploit', 'secure', 'authentication', 'authorization'],
    suggestedTools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch'],
    followUpQuestions: [
      'What type of security analysis? (code review, dependency scanning, penetration testing concepts)',
      'Should it check for specific vulnerability types? (OWASP Top 10, CWE categories)',
      'Should it provide remediation guidance or just identify issues?',
    ],
  },
  {
    domainName: 'testing',
    keywords: ['test', 'testing', 'unit', 'integration', 'e2e', 'spec', 'coverage', 'qa', 'quality'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    followUpQuestions: [
      'What testing framework should it use? (Jest, Vitest, pytest, etc.)',
      'What types of tests? (unit, integration, e2e, snapshot)',
      'Should it focus on coverage goals or specific testing patterns?',
    ],
  },
  {
    domainName: 'documentation',
    keywords: ['doc', 'documentation', 'readme', 'comment', 'jsdoc', 'api doc', 'guide', 'tutorial', 'explain'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    followUpQuestions: [
      'What documentation format? (Markdown, JSDoc, API docs, README)',
      'Should it generate examples, diagrams, or just text descriptions?',
      'What audience level? (beginner-friendly, technical reference, internal team)',
    ],
  },
  {
    domainName: 'refactoring',
    keywords: ['refactor', 'clean', 'optimize', 'improve', 'restructure', 'modernize', 'migrate', 'upgrade'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    followUpQuestions: [
      'What aspects to focus on? (performance, readability, maintainability, patterns)',
      'Are there specific coding standards or style guides to follow?',
      'Should it preserve backward compatibility or make breaking changes?',
    ],
  },
  {
    domainName: 'devops',
    keywords: ['deploy', 'docker', 'kubernetes', 'ci', 'cd', 'pipeline', 'infrastructure', 'aws', 'cloud', 'terraform'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    followUpQuestions: [
      'What platform/tools? (Docker, Kubernetes, AWS, GCP, Azure)',
      'What type of automation? (CI/CD pipelines, infrastructure as code, monitoring)',
      'Should it handle secrets management or environment configuration?',
    ],
  },
  {
    domainName: 'data',
    keywords: ['data', 'analysis', 'analytics', 'etl', 'pipeline', 'transform', 'parse', 'csv', 'json', 'database', 'sql'],
    suggestedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
    followUpQuestions: [
      'What data formats does it need to handle? (JSON, CSV, databases, APIs)',
      'Should it perform analysis, transformation, or visualization?',
      'Are there specific data quality or validation requirements?',
    ],
  },
  {
    domainName: 'research',
    keywords: ['research', 'find', 'search', 'explore', 'investigate', 'analyze', 'understand', 'learn', 'discover'],
    suggestedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    followUpQuestions: [
      'What sources should it search? (codebase, web, documentation)',
      'Should it provide summaries, detailed reports, or actionable recommendations?',
      'What depth of analysis? (quick overview vs. comprehensive deep-dive)',
    ],
  },
];

/**
 * Analyze user description to detect domain and context
 */
function analyzeAgentDescription(description: string): {
  detectedDomains: AgentDomain[];
  suggestedTools: string[];
  contextualQuestions: string[];
} {
  const lowerDesc = description.toLowerCase();
  const detectedDomains: AgentDomain[] = [];

  // Find matching domains
  for (const domain of AGENT_DOMAINS) {
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

  // Collect suggested tools from detected domains
  const toolSet = new Set<string>();
  for (const domain of detectedDomains) {
    for (const tool of domain.suggestedTools) {
      toolSet.add(tool);
    }
  }

  // Build contextual questions based on detected domains
  const contextualQuestions: string[] = [];
  if (detectedDomains.length > 0) {
    // Get questions from the most relevant domain
    const primaryDomain = detectedDomains[0];
    if (primaryDomain) {
      contextualQuestions.push(...primaryDomain.followUpQuestions);
    }
  }

  // Add generic but useful questions if we don't have domain-specific ones
  if (contextualQuestions.length === 0) {
    contextualQuestions.push(
      `What specific outputs should this "${description}" agent produce?`,
      'What constraints or quality standards should the agent follow?',
      'Should the agent modify files, or just analyze and report?',
    );
  }

  return {
    detectedDomains,
    suggestedTools: Array.from(toolSet),
    contextualQuestions,
  };
}

/**
 * System prompt for generating the final agent profile
 */
const PROFILE_GENERATOR_PROMPT = `You are an expert at designing Task Agent profiles for an AI development CLI.

Based on the conversation below, generate a complete agent profile.

Your response must be ONLY valid JSON with this exact structure:
{
  "name": "agent-name-kebab-case",
  "description": "A clear, concise description (max 200 chars)",
  "tools": ["Tool1", "Tool2"],
  "systemPrompt": "# Agent Name\\n\\nFull system prompt with role, responsibilities, guidelines, and constraints..."
}

Available tools: Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch, TodoCreate, TodoUpdate, TodoList, AskUserQuestion

Guidelines:
- The name should be lowercase, hyphenated, max 32 chars
- Choose specific tools needed, not "all" unless truly necessary
- The systemPrompt should be comprehensive: include role definition, key responsibilities, approach, specific guidelines, output format expectations
- Make the systemPrompt actionable and specific to the agent's purpose

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

/**
 * Create a conversational agent creator using the orchestrator
 *
 * Uses intelligent domain detection to ask relevant follow-up questions,
 * then uses AI only for generating the final profile.
 */
function createConversationalCreator(
  orchestratorClient: OrchestratorClient
): ConversationalAgentCreator {
  return async (
    messages: ConversationMessage[],
    _selectedModel: string
  ): Promise<ConversationalAgentResponse> => {
    const userMessages = messages.filter((m) => m.role === 'user');
    const exchangeCount = Math.floor(messages.length / 2);

    // First message - analyze and ask first contextual question
    if (messages.length === 1 && userMessages[0]) {
      const initialDescription = userMessages[0].content;
      const analysis = analyzeAgentDescription(initialDescription);

      // Pick the most relevant question based on domain analysis
      if (analysis.contextualQuestions.length > 0) {
        const firstQuestion = analysis.contextualQuestions[0];
        return {
          type: 'question',
          question: firstQuestion || `What specific capabilities should this agent have?`,
        };
      }
    }

    // Second exchange - ask another contextual question
    if (exchangeCount === 1 && userMessages[0]) {
      const initialDescription = userMessages[0].content;
      const analysis = analyzeAgentDescription(initialDescription);

      // Get the second question
      if (analysis.contextualQuestions.length > 1) {
        const secondQuestion = analysis.contextualQuestions[1];
        return {
          type: 'question',
          question: secondQuestion || 'What quality standards or constraints should this agent follow?',
        };
      }
    }

    // Third exchange or more - generate the profile using AI
    if (exchangeCount >= 2 || messages.length >= 4) {
      // Build conversation summary for AI
      const conversationSummary = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
        .join('\n\n');

      const prompt = `Based on this conversation, generate a complete agent profile:

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
        if (!profile.name || !profile.description || !profile.systemPrompt) {
          throw new Error('Missing required profile fields');
        }

        const safeName = String(profile.name)
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/--+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 32);

        return {
          type: 'profile',
          profile: {
            name: safeName || `agent-${Date.now()}`,
            description: String(profile.description).slice(0, 200),
            tools: Array.isArray(profile.tools) ? profile.tools : ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
            systemPrompt: String(profile.systemPrompt),
          },
        };
      } catch (error: any) {
        // Fallback: generate a reasonable profile from conversation
        console.error('AI profile generation failed:', error.message);

        const initialDescription = userMessages[0]?.content || 'custom agent';
        const allUserInput = userMessages.map((m) => m.content).join(' ');
        const analysis = analyzeAgentDescription(allUserInput);

        const safeName = initialDescription
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 32) || `agent-${Date.now()}`;

        const tools = analysis.suggestedTools.length > 0
          ? analysis.suggestedTools
          : ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

        return {
          type: 'profile',
          profile: {
            name: safeName,
            description: initialDescription.slice(0, 200),
            tools,
            systemPrompt: `# ${safeName}

## Your Role

You are a specialized ${initialDescription} agent.

## Context from User

${allUserInput}

## Responsibilities

- Understand and fulfill requests related to ${initialDescription}
- Use available tools effectively to accomplish tasks
- Provide clear explanations of your actions
- Ask for clarification when requirements are ambiguous

## Guidelines

- Be thorough and methodical in your approach
- Focus on quality and correctness
- Explain your reasoning when making decisions
- Follow best practices for the domain

## Output Format

Provide clear, well-structured output appropriate to the task.`,
          },
        };
      }
    }

    // Fallback - ask a contextual question based on what we know
    const allText = userMessages.map((m) => m.content).join(' ');
    const analysis = analyzeAgentDescription(allText);

    // Try to find an unused question
    const questionIndex = Math.min(exchangeCount, analysis.contextualQuestions.length - 1);
    const question = analysis.contextualQuestions[questionIndex] ||
      'What output format or deliverables should this agent produce?';

    return {
      type: 'question',
      question,
    };
  };
}

/**
 * System prompt for AI-assisted agent editing
 */
const EDIT_ASSISTANT_PROMPT = `You are an expert at editing Task Agent profiles for an AI development CLI.

Given the current agent definition (in YAML frontmatter + markdown format) and the user's edit request,
produce an updated version of the agent that incorporates the requested changes.

IMPORTANT:
1. Preserve the YAML frontmatter structure exactly (---, fields, ---)
2. Only modify what the user requested
3. Maintain the existing style and tone
4. Keep all fields that weren't mentioned in the edit request
5. Return ONLY the updated content, no explanations

The agent file format is:
---
name: agent-name
description: Short description
model: model-id
tools:
  - Tool1
  - Tool2
---

# Agent Name

System prompt content here...

After providing the updated content, also provide a brief summary of what was changed.

Response format (JSON):
{
  "content": "---\\nname: ...\\n---\\n\\n# Agent Name\\n\\nUpdated content...",
  "summary": "Brief description of changes made"
}`;

/**
 * Create an edit assistant using the orchestrator
 */
function createEditAssistant(
  orchestratorClient: OrchestratorClient
): EditAssistantFn {
  return async (
    currentContent: string,
    editRequest: string,
    agentName: string
  ): Promise<{ content: string; summary: string }> => {
    const prompt = `Edit the following agent "${agentName}":

CURRENT CONTENT:
\`\`\`
${currentContent}
\`\`\`

USER'S EDIT REQUEST:
"${editRequest}"

Apply the requested changes and return the updated content as JSON with "content" and "summary" fields.`;

    try {
      const response = await orchestratorClient.sendMessage(prompt, {
        system: EDIT_ASSISTANT_PROMPT,
        temperature: 0.3, // Lower temperature for more precise edits
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
      const result = JSON.parse(jsonStr);

      if (!result.content || typeof result.content !== 'string') {
        throw new Error('Invalid response: missing content field');
      }

      return {
        content: result.content,
        summary: result.summary || 'Agent updated',
      };
    } catch (error: any) {
      // If JSON parsing fails, try to extract content directly
      console.error('Failed to parse AI edit response:', error.message);
      throw new Error(`AI edit failed: ${error.message}`);
    }
  };
}

/**
 * Run agent management command
 *
 * @param config - Command configuration
 */
export async function runAgentCommand(config: AgentCommandConfig): Promise<void> {
  const projectDir = path.join(config.projectRoot, '.cortex', 'agents');

  // Ensure agents directory exists
  await fs.mkdir(projectDir, { recursive: true });

  // Initialize store
  const store = new AgentStore({
    projectDir,
    enableWatching: true,
    debug: config.debug || false,
  });

  await store.initialize();

  // Create profile generator, conversational creator, edit assistant, and model list function if orchestrator is available
  let generateAgentProfile: AgentProfileGenerator | undefined;
  let conversationalCreator: ConversationalAgentCreator | undefined;
  let editAssistant: EditAssistantFn | undefined;
  let listModels: ModelListFn | undefined;

  if (config.orchestratorClient) {
    generateAgentProfile = createProfileGenerator(config.orchestratorClient);
    conversationalCreator = createConversationalCreator(config.orchestratorClient);
    editAssistant = createEditAssistant(config.orchestratorClient);
    // Wrap listModels to match the expected signature
    listModels = async () => {
      const models = await config.orchestratorClient!.listModels();
      return models;
    };
  }

  // Render interactive menu
  const { unmount, waitUntilExit } = render(
    React.createElement(InteractiveAgentMenu, {
      store,
      initialAgentName: config.initialAgentName,
      currentModel: config.currentModel || 'sonnet',
      generateAgentProfile,
      conversationalCreator,
      editAssistant,
      listModels,
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
 * Create agent command with default paths
 *
 * @param projectRoot - Project root directory
 * @param options - Additional options
 */
export async function createAgentCommand(
  projectRoot: string,
  options: {
    debug?: boolean;
    initialAgentName?: string;
    currentModel?: string;
    orchestratorClient?: OrchestratorClient;
  } = {}
): Promise<void> {
  await runAgentCommand({
    projectRoot,
    debug: options.debug,
    initialAgentName: options.initialAgentName,
    currentModel: options.currentModel,
    orchestratorClient: options.orchestratorClient,
  });
}

/**
 * List agents (non-interactive)
 */
export async function listAgents(projectRoot: string): Promise<void> {
  const projectDir = path.join(projectRoot, '.cortex', 'agents');

  const store = new AgentStore({
    projectDir,
    enableWatching: false,
  });

  await store.initialize();

  const agents = store.getAll();

  if (agents.length === 0) {
    console.log('No agents found.');
    console.log(`Create agents in: ${projectDir}`);
  } else {
    console.log(`Found ${agents.length} agent(s):\n`);

    for (const agent of agents) {
      const locationIcon = agent.location === 'project' ? '[P]' : '[G]';
      const toolsInfo = agent.tools === 'all' ? 'all' : `${agent.tools.length} tools`;
      console.log(` ${locationIcon} ${agent.name}`);
      console.log(` Model: ${agent.model} | Tools: ${toolsInfo}`);
      console.log(` ${agent.description}`);
      console.log('');
    }
  }

  await store.destroy();
}

/**
 * Show agent info (non-interactive)
 */
export async function showAgentInfo(projectRoot: string, agentName: string): Promise<void> {
  const projectDir = path.join(projectRoot, '.cortex', 'agents');

  const store = new AgentStore({
    projectDir,
    enableWatching: false,
  });

  await store.initialize();

  const agent = store.getAgent(agentName);

  if (!agent) {
    console.error(`Agent '${agentName}' not found.`);
    await store.destroy();
    return;
  }

  console.log(`\nAgent: ${agent.name}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Location:    ${agent.location}`);
  console.log(`Model:       ${agent.model}`);
  console.log(`Tools:       ${agent.tools === 'all' ? 'all' : agent.tools.join(', ')}`);
  console.log(`File:        ${agent.filePath}`);
  console.log(`Description: ${agent.description}`);
  console.log(`\nSystem Prompt:`);
  console.log(`${'─'.repeat(50)}`);
  console.log(agent.systemPrompt);

  await store.destroy();
}

/**
 * Export components for external use
 */
export { InteractiveAgentMenu } from './InteractiveAgentMenu.js';
export type {
  AgentProfileGenerator,
  ConversationalAgentCreator,
  ConversationMessage,
  ConversationalAgentResponse,
  EditAssistantFn,
} from './InteractiveAgentMenu.js';
