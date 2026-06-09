/**
 * Utility functions for type checking and exhaustive checks
 */

/**
 * Exhaustive check helper for switch statements
 * Use this in the default case to ensure all cases are handled
 */
export function checkExhaustive(value: never): never {
  throw new Error(`Unhandled value: ${value}`);
}
