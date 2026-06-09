# RetryMiddleware - Usage Guide

## Overview

The `RetryMiddleware` provides intelligent retry orchestration with exponential backoff and jitter for transient errors. It works seamlessly with the `ErrorClassificationMiddleware` to determine which errors should be retried.

## Features

- **Exponential Backoff**: Progressively longer delays between retries
- **Jitter**: Random delay variation to prevent thundering herd
- **Error Classification**: Integrates with `ErrorClassificationMiddleware`
- **Metadata Tracking**: Captures retry attempts, delays, and error history
- **Configurable**: Flexible options for different use cases
- **Type Safe**: Full TypeScript support with generics

## Basic Usage

```typescript
import { RetryMiddleware } from './middleware/RetryMiddleware.js';
import { ErrorClassificationMiddleware } from './middleware/ErrorClassificationMiddleware.js';

// Create instances
const errorClassifier = new ErrorClassificationMiddleware();
const retryMiddleware = new RetryMiddleware(errorClassifier);

// Execute an operation with retry
const result = await retryMiddleware.executeWithRetry(
  async () => {
    // Your operation that might fail
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  },
  'fetchApiData' // Context for logging/debugging
);

console.log('Result:', result.result);
console.log('Took', result.attemptCount, 'attempts');
console.log('Total delay:', result.totalDelayMs, 'ms');
console.log('Errors encountered:', result.errors.length);
```

## Configuration Options

```typescript
interface RetryOptions {
  maxRetries: number;           // Maximum retry attempts (default: 3)
  baseDelayMs: number;          // Initial delay in milliseconds (default: 1000)
  maxDelayMs: number;           // Maximum delay cap (default: 30000)
  backoffMultiplier: number;    // Exponential growth factor (default: 2)
  jitterFactor: number;         // Jitter as fraction of delay (default: 0.1)
}
```

### Custom Configuration

```typescript
const retryMiddleware = new RetryMiddleware(errorClassifier, {
  maxRetries: 5,              // Try up to 6 times total (1 initial + 5 retries)
  baseDelayMs: 500,           // Start with 500ms delay
  maxDelayMs: 10000,          // Cap at 10 seconds
  backoffMultiplier: 1.5,     // Slower exponential growth
  jitterFactor: 0.2           // 20% jitter
});
```

## Retry Result

The `executeWithRetry` method returns a `RetryResult<T>` object:

```typescript
interface RetryResult<T> {
  result: T;                          // The successful result
  attemptCount: number;               // Number of attempts made
  totalDelayMs: number;               // Total time spent waiting
  errors: ErrorClassification[];      // All errors encountered
}
```

### Accessing Retry Metadata

```typescript
const result = await retryMiddleware.executeWithRetry(
  async () => fetchData(),
  'fetchData'
);

if (result.attemptCount > 1) {
  console.log(`Succeeded after ${result.attemptCount} attempts`);
  console.log('Errors encountered:');
  result.errors.forEach((error, index) => {
    console.log(`  Attempt ${index + 1}: ${error.errorType} - ${error.message}`);
  });
}
```

## Error Handling

### Catching Non-Retryable Errors

```typescript
try {
  const result = await retryMiddleware.executeWithRetry(
    async () => someOperation(),
    'operationName'
  );
  console.log('Success:', result.result);
} catch (error: any) {
  // Check if retry metadata is available
  if (error.retryMetadata) {
    console.log('Failed after', error.retryMetadata.attemptCount, 'attempts');
    console.log('Error type:', error.retryMetadata.lastErrorType);
    console.log('Was retryable:', error.retryMetadata.wasRetryable);
  }
  throw error;
}
```

### Enhanced Error Information

Errors thrown by `executeWithRetry` include a non-enumerable `retryMetadata` property:

```typescript
interface RetryMetadata {
  context: string;                    // Operation context
  attemptCount: number;               // Number of attempts made
  totalDelayMs: number;               // Total delay time
  errors: ErrorClassification[];      // All error classifications
  lastErrorType: string;              // Type of final error
  wasRetryable: boolean;              // Whether final error was retryable
}
```

## Exponential Backoff Behavior

### Default Configuration
- **Base delay**: 1000ms (1 second)
- **Multiplier**: 2 (doubles each time)
- **Jitter**: ±10%

### Delay Sequence Example

| Attempt | Calculation | Delay Range (with jitter) |
|---------|-------------|---------------------------|
| 0 (1st) | 1000 * 2^0  | 900ms - 1100ms           |
| 1 (2nd) | 1000 * 2^1  | 1800ms - 2200ms          |
| 2 (3rd) | 1000 * 2^2  | 3600ms - 4400ms          |
| 3 (4th) | 1000 * 2^3  | 7200ms - 8800ms          |

### Customizing Backoff Behavior

```typescript
// Fast retries for quick operations
const fastRetry = new RetryMiddleware(errorClassifier, {
  maxRetries: 2,
  baseDelayMs: 100,
  maxDelayMs: 1000,
  backoffMultiplier: 2,
  jitterFactor: 0.1
});
// Delays: ~100ms, ~200ms

// Slow retries for heavy operations
const slowRetry = new RetryMiddleware(errorClassifier, {
  maxRetries: 5,
  baseDelayMs: 5000,
  maxDelayMs: 60000,
  backoffMultiplier: 1.5,
  jitterFactor: 0.2
});
// Delays: ~5s, ~7.5s, ~11.25s, ~16.875s, ~25.3s

// Linear backoff (no exponential growth)
const linearRetry = new RetryMiddleware(errorClassifier, {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 1,  // No growth
  jitterFactor: 0.1
});
// Delays: ~1s, ~1s, ~1s

// No jitter (deterministic delays)
const deterministicRetry = new RetryMiddleware(errorClassifier, {
  maxRetries: 3,
  baseDelayMs: 1000,
  backoffMultiplier: 2,
  jitterFactor: 0  // No randomness
});
// Delays: exactly 1s, 2s, 4s
```

## Integration with Error Classification

The `RetryMiddleware` automatically uses the `ErrorClassificationMiddleware` to determine retry eligibility:

### Retryable Errors
- Network errors: `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `socket hang up`, `fetch failed`
- HTTP status codes: `408`, `429`, `500`, `502`, `503`, `504`
- Temporary FS errors: `EBUSY`, `EAGAIN`

### Non-Retryable Errors
- Permission errors: `EACCES`, `EPERM`, `permission denied`, `unauthorized`, `forbidden`
- Validation errors: `invalid`, `validation failed`, `ENOENT` (file not found)
- Abort errors: `AbortError`, errors containing "abort"
- HTTP client errors: `400`, `401`, `403`, `404`

## Common Use Cases

### 1. API Requests with Rate Limiting

```typescript
async function fetchWithRetry(url: string) {
  return retryMiddleware.executeWithRetry(
    async () => {
      const response = await fetch(url);
      if (response.status === 429) {
        throw Object.assign(new Error('Rate limited'), { status: 429 });
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    },
    `fetch:${url}`
  );
}
```

### 2. Database Operations

```typescript
async function queryWithRetry(query: string) {
  return retryMiddleware.executeWithRetry(
    async () => {
      return await db.query(query);
    },
    `db:query:${query.substring(0, 50)}`
  );
}
```

### 3. File System Operations

```typescript
async function writeFileWithRetry(path: string, content: string) {
  return retryMiddleware.executeWithRetry(
    async () => {
      await fs.promises.writeFile(path, content);
      return { success: true, path };
    },
    `fs:write:${path}`
  );
}
```

### 4. External Service Calls

```typescript
async function callExternalService(payload: any) {
  const serviceRetry = new RetryMiddleware(errorClassifier, {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 30000
  });

  return serviceRetry.executeWithRetry(
    async () => {
      const response = await externalService.call(payload);
      if (!response.success) {
        throw new Error(response.error);
      }
      return response.data;
    },
    'externalService:call'
  );
}
```

## Advanced Patterns

### Conditional Retry Logic

```typescript
async function advancedRetry<T>(
  operation: () => Promise<T>,
  shouldRetry?: (error: any) => boolean
) {
  try {
    return await retryMiddleware.executeWithRetry(operation, 'custom');
  } catch (error: any) {
    if (shouldRetry && shouldRetry(error)) {
      // Custom retry logic
      return await operation();
    }
    throw error;
  }
}
```

### Retry with Timeout

```typescript
async function retryWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number = 60000
) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
  });

  return Promise.race([
    retryMiddleware.executeWithRetry(operation, 'withTimeout'),
    timeoutPromise
  ]);
}
```

### Retry with Progress Callback

```typescript
async function retryWithProgress<T>(
  operation: () => Promise<T>,
  onRetry?: (attempt: number, error: any) => void
) {
  let attempts = 0;

  const wrappedOperation = async () => {
    try {
      return await operation();
    } catch (error) {
      attempts++;
      if (onRetry) {
        onRetry(attempts, error);
      }
      throw error;
    }
  };

  return retryMiddleware.executeWithRetry(wrappedOperation, 'withProgress');
}
```

## Testing

### Unit Testing with RetryMiddleware

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('My Service', () => {
  it('should retry on transient errors', async () => {
    let attempts = 0;
    const operation = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('ECONNRESET');
      }
      return { success: true };
    });

    const result = await retryMiddleware.executeWithRetry(operation, 'test');

    expect(result.attemptCount).toBe(3);
    expect(result.errors).toHaveLength(2);
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
```

## Performance Considerations

### Memory Usage
- Error history array grows with retries (max: `maxRetries + 1` items)
- Each error classification is ~200 bytes
- Total memory per retry cycle: < 10KB typical

### Timing Accuracy
- Delays use `setTimeout` (typically ±10ms accuracy)
- Jitter is calculated using `Math.random()`
- Total timing variance: ±(jitter + setTimeout variance)

### Overhead
- Per-attempt overhead: < 1ms (error classification + metadata)
- No significant performance impact on fast operations

## Best Practices

### 1. Choose Appropriate maxRetries
- **API calls**: 3-5 retries
- **Database queries**: 2-3 retries
- **File operations**: 1-2 retries
- **Critical operations**: 5+ retries

### 2. Set Realistic Delays
- **Fast operations**: 100ms base, 1s max
- **Standard operations**: 1s base, 30s max
- **Heavy operations**: 5s base, 60s max

### 3. Use Meaningful Context
```typescript
// Good
await retry.executeWithRetry(op, 'fetchUser:123');
await retry.executeWithRetry(op, 'db:query:users');

// Bad
await retry.executeWithRetry(op, 'operation');
await retry.executeWithRetry(op, 'op');
```

### 4. Handle Non-Retryable Errors
```typescript
try {
  return await retryMiddleware.executeWithRetry(operation, 'ctx');
} catch (error: any) {
  if (error.retryMetadata?.lastErrorType === 'permission') {
    // Handle permission error specifically
    throw new PermissionDeniedError(error.message);
  }
  throw error;
}
```

### 5. Log Retry Attempts
```typescript
const result = await retryMiddleware.executeWithRetry(operation, 'ctx');

if (result.attemptCount > 1) {
  logger.warn(`Operation succeeded after ${result.attemptCount} attempts`, {
    totalDelay: result.totalDelayMs,
    errors: result.errors.map(e => e.errorType)
  });
}
```

## Troubleshooting

### Issue: Too Many Retries
**Problem**: Operations taking too long due to excessive retries.
**Solution**: Reduce `maxRetries` or increase delays to fail faster.

### Issue: Not Retrying Expected Errors
**Problem**: Errors that should be retried are not being retried.
**Solution**: Check error classification with `ErrorClassificationMiddleware.classify()`.

### Issue: Delays Too Long
**Problem**: Users waiting too long between retries.
**Solution**: Reduce `baseDelayMs` and `maxDelayMs`, or use smaller `backoffMultiplier`.

### Issue: Thundering Herd
**Problem**: Many clients retrying simultaneously overwhelm service.
**Solution**: Increase `jitterFactor` to spread out retry attempts.

## Migration Guide

### From Direct Retry Loops

**Before**:
```typescript
let attempts = 0;
const maxAttempts = 3;

while (attempts < maxAttempts) {
  try {
    return await operation();
  } catch (error) {
    attempts++;
    if (attempts >= maxAttempts) throw error;
    await sleep(1000 * Math.pow(2, attempts));
  }
}
```

**After**:
```typescript
const result = await retryMiddleware.executeWithRetry(
  async () => await operation(),
  'operationName'
);
return result.result;
```

### From Other Retry Libraries

Most retry libraries use similar patterns. The key differences:

1. **Error Classification**: RetryMiddleware uses `ErrorClassificationMiddleware`
2. **Metadata**: Returns comprehensive `RetryResult` object
3. **Type Safety**: Full TypeScript generics support
4. **Jitter**: Built-in jitter calculation

## API Reference

See the [TypeScript definitions](./RetryMiddleware.ts) for complete API documentation.

### Key Methods

- `executeWithRetry<T>(operation, context)`: Execute with retry
- `calculateDelay(attempt)`: Calculate delay for attempt number
- `getOptions()`: Get current configuration (readonly)

### Key Types

- `RetryOptions`: Configuration interface
- `RetryResult<T>`: Result with metadata
- `IRetryExecutor`: Retry executor interface

## Related Components

- **ErrorClassificationMiddleware**: Classifies errors as retryable/non-retryable
- **CortexOrchestrator**: Uses RetryMiddleware for tool execution

---

For more information, see:
- [RetryMiddleware.ts](./RetryMiddleware.ts) - Implementation
- [RetryMiddleware.test.ts](./__tests__/RetryMiddleware.test.ts) - Unit tests
- [error-retry-integration.test.ts](./__tests__/integration/error-retry-integration.test.ts) - Integration tests
- [AGENT5_COMPLETION_REPORT.md](./AGENT5_COMPLETION_REPORT.md) - Completion report
