/**
 * Phase 3 E2E helpers — Mock API Gateway, CCIP round-trip helper, SDK factory.
 * Uses Node built-in `http` module (no extra dependencies).
 */
import * as http from 'http';
import { ethers } from 'ethers';
import {
  createTestOrchestrator,
  createOracleContractAdapter,
  createTestQueryInput,
  createDefaultMockProviderOutput,
  type OracleContract,
  type OrchestratorResult,
  type TestOrchestratorOptions,
} from './pipeline-helpers.js';
import {
  setupAnvil,
  releaseAnvil,
  deliverCCIPResponse,
  ANVIL_RPC_URL,
  CACHE_CHAIN_SELECTOR,
  type DeployedContracts,
} from './anvil-setup.js';
import { ChainMeshSDK } from '../../src/ChainMeshSDK.js';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';

// Re-export for convenience
export {
  setupAnvil,
  releaseAnvil,
  deliverCCIPResponse,
  ANVIL_RPC_URL,
  CACHE_CHAIN_SELECTOR,
  createTestOrchestrator,
  createOracleContractAdapter,
  createTestQueryInput,
  createDefaultMockProviderOutput,
  type DeployedContracts,
  type OracleContract,
  type OrchestratorResult,
  type TestOrchestratorOptions,
};

// ---------------------------------------------------------------------------
// Mock API Gateway
// ---------------------------------------------------------------------------

/**
 * Lightweight HTTP server mimicking the n8n API Gateway.
 * Handles POST /api/query by running WorkflowOrchestrator and
 * returning a QueryResult-shaped JSON response.
 */
export class MockApiGateway {
  private server: http.Server | null = null;
  private port = 0;
  private oracleAdapter: OracleContract;
  private orchestratorOpts: TestOrchestratorOptions;

  constructor(oracleAdapter: OracleContract, orchestratorOpts: Omit<TestOrchestratorOptions, 'oracleContract'> = {}) {
    this.oracleAdapter = oracleAdapter;
    this.orchestratorOpts = orchestratorOpts;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Only accept POST /api/query
        if (req.method !== 'POST' || req.url !== '/api/query') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
          return;
        }

        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body);

          const orchestrator = await createTestOrchestrator({
            ...this.orchestratorOpts,
            oracleContract: this.oracleAdapter,
          });

          const result = await orchestrator.execute(parsed);
          const queryResult = toQueryResult(result);

          const statusCode = result.success ? 200
            : result.error?.type === 'VALIDATION_ERROR' ? 400
            : 500;

          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(queryResult));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            executionId: 'error',
            status: 'error',
            error: {
              type: 'INTERNAL_ERROR',
              message: err instanceof Error ? err.message : String(err),
            },
          }));
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

/**
 * Create a MockApiGateway configured to fail provider calls.
 */
export class MockApiGatewayWithFailingProvider extends MockApiGateway {
  constructor(oracleAdapter: OracleContract) {
    super(oracleAdapter, { providerShouldFail: true });
  }
}

// ---------------------------------------------------------------------------
// CCIP Round-Trip Helper
// ---------------------------------------------------------------------------

export interface CCIPRoundTripParams {
  contracts: DeployedContracts;
  oracleAdapter: OracleContract;
  key: string;
  schemaHash: string;
  orchestratorOpts?: Omit<TestOrchestratorOptions, 'oracleContract'>;
  queryInputOverrides?: Record<string, unknown>;
}

export interface CCIPRoundTripResult {
  messageId: string;
  pipelineResult: OrchestratorResult;
}

/**
 * Execute a full CCIP round-trip:
 * 1. Cache.requestData() → extract messageId
 * 2. Deliver CCIP message to Oracle (simulate cross-chain)
 * 3. Fund Oracle with ETH for CCIP response fees
 * 4. Run pipeline with messageId → updateData + sendResponse
 *
 * After this, caller should use deliverCCIPResponseToCache() to
 * deliver the Oracle's response to Cache, then SDK can read cached data.
 */
export async function simulateCCIPRoundTrip(
  params: CCIPRoundTripParams,
): Promise<CCIPRoundTripResult> {
  const { contracts, oracleAdapter, key, schemaHash, orchestratorOpts, queryInputOverrides } = params;

  // Step 1: Cache requests data via CCIP
  const ccipFee = ethers.parseEther('0.01');
  const tx = await contracts.cache.requestData(key, schemaHash, { value: ccipFee });
  const receipt = await tx.wait();

  // Extract messageId from DataQueried event
  const cacheInterface = contracts.cache.interface;
  const dataQueriedLog = receipt.logs.find((log: any) => {
    try { return cacheInterface.parseLog(log)?.name === 'DataQueried'; }
    catch { return false; }
  });
  if (!dataQueriedLog) throw new Error('DataQueried event not found');
  const parsedEvent = cacheInterface.parseLog(dataQueriedLog);
  const messageId = parsedEvent!.args.messageId as string;

  // Step 2: Deliver CCIP message to Oracle (simulate router delivery)
  const ccipData = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes32', 'address'],
    [key, schemaHash, contracts.cacheAddress],
  );
  const deliverTx = await contracts.router.deliverMessage(
    contracts.oracleAddress,
    messageId,
    CACHE_CHAIN_SELECTOR,
    ethers.AbiCoder.defaultAbiCoder().encode(['address'], [contracts.cacheAddress]),
    ccipData,
  );
  await deliverTx.wait();

  // Step 3: Fund Oracle with ETH for CCIP response fees
  const fundTx = await contracts.signer.sendTransaction({
    to: contracts.oracleAddress,
    value: ethers.parseEther('0.02'),
  });
  await fundTx.wait();

  // Step 4: Run pipeline with messageId
  const orchestrator = await createTestOrchestrator({
    ...orchestratorOpts,
    oracleContract: oracleAdapter,
  });
  const input = createTestQueryInput({
    key,
    schemaHash,
    metadata: {
      messageId,
      sourceChain: 'arbitrum',
      requester: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    },
    ...queryInputOverrides,
  });

  const pipelineResult = await orchestrator.execute(input);

  return { messageId, pipelineResult };
}

/**
 * After simulateCCIPRoundTrip, deliver the Oracle's response to Cache.
 * Reads the value from Oracle and delivers it via MockCCIPRouter.
 */
export async function deliverOracleResponseToCache(
  contracts: DeployedContracts,
  messageId: string,
  key: string,
  schemaHash: string,
): Promise<void> {
  // Read value from Oracle
  const [value, timestamp] = await contracts.oracle.getData(key);

  // Deliver via CCIP router → Cache
  await deliverCCIPResponse(
    contracts,
    messageId,
    key,
    value,
    Number(timestamp),
    schemaHash,
  );
}

// ---------------------------------------------------------------------------
// SDK Factory
// ---------------------------------------------------------------------------

/**
 * Create a ChainMeshSDK configured for E2E tests.
 */
export function createE2ESDK(
  contracts: DeployedContracts,
  apiGatewayUrl?: string,
): ChainMeshSDK {
  return new ChainMeshSDK({
    chains: {
      'local-anvil': {
        rpcUrl: ANVIL_RPC_URL,
        cacheAddress: contracts.cacheAddress,
      },
    },
    oracle: {
      rpcUrl: ANVIL_RPC_URL,
      address: contracts.oracleAddress,
    },
    ...(apiGatewayUrl ? { apiGateway: { url: apiGatewayUrl } } : {}),
    defaultChain: 'local-anvil',
  });
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Transform OrchestratorResult → SDK QueryResult format.
 * Mirrors what the n8n API_Gateway workflow does.
 */
function toQueryResult(result: OrchestratorResult): Record<string, unknown> {
  if (!result.success) {
    return {
      executionId: result.executionId,
      status: 'error',
      error: result.error,
    };
  }

  const queryResult: Record<string, unknown> = {
    executionId: result.executionId,
    status: 'success',
    result: {
      data: result.data?.providerOutput?.data ?? {},
      ...(result.data?.analyzerOutput ? {
        analysis: {
          result: result.data.analyzerOutput.result,
          confidence: result.data.analyzerOutput.confidence,
          reasoning: result.data.analyzerOutput.reasoning,
        },
      } : {}),
      ...(result.data?.signerOutput ? {
        signature: {
          signature: result.data.signerOutput.signature,
          pkpPublicKey: result.data.signerOutput.pkpPublicKey,
        },
      } : {}),
    },
  };

  return queryResult;
}
