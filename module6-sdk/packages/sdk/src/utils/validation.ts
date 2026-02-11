import { z } from 'zod';

export const bytes32Schema = z.string().regex(
  /^0x[a-fA-F0-9]{64}$/,
  'Must be a valid bytes32 hex string (0x + 64 hex chars)',
);

export const addressSchema = z.string().regex(
  /^0x[a-fA-F0-9]{40}$/,
  'Must be a valid Ethereum address (0x + 40 hex chars)',
);

export function validateBytes32(value: string, fieldName = 'value'): string {
  const result = bytes32Schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${fieldName}: ${result.error.issues[0].message}`);
  }
  return result.data;
}

export function validateAddress(value: string, fieldName = 'address'): string {
  const result = addressSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${fieldName}: ${result.error.issues[0].message}`);
  }
  return result.data;
}
