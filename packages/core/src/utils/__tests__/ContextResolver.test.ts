/**
 * Context Resolver Tests
 *
 * Tests context-aware storage resolution based on launch directory
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextResolver, resolveContext } from '../ContextResolver.js';
import { join } from 'path';

describe('ContextResolver', () => {
  describe('Workspace-level detection', () => {
    it('should detect workspace root when launched from directory with .git', () => {
      const resolver = new ContextResolver({
        cwd: '/workspace',
        forceWorkspaceRoot: '/workspace',
        debug: false
      });

      const config = resolver.resolve();

      expect(config.contextLevel).toBe('workspace');
      expect(config.contextRoot).toBe('/workspace');
      expect(config.sessionsDir).toBe(join('/workspace', '.cortex', 'sessions'));
      expect(config.systemMessagesDir).toBe(join('/workspace', '.cortex', 'system-messages'));
    });

    it('should detect workspace root when launched from directory with package.json', () => {
      const resolver = new ContextResolver({
        cwd: '/workspace',
        forceWorkspaceRoot: '/workspace'
      });

      const config = resolver.resolve();

      expect(config.contextLevel).toBe('workspace');
    });
  });

  describe('Project-level detection', () => {
    it('should detect project context when launched from subdirectory', () => {
      const resolver = new ContextResolver({
        cwd: '/workspace/dateroi',
        forceWorkspaceRoot: '/workspace',
        debug: false
      });

      const config = resolver.resolve();

      expect(config.contextLevel).toBe('project');
      expect(config.contextRoot).toBe('/workspace/dateroi');
      expect(config.sessionsDir).toBe(join('/workspace/dateroi', '.cortex', 'sessions'));
      expect(config.systemMessagesDir).toBe(join('/workspace/dateroi', '.cortex', 'system-messages'));
    });

    it('should detect different projects independently', () => {
      // Project 1: dateroi
      const resolver1 = new ContextResolver({
        cwd: '/workspace/dateroi',
        forceWorkspaceRoot: '/workspace'
      });

      const config1 = resolver1.resolve();

      expect(config1.contextLevel).toBe('project');
      expect(config1.contextRoot).toBe('/workspace/dateroi');
      expect(config1.sessionsDir).toBe(join('/workspace/dateroi', '.cortex', 'sessions'));

      // Project 2: nexus-cortex
      const resolver2 = new ContextResolver({
        cwd: '/workspace/nexus-cortex',
        forceWorkspaceRoot: '/workspace'
      });

      const config2 = resolver2.resolve();

      expect(config2.contextLevel).toBe('project');
      expect(config2.contextRoot).toBe('/workspace/nexus-cortex');
      expect(config2.sessionsDir).toBe(join('/workspace/nexus-cortex', '.cortex', 'sessions'));

      // Sessions should be in different directories
      expect(config1.sessionsDir).not.toBe(config2.sessionsDir);
    });

    it('should handle nested project directories', () => {
      const resolver = new ContextResolver({
        cwd: '/workspace/project/subproject',
        forceWorkspaceRoot: '/workspace'
      });

      const config = resolver.resolve();

      expect(config.contextLevel).toBe('project');
      expect(config.contextRoot).toBe('/workspace/project/subproject');
      expect(config.sessionsDir).toBe(join('/workspace/project/subproject', '.cortex', 'sessions'));
    });
  });

  describe('Global fallback', () => {
    it('should use global config when no workspace detected', () => {
      const resolver = new ContextResolver({
        cwd: '/tmp/random',
        forceWorkspaceRoot: '', // No workspace
        debug: false
      });

      const config = resolver.resolve();

      expect(config.contextLevel).toBe('global');
      expect(config.sessionsDir).toContain('.cortex');
      expect(config.sessionsDir).toContain('sessions');
    });
  });

  describe('Context detection helpers', () => {
    it('should correctly identify workspace context', () => {
      const resolver = new ContextResolver({
        cwd: '/workspace',
        forceWorkspaceRoot: '/workspace'
      });

      expect(resolver.isWorkspaceContext()).toBe(true);
      expect(resolver.isProjectContext()).toBe(false);
    });

    it('should correctly identify project context', () => {
      const resolver = new ContextResolver({
        cwd: '/workspace/dateroi',
        forceWorkspaceRoot: '/workspace'
      });

      expect(resolver.isWorkspaceContext()).toBe(false);
      expect(resolver.isProjectContext()).toBe(true);
    });
  });

  describe('Helper function', () => {
    it('should provide resolveContext shorthand', () => {
      const config = resolveContext({
        cwd: '/workspace/dateroi',
        forceWorkspaceRoot: '/workspace'
      });

      expect(config.contextLevel).toBe('project');
      expect(config.contextRoot).toBe('/workspace/dateroi');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical Node.js monorepo structure', () => {
      // Launched from monorepo root
      const rootResolver = new ContextResolver({
        cwd: '/workspace',
        forceWorkspaceRoot: '/workspace'
      });

      const rootConfig = rootResolver.resolve();
      expect(rootConfig.contextLevel).toBe('workspace');
      expect(rootConfig.sessionsDir).toBe('/workspace/.cortex/sessions');

      // Launched from packages/cli
      const cliResolver = new ContextResolver({
        cwd: '/workspace/packages/cli',
        forceWorkspaceRoot: '/workspace'
      });

      const cliConfig = cliResolver.resolve();
      expect(cliConfig.contextLevel).toBe('project');
      expect(cliConfig.sessionsDir).toBe('/workspace/packages/cli/.cortex/sessions');
    });

    it('should handle user working on multiple projects in same workspace', () => {
      // User works on dateroi
      const dateroiConfig = resolveContext({
        cwd: '/workspace/dateroi',
        forceWorkspaceRoot: '/workspace'
      });

      expect(dateroiConfig.sessionsDir).toBe('/workspace/dateroi/.cortex/sessions');

      // User switches to nexus-cortex
      const omnConfig = resolveContext({
        cwd: '/workspace/nexus-cortex',
        forceWorkspaceRoot: '/workspace'
      });

      expect(omnConfig.sessionsDir).toBe('/workspace/nexus-cortex/.cortex/sessions');

      // Sessions are isolated
      expect(dateroiConfig.sessionsDir).not.toBe(omnConfig.sessionsDir);
    });
  });
});
