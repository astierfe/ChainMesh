/**
 * SignerFactory.ts - Factory for creating signers
 *
 * Selects Lit Protocol (production) or DevWallet (testnet fallback).
 * Manages circuit breaker for Lit Protocol resilience.
 */

import { Logger } from '../utils/Logger';
import {
  CircuitBreaker,
  InMemoryCircuitBreakerStorage,
} from '../utils/CircuitBreaker';
import type { CircuitBreakerStorage } from '../utils/CircuitBreaker';
import { LitSigner } from './LitSigner';
import type { SignPayload as LitSignPayload } from './LitSigner';
import { DevWalletSigner } from './DevWalletSigner';
import type { SignPayload as DevSignPayload } from './DevWalletSigner';
import type { SignerOutput } from '../validators/outputValidator';
import type { AppConfig } from '../config/environment';

export interface SignerFactoryConfig {
  lit: {
    pkpPublicKey: string;
    litActionEndpoint: string;
    timeoutMs: number;
  };
  devWallet: {
    privateKey: string;
  };
  environment: string;
  circuitBreaker: {
    threshold: number;
    cooldownMs: number;
  };
}

export type SignPayload = LitSignPayload & DevSignPayload;

export interface Signer {
  sign(payload: SignPayload): Promise<SignerOutput>;
  name: string;
}

export class SignerFactory {
  private logger: Logger;
  private config: SignerFactoryConfig;
  private litSigner: LitSigner | null;
  private devWalletSigner: DevWalletSigner | null;

  constructor(
    config: SignerFactoryConfig,
    logger: Logger,
    storage?: CircuitBreakerStorage,
  ) {
    this.config = config;
    this.logger = logger;

    const cbStorage = storage ?? new InMemoryCircuitBreakerStorage();

    const litCB = new CircuitBreaker(
      {
        provider: 'lit_protocol',
        threshold: config.circuitBreaker.threshold,
        cooldownMs: config.circuitBreaker.cooldownMs,
      },
      cbStorage,
      logger,
    );

    this.litSigner = new LitSigner(config.lit, logger, litCB);

    if (config.environment !== 'production') {
      this.devWalletSigner = new DevWalletSigner(
        { privateKey: config.devWallet.privateKey, environment: config.environment },
        logger,
      );
    } else {
      this.devWalletSigner = null;
    }
  }

  /** Get the primary signer (Lit Protocol) */
  getPrimary(): LitSigner | null {
    return this.litSigner;
  }

  /** Get the fallback signer (DevWallet, testnet only) */
  getFallback(): DevWalletSigner | null {
    return this.devWalletSigner;
  }

  /**
   * Sign with automatic fallback: Lit → DevWallet (testnet only)
   * In production, Lit failure is fatal.
   */
  async signWithFallback(payload: SignPayload): Promise<SignerOutput> {
    try {
      return await this.litSigner!.sign(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!this.devWalletSigner) {
        this.logger.error('Lit Protocol failed and no fallback available (production)', {
          event: 'SIGNER_FATAL_ERROR',
          error: message,
        });
        throw error;
      }

      this.logger.warn('Lit Protocol failed, falling back to DevWallet', {
        event: 'SIGNER_FALLBACK',
        primarySigner: 'Lit',
        fallbackSigner: 'DevWallet',
        error: message,
      });

      return await this.devWalletSigner.sign(payload);
    }
  }

  /** Create a SignerFactory from application config */
  static fromAppConfig(
    appConfig: AppConfig,
    logger: Logger,
    devPrivateKey: string,
    storage?: CircuitBreakerStorage,
  ): SignerFactory {
    return new SignerFactory(
      {
        lit: {
          pkpPublicKey: appConfig.apiKeys.litProtocol,
          litActionEndpoint: 'https://serrano.litgateway.com/api/v1/execute',
          timeoutMs: 5000,
        },
        devWallet: {
          privateKey: devPrivateKey,
        },
        environment: appConfig.app.environment,
        circuitBreaker: {
          threshold: 3,
          cooldownMs: 60000,
        },
      },
      logger,
      storage,
    );
  }
}
