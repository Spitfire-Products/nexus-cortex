# XAI Tool Calling - Root Cause Analysis

**Date**: 2025-11-07
**Status**: Root cause identified by studying OmniClaude V3 implementation
**Context**: System message injection is WORKING ✅ - This is a separate XAI compatibility issue

## Executive Summary

After studying the working XAI implementation in OmniClaude V3, I identified **critical differences** in how tool calling is handled that explain the failures in V4.

## Test Failures Observed

```
[Orchestrator Phase 2.5] Executing tool: undefined
[Orchestrator Phase 2.5] Unknown tool: undefined

XAI Messages API error (422): Failed to deserialize the JSON body into the target type:
messages[1].content: data did not match any variant of untagged enum MessageContent
```

##root Cause: Missing XAI-Specific Handling

### 1. **Tool Schema Validation** (CRITICAL)

**V3 Implementation** (`XAIAnthropicProvider.ts` lines 687-752):
```typescript
private validateAndEnhanceTools(tools: any[]): any[] {
  return tools.map((tool, index) => {
    const enhancedTool = { ...tool };

    // Ensure tool has a name
    if (!enhancedTool.name) {
      console.error(`[XAI-Anthropic] Tool at index ${index} missing name!`);
      enhancedTool.name = `tool_${index}`;
    }

    // Ensure tool has a description
    if (!enhancedTool.description || typeof enhancedTool.description !== 'string') {
      enhancedTool.description = enhancedTool.name ?
        `Execute ${enhancedTool.name} tool` :
        `Tool ${index}`;
    }

    // CRITICAL FIX: Ensure input_schema exists
    if (!enhancedTool.input_schema) {
      console.error(`[XAI-Anthropic] Tool ${enhancedTool.name} missing input_schema! Creating default.`);
      enhancedTool.input_schema = {
        type: 'object',
        properties: {},
        required: []
      };
    }

    // Ensure input_schema has proper structure
    if (!enhancedTool.input_schema.type) {
      enhancedTool.input_schema.type = 'object';
    }

    if (!enhancedTool.input_schema.properties) {
      enhancedTool.input_schema.properties = {};
    }

    // Ensure all parameters have descriptions
    if (enhancedTool.input_schema.properties) {
      const properties = enhancedTool.input_schema.properties;

      for (const [key, prop] of Object.entries(properties) as [string, any][]) {
        if (!prop.description || typeof prop.description !== 'string') {
          prop.description = `Parameter ${key} for ${enhancedTool.name || 'tool'}`;
        }
      }

      // Ensure required field exists (XAI expects it)
      if (!enhancedTool.input_schema.required) {
        enhancedTool.input_schema.required = [];
      }
    }

    return enhancedTool;
  });
}
```

**V4 Implementation** (`MessagesAPIAdapter.ts` lines 372-389):
```typescript
private convertToMessagesAPITool(tool: CanonicalTool): MessagesAPITool {
  // Defensive check: ensure schema exists
  if (!tool.schema) {
    throw new Error(`Tool "${tool.name}" is missing required schema property`);  // ❌ THROWS instead of fixing
  }

  return {
    name: tool.name,
    description: tool.description,  // ❌ No validation that it exists
    input_schema: {
      type: 'object',
      properties: tool.schema.properties || {},
      required: tool.schema.required || [],
      ...this.extractAdditionalSchemaProperties(tool.schema)
    }
  };
}
```

**Problem**: V4 throws errors instead of fixing/enhancing tools, and doesn't validate descriptions or property descriptions.

### 2. **Tool Result Content Format** (CRITICAL)

**V3 Implementation** (`XAIAnthropicProvider.ts` lines 756-831):
```typescript
/**
 * Transform messages to ensure XAI API compliance
 * Main issue: tool_result content MUST be a string per XAI docs
 */
private transformMessages(messages: any[]): any[] {
  return messages.map(msg => {
    if (Array.isArray(msg.content)) {
      const transformedContent = msg.content.map((item: any) => {
        // XAI requires tool_result content to be a string
        if (item.type === 'tool_result') {
          let stringContent: string;

          if (typeof item.content === 'string') {
            stringContent = item.content;
          } else {
            // Safe stringify with circular reference handling
            stringContent = this.safeStringify(item.content);
          }

          return {
            ...item,
            content: stringContent  // ✅ ALWAYS string
          };
        }
        return item;
      });

      return {
        ...msg,
        content: transformedContent
      };
    }
    return msg;
  });
}
```

**V4 Implementation** (`MessagesAPIAdapter.ts` lines 457-459):
```typescript
// Convert content to string if object
const resultContent = typeof block.toolResult.content === 'string'
  ? block.toolResult.content
  : JSON.stringify(block.toolResult.content);
```

**Status**: V4 implementation appears correct ✅

### 3. **Tool Use Response Parsing** (POTENTIAL ISSUE)

**V4 Implementation** (`MessagesAPIAdapter.ts` lines 221-235):
```typescript
fromProviderToolUse(
  providerToolUse: unknown,
  modelConfig: ModelConfig
): CanonicalToolUse {
  const toolUse = providerToolUse as MessagesAPIToolUse;

  return {
    id: toolUse.id,
    name: toolUse.name,  // ❌ No validation - undefined if field missing
    input: toolUse.input,
    metadata: {
      sourceProvider: modelConfig.provider,
      modelId: modelConfig.id
    }
  };
}
```

**Problem**: No validation that `toolUse.name` exists. If XAI returns a malformed tool_use block, `name` could be undefined.

### 4. **TypeScript Interface Definition** (TYPE SAFETY ISSUE)

**V4 MessagesAPIAdapter Interface** (lines 32-53):
```typescript
export interface MessagesAPITool {
  /** Tool name (snake_case - REQUIRED) */
  name: string;

  /** Human-readable description (optional but recommended) */
  description?: string;  // ❌ Should be required for XAI

  /** Input schema - NOTE: property name is "input_schema" */
  input_schema: {
    /** Must be 'object' */
    type: 'object';

    /** Property definitions */
    properties?: Record<string, unknown>;  // ❌ Should be required

    /** Required property names */
    required?: string[];  // ❌ Should be required

    /** Additional JSON Schema properties */
    [key: string]: unknown;
  };
}
```

## Comparison with XAI API Documentation

From `research/api-docs/xai-messages-api/xai_v1_messages_anthropic_compatible.txt`:

```
tools (array | null)
A list of tools the model may call in JSON-schema.

  description (string, required) - Description of the tool
  input_schema (object, required) - Input schema allowed by the tool
    properties (required) - JSON-object of the tool input schema
    required (array | null) - Required properties of the tool input schema
    type (string, required) - Type of the schema. This is always "object"
  name (string, required) - Name of the tool
```

**Key Findings**:
- `description` is **required** (not optional)
- `input_schema.properties` is **required** (not optional)
- `input_schema.required` is **required** (can be null)

## Recommended Fixes

### Fix 1: Add XAI-Specific Tool Validator to MessagesAPIAdapter

```typescript
/**
 * Validate and enhance tools for XAI compatibility
 * XAI has stricter requirements than standard Anthropic API
 */
private validateAndEnhanceToolsForXAI(tools: CanonicalTool[], modelConfig: ModelConfig): CanonicalTool[] {
  if (modelConfig.provider !== 'xai') {
    return tools;  // Only apply to XAI
  }

  return tools.map((tool, index) => {
    const enhanced = { ...tool };

    // Ensure name exists
    if (!enhanced.name || typeof enhanced.name !== 'string') {
      console.warn(`[MessagesAPIAdapter] Tool at index ${index} missing name, using default`);
      enhanced.name = `tool_${index}`;
    }

    // Ensure description exists (XAI requires it)
    if (!enhanced.description || typeof enhanced.description !== 'string') {
      enhanced.description = `Execute ${enhanced.name} tool`;
      console.warn(`[MessagesAPIAdapter] Added description for tool: ${enhanced.name}`);
    }

    // Ensure schema exists
    if (!enhanced.schema) {
      enhanced.schema = {
        type: 'object',
        properties: {},
        required: []
      };
      console.warn(`[MessagesAPIAdapter] Created default schema for tool: ${enhanced.name}`);
    }

    // Ensure schema has required fields
    if (!enhanced.schema.type) enhanced.schema.type = 'object';
    if (!enhanced.schema.properties) enhanced.schema.properties = {};
    if (!enhanced.schema.required) enhanced.schema.required = [];

    // Ensure all properties have descriptions (XAI expects this)
    for (const [key, prop] of Object.entries(enhanced.schema.properties)) {
      const property = prop as any;
      if (!property.description) {
        property.description = `Parameter ${key} for ${enhanced.name}`;
      }
    }

    return enhanced;
  });
}
```

### Fix 2: Add Tool Use Validation

```typescript
fromProviderToolUse(
  providerToolUse: unknown,
  modelConfig: ModelConfig
): CanonicalToolUse {
  const toolUse = providerToolUse as MessagesAPIToolUse;

  // Validate required fields
  if (!toolUse.id) {
    throw new Error('Tool use missing required "id" field');
  }

  if (!toolUse.name) {
    console.error('[MessagesAPIAdapter] Tool use missing "name" field:', toolUse);
    throw new Error(`Tool use ${toolUse.id} missing required "name" field`);
  }

  return {
    id: toolUse.id,
    name: toolUse.name,
    input: toolUse.input || {},
    metadata: {
      sourceProvider: modelConfig.provider,
      modelId: modelConfig.id
    }
  };
}
```

### Fix 3: Call Validator in toProviderTools

```typescript
toProviderTools(
  tools: CanonicalTool[],
  modelConfig: ModelConfig
): MessagesAPITool[] {
  // Apply XAI-specific validation if needed
  const validatedTools = this.validateAndEnhanceToolsForXAI(tools, modelConfig);

  // Gateway has already applied correct naming convention
  // Adapter only handles API format conversion
  return validatedTools.map(tool => this.convertToMessagesAPITool(tool));
}
```

### Fix 4: Update Interface Definitions

```typescript
export interface MessagesAPITool {
  /** Tool name (snake_case - REQUIRED) */
  name: string;

  /** Human-readable description (REQUIRED for XAI, recommended for Anthropic) */
  description: string;  // Made required

  /** Input schema - NOTE: property name is "input_schema" */
  input_schema: {
    /** Must be 'object' */
    type: 'object';

    /** Property definitions (REQUIRED for XAI) */
    properties: Record<string, unknown>;  // Made required

    /** Required property names (REQUIRED for XAI, can be empty array) */
    required: string[];  // Made required

    /** Additional JSON Schema properties */
    [key: string]: unknown;
  };
}
```

## Implementation Priority

1. **High Priority**: Add tool validation method to MessagesAPIAdapter
2. **High Priority**: Add tool_use response validation
3. **Medium Priority**: Update TypeScript interfaces
4. **Low Priority**: Add provider-specific error messages

## Testing Plan

1. Unit tests for tool validation
2. Integration tests with actual XAI API
3. Test with various tool schemas (minimal, complete, malformed)
4. Test tool_use response parsing with edge cases

## Conclusion

The XAI tool calling failures are caused by **missing validation and enhancement** of tool schemas before sending to the API. V3 had extensive defensive validation that V4 lacks. The fix is to add similar validation to MessagesAPIAdapter, specifically for XAI provider.

**System message injection is working perfectly** - this is a separate compatibility issue that was pre-existing.
