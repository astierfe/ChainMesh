import { describe, it, expect, vi, beforeEach } from 'vitest';
import winston from 'winston';
import { Logger, createLogger } from '../../src/utils/Logger';
import type { LogContext } from '../../src/utils/Logger';

/**
 * Custom transport that captures log entries for assertions.
 */
class MemoryTransport extends winston.transports.Stream {
  public logs: Array<Record<string, unknown>> = [];

  constructor() {
    const stream = new (require('stream').Writable)({
      write: (_chunk: Buffer, _encoding: string, callback: () => void) => {
        callback();
      },
    });
    super({ stream });
  }

  override log(info: Record<string, unknown>, callback: () => void): void {
    this.logs.push(info);
    if (callback) callback();
  }
}

function createTestLogger(
  context: LogContext,
  level = 'debug',
): { logger: Logger; transport: MemoryTransport } {
  const transport = new MemoryTransport();
  const logger = new Logger(context, { level, transports: [transport] });
  return { logger, transport };
}

describe('Logger', () => {
  describe('log levels', () => {
    it('should log error messages', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_test1',
      });

      logger.error('Something failed');

      expect(transport.logs).toHaveLength(1);
      expect(transport.logs[0].level).toBe('error');
      expect(transport.logs[0].message).toBe('Something failed');
    });

    it('should log warn messages', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_test2',
      });

      logger.warn('Possible issue');

      expect(transport.logs).toHaveLength(1);
      expect(transport.logs[0].level).toBe('warn');
      expect(transport.logs[0].message).toBe('Possible issue');
    });

    it('should log info messages', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_test3',
      });

      logger.info('Operation completed');

      expect(transport.logs).toHaveLength(1);
      expect(transport.logs[0].level).toBe('info');
      expect(transport.logs[0].message).toBe('Operation completed');
    });

    it('should log debug messages when level is debug', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_test4',
      });

      logger.debug('Debug detail');

      expect(transport.logs).toHaveLength(1);
      expect(transport.logs[0].level).toBe('debug');
      expect(transport.logs[0].message).toBe('Debug detail');
    });

    it('should not log debug messages when level is info', () => {
      const { logger, transport } = createTestLogger(
        { executionId: 'exec_test5' },
        'info',
      );

      logger.debug('Should be filtered');

      expect(transport.logs).toHaveLength(0);
    });
  });

  describe('context injection', () => {
    it('should inject executionId in every log entry', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_abc123',
      });

      logger.info('Test message');

      expect(transport.logs[0].executionId).toBe('exec_abc123');
    });

    it('should inject module in every log entry', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_abc123',
        module: 'GenericOrchestrator',
      });

      logger.info('Test message');

      expect(transport.logs[0].module).toBe('GenericOrchestrator');
    });

    it('should merge additional context with default context', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_merge',
        module: 'DataProvider',
      });

      logger.info('Query completed', {
        event: 'QUERY_SUCCESS',
        duration: 850,
        provider: 'Goldsky',
      });

      const entry = transport.logs[0];
      expect(entry.executionId).toBe('exec_merge');
      expect(entry.module).toBe('DataProvider');
      expect(entry.event).toBe('QUERY_SUCCESS');
      expect(entry.duration).toBe(850);
      expect(entry.provider).toBe('Goldsky');
    });

    it('should allow overriding default context fields', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_override',
        module: 'Default',
      });

      logger.info('Override test', { module: 'Overridden' });

      expect(transport.logs[0].module).toBe('Overridden');
    });
  });

  describe('structured error logging', () => {
    it('should log error details following spec format', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_xyz789',
        module: 'DataProvider_MultiChain',
      });

      logger.error('Provider timeout', {
        event: 'PROVIDER_TIMEOUT',
        error: {
          type: 'TIMEOUT',
          message: 'Goldsky query timeout after 10s',
          chain: 'arbitrum',
          provider: 'Goldsky',
          retryable: true,
          retryCount: 1,
        },
      });

      const entry = transport.logs[0];
      expect(entry.level).toBe('error');
      expect(entry.executionId).toBe('exec_xyz789');
      expect(entry.module).toBe('DataProvider_MultiChain');
      expect(entry.event).toBe('PROVIDER_TIMEOUT');

      const error = entry.error as Record<string, unknown>;
      expect(error.type).toBe('TIMEOUT');
      expect(error.retryable).toBe(true);
    });
  });

  describe('child logger', () => {
    it('should create a child with merged context', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_parent',
        module: 'Orchestrator',
      });

      const child = logger.child({ module: 'DataProvider', chain: 'sepolia' });
      child.info('Child message');

      const entry = transport.logs[0];
      expect(entry.executionId).toBe('exec_parent');
      expect(entry.module).toBe('DataProvider');
      expect(entry.chain).toBe('sepolia');
    });

    it('should preserve parent executionId', () => {
      const { logger, transport } = createTestLogger({
        executionId: 'exec_parent',
      });

      const child = logger.child({ step: 'analysis' });
      child.info('Child log');

      expect(transport.logs[0].executionId).toBe('exec_parent');
    });
  });

  describe('getContext', () => {
    it('should return a copy of the default context', () => {
      const context: LogContext = {
        executionId: 'exec_ctx',
        module: 'Test',
      };
      const logger = new Logger(context);

      const retrieved = logger.getContext();
      expect(retrieved).toEqual(context);

      // Ensure it's a copy, not a reference
      retrieved.module = 'Modified';
      expect(logger.getContext().module).toBe('Test');
    });
  });

  describe('createLogger factory', () => {
    it('should create a logger with a given executionId', () => {
      const logger = createLogger('TestModule', 'exec_custom');

      const ctx = logger.getContext();
      expect(ctx.executionId).toBe('exec_custom');
      expect(ctx.module).toBe('TestModule');
    });

    it('should auto-generate an executionId if not provided', () => {
      const logger = createLogger('TestModule');

      const ctx = logger.getContext();
      expect(ctx.executionId).toMatch(/^exec_\d+_[a-z0-9]+$/);
      expect(ctx.module).toBe('TestModule');
    });

    it('should accept LoggerOptions', () => {
      const transport = new MemoryTransport();
      const logger = createLogger('TestModule', 'exec_opts', {
        level: 'debug',
        transports: [transport],
      });

      logger.debug('Debug via factory');
      expect(transport.logs).toHaveLength(1);
    });
  });

  describe('silent mode', () => {
    it('should not output logs when silent is true', () => {
      const transport = new MemoryTransport();
      const logger = new Logger(
        { executionId: 'exec_silent' },
        { silent: true, transports: [transport] },
      );

      logger.info('Should be silent');
      logger.error('Also silent');

      expect(transport.logs).toHaveLength(0);
    });
  });
});
