/**
 * /models endpoint - list available models
 */
import { Router, Request, Response } from 'express';
import { ModularModelRegistry } from '@nexus-cortex/core';

export const modelsRouter = Router();

modelsRouter.get('/models', (req: Request, res: Response) => {
  const registry = new ModularModelRegistry();
  const modelIds = registry.listModels();

  res.json({
    object: 'list',
    data: modelIds.map(modelId => {
      const model = registry.getModel(modelId);
      return {
        id: model.id,
        object: 'model',
        created: Date.now(),
        owned_by: model.provider,
        displayName: model.displayName,
        apiPattern: model.api.pattern,
        contextWindow: model.limits.contextWindow,
        maxOutputTokens: model.limits.outputTokens,
        inputCostPer1M: model.cost?.inputPerMillion || 0,
        outputCostPer1M: model.cost?.outputPerMillion || 0
      };
    })
  });
});
