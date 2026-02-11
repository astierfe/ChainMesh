/**
 * WorkflowOrchestrator.ts - Generic orchestrator coordinating the full pipeline
 *
 * Steps: Validate → RateLimit → DataProvider → Analyzer (optional) → Signer → Oracle update
 * Agnostic of schemaHash — routes to appropriate sub-workflows.
 */

import { ethers } from 'ethers';
import { Logger, createLogger } from '../utils/Logger';
import { validateQueryRequest } from '../validators/inputValidator';
import type { GenericQueryRequest } from '../validators/inputValidator';
import { validateProviderOutput, validateAnalyzerOutput, validateSignerOutput } from '../validators/outputValidator';
import type { DataProviderOutput, AnalyzerOutput, SignerOutput } from '../validators/outputValidator';
import { ProviderFactory } from '../providers/ProviderFactory';
import { HybridAnalyzer } from '../analyzers/HybridAnalyzer';
import { RulesAnalyzer } from '../analyzers/RulesAnalyzer';
import type { SignerFactory, SignPayload } from '../signers/SignerFactory';
import { RateLimiter, RateLimitExceededError } from './RateLimiter';

export type StepStatus = 'success' | 'skipped' | 'error';

export interface StepResult {
  status: StepStatus;
  duration: number;
  error?: string;
  [key: string]: unknown;
}

export interface ExecutionContext {
  executionId: string;
  startTime: string;
  input: GenericQueryRequest;
  sourceModule: string;
  messageId?: string;
  steps: Record<string, StepResult>;
}

export interface OrchestratorResult {
  success: boolean;
  executionId: string;
  data?: {
    providerOutput?: DataProviderOutput;
    analyzerOutput?: AnalyzerOutput;
    signerOutput?: SignerOutput;
    encodedValue?: string;
    txHash?: string;
  };
  error?: {
    type: string;
    message: string;
    step?: string;
  };
  context: ExecutionContext;
}

export interface OrchestratorDependencies {
  providerFactory: ProviderFactory;
  analyzerFactory: AnalyzerFactory;
  signerFactory: SignerFactory;
  rateLimiter: RateLimiter;
  oracleContract?: OracleContract;
  logger?: Logger;
}

export interface AnalyzerFactory {
  getAnalyzer(schemaHash: string, logger: Logger): { analyze: (input: { data: DataProviderOutput; schemaHash: string; options?: { includeReasoning?: boolean; confidenceThreshold?: number } }) => Promise<AnalyzerOutput> };
}

export interface OracleContract {
  updateData(key: string, value: string, schemaHash: string): Promise<{ hash: string; wait: () => Promise<{ status: number; gasUsed: bigint }> }>;
  sendResponse(messageId: string, key: string): Promise<{ hash: string; wait: () => Promise<{ status: number }> }>;
}

/** Default analyzer factory that uses HybridAnalyzer or RulesAnalyzer */
export class DefaultAnalyzerFactory implements AnalyzerFactory {
  private hybridAnalyzer?: HybridAnalyzer;
  private rulesAnalyzer?: RulesAnalyzer;

  constructor(hybridAnalyzer?: HybridAnalyzer, rulesAnalyzer?: RulesAnalyzer) {
    this.hybridAnalyzer = hybridAnalyzer;
    this.rulesAnalyzer = rulesAnalyzer;
  }

  getAnalyzer(schemaHash: string, logger: Logger) {
    if (this.hybridAnalyzer) return this.hybridAnalyzer;
    if (this.rulesAnalyzer) return this.rulesAnalyzer;
    return new RulesAnalyzer(logger);
  }
}

export class WorkflowOrchestrator {
  private providerFactory: ProviderFactory;
  private analyzerFactory: AnalyzerFactory;
  private signerFactory: SignerFactory;
  private rateLimiter: RateLimiter;
  private oracleContract: OracleContract | null;
  private logger: Logger;

  constructor(deps: OrchestratorDependencies) {
    this.providerFactory = deps.providerFactory;
    this.analyzerFactory = deps.analyzerFactory;
    this.signerFactory = deps.signerFactory;
    this.rateLimiter = deps.rateLimiter;
    this.oracleContract = deps.oracleContract ?? null;
    this.logger = deps.logger ?? createLogger('WorkflowOrchestrator');
  }

  /** Execute the full orchestration pipeline */
  async execute(rawInput: unknown, sourceModule = 'API_Gateway'): Promise<OrchestratorResult> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const logger = this.logger.child({ executionId, module: 'WorkflowOrchestrator' });

    const context: ExecutionContext = {
      executionId,
      startTime: new Date().toISOString(),
      input: {} as GenericQueryRequest,
      sourceModule,
      steps: {},
    };

    logger.info('Workflow execution started', {
      event: 'WORKFLOW_START',
      sourceModule,
    });

    try {
      // Step 1: Validate input
      const input = this.validateInput(rawInput, context, logger);
      context.input = input;
      context.messageId = input.metadata?.messageId;

      // Step 2: Rate limit check
      await this.checkRateLimit(input.key, context, logger);

      // Step 3: Fetch data
      const providerOutput = await this.fetchData(input, context, logger);

      // Step 4: Analyze (optional)
      let analyzerOutput: AnalyzerOutput | undefined;
      if (input.includeAnalysis) {
        analyzerOutput = await this.analyzeData(providerOutput, input, context, logger);
      } else {
        context.steps.analyzer = { status: 'skipped', duration: 0 };
      }

      // Step 5: Encode payload
      const encodedValue = this.encodePayload(
        analyzerOutput ?? providerOutput,
        input.schemaHash,
      );

      // Step 6: Sign
      const signerOutput = await this.signPayload(input, encodedValue, context, logger);

      // Step 7: Update oracle (if contract available)
      let txHash: string | undefined;
      if (this.oracleContract) {
        txHash = await this.updateOracle(input, encodedValue, context, logger);

        // Step 8: Send CCIP response (if messageId present)
        if (context.messageId) {
          await this.sendCCIPResponse(context.messageId, input.key, context, logger);
        }
      } else {
        context.steps.oracleUpdate = { status: 'skipped', duration: 0 };
      }

      const result: OrchestratorResult = {
        success: true,
        executionId,
        data: { providerOutput, analyzerOutput, signerOutput, encodedValue, txHash },
        context,
      };

      logger.info('Workflow execution completed successfully', {
        event: 'WORKFLOW_SUCCESS',
        totalDuration: Date.now() - new Date(context.startTime).getTime(),
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const type = this.classifyError(error);

      logger.error('Workflow execution failed', {
        event: 'WORKFLOW_ERROR',
        errorType: type,
        error: message,
        totalDuration: Date.now() - new Date(context.startTime).getTime(),
      });

      return {
        success: false,
        executionId,
        error: { type, message },
        context,
      };
    }
  }

  private validateInput(
    rawInput: unknown,
    context: ExecutionContext,
    logger: Logger,
  ): GenericQueryRequest {
    const startTime = Date.now();
    try {
      const input = validateQueryRequest(rawInput);
      context.steps.validation = { status: 'success', duration: Date.now() - startTime };
      logger.debug('Input validation passed', { event: 'VALIDATION_SUCCESS' });
      return input;
    } catch (error) {
      context.steps.validation = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async checkRateLimit(
    key: string,
    context: ExecutionContext,
    logger: Logger,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      await this.rateLimiter.consume(key);
      context.steps.rateLimit = { status: 'success', duration: Date.now() - startTime };
      logger.debug('Rate limit check passed', { event: 'RATE_LIMIT_OK', key });
    } catch (error) {
      context.steps.rateLimit = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async fetchData(
    input: GenericQueryRequest,
    context: ExecutionContext,
    logger: Logger,
  ): Promise<DataProviderOutput> {
    const startTime = Date.now();
    try {
      const output = await this.providerFactory.queryWithFallback({
        key: input.key,
        chains: [...input.chains],
        schemaHash: input.schemaHash,
      });

      const validated = validateProviderOutput(output);

      // Check partial data threshold (>= 50% success required)
      const successRate = validated.metadata.successRate ?? 1;
      if (successRate < 0.5) {
        throw new Error(`Insufficient data: only ${Math.round(successRate * 100)}% of chains succeeded`);
      }

      context.steps.dataProvider = {
        status: 'success',
        duration: Date.now() - startTime,
        provider: validated.metadata.provider,
        successRate,
      };

      logger.info('Data fetched successfully', {
        event: 'DATA_FETCH_SUCCESS',
        provider: validated.metadata.provider,
        duration: Date.now() - startTime,
      });

      return validated;
    } catch (error) {
      context.steps.dataProvider = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async analyzeData(
    providerOutput: DataProviderOutput,
    input: GenericQueryRequest,
    context: ExecutionContext,
    logger: Logger,
  ): Promise<AnalyzerOutput> {
    const startTime = Date.now();
    try {
      const analyzer = this.analyzerFactory.getAnalyzer(input.schemaHash, logger);
      const output = await analyzer.analyze({
        data: providerOutput,
        schemaHash: input.schemaHash,
        options: { includeReasoning: true, confidenceThreshold: 0.5 },
      });

      const validated = validateAnalyzerOutput(output);

      context.steps.analyzer = {
        status: 'success',
        duration: Date.now() - startTime,
        confidence: validated.confidence,
      };

      logger.info('Analysis completed', {
        event: 'ANALYSIS_SUCCESS',
        confidence: validated.confidence,
        duration: Date.now() - startTime,
      });

      return validated;
    } catch (error) {
      context.steps.analyzer = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  /** Encode data for on-chain storage (generic ABI encoding) */
  private encodePayload(data: DataProviderOutput | AnalyzerOutput, schemaHash: string): string {
    const jsonBytes = ethers.toUtf8Bytes(JSON.stringify(data));
    return ethers.hexlify(jsonBytes);
  }

  private async signPayload(
    input: GenericQueryRequest,
    encodedValue: string,
    context: ExecutionContext,
    logger: Logger,
  ): Promise<SignerOutput> {
    const startTime = Date.now();
    try {
      const payload: SignPayload = {
        key: input.key,
        value: encodedValue,
        schemaHash: input.schemaHash,
        timestamp: Math.floor(Date.now() / 1000),
      };

      const output = await this.signerFactory.signWithFallback(payload);
      const validated = validateSignerOutput(output);

      context.steps.signer = {
        status: 'success',
        duration: Date.now() - startTime,
        signingTime: validated.signingTime,
      };

      logger.info('Payload signed', {
        event: 'SIGN_SUCCESS',
        signingTime: validated.signingTime,
      });

      return validated;
    } catch (error) {
      context.steps.signer = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async updateOracle(
    input: GenericQueryRequest,
    encodedValue: string,
    context: ExecutionContext,
    logger: Logger,
  ): Promise<string> {
    const startTime = Date.now();
    try {
      const tx = await this.oracleContract!.updateData(
        input.key,
        encodedValue,
        input.schemaHash,
      );
      const receipt = await tx.wait();

      if (receipt.status !== 1) {
        throw new Error('Oracle update transaction reverted');
      }

      context.steps.oracleUpdate = {
        status: 'success',
        duration: Date.now() - startTime,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
      };

      logger.info('Oracle updated', {
        event: 'ORACLE_UPDATE_SUCCESS',
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
      });

      return tx.hash;
    } catch (error) {
      context.steps.oracleUpdate = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private async sendCCIPResponse(
    messageId: string,
    key: string,
    context: ExecutionContext,
    logger: Logger,
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const tx = await this.oracleContract!.sendResponse(messageId, key);
      const receipt = await tx.wait();

      if (receipt.status !== 1) {
        throw new Error('CCIP sendResponse transaction reverted');
      }

      context.steps.ccipResponse = {
        status: 'success',
        duration: Date.now() - startTime,
        txHash: tx.hash,
      };

      logger.info('CCIP response sent', {
        event: 'CCIP_RESPONSE_SUCCESS',
        messageId,
        txHash: tx.hash,
      });
    } catch (error) {
      context.steps.ccipResponse = {
        status: 'error',
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  private classifyError(error: unknown): string {
    if (error instanceof RateLimitExceededError) return 'RATE_LIMIT_EXCEEDED';
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('validation') || msg.includes('required') || msg.includes('invalid')) return 'VALIDATION_ERROR';
      if (msg.includes('timeout')) return 'TIMEOUT';
      if (msg.includes('circuit breaker')) return 'CIRCUIT_BREAKER_OPEN';
      if (msg.includes('revert')) return 'CONTRACT_REVERT';
      if (msg.includes('insufficient')) return 'INSUFFICIENT_FUNDS';
    }
    return 'EXECUTION_ERROR';
  }
}
