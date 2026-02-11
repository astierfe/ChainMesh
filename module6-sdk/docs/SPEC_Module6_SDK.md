# Module 6 -- SDK & Plugin Specification

## 1. Purpose

Provide a TypeScript SDK (`@chainmesh/sdk`) and ElizaOS plugin (`@chainmesh/elizaos-plugin`) for developers and AI agents to interact with ChainMesh infrastructure.

## 2. Packages

### 2.1 `@chainmesh/sdk`

#### Configuration

```typescript
const sdk = new ChainMeshSDK({
  chains: {
    arbitrum: {
      rpcUrl: 'https://arb-sepolia.g.alchemy.com/v2/...',
      cacheAddress: '0x5b79dfb8b0decb3c1515f43ff8d3f79a71369578',
    },
    base: {
      rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/...',
      cacheAddress: '0x438ed11546012eedc724d606b5d81aa54190e8b7',
    },
  },
  oracle: {
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/...',
    address: '0x0c0c22fef7ff7adceb84cbf56c7e25cd1a21776a',
  },
  apiGateway: {
    url: 'http://localhost:5678/webhook',
  },
  defaultChain: 'arbitrum',
});
```

Configuration is validated with Zod at construction time. Invalid config throws `ConfigError`.

#### Generic Methods

| Method | Strategy | Description |
|---|---|---|
| `getData(key, chain?)` | Cache-first | Read from GenericCache (view, free) |
| `requestData(key, schemaHash, chain?, overrides?)` | CCIP | Trigger on-chain CCIP request (payable) |
| `query(request)` | API-first | Call Module 2 API Gateway (HTTP POST) |
| `getOracleData(key)` | Direct | Read from GenericOracle on Sepolia |

#### Adapter Helpers

Accessed via `sdk.adapters.reputation` and `sdk.adapters.price`.

| Method | Description |
|---|---|
| `getKey(input)` | Derive bytes32 key (mirrors on-chain) |
| `encode(...)` | ABI-encode typed data to bytes |
| `decode(rawBytes)` | ABI-decode bytes to typed data |
| `getDefaultValue()` | Return default value for the schema |

#### Convenience Methods

Accessed via `sdk.reputation` and `sdk.price`.

| Method | Description |
|---|---|
| `reputation.get(wallet, chain?)` | Get decoded reputation (cache-first) |
| `reputation.request(wallet, chain?)` | Request fresh reputation via CCIP |
| `price.get(symbol, chain?)` | Get decoded price (cache-first) |
| `price.request(symbol, chain?)` | Request fresh price via CCIP |

### 2.2 `@chainmesh/elizaos-plugin`

```typescript
import { createChainMeshPlugin } from '@chainmesh/elizaos-plugin';

const plugin = createChainMeshPlugin(config);
// Register with ElizaOS runtime
```

#### Actions

| Action | Trigger Example | SDK Method |
|---|---|---|
| `QUERY_DATA` | "query chainmesh for 0xabc...def on arbitrum" | `sdk.query()` |
| `CHECK_CACHE` | "check if 0xabc...def is cached on base" | `sdk.getData()` |
| `REQUEST_UPDATE` | "request fresh data for 0xabc...def on arbitrum" | `sdk.requestData()` |
| `GET_REPUTATION` | "get reputation for 0x1234...5678 on arbitrum" | `sdk.reputation.get()` |
| `GET_PRICE` | "get price of ETH on base" | `sdk.price.get()` |

Each action:
1. Validates the message (extracts key/address/symbol)
2. Extracts chain from message (defaults if absent)
3. Calls appropriate SDK method
4. Formats response via callback

## 3. Error Types

| Error | Code | When |
|---|---|---|
| `ConfigError` | `CONFIG_ERROR` | Invalid config, missing chain/oracle/apiGateway |
| `ContractError` | `CONTRACT_ERROR` | On-chain call revert or RPC failure |
| `ApiError` | `API_ERROR` | API Gateway HTTP error or network failure |

All extend `ChainMeshError(message, code, details?)`.

## 4. Adapter Encoding Reference

### ReputationAdapter

- Schema: `keccak256("ReputationV1")`
- Key: `keccak256(solidityPacked(['address', 'string'], [wallet, 'reputation']))`
- Encoding: `AbiCoder.encode(['uint8', 'bytes32'], [score, evidenceHash])`
- Default: score=60, evidenceHash=0x0

### PriceAdapter

- Schema: `keccak256("PriceV1")`
- Key: `keccak256(solidityPacked(['string', 'string'], [symbol, 'price']))`
- Encoding: `AbiCoder.encode(['uint256', 'uint8'], [value, decimals])`
- Default: value=0, decimals=18

## 5. Contract ABIs

Minimal ABIs included -- only the functions the SDK calls:

**GenericCache:** `getData(bytes32)`, `requestData(bytes32,bytes32)`, `getDefaultValue(bytes32)`, events

**GenericOracle:** `getData(bytes32)`, events

## 6. Testing

- 52 SDK tests (adapters, config validation, getData, query, oracle, convenience)
- 14 ElizaOS plugin tests (action validation, handler behavior, error handling)
- Mocking: ethers Contract/Provider mocked for on-chain tests, axios mocked for API tests
- Framework: Vitest with globals

## 7. Technical Constraints

- TypeScript strict mode
- ethers v6, Zod v4 (matching Module 2)
- No runtime dependency on Module 2 source code
- Node.js v24
