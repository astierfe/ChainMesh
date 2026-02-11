/**
 * LitSigner.ts - MPC signing via Lit Protocol PKP
 *
 * Serializes payload (ABI encode), hashes it, and sends to
 * Lit Protocol for distributed MPC signing.
 * Validates returned signature format.
 */

import axios from 'axios';
import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import { CircuitBreaker } from '../utils/CircuitBreaker';
import { RetryPolicy } from '../utils/RetryPolicy';
import type { SignerOutput } from '../validators/outputValidator';

export interface LitSignerConfig {
  pkpPublicKey: string;
  litActionEndpoint: string;
  timeoutMs: number;
}

export interface SignPayload {
  key: string;
  value: string;
  schemaHash: string;
  timestamp: number;
}

export class LitSigner {
  private config: LitSignerConfig;
  private logger: Logger;
  private retryPolicy: RetryPolicy;

  constructor(
    config: LitSignerConfig,
    logger: Logger,
    circuitBreaker?: CircuitBreaker,
  ) {
    this.config = config;
    this.logger = logger;
    this.retryPolicy = new RetryPolicy(
      logger,
      { maxRetries: 2, initialDelayMs: 500, multiplier: 2, maxDelayMs: 5000 },
      circuitBreaker,
    );
  }

  async sign(payload: SignPayload): Promise<SignerOutput> {
    const startTime = Date.now();

    this.logger.info('Starting Lit Protocol signing', {
      event: 'LIT_SIGN_START',
      key: payload.key,
      schemaHash: payload.schemaHash,
    });

    const hash = this.serializeAndHash(payload);

    const signature = await this.retryPolicy.execute(
      () => this.callLitProtocol(hash),
      'lit_sign',
    );

    const signingTime = Date.now() - startTime;

    this.logger.info('Lit Protocol signing completed', {
      event: 'LIT_SIGN_SUCCESS',
      signingTime,
    });

    return {
      signature,
      signingTime,
      pkpPublicKey: this.config.pkpPublicKey,
    };
  }

  /** ABI-encode the payload and keccak256 hash it */
  serializeAndHash(payload: SignPayload): string {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes', 'bytes32', 'uint256'],
      [payload.key, payload.value, payload.schemaHash, payload.timestamp],
    );
    return ethers.keccak256(encoded);
  }

  private async callLitProtocol(hash: string): Promise<string> {
    const response = await axios.post(
      this.config.litActionEndpoint,
      {
        pkpPublicKey: this.config.pkpPublicKey,
        toSign: hash,
        sigName: 'chainmesh_sig',
      },
      {
        timeout: this.config.timeoutMs,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const signature = response.data?.signature;
    if (!signature || typeof signature !== 'string') {
      throw new Error('Invalid or missing signature from Lit Protocol');
    }

    if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) {
      throw new Error(`Invalid signature format: ${signature.slice(0, 20)}...`);
    }

    return signature;
  }

  get name(): string {
    return 'Lit';
  }
}
