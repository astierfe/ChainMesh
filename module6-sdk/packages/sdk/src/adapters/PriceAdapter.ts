import { ethers } from 'ethers';
import type { PriceData } from '../types.js';

/**
 * TypeScript mirror of the on-chain PriceAdapter.
 * Provides key derivation and ABI encoding/decoding for price data.
 *
 * Schema: PriceV1 = (uint256 value, uint8 decimals)
 * Key:    keccak256(abi.encodePacked(symbol, "price"))
 */
export class PriceAdapter {
  static readonly SCHEMA_HASH = ethers.keccak256(ethers.toUtf8Bytes('PriceV1'));
  static readonly DEFAULT_DECIMALS = 18;

  readonly schemaHash = PriceAdapter.SCHEMA_HASH;

  /** Derive the bytes32 key for a symbol's price (mirrors Solidity getKey). */
  getKey(symbol: string): string {
    const packed = ethers.solidityPacked(
      ['string', 'string'],
      [symbol, 'price'],
    );
    return ethers.keccak256(packed);
  }

  /** ABI-encode price data (mirrors Solidity abi.encode(uint256, uint8)). */
  encode(value: bigint, decimals: number): string {
    if (decimals < 0 || decimals > 255) {
      throw new Error(`Invalid decimals: must be 0-255, got ${decimals}`);
    }
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'uint8'],
      [value, decimals],
    );
  }

  /** ABI-decode raw bytes into price data. */
  decode(rawBytes: string): PriceData {
    const [value, decimals] = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'uint8'],
      rawBytes,
    );
    return {
      value: value as bigint,
      decimals: Number(decimals),
    };
  }

  /** Returns the default value (0 price, 18 decimals). */
  getDefaultValue(): PriceData {
    return {
      value: 0n,
      decimals: PriceAdapter.DEFAULT_DECIMALS,
    };
  }
}
