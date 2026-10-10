interface ErrorData {
  message?: unknown;
  // Datasource resource handlers (e.g. CloudWatch /resources/log-groups) answer with capitalized keys.
  Message?: unknown;
  Error?: unknown;
  error?: unknown;
  results?: Record<string, { error?: string }>;
}

/**
 * Turns whatever getBackendSrv() rejected with into readable text: per-query errors from /api/ds/query,
 * then the response body's message, then the Error itself.
 */
export function errorMessage(e: unknown): string {
  if (!e || typeof e !== 'object') {
    return String(e);
  }
  const data = (e as { data?: ErrorData }).data;
  if (data && typeof data === 'object') {
    const resultError = data.results && Object.values(data.results).find((r) => r?.error)?.error;
    const text = [resultError, data.message, data.Message, data.Error, data.error].find(
      (v): v is string => typeof v === 'string' && v !== ''
    );
    if (text) {
      return text;
    }
  }
  if (e instanceof Error) {
    return e.message;
  }
  const { message, statusText } = e as { message?: unknown; statusText?: unknown };
  if (typeof message === 'string' && message) {
    return message;
  }
  if (typeof statusText === 'string' && statusText) {
    return statusText;
  }
  try {
    return JSON.stringify(data ?? e);
  } catch {
    return 'Unknown error';
  }
}
