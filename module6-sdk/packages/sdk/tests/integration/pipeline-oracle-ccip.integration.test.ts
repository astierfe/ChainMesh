/**
 * Phase 2 Integration Tests — Pipeline → Oracle → CCIP → SDK round-trip
 * Tests 12-14: Requires Anvil with deployed contracts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import {
  setupAnvil,
  releaseAnvil,
  ANVIL_RPC_URL,
  CACHE_CHAIN_SELECTOR,
  type DeployedContracts,
} from './anvil-setup.js';
import {
  createTestOrchestrator,
  createTestQueryInput,
  createDefaultMockProviderOutput,
  createOracleContractAdapter,
  type OracleContract,
  type OrchestratorResult,
} from './pipeline-helpers.js';
import { ChainMeshSDK } from '../../src/ChainMeshSDK.js';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';

let contracts: DeployedContracts;
let sdk: ChainMeshSDK;
let oracleAdapter: OracleContract;

beforeAll(async () => {
  contracts = await setupAnvil();
  sdk = new ChainMeshSDK({
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
    defaultChain: 'local-anvil',
  });
  oracleAdapter = createOracleContractAdapter(contracts.oracle);
}, 30_000);

afterAll(async () => {
  await releaseAnvil();
});

// ---------------------------------------------------------------------------
// Test 12: Pipeline writes to Oracle, SDK reads back
// ---------------------------------------------------------------------------

describe('Test 12: Pipeline → Oracle → SDK read-back', () => {
  const adapter = new ReputationAdapter();
  const testKey = adapter.getKey('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');

  it('12a. full pipeline executes and writes to Oracle on-chain', async () => {
    const orchestrator = await createTestOrchestrator({
      oracleContract: oracleAdapter,
    });
    const input = createTestQueryInput({
      key: testKey,
      includeAnalysis: false,
    });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.executionId).toMatch(/^exec_/);
    expect(result.data).toBeDefined();
    expect(result.data!.txHash).toBeDefined();
    expect(result.data!.encodedValue).toBeDefined();
    expect(result.data!.signerOutput).toBeDefined();
    expect(result.data!.signerOutput!.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

    // All pipeline steps succeeded
    expect(result.context.steps.validation.status).toBe('success');
    expect(result.context.steps.rateLimit.status).toBe('success');
    expect(result.context.steps.dataProvider.status).toBe('success');
    expect(result.context.steps.signer.status).toBe('success');
    expect(result.context.steps.oracleUpdate.status).toBe('success');
    expect((result.context.steps.oracleUpdate as any).txHash).toBeDefined();
    expect((result.context.steps.oracleUpdate as any).gasUsed).toBeDefined();
  });

  it('12b. SDK reads the oracle data written by pipeline', async () => {
    const oracleResult = await sdk.getOracleData(testKey);

    expect(oracleResult.isValid).toBe(true);
    expect(oracleResult.value).not.toBe('0x');
    expect(oracleResult.value.length).toBeGreaterThan(2);
    expect(oracleResult.schemaHash).toBe(ReputationAdapter.SCHEMA_HASH);
    expect(oracleResult.timestamp).toBeGreaterThan(0);
  });

  it('12c. encoded value decode round-trip matches mock provider data', async () => {
    const oracleResult = await sdk.getOracleData(testKey);

    // Decode: hex → UTF-8 → JSON → verify fields
    const jsonString = ethers.toUtf8String(ethers.getBytes(oracleResult.value));
    const decoded = JSON.parse(jsonString);

    // Without analysis, the encoded value is the DataProviderOutput
    const expectedData = createDefaultMockProviderOutput().data;
    expect(decoded.data).toEqual(expectedData);
    expect(decoded.metadata.provider).toBe('MockProvider');
    expect(decoded.metadata.successRate).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Test 13: Pipeline with CCIP response
// ---------------------------------------------------------------------------

describe('Test 13: Pipeline with CCIP messageId → sendResponse', () => {
  const adapter = new ReputationAdapter();
  const ccipKey = adapter.getKey('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

  it('13a. pipeline sends CCIP response when messageId is present', async () => {
    // Step 1: Create a real CCIP request via the Cache contract to generate a messageId
    const ccipFee = ethers.parseEther('0.01');
    const tx = await contracts.cache.requestData(
      ccipKey,
      ReputationAdapter.SCHEMA_HASH,
      { value: ccipFee },
    );
    const receipt = await tx.wait();

    // Extract messageId from DataQueried event
    const cacheInterface = contracts.cache.interface;
    const dataQueriedLog = receipt.logs.find((log: any) => {
      try {
        return cacheInterface.parseLog(log)?.name === 'DataQueried';
      } catch { return false; }
    });
    expect(dataQueriedLog).toBeDefined();
    const parsedEvent = cacheInterface.parseLog(dataQueriedLog!);
    const messageId = parsedEvent!.args.messageId;
    expect(messageId).not.toBe(ethers.ZeroHash);

    // Step 2: Deliver the CCIP message to the Oracle manually via MockCCIPRouter
    // The Cache sends: abi.encode(key, schemaHash, cacheAddress) as the data payload
    // The Oracle's _ccipReceive stores this in queryRequests[messageId]
    const ccipData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'bytes32', 'address'],
      [ccipKey, ReputationAdapter.SCHEMA_HASH, contracts.cacheAddress],
    );
    const deliverTx = await contracts.router.deliverMessage(
      contracts.oracleAddress,
      messageId,
      CACHE_CHAIN_SELECTOR,
      ethers.AbiCoder.defaultAbiCoder().encode(['address'], [contracts.cacheAddress]),
      ccipData,
    );
    await deliverTx.wait();

    // Step 3: Fund the Oracle contract with ETH for CCIP fees (0.01 ETH)
    const fundTx = await contracts.signer.sendTransaction({
      to: contracts.oracleAddress,
      value: ethers.parseEther('0.02'),
    });
    await fundTx.wait();

    // Step 4: Run the pipeline with the messageId
    const orchestrator = await createTestOrchestrator({
      oracleContract: oracleAdapter,
    });
    const input = createTestQueryInput({
      key: ccipKey,
      metadata: {
        messageId,
        sourceChain: 'arbitrum',
        requester: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      },
    });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.context.steps.oracleUpdate.status).toBe('success');
    expect(result.context.steps.ccipResponse).toBeDefined();
    expect(result.context.steps.ccipResponse.status).toBe('success');
    expect((result.context.steps.ccipResponse as any).txHash).toBeDefined();
  }, 30_000);

  it('13b. pipeline skips CCIP when no messageId', async () => {
    const noMessageIdKey = adapter.getKey('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
    const orchestrator = await createTestOrchestrator({
      oracleContract: oracleAdapter,
    });
    const input = createTestQueryInput({
      key: noMessageIdKey,
      // No metadata.messageId
    });

    const result = await orchestrator.execute(input);

    expect(result.success).toBe(true);
    expect(result.context.steps.oracleUpdate.status).toBe('success');
    // ccipResponse step should NOT be in context (step never executed)
    expect(result.context.steps.ccipResponse).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 14: Full SDK-verified round-trip
// ---------------------------------------------------------------------------

describe('Test 14: SDK → Pipeline → Oracle → SDK round-trip', () => {
  const adapter = new ReputationAdapter();

  it('14a. without analysis: pipeline encodes provider output, SDK decodes it', async () => {
    const key = adapter.getKey('0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
    const orchestrator = await createTestOrchestrator({
      oracleContract: oracleAdapter,
    });
    const input = createTestQueryInput({
      key,
      includeAnalysis: false,
    });

    const result = await orchestrator.execute(input);
    expect(result.success).toBe(true);

    // SDK reads back from Oracle
    const oracleResult = await sdk.getOracleData(key);
    expect(oracleResult.isValid).toBe(true);

    // Decode and verify the data matches mock provider
    const jsonString = ethers.toUtf8String(ethers.getBytes(oracleResult.value));
    const decoded = JSON.parse(jsonString);

    expect(decoded.data.walletAge).toBe(3 * 365 * 24 * 3600);
    expect(decoded.data.txCount).toBe(500);
    expect(decoded.data.defiProtocols).toEqual(['aave', 'compound', 'uniswap', 'curve']);
    expect(decoded.metadata.provider).toBe('MockProvider');
  });

  it('14b. with analysis: pipeline encodes analyzer output, SDK decodes it', async () => {
    const key = adapter.getKey('0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');
    const orchestrator = await createTestOrchestrator({
      oracleContract: oracleAdapter,
    });
    const input = createTestQueryInput({
      key,
      includeAnalysis: true,
    });

    const result = await orchestrator.execute(input);
    expect(result.success).toBe(true);
    expect(result.data!.analyzerOutput).toBeDefined();

    // SDK reads back from Oracle
    const oracleResult = await sdk.getOracleData(key);
    expect(oracleResult.isValid).toBe(true);

    // Decode — with analysis enabled, the encoded value is the AnalyzerOutput
    const jsonString = ethers.toUtf8String(ethers.getBytes(oracleResult.value));
    const decoded = JSON.parse(jsonString);

    expect(decoded.result.score).toBe(95);
    expect(decoded.result.tier).toBe('prime');
    expect(decoded.confidence).toBe(1.0);
    expect(decoded.reasoning).toContain('Rules-based calculation');
    expect(decoded.metadata.method).toBe('heuristic');
  });
});
