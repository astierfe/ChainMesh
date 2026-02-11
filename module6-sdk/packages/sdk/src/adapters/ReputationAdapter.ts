import { ethers } from 'ethers';
import type { ReputationData } from '../types.js';

/**
 * TypeScript mirror of the on-chain ReputationAdapter.
 * Provides key derivation and ABI encoding/decoding for reputation data.
 *
 * Schema: ReputationV1 = (uint8 score, bytes32 evidenceHash)
 * Key:    keccak256(abi.encodePacked(wallet, "reputation"))
 */
export class ReputationAdapter {
  static readonly SCHEMA_HASH = ethers.keccak256(ethers.toUtf8Bytes('ReputationV1'));
  static readonly DEFAULT_SCORE = 60;

  readonly schemaHash = ReputationAdapter.SCHEMA_HASH;

  /** Derive the bytes32 key for a wallet's reputation (mirrors Solidity getKey). */
  getKey(walletAddress: string): string {
    const packed = ethers.solidityPacked(
      ['address', 'string'],
      [walletAddress, 'reputation'],
    );
    return ethers.keccak256(packed);
  }

  /** ABI-encode reputation data (mirrors Solidity abi.encode(uint8, bytes32)). */
  encode(score: number, evidenceHash: string): string {
    if (score < 0 || score > 100) {
      throw new Error(`Invalid score: must be 0-100, got ${score}`);
    }
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint8', 'bytes32'],
      [score, evidenceHash],
    );
  }

  /** ABI-decode raw bytes into reputation data. */
  decode(rawBytes: string): ReputationData {
    const [score, evidenceHash] = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint8', 'bytes32'],
      rawBytes,
    );
    return {
      score: Number(score),
      evidenceHash: evidenceHash as string,
    };
  }

  /** Returns the default value (score 60, empty evidence). */
  getDefaultValue(): ReputationData {
    return {
      score: ReputationAdapter.DEFAULT_SCORE,
      evidenceHash: ethers.ZeroHash,
    };
  }
}
