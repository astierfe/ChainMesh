/**
 * Pipeline helpers for Phase 2 integration tests.
 * Provides factories, mocks, and utilities to wire up Module 2 orchestration
 * components with controlled test data (no external APIs, no PostgreSQL).
 */
import { ethers } from 'ethers';

// Module 2 imports (cross-module via relative paths)
import {
  WorkflowOrchestrator,
  DefaultAnalyzerFactory,
  type OrchestratorDependencies,
  type AnalyzerFactory,
  type OracleContract,
  type OrchestratorResult,
} from '../../../../../module2-orchestration/src/orchestrator/WorkflowOrchestrator';
import {
  RateLimiter,
  InMemoryRateLimiterStorage,
} from '../../../../../module2-orchestration/src/orchestrator/RateLimiter';
import { RulesAnalyzer } from '../../../../../module2-orchestration/src/analyzers/RulesAnalyzer';
import { HybridAnalyzer } from '../../../../../module2-orchestration/src/analyzers/HybridAnalyzer';
import type { AnalyzerInput } from '../../../../../module2-orchestration/src/analyzers/ClaudeAnalyzer';
import { SignerFactory } from '../../../../../module2-orchestration/src/signers/SignerFactory';
import {
  InMemoryCircuitBreakerStorage,
} from '../../../../../module2-orchestration/src/utils/CircuitBreaker';
import { createLogger, type Logger } from '../../../../../module2-orchestration/src/utils/Logger';
import type {
  DataProviderOutput,
  AnalyzerOutput,
} from '../../../../../module2-orchestration/src/validators/outputValidator';

// Module 6 SDK imports
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';
import { ANVIL_PRIVATE_KEY } from './anvil-setup.js';

// Re-export for test files
export {
  WorkflowOrchestrator,
  type OrchestratorResult,
  type OracleContract,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_WALLET = '0x1234567890123456789012345678901234567890';
const reputationAdapter = new ReputationAdapter();

// ---------------------------------------------------------------------------
// Mock Data Provider
// ---------------------------------------------------------------------------

export function createDefaultMockProviderOutput(): DataProviderOutput {
  return {
    data: {
      walletAge: 3 * 365 * 24 * 3600, // 3 years → wallet_age_bonus +10
      txCount: 500,                     // → tx_count_bonus +10
      defiProtocols: ['aave', 'compound', 'uniswap', 'curve'], // 4 → defi_usage_bonus +15
      liquidations: 0,                  // no penalty
      chainCount: 3,                    // → multi_chain_bonus +10
    },
    metadata: {
      chains: ['sepolia'],
      timestamp: new Date().toISOString(),
      provider: 'MockProvider',
      queryDuration: 50,
      successRate: 1.0,
    },
  };
}

export class MockProviderFactory {
  private mockData: DataProviderOutput;
  private shouldFail: boolean;
  private failMessage: string;

  constructor(
    mockData?: DataProviderOutput,
    shouldFail = false,
    failMessage = 'Mock provider failure',
  ) {
    this.mockData = mockData ?? createDefaultMockProviderOutput();
    this.shouldFail = shouldFail;
    this.failMessage = failMessage;
  }

  async queryWithFallback(params: {
    key: string;
    chains: string[];
    schemaHash: string;
  }): Promise<DataProviderOutput> {
    if (this.shouldFail) {
      throw new Error(this.failMessage);
    }
    return {
      ...this.mockData,
      metadata: {
        ...this.mockData.metadata,
        chains: params.chains,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Mock Claude Analyzer
// ---------------------------------------------------------------------------

export class MockClaudeAnalyzer {
  private mockOutput: AnalyzerOutput;
  private shouldFail: boolean;

  constructor(mockOutput?: Partial<AnalyzerOutput>, shouldFail = false) {
    this.shouldFail = shouldFail;
    this.mockOutput = {
      result: { score: 72, tier: 'standard', patterns: {} },
      confidence: 0.85,
      reasoning: 'Mock Claude analysis for testing',
      metadata: { model: 'mock-claude', processingTime: 100, tokensUsed: 500 },
      ...mockOutput,
    };
  }

  async analyze(_input: AnalyzerInput): Promise<AnalyzerOutput> {
    if (this.shouldFail) {
      throw new Error('Mock Claude API failure');
    }
    return this.mockOutput;
  }

  get name(): string {
    return 'MockClaude';
  }
}

// ---------------------------------------------------------------------------
// Logger (silent)
// ---------------------------------------------------------------------------

export function createTestLogger(): Logger {
  return createLogger('IntegrationTest', undefined, { silent: true });
}

// ---------------------------------------------------------------------------
// RateLimiter (in-memory)
// ---------------------------------------------------------------------------

export function createTestRateLimiter(
  logger: Logger,
  windowMs = 100,
): RateLimiter {
  const storage = new InMemoryRateLimiterStorage();
  return new RateLimiter({ windowMs }, storage, logger);
}

// ---------------------------------------------------------------------------
// SignerFactory (Lit pre-opened → DevWallet fallback)
// ---------------------------------------------------------------------------

export async function createTestSignerFactory(
  logger: Logger,
): Promise<SignerFactory> {
  const cbStorage = new InMemoryCircuitBreakerStorage();
  // Pre-open Lit's circuit breaker so it fast-fails immediately to DevWallet
  await cbStorage.setState('lit_protocol', 'OPEN', 5, new Date(), null);

  return new SignerFactory(
    {
      lit: {
        pkpPublicKey: 'mock-pkp-key',
        litActionEndpoint: 'http://127.0.0.1:0/mock-lit',
        timeoutMs: 1000,
      },
      devWallet: {
        privateKey: ANVIL_PRIVATE_KEY,
      },
      environment: 'test',
      circuitBreaker: {
        threshold: 1,
        cooldownMs: 999_999,
      },
    },
    logger,
    cbStorage,
  );
}

// ---------------------------------------------------------------------------
// Oracle Contract Adapter (ethers.Contract → OracleContract interface)
// ---------------------------------------------------------------------------

export function createOracleContractAdapter(
  oracleContract: ethers.Contract,
): OracleContract {
  return {
    async updateData(key: string, value: string, schemaHash: string) {
      const tx = await oracleContract.updateData(key, value, schemaHash);
      return {
        hash: tx.hash,
        wait: async () => {
          const receipt = await tx.wait();
          return { status: receipt.status, gasUsed: receipt.gasUsed };
        },
      };
    },
    async sendResponse(messageId: string, key: string) {
      const tx = await oracleContract.sendResponse(messageId, key);
      return {
        hash: tx.hash,
        wait: async () => {
          const receipt = await tx.wait();
          return { status: receipt.status };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test Query Input builder
// ---------------------------------------------------------------------------

export function createTestQueryInput(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    key: reputationAdapter.getKey(TEST_WALLET),
    schemaHash: ReputationAdapter.SCHEMA_HASH,
    chains: ['sepolia'],
    includeAnalysis: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Full Orchestrator Factory
// ---------------------------------------------------------------------------

export interface TestOrchestratorOptions {
  oracleContract?: OracleContract;
  mockProviderData?: DataProviderOutput;
  providerShouldFail?: boolean;
  rateLimitWindowMs?: number;
  useHybridAnalyzer?: boolean;
  mockClaudeOutput?: Partial<AnalyzerOutput>;
  mockClaudeShouldFail?: boolean;
}

export async function createTestOrchestrator(
  opts: TestOrchestratorOptions = {},
): Promise<WorkflowOrchestrator> {
  const logger = createTestLogger();

  const providerFactory = new MockProviderFactory(
    opts.mockProviderData,
    opts.providerShouldFail,
  );

  let analyzerFactory: AnalyzerFactory;
  if (opts.useHybridAnalyzer) {
    const mockClaude = new MockClaudeAnalyzer(
      opts.mockClaudeOutput,
      opts.mockClaudeShouldFail,
    );
    const rulesAnalyzer = new RulesAnalyzer(logger);
    const hybridAnalyzer = new HybridAnalyzer(
      mockClaude as any,
      rulesAnalyzer,
      logger,
    );
    analyzerFactory = new DefaultAnalyzerFactory(hybridAnalyzer, rulesAnalyzer);
  } else {
    analyzerFactory = new DefaultAnalyzerFactory(
      undefined,
      new RulesAnalyzer(logger),
    );
  }

  const signerFactory = await createTestSignerFactory(logger);
  const rateLimiter = createTestRateLimiter(
    logger,
    opts.rateLimitWindowMs ?? 100,
  );

  return new WorkflowOrchestrator({
    providerFactory: providerFactory as any,
    analyzerFactory,
    signerFactory,
    rateLimiter,
    oracleContract: opts.oracleContract,
    logger,
  });
}
