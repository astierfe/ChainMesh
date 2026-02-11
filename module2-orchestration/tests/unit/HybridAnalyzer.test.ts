import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridAnalyzer, DEFAULT_WEIGHTS } from '../../src/analyzers/HybridAnalyzer';
import { ClaudeAnalyzer } from '../../src/analyzers/ClaudeAnalyzer';
import { RulesAnalyzer } from '../../src/analyzers/RulesAnalyzer';
import type { AnalyzerInput } from '../../src/analyzers/ClaudeAnalyzer';
import { Logger } from '../../src/utils/Logger';
import type { DataProviderOutput, AnalyzerOutput } from '../../src/validators/outputValidator';

// Mock axios (used by ClaudeAnalyzer)
vi.mock('axios');

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const mockProviderOutput: DataProviderOutput = {
  data: { results: [{ chain: 'sepolia', blockNumber: 12345 }] },
  metadata: {
    chains: ['sepolia'],
    timestamp: new Date().toISOString(),
    provider: 'Goldsky',
    queryDuration: 100,
  },
};

const defaultInput: AnalyzerInput = {
  data: mockProviderOutput,
  schemaHash: '0x' + 'ab'.repeat(32),
};

describe('HybridAnalyzer', () => {
  let logger: Logger;
  let claudeAnalyzer: ClaudeAnalyzer;
  let rulesAnalyzer: RulesAnalyzer;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createSilentLogger();
    claudeAnalyzer = new ClaudeAnalyzer({ apiKey: 'test-key' }, logger);
    rulesAnalyzer = new RulesAnalyzer(logger);
  });

  describe('hybrid combination', () => {
    it('should combine AI and Rules scores with default weights (60/40)', async () => {
      const aiResult: AnalyzerOutput = {
        result: { score: 90, tier: 'prime' },
        confidence: 0.85,
        reasoning: 'AI analysis',
        metadata: { model: 'claude-sonnet-4-5-20250929', processingTime: 2000, tokensUsed: 1500 },
      };

      vi.spyOn(claudeAnalyzer, 'analyze').mockResolvedValueOnce(aiResult);

      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      const result = await hybrid.analyze(defaultInput);

      const data = result.result as { score: number; aiScore: number; rulesScore: number };
      expect(data.aiScore).toBe(90);
      expect(data.rulesScore).toBe(50); // base score, no matching rules
      // 90 * 0.6 + 50 * 0.4 = 54 + 20 = 74
      expect(data.score).toBe(74);
      expect(result.metadata.method).toBe('hybrid');
    });

    it('should combine confidence scores with weights', async () => {
      const aiResult: AnalyzerOutput = {
        result: { score: 80 },
        confidence: 0.8,
        reasoning: 'AI analysis',
        metadata: { processingTime: 1000, tokensUsed: 1000 },
      };

      vi.spyOn(claudeAnalyzer, 'analyze').mockResolvedValueOnce(aiResult);

      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      const result = await hybrid.analyze(defaultInput);

      // 0.8 * 0.6 + 1.0 * 0.4 = 0.48 + 0.4 = 0.88
      expect(result.confidence).toBe(0.88);
    });

    it('should use custom weights', async () => {
      const aiResult: AnalyzerOutput = {
        result: { score: 100 },
        confidence: 0.9,
        reasoning: 'AI analysis',
        metadata: { processingTime: 1000, tokensUsed: 1000 },
      };

      vi.spyOn(claudeAnalyzer, 'analyze').mockResolvedValueOnce(aiResult);

      const customWeights = { ai: 0.3, rules: 0.7 };
      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger, customWeights);
      const result = await hybrid.analyze(defaultInput);

      const data = result.result as { score: number };
      // 100 * 0.3 + 50 * 0.7 = 30 + 35 = 65
      expect(data.score).toBe(65);
    });
  });

  describe('tier classification', () => {
    it('should classify combined score into correct tier', async () => {
      const aiResult: AnalyzerOutput = {
        result: { score: 100 },
        confidence: 0.95,
        reasoning: 'Perfect score',
        metadata: { processingTime: 1000, tokensUsed: 1000 },
      };

      vi.spyOn(claudeAnalyzer, 'analyze').mockResolvedValueOnce(aiResult);

      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      const result = await hybrid.analyze(defaultInput);

      const data = result.result as { tier: string };
      // 100 * 0.6 + 50 * 0.4 = 80
      expect(data.tier).toBe('prime');
    });
  });

  describe('fallback to rules-only', () => {
    it('should fall back to rules-only when Claude fails', async () => {
      vi.spyOn(claudeAnalyzer, 'analyze').mockRejectedValueOnce(new Error('API timeout'));

      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      const result = await hybrid.analyze(defaultInput);

      expect((result.result as { score: number }).score).toBe(50);
      expect(result.confidence).toBe(1.0);
      expect(result.metadata.method).toBe('heuristic_fallback');
    });

    it('should log warning on AI fallback', async () => {
      vi.spyOn(claudeAnalyzer, 'analyze').mockRejectedValueOnce(new Error('API error'));
      const warnSpy = vi.spyOn(logger, 'warn');

      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      await hybrid.analyze(defaultInput);

      expect(warnSpy).toHaveBeenCalledWith(
        'Claude analysis failed, using rules-only fallback',
        expect.objectContaining({ event: 'HYBRID_AI_FALLBACK' }),
      );
    });
  });

  describe('default weights', () => {
    it('should have 0.6 AI and 0.4 Rules as defaults', () => {
      expect(DEFAULT_WEIGHTS.ai).toBe(0.6);
      expect(DEFAULT_WEIGHTS.rules).toBe(0.4);
    });
  });

  describe('tokens tracking', () => {
    it('should pass through tokens used from AI result', async () => {
      const aiResult: AnalyzerOutput = {
        result: { score: 70 },
        confidence: 0.8,
        reasoning: 'Analysis',
        metadata: { processingTime: 1000, tokensUsed: 2500 },
      };

      vi.spyOn(claudeAnalyzer, 'analyze').mockResolvedValueOnce(aiResult);

      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      const result = await hybrid.analyze(defaultInput);

      expect(result.metadata.tokensUsed).toBe(2500);
    });
  });

  describe('name', () => {
    it('should return Hybrid', () => {
      const hybrid = new HybridAnalyzer(claudeAnalyzer, rulesAnalyzer, logger);
      expect(hybrid.name).toBe('Hybrid');
    });
  });
});
