import { z } from 'zod';

// ========== Configuration ==========

export interface ChainConfig {
  rpcUrl: string;
  cacheAddress: string;
  chainSelector?: string;
}

export interface OracleConfig {
  rpcUrl: string;
  address: string;
}

export interface ApiGatewayConfig {
  url: string;
}

export interface ChainMeshConfig {
  chains: Record<string, ChainConfig>;
  oracle?: OracleConfig;
  apiGateway?: ApiGatewayConfig;
  defaultChain?: string;
}

// ========== Zod Validation Schemas ==========

export const chainConfigSchema = z.object({
  rpcUrl: z.string().url(),
  cacheAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  chainSelector: z.string().optional(),
});

export const oracleConfigSchema = z.object({
  rpcUrl: z.string().url(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
});

export const apiGatewayConfigSchema = z.object({
  url: z.string().url(),
});

export const chainMeshConfigSchema = z.object({
  chains: z.record(z.string(), chainConfigSchema),
  oracle: oracleConfigSchema.optional(),
  apiGateway: apiGatewayConfigSchema.optional(),
  defaultChain: z.string().optional(),
});

// ========== On-Chain Results ==========

export interface GetDataResult {
  value: string;
  isFromCache: boolean;
  needsUpdate: boolean;
}

export interface RequestDataResult {
  messageId: string;
}

export interface OracleDataResult {
  value: string;
  timestamp: number;
  schemaHash: string;
  isValid: boolean;
}

// ========== API Gateway ==========

export interface QueryRequest {
  key: string;
  schemaHash: string;
  chains: string[];
  includeAnalysis?: boolean;
  options?: {
    timeoutMs?: number;
    fallbackProviders?: boolean;
  };
}

export interface QueryResult {
  executionId: string;
  status: 'success' | 'error';
  result?: {
    data: Record<string, unknown>;
    analysis?: {
      result: unknown;
      confidence: number;
      reasoning: string;
    };
    signature?: {
      signature: string;
      pkpPublicKey: string;
    };
  };
  error?: {
    type: string;
    message: string;
  };
}

// ========== Adapter Types ==========

export interface ReputationData {
  score: number;
  evidenceHash: string;
}

export interface PriceData {
  value: bigint;
  decimals: number;
}

export interface ReputationGetResult extends ReputationData {
  isFromCache: boolean;
  needsUpdate: boolean;
}

export interface PriceGetResult extends PriceData {
  isFromCache: boolean;
  needsUpdate: boolean;
}

// ========== Adapter Interface ==========

export interface DataAdapter<TKey, TDecoded> {
  schemaHash: string;
  getKey(input: TKey): string;
  encode(...args: unknown[]): string;
  decode(rawBytes: string): TDecoded;
}

// ========== Errors ==========

export class ChainMeshError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ChainMeshError';
  }
}

export class ConfigError extends ChainMeshError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

export class ContractError extends ChainMeshError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONTRACT_ERROR', details);
    this.name = 'ContractError';
  }
}

export class ApiError extends ChainMeshError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'API_ERROR', details);
    this.name = 'ApiError';
  }
}
