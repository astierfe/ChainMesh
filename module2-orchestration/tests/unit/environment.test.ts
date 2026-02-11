import { describe, it, expect } from 'vitest';
import { loadConfig, buildAppConfig, getAppConfig } from '../../src/config/environment';

const VALID_ENV: Record<string, string> = {
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'chainmesh_n8n',
  POSTGRES_USER: 'chainmesh',
  POSTGRES_PASSWORD: 'secret',
  ALCHEMY_API_KEY: 'test_key',
  SEPOLIA_RPC: 'https://eth-sepolia.g.alchemy.com/v2/test',
  ARBITRUM_RPC: 'https://arb-sepolia.g.alchemy.com/v2/test',
  BASE_RPC: 'https://base-sepolia.g.alchemy.com/v2/test',
  ORACLE_ADDRESS_SEPOLIA: '0x0000000000000000000000000000000000000001',
  CACHE_ADDRESS_ARBITRUM: '0x0000000000000000000000000000000000000002',
  CACHE_ADDRESS_BASE: '0x0000000000000000000000000000000000000003',
  CLAUDE_API_KEY: 'sk-ant-test',
  GOLDSKY_ENDPOINT: 'https://goldsky.test',
  LIT_PKP_PUBLIC_KEY: '0x04abcdef',
  N8N_HOST: 'localhost',
  N8N_PORT: '5678',
  N8N_PROTOCOL: 'http',
  N8N_WEBHOOK_URL: 'http://localhost:5678/webhook',
  ENVIRONMENT: 'testnet',
  LOG_LEVEL: 'info',
  NODE_ENV: 'development',
  PORT: '3000',
  CCIP_ROUTER_SEPOLIA: '0xD0daae2231E9CB96b94C8512223533293C3693Bf',
  CCIP_ROUTER_ARBITRUM_SEPOLIA: '0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165',
  CHAIN_SELECTOR_SEPOLIA: '16015286601757825753',
  CHAIN_SELECTOR_ARBITRUM_SEPOLIA: '3478487238524512106',
};

describe('environment', () => {
  describe('loadConfig', () => {
    it('should parse valid environment variables', () => {
      const config = loadConfig(VALID_ENV);
      expect(config.POSTGRES_HOST).toBe('localhost');
      expect(config.POSTGRES_PORT).toBe(5432);
      expect(config.PORT).toBe(3000);
      expect(config.ENVIRONMENT).toBe('testnet');
      expect(config.LOG_LEVEL).toBe('info');
    });

    it('should coerce string numbers to actual numbers', () => {
      const config = loadConfig(VALID_ENV);
      expect(typeof config.POSTGRES_PORT).toBe('number');
      expect(typeof config.N8N_PORT).toBe('number');
      expect(typeof config.PORT).toBe('number');
    });

    it('should throw on missing required fields', () => {
      expect(() => loadConfig({ POSTGRES_HOST: 'localhost' })).toThrow(
        'Invalid environment configuration',
      );
    });

    it('should throw on invalid ENVIRONMENT value', () => {
      expect(() =>
        loadConfig({ ...VALID_ENV, ENVIRONMENT: 'staging' }),
      ).toThrow('Invalid environment configuration');
    });

    it('should throw on invalid LOG_LEVEL value', () => {
      expect(() =>
        loadConfig({ ...VALID_ENV, LOG_LEVEL: 'trace' }),
      ).toThrow('Invalid environment configuration');
    });

    it('should throw on invalid address format', () => {
      expect(() =>
        loadConfig({ ...VALID_ENV, ORACLE_ADDRESS_SEPOLIA: 'not_an_address' }),
      ).toThrow('Invalid environment configuration');
    });

    it('should throw on invalid URL format for RPC', () => {
      expect(() =>
        loadConfig({ ...VALID_ENV, SEPOLIA_RPC: 'not_a_url' }),
      ).toThrow('Invalid environment configuration');
    });

    it('should accept production environment', () => {
      const config = loadConfig({ ...VALID_ENV, ENVIRONMENT: 'production' });
      expect(config.ENVIRONMENT).toBe('production');
    });

    it('should accept all valid log levels', () => {
      for (const level of ['error', 'warn', 'info', 'debug']) {
        const config = loadConfig({ ...VALID_ENV, LOG_LEVEL: level });
        expect(config.LOG_LEVEL).toBe(level);
      }
    });
  });

  describe('buildAppConfig', () => {
    it('should structure config into logical groups', () => {
      const env = loadConfig(VALID_ENV);
      const config = buildAppConfig(env);

      expect(config.database.host).toBe('localhost');
      expect(config.database.port).toBe(5432);
      expect(config.database.database).toBe('chainmesh_n8n');

      expect(config.blockchain.rpcEndpoints.sepolia).toContain('eth-sepolia');
      expect(config.blockchain.contractAddresses.oracleSepolia).toMatch(/^0x/);

      expect(config.apiKeys.alchemy).toBe('test_key');
      expect(config.apiKeys.claude).toBe('sk-ant-test');

      expect(config.n8n.host).toBe('localhost');
      expect(config.n8n.port).toBe(5678);
      expect(config.n8n.protocol).toBe('http');

      expect(config.app.environment).toBe('testnet');
      expect(config.app.port).toBe(3000);
    });

    it('should include all chain RPC endpoints', () => {
      const env = loadConfig(VALID_ENV);
      const config = buildAppConfig(env);

      expect(config.blockchain.rpcEndpoints).toHaveProperty('sepolia');
      expect(config.blockchain.rpcEndpoints).toHaveProperty('arbitrum');
      expect(config.blockchain.rpcEndpoints).toHaveProperty('base');
    });

    it('should include CCIP configuration', () => {
      const env = loadConfig(VALID_ENV);
      const config = buildAppConfig(env);

      expect(config.blockchain.ccipRouters.sepolia).toMatch(/^0x/);
      expect(config.blockchain.chainSelectors.sepolia).toBe('16015286601757825753');
    });
  });

  describe('getAppConfig', () => {
    it('should return a fully structured config', () => {
      const config = getAppConfig(VALID_ENV);
      expect(config.database).toBeDefined();
      expect(config.blockchain).toBeDefined();
      expect(config.apiKeys).toBeDefined();
      expect(config.n8n).toBeDefined();
      expect(config.app).toBeDefined();
    });
  });
});
