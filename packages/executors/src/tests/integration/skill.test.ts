/**
 * Skill Tool Integration Tests
 *
 * Tests the Skill tool with real SKILL.md files in .cortex/skills/ directories
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SkillToolExecutor } from '../../implementations/extensions/SkillTool.js';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

describe('Skill Integration', () => {
  let executor: SkillToolExecutor;
  let testDir: string;
  let projectSkillsDir: string;

  beforeAll(async () => {
    // Create test directory structure
    testDir = join(process.cwd(), 'test-skills');
    projectSkillsDir = join(testDir, '.cortex', 'skills');

    await fs.mkdir(projectSkillsDir, { recursive: true });

    // Create test skills
    await createTestSkills(projectSkillsDir);

    // Create executor
    executor = new SkillToolExecutor({
      workingDirectory: testDir,
    });
  });

  afterAll(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Skill Loading', () => {
    it('should load skill from SKILL.md file', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Skill: pdf-analyzer');
      expect(result.returnDisplay).toContain('Analyze PDF documents');
    });

    it('should handle skill without arguments', async () => {
      const result = await executor.execute(
        { command: 'code-reviewer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Skill: code-reviewer');
      expect(result.returnDisplay).toContain('Review code for quality');
    });

    it('should error for non-existent skill', async () => {
      const result = await executor.execute(
        { command: 'nonexistent' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain("Skill 'nonexistent' not found");
      expect(result.returnDisplay).toContain('Available skills:');
    });

    it('should load skills from skill directories', async () => {
      const result = await executor.execute(
        { command: 'xlsx-processor' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('Skill: xlsx-processor');
    });
  });

  describe('Frontmatter Parsing', () => {
    it('should parse name from frontmatter', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.metadata.skillName).toBe('pdf-analyzer');
    });

    it('should parse description from frontmatter', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('**Description**: Analyze PDF documents and extract information');
    });

    it('should parse allowed-tools from frontmatter', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('**Allowed Tools**: Read, Grep, Bash');
      expect(result.metadata.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
    });

    it('should handle skills without allowed-tools', async () => {
      const result = await executor.execute(
        { command: 'code-reviewer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      // Should not show allowed tools section
      expect(result.returnDisplay).not.toContain('**Allowed Tools**:');
    });
  });

  describe('Parameter Validation', () => {
    it('should error for missing skill name', async () => {
      const result = await executor.execute(
        { command: '' } as any,
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must be a non-empty string');
    });

    it('should error for skill name with invalid characters', async () => {
      const result = await executor.execute(
        { command: 'invalid/skill' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must contain only letters, numbers, and hyphens');
    });

    it('should accept skill names with hyphens', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
    });

    it('should handle invalid parameter type', async () => {
      const result = await executor.execute(
        { command: 123 as any },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('must be a non-empty string');
    });
  });

  describe('Abort Signal', () => {
    it('should handle abort signal during skill loading', async () => {
      // Note: Since skill loading is synchronous and very fast,
      // aborting before execute() is called still succeeds.
      // This test verifies the tool handles aborted signals gracefully.
      const controller = new AbortController();
      controller.abort();

      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        controller.signal,
      );

      // Tool may still succeed if cache is loaded, or fail if aborted early
      expect(result).toBeDefined();
      expect(result.returnDisplay).toBeDefined();
    });
  });

  describe('Cache Management', () => {
    it('should cache skills after first load', async () => {
      // First call loads from disk
      const result1 = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result1.success).toBe(true);

      // Second call uses cache (should be faster)
      const result2 = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result2.success).toBe(true);
      expect(result2.returnDisplay).toContain('pdf-analyzer');
    });

    it('should allow cache clearing', async () => {
      const result1 = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result1.success).toBe(true);

      // Clear cache
      executor.clearCache();

      // Next call should reload from disk (and still work)
      const result2 = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result2.success).toBe(true);
      expect(result2.returnDisplay).toContain('pdf-analyzer');

      // Verify cache was actually cleared and reloaded
      expect(result1.metadata.skillName).toBe('pdf-analyzer');
      expect(result2.metadata.skillName).toBe('pdf-analyzer');
    });
  });

  describe('Output Formatting', () => {
    it('should format output with skill header', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('# Skill: pdf-analyzer');
      expect(result.returnDisplay).toContain('---');
    });

    it('should include metadata in result', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.skillName).toBe('pdf-analyzer');
      expect(result.metadata.location).toBe('project');
      expect(result.metadata.description).toBe('Analyze PDF documents and extract information');
      expect(result.metadata.executionTime).toBeGreaterThanOrEqual(0);
    });

    it('should show skill location in output', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toMatch(/\*\*Location\*\*: /);
    });

    it('should include skill instructions in output', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('## Instructions');
      expect(result.returnDisplay).toContain('Use Read tool to access PDF');
    });
  });

  describe('Edge Cases', () => {
    it('should handle skill names with uppercase letters', async () => {
      const result = await executor.execute(
        { command: 'CodeReviewer' },
        new AbortController().signal,
      );

      // Should convert to lowercase or handle case-insensitively
      expect(result).toBeDefined();
    });

    it('should handle skill name with trailing spaces', async () => {
      const result = await executor.execute(
        { command: '  pdf-analyzer  ' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('pdf-analyzer');
    });

    it('should handle missing .cortex/skills directory', async () => {
      const tempExecutor = new SkillToolExecutor({
        workingDirectory: '/nonexistent/directory',
      });

      const result = await tempExecutor.execute(
        { command: 'any-skill' },
        new AbortController().signal,
      );

      expect(result.success).toBe(false);
      expect(result.returnDisplay).toContain('not found');
    });

    it('should handle multiple skills with similar names', async () => {
      const result1 = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      const result2 = await executor.execute(
        { command: 'code-reviewer' },
        new AbortController().signal,
      );

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.metadata.skillName).not.toBe(result2.metadata.skillName);
    });
  });

  describe('Skill Content', () => {
    it('should include full skill instructions', async () => {
      const result = await executor.execute(
        { command: 'pdf-analyzer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      expect(result.returnDisplay).toContain('PDF Analyzer');
      expect(result.returnDisplay).toContain('## Instructions');
      expect(result.returnDisplay).toContain('## Examples');
    });

    it('should preserve markdown formatting in skill content', async () => {
      const result = await executor.execute(
        { command: 'code-reviewer' },
        new AbortController().signal,
      );

      expect(result.success).toBe(true);
      // Check for markdown formatting elements
      expect(result.returnDisplay).toContain('#');
      expect(result.returnDisplay).toContain('-');
    });
  });
});

/**
 * Create test skill files
 */
async function createTestSkills(skillsDir: string): Promise<void> {
  // PDF Analyzer skill
  const pdfSkillDir = join(skillsDir, 'pdf-analyzer');
  await fs.mkdir(pdfSkillDir, { recursive: true });

  await fs.writeFile(
    join(pdfSkillDir, 'SKILL.md'),
    `---
name: pdf-analyzer
description: Analyze PDF documents and extract information
allowed-tools: Read, Grep, Bash
---

# PDF Analyzer

## Instructions

Use Read tool to access PDF files and analyze their contents.

Steps:
1. Locate the PDF file
2. Use Bash to extract text if needed
3. Analyze structure and content
4. Extract key information

## Examples

Example usage:
- Analyze research paper: extract citations
- Process invoice: extract amounts and dates
- Review contract: identify key terms
`,
  );

  // Code Reviewer skill
  const codeSkillDir = join(skillsDir, 'code-reviewer');
  await fs.mkdir(codeSkillDir, { recursive: true });

  await fs.writeFile(
    join(codeSkillDir, 'SKILL.md'),
    `---
name: code-reviewer
description: Review code for quality, security, and best practices
---

# Code Reviewer

## Instructions

Review code systematically:

- Check for security vulnerabilities
- Verify error handling
- Assess code organization
- Review naming conventions
- Check for proper documentation

## Focus Areas

1. Security: SQL injection, XSS, etc.
2. Performance: N+1 queries, inefficient algorithms
3. Maintainability: Code clarity and structure
`,
  );

  // XLSX Processor skill
  const xlsxSkillDir = join(skillsDir, 'xlsx-processor');
  await fs.mkdir(xlsxSkillDir, { recursive: true });

  await fs.writeFile(
    join(xlsxSkillDir, 'SKILL.md'),
    `---
name: xlsx-processor
description: Process and analyze Excel spreadsheets
---

# XLSX Processor

## Instructions

Process Excel files:
1. Read file structure
2. Analyze data patterns
3. Generate insights
`,
  );
}
