/**
 * Anvil setup helper for integration tests.
 * Launches a local Anvil instance and deploys GenericCache, GenericOracle,
 * and MockCCIPRouter contracts for testing the SDK against real contracts.
 */
import { ethers } from 'ethers';
import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Anvil default accounts (deterministic)
export const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const ANVIL_ACCOUNT = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Use a non-standard port to avoid conflicts
const ANVIL_PORT = 8546;
export const ANVIL_RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

// Fake chain selectors for testing
export const ORACLE_CHAIN_SELECTOR = 16015286601757825753n; // Sepolia
export const CACHE_CHAIN_SELECTOR = 3478487238524512106n; // Arbitrum Sepolia

export interface DeployedContracts {
  router: ethers.Contract;
  routerAddress: string;
  cache: ethers.Contract;
  cacheAddress: string;
  oracle: ethers.Contract;
  oracleAddress: string;
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
}

let anvilProcess: ChildProcess | null = null;

/**
 * Load Foundry artifact (ABI + bytecode) for a contract.
 */
function loadArtifact(contractName: string, fileName: string): { abi: ethers.InterfaceAbi; bytecode: string } {
  const artifactPath = path.resolve(
    __dirname,
    '../../../../../module1-blockchain/contracts/out',
    fileName,
    `${contractName}.json`,
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

/**
 * Start Anvil, deploy contracts, and return ready-to-use contract instances.
 */
export async function setupAnvil(): Promise<DeployedContracts> {
  // Kill any leftover process on our port
  try {
    execSync(`lsof -ti:${ANVIL_PORT} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // No process on that port
  }

  const anvilPath = process.env.ANVIL_PATH || `${process.env.HOME}/.foundry/bin/anvil`;

  await new Promise<void>((resolve, reject) => {
    anvilProcess = spawn(anvilPath, ['--port', String(ANVIL_PORT)], {
      stdio: 'pipe',
    });

    anvilProcess.on('error', (err) => {
      reject(new Error(`Failed to start Anvil: ${err.message}`));
    });

    const checkReady = async () => {
      const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
      for (let i = 0; i < 30; i++) {
        try {
          await provider.getBlockNumber();
          resolve();
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      reject(new Error('Anvil did not start within 6 seconds'));
    };

    checkReady();
  });

  return deployContracts();
}

/**
 * Stop Anvil process.
 */
export async function releaseAnvil(): Promise<void> {
  if (anvilProcess) {
    anvilProcess.kill('SIGTERM');
    anvilProcess = null;
    await new Promise((r) => setTimeout(r, 300));
  }
}

// Aliases
export const startAnvil = setupAnvil;
export const stopAnvil = releaseAnvil;

/**
 * Deploy all contracts to Anvil and return contract instances.
 * Uses NonceManager during deployment to avoid ethers v6 nonce caching issues,
 * then creates a fresh provider + wallet for test use.
 */
async function deployContracts(): Promise<DeployedContracts> {
  // Dedicated provider for deployment (will be discarded)
  const deployProvider = new ethers.JsonRpcProvider(ANVIL_RPC_URL);
  const deployer = new ethers.NonceManager(
    new ethers.Wallet(ANVIL_PRIVATE_KEY, deployProvider),
  );

  // 1. Deploy MockCCIPRouter
  const routerArtifact = loadArtifact('MockCCIPRouter', 'MockCCIPRouter.sol');
  const RouterFactory = new ethers.ContractFactory(routerArtifact.abi, routerArtifact.bytecode, deployer);
  const router = await RouterFactory.deploy();
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  // 2. Deploy GenericOracle (constructor: router)
  const oracleArtifact = loadArtifact('GenericOracle', 'GenericOracle.sol');
  const OracleFactory = new ethers.ContractFactory(oracleArtifact.abi, oracleArtifact.bytecode, deployer);
  const oracle = await OracleFactory.deploy(routerAddress);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();

  // 3. Deploy GenericCache (constructor: router, oracleAddress, oracleChainSelector)
  const cacheArtifact = loadArtifact('GenericCache', 'GenericCache.sol');
  const CacheFactory = new ethers.ContractFactory(cacheArtifact.abi, cacheArtifact.bytecode, deployer);
  const cache = await CacheFactory.deploy(routerAddress, oracleAddress, ORACLE_CHAIN_SELECTOR);
  await cache.waitForDeployment();
  const cacheAddress = await cache.getAddress();

  // 4. Setup Oracle: grant UPDATER_ROLE to signer (for updateData)
  const UPDATER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('UPDATER_ROLE'));
  const signerAddr = await deployer.getAddress();
  const grantTx = await (oracle as ethers.Contract).grantRole(UPDATER_ROLE, signerAddr);
  await grantTx.wait();

  // 5. Setup Oracle: whitelist the cache chain
  const whitelistTx = await (oracle as ethers.Contract).whitelistChain(CACHE_CHAIN_SELECTOR);
  await whitelistTx.wait();

  // Create a FRESH provider + wallet for test use.
  // cacheTimeout: -1 disables internal RPC result caching to avoid stale nonces.
  const provider = new ethers.JsonRpcProvider(ANVIL_RPC_URL, undefined, { cacheTimeout: -1 });
  const wallet = new ethers.Wallet(ANVIL_PRIVATE_KEY, provider);

  return {
    router: new ethers.Contract(routerAddress, routerArtifact.abi, wallet),
    routerAddress,
    cache: new ethers.Contract(cacheAddress, cacheArtifact.abi, wallet),
    cacheAddress,
    oracle: new ethers.Contract(oracleAddress, oracleArtifact.abi, wallet),
    oracleAddress,
    provider,
    signer: wallet,
  };
}

/**
 * Simulate a CCIP response delivery to the cache contract.
 */
export async function deliverCCIPResponse(
  contracts: DeployedContracts,
  messageId: string,
  key: string,
  value: string,
  timestamp: number,
  schemaHash: string,
): Promise<void> {
  const data = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'bytes', 'uint32', 'bytes32'],
    [key, value, timestamp, schemaHash],
  );

  const tx = await contracts.router.deliverMessage(
    contracts.cacheAddress,
    messageId,
    ORACLE_CHAIN_SELECTOR,
    ethers.AbiCoder.defaultAbiCoder().encode(['address'], [contracts.oracleAddress]),
    data,
  );
  await tx.wait();
}
