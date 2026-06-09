import * as fs from 'fs';
import * as path from 'path';

/**
 * Dynamically discover available agents from the .cortex/agents folder
 * Returns a list of agent types based on markdown files in the agents directory
 */
export function getAvailableAgents(): string[] {
  const agents: string[] = ['general-purpose']; // Always include general-purpose

  try {
    // Check multiple possible locations for agents
    const possiblePaths = [
      path.join(process.cwd(), '.cortex', 'agents'),
      path.join(process.env.HOME || process.env.USERPROFILE || '', '.cortex', 'agents'),
    ];

    for (const agentsPath of possiblePaths) {
      if (fs.existsSync(agentsPath)) {
        const files = fs.readdirSync(agentsPath);

        // Find all .md files and extract agent names
        files.forEach(file => {
          if (file.endsWith('.md')) {
            // Remove .md extension to get agent type
            const agentType = file.replace('.md', '');
            if (!agents.includes(agentType)) {
              agents.push(agentType);
            }
          }
        });

        break; // Use the first valid path found
      }
    }
  } catch (error) {
    console.error('Error discovering agents:', error);
    // Return default agents if discovery fails
  }

  return agents;
}

/**
 * Get a formatted string description of available agents for tool descriptions
 */
export function getAgentTypeDescription(): string {
  const agents = getAvailableAgents();

  if (agents.length === 0) {
    return 'Type of agent (check .cortex/agents/ for available types)';
  }

  // Format as "Options: agent1, agent2, agent3"
  return `Options: ${agents.join(', ')}`;
}

/**
 * Cache for agent discovery to avoid repeated file system reads
 */
let agentCache: { agents: string[]; timestamp: number } | null = null;
const CACHE_DURATION = 60000; // Cache for 1 minute

export function getAvailableAgentsCached(): string[] {
  const now = Date.now();

  // Return cached value if still valid
  if (agentCache && (now - agentCache.timestamp) < CACHE_DURATION) {
    return agentCache.agents;
  }

  // Refresh cache
  const agents = getAvailableAgents();
  agentCache = { agents, timestamp: now };

  return agents;
}

export function getAgentTypeDescriptionCached(): string {
  const agents = getAvailableAgentsCached();

  if (agents.length === 0) {
    return 'Type of agent (check .cortex/agents/ for available types)';
  }

  return `Options: ${agents.join(', ')}`;
}