# Module 6 -- SDK & Plugin Architecture

## Overview

Module 6 provides the developer-facing interface to ChainMesh. Two packages: `@chainmesh/sdk` (core) and `@chainmesh/elizaos-plugin` (AI agent wrapper).

The SDK does NOT depend on Module 2 code. It interacts only via contract ABIs (on-chain) and HTTP API (off-chain).

---

## Package Structure

```
module6-sdk/
  packages/
    sdk/                  @chainmesh/sdk
      src/
        ChainMeshSDK.ts   Main class, three access strategies
        types.ts           Config, results, errors, Zod schemas
        adapters/          ReputationAdapter, PriceAdapter
        contracts/         Minimal ABIs (GenericCache, GenericOracle)
        utils/             Validation helpers
      tests/unit/          52 tests (Vitest)
    elizaos-plugin/       @chainmesh/elizaos-plugin
      src/
        index.ts           Plugin factory
        actions.ts         5 ElizaOS actions
        types.ts           ElizaOS framework types
      tests/unit/          14 tests (Vitest)
  docs/                    This file + SPEC
```

---

## Three Access Strategies

```mermaid
graph LR
    Dev[Developer]

    subgraph SDK ["@chainmesh/sdk"]
        GD["getData()"]
        RD["requestData()"]
        Q["query()"]
    end

    subgraph OnChain ["Module 1"]
        Cache[GenericCache]
        Oracle[GenericOracle]
    end

    subgraph OffChain ["Module 2"]
        API[API Gateway]
    end

    Dev --> GD
    Dev --> RD
    Dev --> Q

    GD -->|"view call"| Cache
    RD -->|"payable tx"| Cache
    Q -->|"HTTP POST"| API

    Cache <-->|"CCIP"| Oracle

    style Cache fill:#bbf
    style Oracle fill:#bbf
    style API fill:#f9f
```

| Strategy | Method | Speed | Cost | Freshness |
|---|---|---|---|---|
| Cache-first | `getData()` | Instant | Free | Up to 24h stale |
| CCIP request | `requestData()` | Minutes | ETH (CCIP fees) | Fresh |
| API-first | `query()` | 1-2 min | Free (API) | Fresh |

---

## Adapter Pattern

```mermaid
graph TB
    SDK[ChainMeshSDK]

    subgraph Adapters
        RA[ReputationAdapter]
        PA[PriceAdapter]
    end

    subgraph Generic
        GD["getData(key, chain)"]
        RD["requestData(key, schemaHash, chain)"]
    end

    subgraph Convenience
        RG["reputation.get(wallet, chain)"]
        PG["price.get(symbol, chain)"]
    end

    SDK --> Adapters
    SDK --> Generic
    SDK --> Convenience

    Convenience --> Adapters
    Convenience --> Generic

    RA -->|"getKey(wallet)"| GD
    PA -->|"getKey(symbol)"| GD
```

Adapters mirror on-chain logic:
- Key derivation: `keccak256(solidityPacked(...))`
- Encoding: `AbiCoder.encode(types, values)`
- Decoding: `AbiCoder.decode(types, bytes)`

---

## ElizaOS Plugin

```mermaid
graph LR
    Agent[AI Agent]

    subgraph Plugin ["@chainmesh/elizaos-plugin"]
        QD[QUERY_DATA]
        CC[CHECK_CACHE]
        RU[REQUEST_UPDATE]
        GR[GET_REPUTATION]
        GP[GET_PRICE]
    end

    subgraph SDK ["@chainmesh/sdk"]
        Core[ChainMeshSDK]
    end

    Agent --> Plugin
    Plugin --> Core

    style Agent fill:#dfd
```

Actions parse natural language messages, extract parameters (key, chain, address, symbol), and delegate to SDK methods.

---

## Error Handling

Three error types, all extending `ChainMeshError`:
- `ConfigError` -- invalid or missing configuration
- `ContractError` -- on-chain call failure
- `ApiError` -- API Gateway failure

---

## Dependencies

| Dependency | Purpose |
|---|---|
| ethers v6 | Contract interaction, ABI encoding |
| zod v4 | Configuration validation |
| axios | API Gateway HTTP calls |

No dependency on Module 2 source code.
