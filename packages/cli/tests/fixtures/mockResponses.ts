/**
 * Mock API responses for testing
 * Based on CLI_MASTER_SPECIFICATION.md Section 3 (66 models across 10 providers)
 */

export const mockModels = {
  models: [
    {
      id: 'claude-sonnet-4-5',
      provider: 'anthropic',
      contextWindow: 200000,
      maxOutputTokens: 8192,
      capabilities: {
        tools: true,
        vision: true,
        streaming: true,
        reasoning: false
      },
      pricing: {
        inputPerMillion: 3.0,
        outputPerMillion: 15.0
      }
    },
    {
      id: 'gpt-4o',
      provider: 'openai',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      capabilities: {
        tools: true,
        vision: true,
        streaming: true,
        reasoning: false
      },
      pricing: {
        inputPerMillion: 2.5,
        outputPerMillion: 10.0
      }
    },
    {
      id: 'gemini-2-5-flash',
      provider: 'google',
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      capabilities: {
        tools: true,
        vision: true,
        streaming: true,
        reasoning: false
      },
      pricing: {
        inputPerMillion: 0.075,
        outputPerMillion: 0.30
      }
    },
    {
      id: 'deepseek-chat',
      provider: 'deepseek',
      contextWindow: 64000,
      maxOutputTokens: 8192,
      capabilities: {
        tools: true,
        vision: false,
        streaming: true,
        reasoning: false
      },
      pricing: {
        inputPerMillion: 0.14,
        outputPerMillion: 0.28
      }
    }
  ]
};

export const mockModelInfo = {
  id: 'claude-sonnet-4-5',
  provider: 'anthropic',
  contextWindow: 200000,
  maxOutputTokens: 8192,
  capabilities: {
    tools: true,
    vision: true,
    streaming: true,
    reasoning: false
  },
  pricing: {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0
  },
  description: 'Claude Sonnet 4.5 - Best balance of intelligence and speed',
  bestFor: ['General tasks', 'Code generation', 'Analysis', 'Tool use']
};

export const mockSessions = [
  {
    id: 'session-123',
    model: 'claude-sonnet-4-5',
    createdAt: '2025-01-14T10:00:00Z',
    updatedAt: '2025-01-14T10:30:00Z',
    turnCount: 5,
    tokenCount: 12500,
    cost: 0.045
  },
  {
    id: 'session-456',
    model: 'gpt-4o',
    createdAt: '2025-01-13T15:00:00Z',
    updatedAt: '2025-01-13T16:00:00Z',
    turnCount: 10,
    tokenCount: 25000,
    cost: 0.125
  }
];

export const mockSessionDetails = {
  id: 'session-123',
  model: 'claude-sonnet-4-5',
  createdAt: '2025-01-14T10:00:00Z',
  updatedAt: '2025-01-14T10:30:00Z',
  turnCount: 5,
  tokenCount: 12500,
  cost: 0.045,
  messages: [
    {
      role: 'user',
      content: 'What is 2+2?'
    },
    {
      role: 'assistant',
      content: '2+2 equals 4.'
    },
    {
      role: 'user',
      content: 'What about 5+5?'
    },
    {
      role: 'assistant',
      content: '5+5 equals 10.'
    }
  ]
};

export const mockMcpServers = [
  {
    name: 'postgres',
    category: 'database',
    description: 'PostgreSQL database access',
    verified: true,
    toolCount: 8,
    status: 'disabled'
  },
  {
    name: 'filesystem',
    category: 'system',
    description: 'File system operations',
    verified: true,
    toolCount: 12,
    status: 'enabled'
  },
  {
    name: 'github',
    category: 'development',
    description: 'GitHub API integration',
    verified: true,
    toolCount: 15,
    status: 'disabled'
  }
];

export const mockMcpStatus = {
  enabledServers: ['filesystem'],
  disabledServers: ['postgres', 'github'],
  toolCount: 12,
  configPath: './MCP_CONFIG.md',
  scope: 'project'
};

export const mockHealthResponse = {
  status: 'ok',
  version: '1.0.0',
  uptime: 3600,
  memoryUsage: {
    heapUsed: 50000000,
    heapTotal: 100000000
  }
};

export const mockApprovalMode = {
  mode: 'interactive' as const,
  autoApproveActions: false,
  allowedActions: [] as string[]
};

export const mockMessageResponse = {
  id: 'msg-123',
  model: 'claude-sonnet-4-5',
  role: 'assistant' as const,
  content: [
    {
      type: 'text' as const,
      text: 'Hello! How can I help you today?'
    }
  ],
  stopReason: 'end_turn' as const,
  usage: {
    inputTokens: 10,
    outputTokens: 15
  }
};

export const mockStreamChunks = [
  {
    type: 'message_start',
    message: {
      id: 'msg-456',
      model: 'claude-sonnet-4-5',
      role: 'assistant' as const
    }
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text' as const,
      text: ''
    }
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'text_delta' as const,
      text: 'Hello'
    }
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'text_delta' as const,
      text: ' world'
    }
  },
  {
    type: 'content_block_stop',
    index: 0
  },
  {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn' as const
    },
    usage: {
      output_tokens: 2
    }
  },
  {
    type: 'message_stop'
  }
];

export const mockPermissionLogs = [
  {
    timestamp: '2025-01-14T10:00:00Z',
    sessionId: 'session-123',
    action: 'bash',
    command: 'ls -la',
    approved: true,
    mode: 'interactive'
  },
  {
    timestamp: '2025-01-14T10:05:00Z',
    sessionId: 'session-123',
    action: 'write',
    path: '/tmp/test.txt',
    approved: false,
    mode: 'interactive'
  }
];

export const mockStats = {
  totalSessions: 42,
  totalTokens: 1250000,
  totalCost: 15.75,
  averageTokensPerSession: 29762,
  averageCostPerSession: 0.375,
  modelUsage: {
    'claude-sonnet-4-5': 25,
    'gpt-4o': 10,
    'gemini-2-5-flash': 7
  }
};
