import { describe, it, expect } from 'vitest';
import {
  validateQueryRequest,
  safeValidateQueryRequest,
  validateBytes32,
  validateAddress,
  SUPPORTED_CHAINS,
} from '../../src/validators/inputValidator';

const VALID_KEY = '0x' + 'ab'.repeat(32);
const VALID_SCHEMA_HASH = '0x' + 'cd'.repeat(32);
const VALID_ADDRESS = '0x' + '11'.repeat(20);

describe('inputValidator', () => {
  describe('validateQueryRequest', () => {
    it('should accept a valid minimal request', () => {
      const result = validateQueryRequest({
        key: VALID_KEY,
        schemaHash: VALID_SCHEMA_HASH,
        chains: ['sepolia'],
      });
      expect(result.key).toBe(VALID_KEY);
      expect(result.schemaHash).toBe(VALID_SCHEMA_HASH);
      expect(result.chains).toEqual(['sepolia']);
      expect(result.includeAnalysis).toBe(true); // default
    });

    it('should accept a full request with all fields', () => {
      const result = validateQueryRequest({
        key: VALID_KEY,
        schemaHash: VALID_SCHEMA_HASH,
        chains: ['sepolia', 'arbitrum', 'base'],
        includeAnalysis: false,
        options: {
          timeoutMs: 30000,
          fallbackProviders: false,
          customConfig: { foo: 'bar' },
        },
        metadata: {
          messageId: VALID_KEY,
          sourceChain: 'arbitrum',
          requester: VALID_ADDRESS,
        },
      });
      expect(result.includeAnalysis).toBe(false);
      expect(result.options?.timeoutMs).toBe(30000);
      expect(result.metadata?.requester).toBe(VALID_ADDRESS);
    });

    it('should reject missing key', () => {
      expect(() =>
        validateQueryRequest({ schemaHash: VALID_SCHEMA_HASH, chains: ['sepolia'] }),
      ).toThrow();
    });

    it('should reject missing schemaHash', () => {
      expect(() =>
        validateQueryRequest({ key: VALID_KEY, chains: ['sepolia'] }),
      ).toThrow();
    });

    it('should reject empty chains array', () => {
      expect(() =>
        validateQueryRequest({ key: VALID_KEY, schemaHash: VALID_SCHEMA_HASH, chains: [] }),
      ).toThrow();
    });

    it('should reject unsupported chain', () => {
      expect(() =>
        validateQueryRequest({
          key: VALID_KEY,
          schemaHash: VALID_SCHEMA_HASH,
          chains: ['mainnet'],
        }),
      ).toThrow();
    });

    it('should reject invalid key format', () => {
      expect(() =>
        validateQueryRequest({
          key: '0xinvalid',
          schemaHash: VALID_SCHEMA_HASH,
          chains: ['sepolia'],
        }),
      ).toThrow();
    });

    it('should reject timeoutMs below minimum', () => {
      expect(() =>
        validateQueryRequest({
          key: VALID_KEY,
          schemaHash: VALID_SCHEMA_HASH,
          chains: ['sepolia'],
          options: { timeoutMs: 5000 },
        }),
      ).toThrow();
    });

    it('should reject timeoutMs above maximum', () => {
      expect(() =>
        validateQueryRequest({
          key: VALID_KEY,
          schemaHash: VALID_SCHEMA_HASH,
          chains: ['sepolia'],
          options: { timeoutMs: 500000 },
        }),
      ).toThrow();
    });

    it('should reject invalid metadata address', () => {
      expect(() =>
        validateQueryRequest({
          key: VALID_KEY,
          schemaHash: VALID_SCHEMA_HASH,
          chains: ['sepolia'],
          metadata: { requester: 'not_an_address' },
        }),
      ).toThrow();
    });
  });

  describe('safeValidateQueryRequest', () => {
    it('should return success for valid input', () => {
      const result = safeValidateQueryRequest({
        key: VALID_KEY,
        schemaHash: VALID_SCHEMA_HASH,
        chains: ['sepolia'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.key).toBe(VALID_KEY);
      }
    });

    it('should return errors for invalid input', () => {
      const result = safeValidateQueryRequest({ key: 'bad' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateBytes32', () => {
    it('should accept valid bytes32', () => {
      expect(validateBytes32(VALID_KEY)).toBe(VALID_KEY);
    });

    it('should reject invalid bytes32', () => {
      expect(() => validateBytes32('0xshort')).toThrow();
    });

    it('should include field name in error', () => {
      expect(() => validateBytes32('bad', 'schemaHash')).toThrow('schemaHash');
    });
  });

  describe('validateAddress', () => {
    it('should accept valid address', () => {
      expect(validateAddress(VALID_ADDRESS)).toBe(VALID_ADDRESS);
    });

    it('should reject invalid address', () => {
      expect(() => validateAddress('0xshort')).toThrow();
    });
  });

  describe('SUPPORTED_CHAINS', () => {
    it('should include expected chains', () => {
      expect(SUPPORTED_CHAINS).toContain('sepolia');
      expect(SUPPORTED_CHAINS).toContain('arbitrum');
      expect(SUPPORTED_CHAINS).toContain('base');
      expect(SUPPORTED_CHAINS).toContain('optimism');
    });
  });
});
