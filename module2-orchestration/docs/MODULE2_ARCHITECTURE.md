# ChainMesh Module 2 - Architecture & Design

Infrastructure d'orchestration off-chain generique construite sur n8n. Le systeme coordonne les flux entre evenements blockchain (Module 1), providers de donnees (Goldsky/Alchemy), analyseurs (AI/Rules) et signataires MPC (Lit Protocol) via un pipeline schema-agnostique.

---

## Vue d'ensemble

```mermaid
graph TB
    subgraph "Entry Points"
        API([API Gateway<br/>POST /api/query])
        Event([CCIP Event Listener<br/>Poll 30s])
    end

    subgraph "Generic Orchestrator"
        Validate[Input Validator<br/>Zod schemas]
        RateLimit[Rate Limiter<br/>1 req/h/key PostgreSQL]
        Router[Router<br/>schemaHash dispatch]
    end

    subgraph "Pluggable Sub-Workflows"
        Provider[DataProvider MultiChain<br/>Goldsky + Alchemy fallback]
        Analyzer[Hybrid Analyzer<br/>AI x0.6 + Rules x0.4]
        Signer[Signer MPC<br/>Lit Protocol / DevWallet]
    end

    subgraph "Module 1 - Smart Contracts"
        Oracle[GenericOracle<br/>updateData]
        CCIP[sendResponse<br/>CCIP cross-chain]
    end

    API --> Validate
    Event --> Validate
    Validate --> RateLimit
    RateLimit --> Router
    Router --> Provider
    Provider --> Analyzer
    Analyzer --> Signer
    Signer --> Oracle
    Oracle --> CCIP
```

Le flux complet : une requete arrive par API HTTP ou par evenement CCIP. L'orchestrateur valide l'input, verifie le rate limit, collecte les donnees multi-chain, les analyse (optionnel), encode et signe le payload, puis met a jour l'Oracle on-chain. Si la requete provient d'un message CCIP, une reponse cross-chain est envoyee au Cache source.

---

## Hierarchie des composants

```mermaid
classDiagram
    class WorkflowOrchestrator {
        +execute(rawInput, sourceModule)
        -validateInput()
        -checkRateLimit()
        -fetchData()
        -analyzeData()
        -encodePayload()
        -signPayload()
        -updateOracle()
        -sendCCIPResponse()
        -classifyError()
    }

    class ProviderFactory {
        +queryWithFallback(query)
        -providers: DataProvider[]
        -circuitBreakers: Map
    }

    class GoldskyProvider {
        +query(key, chains, schemaHash)
    }

    class AlchemyProvider {
        +query(key, chains, schemaHash)
    }

    class HybridAnalyzer {
        +analyze(data, schemaHash)
        -aiWeight: 0.6
        -rulesWeight: 0.4
    }

    class ClaudeAnalyzer {
        +analyze(data, schemaHash)
    }

    class RulesAnalyzer {
        +analyze(data, schemaHash)
    }

    class SignerFactory {
        +signWithFallback(payload)
    }

    class LitSigner {
        +sign(payload)
    }

    class DevWalletSigner {
        +sign(payload)
    }

    class RateLimiter {
        +consume(key)
        +isAllowed(key)
        +getRemainingMs(key)
    }

    class CircuitBreaker {
        +execute(fn)
        -state: CLOSED/OPEN/HALF_OPEN
        -failureThreshold: 3
        -cooldownMs: 60000
    }

    class RetryPolicy {
        +execute(fn)
        -maxRetries: 3
        -initialDelay: 1000
        -multiplier: 2
    }

    WorkflowOrchestrator --> ProviderFactory
    WorkflowOrchestrator --> HybridAnalyzer
    WorkflowOrchestrator --> SignerFactory
    WorkflowOrchestrator --> RateLimiter

    ProviderFactory --> GoldskyProvider
    ProviderFactory --> AlchemyProvider
    ProviderFactory --> CircuitBreaker

    HybridAnalyzer --> ClaudeAnalyzer
    HybridAnalyzer --> RulesAnalyzer

    SignerFactory --> LitSigner
    SignerFactory --> DevWalletSigner

    GoldskyProvider --> RetryPolicy
    AlchemyProvider --> RetryPolicy
```

L'orchestrateur coordonne trois factories : `ProviderFactory` (donnees multi-chain avec fallback), `HybridAnalyzer` (scoring AI+Rules), `SignerFactory` (signature MPC avec fallback testnet). Chaque provider et signer est protege par un `CircuitBreaker` et une `RetryPolicy`. Le `RateLimiter` utilise PostgreSQL pour persister les timestamps.

---

## Fichiers sources

### Orchestration

| Fichier | Role |
|---|---|
| `src/orchestrator/WorkflowOrchestrator.ts` | Pipeline complet : validate, rate-limit, fetch, analyze, encode, sign, oracle update, CCIP response |
| `src/orchestrator/RateLimiter.ts` | Rate limit per-key (1 req/h), storage PostgreSQL ou in-memory |

### Providers

| Fichier | Role |
|---|---|
| `src/providers/GoldskyProvider.ts` | Provider primaire : requetes GraphQL vers Goldsky (indexeur) |
| `src/providers/AlchemyProvider.ts` | Provider fallback : requetes via ethers.js + Alchemy SDK |
| `src/providers/ProviderFactory.ts` | Factory avec fallback cascade et circuit breaker par provider |

### Analyzers

| Fichier | Role |
|---|---|
| `src/analyzers/ClaudeAnalyzer.ts` | Analyse AI via Claude API (axios), retourne score + confidence + reasoning |
| `src/analyzers/RulesAnalyzer.ts` | Heuristiques deterministes : scoring base 50 + bonuses/penalties |
| `src/analyzers/HybridAnalyzer.ts` | Combine AI (x0.6) et Rules (x0.4), fallback sur Rules si AI echoue |

### Signers

| Fichier | Role |
|---|---|
| `src/signers/LitSigner.ts` | Signature MPC via Lit Protocol PKP (production) |
| `src/signers/DevWalletSigner.ts` | Signature ethers.Wallet locale (testnet fallback uniquement) |
| `src/signers/SignerFactory.ts` | Factory : Lit en priorite, DevWallet si Lit indisponible sur testnet |

### Validators

| Fichier | Role |
|---|---|
| `src/validators/inputValidator.ts` | Schemas Zod : bytes32, address, chains, GenericQueryRequest |
| `src/validators/outputValidator.ts` | Schemas Zod : DataProviderOutput, AnalyzerOutput, SignerOutput |

### Infrastructure

| Fichier | Role |
|---|---|
| `src/config/environment.ts` | Validation env vars (Zod), construction AppConfig structure |
| `src/utils/Logger.ts` | Winston logger, format JSON structure, child loggers avec executionId |
| `src/utils/CircuitBreaker.ts` | Pattern circuit breaker : CLOSED/OPEN/HALF_OPEN, 3 failures, 60s cooldown |
| `src/utils/RetryPolicy.ts` | Retry avec exponential backoff : 3 tentatives, delay x2 |

### Workflows n8n

| Fichier | Role |
|---|---|
| `workflows/API_Gateway.json` | Webhook POST /api/query, validation, appel orchestrateur, reponse HTTP 200/400/500 |
| `workflows/CCIP_EventListener.json` | Poll eth_getLogs toutes les 30s, decodage events, idempotency PostgreSQL, appel orchestrateur |
| `workflows/GenericOrchestrator.json` | Sub-workflow : pipeline complet avec conditionnels (analysis, CCIP), persistance executions |

---

## Flux de donnees detaille

### Pipeline complet (API Gateway)

```mermaid
sequenceDiagram
    participant User as DApp / Agent
    participant API as API Gateway
    participant Orch as WorkflowOrchestrator
    participant Provider as ProviderFactory
    participant Analyzer as HybridAnalyzer
    participant Signer as SignerFactory
    participant Oracle as GenericOracle (Sepolia)

    User->>API: POST /api/query {key, schemaHash, chains}
    activate API
    Note over API: Validation Zod<br/>bytes32, chains[], options

    API->>Orch: execute(validatedInput, 'API_Gateway')
    activate Orch

    Note over Orch: Rate limit check<br/>1 req/key/hour (PostgreSQL)

    Orch->>Provider: queryWithFallback(key, chains, schemaHash)
    activate Provider
    Note over Provider: Goldsky (primary)<br/>Alchemy (fallback)<br/>Circuit Breaker par provider
    Provider-->>Orch: DataProviderOutput
    deactivate Provider

    alt includeAnalysis = true
        Orch->>Analyzer: analyze(data, schemaHash)
        activate Analyzer
        Note over Analyzer: AI score x0.6<br/>Rules score x0.4
        Analyzer-->>Orch: AnalyzerOutput (score, confidence, reasoning)
        deactivate Analyzer
    end

    Note over Orch: Encode payload<br/>JSON to hex (ethers)

    Orch->>Signer: signWithFallback(key, value, schemaHash, timestamp)
    activate Signer
    Note over Signer: Lit Protocol MPC<br/>ou DevWallet (testnet)
    Signer-->>Orch: SignerOutput (signature, pkpPublicKey)
    deactivate Signer

    Orch->>Oracle: updateData(key, encodedValue, schemaHash)
    Note over Oracle: Store on-chain<br/>Emit DataUpdated

    Orch-->>API: OrchestratorResult (success, data, context)
    deactivate Orch

    API-->>User: 200 OK {executionId, result}
    deactivate API
```

Temps d'execution estime : DataProvider 800ms, Analyzer 20-30s (si AI active), Signer 300-500ms, Oracle tx 30-60s (testnet). Total : 1-2 minutes.

### Pipeline CCIP (Event Listener)

```mermaid
sequenceDiagram
    participant Cache as GenericCache (Arbitrum)
    participant CCIP as Chainlink CCIP
    participant Oracle as GenericOracle (Sepolia)
    participant Listener as CCIP EventListener (n8n)
    participant Orch as WorkflowOrchestrator
    participant DB as PostgreSQL

    Cache->>CCIP: requestData(key, schemaHash)
    CCIP->>Oracle: ccipReceive(message)
    Oracle--)Listener: emit QueryReceived(messageId, key, schemaHash)

    loop Toutes les 30 secondes
        Listener->>Oracle: eth_getLogs(QueryReceived)
    end

    Listener->>DB: Check processed_events (idempotency)
    Note over DB: messageId deja traite? Skip

    Listener->>Orch: execute(request, 'CCIP_EventListener')
    Note over Orch: Meme pipeline que API Gateway

    Orch->>Oracle: updateData(key, encodedValue, schemaHash)
    Orch->>Oracle: sendResponse(messageId, key)
    Oracle->>CCIP: ccipSend(response)
    CCIP->>Cache: ccipReceive(response)

    Listener->>DB: INSERT processed_events (messageId, block_number)
```

Difference avec l'API Gateway : le traitement est asynchrone (pas de reponse HTTP), et l'etape sendResponse est declenchee quand un messageId est present dans les metadata.

---

## Provider Fallback Strategy

```mermaid
flowchart TB
    Start[Query key + chains] --> Split[Requetes paralleles par chain]

    Split --> G1[Goldsky - Primary]
    Split --> G2[Goldsky - Primary]
    Split --> G3[Goldsky - Primary]

    G1 -->|Success| N1[Normalize]
    G2 -->|Timeout 10s| CB2{Circuit Breaker<br/>state?}
    G3 -->|Success| N3[Normalize]

    CB2 -->|CLOSED| A2[Alchemy - Fallback]
    CB2 -->|OPEN| P2[Public RPC - Fallback 2]

    A2 -->|Success| N2[Normalize]
    P2 -->|Success| N2

    N1 --> Merge[Merge Results]
    N2 --> Merge
    N3 --> Merge

    Merge --> Check{Success rate >= 50%?}
    Check -->|Oui| Continue[Continuer pipeline]
    Check -->|Non| Fail[Error: Insufficient data]

    style Continue fill:#90EE90
    style Fail fill:#FF6B6B
```

Trois niveaux de fallback : Goldsky (indexeur GraphQL, rapide), Alchemy (RPC enrichi), Public RPC (lent mais toujours disponible). Le circuit breaker evite de perdre du temps sur un provider defaillant (3 echecs = 60s cooldown).

---

## Modele de resilience

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    CLOSED --> OPEN : 3 echecs consecutifs
    OPEN --> HALF_OPEN : Apres 60s cooldown
    HALF_OPEN --> CLOSED : 1 succes
    HALF_OPEN --> OPEN : 1 echec

    note right of CLOSED
        Operation normale
        Toutes les requetes passent
    end note

    note right of OPEN
        Fast-fail sans retry
        Cooldown 60 secondes
    end note

    note right of HALF_OPEN
        Test de recovery
        1 seule requete autorisee
    end note
```

Le circuit breaker est instancie par provider dans la ProviderFactory. Le RetryPolicy gere les retries avec backoff exponentiel (1s, 2s, 4s). Les deux mecanismes sont combines : retry au sein d'un circuit CLOSED, fast-fail quand le circuit est OPEN.

---

## Classification des erreurs

```mermaid
flowchart TD
    Error[Erreur detectee] --> Classify{Type?}

    Classify -->|TIMEOUT| Retry[Retryable]
    Classify -->|NETWORK_ERROR| Retry
    Classify -->|RATE_LIMIT| Retry
    Classify -->|SERVICE_UNAVAILABLE| Retry

    Classify -->|VALIDATION_ERROR| Fatal[Non-retryable]
    Classify -->|AUTHENTICATION_ERROR| Fatal
    Classify -->|CONTRACT_REVERT| Fatal
    Classify -->|INSUFFICIENT_FUNDS| Fatal

    Retry --> CB{Circuit Breaker<br/>ouvert?}
    CB -->|Non| Backoff[Retry avec backoff<br/>1s, 2s, 4s]
    CB -->|Oui| Fallback[Fallback provider]

    Fatal --> LogFail[Log + Return error]
    Backoff -->|Succes| Continue[Continuer pipeline]
    Backoff -->|Echecs epuises| LogFail
    Fallback -->|Succes| Continue
    Fallback -->|Echec| LogFail

    style Continue fill:#90EE90
    style LogFail fill:#FF6B6B
```

Les erreurs retryables declenchent le backoff exponentiel (max 3 tentatives). Les erreurs fatales interrompent immediatement le pipeline. Le classifyError dans l'orchestrateur determine le type par inspection du message d'erreur.

---

## Stockage PostgreSQL

```mermaid
erDiagram
    rate_limits {
        varchar key PK
        timestamp last_request_time
    }

    executions {
        varchar execution_id PK
        varchar status
        timestamp start_time
        timestamp end_time
        jsonb input
        jsonb context
        jsonb result
    }

    circuit_breakers {
        varchar provider PK
        varchar state
        int failure_count
        timestamp last_failure_time
    }

    processed_events {
        varchar message_id PK
        int block_number
        timestamp processed_at
        varchar execution_id
        varchar status
    }

    processed_events }o--|| executions : "references"
```

`rate_limits` : 1 row par key, mise a jour a chaque requete (UPSERT). `executions` : log complet de chaque execution du pipeline. `circuit_breakers` : etat par provider, persiste entre redemarrages n8n. `processed_events` : idempotency pour l'event listener CCIP, evite le double-traitement.

---

## Deploiement

```mermaid
graph LR
    subgraph "n8n Instance (VPS)"
        WF1[API Gateway<br/>Webhook :5678]
        WF2[CCIP Event Listener<br/>Schedule 30s]
        WF3[Generic Orchestrator<br/>Sub-workflow]
    end

    subgraph "PostgreSQL"
        DB[(chainmesh_n8n<br/>rate_limits, executions<br/>circuit_breakers, processed_events)]
    end

    subgraph "External Services"
        Goldsky[Goldsky GraphQL]
        Alchemy[Alchemy RPC]
        Claude[Claude API]
        Lit[Lit Protocol]
    end

    subgraph "Module 1 - Blockchain"
        Sepolia[GenericOracle<br/>Sepolia]
        Arbitrum[GenericCache<br/>Arbitrum]
        Base[GenericCache<br/>Base]
    end

    WF1 --> WF3
    WF2 --> WF3
    WF3 --> DB
    WF3 --> Goldsky
    WF3 --> Alchemy
    WF3 --> Claude
    WF3 --> Lit
    WF3 --> Sepolia
    Sepolia <-->|CCIP| Arbitrum
    Sepolia <-->|CCIP| Base
```

Une seule instance n8n heberge les trois workflows. L'API Gateway expose un webhook HTTP, l'Event Listener poll le contrat Oracle. Les deux appellent le meme sub-workflow GenericOrchestrator. Toutes les donnees de persistence (rate limits, executions, circuit breakers, events traites) sont dans la meme base PostgreSQL.
