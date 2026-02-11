import { describe, it, expect } from 'vitest';
import {
  validateProviderOutput,
  validateAnalyzerOutput,
  validateSignerOutput,
  safeValidateProviderOutput,
  safeValidateAnalyzerOutput,
  normalizeTimestamp,
  normalizeAddress,
} from '../../src/validators/outputValidator';

const VALID_PROVIDER_OUTPUT = {
  data: { wallet: { address: '0x123' } },
  metadata: {
    chains: ['sepolia'],
    timestamp: '2026-02-08T10:00:00.000Z',
    provider: 'Goldsky',
    queryDuration: 850,
    partialData: false,
    successRate: 1.0,
  },
};

const VALID_ANALYZER_OUTPUT = {
  result: { score: 85, tier: 'prime' },
  confidence: 0.92,
  reasoning: 'High activity and good history',
  metadata: {
    model: 'claude-sonnet-4',
    method: 'ai',
    processingTime: 2200,
    tokensUsed: 512,
  },
};

const VALID_SIGNER_OUTPUT = {
  signature: '0x' + 'ab'.repeat(65),
  signingTime: 350,
  pkpPublicKey: '0x04abcdef1234567890',
};

describe('outputValidator', () => {
  describe('validateProviderOutput', () => {
    it('should accept valid provider output', () => {
      const result = validateProviderOutput(VALID_PROVIDER_OUTPUT);
      expect(result.data).toBeDefined();
      expect(result.metadata.provider).toBe('Goldsky');
      expect(result.metadata.queryDuration).toBe(850);
    });

    it('should reject missing data field', () => {
      expect(() => validateProviderOutput({ metadata: VALID_PROVIDER_OUTPUT.metadata })).toThrow();
    });

    it('should reject missing metadata', () => {
      expect(() => validateProviderOutput({ data: {} })).toThrow();
    });

    it('should reject invalid timestamp', () => {
      expect(() =>
        validateProviderOutput({
          data: {},
          metadata: { ...VALID_PROVIDER_OUTPUT.metadata, timestamp: 'not-a-date' },
        }),
      ).toThrow();
    });

    it('should reject empty chains array', () => {
      expect(() =>
        validateProviderOutput({
          data: {},
          metadata: { ...VALID_PROVIDER_OUTPUT.metadata, chains: [] },
        }),
      ).toThrow();
    });

    it('should reject negative queryDuration', () => {
      expect(() =>
        validateProviderOutput({
          data: {},
          metadata: { ...VALID_PROVIDER_OUTPUT.metadata, queryDuration: -1 },
        }),
      ).toThrow();
    });

    it('should reject successRate > 1', () => {
      expect(() =>
        validateProviderOutput({
          data: {},
          metadata: { ...VALID_PROVIDER_OUTPUT.metadata, successRate: 1.5 },
        }),
      ).toThrow();
    });
  });

  describe('validateAnalyzerOutput', () => {
    it('should accept valid analyzer output', () => {
      const result = validateAnalyzerOutput(VALID_ANALYZER_OUTPUT);
      expect(result.confidence).toBe(0.92);
      expect(result.reasoning).toContain('High activity');
    });

    it('should reject confidence > 1', () => {
      expect(() =>
        validateAnalyzerOutput({ ...VALID_ANALYZER_OUTPUT, confidence: 1.5 }),
      ).toThrow();
    });

    it('should reject confidence < 0', () => {
      expect(() =>
        validateAnalyzerOutput({ ...VALID_ANALYZER_OUTPUT, confidence: -0.1 }),
      ).toThrow();
    });

    it('should reject missing reasoning', () => {
      expect(() => {
        const { reasoning, ...noReasoning } = VALID_ANALYZER_OUTPUT;
        validateAnalyzerOutput(noReasoning);
      }).toThrow();
    });

    it('should reject negative processingTime', () => {
      expect(() =>
        validateAnalyzerOutput({
          ...VALID_ANALYZER_OUTPUT,
          metadata: { ...VALID_ANALYZER_OUTPUT.metadata, processingTime: -1 },
        }),
      ).toThrow();
    });
  });

  describe('validateSignerOutput', () => {
    it('should accept valid signer output', () => {
      const result = validateSignerOutput(VALID_SIGNER_OUTPUT);
      expect(result.signature).toMatch(/^0x/);
      expect(result.signingTime).toBe(350);
    });

    it('should reject invalid signature format', () => {
      expect(() =>
        validateSignerOutput({ ...VALID_SIGNER_OUTPUT, signature: '0xshort' }),
      ).toThrow();
    });

    it('should reject negative signingTime', () => {
      expect(() =>
        validateSignerOutput({ ...VALID_SIGNER_OUTPUT, signingTime: -1 }),
      ).toThrow();
    });
  });

  describe('safeValidateProviderOutput', () => {
    it('should return success for valid output', () => {
      const result = safeValidateProviderOutput(VALID_PROVIDER_OUTPUT);
      expect(result.success).toBe(true);
    });

    it('should return errors for invalid output', () => {
      const result = safeValidateProviderOutput({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('safeValidateAnalyzerOutput', () => {
    it('should return success for valid output', () => {
      const result = safeValidateAnalyzerOutput(VALID_ANALYZER_OUTPUT);
      expect(result.success).toBe(true);
    });

    it('should return errors for invalid output', () => {
      const result = safeValidateAnalyzerOutput({ confidence: 2 });
      expect(result.success).toBe(false);
    });
  });

  describe('normalizeTimestamp', () => {
    it('should normalize string to ISO 8601', () => {
      const result = normalizeTimestamp('2026-02-08T10:00:00Z');
      expect(result).toBe('2026-02-08T10:00:00.000Z');
    });

    it('should normalize Date object', () => {
      const date = new Date('2026-02-08T10:00:00Z');
      const result = normalizeTimestamp(date);
      expect(result).toBe('2026-02-08T10:00:00.000Z');
    });

    it('should normalize unix timestamp', () => {
      const result = normalizeTimestamp(1770508800000);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should throw on invalid timestamp', () => {
      expect(() => normalizeTimestamp('not-a-date')).toThrow('Invalid timestamp');
    });
  });

  describe('normalizeAddress', () => {
    it('should lowercase an address', () => {
      const result = normalizeAddress('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12');
      expect(result).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    });
  });
});
