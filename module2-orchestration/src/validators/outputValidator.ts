/**
 * outputValidator.ts - Validation for provider and analyzer outputs
 *
 * Validates and normalizes outputs from data providers (Goldsky, Alchemy)
 * and analyzers (Claude, Rules).
 */

import { z } from 'zod';

/** Data provider output metadata */
export const providerMetadataSchema = z.object({
  chains: z.array(z.string()).min(1),
  timestamp: z.string().datetime(),
  provider: z.string().min(1),
  queryDuration: z.number().nonnegative(),
  partialData: z.boolean().optional(),
  successRate: z.number().min(0).max(1).optional(),
  warnings: z.array(z.string()).optional(),
});

/** Data provider output schema */
export const dataProviderOutputSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  metadata: providerMetadataSchema,
});

export type DataProviderOutput = z.infer<typeof dataProviderOutputSchema>;

/** Analyzer output metadata */
export const analyzerMetadataSchema = z.object({
  model: z.string().optional(),
  method: z.string().optional(),
  processingTime: z.number().nonnegative(),
  tokensUsed: z.number().int().nonnegative().optional(),
});

/** Analyzer output schema */
export const analyzerOutputSchema = z.object({
  result: z.unknown(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  metadata: analyzerMetadataSchema,
});

export type AnalyzerOutput = z.infer<typeof analyzerOutputSchema>;

/** Signature format: 0x followed by 130 hex chars (65 bytes) */
export const signatureSchema = z.string().regex(
  /^0x[a-fA-F0-9]{130}$/,
  'Must be a valid signature (0x + 130 hex chars)',
);

/** Signer output schema */
export const signerOutputSchema = z.object({
  signature: signatureSchema,
  signingTime: z.number().nonnegative(),
  pkpPublicKey: z.string().min(1),
});

export type SignerOutput = z.infer<typeof signerOutputSchema>;

/** Validate data provider output */
export function validateProviderOutput(output: unknown): DataProviderOutput {
  return dataProviderOutputSchema.parse(output);
}

/** Validate analyzer output */
export function validateAnalyzerOutput(output: unknown): AnalyzerOutput {
  return analyzerOutputSchema.parse(output);
}

/** Validate signer output */
export function validateSignerOutput(output: unknown): SignerOutput {
  return signerOutputSchema.parse(output);
}

/** Safe validation for provider output */
export function safeValidateProviderOutput(output: unknown): {
  success: true;
  data: DataProviderOutput;
} | {
  success: false;
  errors: Array<{ path: string; message: string }>;
} {
  const result = dataProviderOutputSchema.safeParse(output);
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

/** Safe validation for analyzer output */
export function safeValidateAnalyzerOutput(output: unknown): {
  success: true;
  data: AnalyzerOutput;
} | {
  success: false;
  errors: Array<{ path: string; message: string }>;
} {
  const result = analyzerOutputSchema.safeParse(output);
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

/** Normalize a timestamp to ISO 8601 format */
export function normalizeTimestamp(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${String(value)}`);
  }
  return date.toISOString();
}

/** Normalize an Ethereum address to checksum format (lowercase for now) */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
