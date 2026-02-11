# Module 2 : Orchestration Off-Chain (n8n)
# Specification Fonctionnelle

**Version:** 1.0
**Date:** 10 fevrier 2026
**Status:** Implementation terminee
**Stack:** Node.js v24, TypeScript strict, n8n, PostgreSQL, Vitest, Winston, Zod v4, ethers v6

---

## 1. Vue d'ensemble

### 1.1 Responsabilites

Ce module orchestre les flux entre la blockchain (Module 1) et les services externes via un pipeline generique schema-agnostique.

**Fait :**
- Ecouter evenements blockchain et webhooks HTTP
- Router les requetes selon le schemaHash
- Coordonner appels paralleles vers providers de donnees
- Gerer retry logic et circuit breakers
- Signer les payloads avant mise a jour blockchain
- Logger les executions pour observabilite

**Ne fait PAS :**
- Stocker les donnees (Module 1 - Smart Contracts)
- Implementer la logique metier specifique (sub-workflows pluggables)
- Gerer les cles de signature (Module 4 - Lit Protocol)
- Indexer les blockchains (Module 5 - Goldsky)

### 1.2 Analogie SOA

| SOA Classique | ChainMesh Equivalent |
|---|---|
| TIBCO BusinessWorks | n8n Workflows |
| Process Definitions | Workflow JSON |
| Shared Resources | Sub-Workflows reutilisables |
| Service Endpoints | Webhooks |
| Message-Driven Bean | Event Listener |
| ActiveMQ | Chainlink CCIP |

### 1.3 Principe de genericite

Le Generic Orchestrator ne connait pas la structure des donnees. Il manipule uniquement :

| Champ | Type | Role |
|---|---|---|
| `key` | bytes32 | Identifiant unique |
| `schemaHash` | bytes32 | Type de donnees |
| `chains[]` | string[] | Blockchains a scanner |
| `includeAnalysis` | boolean | Flag pour analyse AI |

Ajouter un nouveau type de donnees = creer un nouveau sub-workflow, sans modifier l'orchestrateur.

---

## 2. Architecture

### 2.1 Hierarchie a 3 niveaux

**Level 1 — Entry Points (declencheurs) :**
- API Gateway : Webhook POST /api/query
- CCIP Event Listener : Poll QueryReceived toutes les 30s

**Level 2 — Generic Orchestrator (coordination) :**
- Validation input (Zod)
- Rate limiting (1 req/h/key)
- Routage par schemaHash
- Coordination sequentielle du pipeline

**Level 3 — Sub-Workflows pluggables :**
- DataProvider_MultiChain : Goldsky + Alchemy fallback
- Analyzer : HybridAnalyzer (AI x0.6 + Rules x0.4)
- Signer_MPC : Lit Protocol + DevWallet fallback
- ErrorHandler : CircuitBreaker + RetryPolicy
- Logger : Winston JSON structure

### 2.2 Isolation modulaire

Module 2 consomme uniquement des interfaces :

| Module | Interface | Protocole |
|---|---|---|
| Module 1 (Smart Contracts) | `updateData`, `sendResponse`, event `QueryReceived` | ethers.js Contract ABI |
| Module 3 (AI Engine) | `analyze(data)` → result | HTTP POST (axios) |
| Module 4 (Lit Protocol) | `signPayload(payload)` → signature | Lit SDK |
| Module 5 (Data Layer) | `query(address, chains)` → data | GraphQL (Goldsky) |

---

## 3. Entry Points

### 3.1 API Gateway

**Endpoint :** `POST /api/query`

**Payload GenericQueryRequest :**

| Champ | Type | Requis | Default |
|---|---|---|---|
| `key` | bytes32 hex | oui | — |
| `schemaHash` | bytes32 hex | oui | — |
| `chains` | string[] | oui (min 1) | — |
| `includeAnalysis` | boolean | non | `true` |
| `options.timeoutMs` | number | non | `180000` |
| `options.fallbackProviders` | boolean | non | `true` |
| `options.customConfig` | Record | non | — |
| `metadata.messageId` | bytes32 | non | — |
| `metadata.sourceChain` | string | non | — |
| `metadata.requester` | address | non | — |

**Chaines supportees :** `sepolia`, `arbitrum`, `base`, `optimism`

**Validation :**
1. `key` non vide, format `0x[a-fA-F0-9]{64}`
2. `schemaHash` meme format bytes32
3. `chains[]` non vide, valeurs dans SUPPORTED_CHAINS
4. `options.timeoutMs` entre 10000 et 300000

**Reponses HTTP :**

| Code | Type | Contenu |
|---|---|---|
| 200 | Succes | `{statusCode, data: {key, schemaHash, executionId, result}}` |
| 400 | Validation | `{statusCode, error: {type: VALIDATION_ERROR, message, field}}` |
| 500 | Execution | `{statusCode, error: {type: EXECUTION_ERROR, message, executionId}}` |

### 3.2 CCIP Event Listener

**Methode :** Polling `eth_getLogs` toutes les 30 secondes sur le contrat Oracle (Sepolia)

**Event ecoute :**

| Champ | Type | Indexed |
|---|---|---|
| `messageId` | bytes32 | oui (topics[1]) |
| `key` | bytes32 | oui (topics[2]) |
| `schemaHash` | bytes32 | non (data) |
| `sourceChain` | uint64 | non (data) |
| `requester` | address | non (data) |

**Idempotency :** Chaque `messageId` est stocke dans la table `processed_events` (PostgreSQL). Un event deja enregistre est ignore.

**Construction de la requete :** L'event decode est converti en `GenericQueryRequest` avec le `messageId` dans les metadata. Le `sourceChain` selector est mappe vers un nom de chaine.

---

## 4. Generic Orchestrator

### 4.1 Pipeline d'execution

| Etape | Composant | Erreur fatale | Sortie |
|---|---|---|---|
| 1. Validate | inputValidator (Zod) | oui | GenericQueryRequest |
| 2. Rate Limit | RateLimiter (PostgreSQL) | oui | — |
| 3. Fetch Data | ProviderFactory (fallback) | oui | DataProviderOutput |
| 4. Analyze | HybridAnalyzer (optionnel) | non | AnalyzerOutput |
| 5. Encode | ethers.hexlify(toUtf8Bytes(JSON)) | non | hex string |
| 6. Sign | SignerFactory (fallback) | oui | SignerOutput |
| 7. Oracle Update | oracleContract.updateData() | oui | txHash |
| 8. CCIP Response | oracleContract.sendResponse() | oui (si messageId) | — |

L'etape 4 est sautee si `includeAnalysis = false`. Les etapes 7-8 sont sautees si aucun `oracleContract` n'est configure. L'etape 8 est sautee si aucun `messageId` n'est present.

### 4.2 Contexte d'execution

Un objet `ExecutionContext` est cree au debut et enrichi a chaque etape :

| Champ | Type | Role |
|---|---|---|
| `executionId` | string | Identifiant unique `exec_{timestamp}_{random}` |
| `startTime` | ISO 8601 | Debut de l'execution |
| `input` | GenericQueryRequest | Input valide |
| `sourceModule` | string | `API_Gateway` ou `CCIP_EventListener` |
| `messageId` | bytes32 | Present si CCIP |
| `steps` | Record<string, StepResult> | Status + duration par etape |

Chaque `StepResult` contient : `status` (success/skipped/error), `duration` (ms), et des donnees specifiques a l'etape (provider, confidence, txHash, etc.).

### 4.3 Router

Le routeur matche le `schemaHash` dans une table de configuration et determine quels sub-workflows utiliser. Un schemaHash inconnu utilise la route default (DataProvider sans analyse).

### 4.4 Resultat

L'orchestrateur retourne un `OrchestratorResult` :

| Champ | Type | Cas succes | Cas erreur |
|---|---|---|---|
| `success` | boolean | `true` | `false` |
| `executionId` | string | present | present |
| `data.providerOutput` | DataProviderOutput | present | absent |
| `data.analyzerOutput` | AnalyzerOutput | present si analyse | absent |
| `data.signerOutput` | SignerOutput | present | absent |
| `data.encodedValue` | hex string | present | absent |
| `data.txHash` | hex string | present si oracle | absent |
| `error.type` | string | absent | type d'erreur |
| `error.message` | string | absent | description |
| `error.step` | string | absent | etape echouee |
| `context` | ExecutionContext | complet | partiel |

---

## 5. Sub-Workflows

### 5.1 DataProvider_MultiChain

**Requetage parallele :** Les chains sont interrogees simultanement. Timeout individuel : 10s. Timeout global : 30s.

**Cascade de fallback :**

| Priorite | Provider | Type | Timeout |
|---|---|---|---|
| 1 | Goldsky | GraphQL indexeur | 10s |
| 2 | Alchemy | RPC enrichi | 10s |
| 3 | Public RPC | RPC standard | 10s |

Chaque provider a son propre circuit breaker. Si le circuit est OPEN, le provider est saute directement.

**Donnees partielles :**
- >= 50% des chains en succes → continuer avec warning (`partialData: true`)
- < 50% des chains en succes → erreur fatale

**Format de sortie DataProviderOutput :**

| Champ | Type |
|---|---|
| `data` | Record<string, unknown> (structure libre) |
| `metadata.chains` | string[] |
| `metadata.timestamp` | ISO 8601 |
| `metadata.provider` | string |
| `metadata.queryDuration` | number (ms) |
| `metadata.partialData` | boolean |
| `metadata.successRate` | number (0-1) |
| `metadata.warnings` | string[] |

**Normalisation :** Timestamps en ISO 8601 UTC, addresses en lowercase, values en string (pas de float).

### 5.2 Analyzer

**Architecture pluggable :** Le schemaHash determine l'analyzer utilise.

| Analyzer | Methode | Deterministe | Cout |
|---|---|---|---|
| ClaudeAnalyzer | Claude API (HTTP POST) | non | tokens API |
| RulesAnalyzer | Heuristiques score 50 base + bonuses/penalties | oui | zero |
| HybridAnalyzer | AI x0.6 + Rules x0.4 | non | tokens API |

**Heuristiques RulesAnalyzer :** Score base 50, +10 si wallet > 2 ans, +10 si txCount > 100, +10 si txCount > 1000, +15 si defiProtocols > 3, -20 si liquidations. Clampe 0-100.

**Scoring hybride :** `finalScore = (aiScore * 0.6) + (rulesScore * 0.4)`. L'AI capture les patterns complexes, les rules fournissent une baseline objective.

**Format de sortie AnalyzerOutput :**

| Champ | Type |
|---|---|
| `result` | unknown (structure libre selon schemaHash) |
| `confidence` | number (0-1) |
| `reasoning` | string |
| `metadata.model` | string (optionnel) |
| `metadata.method` | string (optionnel) |
| `metadata.processingTime` | number (ms) |
| `metadata.tokensUsed` | number (optionnel) |

**Fallback :** Si l'AI echoue, le HybridAnalyzer tombe sur le RulesAnalyzer seul.

### 5.3 Signer_MPC

**Flow :**
1. Construire le payload : `{key, value, schemaHash, timestamp}`
2. Signer via Lit Protocol PKP (MPC, ~100 noeud)
3. Valider le format de la signature (65 bytes hex)

**Fallback testnet :** Si Lit Protocol est indisponible et `ENVIRONMENT = testnet`, utiliser un `ethers.Wallet` local (DevWalletSigner). Interdit en production.

**Format de sortie SignerOutput :**

| Champ | Type |
|---|---|
| `signature` | hex string (0x + 130 chars = 65 bytes) |
| `signingTime` | number (ms) |
| `pkpPublicKey` | string |

---

## 6. Error Handling

### 6.1 Retry Policy

| Parametre | Valeur |
|---|---|
| Max retries | 3 |
| Delay initial | 1000 ms |
| Multiplicateur | x2 |
| Delay max | 10000 ms |
| Schedule | 1s, 2s, 4s |

### 6.2 Circuit Breaker

| Parametre | Valeur |
|---|---|
| Threshold | 3 echecs consecutifs |
| Cooldown | 60 secondes |
| Reset | 1 succes apres cooldown |
| Etats | CLOSED → OPEN → HALF_OPEN → CLOSED |

**CLOSED :** Operation normale. **OPEN :** Fast-fail sans retry pendant 60s. **HALF_OPEN :** 1 requete de test autorisee — succes = retour CLOSED, echec = retour OPEN.

### 6.3 Classification des erreurs

| Type | Retryable | Action |
|---|---|---|
| `TIMEOUT` | oui | Retry + backoff |
| `NETWORK_ERROR` | oui | Retry + backoff |
| `RATE_LIMIT_EXCEEDED` | oui | Retry apres cooldown |
| `SERVICE_UNAVAILABLE` | oui | Retry + fallback provider |
| `VALIDATION_ERROR` | non | Fail immediat |
| `AUTHENTICATION_ERROR` | non | Fail + alert |
| `CONTRACT_REVERT` | non | Fail + log revert reason |
| `INSUFFICIENT_FUNDS` | non | Fail + alert |
| `CIRCUIT_BREAKER_OPEN` | non | Fast-fail |
| `EXECUTION_ERROR` | non | Fail (defaut) |

### 6.4 Timeouts par niveau

| Niveau | Timeout | Justification |
|---|---|---|
| Provider query (single) | 10s | Eviter hang sur provider lent |
| DataProvider (total) | 30s | Queries paralleles + fallbacks |
| Analyzer | 60s | Claude API peut prendre 20-40s |
| Signer | 5s | Lit Protocol rapide (~500ms) |
| Oracle transaction | 120s | Confirmation blockchain |
| **Global workflow** | **180s** | Total acceptable pour cache miss |

---

## 7. Observabilite

### 7.1 Logging

Format : JSON structure via Winston. Chaque log contient : `timestamp`, `level`, `executionId`, `module`, `event`, `data`.

**Events critiques :**

| Event | Level | Declencheur |
|---|---|---|
| `WORKFLOW_START` | INFO | Debut d'execution |
| `WORKFLOW_SUCCESS` | INFO | Fin succes |
| `WORKFLOW_ERROR` | ERROR | Fin erreur |
| `DATA_FETCH_SUCCESS` | INFO | Donnees recuperees |
| `PROVIDER_TIMEOUT` | WARN | Timeout provider |
| `PROVIDER_FALLBACK` | WARN | Switch vers fallback |
| `CIRCUIT_BREAKER_OPEN` | WARN | Circuit ouvert |
| `ANALYSIS_SUCCESS` | INFO | Analyse terminee |
| `ANALYZER_LOW_CONFIDENCE` | WARN | Confidence < threshold |
| `SIGN_SUCCESS` | INFO | Signature OK |
| `ORACLE_UPDATE_SUCCESS` | INFO | Transaction confirmee |
| `CCIP_RESPONSE_SUCCESS` | INFO | Reponse CCIP envoyee |
| `RATE_LIMIT_EXCEEDED` | WARN | Requete rejetee |

### 7.2 Tracing

L'`executionId` est genere a l'entry point et propage a tous les sub-workflows et logs. Permet de filtrer tous les logs d'une execution.

### 7.3 Metriques cibles

| Metrique | Seuil d'alerte |
|---|---|
| Workflow success rate | < 90% |
| Temps d'execution moyen | > 200s |
| Provider timeout rate | > 20% |
| Analyzer confidence moyenne | < 0.6 |
| Circuit breaker opens | > 5/heure |
| Rate limit hits | > 100/heure |

---

## 8. Stockage PostgreSQL

### 8.1 Tables

| Table | Cle primaire | Role |
|---|---|---|
| `rate_limits` | `key` (varchar) | Timestamp derniere requete par key |
| `executions` | `execution_id` (varchar) | Log complet de chaque execution (input, context, result en JSONB) |
| `circuit_breakers` | `provider` (varchar) | Etat circuit breaker par provider |
| `processed_events` | `message_id` (varchar) | Idempotency pour CCIP events |

### 8.2 Rate limiting

Table `rate_limits` : UPSERT sur `key` avec `last_request_time = NOW()`. Verification : `NOW() - last_request_time >= 1 heure`.

### 8.3 Idempotency

Table `processed_events` : INSERT avec `ON CONFLICT DO NOTHING`. Colonnes : `message_id`, `block_number`, `processed_at`, `execution_id`, `status`.

---

## 9. Configuration

### 9.1 Variables d'environnement

| Categorie | Variables |
|---|---|
| Database | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` |
| Blockchain | `ALCHEMY_API_KEY`, `SEPOLIA_RPC`, `ARBITRUM_RPC`, `BASE_RPC` |
| Contrats | `ORACLE_ADDRESS_SEPOLIA`, `CACHE_ADDRESS_ARBITRUM`, `CACHE_ADDRESS_BASE` |
| APIs | `CLAUDE_API_KEY`, `GOLDSKY_ENDPOINT`, `LIT_PKP_PUBLIC_KEY` |
| n8n | `N8N_HOST`, `N8N_PORT`, `N8N_PROTOCOL`, `N8N_WEBHOOK_URL` |
| CCIP | `CCIP_ROUTER_SEPOLIA`, `CCIP_ROUTER_ARBITRUM_SEPOLIA`, `CHAIN_SELECTOR_SEPOLIA`, `CHAIN_SELECTOR_ARBITRUM_SEPOLIA` |
| Application | `ENVIRONMENT` (testnet/production), `LOG_LEVEL`, `NODE_ENV`, `PORT` |

Toutes les variables sont validees au demarrage par un schema Zod. Une configuration invalide empeche le lancement.

### 9.2 Defaults

| Variable | Default |
|---|---|
| `POSTGRES_HOST` | localhost |
| `POSTGRES_PORT` | 5432 |
| `POSTGRES_DB` | chainmesh_n8n |
| `N8N_PORT` | 5678 |
| `PORT` | 3000 |
| `ENVIRONMENT` | testnet |
| `LOG_LEVEL` | info |
| `includeAnalysis` | true |
| `timeoutMs` | 180000 |
| `fallbackProviders` | true |

---

## 10. Contraintes non-fonctionnelles

| Contrainte | Cible |
|---|---|
| Latence off-chain | < 3 minutes |
| Disponibilite | 99% (n8n self-hosted VPS) |
| Retry policy | 3x avec backoff exponentiel |
| Circuit breaker | 3 echecs → 1 min cooldown |
| Logging | JSON structure, executionId systematique |
| Rate limiting | 1 req/heure/key (aligne Module 1) |
| Validation | Zod strict en entree et en sortie |
| Tests | Vitest, coverage > 80% |
