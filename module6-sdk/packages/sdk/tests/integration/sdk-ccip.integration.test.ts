/**
 * Integration Tests: SDK CCIP features on Anvil
 *
 * Tests 4-6 from Phase 1:
 * 4. requestData() triggers on-chain CCIP request + emits DataQueried event
 * 5. Cache TTL: data becomes stale after evm_increaseTime
 * 6. Rate limiting: second requestData() within MIN_REQUEST_INTERVAL reverts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ethers } from 'ethers';
import { ReputationAdapter } from '../../src/adapters/ReputationAdapter.js';
import { PriceAdapter } from '../../src/adapters/PriceAdapter.js';
import { GENERIC_CACHE_ABI } from '../../src/contracts/abis.js';
import { ChainMeshSDK } from '../../src/ChainMeshSDK.js';
import {
  setupAnvil,
  releaseAnvil,
  deliverCCIPResponse,
  ANVIL_RPC_URL,
  type DeployedContracts,
} from './anvil-setup.js';

let contracts: DeployedContracts;
let sdk: ChainMeshSDK;
let signerCacheContract: ethers.Contract;

beforeAll(async () => {
  contracts = await setupAnvil();

  // Cache contract connected to signer for sending transactions
  signerCacheContract = new ethers.Contract(
    contracts.cacheAddress,
    GENERIC_CACHE_ABI,
    contracts.signer,
  );

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
}, 30_000);

afterAll(async () => {
  await releaseAnvil();
});

// ==============================================================
// Test 4: requestData() + DataQueried event
// ==============================================================
describe('Test 4: requestData() emits DataQueried event', () => {
  const reputationAdapter = new ReputationAdapter();
  const CCIP_FEE = ethers.parseEther('0.01');

  it('requestData() sends CCIP request and emits DataQueried', async () => {
    const walletAddress = '0x4444444444444444444444444444444444444444';
    const key = reputationAdapter.getKey(walletAddress);

    const tx = await signerCacheContract.requestData(
      key,
      ReputationAdapter.SCHEMA_HASH,
      { value: CCIP_FEE },
    );
    const receipt = await tx.wait();

    // Parse DataQueried event
    const iface = new ethers.Interface(GENERIC_CACHE_ABI);
    const dataQueriedEvent = receipt.logs
      .map((log: ethers.Log) => {
        try {
          return iface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed: ethers.LogDescription | null) => parsed?.name === 'DataQueried');

    expect(dataQueriedEvent).toBeDefined();
    expect(dataQueriedEvent!.args[0]).toBe(key); // key
    expect(dataQueriedEvent!.args[1]).toBe(ReputationAdapter.SCHEMA_HASH); // schemaHash
    // args[2] = requester (signer address)
    // args[3] = messageId (bytes32, non-zero)
    const messageId = dataQueriedEvent!.args[3] as string;
    expect(messageId).not.toBe(ethers.ZeroHash);
  });

  it('requestData() with insufficient fee reverts', async () => {
    const walletAddress = '0x5555555555555555555555555555555555555555';
    const key = reputationAdapter.getKey(walletAddress);

    await expect(
      signerCacheContract.requestData(
        key,
        ReputationAdapter.SCHEMA_HASH,
        { value: 0n },
      ),
    ).rejects.toThrow();
  });
});

// ==============================================================
// Test 5: Cache TTL — data becomes stale after 24h
// ==============================================================
describe('Test 5: Cache TTL expiration', () => {
  const priceAdapter = new PriceAdapter();

  it('data is fresh right after caching, stale after 25h', { timeout: 30_000 }, async () => {
    const key = priceAdapter.getKey('LINK');
    const encoded = priceAdapter.encode(1500000000n, 8); // $15.00

    // Write data to cache via CCIP delivery
    const msgId = ethers.keccak256(ethers.toUtf8Bytes('msg-ttl-test'));
    await deliverCCIPResponse(
      contracts,
      msgId,
      key,
      encoded,
      Math.floor(Date.now() / 1000),
      PriceAdapter.SCHEMA_HASH,
    );

    // Verify data is fresh (needsUpdate = false)
    const freshResult = await sdk.getData(key);
    expect(freshResult.isFromCache).toBe(true);
    expect(freshResult.needsUpdate).toBe(false);

    // Advance time by 25 hours (90000 seconds) past the 24h TTL
    await contracts.provider.send('evm_increaseTime', [90000]);
    await contracts.provider.send('evm_mine', []);

    // Now data should be stale (needsUpdate = true)
    const staleResult = await sdk.getData(key);
    expect(staleResult.isFromCache).toBe(true);
    expect(staleResult.needsUpdate).toBe(true);

    // Value should still be readable even if stale
    const decoded = priceAdapter.decode(staleResult.value);
    expect(decoded.value).toBe(1500000000n);
    expect(decoded.decimals).toBe(8);
  });
});

// ==============================================================
// Test 6: Rate limiting — second request within MIN_REQUEST_INTERVAL reverts
// ==============================================================
describe('Test 6: Rate limiting', () => {
  const reputationAdapter = new ReputationAdapter();
  const CCIP_FEE = ethers.parseEther('0.01');

  it('second requestData() within 1h reverts with RateLimitExceeded', { timeout: 15_000 }, async () => {
    const walletAddress = '0x6666666666666666666666666666666666666666';
    const key = reputationAdapter.getKey(walletAddress);

    // First request should succeed
    const tx = await signerCacheContract.requestData(
      key,
      ReputationAdapter.SCHEMA_HASH,
      { value: CCIP_FEE },
    );
    await tx.wait();

    // Second request immediately should revert (rate limited)
    await expect(
      signerCacheContract.requestData(
        key,
        ReputationAdapter.SCHEMA_HASH,
        { value: CCIP_FEE },
      ),
    ).rejects.toThrow();
  });

  it('requestData() succeeds after MIN_REQUEST_INTERVAL passes', { timeout: 15_000 }, async () => {
    const walletAddress = '0x7777777777777777777777777777777777777777';
    const key = reputationAdapter.getKey(walletAddress);

    // First request
    const tx1 = await signerCacheContract.requestData(
      key,
      ReputationAdapter.SCHEMA_HASH,
      { value: CCIP_FEE },
    );
    await tx1.wait();

    // Advance time past MIN_REQUEST_INTERVAL (1 hour = 3600s)
    await contracts.provider.send('evm_increaseTime', [3601]);
    await contracts.provider.send('evm_mine', []);

    // Second request should now succeed
    const tx2 = await signerCacheContract.requestData(
      key,
      ReputationAdapter.SCHEMA_HASH,
      { value: CCIP_FEE },
    );
    const receipt = await tx2.wait();
    expect(receipt.status).toBe(1);
  });
});
