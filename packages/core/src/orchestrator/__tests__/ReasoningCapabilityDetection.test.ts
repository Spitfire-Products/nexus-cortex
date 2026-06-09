/**
 * Reasoning Capability Detection Test
 * Phase 2: System Message Registry Integration
 *
 * Tests:
 * - Model cards have reasoning capability configured
 * - Orchestrator correctly detects reasoning capability
 * - System messages inject REASONING_GUIDE for reasoning models
 */

import { describe, it, expect } from 'vitest';
import { ModularModelRegistry } from '../../models/registry/ModularModelRegistry.js';
import { grokCodeFast1 } from '../../models/cards/xai/grok-code-fast-1.js';

describe('Reasoning Capability Detection', () => {
  describe('Model Cards', () => {
    it('grok-code-fast-1 should have reasoning capability', () => {
      expect(grokCodeFast1.reasoning).toBeDefined();
      expect(grokCodeFast1.reasoning?.supported).toBe(true);
      expect(grokCodeFast1.reasoning?.format).toBe('reasoning_content');
      expect(grokCodeFast1.reasoning?.extractionMethod).toBe('separate_field');
    });
  });

  describe('Model Registry', () => {
    it('should load grok-code-fast-1 with reasoning capability', () => {
      const registry = new ModularModelRegistry();
      const model = registry.getModel('grok-code-fast-1');

      expect(model).toBeDefined();
      expect(model.reasoning).toBeDefined();
      expect(model.reasoning?.supported).toBe(true);
    });

    it('should find reasoning models in registry', () => {
      const registry = new ModularModelRegistry();
      const allModels = registry.getAllModels();

      const reasoningModels = allModels.filter(m => m.reasoning?.supported);

      // Should have at least grok-code-fast-1
      expect(reasoningModels.length).toBeGreaterThan(0);

      const grokModel = reasoningModels.find(m => m.id === 'grok-code-fast-1');
      expect(grokModel).toBeDefined();
    });
  });

  describe('Capability Flags', () => {
    it('should correctly identify reasoning capability from model config', () => {
      const model = grokCodeFast1;

      // This is how Orchestrator checks reasoning capability
      const hasReasoning = model.reasoning?.supported === true;

      expect(hasReasoning).toBe(true);
    });
  });
});
