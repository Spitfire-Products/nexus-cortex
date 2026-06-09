/**
 * SchemaValidator Tests
 *
 * Tests for the JSON Schema validator, including:
 * - Type checking
 * - Automatic numeric string coercion
 * - Required field validation
 * - Edge cases
 */

import { describe, it, expect } from 'vitest';
import { SchemaValidator } from '../SchemaValidator.js';
import type { ToolSchema } from '@nexus-cortex/types';

describe('SchemaValidator', () => {
  describe('numeric type coercion', () => {
    it('should coerce string "20" to number 20', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
      };

      const params = { offset: '20' };
      const error = SchemaValidator.validate(schema, params);

      // Should not error
      expect(error).toBeNull();

      // Should coerce the value
      expect(params.offset).toBe(20);
      expect(typeof params.offset).toBe('number');
    });

    it('should coerce string "100" for limit parameter', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Line limit',
          },
        },
      };

      const params = { limit: '100' };
      const error = SchemaValidator.validate(schema, params);

      expect(error).toBeNull();
      expect(params.limit).toBe(100);
      expect(typeof params.limit).toBe('number');
    });

    it('should handle negative numbers', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'Some value',
          },
        },
      };

      const params = { value: '-50' };
      const error = SchemaValidator.validate(schema, params);

      expect(error).toBeNull();
      expect(params.value).toBe(-50);
    });

    it('should handle floating point numbers', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          ratio: {
            type: 'number',
            description: 'Some ratio',
          },
        },
      };

      const params = { ratio: '3.14' };
      const error = SchemaValidator.validate(schema, params);

      expect(error).toBeNull();
      expect(params.ratio).toBe(3.14);
    });

    it('should reject non-numeric strings', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
      };

      const params = { offset: 'not-a-number' };
      const error = SchemaValidator.validate(schema, params);

      expect(error).toBe("Parameter 'offset' must be a number");
      // Should not coerce invalid strings
      expect(params.offset).toBe('not-a-number');
    });

    it('should handle numbers already as numbers', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
      };

      const params = { offset: 42 };
      const error = SchemaValidator.validate(schema, params);

      expect(error).toBeNull();
      expect(params.offset).toBe(42);
    });

    it('should handle zero and negative zero', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'Some value',
          },
        },
      };

      const params1 = { value: '0' };
      expect(SchemaValidator.validate(schema, params1)).toBeNull();
      expect(params1.value).toBe(0);

      const params2 = { value: '-0' };
      expect(SchemaValidator.validate(schema, params2)).toBeNull();
      // Note: JavaScript distinguishes -0 and +0 with Object.is()
      // Both are valid zero values, either is acceptable
      expect(typeof params2.value).toBe('number');
      expect(Object.is(params2.value, 0) || Object.is(params2.value, -0)).toBe(true);
    });
  });

  describe('type validation', () => {
    it('should validate string types', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path',
          },
        },
      };

      const params = { path: '/home/user/file.txt' };
      expect(SchemaValidator.validate(schema, params)).toBeNull();
    });

    it('should reject non-string when string expected', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path',
          },
        },
      };

      const params = { path: 123 };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'path' must be a string");
    });

    it('should validate boolean types', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Enable feature',
          },
        },
      };

      expect(SchemaValidator.validate(schema, { enabled: true })).toBeNull();
      expect(SchemaValidator.validate(schema, { enabled: false })).toBeNull();
    });

    it('should reject non-boolean when boolean expected', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Enable feature',
          },
        },
      };

      const params = { enabled: 'true' };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'enabled' must be a boolean");
    });

    it('should validate array types', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'List of items',
          },
        },
      };

      expect(SchemaValidator.validate(schema, { items: [1, 2, 3] })).toBeNull();
      expect(SchemaValidator.validate(schema, { items: [] })).toBeNull();
    });

    it('should reject non-array when array expected', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'List of items',
          },
        },
      };

      const params = { items: 'not-an-array' };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'items' must be an array");
    });

    it('should validate object types', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            description: 'Configuration object',
          },
        },
      };

      expect(SchemaValidator.validate(schema, { config: {} })).toBeNull();
      expect(SchemaValidator.validate(schema, { config: { key: 'value' } })).toBeNull();
    });

    it('should reject non-object when object expected', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            description: 'Configuration object',
          },
        },
      };

      const params = { config: 'not-an-object' };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'config' must be an object");
    });
  });

  describe('required fields', () => {
    it('should allow required field when present', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path',
          },
        },
        required: ['file_path'],
      };

      expect(SchemaValidator.validate(schema, { file_path: '/home/user/file.txt' })).toBeNull();
    });

    it('should reject missing required field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path',
          },
        },
        required: ['file_path'],
      };

      const error = SchemaValidator.validate(schema, {});
      expect(error).toBe('Missing required parameter: file_path');
    });

    it('should handle multiple required fields', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path',
          },
          content: {
            type: 'string',
            description: 'File content',
          },
        },
        required: ['file_path', 'content'],
      };

      expect(
        SchemaValidator.validate(schema, {
          file_path: '/home/user/file.txt',
          content: 'Hello',
        }),
      ).toBeNull();

      expect(SchemaValidator.validate(schema, { file_path: '/home/user/file.txt' })).toBe(
        'Missing required parameter: content',
      );
    });
  });

  describe('optional fields', () => {
    it('should allow optional field when present', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path',
          },
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
        required: ['file_path'],
      };

      expect(
        SchemaValidator.validate(schema, {
          file_path: '/home/user/file.txt',
          offset: '20',
        }),
      ).toBeNull();
    });

    it('should allow optional field when absent', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path',
          },
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
        required: ['file_path'],
      };

      expect(
        SchemaValidator.validate(schema, {
          file_path: '/home/user/file.txt',
        }),
      ).toBeNull();
    });
  });

  describe('real-world scenarios', () => {
    it('should handle ReadFileTool parameters with string coercion', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Optional: 0-based line number to start reading from',
          },
          limit: {
            type: 'number',
            description: 'Optional: Maximum number of lines to read',
          },
        },
        required: ['file_path'],
      };

      const params = {
        file_path: '/home/user/file.txt',
        offset: '20',
        limit: '100',
      };

      expect(SchemaValidator.validate(schema, params)).toBeNull();
      expect(params.offset).toBe(20);
      expect(params.limit).toBe(100);
      expect(params.file_path).toBe('/home/user/file.txt');
    });

    it('should handle parameters with only required field', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Optional: 0-based line number to start reading from',
          },
          limit: {
            type: 'number',
            description: 'Optional: Maximum number of lines to read',
          },
        },
        required: ['file_path'],
      };

      const params = {
        file_path: '/home/user/file.txt',
      };

      expect(SchemaValidator.validate(schema, params)).toBeNull();
    });

    it('should reject parameters with invalid optional field type', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Optional: 0-based line number to start reading from',
          },
        },
        required: ['file_path'],
      };

      const params = {
        file_path: '/home/user/file.txt',
        offset: 'not-a-number',
      };

      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'offset' must be a number");
    });
  });

  describe('edge cases', () => {
    it('should handle empty schema', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {},
      };

      expect(SchemaValidator.validate(schema, {})).toBeNull();
      expect(SchemaValidator.validate(schema, { extra: 'field' })).toBeNull();
    });

    it('should handle null values', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'Some value',
          },
        },
      };

      const params = { value: null };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'value' must be a number");
    });

    it('should reject explicitly undefined values', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'Some value',
          },
        },
      };

      const params = { value: undefined };
      // If a property is explicitly set to undefined, it's in the object
      // and should fail validation if schema expects a number
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBe("Parameter 'value' must be a number");
    });

    it('should allow omitted optional fields', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          required_field: {
            type: 'string',
            description: 'Required field',
          },
          optional_field: {
            type: 'number',
            description: 'Optional field',
          },
        },
        required: ['required_field'],
      };

      // Not including optional_field at all should be fine
      const params = { required_field: 'value' };
      expect(SchemaValidator.validate(schema, params)).toBeNull();
    });

    it('should handle scientific notation in strings', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          value: {
            type: 'number',
            description: 'Some value',
          },
        },
      };

      const params = { value: '1.5e2' };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBeNull();
      expect(params.value).toBe(150);
    });

    it('should handle whitespace in numeric strings', () => {
      const schema: ToolSchema = {
        type: 'object',
        properties: {
          offset: {
            type: 'number',
            description: 'Line offset',
          },
        },
      };

      const params = { offset: '  20  ' };
      const error = SchemaValidator.validate(schema, params);
      expect(error).toBeNull();
      expect(params.offset).toBe(20);
    });
  });
});
