import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkflowOrchestrator,
  DefaultAnalyzerFactory,
} from '../../src/orchestrator/WorkflowOrchestrator';
import type {
  OrchestratorDependencies,
  OracleContract,
  AnalyzerFactory,
} from '../../src/orchestrator/WorkflowOrchestrator';
import { RateLimiter, InMemoryRateLimiterStorage } from '../../src/orchestrator/RateLimiter';
import { Logger } from '../../src/utils/Logger';
import type { DataProviderOutput, AnalyzerOutput, SignerOutput } from '../../src/validators/outputValidator';

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    toUtf8Bytes: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
    hexlify: vi.fn().mockReturnValue('0x010203'),
  },
}));

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const validInput = {
  key: '0x' + 'aa'.repeat(32),
  schemaHash: '0x' + 'bb'.repeat(32),
  chains: ['sepolia'] as const,
  includeAnalysis: true,
};

const validInputNoAnalysis = {
  ...validInput,
  includeAnalysis: false,
};

const mockProviderOutput: DataProviderOutput = {
  data: { records: [{ value: '42' }] },
  metadata: {
    chains: ['sepolia'],
    timestamp: '2026-02-08T10:00:00.000Z',
    provider: 'Goldsky',
    queryDuration: 850,
  },
};

const mockAnalyzerOutput: AnalyzerOutput = {
  result: { score: 85, tier: 'prime' },
  confidence: 0.9,
  reasoning: 'Test reasoning',
  metadata: {
    method: 'hybrid',
    processingTime: 200,
  },
};

const validSignature = '0x' + 'ab'.repeat(65);
const mockSignerOutput: SignerOutput = {
  signature: validSignature,
  signingTime: 100,
  pkpPublicKey: '0x04' + 'ff'.repeat(64),
};

function createMockProviderFactory() {
  return {
    queryWithFallback: vi.fn().mockResolvedValue(mockProviderOutput),
    getPrimary: vi.fn(),
    getFallback: vi.fn(),
  };
}

function createMockAnalyzerFactory(): AnalyzerFactory {
  return {
    getAnalyzer: vi.fn().mockReturnValue({
      analyze: vi.fn().mockResolvedValue(mockAnalyzerOutput),
    }),
  };
}

function createMockSignerFactory() {
  return {
    signWithFallback: vi.fn().mockResolvedValue(mockSignerOutput),
    getPrimary: vi.fn(),
    getFallback: vi.fn(),
  };
}

function createMockOracleContract(): OracleContract {
  return {
    updateData: vi.fn().mockResolvedValue({
      hash: '0x' + 'dd'.repeat(32),
      wait: vi.fn().mockResolvedValue({ status: 1, gasUsed: BigInt(171234) }),
    }),
    sendResponse: vi.fn().mockResolvedValue({
      hash: '0x' + 'ee'.repeat(32),
      wait: vi.fn().mockResolvedValue({ status: 1 }),
    }),
  };
}

function createDeps(overrides: Partial<OrchestratorDependencies> = {}): OrchestratorDependencies {
  const storage = new InMemoryRateLimiterStorage();
  const logger = createSilentLogger();
  return {
    providerFactory: createMockProviderFactory() as any,
    analyzerFactory: createMockAnalyzerFactory(),
    signerFactory: createMockSignerFactory() as any,
    rateLimiter: new RateLimiter({ windowMs: 3600000 }, storage, logger),
    logger,
    ...overrides,
  };
}

describe('WorkflowOrchestrator', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createSilentLogger();
  });

  describe('happy path', () => {
    it('should execute the full pipeline successfully', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(true);
      expect(result.executionId).toMatch(/^exec_/);
      expect(result.data?.providerOutput).toBeDefined();
      expect(result.data?.analyzerOutput).toBeDefined();
      expect(result.data?.signerOutput).toBeDefined();
      expect(result.data?.encodedValue).toBe('0x010203');
      expect(result.context.steps.validation.status).toBe('success');
      expect(result.context.steps.rateLimit.status).toBe('success');
      expect(result.context.steps.dataProvider.status).toBe('success');
      expect(result.context.steps.analyzer.status).toBe('success');
      expect(result.context.steps.signer.status).toBe('success');
    });

    it('should skip analysis when includeAnalysis is false', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInputNoAnalysis);

      expect(result.success).toBe(true);
      expect(result.data?.analyzerOutput).toBeUndefined();
      expect(result.context.steps.analyzer.status).toBe('skipped');
    });

    it('should skip oracle update when no contract is provided', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(true);
      expect(result.data?.txHash).toBeUndefined();
      expect(result.context.steps.oracleUpdate.status).toBe('skipped');
    });

    it('should update oracle when contract is provided', async () => {
      const oracleContract = createMockOracleContract();
      const deps = createDeps({ oracleContract });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(true);
      expect(result.data?.txHash).toBe('0x' + 'dd'.repeat(32));
      expect(result.context.steps.oracleUpdate.status).toBe('success');
      expect(oracleContract.updateData).toHaveBeenCalled();
    });

    it('should send CCIP response when messageId is present', async () => {
      const oracleContract = createMockOracleContract();
      const deps = createDeps({ oracleContract });
      const orchestrator = new WorkflowOrchestrator(deps);

      const inputWithCCIP = {
        ...validInput,
        metadata: {
          messageId: '0x' + 'ff'.repeat(32),
          sourceChain: 'arbitrum',
          requester: '0x' + 'cc'.repeat(20),
        },
      };

      const result = await orchestrator.execute(inputWithCCIP);

      expect(result.success).toBe(true);
      expect(oracleContract.sendResponse).toHaveBeenCalledWith(
        '0x' + 'ff'.repeat(32),
        validInput.key,
      );
      expect(result.context.steps.ccipResponse.status).toBe('success');
    });

    it('should set sourceModule in context', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput, 'CCIP_EventListener');

      expect(result.context.sourceModule).toBe('CCIP_EventListener');
    });
  });

  describe('validation errors', () => {
    it('should fail on invalid input', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute({ key: 'bad' });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('VALIDATION_ERROR');
      expect(result.context.steps.validation.status).toBe('error');
    });

    it('should fail on missing key', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute({
        schemaHash: '0x' + 'bb'.repeat(32),
        chains: ['sepolia'],
      });

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('VALIDATION_ERROR');
    });
  });

  describe('rate limiting', () => {
    it('should reject duplicate requests within window', async () => {
      const storage = new InMemoryRateLimiterStorage();
      const rateLimiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const deps = createDeps({ rateLimiter });
      const orchestrator = new WorkflowOrchestrator(deps);

      // First request should succeed
      const result1 = await orchestrator.execute(validInput);
      expect(result1.success).toBe(true);

      // Second request should fail with rate limit
      const result2 = await orchestrator.execute(validInput);
      expect(result2.success).toBe(false);
      expect(result2.error?.type).toBe('RATE_LIMIT_EXCEEDED');
      expect(result2.context.steps.rateLimit.status).toBe('error');
    });

    it('should allow requests for different keys', async () => {
      const storage = new InMemoryRateLimiterStorage();
      const rateLimiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const deps = createDeps({ rateLimiter });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result1 = await orchestrator.execute(validInput);
      expect(result1.success).toBe(true);

      const input2 = { ...validInput, key: '0x' + 'cc'.repeat(32) };
      const result2 = await orchestrator.execute(input2);
      expect(result2.success).toBe(true);
    });
  });

  describe('provider errors', () => {
    it('should fail when provider throws', async () => {
      const providerFactory = createMockProviderFactory();
      providerFactory.queryWithFallback.mockRejectedValue(new Error('All providers down'));

      const deps = createDeps({ providerFactory: providerFactory as any });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(false);
      expect(result.context.steps.dataProvider.status).toBe('error');
    });

    it('should fail when success rate is below 50%', async () => {
      const providerFactory = createMockProviderFactory();
      providerFactory.queryWithFallback.mockResolvedValue({
        data: { results: [] },
        metadata: {
          chains: ['sepolia', 'arbitrum', 'base'],
          timestamp: '2026-02-08T10:00:00.000Z',
          provider: 'Alchemy',
          queryDuration: 500,
          partialData: true,
          successRate: 0.33,
        },
      });

      const deps = createDeps({ providerFactory: providerFactory as any });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(false);
      expect(result.context.steps.dataProvider.status).toBe('error');
    });
  });

  describe('analyzer errors', () => {
    it('should fail when analyzer throws', async () => {
      const analyzerFactory: AnalyzerFactory = {
        getAnalyzer: vi.fn().mockReturnValue({
          analyze: vi.fn().mockRejectedValue(new Error('Claude API down')),
        }),
      };

      const deps = createDeps({ analyzerFactory });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(false);
      expect(result.context.steps.analyzer.status).toBe('error');
    });
  });

  describe('signer errors', () => {
    it('should fail when signer throws', async () => {
      const signerFactory = createMockSignerFactory();
      signerFactory.signWithFallback.mockRejectedValue(new Error('Lit Protocol unavailable'));

      const deps = createDeps({ signerFactory: signerFactory as any });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(false);
      expect(result.context.steps.signer.status).toBe('error');
    });
  });

  describe('oracle errors', () => {
    it('should fail when oracle update reverts', async () => {
      const oracleContract: OracleContract = {
        updateData: vi.fn().mockResolvedValue({
          hash: '0x' + 'dd'.repeat(32),
          wait: vi.fn().mockResolvedValue({ status: 0, gasUsed: BigInt(0) }),
        }),
        sendResponse: vi.fn(),
      };

      const deps = createDeps({ oracleContract });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('CONTRACT_REVERT');
      expect(result.context.steps.oracleUpdate.status).toBe('error');
    });

    it('should fail when CCIP sendResponse reverts', async () => {
      const oracleContract: OracleContract = {
        updateData: vi.fn().mockResolvedValue({
          hash: '0x' + 'dd'.repeat(32),
          wait: vi.fn().mockResolvedValue({ status: 1, gasUsed: BigInt(100000) }),
        }),
        sendResponse: vi.fn().mockResolvedValue({
          hash: '0x' + 'ee'.repeat(32),
          wait: vi.fn().mockResolvedValue({ status: 0 }),
        }),
      };

      const deps = createDeps({ oracleContract });
      const orchestrator = new WorkflowOrchestrator(deps);

      const inputWithCCIP = {
        ...validInput,
        metadata: {
          messageId: '0x' + 'ff'.repeat(32),
          sourceChain: 'arbitrum',
          requester: '0x' + 'cc'.repeat(20),
        },
      };

      const result = await orchestrator.execute(inputWithCCIP);

      expect(result.success).toBe(false);
      expect(result.context.steps.ccipResponse.status).toBe('error');
    });
  });

  describe('error classification', () => {
    it('should classify rate limit errors', async () => {
      const storage = new InMemoryRateLimiterStorage();
      const rateLimiter = new RateLimiter({ windowMs: 60000 }, storage, logger);
      const deps = createDeps({ rateLimiter });
      const orchestrator = new WorkflowOrchestrator(deps);

      await orchestrator.execute(validInput);
      const result = await orchestrator.execute(validInput);

      expect(result.error?.type).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should classify timeout errors', async () => {
      const providerFactory = createMockProviderFactory();
      providerFactory.queryWithFallback.mockRejectedValue(new Error('Request timeout'));

      const deps = createDeps({ providerFactory: providerFactory as any });
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.error?.type).toBe('TIMEOUT');
    });
  });

  describe('DefaultAnalyzerFactory', () => {
    it('should return hybrid analyzer when provided', () => {
      const mockHybrid = { analyze: vi.fn() } as any;
      const factory = new DefaultAnalyzerFactory(mockHybrid);

      const analyzer = factory.getAnalyzer('0x123', logger);
      expect(analyzer).toBe(mockHybrid);
    });

    it('should return rules analyzer when no hybrid provided', () => {
      const mockRules = { analyze: vi.fn() } as any;
      const factory = new DefaultAnalyzerFactory(undefined, mockRules);

      const analyzer = factory.getAnalyzer('0x123', logger);
      expect(analyzer).toBe(mockRules);
    });

    it('should create default RulesAnalyzer when nothing provided', () => {
      const factory = new DefaultAnalyzerFactory();

      const analyzer = factory.getAnalyzer('0x123', logger);
      expect(analyzer).toBeDefined();
    });
  });

  describe('execution context', () => {
    it('should generate unique executionIds', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      // Use different keys to avoid rate limiting
      const input1 = { ...validInput, key: '0x' + 'a1'.repeat(32) };
      const input2 = { ...validInput, key: '0x' + 'a2'.repeat(32) };

      const result1 = await orchestrator.execute(input1);
      const result2 = await orchestrator.execute(input2);

      expect(result1.executionId).not.toBe(result2.executionId);
    });

    it('should include startTime in context', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.context.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include input in context', async () => {
      const deps = createDeps();
      const orchestrator = new WorkflowOrchestrator(deps);

      const result = await orchestrator.execute(validInput);

      expect(result.context.input.key).toBe(validInput.key);
      expect(result.context.input.schemaHash).toBe(validInput.schemaHash);
    });
  });
});
