import { describe, it, expect, beforeEach } from 'vitest';
import { RulesAnalyzer, DEFAULT_RULES } from '../../src/analyzers/RulesAnalyzer';
import type { Rule } from '../../src/analyzers/RulesAnalyzer';
import type { AnalyzerInput } from '../../src/analyzers/ClaudeAnalyzer';
import { Logger } from '../../src/utils/Logger';
import type { DataProviderOutput } from '../../src/validators/outputValidator';

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

function makeInput(data: Record<string, unknown>): AnalyzerInput {
  const providerOutput: DataProviderOutput = {
    data,
    metadata: {
      chains: ['sepolia'],
      timestamp: new Date().toISOString(),
      provider: 'Goldsky',
      queryDuration: 100,
    },
  };
  return { data: providerOutput, schemaHash: '0x' + 'ab'.repeat(32) };
}

describe('RulesAnalyzer', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createSilentLogger();
  });

  describe('base score', () => {
    it('should return base score of 50 with no matching rules', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { score: number }).score).toBe(50);
      expect(result.confidence).toBe(1.0);
      expect(result.metadata.method).toBe('heuristic');
    });

    it('should classify base score as standard tier', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { tier: string }).tier).toBe('standard');
    });
  });

  describe('rule application', () => {
    it('should apply wallet age bonus (+10)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      // walletAge > 2 years in seconds
      const result = await analyzer.analyze(makeInput({ walletAge: 3 * 365 * 24 * 3600 }));

      expect((result.result as { score: number }).score).toBe(60);
    });

    it('should apply tx count bonus (+10 for >100)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ txCount: 150 }));

      expect((result.result as { score: number }).score).toBe(60);
    });

    it('should apply tx count bonus (+20 for >1000)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ txCount: 1500 }));

      expect((result.result as { score: number }).score).toBe(70);
    });

    it('should apply DeFi usage bonus (+15)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ defiProtocols: ['aave', 'uniswap', 'compound', 'maker'] }));

      expect((result.result as { score: number }).score).toBe(65);
    });

    it('should apply liquidation penalty (-20)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ liquidations: 2 }));

      expect((result.result as { score: number }).score).toBe(30);
    });

    it('should apply multi-chain bonus (+5 for 2 chains)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ chainCount: 2 }));

      expect((result.result as { score: number }).score).toBe(55);
    });

    it('should apply multi-chain bonus (+10 for 3+ chains)', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ chainCount: 4 }));

      expect((result.result as { score: number }).score).toBe(60);
    });

    it('should accumulate multiple rule bonuses', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({
        walletAge: 3 * 365 * 24 * 3600, // +10
        txCount: 1500,                    // +20
        defiProtocols: ['a', 'b', 'c', 'd'], // +15
        chainCount: 3,                    // +10
      }));

      // 50 + 10 + 20 + 15 + 10 = 105 → clamped to 100
      expect((result.result as { score: number }).score).toBe(100);
    });
  });

  describe('score clamping', () => {
    it('should clamp score to 100 maximum', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({
        walletAge: 3 * 365 * 24 * 3600,
        txCount: 1500,
        defiProtocols: ['a', 'b', 'c', 'd'],
        chainCount: 3,
      }));

      expect((result.result as { score: number }).score).toBe(100);
      expect((result.result as { tier: string }).tier).toBe('prime');
    });

    it('should clamp score to 0 minimum', async () => {
      // Custom rules that subtract heavily
      const harshRules: Rule[] = [
        { name: 'big_penalty', description: 'test', evaluate: () => -80 },
      ];
      const analyzer = new RulesAnalyzer(logger, harshRules);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { score: number }).score).toBe(0);
      expect((result.result as { tier: string }).tier).toBe('basic');
    });
  });

  describe('tier classification', () => {
    it('should classify 80+ as prime', async () => {
      const rules: Rule[] = [{ name: 'boost', description: 'test', evaluate: () => 35 }];
      const analyzer = new RulesAnalyzer(logger, rules);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { tier: string }).tier).toBe('prime');
    });

    it('should classify 50-79 as standard', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { tier: string }).tier).toBe('standard');
    });

    it('should classify below 50 as basic', async () => {
      const rules: Rule[] = [{ name: 'penalty', description: 'test', evaluate: () => -10 }];
      const analyzer = new RulesAnalyzer(logger, rules);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { tier: string }).tier).toBe('basic');
    });
  });

  describe('applied rules tracking', () => {
    it('should list applied rules with deltas', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({ txCount: 200, liquidations: 1 }));

      const appliedRules = (result.result as { appliedRules: string[] }).appliedRules;
      expect(appliedRules).toContain('tx_count_bonus: +10');
      expect(appliedRules).toContain('liquidation_penalty: -20');
    });

    it('should not list rules with zero delta', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      const appliedRules = (result.result as { appliedRules: string[] }).appliedRules;
      expect(appliedRules).toHaveLength(0);
    });
  });

  describe('custom rules', () => {
    it('should accept custom rules', async () => {
      const customRules: Rule[] = [
        { name: 'custom_bonus', description: 'Custom', evaluate: () => 25 },
      ];
      const analyzer = new RulesAnalyzer(logger, customRules);
      const result = await analyzer.analyze(makeInput({}));

      expect((result.result as { score: number }).score).toBe(75);
    });
  });

  describe('output format', () => {
    it('should always have confidence 1.0', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      expect(result.confidence).toBe(1.0);
    });

    it('should include reasoning string', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      expect(result.reasoning).toContain('Rules-based calculation');
      expect(result.reasoning).toContain('deterministic');
    });

    it('should include processing time in metadata', async () => {
      const analyzer = new RulesAnalyzer(logger);
      const result = await analyzer.analyze(makeInput({}));

      expect(result.metadata.processingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('name', () => {
    it('should return Rules', () => {
      const analyzer = new RulesAnalyzer(logger);
      expect(analyzer.name).toBe('Rules');
    });
  });
});
