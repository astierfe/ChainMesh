/**
 * Phase 2 Integration Tests — Analysis pipeline (RulesAnalyzer, HybridAnalyzer)
 * Tests 10-11: No Anvil needed, uses real analyzers with mock data providers.
 */
import { describe, it, expect } from 'vitest';
import {
  createTestOrchestrator,
  createTestQueryInput,
  createDefaultMockProviderOutput,
} from './pipeline-helpers.js';
import type { DataProviderOutput } from '../../../../../module2-orchestration/src/validators/outputValidator';

// ---------------------------------------------------------------------------
// Test 10: RulesAnalyzer through pipeline
// ---------------------------------------------------------------------------

describe('Test 10: Rules-based analysis through pipeline', () => {
  it('10a. high score: wallet_age + tx_count + defi + multi_chain bonuses', async () => {
    // Default mock data → base 50 + 10 + 10 + 15 + 0 + 10 = 95
    const orchestrator = await createTestOrchestrator();
    const input = createTestQueryInput({ includeAnalysis: true });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.data!.analyzerOutput).toBeDefined();

    const analysis = result.data!.analyzerOutput!;
    const analysisResult = analysis.result as { score: number; tier: string; appliedRules: string[] };
    expect(analysisResult.score).toBe(95);
    expect(analysisResult.tier).toBe('prime');
    expect(analysis.confidence).toBe(1.0);
    expect(analysis.metadata.method).toBe('heuristic');

    // Verify all expected rules were applied
    expect(analysisResult.appliedRules).toContain('wallet_age_bonus: +10');
    expect(analysisResult.appliedRules).toContain('tx_count_bonus: +10');
    expect(analysisResult.appliedRules).toContain('defi_usage_bonus: +15');
    expect(analysisResult.appliedRules).toContain('multi_chain_bonus: +10');
  });

  it('10b. low score: no activity → base score only', async () => {
    const emptyData: DataProviderOutput = {
      data: {
        walletAge: 0,
        txCount: 0,
        defiProtocols: [],
        liquidations: 0,
        chainCount: 1,
      },
      metadata: {
        chains: ['sepolia'],
        timestamp: new Date().toISOString(),
        provider: 'MockProvider',
        queryDuration: 10,
        successRate: 1.0,
      },
    };

    const orchestrator = await createTestOrchestrator({
      mockProviderData: emptyData,
    });
    const input = createTestQueryInput({ includeAnalysis: true });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    const analysisResult = result.data!.analyzerOutput!.result as { score: number; tier: string };
    expect(analysisResult.score).toBe(50); // Base score, no bonuses
    expect(analysisResult.tier).toBe('standard');
  });

  it('10c. penalty: liquidations reduce score', async () => {
    const liquidationData: DataProviderOutput = {
      data: {
        walletAge: 0,
        txCount: 0,
        defiProtocols: [],
        liquidations: 2,   // → -20 penalty
        chainCount: 1,
      },
      metadata: {
        chains: ['sepolia'],
        timestamp: new Date().toISOString(),
        provider: 'MockProvider',
        queryDuration: 10,
        successRate: 1.0,
      },
    };

    const orchestrator = await createTestOrchestrator({
      mockProviderData: liquidationData,
    });
    const input = createTestQueryInput({ includeAnalysis: true });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    const analysisResult = result.data!.analyzerOutput!.result as { score: number; tier: string; appliedRules: string[] };
    expect(analysisResult.score).toBe(30); // 50 base - 20 liquidation
    expect(analysisResult.tier).toBe('basic');
    expect(analysisResult.appliedRules).toContain('liquidation_penalty: -20');
  });
});

// ---------------------------------------------------------------------------
// Test 11: HybridAnalyzer through pipeline (mock Claude + real Rules)
// ---------------------------------------------------------------------------

describe('Test 11: Hybrid analysis (mock Claude + Rules)', () => {
  it('11a. hybrid combines AI 60% + Rules 40%', async () => {
    // MockClaude returns score 72; Rules returns score 95 (default mock data)
    // Combined: round(72 * 0.6 + 95 * 0.4) = round(43.2 + 38) = 81
    const orchestrator = await createTestOrchestrator({
      useHybridAnalyzer: true,
      mockClaudeOutput: {
        result: { score: 72, tier: 'standard', patterns: {} },
        confidence: 0.85,
        reasoning: 'Mock Claude analysis',
        metadata: { model: 'mock-claude', processingTime: 100, tokensUsed: 500 },
      },
    });
    const input = createTestQueryInput({ includeAnalysis: true });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.data!.analyzerOutput).toBeDefined();

    const analysis = result.data!.analyzerOutput!;
    const analysisResult = analysis.result as {
      score: number;
      tier: string;
      aiScore: number;
      rulesScore: number;
    };
    expect(analysisResult.aiScore).toBe(72);
    expect(analysisResult.rulesScore).toBe(95);
    expect(analysisResult.score).toBe(81); // round(72*0.6 + 95*0.4)
    expect(analysisResult.tier).toBe('prime'); // 81 >= 80
    expect(analysis.metadata.method).toBe('hybrid');

    // Combined confidence: 0.85 * 0.6 + 1.0 * 0.4 = 0.51 + 0.4 = 0.91
    expect(analysis.confidence).toBe(0.91);
  });

  it('11b. Claude failure falls back to rules-only', async () => {
    const orchestrator = await createTestOrchestrator({
      useHybridAnalyzer: true,
      mockClaudeShouldFail: true,
    });
    const input = createTestQueryInput({ includeAnalysis: true });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.data!.analyzerOutput).toBeDefined();

    const analysis = result.data!.analyzerOutput!;
    const analysisResult = analysis.result as { score: number; tier: string };
    expect(analysisResult.score).toBe(95); // Rules-only with default mock data
    expect(analysisResult.tier).toBe('prime');
    expect(analysis.confidence).toBe(1.0);
    expect(analysis.metadata.method).toBe('heuristic_fallback');
  });
});
