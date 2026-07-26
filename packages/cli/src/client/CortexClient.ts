/**
 * HTTP Client for Nexus Cortex Server
 * Handles communication with localhost:4000 server
 */
import { Agent } from 'undici';

// Non-streaming turns return headers only when the FULL turn completes, so
// node fetch's built-in undici defaults (headersTimeout 300s) abort any slow
// local-model turn as a bare "fetch failed" — same class the autoresearch
// bench fixed with its long-timeout dispatcher (harnessProcess.ts). Slow
// think-mode arms legitimately exceed 5 minutes.
const CLIENT_FETCH_TIMEOUT_MS = parseInt(process.env.CORTEX_CLIENT_FETCH_TIMEOUT_MS || '900000', 10);
const longTimeoutAgent = new Agent({
  headersTimeout: CLIENT_FETCH_TIMEOUT_MS,
  bodyTimeout: CLIENT_FETCH_TIMEOUT_MS,
});

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  content?: any;
  tool_use_id?: string;
  is_error?: boolean;
}

export interface SendMessageOptions {
  model?: string;
  system?: string;
  tools?: any[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

export interface StreamEvent {
  type: string;
  [key: string]: any;
}

export interface ModelInfo {
  id: string;
  object: string;
  owned_by: string;
  displayName: string;
  apiPattern: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export interface ApprovalMode {
  autoApproveActions: boolean;
  yoloMode: boolean;
  context: string;
}

export class CortexClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:4000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Send a non-streaming message
   */
  async sendMessage(
    messages: Message[],
    options: SendMessageOptions = {}
  ): Promise<any> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        ...options,
        stream: false,
      }),
      // @ts-expect-error undici dispatcher option (node fetch honors it)
      dispatcher: longTimeoutAgent,
      signal: AbortSignal.timeout(CLIENT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error: any = await response.json();
      throw new Error(error.error?.message || 'Request failed');
    }

    return response.json();
  }

  /**
   * Stream messages with SSE
   */
  async *streamMessage(
    messages: Message[],
    options: SendMessageOptions = {}
  ): AsyncGenerator<StreamEvent> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        ...options,
        stream: true,
      }),
      // @ts-expect-error undici dispatcher option (node fetch honors it)
      dispatcher: longTimeoutAgent,
    });

    if (!response.ok) {
      const error: any = await response.json();
      throw new Error(error.error?.message || 'Request failed');
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data.trim()) {
              try {
                yield JSON.parse(data) as StreamEvent;
              } catch (e) {
                console.error('Failed to parse SSE data:', data);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * List all available models
   */
  async listModels(): Promise<ModelInfo[]> {
    const response = await fetch(`${this.baseUrl}/models`);

    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }

    const data: any = await response.json();
    return data.data as ModelInfo[];
  }

  /**
   * Check server health
   */
  async health(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/health`);

    if (!response.ok) {
      throw new Error('Health check failed');
    }

    return response.json() as Promise<any>;
  }

  /**
   * Get approval mode status
   */
  async getApprovalMode(): Promise<ApprovalMode> {
    const response = await fetch(`${this.baseUrl}/v1/approval-mode`);

    if (!response.ok) {
      throw new Error('Failed to get approval mode');
    }

    return response.json() as Promise<ApprovalMode>;
  }

  /**
   * Set approval mode
   */
  async setApprovalMode(autoApproveActions: boolean): Promise<any> {
    const response = await fetch(`${this.baseUrl}/v1/approval-mode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ autoApproveActions }),
    });

    if (!response.ok) {
      const error: any = await response.json();
      throw new Error(error.error?.message || 'Failed to set approval mode');
    }

    return response.json();
  }

  /**
   * Generic GET request
   */
  async get(path: string): Promise<any> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error: any = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `GET ${path} failed`);
    }

    return response.json();
  }

  /**
   * Generic POST request
   */
  async post(path: string, body: any): Promise<any> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error: any = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `POST ${path} failed`);
    }

    return response.json();
  }
}
