/**
 * HybridAnalyzer.ts - Combines AI (Claude) and Rules-based analysis
 *
 * Weighted average: AI 60% + Rules 40%.
 * Falls back to Rules-only if Claude fails.
 */

import { Logger } from '../utils/Logger';
import { ClaudeAnalyzer } from './ClaudeAnalyzer';
import { RulesAnalyzer } from './RulesAnalyzer';
import type { AnalyzerInput } from './ClaudeAnalyzer';
import type { AnalyzerOutput } from '../validators/outputValidator';

export interface HybridWeights {
  ai: number;
  rules: number;
}

export const DEFAULT_WEIGHTS: HybridWeights = {
  ai: 0.6,
  rules: 0.4,
};

export class HybridAnalyzer {
  private claudeAnalyzer: ClaudeAnalyzer;
  private rulesAnalyzer: RulesAnalyzer;
  private weights: HybridWeights;
  private logger: Logger;

  constructor(
    claudeAnalyzer: ClaudeAnalyzer,
    rulesAnalyzer: RulesAnalyzer,
    logger: Logger,
    weights?: HybridWeights,
  ) {
    this.claudeAnalyzer = claudeAnalyzer;
    this.rulesAnalyzer = rulesAnalyzer;
    this.logger = logger;
    this.weights = weights ?? DEFAULT_WEIGHTS;
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    const startTime = Date.now();

    this.logger.info('Starting hybrid analysis', {
      event: 'HYBRID_ANALYSIS_START',
      schemaHash: input.schemaHash,
      weights: this.weights,
    });

    // Run rules analysis (always succeeds, fast)
    const rulesResult = await this.rulesAnalyzer.analyze(input);

    // Try AI analysis with fallback to rules-only
    let aiResult: AnalyzerOutput | null = null;
    try {
      aiResult = await this.claudeAnalyzer.analyze(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Claude analysis failed, using rules-only fallback', {
        event: 'HYBRID_AI_FALLBACK',
        error: message,
      });
    }

    const processingTime = Date.now() - startTime;

    if (aiResult) {
      return this.combineResults(aiResult, rulesResult, processingTime);
    }

    // Fallback: rules-only
    this.logger.info('Hybrid analysis completed (rules-only fallback)', {
      event: 'HYBRID_ANALYSIS_FALLBACK_SUCCESS',
      processingTime,
    });

    return {
      ...rulesResult,
      metadata: {
        ...rulesResult.metadata,
        method: 'heuristic_fallback',
        processingTime,
      },
    };
  }

  private combineResults(
    aiResult: AnalyzerOutput,
    rulesResult: AnalyzerOutput,
    processingTime: number,
  ): AnalyzerOutput {
    const aiScore = this.extractScore(aiResult.result);
    const rulesScore = this.extractScore(rulesResult.result);

    const combinedScore = Math.round(
      aiScore * this.weights.ai + rulesScore * this.weights.rules,
    );

    const combinedConfidence =
      aiResult.confidence * this.weights.ai + rulesResult.confidence * this.weights.rules;

    const tier = combinedScore >= 80 ? 'prime' : combinedScore >= 50 ? 'standard' : 'basic';

    this.logger.info('Hybrid analysis completed', {
      event: 'HYBRID_ANALYSIS_SUCCESS',
      aiScore,
      rulesScore,
      combinedScore,
      combinedConfidence,
      processingTime,
    });

    return {
      result: {
        score: combinedScore,
        tier,
        aiScore,
        rulesScore,
        weights: this.weights,
      },
      confidence: Math.round(combinedConfidence * 100) / 100,
      reasoning: `Hybrid analysis: AI (${aiScore}, weight ${this.weights.ai}) + Rules (${rulesScore}, weight ${this.weights.rules}) = ${combinedScore}. ${aiResult.reasoning}`,
      metadata: {
        method: 'hybrid',
        processingTime,
        tokensUsed: aiResult.metadata.tokensUsed,
      },
    };
  }

  private extractScore(result: unknown): number {
    if (result && typeof result === 'object' && 'score' in result) {
      return Number((result as { score: number }).score);
    }
    return 50; // Default score if extraction fails
  }

  get name(): string {
    return 'Hybrid';
  }
}
