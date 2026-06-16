/**
 * Main /v1/messages endpoint
 * Thin wrapper around CortexOrchestrator
 */
import { Router, Request, Response } from 'express';
import { createOrchestrator, DEFAULT_SETTINGS, type OrchestratorConfig, type CortexOrchestrator, toolFactory } from '@nexus-cortex/core';

// Read lazily — ESM hoists imports before index.ts sets process.env.PROJECT_ROOT
function getProjectRoot(): string {
  return process.env.PROJECT_ROOT || process.cwd();
}

// Persistent orchestrator instance (set by server.ts on startup)
let serverOrchestrator: CortexOrchestrator | null = null;

export function setServerOrchestrator(orchestrator: CortexOrchestrator): void {
  serverOrchestrator = orchestrator;
}

export function getServerOrchestrator(): CortexOrchestrator | null {
  return serverOrchestrator;
}

export const messagesRouter = Router();

messagesRouter.post('/v1/messages', async (req: Request, res: Response, next) => {
  try {
    const {
      model: requestModel,
      messages,
      system,
      tools,
      max_tokens,
      temperature,
      top_p,
      stream
    } = req.body;

    // Model resolution order:
    //   1. Explicit request.model (client override)
    //   2. Persistent orchestrator's currentModelId (session's effective model
    //      after resume — this is what preserves the Responses API chain
    //      across restarts; if we fell through to DEFAULT_MODEL_ID here, the
    //      chain's modelMatches check would fail on the next turn)
    //   3. .env DEFAULT_MODEL_ID
    //   4. hard fallback
    const sessionModel = serverOrchestrator?.getCurrentModelId?.();
    const model = requestModel || sessionModel || process.env.DEFAULT_MODEL_ID || DEFAULT_SETTINGS.DEFAULT_MODEL_ID;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'Missing or invalid field: messages',
          type: 'invalid_request_error'
        }
      });
    }

    // sendMessage/streamMessage take a SINGLE user turn's content (a string,
    // or canonical content blocks for tool results) — every other caller
    // passes a string, and the stateful orchestrator owns session history.
    // Passing the whole `messages` array made the orchestrator wrap it as one
    // message and JSON.stringify each {role,content} element into the user
    // text (R27: garbled input → empty xAI Responses output; tolerated only
    // because chat models could still read the JSON). Pass just the new turn.
    const lastMessage = messages[messages.length - 1];
    const turnContent = lastMessage?.content ?? '';

    // Use provided tools, or empty array to enable built-in tools
    // Empty array [] triggers: factoryTools + mcpTools + mcpManagementTools in orchestrator
    const toolsToUse = tools !== undefined ? tools : [];

    // Get orchestrator (persistent instance or create ephemeral for stateless mode)
    let orchestrator: CortexOrchestrator;

    if (serverOrchestrator) {
      // Use persistent orchestrator (stateful mode)
      // NOTE: Do NOT call switchModel() here — it mutates shared orchestrator state
      // and creates race conditions with concurrent requests. Instead, pass modelId
      // per-request via messageOptions (sendMessage/streamMessage support options.modelId).
      orchestrator = serverOrchestrator;
    } else {
      // Create ephemeral orchestrator (stateless mode)
      const projectRoot = getProjectRoot();
      const orchestratorConfig: OrchestratorConfig = {
        defaultModelId: model,
        projectPath: projectRoot,
        workingDirectory: projectRoot,
        enableTimeline: true,
        debug: process.env.DEBUG === 'true'
      };
      // Use auto-approve if YOLO=true, otherwise disable permissions
      const yolo = process.env.YOLO === 'true';
      orchestrator = await createOrchestrator(orchestratorConfig, {
        permissionMode: yolo ? 'auto' : 'disabled'
      });
      await orchestrator.createSession(projectRoot, model);
    }

    // Build message options.
    // Sampling params MUST be nested under `parameters` — the orchestrator
    // reads `options.parameters?.temperature` / `?.maxTokens` / `?.topP` and
    // nothing remaps top-level keys, so a flat `temperature` was silently
    // dropped (every request ran at the model-card default). Include each
    // only when the client actually sent it: an omitted param falls through
    // to the card default rather than being force-overridden.
    const parameters: Record<string, unknown> = {};
    if (temperature !== undefined) parameters.temperature = temperature;
    if (max_tokens !== undefined) parameters.maxTokens = max_tokens;
    if (top_p !== undefined) parameters.topP = top_p;

    const messageOptions = {
      modelId: model,
      system,
      ...(toolsToUse !== undefined && { tools: toolsToUse }),
      ...(Object.keys(parameters).length > 0 && { parameters })
    };

    // Handle streaming vs non-streaming
    if (stream) {
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      try {
        for await (const event of orchestrator.streamMessage(turnContent, messageOptions)) {
          // Send SSE formatted events
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      } catch (streamError: any) {
        // Send error as SSE event
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: {
            message: streamError.message,
            type: 'stream_error'
          }
        })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming request
      const response = await orchestrator.sendMessage(turnContent, messageOptions);
      res.json(response);
    }
  } catch (error) {
    next(error);
  }
});
