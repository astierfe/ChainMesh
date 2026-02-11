/**
 * environment.ts - Environment configuration with Zod validation
 *
 * Loads .env with dotenv and validates all required environment variables
 * using Zod schemas. Exports a strongly-typed config object.
 */

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  // Database
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_DB: z.string().min(1).default('chainmesh_n8n'),
  POSTGRES_USER: z.string().min(1).default('chainmesh'),
  POSTGRES_PASSWORD: z.string().min(1),

  // Blockchain Providers
  ALCHEMY_API_KEY: z.string().min(1).default('your_alchemy_key_here'),
  SEPOLIA_RPC: z.string().url().default('https://eth-sepolia.g.alchemy.com/v2/demo'),
  ARBITRUM_RPC: z.string().url().default('https://arb-sepolia.g.alchemy.com/v2/demo'),
  BASE_RPC: z.string().url().default('https://base-sepolia.g.alchemy.com/v2/demo'),

  // Smart Contracts
  ORACLE_ADDRESS_SEPOLIA: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  CACHE_ADDRESS_ARBITRUM: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),
  CACHE_ADDRESS_BASE: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x0000000000000000000000000000000000000000'),

  // Claude API
  CLAUDE_API_KEY: z.string().min(1).default('sk-ant-not-configured'),

  // Goldsky
  GOLDSKY_ENDPOINT: z.string().min(1).default('not_configured_yet'),

  // Lit Protocol
  LIT_PKP_PUBLIC_KEY: z.string().min(1).default('not_configured_yet'),

  // n8n
  N8N_HOST: z.string().min(1).default('localhost'),
  N8N_PORT: z.coerce.number().int().positive().default(5678),
  N8N_PROTOCOL: z.enum(['http', 'https']).default('http'),
  N8N_WEBHOOK_URL: z.string().url().default('http://localhost:5678/webhook'),

  // Application
  ENVIRONMENT: z.enum(['testnet', 'production']).default('testnet'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // CCIP
  CCIP_ROUTER_SEPOLIA: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0xD0daae2231E9CB96b94C8512223533293C3693Bf'),
  CCIP_ROUTER_ARBITRUM_SEPOLIA: z.string().regex(/^0x[a-fA-F0-9]{40}$/).default('0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165'),
  CHAIN_SELECTOR_SEPOLIA: z.string().min(1).default('16015286601757825753'),
  CHAIN_SELECTOR_ARBITRUM_SEPOLIA: z.string().min(1).default('3478487238524512106'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Parse and validate environment variables. Throws on invalid config. */
export function loadConfig(overrides?: Record<string, string | undefined>): EnvConfig {
  const source = overrides ?? process.env;
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}

/** Structured config derived from validated env vars */
export interface AppConfig {
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  blockchain: {
    rpcEndpoints: Record<string, string>;
    contractAddresses: {
      oracleSepolia: string;
      cacheArbitrum: string;
      cacheBase: string;
    };
    ccipRouters: Record<string, string>;
    chainSelectors: Record<string, string>;
  };
  apiKeys: {
    alchemy: string;
    claude: string;
    goldsky: string;
    litProtocol: string;
  };
  n8n: {
    host: string;
    port: number;
    protocol: string;
    webhookUrl: string;
  };
  app: {
    environment: string;
    logLevel: string;
    nodeEnv: string;
    port: number;
  };
}

/** Build a structured AppConfig from validated environment variables */
export function buildAppConfig(env: EnvConfig): AppConfig {
  return {
    database: {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
    },
    blockchain: {
      rpcEndpoints: {
        sepolia: env.SEPOLIA_RPC,
        arbitrum: env.ARBITRUM_RPC,
        base: env.BASE_RPC,
      },
      contractAddresses: {
        oracleSepolia: env.ORACLE_ADDRESS_SEPOLIA,
        cacheArbitrum: env.CACHE_ADDRESS_ARBITRUM,
        cacheBase: env.CACHE_ADDRESS_BASE,
      },
      ccipRouters: {
        sepolia: env.CCIP_ROUTER_SEPOLIA,
        arbitrumSepolia: env.CCIP_ROUTER_ARBITRUM_SEPOLIA,
      },
      chainSelectors: {
        sepolia: env.CHAIN_SELECTOR_SEPOLIA,
        arbitrumSepolia: env.CHAIN_SELECTOR_ARBITRUM_SEPOLIA,
      },
    },
    apiKeys: {
      alchemy: env.ALCHEMY_API_KEY,
      claude: env.CLAUDE_API_KEY,
      goldsky: env.GOLDSKY_ENDPOINT,
      litProtocol: env.LIT_PKP_PUBLIC_KEY,
    },
    n8n: {
      host: env.N8N_HOST,
      port: env.N8N_PORT,
      protocol: env.N8N_PROTOCOL,
      webhookUrl: env.N8N_WEBHOOK_URL,
    },
    app: {
      environment: env.ENVIRONMENT,
      logLevel: env.LOG_LEVEL,
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
    },
  };
}

/** Load, validate, and structure the full application config */
export function getAppConfig(overrides?: Record<string, string | undefined>): AppConfig {
  return buildAppConfig(loadConfig(overrides));
}
