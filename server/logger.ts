import pino from 'pino';

// Configure pino logger with structured logging
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    }
  } : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  // Accept both { err } (pino standard) and { error } (common mistake) keys
  // so Error objects always serialize with stack traces instead of appearing as {}
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Helper function to create child logger with context
export function createContextLogger(context: Record<string, any>) {
  return logger.child(context);
}

// Log types for common scenarios
export function logApiRequest(method: string, path: string, statusCode: number, duration: number, extra?: Record<string, any>) {
  logger.info({
    type: 'api_request',
    method,
    path,
    statusCode,
    duration,
    ...extra
  }, `${method} ${path} ${statusCode} in ${duration}ms`);
}

export function logDatabaseQuery(operation: string, table: string, duration: number, error?: Error) {
  if (error) {
    logger.error({
      type: 'database_error',
      operation,
      table,
      duration,
      error: error.message,
      stack: error.stack
    }, `Database ${operation} failed on ${table}`);
  } else {
    logger.debug({
      type: 'database_query',
      operation,
      table,
      duration
    }, `Database ${operation} on ${table} completed in ${duration}ms`);
  }
}

export function logExternalApiCall(service: string, action: string, duration: number, success: boolean, error?: Error) {
  if (success) {
    logger.info({
      type: 'external_api',
      service,
      action,
      duration,
      success
    }, `${service} API ${action} completed in ${duration}ms`);
  } else {
    logger.error({
      type: 'external_api_error',
      service,
      action,
      duration,
      success,
      error: error?.message,
      stack: error?.stack
    }, `${service} API ${action} failed: ${error?.message}`);
  }
}
