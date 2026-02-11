/**
 * inputValidator.ts - Zod schemas for all input validation
 *
 * Validates: schemaHash, key, chains, CCIP payloads, query requests
 */

import { z } from 'zod';

/** bytes32 hex string: 0x followed by 64 hex chars */
export const bytes32Schema = z.string().regex(
  /^0x[a-fA-F0-9]{64}$/,
  'Must be a valid bytes32 hex string (0x + 64 hex chars)',
);

/** Ethereum address: 0x followed by 40 hex chars */
export const addressSchema = z.string().regex(
  /^0x[a-fA-F0-9]{40}$/,
  'Must be a valid Ethereum address (0x + 40 hex chars)',
);

/** Supported chain identifiers */
export const SUPPORTED_CHAINS = ['sepolia', 'arbitrum', 'base', 'optimism'] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export const chainSchema = z.enum(SUPPORTED_CHAINS);

/** Query request options */
export const queryOptionsSchema = z.object({
  timeoutMs: z.number().int().min(10000).max(300000).default(180000),
  fallbackProviders: z.boolean().default(true),
  customConfig: z.record(z.string(), z.unknown()).optional(),
}).optional();

/** CCIP metadata */
export const metadataSchema = z.object({
  messageId: bytes32Schema.optional(),
  sourceChain: z.string().min(1).optional(),
  requester: addressSchema.optional(),
}).optional();

/** Main query request schema (GenericQueryRequest) */
export const genericQueryRequestSchema = z.object({
  key: bytes32Schema,
  schemaHash: bytes32Schema,
  chains: z.array(chainSchema).min(1, 'At least one chain is required'),
  includeAnalysis: z.boolean().default(true),
  options: queryOptionsSchema,
  metadata: metadataSchema,
});

export type GenericQueryRequest = z.infer<typeof genericQueryRequestSchema>;

/** Validate a generic query request */
export function validateQueryRequest(input: unknown): GenericQueryRequest {
  return genericQueryRequestSchema.parse(input);
}

/** Safely validate a generic query request (returns result instead of throwing) */
export function safeValidateQueryRequest(input: unknown): {
  success: true;
  data: GenericQueryRequest;
} | {
  success: false;
  errors: Array<{ path: string; message: string }>;
} {
  const result = genericQueryRequestSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
  };
}

/** Validate a bytes32 value */
export function validateBytes32(value: unknown, fieldName = 'value'): string {
  const result = bytes32Schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${fieldName}: ${result.error.issues[0].message}`);
  }
  return result.data;
}

/** Validate an Ethereum address */
export function validateAddress(value: unknown, fieldName = 'address'): string {
  const result = addressSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${fieldName}: ${result.error.issues[0].message}`);
  }
  return result.data;
}
