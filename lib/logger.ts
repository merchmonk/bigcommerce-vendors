/**
 * Lightweight logger for API routes. Output goes to Lambda log group in CloudWatch.
 * Use for request/error and key business events (e.g. vendor created/updated/deleted).
 */
const log = (
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>
) => {
  const payload = {
    level,
    message,
    ...(meta && Object.keys(meta).length > 0 && { meta }),
    timestamp: new Date().toISOString(),
  };
  const out = JSON.stringify(payload);
  if (level === 'error') {
    console.error(out);
  } else if (level === 'warn') {
    console.warn(out);
  } else {
    console.log(out);
  }
};

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) =>
    log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    log('error', message, meta),
};

export default logger;
