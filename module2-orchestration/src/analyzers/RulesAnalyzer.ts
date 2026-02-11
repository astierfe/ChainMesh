/**
 * RulesAnalyzer.ts - Deterministic rules-based analyzer
 *
 * Applies heuristic rules to aggregated blockchain data.
 * Fast, no API cost, deterministic output with confidence = 1.0.
 */

import { Logger } from '../utils/Logger';
import type { AnalyzerOutput } from '../validators/outputValidator';
import type { DataProviderOutput } from '../validators/outputValidator';
import type { AnalyzerInput } from './ClaudeAnalyzer';

export interface Rule {
  name: string;
  evaluate: (data: Record<string, unknown>) => number;
  description: string;
}

export const DEFAULT_RULES: Rule[] = [
  {
    name: 'wallet_age_bonus',
    description: 'Bonus for wallet age > 2 years',
    evaluate: (data) => {
      const age = Number(data.walletAge ?? 0);
      return age > 2 * 365 * 24 * 3600 ? 10 : 0;
    },
  },
  {
    name: 'tx_count_bonus',
    description: 'Bonus for transaction count',
    evaluate: (data) => {
      const txCount = Number(data.txCount ?? data.transactionCount ?? 0);
      if (txCount > 1000) return 20;
      if (txCount > 100) return 10;
      return 0;
    },
  },
  {
    name: 'defi_usage_bonus',
    description: 'Bonus for DeFi protocol usage',
    evaluate: (data) => {
      const protocols = Array.isArray(data.defiProtocols) ? data.defiProtocols.length : 0;
      return protocols > 3 ? 15 : 0;
    },
  },
  {
    name: 'liquidation_penalty',
    description: 'Penalty for liquidations',
    evaluate: (data) => {
      const liquidations = Number(data.liquidations ?? 0);
      return liquidations > 0 ? -20 : 0;
    },
  },
  {
    name: 'multi_chain_bonus',
    description: 'Bonus for multi-chain activity',
    evaluate: (data) => {
      const chainCount = Number(data.chainCount ?? 1);
      return chainCount >= 3 ? 10 : chainCount >= 2 ? 5 : 0;
    },
  },
];

export class RulesAnalyzer {
  private logger: Logger;
  private rules: Rule[];

  constructor(logger: Logger, rules?: Rule[]) {
    this.logger = logger;
    this.rules = rules ?? DEFAULT_RULES;
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerOutput> {
    const startTime = Date.now();

    this.logger.info('Starting rules-based analysis', {
      event: 'RULES_ANALYSIS_START',
      schemaHash: input.schemaHash,
      ruleCount: this.rules.length,
    });

    const data = input.data.data as Record<string, unknown>;
    const appliedRules: string[] = [];
    let score = 50; // Base score

    for (const rule of this.rules) {
      const delta = rule.evaluate(data);
      if (delta !== 0) {
        appliedRules.push(`${rule.name}: ${delta > 0 ? '+' : ''}${delta}`);
        score += delta;
      }
    }

    // Clamp score 0-100
    score = Math.min(Math.max(score, 0), 100);

    const tier = this.calculateTier(score);
    const processingTime = Date.now() - startTime;

    this.logger.info('Rules-based analysis completed', {
      event: 'RULES_ANALYSIS_SUCCESS',
      score,
      tier,
      appliedRules,
      processingTime,
    });

    return {
      result: {
        score,
        tier,
        appliedRules,
      },
      confidence: 1.0,
      reasoning: `Rules-based calculation (deterministic). Applied ${appliedRules.length} rules. Base score: 50, final: ${score}.`,
      metadata: {
        method: 'heuristic',
        processingTime,
      },
    };
  }

  private calculateTier(score: number): string {
    if (score >= 80) return 'prime';
    if (score >= 50) return 'standard';
    return 'basic';
  }

  get name(): string {
    return 'Rules';
  }
}
