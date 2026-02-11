import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DevWalletSigner } from '../../src/signers/DevWalletSigner';
import type { SignPayload } from '../../src/signers/DevWalletSigner';
import { Logger } from '../../src/utils/Logger';

// Use real ethers for DevWalletSigner (actual crypto signing)
// No mock needed — ethers.Wallet works fine in tests

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

// Deterministic test private key (DO NOT use in production)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const defaultPayload: SignPayload = {
  key: '0x' + 'aa'.repeat(32),
  value: '0x' + 'bb'.repeat(32),
  schemaHash: '0x' + 'cc'.repeat(32),
  timestamp: 1738234567,
};

describe('DevWalletSigner', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createSilentLogger();
  });

  describe('construction', () => {
    it('should create signer for testnet environment', () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );
      expect(signer.name).toBe('DevWallet');
      expect(signer.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should throw in production environment', () => {
      expect(() => {
        new DevWalletSigner(
          { privateKey: TEST_PRIVATE_KEY, environment: 'production' },
          logger,
        );
      }).toThrow('DevWalletSigner cannot be used in production');
    });
  });

  describe('sign', () => {
    it('should return a valid SignerOutput', async () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );

      const result = await signer.sign(defaultPayload);

      expect(result.signature).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(result.signingTime).toBeGreaterThanOrEqual(0);
      expect(result.pkpPublicKey).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should produce deterministic signatures for same payload', async () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );

      const result1 = await signer.sign(defaultPayload);
      const result2 = await signer.sign(defaultPayload);

      expect(result1.signature).toBe(result2.signature);
    });

    it('should produce different signatures for different payloads', async () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );

      const result1 = await signer.sign(defaultPayload);
      const result2 = await signer.sign({
        ...defaultPayload,
        timestamp: defaultPayload.timestamp + 1,
      });

      expect(result1.signature).not.toBe(result2.signature);
    });
  });

  describe('serializeAndHash', () => {
    it('should return a 32-byte hex hash', () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );

      const hash = signer.serializeAndHash(defaultPayload);
      expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('should be deterministic', () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );

      const hash1 = signer.serializeAndHash(defaultPayload);
      const hash2 = signer.serializeAndHash(defaultPayload);
      expect(hash1).toBe(hash2);
    });
  });

  describe('name and address', () => {
    it('should expose wallet address', () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );

      expect(signer.address).toBeDefined();
      expect(signer.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should return DevWallet as name', () => {
      const signer = new DevWalletSigner(
        { privateKey: TEST_PRIVATE_KEY, environment: 'testnet' },
        logger,
      );
      expect(signer.name).toBe('DevWallet');
    });
  });
});
