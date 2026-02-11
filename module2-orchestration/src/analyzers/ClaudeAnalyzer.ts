/**
 * ClaudeAnalyzer.ts - AI-based analyzer using Claude API
 *
 * Sends aggregated data to Claude for analysis.
 * Returns structured result with confidence score and reasoning.
 */

import axios from 'axios';
import { Logger } from '../utils/Logger';
import { RetryPolicy } from '../utils/RetryPolicy';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import type { AnalyzerOutput } from '../validators/outputValidator';
import type { DataProviderOutput } from '../validators/outputValidator';

export interface ClaudeAnalyzerConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  confidenceThreshold: number;
}

export const DEFAULT_CLAUDE_CONFIG: ClaudeAnalyzerConfig = {
  apiKey: '',
  model: 'claude-sonnet-4-5-20250929',
  maxTokens: 4096,
  timeoutMs: 60000,
  confidenceThreshold: 0.5,
};

export interface AnalyzerInput {
  data: DataProviderOutput;
  schemaHash: string;
  options?: {
    includeReasoning?: boolean;
    confidenceThreshold?: number;
  };
}

export class ClaudeAnalyzer {
  private config: ClaudeAnalyzerConfig;
  private logger: Logger;
  private retryPolicy: RetryPolicy;

  constructor(
    config: Partial<ClaudeAnalyzerConfig> & { apiKey: string },
    logger: Logger,
    circuitBreaker?: CircuitBreaker,
  ) {
    this.config = { ...DEFAULT_CLAUDE_CONFIG, ...config };
    this.logger = logger;
    this.retryPolicy = new RetryPolicy(
      logger,
      { maxRetries: 2, initialDelayMs: 1000, multiplier: 2, maxDelayMs: 10000 },
      circuitBreaker,
    );
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    const startTime = Date.now();

    this.logger.info('Starting Claude analysis', {
      event: 'CLAUDE_ANALYSIS_START',
      schemaHash: input.schemaHash,
      model: this.config.model,
    });

    const result = await this.retryPolicy.execute(
      () => this.callClaudeAPI(input),
      'claude_analysis',
    );

    const processingTime = Date.now() - startTime;

    this.logger.info('Claude analysis completed', {
      event: 'CLAUDE_ANALYSIS_SUCCESS',
      confidence: result.confidence,
      processingTime,
    });

    if (result.confidence < (input.options?.confidenceThreshold ?? this.config.confidenceThreshold)) {
      this.logger.warn('Low confidence analysis result', {
        event: 'ANALYZER_LOW_CONFIDENCE',
        confidence: result.confidence,
        threshold: input.options?.confidenceThreshold ?? this.config.confidenceThreshold,
      });
    }

    return {
      ...result,
      metadata: {
        ...result.metadata,
        processingTime,
      },
    };
  }

  private async callClaudeAPI(input: AnalyzerInput): Promise<AnalyzerOutput> {
    const prompt = this.buildPrompt(input);

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        timeout: this.config.timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
      },
    );

    const content = response.data?.content?.[0]?.text;
    if (!content) {
      throw new Error('Empty response from Claude API');
    }

    const parsed = this.parseResponse(content);
    const tokensUsed =
      (response.data?.usage?.input_tokens ?? 0) +
      (response.data?.usage?.output_tokens ?? 0);

    return {
      result: parsed.result,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      metadata: {
        model: this.config.model,
        processingTime: 0, // will be overwritten
        tokensUsed,
      },
    };
  }

  private buildPrompt(input: AnalyzerInput): string {
    return `Analyze the following blockchain data and provide a structured analysis.

Schema: ${input.schemaHash}

Data:
${JSON.stringify(input.data.data, null, 2)}

Metadata:
- Chains: ${input.data.metadata.chains.join(', ')}
- Provider: ${input.data.metadata.provider}
- Partial data: ${input.data.metadata.partialData ?? false}

Respond ONLY with valid JSON in this exact format:
{
  "result": { "score": <0-100>, "tier": "<prime|standard|basic>", "patterns": {} },
  "confidence": <0.0-1.0>,
  "reasoning": "<your analysis reasoning>"
}`;
  }

  private parseResponse(content: string): {
    result: unknown;
    confidence: number;
    reasoning: string;
  } {
    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from Claude response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      throw new Error('Invalid confidence value in Claude response');
    }

    if (typeof parsed.reasoning !== 'string') {
      throw new Error('Missing reasoning in Claude response');
    }

    return {
      result: parsed.result ?? {},
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
    };
  }

  get name(): string {
    return 'Claude';
  }
}
