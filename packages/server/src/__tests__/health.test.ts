/**
 * Health Endpoint Tests
 *
 * Tests the /health endpoint which provides server status and model information.
 * Based on component analysis showing ModularModelRegistry integration.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { healthRouter } from '../routes/health.js';

describe('/health endpoint', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(healthRouter);
  });

  describe('JSON Response (API Clients)', () => {
    it('should return health status with application/json', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toHaveProperty('status');
      expect(response.body.status).toBe('healthy');
    });

    it('should include server metadata', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.body).toHaveProperty('server');
      expect(response.body.server).toMatchObject({
        name: 'Nexus Cortex',
        version: '4.0.0',
        architecture: 'core-library'
      });
      expect(response.body.server).toHaveProperty('uptime');
      expect(response.body.server).toHaveProperty('nodeVersion');
    });

    it('should list available providers', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.body).toHaveProperty('availableProviders');
      expect(Array.isArray(response.body.availableProviders)).toBe(true);
      expect(response.body.availableProviders.length).toBeGreaterThan(0);

      // Based on test analysis: We have 10 providers
      // xai, deepseek, anthropic, google, openai, zhipu, qwen, moonshot, minimax, gemma
      expect(response.body.availableProviders).toContain('anthropic');
      expect(response.body.availableProviders).toContain('openai');
      expect(response.body.availableProviders).toContain('google');
    });

    it('should include total model count', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.body).toHaveProperty('totalModels');
      expect(typeof response.body.totalModels).toBe('number');
      // Based on test analysis: 65 models across 10 providers
      expect(response.body.totalModels).toBeGreaterThan(50);
    });

    it('should include models grouped by provider', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.body).toHaveProperty('models');
      expect(typeof response.body.models).toBe('object');

      // Check structure of model entries
      const providers = Object.keys(response.body.models);
      expect(providers.length).toBeGreaterThan(0);

      // Check first provider has models with correct structure
      const firstProvider = providers[0];
      const providerModels = response.body.models[firstProvider];
      expect(Array.isArray(providerModels)).toBe(true);

      if (providerModels.length > 0) {
        const model = providerModels[0];
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('contextWindow');
        expect(model).toHaveProperty('apiPattern');
      }
    });

    it('should include environment API key status', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.body).toHaveProperty('environment');
      expect(response.body.environment).toHaveProperty('hasAnthropicKey');
      expect(response.body.environment).toHaveProperty('hasOpenAIKey');
      expect(response.body.environment).toHaveProperty('hasGoogleKey');
      expect(response.body.environment).toHaveProperty('hasXAIKey');
      expect(response.body.environment).toHaveProperty('hasDeepSeekKey');

      // Values should be booleans
      expect(typeof response.body.environment.hasAnthropicKey).toBe('boolean');
      expect(typeof response.body.environment.hasOpenAIKey).toBe('boolean');
    });

    it('should include endpoint listings', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');

      expect(response.body).toHaveProperty('endpoints');
      expect(response.body.endpoints).toMatchObject({
        health: '/health',
        models: '/models',
        messages: '/v1/messages'
      });
    });
  });

  describe('HTML Response (Browsers)', () => {
    it('should return HTML dashboard when Accept: text/html', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'text/html');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('<!DOCTYPE html>');
      expect(response.text).toContain('Cortex Intelligence Dashboard');
    });

    it('should include server name and status in HTML', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'text/html');

      expect(response.text).toContain('Cortex Intelligence Dashboard');
      expect(response.text).toContain('HEALTHY');
      expect(response.text).toContain('core-library');
    });

    it('should include model information in HTML', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'text/html');

      // Should show providers
      expect(response.text).toMatch(/anthropic|openai|google/i);
      // Should show model count (format: "N REGISTERED" in registry badge)
      expect(response.text).toMatch(/\d+\s+REGISTERED/i);
    });

    it('should include refresh button in HTML', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'text/html');

      expect(response.text).toContain('Refresh');
      expect(response.text).toContain('location.reload()');
    });
  });

  describe('Performance', () => {
    it('should respond quickly (< 100ms)', async () => {
      const start = Date.now();
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json');
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      // Based on test analysis: list operations should be < 5ms
      // Allow 100ms for HTTP overhead and registry creation
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Content Negotiation', () => {
    it('should default to JSON when Accept header is missing', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
      // Default behavior should be JSON for API clients
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return HTML when both JSON and HTML are accepted', async () => {
      const response = await request(app)
        .get('/health')
        .set('Accept', 'application/json, text/html');

      expect(response.status).toBe(200);
      // Server prioritizes HTML when text/html is in Accept header
      expect(response.headers['content-type']).toMatch(/text\/html/);
    });
  });
});
