/**
 * Phase 2 Integration Tests — Pipeline basics (validation, rate limiting, data flow)
 * Tests 7-9: No Anvil needed, uses in-memory backends and mock providers.
 */
import { describe, it, expect } from 'vitest';
import {
  createTestOrchestrator,
  createTestQueryInput,
  createDefaultMockProviderOutput,
  type OrchestratorResult,
} from './pipeline-helpers.js';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';

// ---------------------------------------------------------------------------
// Test 7: Pipeline input validation
// ---------------------------------------------------------------------------

describe('Test 7: Pipeline input validation', () => {
  it('7a. valid input passes through pipeline', async () => {
    const orchestrator = await createTestOrchestrator();
    const input = createTestQueryInput();

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.context.steps.validation.status).toBe('success');
    expect(result.context.steps.rateLimit.status).toBe('success');
    expect(result.context.steps.dataProvider.status).toBe('success');
    expect(result.context.steps.signer.status).toBe('success');
    expect(result.data).toBeDefined();
    expect(result.data!.providerOutput).toBeDefined();
    expect(result.data!.signerOutput).toBeDefined();
    expect(result.data!.encodedValue).toBeDefined();
  });

  it('7b. missing key rejects with VALIDATION_ERROR', async () => {
    const orchestrator = await createTestOrchestrator();
    const input = createTestQueryInput();
    delete (input as any).key;

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error!.type).toBe('VALIDATION_ERROR');
    expect(result.context.steps.validation.status).toBe('error');
  });

  it('7c. invalid schemaHash rejects with VALIDATION_ERROR', async () => {
    const orchestrator = await createTestOrchestrator();
    const input = createTestQueryInput({ schemaHash: 'not-a-bytes32' });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(false);
    expect(result.error!.type).toBe('VALIDATION_ERROR');
    expect(result.context.steps.validation.status).toBe('error');
  });

  it('7d. empty chains array rejects with VALIDATION_ERROR', async () => {
    const orchestrator = await createTestOrchestrator();
    const input = createTestQueryInput({ chains: [] });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(false);
    expect(result.error!.type).toBe('VALIDATION_ERROR');
    expect(result.context.steps.validation.status).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Test 8: Pipeline rate limiting
// ---------------------------------------------------------------------------

describe('Test 8: Pipeline rate limiting', () => {
  it('8a. first request passes rate limit', async () => {
    const orchestrator = await createTestOrchestrator({
      rateLimitWindowMs: 60_000,
    });
    const input = createTestQueryInput();

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.context.steps.rateLimit.status).toBe('success');
  });

  it('8b. same key immediately blocked by rate limit', async () => {
    const orchestrator = await createTestOrchestrator({
      rateLimitWindowMs: 60_000,
    });
    const input = createTestQueryInput();

    // First request succeeds
    const first = await orchestrator.execute(input);
    expect(first.success).toBe(true);

    // Second request with same key is rate-limited
    const second = await orchestrator.execute(input);
    expect(second.success).toBe(false);
    expect(second.error!.type).toBe('RATE_LIMIT_EXCEEDED');
    expect(second.context.steps.rateLimit.status).toBe('error');
  });

  it('8c. different key passes despite rate limit on first key', async () => {
    const orchestrator = await createTestOrchestrator({
      rateLimitWindowMs: 60_000,
    });

    const adapter = new ReputationAdapter();
    const input1 = createTestQueryInput({
      key: adapter.getKey('0x0000000000000000000000000000000000000001'),
    });
    const input2 = createTestQueryInput({
      key: adapter.getKey('0x0000000000000000000000000000000000000002'),
    });

    const first = await orchestrator.execute(input1);
    expect(first.success).toBe(true);

    const second = await orchestrator.execute(input2);
    expect(second.success).toBe(true);
    expect(second.context.steps.rateLimit.status).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// Test 9: Pipeline data provider flow
// ---------------------------------------------------------------------------

describe('Test 9: Pipeline data flow (mock provider)', () => {
  it('9a. provider output captured in result', async () => {
    const mockData = createDefaultMockProviderOutput();
    const orchestrator = await createTestOrchestrator({
      mockProviderData: mockData,
    });
    const input = createTestQueryInput();

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.data!.providerOutput).toBeDefined();
    expect(result.data!.providerOutput!.data).toEqual(mockData.data);
    expect(result.data!.providerOutput!.metadata.provider).toBe('MockProvider');
    expect(result.context.steps.dataProvider.status).toBe('success');
  });

  it('9b. provider failure stops pipeline', async () => {
    const orchestrator = await createTestOrchestrator({
      providerShouldFail: true,
    });
    const input = createTestQueryInput();

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(false);
    expect(result.error!.message).toContain('Mock provider failure');
    expect(result.context.steps.dataProvider.status).toBe('error');
    // Steps after dataProvider should not exist
    expect(result.context.steps.analyzer).toBeUndefined();
    expect(result.context.steps.signer).toBeUndefined();
  });

  it('9c. pipeline without analysis skips analyzer step', async () => {
    const orchestrator = await createTestOrchestrator();
    const input = createTestQueryInput({ includeAnalysis: false });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.context.steps.analyzer.status).toBe('skipped');
    expect(result.data!.analyzerOutput).toBeUndefined();
    // Signer still runs
    expect(result.context.steps.signer.status).toBe('success');
  });
});
