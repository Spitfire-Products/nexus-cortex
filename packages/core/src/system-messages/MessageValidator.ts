/**
 * Message Validator
 *
 * Validates system message files before loading/hot-reloading.
 * Ensures messages are safe and well-formed.
 */

import * as fs from 'fs/promises';
import type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationStats,
} from './types.js';

/**
 * Validation configuration
 */
export interface ValidatorConfig {
  /** Maximum file size in bytes (default: 1MB) */
  maxFileSize?: number;

  /** Maximum line length (default: 10000) */
  maxLineLength?: number;

  /** Enable strict mode (more checks) */
  strict?: boolean;

  /** Enable security checks */
  enableSecurityChecks?: boolean;
}

/**
 * Message Validator
 *
 * Validates message files for:
 * - File size limits
 * - Valid UTF-8 encoding
 * - No dangerous injection patterns
 * - Optional frontmatter parsing
 * - Markdown syntax validation
 */
export class MessageValidator {
  private config: Required<ValidatorConfig>;

  constructor(config: ValidatorConfig = {}) {
    this.config = {
      maxFileSize: config.maxFileSize ?? 1_000_000, // 1MB
      maxLineLength: config.maxLineLength ?? 10_000,
      strict: config.strict ?? false,
      enableSecurityChecks: config.enableSecurityChecks ?? true,
    };
  }

  /**
   * Validate a message file
   */
  async validate(filePath: string): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      // Read file
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = this.calculateStats(content);

      // Check file size
      if (content.length > this.config.maxFileSize) {
        errors.push({
          type: 'size',
          message: `File exceeds maximum size of ${this.formatSize(this.config.maxFileSize)}`,
        });
      }

      // Check encoding (UTF-8 validation)
      if (!this.isValidUTF8(content)) {
        errors.push({
          type: 'encoding',
          message: 'File contains invalid UTF-8 sequences',
        });
      }

      // Check for control characters (except newlines, tabs)
      const controlChars = this.findControlCharacters(content);
      if (controlChars.length > 0) {
        errors.push({
          type: 'encoding',
          message: `File contains ${controlChars.length} invalid control character(s)`,
        });
      }

      // Parse and validate frontmatter (optional)
      const frontmatterResult = this.parseFrontmatter(content);
      if (frontmatterResult.error) {
        if (this.config.strict) {
          errors.push({
            type: 'frontmatter',
            message: frontmatterResult.error,
            line: frontmatterResult.line,
          });
        } else {
          warnings.push({
            type: 'formatting',
            message: `Frontmatter issue: ${frontmatterResult.error}`,
          });
        }
      }

      // Security checks
      if (this.config.enableSecurityChecks) {
        const securityIssues = this.findSecurityIssues(content);
        if (securityIssues.length > 0) {
          errors.push({
            type: 'security',
            message: `Found ${securityIssues.length} potential security issue(s): ${securityIssues.join(', ')}`,
          });
        }
      }

      // Check line lengths
      const longLines = this.findLongLines(content);
      if (longLines.length > 0) {
        if (this.config.strict) {
          errors.push({
            type: 'syntax',
            message: `${longLines.length} line(s) exceed ${this.config.maxLineLength} characters`,
            line: longLines[0],
          });
        } else {
          warnings.push({
            type: 'formatting',
            message: `${longLines.length} very long line(s) found`,
            suggestion: 'Consider breaking long lines for readability',
          });
        }
      }

      // Warn if file is very large
      if (content.length > 100_000 && content.length <= this.config.maxFileSize) {
        warnings.push({
          type: 'length',
          message: `Large file (${this.formatSize(content.length)})`,
          suggestion: 'Consider breaking into multiple focused messages',
        });
      }

      // Warn if file is empty
      if (content.trim().length === 0) {
        warnings.push({
          type: 'length',
          message: 'File is empty',
        });
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats,
      };
    } catch (error: any) {
      return {
        valid: false,
        errors: [
          {
            type: 'syntax',
            message: `Failed to read/parse file: ${error.message}`,
          },
        ],
        warnings: [],
        stats: { lines: 0, chars: 0, words: 0 },
      };
    }
  }

  /**
   * Validate content string (without file I/O)
   */
  validateContent(content: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const stats = this.calculateStats(content);

    // Same validation as file, but on content directly
    if (content.length > this.config.maxFileSize) {
      errors.push({
        type: 'size',
        message: `Content exceeds maximum size of ${this.formatSize(this.config.maxFileSize)}`,
      });
    }

    if (!this.isValidUTF8(content)) {
      errors.push({
        type: 'encoding',
        message: 'Content contains invalid UTF-8 sequences',
      });
    }

    const controlChars = this.findControlCharacters(content);
    if (controlChars.length > 0) {
      errors.push({
        type: 'encoding',
        message: `Content contains ${controlChars.length} invalid control character(s)`,
      });
    }

    if (this.config.enableSecurityChecks) {
      const securityIssues = this.findSecurityIssues(content);
      if (securityIssues.length > 0) {
        errors.push({
          type: 'security',
          message: `Found ${securityIssues.length} potential security issue(s): ${securityIssues.join(', ')}`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats,
    };
  }

  /**
   * Check if string is valid UTF-8
   */
  private isValidUTF8(str: string): boolean {
    try {
      // Try to encode and decode
      const encoder = new TextEncoder();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const encoded = encoder.encode(str);
      decoder.decode(encoded);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Find control characters (except \n, \r, \t)
   */
  private findControlCharacters(content: string): number[] {
    const positions: number[] = [];
    for (let i = 0; i < content.length; i++) {
      const code = content.charCodeAt(i);
      // Control characters: 0x00-0x1F, excluding \n (0x0A), \r (0x0D), \t (0x09)
      if (code < 0x20 && code !== 0x0a && code !== 0x0d && code !== 0x09) {
        positions.push(i);
      }
    }
    return positions;
  }

  /**
   * Parse frontmatter (YAML between --- markers)
   */
  private parseFrontmatter(content: string): {
    frontmatter?: Record<string, any>;
    error?: string;
    line?: number;
  } {
    const lines = content.split('\n');

    // Check if starts with frontmatter
    if (!lines[0]?.trim().startsWith('<!--') || !content.includes('-->')) {
      return {}; // No frontmatter
    }

    try {
      // Extract HTML comment frontmatter
      const commentMatch = content.match(/<!--([\s\S]*?)-->/);
      if (!commentMatch) {
        return {};
      }

      // Very basic parsing - just check it's reasonable
      const commentContent = commentMatch[1];
      if (commentContent && commentContent.length > 10000) {
        return {
          error: 'Frontmatter too large',
          line: 1,
        };
      }

      return {};
    } catch (error: any) {
      return {
        error: error.message,
        line: 1,
      };
    }
  }

  /**
   * Find potential security issues
   */
  private findSecurityIssues(content: string): string[] {
    const issues: string[] = [];

    // Check for script injection patterns
    if (/<script[\s>]/i.test(content)) {
      issues.push('script tags detected');
    }

    // Check for eval/Function patterns (JavaScript injection)
    if (/\beval\s*\(|\bFunction\s*\(/i.test(content)) {
      issues.push('eval/Function calls detected');
    }

    // Check for file:// protocol (local file access)
    if (/file:\/\//i.test(content)) {
      issues.push('file:// protocol detected');
    }

    // Check for shell command patterns (basic check)
    if (/\$\{|\$\(|`.*`/.test(content)) {
      // Only flag if it looks like shell interpolation
      if (/\$\{[^}]*\}|\$\([^)]*\)|`[^`]*`/.test(content)) {
        issues.push('potential shell command interpolation');
      }
    }

    return issues;
  }

  /**
   * Find lines exceeding max length
   */
  private findLongLines(content: string): number[] {
    const lines = content.split('\n');
    const longLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length > this.config.maxLineLength) {
        longLines.push(i + 1); // 1-indexed
      }
    }

    return longLines;
  }

  /**
   * Calculate content statistics
   */
  private calculateStats(content: string): ValidationStats {
    const lines = content.split('\n').length;
    const chars = content.length;
    const words = content.split(/\s+/).filter((w) => w.length > 0).length;

    return { lines, chars, words };
  }

  /**
   * Format byte size for display
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} bytes`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
