import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';

describe('ReputationAdapter', () => {
  const adapter = new ReputationAdapter();

  describe('schemaHash', () => {
    it('should match keccak256("ReputationV1")', () => {
      const expected = ethers.keccak256(ethers.toUtf8Bytes('ReputationV1'));
      expect(adapter.schemaHash).toBe(expected);
      expect(ReputationAdapter.SCHEMA_HASH).toBe(expected);
    });
  });

  describe('getKey', () => {
    it('should derive key from wallet address using solidityPacked', () => {
      const wallet = '0x1234567890123456789012345678901234567890';
      const key = adapter.getKey(wallet);

      const expectedPacked = ethers.solidityPacked(
        ['address', 'string'],
        [wallet, 'reputation'],
      );
      const expected = ethers.keccak256(expectedPacked);
      expect(key).toBe(expected);
    });

    it('should produce different keys for different wallets', () => {
      const key1 = adapter.getKey('0x1111111111111111111111111111111111111111');
      const key2 = adapter.getKey('0x2222222222222222222222222222222222222222');
      expect(key1).not.toBe(key2);
    });

    it('should produce a valid bytes32 hex string', () => {
      const key = adapter.getKey('0x1234567890123456789012345678901234567890');
      expect(key).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe('encode / decode', () => {
    it('should round-trip encode and decode', () => {
      const score = 75;
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes('test-evidence'));
      const encoded = adapter.encode(score, evidenceHash);
      const decoded = adapter.decode(encoded);

      expect(decoded.score).toBe(score);
      expect(decoded.evidenceHash).toBe(evidenceHash);
    });

    it('should handle score 0', () => {
      const encoded = adapter.encode(0, ethers.ZeroHash);
      const decoded = adapter.decode(encoded);
      expect(decoded.score).toBe(0);
      expect(decoded.evidenceHash).toBe(ethers.ZeroHash);
    });

    it('should handle score 100', () => {
      const encoded = adapter.encode(100, ethers.ZeroHash);
      const decoded = adapter.decode(encoded);
      expect(decoded.score).toBe(100);
    });

    it('should reject scores > 100', () => {
      expect(() => adapter.encode(101, ethers.ZeroHash)).toThrow('Invalid score');
    });

    it('should reject negative scores', () => {
      expect(() => adapter.encode(-1, ethers.ZeroHash)).toThrow('Invalid score');
    });

    it('should produce ABI-encoded bytes matching Solidity format', () => {
      const encoded = adapter.encode(60, ethers.ZeroHash);
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ['uint8', 'bytes32'],
        encoded,
      );
      expect(Number(decoded[0])).toBe(60);
      expect(decoded[1]).toBe(ethers.ZeroHash);
    });
  });

  describe('getDefaultValue', () => {
    it('should return score 60 and empty evidence hash', () => {
      const defaultVal = adapter.getDefaultValue();
      expect(defaultVal.score).toBe(60);
      expect(defaultVal.evidenceHash).toBe(ethers.ZeroHash);
    });
  });
});
