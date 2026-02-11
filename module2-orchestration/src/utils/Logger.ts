/**
 * Logger.ts - Structured JSON logger with Winston
 *
 * Features:
 * - JSON format for structured logging
 * - Automatic executionId injection via context
 * - Log levels: error, warn, info, debug
 * - Module and event tracking for end-to-end tracing
 */

import winston from 'winston';

/** Context attached to every log entry */
export interface LogContext {
  executionId: string;
  module?: string;
  event?: string;
  [key: string]: unknown;
}

/** Options for creating a Logger instance */
export interface LoggerOptions {
  level?: string;
  silent?: boolean;
  transports?: winston.transport[];
}

export class Logger {
  private logger: winston.Logger;
  private defaultContext: LogContext;

  constructor(defaultContext: LogContext, options: LoggerOptions = {}) {
    this.defaultContext = defaultContext;

    const transports: winston.transport[] = options.transports ?? [
      new winston.transports.Console(),
    ];

    this.logger = winston.createLogger({
      level: options.level ?? 'info',
      silent: options.silent ?? false,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      transports,
    });
  }

  /** Log an error-level message */
  error(message: string, context?: Record<string, unknown>): void {
    this.logger.error(message, this.mergeContext(context));
  }

  /** Log a warn-level message */
  warn(message: string, context?: Record<string, unknown>): void {
    this.logger.warn(message, this.mergeContext(context));
  }

  /** Log an info-level message */
  info(message: string, context?: Record<string, unknown>): void {
    this.logger.info(message, this.mergeContext(context));
  }

  /** Log a debug-level message */
  debug(message: string, context?: Record<string, unknown>): void {
    this.logger.debug(message, this.mergeContext(context));
  }

  /** Create a child logger with additional default context */
  child(additionalContext: Record<string, unknown>): Logger {
    const mergedContext: LogContext = {
      ...this.defaultContext,
      ...additionalContext,
    };
    const child = new Logger(mergedContext);
    child.logger = this.logger;
    return child;
  }

  /** Get the current default context */
  getContext(): LogContext {
    return { ...this.defaultContext };
  }

  private mergeContext(
    context?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...this.defaultContext,
      ...context,
    };
  }
}

/** Create a Logger instance with a generated executionId */
export function createLogger(
  module: string,
  executionId?: string,
  options?: LoggerOptions,
): Logger {
  const id =
    executionId ?? `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Logger({ executionId: id, module }, options);
}
