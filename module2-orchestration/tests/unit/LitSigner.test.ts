import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LitSigner } from '../../src/signers/LitSigner';
import type { SignPayload } from '../../src/signers/LitSigner';
import { Logger } from '../../src/utils/Logger';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  InMemoryCircuitBreakerStorage,
} from '../../src/utils/CircuitBreaker';

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Mock ethers — keep AbiCoder and keccak256 real-ish for serializeAndHash
vi.mock('ethers', () => ({
  ethers: {
    AbiCoder: {
      defaultAbiCoder: () => ({
        encode: vi.fn().mockReturnValue('0x' + 'aa'.repeat(32)),
      }),
    },
    keccak256: vi.fn().mockReturnValue('0x' + 'bb'.repeat(32)),
  },
}));

import axios from 'axios';
const mockedAxios = vi.mocked(axios);

function createSilentLogger(): Logger {
  return new Logger({ executionId: 'test' }, { silent: true });
}

const validSignature = '0x' + 'ab'.repeat(65);

const defaultConfig = {
  pkpPublicKey: '0x04' + 'ff'.repeat(64),
  litActionEndpoint: 'https://serrano.litgateway.com/api/v1/execute',
  timeoutMs: 5000,
};

const defaultPayload: SignPayload = {
  key: '0x' + 'aa'.repeat(32),
  value: '0x' + 'bb'.repeat(32),
  schemaHash: '0x' + 'cc'.repeat(32),
  timestamp: 1738234567,
};

describe('LitSigner', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createSilentLogger();
  });

  describe('sign success', () => {
    it('should return SignerOutput with valid signature', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { signature: validSignature },
      });

      const signer = new LitSigner(defaultConfig, logger);
      const result = await signer.sign(defaultPayload);

      expect(result.signature).toBe(validSignature);
      expect(result.signingTime).toBeGreaterThanOrEqual(0);
      expect(result.pkpPublicKey).toBe(defaultConfig.pkpPublicKey);
    });

    it('should call Lit Protocol endpoint with correct payload', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { signature: validSignature },
      });

      const signer = new LitSigner(defaultConfig, logger);
      await signer.sign(defaultPayload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        defaultConfig.litActionEndpoint,
        expect.objectContaining({
          pkpPublicKey: defaultConfig.pkpPublicKey,
          sigName: 'chainmesh_sig',
        }),
        expect.objectContaining({
          timeout: defaultConfig.timeoutMs,
        }),
      );
    });
  });

  describe('sign errors', () => {
    it('should throw on missing signature in response', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {},
      });

      const signer = new LitSigner(defaultConfig, logger);
      await expect(signer.sign(defaultPayload)).rejects.toThrow('Invalid or missing signature');
    });

    it('should throw on invalid signature format', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { signature: '0xinvalid' },
      });

      const signer = new LitSigner(defaultConfig, logger);
      await expect(signer.sign(defaultPayload)).rejects.toThrow('Invalid signature format');
    });

    it('should throw on network error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('network error'));

      const signer = new LitSigner(defaultConfig, logger);
      await expect(signer.sign(defaultPayload)).rejects.toThrow('network error');
    });
  });

  describe('retry and circuit breaker', () => {
    it('should retry on timeout errors', async () => {
      mockedAxios.post
        .mockRejectedValueOnce(new Error('timeout of 5000ms exceeded'))
        .mockResolvedValueOnce({ data: { signature: validSignature } });

      const signer = new LitSigner(defaultConfig, logger);
      const result = await signer.sign(defaultPayload);

      expect(result.signature).toBe(validSignature);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should fast-fail when circuit breaker is open', async () => {
      const storage = new InMemoryCircuitBreakerStorage();
      const cb = new CircuitBreaker(
        { provider: 'lit', threshold: 1, cooldownMs: 60000 },
        storage,
        logger,
      );

      mockedAxios.post.mockRejectedValueOnce(new Error('timeout'));

      const signer = new LitSigner(defaultConfig, logger, cb);
      await expect(signer.sign(defaultPayload)).rejects.toThrow();

      // Second call should fast-fail
      await expect(signer.sign(defaultPayload)).rejects.toThrow(CircuitBreakerOpenError);
    });
  });

  describe('serializeAndHash', () => {
    it('should return a hex string', () => {
      const signer = new LitSigner(defaultConfig, logger);
      const hash = signer.serializeAndHash(defaultPayload);

      expect(hash).toMatch(/^0x[a-fA-F0-9]+$/);
    });
  });

  describe('name', () => {
    it('should return Lit', () => {
      const signer = new LitSigner(defaultConfig, logger);
      expect(signer.name).toBe('Lit');
    });
  });
});
