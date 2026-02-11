/**
 * DevWalletSigner.ts - Development wallet signer for testnet only
 *
 * Uses ethers.Wallet with a private key for local/testnet signing.
 * MUST NOT be used in production — Lit Protocol is required there.
 */

import { ethers } from 'ethers';
import { Logger } from '../utils/Logger';
import type { SignerOutput } from '../validators/outputValidator';

export interface DevWalletSignerConfig {
  privateKey: string;
  environment: string;
}

export interface SignPayload {
  key: string;
  value: string;
  schemaHash: string;
  timestamp: number;
}

export class DevWalletSigner {
  private wallet: ethers.Wallet;
  private logger: Logger;
  private environment: string;

  constructor(config: DevWalletSignerConfig, logger: Logger) {
    if (config.environment === 'production') {
      throw new Error('DevWalletSigner cannot be used in production — use Lit Protocol');
    }
    this.wallet = new ethers.Wallet(config.privateKey);
    this.logger = logger;
    this.environment = config.environment;
  }

  async sign(payload: SignPayload): Promise<SignerOutput> {
    const startTime = Date.now();

    this.logger.info('Starting dev wallet signing', {
      event: 'DEV_WALLET_SIGN_START',
      key: payload.key,
      schemaHash: payload.schemaHash,
      environment: this.environment,
    });

    const hash = this.serializeAndHash(payload);
    const signature = await this.wallet.signMessage(ethers.getBytes(hash));

    const signingTime = Date.now() - startTime;

    this.logger.info('Dev wallet signing completed', {
      event: 'DEV_WALLET_SIGN_SUCCESS',
      signingTime,
    });

    return {
      signature,
      signingTime,
      pkpPublicKey: this.wallet.address,
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

  get name(): string {
    return 'DevWallet';
  }

  get address(): string {
    return this.wallet.address;
  }
}
