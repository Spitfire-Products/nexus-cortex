/**
 * Sandbox React-introspection tools: SandboxScan, SandboxGrab, SandboxDetectFramework.
 *
 * These expose the SAME contract as the nexus-browser MCP's scan/grab/detect_framework
 * (provider names: sandbox_scan / sandbox_grab / sandbox_detect_framework), so a model
 * that learned the scan -> act -> scan loop against the remote browser uses the
 * identical muscle memory against a LOCAL artifact:
 *  - scan elements carry a unique `cssSelector` (reusable in InteractWithSandbox)
 *  - grab results are auto-enriched with
 *    `react: { componentName, componentStack, props, sourceLocation }` on React pages
 *  - detect_framework returns the same schema (react/reactVersion/next/.../heavyLibraries)
 *
 * Introspection auto-enables on first use (addInitScript before navigation); non-React
 * artifacts degrade gracefully (fiber fields simply absent).
 */
import { BaseTool } from '../../base/BaseTool.js';
import type { ToolResult } from '../../base/ToolResult.js';
import { CreateArtifactToolExecutor } from './CreateArtifactTool.js';
import { visualBridge } from './VisualFeedbackBridge.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveSandboxUrl(sandboxId: string): { url: string } | { error: string } {
  const session = CreateArtifactToolExecutor.getActiveSandbox(sandboxId);
  if (!session) {
    return { error: `Sandbox not found: ${sandboxId}. It may have been stopped or never existed.` };
  }
  if (!session.url) {
    return { error: 'Sandbox has no URL (not a web server artifact)' };
  }
  session.lastActivity = new Date();
  return { url: session.url };
}

export interface SandboxScanParams {
  sandboxId: string;
  filter?: {
    tagName?: string;
    hasText?: string;
    isInteractive?: boolean;
    id?: string;
    className?: string;
    placeholder?: string;
    name?: string;
    componentName?: string;
  };
  limit?: number;
  includeOffscreen?: boolean;
}

export class SandboxScanExecutor extends BaseTool<SandboxScanParams, ToolResult> {
  constructor() {
    super(
      'SandboxScan',
      'SandboxScan',
      'Discover elements in a running sandbox; same contract as the nexus-browser scan tool',
      {
        type: 'object' as const,
        properties: {
          sandboxId: { type: 'string' as const, description: 'ID of the sandbox to scan' },
          filter: {
            type: 'object' as const,
            properties: {
              tagName: { type: 'string' as const, description: "Exact lowercase tag match, e.g. 'button'" },
              hasText: { type: 'string' as const, description: 'Case-insensitive substring of textContent' },
              isInteractive: { type: 'boolean' as const, description: 'Only interactive elements (buttons, inputs, links...)' },
              id: { type: 'string' as const, description: 'Exact id attribute' },
              className: { type: 'string' as const, description: 'classList.contains() match' },
              placeholder: { type: 'string' as const, description: 'Case-insensitive placeholder substring' },
              name: { type: 'string' as const, description: 'Exact name attribute' },
              componentName: { type: 'string' as const, description: 'React component name (React artifacts only)' }
            },
            description: 'Element filters (all optional, combined with AND)'
          },
          limit: { type: 'number' as const, description: 'Max elements returned (default 30, max 100)' },
          includeOffscreen: { type: 'boolean' as const, description: 'Include elements outside the viewport' }
        },
        required: ['sandboxId' as const]
      }
    );
  }

  validateToolParams(params: SandboxScanParams): string | null {
    if (!params.sandboxId || !UUID_RE.test(params.sandboxId)) return 'sandboxId must be a valid UUID';
    return null;
  }

  async execute(params: SandboxScanParams, _signal: AbortSignal): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) return this.createErrorResult(validationError);

    const target = resolveSandboxUrl(params.sandboxId);
    if ('error' in target) return this.createErrorResult(target.error);

    try {
      await visualBridge.initialize();
      const result = await visualBridge.sandboxScan(target.url, {
        filter: params.filter,
        limit: params.limit,
        includeOffscreen: params.includeOffscreen
      });
      const lines = [
        `Scan: ${result.count} element(s)${result.truncated ? ' (truncated — refine filter or raise limit)' : ''}`,
        '',
        '```json',
        JSON.stringify(result.elements, null, 2),
        '```',
        '',
        'Use an element\'s `cssSelector` with InteractWithSandbox (click/type) — then scan again to verify.'
      ];
      return {
        ...this.createSuccessResult(lines.join('\n')),
        metadata: { sandboxId: params.sandboxId, count: result.count, truncated: result.truncated }
      };
    } catch (error) {
      return this.createErrorResult(`Scan failed: ${(error as Error).message}`);
    }
  }
}

export interface SandboxGrabParams {
  sandboxId: string;
  selector?: string;
  x?: number;
  y?: number;
  maxLength?: number;
}

export class SandboxGrabExecutor extends BaseTool<SandboxGrabParams, ToolResult> {
  constructor() {
    super(
      'SandboxGrab',
      'SandboxGrab',
      'Query one element in a running sandbox (DOM detail + React component info); same contract as the nexus-browser grab tool',
      {
        type: 'object' as const,
        properties: {
          sandboxId: { type: 'string' as const, description: 'ID of the sandbox' },
          selector: { type: 'string' as const, description: 'CSS selector (use cssSelector from sandbox_scan)' },
          x: { type: 'number' as const, description: 'X coordinate (alternative to selector)' },
          y: { type: 'number' as const, description: 'Y coordinate (alternative to selector)' },
          maxLength: { type: 'number' as const, description: 'Max textContent length (default 500)' }
        },
        required: ['sandboxId' as const]
      }
    );
  }

  validateToolParams(params: SandboxGrabParams): string | null {
    if (!params.sandboxId || !UUID_RE.test(params.sandboxId)) return 'sandboxId must be a valid UUID';
    if (!params.selector && (typeof params.x !== 'number' || typeof params.y !== 'number')) {
      return 'Provide selector OR both x and y coordinates';
    }
    return null;
  }

  async execute(params: SandboxGrabParams, _signal: AbortSignal): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) return this.createErrorResult(validationError);

    const target = resolveSandboxUrl(params.sandboxId);
    if ('error' in target) return this.createErrorResult(target.error);

    try {
      await visualBridge.initialize();
      const result = await visualBridge.sandboxGrab(target.url, {
        selector: params.selector,
        x: params.x,
        y: params.y,
        maxLength: params.maxLength
      });
      if (result?.error) return this.createErrorResult(result.error);

      const lines = ['```json', JSON.stringify(result, null, 2), '```'];
      if (result.react) {
        lines.push('', `React: <${result.react.componentName}>${result.react.sourceLocation ? ` (${result.react.sourceLocation})` : ''} — stack: ${result.react.componentStack.join(' < ')}`);
      }
      return {
        ...this.createSuccessResult(lines.join('\n')),
        metadata: { sandboxId: params.sandboxId, hasReactInfo: !!result.react }
      };
    } catch (error) {
      return this.createErrorResult(`Grab failed: ${(error as Error).message}`);
    }
  }
}

export interface SandboxDetectFrameworkParams {
  sandboxId: string;
}

export class SandboxDetectFrameworkExecutor extends BaseTool<SandboxDetectFrameworkParams, ToolResult> {
  constructor() {
    super(
      'SandboxDetectFramework',
      'SandboxDetectFramework',
      'Detect the frontend framework of a running sandbox; same schema as the nexus-browser detect_framework tool',
      {
        type: 'object' as const,
        properties: {
          sandboxId: { type: 'string' as const, description: 'ID of the sandbox' }
        },
        required: ['sandboxId' as const]
      }
    );
  }

  validateToolParams(params: SandboxDetectFrameworkParams): string | null {
    if (!params.sandboxId || !UUID_RE.test(params.sandboxId)) return 'sandboxId must be a valid UUID';
    return null;
  }

  async execute(params: SandboxDetectFrameworkParams, _signal: AbortSignal): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) return this.createErrorResult(validationError);

    const target = resolveSandboxUrl(params.sandboxId);
    if ('error' in target) return this.createErrorResult(target.error);

    try {
      await visualBridge.initialize();
      const report = await visualBridge.sandboxDetect(target.url);
      return {
        ...this.createSuccessResult('```json\n' + JSON.stringify(report, null, 2) + '\n```'),
        metadata: { sandboxId: params.sandboxId, react: report.react, reactVersion: report.reactVersion }
      };
    } catch (error) {
      return this.createErrorResult(`Framework detection failed: ${(error as Error).message}`);
    }
  }
}
