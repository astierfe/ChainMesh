import { ethers } from 'ethers';
import axios from 'axios';
import {
  type ChainMeshConfig,
  type GetDataResult,
  type RequestDataResult,
  type OracleDataResult,
  type QueryRequest,
  type QueryResult,
  type ReputationGetResult,
  type PriceGetResult,
  ConfigError,
  ContractError,
  ApiError,
  chainMeshConfigSchema,
} from './types.js';
import { GENERIC_CACHE_ABI, GENERIC_ORACLE_ABI } from './contracts/abis.js';
import { ReputationAdapter } from './adapters/ReputationAdapter.js';
import { PriceAdapter } from './adapters/PriceAdapter.js';

/**
 * ChainMeshSDK - Developer-facing interface for ChainMesh infrastructure.
 *
 * Three access strategies:
 * 1. Cache-first (on-chain): getData() reads from GenericCache contracts.
 * 2. API-first (off-chain): query() calls the orchestration API Gateway.
 * 3. Hybrid: read cache first, trigger API if data is stale.
 */
export class ChainMeshSDK {
  private readonly config: ChainMeshConfig;
  private readonly providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private readonly cacheContracts: Map<string, ethers.Contract> = new Map();
  private oracleContract: ethers.Contract | null = null;

  readonly adapters: {
    readonly reputation: ReputationAdapter;
    readonly price: PriceAdapter;
  };

  readonly reputation: ReputationAccessor;
  readonly price: PriceAccessor;

  constructor(config: ChainMeshConfig) {
    const parsed = chainMeshConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ConfigError('Invalid ChainMesh configuration', {
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    this.config = parsed.data;

    if (this.config.defaultChain && !this.config.chains[this.config.defaultChain]) {
      throw new ConfigError(
        `Default chain "${this.config.defaultChain}" is not configured in chains`,
      );
    }

    this.adapters = {
      reputation: new ReputationAdapter(),
      price: new PriceAdapter(),
    };

    this.reputation = new ReputationAccessor(this, this.adapters.reputation);
    this.price = new PriceAccessor(this, this.adapters.price);
  }

  // ========== Generic Methods ==========

  /**
   * Read data from GenericCache on-chain (cache-first strategy).
   * Free (view function), but data may be stale (up to 24h TTL).
   */
  async getData(key: string, chain?: string): Promise<GetDataResult> {
    const contract = this.getCacheContract(chain);
    try {
      const [value, isFromCache, needsUpdate] = await contract.getData(key);
      return {
        value: value as string,
        isFromCache: isFromCache as boolean,
        needsUpdate: needsUpdate as boolean,
      };
    } catch (error) {
      throw new ContractError(`Failed to read data from cache`, {
        key,
        chain: this.resolveChain(chain),
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Request fresh data via CCIP (triggers on-chain request).
   * Costs ETH for CCIP fees.
   */
  async requestData(
    key: string,
    schemaHash: string,
    chain?: string,
    overrides?: { value?: bigint },
  ): Promise<RequestDataResult> {
    const contract = this.getCacheContract(chain);
    try {
      const tx = await contract.requestData(key, schemaHash, {
        value: overrides?.value ?? 0n,
      });
      const receipt = await tx.wait();

      const event = receipt.logs
        .map((log: ethers.Log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(
          (parsed: ethers.LogDescription | null) => parsed?.name === 'DataQueried',
        );

      return {
        messageId: event ? (event.args[3] as string) : ethers.ZeroHash,
      };
    } catch (error) {
      throw new ContractError(`Failed to request data via CCIP`, {
        key,
        schemaHash,
        chain: this.resolveChain(chain),
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Query the API Gateway (off-chain, API-first strategy).
   * Runs the full pipeline: fetch + analyze + sign + oracle update.
   */
  async query(request: QueryRequest): Promise<QueryResult> {
    if (!this.config.apiGateway) {
      throw new ConfigError('API Gateway is not configured');
    }

    try {
      const response = await axios.post<QueryResult>(
        `${this.config.apiGateway.url}/api/query`,
        {
          key: request.key,
          schemaHash: request.schemaHash,
          chains: request.chains,
          includeAnalysis: request.includeAnalysis ?? true,
          options: request.options,
        },
        { timeout: request.options?.timeoutMs ?? 180000 },
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        throw new ApiError(`API Gateway returned ${error.response.status}`, {
          status: error.response.status,
          data: error.response.data as Record<string, unknown>,
        });
      }
      throw new ApiError('Failed to reach API Gateway', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Read data directly from GenericOracle on Sepolia (read-only).
   */
  async getOracleData(key: string): Promise<OracleDataResult> {
    const contract = this.getOracleContract();
    try {
      const [value, timestamp, schemaHash, isValid] = await contract.getData(key);
      return {
        value: value as string,
        timestamp: Number(timestamp),
        schemaHash: schemaHash as string,
        isValid: isValid as boolean,
      };
    } catch (error) {
      throw new ContractError('Failed to read data from oracle', {
        key,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ========== Internal Helpers ==========

  private resolveChain(chain?: string): string {
    if (chain) return chain;
    if (this.config.defaultChain) return this.config.defaultChain;
    const chains = Object.keys(this.config.chains);
    if (chains.length === 1) return chains[0];
    throw new ConfigError(
      'No chain specified and no defaultChain configured. Available chains: ' +
        chains.join(', '),
    );
  }

  private getProvider(chain: string): ethers.JsonRpcProvider {
    const resolved = this.resolveChain(chain);
    let provider = this.providers.get(resolved);
    if (!provider) {
      const chainConfig = this.config.chains[resolved];
      if (!chainConfig) {
        throw new ConfigError(`Chain "${resolved}" is not configured`);
      }
      provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
      this.providers.set(resolved, provider);
    }
    return provider;
  }

  private getCacheContract(chain?: string): ethers.Contract {
    const resolved = this.resolveChain(chain);
    let contract = this.cacheContracts.get(resolved);
    if (!contract) {
      const chainConfig = this.config.chains[resolved];
      if (!chainConfig) {
        throw new ConfigError(`Chain "${resolved}" is not configured`);
      }
      const provider = this.getProvider(resolved);
      contract = new ethers.Contract(
        chainConfig.cacheAddress,
        GENERIC_CACHE_ABI,
        provider,
      );
      this.cacheContracts.set(resolved, contract);
    }
    return contract;
  }

  private getOracleContract(): ethers.Contract {
    if (!this.oracleContract) {
      if (!this.config.oracle) {
        throw new ConfigError('Oracle is not configured');
      }
      const provider = new ethers.JsonRpcProvider(this.config.oracle.rpcUrl);
      this.oracleContract = new ethers.Contract(
        this.config.oracle.address,
        GENERIC_ORACLE_ABI,
        provider,
      );
    }
    return this.oracleContract;
  }
}

/**
 * Convenience accessor for reputation data.
 * Combines generic SDK methods with the ReputationAdapter.
 */
class ReputationAccessor {
  constructor(
    private readonly sdk: ChainMeshSDK,
    private readonly adapter: ReputationAdapter,
  ) {}

  /** Get reputation for a wallet (cache-first). */
  async get(walletAddress: string, chain?: string): Promise<ReputationGetResult> {
    const key = this.adapter.getKey(walletAddress);
    const result = await this.sdk.getData(key, chain);

    if (!result.isFromCache && (!result.value || result.value === '0x')) {
      const defaultVal = this.adapter.getDefaultValue();
      return { ...defaultVal, isFromCache: false, needsUpdate: true };
    }

    const decoded = this.adapter.decode(result.value);
    return {
      ...decoded,
      isFromCache: result.isFromCache,
      needsUpdate: result.needsUpdate,
    };
  }

  /** Request fresh reputation data via CCIP. */
  async request(
    walletAddress: string,
    chain?: string,
    overrides?: { value?: bigint },
  ): Promise<{ messageId: string }> {
    const key = this.adapter.getKey(walletAddress);
    return this.sdk.requestData(key, this.adapter.schemaHash, chain, overrides);
  }
}

/**
 * Convenience accessor for price data.
 * Combines generic SDK methods with the PriceAdapter.
 */
class PriceAccessor {
  constructor(
    private readonly sdk: ChainMeshSDK,
    private readonly adapter: PriceAdapter,
  ) {}

  /** Get price for a symbol (cache-first). */
  async get(symbol: string, chain?: string): Promise<PriceGetResult> {
    const key = this.adapter.getKey(symbol);
    const result = await this.sdk.getData(key, chain);

    if (!result.isFromCache && (!result.value || result.value === '0x')) {
      const defaultVal = this.adapter.getDefaultValue();
      return { ...defaultVal, isFromCache: false, needsUpdate: true };
    }

    const decoded = this.adapter.decode(result.value);
    return {
      ...decoded,
      isFromCache: result.isFromCache,
      needsUpdate: result.needsUpdate,
    };
  }

  /** Request fresh price data via CCIP. */
  async request(
    symbol: string,
    chain?: string,
    overrides?: { value?: bigint },
  ): Promise<{ messageId: string }> {
    const key = this.adapter.getKey(symbol);
    return this.sdk.requestData(key, this.adapter.schemaHash, chain, overrides);
  }
}
