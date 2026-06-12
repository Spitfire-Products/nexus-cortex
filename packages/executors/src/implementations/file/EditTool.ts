/**
 * EditFile Tool Executor
 *
 * Performs exact string replacements within a file.
 * Requires precise matching of old_string for safety.
 *
 * Adapted and simplified from Gemini CLI patterns
 * - Removed: ModifiableTool interface, user approval, LLM-based correction
 * - Kept: Core string replacement, occurrence validation, diff generation
 *
 * IMPORTANT: Following the read-before-edit protocol, this tool requires a prior Read
 * operation in the same session before allowing edits. This ensures the LLM
 * has current file content and prevents edits based on stale context.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as Diff from 'diff';
import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import {
  makeRelative,
  shortenPath,
  fileExists,
  resolveFilePath,
} from '../../utils/FileUtils.js';
import {
  safeLiteralReplace,
  countOccurrences,
  normalizeLineEndings,
} from '../../utils/TextUtils.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';

/**
 * Fingerprint of a file section - used for content-based freshness detection
 * Instead of just checking timestamps, we can verify if the actual content has changed
 */
export interface SectionFingerprint {
  startLine: number;
  endLine: number;
  contentHash: string;  // SHA-256 truncated to 16 chars
  timestamp: number;
}

/**
 * Session-level tracking of files that have been read/edited.
 * This enforces the read-before-edit protocol with timestamp-based staleness detection
 * and content-based fingerprinting for smarter freshness checks.
 *
 * Key behavior (read-before-edit):
 * - Files must be read before editing
 * - After each edit, the file becomes "stale" and must be re-read
 * - Content fingerprinting allows detecting if unrelated edits affect your target section
 * - This ensures LLM always has current file state in evolving codebases
 */
export class FileReadTracker {
  private static fileReadTimestamps = new Map<string, number>();
  private static fileEditTimestamps = new Map<string, number>();
  private static editedSections = new Map<string, { startLine: number; endLine: number }[]>();

  // Phase 1: Section fingerprinting for content-based freshness detection
  // Key: filePath, Value: Map of "startLine-endLine" -> SectionFingerprint
  private static sectionFingerprints = new Map<string, Map<string, SectionFingerprint>>();

  // Phase 2: Consecutive edit tracking for brief read mode
  private static readonly MAX_CONSECUTIVE_EDITS = 2;
  private static consecutiveEditCount = new Map<string, number>();
  private static lastEditRegion = new Map<string, { startLine: number; endLine: number }>();

  /**
   * Calculate SHA-256 hash of content, truncated to 16 characters
   * This is efficient and provides sufficient uniqueness for content comparison
   */
  static calculateSectionHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Store a fingerprint for a read section
   * Called by ReadFileTool after successfully reading a section
   */
  static storeSectionFingerprint(
    filePath: string,
    startLine: number,
    endLine: number,
    content: string
  ): void {
    const key = `${startLine}-${endLine}`;
    const fingerprint: SectionFingerprint = {
      startLine,
      endLine,
      contentHash: this.calculateSectionHash(content),
      timestamp: Date.now()
    };

    let fileFingerprints = this.sectionFingerprints.get(filePath);
    if (!fileFingerprints) {
      fileFingerprints = new Map();
      this.sectionFingerprints.set(filePath, fileFingerprints);
    }
    fileFingerprints.set(key, fingerprint);
  }

  /**
   * Update fingerprint after a successful edit
   * This keeps the fingerprint in sync with our known changes, enabling consecutive edits.
   * The key insight: after WE edit the file, we know the new content is correct.
   * We update the fingerprint so subsequent edits can verify no EXTERNAL changes occurred.
   */
  static updateFingerprintAfterEdit(
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string
  ): void {
    // Update all fingerprints that overlap with the edited region
    const fileFingerprints = this.sectionFingerprints.get(filePath);
    if (!fileFingerprints) {
      // No existing fingerprints, create one for the edited region
      this.storeSectionFingerprint(filePath, startLine, endLine, newContent);
      return;
    }

    // Update existing fingerprints that overlap with edited region
    // Also add the new edit region as a fingerprint
    this.storeSectionFingerprint(filePath, startLine, endLine, newContent);

    // For any overlapping fingerprints, update them with current file content
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (const [key, fingerprint] of fileFingerprints) {
        // Check if this fingerprint overlaps with edited region
        const overlaps = !(fingerprint.endLine <= startLine || fingerprint.startLine >= endLine);
        if (overlaps) {
          // Update this fingerprint with current content
          const sectionContent = lines.slice(fingerprint.startLine, fingerprint.endLine).join('\n');
          fingerprint.contentHash = this.calculateSectionHash(sectionContent);
          fingerprint.timestamp = Date.now();
        }
      }
    } catch {
      // File read error - leave fingerprints as-is
    }
  }

  /**
   * Check if a previously read section still has the same content
   * Returns true if the section's current content matches the stored fingerprint
   */
  static isSectionFresh(filePath: string, startLine: number, endLine: number): boolean {
    const key = `${startLine}-${endLine}`;
    const fileFingerprints = this.sectionFingerprints.get(filePath);
    if (!fileFingerprints) {
      return false; // No fingerprint stored
    }

    const storedFingerprint = fileFingerprints.get(key);
    if (!storedFingerprint) {
      return false; // No fingerprint for this section
    }

    // Read the current content of this section and compare hashes
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const sectionContent = lines.slice(startLine, endLine).join('\n');
      const currentHash = this.calculateSectionHash(sectionContent);

      return currentHash === storedFingerprint.contentHash;
    } catch {
      return false; // File read error - consider stale
    }
  }

  /**
   * Check if a line range overlaps or is adjacent to another range
   * Used for brief read mode to allow consecutive edits in same region
   */
  static isRegionAdjacent(
    range1: { startLine: number; endLine: number },
    range2: { startLine: number; endLine: number },
    tolerance: number = 10
  ): boolean {
    // Check if ranges overlap or are within tolerance lines of each other
    const gap = Math.max(0,
      Math.max(range1.startLine, range2.startLine) -
      Math.min(range1.endLine, range2.endLine)
    );
    return gap <= tolerance;
  }

  /**
   * Mark a file as read at current timestamp
   * Optionally store content fingerprint for section-based freshness detection
   */
  static markAsRead(
    filePath: string,
    startLine?: number,
    endLine?: number,
    content?: string
  ): void {
    this.fileReadTimestamps.set(filePath, Date.now());

    // Track which sections were read (for smart re-read suggestions)
    if (startLine !== undefined && endLine !== undefined) {
      const sections = this.editedSections.get(filePath) || [];
      sections.push({ startLine, endLine });
      this.editedSections.set(filePath, sections);

      // Store content fingerprint if content is provided
      if (content !== undefined) {
        this.storeSectionFingerprint(filePath, startLine, endLine, content);
      }
    }

    // Reset consecutive edit count on fresh read
    this.consecutiveEditCount.set(filePath, 0);
  }

  /**
   * Mark a file as edited at current timestamp
   * Tracks the edit region for consecutive edit allowance in brief read mode
   *
   * @param filePath Path to the file being edited
   * @param startLine Optional start line of the edit (for region tracking)
   * @param endLine Optional end line of the edit (for region tracking)
   */
  static markAsEdited(filePath: string, startLine?: number, endLine?: number): void {
    const now = Date.now();
    this.fileEditTimestamps.set(filePath, now);
    // A successful edit proves the model knows the file content (old_string matched).
    // Bump read timestamp so the file stays "fresh" — no forced re-read for the
    // model's own edits. Only external modifications should trigger staleness.
    this.fileReadTimestamps.set(filePath, now + 1);

    // Track consecutive edit count for brief read mode
    const currentCount = this.consecutiveEditCount.get(filePath) || 0;
    this.consecutiveEditCount.set(filePath, currentCount + 1);

    // Track the edit region for adjacent edit detection
    if (startLine !== undefined && endLine !== undefined) {
      this.lastEditRegion.set(filePath, { startLine, endLine });
    }
  }

  /**
   * Check if an edit should be allowed under brief read mode
   * Returns true if:
   * 1. We're under MAX_CONSECUTIVE_EDITS
   * 2. The edit is in the same or adjacent region as previous edits
   * 3. The section's content hash still matches (no external changes)
   */
  static canSkipReRead(
    filePath: string,
    editStartLine?: number,
    editEndLine?: number
  ): boolean {
    // Check consecutive edit count
    const editCount = this.consecutiveEditCount.get(filePath) || 0;
    if (editCount >= this.MAX_CONSECUTIVE_EDITS) {
      return false; // Exceeded max consecutive edits
    }

    // If we have edit region info, check if this edit is in adjacent region
    const lastRegion = this.lastEditRegion.get(filePath);
    if (lastRegion && editStartLine !== undefined && editEndLine !== undefined) {
      const newRegion = { startLine: editStartLine, endLine: editEndLine };
      if (!this.isRegionAdjacent(lastRegion, newRegion)) {
        return false; // Edit is in a different region
      }
    }

    // Check if any stored fingerprint for this file still matches
    const fileFingerprints = this.sectionFingerprints.get(filePath);
    if (!fileFingerprints || fileFingerprints.size === 0) {
      return false; // No fingerprints stored
    }

    // Verify at least one section's content hash still matches
    for (const [key, fingerprint] of fileFingerprints) {
      if (this.isSectionFresh(filePath, fingerprint.startLine, fingerprint.endLine)) {
        return true; // Found a fresh section - content hasn't been externally modified
      }
    }

    return false; // No fresh sections found
  }

  /**
   * Check if file has been read AND is still fresh (not edited since last read)
   * Matches a standard coding CLI behavior: require re-read after each edit
   */
  static hasBeenRead(filePath: string): boolean {
    const readTime = this.fileReadTimestamps.get(filePath);
    if (!readTime) {
      return false; // Never read
    }

    const editTime = this.fileEditTimestamps.get(filePath);
    if (editTime && editTime > readTime) {
      return false; // Edited after last read - stale!
    }

    return true; // Read and still fresh
  }

  /**
   * Get suggested read parameters for re-reading after edit
   * Returns the section around the last edit for efficient re-reading
   */
  static getSuggestedReadParams(filePath: string): { offset: number; limit: number } | null {
    const sections = this.editedSections.get(filePath);
    if (!sections || sections.length === 0) {
      return null;
    }

    // Get last edited section
    const lastSection = sections[sections.length - 1];
    if (!lastSection) {
      return null;
    }

    // Read with context: 10 lines before, the section, 10 lines after
    const contextLines = 10;
    const offset = Math.max(0, lastSection.startLine - contextLines);
    const limit = (lastSection.endLine - lastSection.startLine) + (contextLines * 2);

    return { offset, limit };
  }

  /**
   * Find where a string appears in a file and return suggested read parameters
   * This enables smart error messages that tell the model exactly where to read
   *
   * @param filePath Path to the file
   * @param searchString The string to find (typically old_string from failed edit)
   * @param contextLines Number of lines of context above/below (default: 10)
   * @returns Suggested offset/limit, or null if string not found or file can't be read
   */
  static findStringInFile(
    filePath: string,
    searchString: string,
    contextLines: number = 10
  ): { offset: number; limit: number; lineNumber: number } | null {
    try {
      // Read file synchronously (validation is sync)
      const fs = require('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Find the line containing the start of the search string
      // Handle multi-line strings by looking for the first line
      const firstLineOfSearch = searchString.split('\n')[0];

      for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.includes(firstLineOfSearch)) {
          // Found it! Calculate how many lines the old_string spans
          const searchLineCount = searchString.split('\n').length;

          // Return offset with context above, limit covers string + context below
          const offset = Math.max(0, i - contextLines);
          const limit = searchLineCount + (contextLines * 2);

          return {
            offset,
            limit,
            lineNumber: i + 1  // 1-indexed for display
          };
        }
      }

      return null; // String not found in file
    } catch {
      return null; // File read error
    }
  }

  /**
   * Clear all session state
   */
  static clearSession(): void {
    this.fileReadTimestamps.clear();
    this.fileEditTimestamps.clear();
    this.editedSections.clear();
    this.sectionFingerprints.clear();
    this.consecutiveEditCount.clear();
    this.lastEditRegion.clear();
  }

  /**
   * Get list of files read in this session
   */
  static getReadFiles(): string[] {
    return Array.from(this.fileReadTimestamps.keys());
  }

  /**
   * Check if file is stale (edited after last read)
   */
  static isStale(filePath: string): boolean {
    const readTime = this.fileReadTimestamps.get(filePath);
    const editTime = this.fileEditTimestamps.get(filePath);

    if (!readTime) return false; // Not read yet, not stale
    if (!editTime) return false; // Never edited, not stale

    return editTime > readTime; // Stale if edited after read
  }

  /**
   * Cross-agent staleness: of the files THIS session has read, which have
   * changed on disk since they were read — by ANY writer (the user, another
   * agent, or an external process)? Unlike `isStale` (which only sees this
   * agent's own EditTool edits via `markAsEdited`), this compares each read
   * file's CURRENT disk mtime against the read timestamp. mtime is bumped by
   * every writer, so this catches uncommitted changes made outside this agent.
   *
   * Used by the harness to warn the model to re-read before editing when two
   * agents (or a human + agent) share one working tree.
   *
   * @returns Files read this session that are now modified or deleted on disk.
   */
  static getExternallyChangedFiles(): { path: string; deleted: boolean }[] {
    const changed: { path: string; deleted: boolean }[] = [];
    for (const [filePath, readTime] of this.fileReadTimestamps) {
      try {
        const mtimeMs = fs.statSync(filePath).mtimeMs;
        // Small epsilon guard: only flag when the on-disk mtime is meaningfully
        // newer than the moment we read it.
        if (mtimeMs > readTime + 1) {
          changed.push({ path: filePath, deleted: false });
        }
      } catch {
        // statSync throws if the file was deleted/moved since we read it.
        changed.push({ path: filePath, deleted: true });
      }
    }
    return changed;
  }

  /**
   * Phase 3: Suggest optimal read parameters for multiple edit targets
   * When the model plans multiple edits, this calculates a single read that covers all targets
   *
   * @param filePath Path to the file
   * @param editTargets Array of strings to search for (old_string values for planned edits)
   * @param contextLines Number of context lines above/below (default: 10)
   * @returns Suggested offset/limit that covers all targets, or null if not all targets found
   */
  static suggestBatchRead(
    filePath: string,
    editTargets: string[],
    contextLines: number = 10
  ): { offset: number; limit: number; coverage: { target: string; lineNumber: number }[] } | null {
    if (editTargets.length === 0) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      // Find line numbers for all edit targets
      const coverage: { target: string; lineNumber: number }[] = [];
      let minLine = Infinity;
      let maxLine = -Infinity;

      for (const target of editTargets) {
        const firstLineOfSearch = target.split('\n')[0];
        if (!firstLineOfSearch) continue;

        for (let i = 0; i < lines.length; i++) {
          if (lines[i]?.includes(firstLineOfSearch)) {
            const targetLineCount = target.split('\n').length;
            const startLine = i;
            const endLine = i + targetLineCount;

            minLine = Math.min(minLine, startLine);
            maxLine = Math.max(maxLine, endLine);

            coverage.push({ target: firstLineOfSearch.substring(0, 40), lineNumber: i + 1 });
            break; // Found this target, move to next
          }
        }
      }

      // If we didn't find all targets, return null
      if (coverage.length !== editTargets.length) {
        return null;
      }

      // Calculate bounding box with context
      const offset = Math.max(0, minLine - contextLines);
      const limit = (maxLine - minLine) + (contextLines * 2);

      return { offset, limit, coverage };
    } catch {
      return null; // File read error
    }
  }

  /**
   * Get the consecutive edit count for a file
   * Useful for displaying in error messages
   */
  static getConsecutiveEditCount(filePath: string): number {
    return this.consecutiveEditCount.get(filePath) || 0;
  }

  /**
   * Get the max allowed consecutive edits
   */
  static getMaxConsecutiveEdits(): number {
    return this.MAX_CONSECUTIVE_EDITS;
  }
}

/**
 * Parameters for the Edit tool
 */
export interface EditToolParams {
  /**
   * The absolute path to the file to modify
   */
  file_path: string;

  /**
   * The exact literal text to replace
   */
  old_string: string;

  /**
   * The exact literal text to replace it with
   */
  new_string: string;

  /**
   * Whether to replace all occurrences (default: false, only replaces one)
   */
  replace_all?: boolean;

  /**
   * Number of replacements expected (default: 1 if not replace_all, otherwise actual count).
   * Used for validation - edit will fail if actual count doesn't match expected.
   */
  expected_replacements?: number;
}

/**
 * EditFile Tool Executor
 *
 * Features:
 * - Exact string replacement (no fuzzy matching)
 * - Single or multiple occurrence replacement
 * - Validates unique match (unless replace_all is true)
 * - Generates diff for display
 * - Security: prevents path traversal
 */
export class EditTool extends BaseTool<EditToolParams, ToolResult> {
  constructor(private config: ExecutorConfig) {
    super(
      'Edit',
      'Edit',
      `Performs exact string replacements in files. By default, replaces a single occurrence (requires unique match). Set replace_all to true to replace all occurrences.

CRITICAL REQUIREMENTS:
1. file_path MUST be an absolute path
2. old_string MUST be the EXACT literal text to replace (including all whitespace, indentation, newlines)
3. new_string MUST be the EXACT literal text to replace old_string with
4. For single replacements: old_string must match exactly ONE location in the file
5. For multiple replacements: set replace_all to true

IMPORTANT: Include sufficient context (3+ lines before/after) in old_string to ensure unique matching.`,
      {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description:
              "The absolute path to the file to modify. Must start with '/'.",
          },
          old_string: {
            type: 'string',
            description:
              'The exact literal text to replace. For single replacements, include at least 3 lines of context before and after to ensure unique matching. Must match exactly (including whitespace and indentation).',
          },
          new_string: {
            type: 'string',
            description:
              'The exact literal text to replace old_string with. Provide the EXACT text with proper indentation and formatting.',
          },
          replace_all: {
            type: 'boolean',
            description:
              'If true, replaces all occurrences of old_string. If false (default), requires exactly one match.',
          },
          expected_replacements: {
            type: 'number',
            description:
              'Optional: Number of replacements expected. Defaults to 1 for single replacements. Edit will fail if actual count does not match expected count. Use this to validate your edit affects the expected number of locations.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    );
  }

  validateToolParams(params: EditToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Normalize and resolve path (with smart fallback for doubled directory names)
    let filePath = resolveFilePath(params.file_path, this.config.workingDirectory);

    // Path validation: allow any absolute path (matching standard absolute-path behavior).
    if (!path.isAbsolute(filePath)) {
      return `File path must resolve to an absolute path: ${filePath}`;
    }

    // Update params with resolved path
    params.file_path = filePath;

    // Special case: empty old_string means create new file
    if (params.old_string === '' && !fileExists(filePath)) {
      return null; // Valid: creating new file
    }

    // MANDATORY READ-BEFORE-EDIT PROTOCOL (read-before-edit standard)
    // Ensure file has been read in this session before allowing edits
    // Phase 2: Brief read mode allows up to MAX_CONSECUTIVE_EDITS in same region if content unchanged
    if (params.old_string !== '' && !FileReadTracker.hasBeenRead(filePath)) {
      const relativePath = makeRelative(filePath, this.config.workingDirectory);

      // Check if file is stale (edited after last read)
      const isStale = FileReadTracker.isStale(filePath);

      if (isStale) {
        // Phase 2: Brief read mode - check if we can allow this edit without re-read
        // Conditions: consecutive edit count < MAX, same region, content hash unchanged
        const stringLocation = FileReadTracker.findStringInFile(filePath, params.old_string);
        if (stringLocation) {
          const editStartLine = stringLocation.lineNumber - 1; // 0-indexed
          const editEndLine = editStartLine + params.old_string.split('\n').length;

          if (FileReadTracker.canSkipReRead(filePath, editStartLine, editEndLine)) {
            // Brief read mode: Allow edit without re-read
            // The content fingerprint confirms no external changes, and we're under the limit
            return null; // Allow the edit
          }
        }

        // File was edited since last read and doesn't qualify for brief read mode
        // Provide smart suggestion for re-read
        const suggestedParams = FileReadTracker.getSuggestedReadParams(filePath);

        if (suggestedParams) {
          const editCount = FileReadTracker.getConsecutiveEditCount(filePath);
          const maxEdits = FileReadTracker.getMaxConsecutiveEdits();
          const briefModeMsg = editCount >= maxEdits
            ? ` (Reached max ${maxEdits} consecutive edits without re-read.)`
            : '';
          return `File has been edited since you last read it.${briefModeMsg} You must re-read the file to see the current state before making another edit. Use: read tool with file_path: "${relativePath}", offset: ${suggestedParams.offset}, limit: ${suggestedParams.limit} to see the recently edited section with context.`;
        }

        // Second try: find where their old_string appears and suggest that location
        if (stringLocation) {
          return `File has been edited since you last read it. You must re-read the file to see the current state before making another edit.

Your edit target appears around line ${stringLocation.lineNumber}. Use:
  read(file_path: "${relativePath}", offset: ${stringLocation.offset}, limit: ${stringLocation.limit})

This covers lines ${stringLocation.offset + 1}-${stringLocation.offset + stringLocation.limit} where your edit target appears.`;
        }

        return `File has been edited since you last read it. You must re-read the file to see the current state before making another edit. Use the read tool with file_path: "${relativePath}"`;
      }

      // Never read before - search for where the old_string appears and suggest targeted read
      const stringLocation = FileReadTracker.findStringInFile(filePath, params.old_string);
      if (stringLocation) {
        return `You must read the file before editing it.

Your edit target appears around line ${stringLocation.lineNumber}. Use:
  read(file_path: "${relativePath}", offset: ${stringLocation.offset}, limit: ${stringLocation.limit})

This covers lines ${stringLocation.offset + 1}-${stringLocation.offset + stringLocation.limit} where your edit target appears.`;
      }

      // Fallback: couldn't find the string, suggest reading the whole file
      return `You must read the file before editing it. Use the read tool first to see the current file content (file_path: "${relativePath}"), then call edit with the exact text you want to replace. This ensures you have the current file state and prevents edits based on stale or assumed content.`;
    }

    // Check file exists for edits
    if (params.old_string !== '' && !fileExists(filePath)) {
      return `File not found: ${filePath}. Use write tool to create new files.`;
    }

    // If old_string is empty but file exists, error
    if (params.old_string === '' && fileExists(filePath)) {
      return `Cannot create file that already exists: ${filePath}`;
    }

    return null;
  }

  getDescription(params: EditToolParams): string {
    if (!params || !params.file_path) {
      return 'Edit file';
    }

    const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
    const shortened = shortenPath(relativePath);

    // Special case: creating new file
    if (params.old_string === '') {
      return `Create ${shortened}`;
    }

    // Same old and new strings
    if (params.old_string === params.new_string) {
      return `No changes to ${shortened}`;
    }

    // Show snippet of change
    const oldSnippet =
      (params.old_string.split('\n')[0] || '').substring(0, 30) +
      (params.old_string.length > 30 ? '...' : '');
    const newSnippet =
      (params.new_string.split('\n')[0] || '').substring(0, 30) +
      (params.new_string.length > 30 ? '...' : '');

    return `${shortened}: ${oldSnippet} => ${newSnippet}`;
  }

  async execute(
    params: EditToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // Validate parameters
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return this.createErrorResult(validationError);
    }

    try {
      // Special case: creating new file
      if (params.old_string === '' && !fileExists(params.file_path)) {
        return await this.createNewFile(params, startTime, updateOutput);
      }

      // Read current file content
      let currentContent = await fs.promises.readFile(params.file_path, 'utf-8');

      // Normalize line endings to LF
      currentContent = normalizeLineEndings(currentContent);

      // Count occurrences
      const occurrences = countOccurrences(currentContent, params.old_string);

      // Determine expected count
      const expectedReplacements = params.expected_replacements ?? (params.replace_all ? occurrences : 1);

      // Validate occurrence count
      if (occurrences === 0) {
        return this.createErrorResult(
          `Failed to edit: could not find the string to replace in ${params.file_path}. ` +
            `The exact text in old_string was not found. ` +
            `Ensure you're matching whitespace and indentation precisely.`,
        );
      }

      if (!params.replace_all && occurrences > 1) {
        return this.createErrorResult(
          `Failed to edit: found ${occurrences} occurrences but expected exactly 1. ` +
            `Either set replace_all to true or include more context in old_string to make it unique.`,
        );
      }

      // Validate expected replacements if specified
      if (params.expected_replacements !== undefined && occurrences !== expectedReplacements) {
        return this.createErrorResult(
          `Failed to edit: found ${occurrences} occurrences but expected ${expectedReplacements}. ` +
            `The actual count does not match the expected count. ` +
            `Either update expected_replacements or verify old_string is correct.`,
        );
      }

      // Perform safe literal replacement (handles $ escape sequences correctly)
      const newContent = safeLiteralReplace(currentContent, params.old_string, params.new_string);

      // Write updated content
      await fs.promises.writeFile(params.file_path, newContent, 'utf-8');

      // Calculate edit region for consecutive edit tracking
      // Find the line number where old_string starts
      const lines = currentContent.split('\n');
      let editStartLine = 0;
      const firstLineOfOldString = params.old_string.split('\n')[0] || '';
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.includes(firstLineOfOldString)) {
          editStartLine = i;
          break;
        }
      }
      const editEndLine = editStartLine + params.new_string.split('\n').length;

      // Mark file as edited with region info (enables brief read mode tracking)
      FileReadTracker.markAsEdited(params.file_path, editStartLine, editEndLine);

      // Update fingerprint to reflect our edit - this enables consecutive edits
      // by keeping the fingerprint in sync with our known changes
      const newLines = newContent.split('\n');
      const editedSectionContent = newLines.slice(editStartLine, editEndLine).join('\n');
      FileReadTracker.updateFingerprintAfterEdit(params.file_path, editStartLine, editEndLine, editedSectionContent);

      // Generate diff for display
      const fileName = path.basename(params.file_path);
      const diff = Diff.createPatch(
        fileName,
        currentContent,
        newContent,
        'Current',
        'Proposed',
        { context: 3 },
      );

      // Format success message
      const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
      const displayContent = `Modified ${relativePath} (${occurrences} replacement${occurrences > 1 ? 's' : ''})`;

      // Stream output if callback provided
      if (updateOutput) {
        updateOutput(displayContent);
      }

      return this.createSuccessResult(
        `Successfully modified file: ${params.file_path} (${occurrences} replacement${occurrences > 1 ? 's' : ''}).`,
        {
          executionTime: Date.now() - startTime,
          resourcesUsed: {
            files: [params.file_path],
          },
          fileStats: {
            path: relativePath,
            occurrences,
            operation: 'edit',
          },
          diff, // Include diff in metadata for potential UI display
        },
      );
    } catch (error: any) {
      // Handle write errors
      if (error.code === 'EACCES') {
        return this.createErrorResult(`Permission denied: ${params.file_path}`);
      }

      if (error.code === 'ENOSPC') {
        return this.createErrorResult('No space left on device');
      }

      if (error.code === 'EROFS') {
        return this.createErrorResult('Read-only file system');
      }

      return this.createErrorResult(`Failed to edit file: ${error.message}`);
    }
  }

  /**
   * Creates a new file (when old_string is empty)
   * @private
   */
  private async createNewFile(
    params: EditToolParams,
    startTime: number,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    try {
      // Ensure parent directory exists
      const dirPath = path.dirname(params.file_path);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Write file
      await fs.promises.writeFile(params.file_path, params.new_string, 'utf-8');

      // Get file stats
      const stats = await fs.promises.stat(params.file_path);
      const fileSize = stats.size;
      const lineCount = params.new_string.split('\n').length;

      // Format for display
      const relativePath = makeRelative(params.file_path, this.config.workingDirectory);
      const displayContent = `Created ${relativePath} (${lineCount} lines, ${fileSize} bytes)`;

      // Stream output if callback provided
      if (updateOutput) {
        updateOutput(displayContent);
      }

      return this.createSuccessResult(
        `Created new file: ${params.file_path} with provided content.`,
        {
          executionTime: Date.now() - startTime,
          resourcesUsed: {
            files: [params.file_path],
          },
          fileStats: {
            path: relativePath,
            size: fileSize,
            lines: lineCount,
            operation: 'create',
          },
        },
      );
    } catch (error: any) {
      return this.createErrorResult(`Failed to create file: ${error.message}`);
    }
  }

}
