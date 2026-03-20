const SENSITIVE_KEY_PATTERN = /(authorization|token|secret|password|cookie|x-auth-token|access[_-]?token)/i;
const MAX_DEPTH = 6;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[Truncated]';
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          return [key, '[Redacted]'];
        }
        return [key, redactValue(nestedValue, depth + 1)];
      }),
    );
  }

  if (typeof value === 'string' && value.length > 4000) {
    return `${value.slice(0, 4000)}...[truncated]`;
  }

  return value;
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return redactValue({
      name: error.name,
      message: error.message,
      stack: error.stack,
    }) as Record<string, unknown>;
  }

  if (isPlainObject(error)) {
    return redactValue(error) as Record<string, unknown>;
  }

  return {
    message: String(error),
  };
}

export function ensureRecord(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) {
    return redactValue(value) as Record<string, unknown>;
  }

  return {};
}
