import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { PriceAdapter } from '../../src/adapters/PriceAdapter.js';

describe('PriceAdapter', () => {
  const adapter = new PriceAdapter();

  describe('schemaHash', () => {
    it('should match keccak256("PriceV1")', () => {
      const expected = ethers.keccak256(ethers.toUtf8Bytes('PriceV1'));
      expect(adapter.schemaHash).toBe(expected);
      expect(PriceAdapter.SCHEMA_HASH).toBe(expected);
    });
  });

  describe('getKey', () => {
    it('should derive key from symbol using solidityPacked', () => {
      const key = adapter.getKey('ETH');

      const expectedPacked = ethers.solidityPacked(
        ['string', 'string'],
        ['ETH', 'price'],
      );
      const expected = ethers.keccak256(expectedPacked);
      expect(key).toBe(expected);
    });

    it('should produce different keys for different symbols', () => {
      const keyETH = adapter.getKey('ETH');
      const keyBTC = adapter.getKey('BTC');
      expect(keyETH).not.toBe(keyBTC);
    });

    it('should produce a valid bytes32 hex string', () => {
      const key = adapter.getKey('ETH');
      expect(key).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('encode / decode', () => {
    it('should round-trip encode and decode', () => {
      const value = 250000000000n; // $2500.00 with 8 decimals
      const decimals = 8;
      const encoded = adapter.encode(value, decimals);
      const decoded = adapter.decode(encoded);

      expect(decoded.value).toBe(value);
      expect(decoded.decimals).toBe(decimals);
    });

    it('should handle zero value', () => {
      const encoded = adapter.encode(0n, 18);
      const decoded = adapter.decode(encoded);
      expect(decoded.value).toBe(0n);
      expect(decoded.decimals).toBe(18);
    });

    it('should handle large values', () => {
      const value = ethers.MaxUint256;
      const encoded = adapter.encode(value, 18);
      const decoded = adapter.decode(encoded);
      expect(decoded.value).toBe(value);
    });

    it('should reject decimals > 255', () => {
      expect(() => adapter.encode(100n, 256)).toThrow('Invalid decimals');
    });

    it('should reject negative decimals', () => {
      expect(() => adapter.encode(100n, -1)).toThrow('Invalid decimals');
    });

    it('should produce ABI-encoded bytes matching Solidity format', () => {
      const encoded = adapter.encode(1000n, 8);
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint256', 'uint8'],
        encoded,
      );
      expect(decoded[0]).toBe(1000n);
      expect(Number(decoded[1])).toBe(8);
    });
  });

  describe('getDefaultValue', () => {
    it('should return 0 value and 18 decimals', () => {
      const defaultVal = adapter.getDefaultValue();
      expect(defaultVal.value).toBe(0n);
      expect(defaultVal.decimals).toBe(18);
    });
  });
});
