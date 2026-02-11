import { describe, it, expect } from 'vitest';
import { validateBytes32, validateAddress } from '../../src/utils/validation.js';

describe('Validation', () => {
  describe('validateBytes32', () => {
    it('should accept valid bytes32', () => {
      const valid = '0x' + 'ab'.repeat(32);
      expect(validateBytes32(valid)).toBe(valid);
    });

    it('should reject short hex', () => {
      expect(() => validateBytes32('0xabcd')).toThrow();
    });

    it('should reject missing 0x prefix', () => {
      expect(() => validateBytes32('ab'.repeat(32))).toThrow();
    });

    it('should reject non-hex characters', () => {
      expect(() => validateBytes32('0x' + 'zz'.repeat(32))).toThrow();
    });

    it('should include field name in error', () => {
      expect(() => validateBytes32('bad', 'myField')).toThrow('Invalid myField');
    });
  });

  describe('validateAddress', () => {
    it('should accept valid address', () => {
      const valid = '0x' + '1'.repeat(40);
      expect(validateAddress(valid)).toBe(valid);
    });

    it('should reject short address', () => {
      expect(() => validateAddress('0x1234')).toThrow();
    });

    it('should reject missing 0x prefix', () => {
      expect(() => validateAddress('1'.repeat(40))).toThrow();
    });
  });
});
