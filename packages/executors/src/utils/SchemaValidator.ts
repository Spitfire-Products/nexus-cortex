/**
 * JSON Schema Validator
 *
 * Simple validator for tool parameters using JSON Schema
 */

import type { ToolSchema } from '@nexus-cortex/types';

/**
 * Validate parameters against JSON Schema
 *
 * @param schema JSON Schema definition
 * @param params Parameters to validate (mutated in-place for type coercion)
 * @returns Error message if invalid, null if valid
 */
export function validateSchema(schema: ToolSchema, params: any): string | null {
  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in params)) {
        return `Missing required parameter: ${field}`;
      }
    }
  }

  // Check parameter types (with automatic coercion for numbers)
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in params) {
        let value = params[key];
        const type = propSchema.type;

        // Auto-coerce string numbers to actual numbers
        // This handles cases where parameters come in as strings (e.g., from XML parsing)
        // but the schema expects numeric types
        if (type === 'number' && typeof value === 'string') {
          const numValue = Number(value);
          if (!isNaN(numValue)) {
            params[key] = numValue;
            value = numValue;
          }
        }

        // Type checking
        if (type === 'string' && typeof value !== 'string') {
          return `Parameter '${key}' must be a string`;
        }
        if (type === 'number' && typeof value !== 'number') {
          return `Parameter '${key}' must be a number`;
        }
        if (type === 'boolean' && typeof value !== 'boolean') {
          return `Parameter '${key}' must be a boolean`;
        }
        if (type === 'object' && typeof value !== 'object') {
          return `Parameter '${key}' must be an object`;
        }
        if (type === 'array' && !Array.isArray(value)) {
          return `Parameter '${key}' must be an array`;
        }
      }
    }
  }

  return null;
}

/**
 * Schema Validator class (for compatibility with OmniCode3 patterns)
 */
export class SchemaValidator {
  static validate(schema: ToolSchema, params: any): string | null {
    return validateSchema(schema, params);
  }
}
