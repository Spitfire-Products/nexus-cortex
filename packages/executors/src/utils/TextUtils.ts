/**
 * Text Utility Functions
 *
 * Safe text manipulation utilities, especially for handling special characters
 * in string replacements.
 */

/**
 * Performs a safe literal string replacement that correctly handles $ sequences.
 *
 * JavaScript's String.replace() treats $ specially in replacement strings:
 * - $& = the matched substring
 * - $` = portion before match
 * - $' = portion after match
 * - $1, $2, etc. = capture groups
 * - $$ = literal $
 *
 * This function ensures $ characters in the replacement string are treated literally.
 *
 * @param content The string to search in
 * @param oldString The exact string to find (literal, not regex)
 * @param newString The exact string to replace with (literal, $ are escaped)
 * @returns The content with replacements made
 *
 * @example
 * // Without safe replacement:
 * "foo".replace("foo", "$100")  // Returns "0" ($ is special)
 *
 * // With safe replacement:
 * safeLiteralReplace("foo", "foo", "$100")  // Returns "$100" ($ is literal)
 */
export function safeLiteralReplace(
  content: string,
  oldString: string,
  newString: string,
): string {
  // replaceAll() is safe for literal strings (doesn't use regex)
  // But we still need to escape $ in the replacement string
  // because replaceAll treats $ specially in replacement patterns

  // Escape all $ characters by doubling them
  // This ensures $100 becomes $$100 which replaceAll interprets as literal $100
  const safeNewString = newString.replace(/\$/g, '$$$$');

  // Use replaceAll for literal string replacement
  return content.replaceAll(oldString, safeNewString);
}

/**
 * Counts occurrences of a literal string in content.
 *
 * @param content The string to search in
 * @param searchString The exact string to count
 * @returns The number of non-overlapping occurrences
 */
export function countOccurrences(content: string, searchString: string): number {
  if (searchString === '') {
    return 0; // Empty string has no meaningful occurrences
  }

  let count = 0;
  let position = 0;

  while ((position = content.indexOf(searchString, position)) !== -1) {
    count++;
    position += searchString.length; // Move past this occurrence
  }

  return count;
}

/**
 * Escapes special regex characters in a string to make it safe for use in a RegExp.
 *
 * @param str The string to escape
 * @returns The escaped string safe for use in new RegExp()
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes line endings to LF (\n).
 *
 * @param content The content with potentially mixed line endings
 * @returns The content with normalized LF line endings
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Truncates text to a maximum length, adding ellipsis if needed.
 *
 * @param text The text to truncate
 * @param maxLength Maximum length (default: 100)
 * @param ellipsis The ellipsis to add (default: '...')
 * @returns The truncated text
 */
export function truncate(
  text: string,
  maxLength: number = 100,
  ellipsis: string = '...',
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Gets the first line of text.
 *
 * @param text The multi-line text
 * @returns The first line
 */
export function getFirstLine(text: string): string {
  const lines = text.split('\n');
  return lines[0] || '';
}

/**
 * Strips ANSI escape codes from text.
 *
 * @param text The text with ANSI codes
 * @returns The text without ANSI codes
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  );
}
