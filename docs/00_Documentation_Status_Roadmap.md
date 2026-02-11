# ChainMesh - Documentation Status & Roadmap

**Date:** 11 February 2026
**Version:** 2.0

---

## Project Status

ChainMesh is a generic, schema-agnostic cross-chain infrastructure. The Oracle, Cache, orchestrator, data layer, AI engine, and signing components are all data-type independent. Reputation and Price are two example adapters, but the system supports any number of use cases (governance scoring, credit risk, arbitrage signals, portfolio analysis, ...) by adding a new adapter on-chain and a workflow configuration off-chain, without modifying the core infrastructure.

| Module | Scope | Status |
|---|---|---|
| Module 1 -- Smart Contracts | GenericOracle, GenericCache, Adapters (Reputation, Price) | Completed. 123 tests, >80% coverage. |
| Module 2 -- Orchestration | WorkflowOrchestrator, RateLimiter, n8n workflows | Completed. Pipeline, resilience, 3 workflows. |
| Module 3 -- AI Engine | ClaudeAnalyzer, RulesAnalyzer, HybridAnalyzer | Completed (within Module 2 codebase). |
| Module 4 -- Security | LitSigner, DevWalletSigner, SignerFactory | Completed (within Module 2 codebase). |
| Module 5 -- Data Layer | GoldskyProvider, AlchemyProvider, ProviderFactory | Completed (within Module 2 codebase). |
| Module 6 -- SDK & Plugin | chainmesh-sdk, ElizaOS plugin | Planned. Interfaces defined. |

Supported chains (testnet): Sepolia, Arbitrum Sepolia, Base Sepolia, Optimism Sepolia.

---

## Documentation Inventory

### Root-level (`docs/`)

| Document | Content | Status |
|---|---|---|
| [PRD v1.3](ChainMesh_PRD_v1.3.md) | Product requirements, roadmap, risks | Up to date |
| [Module Interfaces](Module_Interfaces_ChainMesh.md) | Strict boundaries between the 6 modules, TypeScript/Solidity contracts | Needs update (still reputation-centric, should reflect generic nature) |
| [TAD Part 1](01_TAD_Part1_Introduction_Architecture_Contracts.md) | Architecture overview, smart contracts | Written pre-implementation, broadly accurate |
| [TAD Part 2](02_TAD_Part2_OffChain_Data_AI.md) | Off-chain orchestration, data sources, AI engine | Written pre-implementation, broadly accurate |
| [TAD Part 3](03_TAD_Part3_Security_Infrastructure_Config.md) | Security, infrastructure, configuration | Written pre-implementation, broadly accurate |
| This file | Documentation status and roadmap | This file |

### Module 1 (`module1-blockchain/docs/`)

| Document | Content | Status |
|---|---|---|
| [Architecture](../module1-blockchain/docs/MODULE1_ARCHITECTURE.md) | Contract hierarchy, data flows, security model, storage | Up to date |
| [Specification](../module1-blockchain/docs/SPEC_Module1_Blockchain.md) | Functional specification | Up to date |

### Module 2 (`module2-orchestration/docs/`)

| Document | Content | Status |
|---|---|---|
| [Architecture](../module2-orchestration/docs/MODULE2_ARCHITECTURE.md) | Component hierarchy, pipeline diagrams, resilience, deployment | Up to date |
| [Specification](../module2-orchestration/docs/SPEC_Module2_Orchestration.md) | Consolidated functional specification | Up to date |

### Removed Documents

The following documents were part of the initial design phase and have been removed or superseded:

- `Claude.md` -- Replaced by per-module architecture and specification documents
- `Audit_Isolation_Modulaire.md` -- One-time audit, findings addressed
- `Rapport_Corrections_Post_Audit.md` -- Corrections applied
- `ChainMesh_DevGuide_v1.1.md` -- Superseded by module specifications
- `SPEC_Module2_Part1/Part2/Part3.md` -- Consolidated into `SPEC_Module2_Orchestration.md`

---

## Documentation Roadmap

### Before Module 6 Development

| Document | Purpose | Priority |
|---|---|---|
| Update `Module_Interfaces_ChainMesh.md` | Align interfaces with actual generic implementation (remove reputation-specific assumptions, use key/schemaHash/chains pattern) | P0 |

### With Module 6 (SDK & Plugin)

| Document | Purpose | Priority |
|---|---|---|
| Module 6 Architecture | Architecture doc following the same pattern as Modules 1 and 2 | P0 |
| Module 6 Specification | Functional spec for SDK and ElizaOS plugin | P0 |
| SDK API Reference | TypeDoc auto-generated from SDK source | P1 |
| ElizaOS Plugin Guide | Installation, configuration, available actions | P1 |

### Integration & Deployment

| Document | Purpose | Priority |
|---|---|---|
| Implementation Guide | Step-by-step testnet deployment (all modules) | P1 |
| Security Audit Checklist | Pre-production validation (contracts + orchestration) | P1 |
| CCIP Flow Diagrams | Detailed error case diagrams | P2 |

### Communication & Portfolio

| Document | Purpose | Priority |
|---|---|---|
| Blog Post Series | 3 technical articles (Architecture, CCIP, Hybrid AI) | P2 |
| Presentation Deck | Slides for meetup + live demo | P2 |

---

## Next Step: Module 6 -- SDK & Plugin

Modules 1 through 5 are complete. Module 6 is the only remaining module in the architecture.

**Why Module 6 next:**

Module 6 is the developer-facing layer. Without it, using ChainMesh requires knowledge of CCIP internals, contract ABIs, bytes32 key encoding, and schemaHash conventions. The SDK abstracts all of this behind a simple TypeScript API. The ElizaOS plugin lets AI agents use ChainMesh through natural language actions.

**Module 6 scope (from PRD and Module Interfaces):**

`chainmesh-sdk` -- TypeScript npm package exposing a cache-aware, schema-agnostic API. The SDK reads directly from GenericCache contracts on consumer chains (Arbitrum, Base, Optimism). If data is stale or missing, it can trigger a CCIP request or call the API Gateway (Module 2). The developer never interacts with CCIP directly.

`@elizaos/plugin-chainmesh` -- ElizaOS plugin wrapping the SDK. Provides actions (query data, check cache status) that agents can invoke. Not limited to reputation -- any data type registered in ChainMesh is queryable.

**Prerequisites before starting Module 6:**

1. Update `Module_Interfaces_ChainMesh.md` to reflect the generic implementation. The current version is still reputation-centric (references `updateReputation`, `getReputation`, `GET_REPUTATION`). It should use the generic `key/schemaHash/chains` pattern that the actual contracts and orchestrator use.

2. Define the SDK's public API surface: which contract methods to expose, how to handle cache-first vs API-first strategies, error types, and configuration options.

**Estimated deliverables:**

| Component | Description |
|---|---|
| `module6-sdk/packages/chainmesh-sdk/` | Core TypeScript SDK (ethers v6, cache-first reads, API fallback) |
| `module6-sdk/packages/elizaos-plugin/` | ElizaOS plugin wrapping the SDK |
| `module6-sdk/docs/MODULE6_ARCHITECTURE.md` | Architecture document |
| `module6-sdk/docs/SPEC_Module6_SDK.md` | Functional specification |
| `module6-sdk/tests/` | Unit tests |

---

## Key Architectural Principle

ChainMesh separates infrastructure from business logic at every layer:

**On-chain:** The GenericOracle stores `bytes` values indexed by `bytes32 key` and `bytes32 schemaHash`. The GenericCache provides TTL-based caching and rate-limiting. Neither knows what the data represents. Adapters (ReputationAdapter, PriceAdapter, ...) are stateless encoder/decoders that translate between domain-specific types and the generic `bytes` format. Adding a new data type means writing a new adapter -- no change to Oracle or Cache.

**Off-chain:** The WorkflowOrchestrator pipeline is driven by `key + schemaHash + chains[]`. A router dispatches to the appropriate sub-workflows based on the schemaHash. The data providers, circuit breakers, retry policies, rate limiter, and signing infrastructure are all schema-agnostic. Adding a new use case means configuring the router and optionally writing a new analyzer -- no change to the pipeline.

---

## Changelog

**v2.0 (11 February 2026)**
- Complete rewrite reflecting actual project state
- Modules 1-5 marked as completed
- Removed references to deleted/superseded documents
- Updated documentation inventory with per-module docs
- Aligned roadmap with Module 6 as next milestone

**v1.1 (31 January 2026)**
- Post-audit additions (isolation modulaire)

**v1.0 (30 January 2026)**
- Initial documentation roadmap
