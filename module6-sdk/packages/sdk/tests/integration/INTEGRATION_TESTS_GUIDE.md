# Guide : Tests d'intégration Module 6 SDK ↔ Anvil

## Vue d'ensemble

Tests d'intégration qui déploient de vrais contrats Solidity sur Anvil (blockchain locale) et testent le SDK TypeScript contre ces contrats.

**Statut : Phase 1 + Phase 2 + Phase 3 terminées - 52 tests passent (7 fichiers, ~35s).**

## Prérequis

- **Anvil** (Foundry) : `~/.foundry/bin/anvil` - version 1.5.1+
- **Artifacts Foundry compilés** dans `module1-blockchain/contracts/out/` :
  - `GenericCache.sol/GenericCache.json`
  - `GenericOracle.sol/GenericOracle.json`
  - `MockCCIPRouter.sol/MockCCIPRouter.json`
- **Node.js v24**, ethers v6, Vitest, Zod v4.3.6

Si les artifacts ne sont pas compilés :
```bash
cd module1-blockchain/contracts && forge build
```

## Architecture des tests

```
module6-sdk/packages/sdk/tests/integration/
├── anvil-setup.ts                              # setupAnvil/releaseAnvil/deliverCCIPResponse
├── sdk-contracts.integration.test.ts           # Phase 1 - Tests 1-3 : Cache, Oracle, adapters (8 cases)
├── sdk-ccip.integration.test.ts                # Phase 1 - Tests 4-6 : requestData, TTL, rate limit (5 cases)
├── pipeline-helpers.ts                         # Phase 2 - Factories, mocks, utils pour le pipeline Module 2
├── pipeline-basic.integration.test.ts          # Phase 2 - Tests 7-9 : validation, rate limit, data flow (10 cases)
├── pipeline-analysis.integration.test.ts       # Phase 2 - Tests 10-11 : RulesAnalyzer, HybridAnalyzer (5 cases)
├── pipeline-oracle-ccip.integration.test.ts    # Phase 2 - Tests 12-14 : oracle write, CCIP, SDK round-trip (7 cases)
├── e2e-helpers.ts                              # Phase 3 - MockApiGateway, simulateCCIPRoundTrip, createE2ESDK
├── e2e-api-gateway.integration.test.ts         # Phase 3 - Tests 15-17 : SDK→API→Oracle→SDK (8 cases)
├── e2e-ccip-roundtrip.integration.test.ts      # Phase 3 - Tests 18-20 : full CCIP round-trip E2E (9 cases)
└── INTEGRATION_TESTS_GUIDE.md                  # Ce guide
```

### anvil-setup.ts - Infrastructure

Fournit :
- `setupAnvil()` - lance Anvil sur port 8546, déploie les 3 contrats, retourne `DeployedContracts`
- `releaseAnvil()` - arrête le process Anvil
- `deliverCCIPResponse()` - simule une réponse CCIP de l'Oracle vers le Cache
- Constantes : `ANVIL_RPC_URL`, `ANVIL_PRIVATE_KEY`, chain selectors
- Aliases : `startAnvil = setupAnvil`, `stopAnvil = releaseAnvil`

**Architecture interne (résolution du bug nonce) :**
```
setupAnvil():
  1. Kill tout process sur port 8546
  2. Spawn Anvil, attendre qu'il soit prêt
  3. deployContracts():
     - deployProvider + NonceManager(wallet)  → déploie 3 contrats + 2 setup txs
     - testProvider (cacheTimeout: -1) + wallet → retourné aux tests
```

Le `NonceManager` est utilisé uniquement pendant le déploiement, puis un provider+wallet frais (sans cache nonce) est créé pour les tests. Cela évite le bug de nonce stale d'ethers v6.

### Contrats déployés sur Anvil

| Contrat | Constructeur | Rôle |
|---------|-------------|------|
| MockCCIPRouter | (aucun) | Simule le routeur CCIP Chainlink |
| GenericOracle | (router) | Oracle key-value sur "Sepolia" |
| GenericCache | (router, oracleAddress, oracleChainSelector) | Cache TTL sur "consumer chain" |

**Setup post-déploiement :**
- Oracle : `grantRole(UPDATER_ROLE, signer)` - pour `updateData()`
- Oracle : `whitelistChain(CACHE_CHAIN_SELECTOR)` - pour recevoir des requêtes

### Configuration du SDK pour les tests

```typescript
const sdk = new ChainMeshSDK({
  chains: {
    'local-anvil': {
      rpcUrl: 'http://127.0.0.1:8546',
      cacheAddress: contracts.cacheAddress,
    },
  },
  oracle: {
    rpcUrl: 'http://127.0.0.1:8546',
    address: contracts.oracleAddress,
  },
  defaultChain: 'local-anvil',
});
```

## Les 6 tests de la Phase 1

### Tests 1-3 (sdk-contracts.integration.test.ts) - 8 test cases

1. **SDK ↔ GenericCache** (2 tests) : cache miss (→ `0x`, `needsUpdate=true`), puis cache hit après `deliverCCIPResponse()`
2. **SDK ↔ GenericOracle** (2 tests) : écriture via `updateData()`, lecture via `sdk.getOracleData()` ; clé inexistante → `isValid=false`
3. **Adapter cross-validation** (4 tests) : encode JS → écriture on-chain → lecture on-chain → decode JS. Pour ReputationAdapter ET PriceAdapter, via Oracle ET Cache.

### Tests 4-6 (sdk-ccip.integration.test.ts) - 5 test cases

4. **requestData()** (2 tests) : le signer envoie une tx `requestData()` avec CCIP fee (0.01 ETH), vérifie event `DataQueried` + messageId non-zero ; fee insuffisant → revert
5. **Cache TTL** (1 test) : écriture via `deliverCCIPResponse`, vérification fresh (`needsUpdate=false`), `evm_increaseTime(25h)` + `evm_mine`, vérification stale (`needsUpdate=true`, valeur toujours lisible)
6. **Rate limiting** (2 tests) : deux `requestData()` consécutifs sur la même clé → second revert `RateLimitExceeded` ; après `evm_increaseTime(1h+)` → second réussit

## Commande pour lancer les tests

```bash
cd module6-sdk/packages/sdk
npx vitest run tests/integration/ --reporter=verbose
```

## Configuration Vitest importante

`vitest.config.ts` contient `fileParallelism: false` - **obligatoire** pour les tests d'intégration car :
- Chaque fichier de test lance/kill Anvil sur le même port 8546
- L'exécution parallèle causerait des conflits de port et de nonce

## Détails techniques importants

- **Anvil port** : 8546 (non-standard, évite les conflits avec d'autres services)
- **Anvil account #0** : `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (clé privée : `0xac0974bec...`)
- **MockCCIPRouter.fee** : `0.01 ether` par défaut
- **CACHE_TTL** : 24 heures (86400 secondes)
- **MIN_REQUEST_INTERVAL** : 1 heure (3600 secondes)
- **ethers v6 nonce bug** : toujours utiliser `NonceManager` pour le déploiement, et `cacheTimeout: -1` sur le provider de test
- **Zod v4 quirk** : `z.record(z.string(), z.unknown())` - PAS `z.record(z.unknown())`
- Le SDK utilise des `JsonRpcProvider` (read-only). Pour les tests qui nécessitent des transactions (requestData), il faut un `Wallet` signé connecté au contrat.

---

## Phase 2 : Pipeline Module 2 sans mocks internes (22 tests)

### Concept

Phase 2 teste le pipeline d'orchestration Module 2 (`WorkflowOrchestrator`) de bout en bout en utilisant les vrais composants TypeScript avec des dépendances injectées :

| Composant | Réel ou Mock | Raison |
|-----------|-------------|--------|
| WorkflowOrchestrator | **Réel** | Système sous test |
| RulesAnalyzer | **Réel** | Déterministe, pas de dépendances externes |
| HybridAnalyzer | **Réel** (avec mock Claude) | Teste la logique de combinaison |
| DevWalletSigner | **Réel** | Signe avec la clé Anvil |
| RateLimiter | **Réel** (InMemoryBackend) | Teste le rate limiting |
| Contrats sur Anvil | **Réels** | Oracle write/read, CCIP |
| SDK (ChainMeshSDK) | **Réel** | Vérifie les lectures on-chain |
| GoldskyProvider | **Mock** | Pas d'appel API externe |
| ClaudeAnalyzer | **Mock** | Pas d'appel API Claude |
| LitSigner | **Skipped** (CB ouvert) | Fallback sur DevWallet |
| PostgreSQL | **Remplacé** par InMemory | Pas de DB nécessaire |

### pipeline-helpers.ts - Infrastructure Phase 2

Fournit :
- `MockProviderFactory` - retourne des données contrôlées via `queryWithFallback()`
- `MockClaudeAnalyzer` - retourne un score configurable ou throw
- `createTestSignerFactory()` - SignerFactory avec CircuitBreaker Lit pré-ouvert → fallback DevWallet
- `createTestRateLimiter(windowMs)` - RateLimiter avec InMemoryRateLimiterStorage
- `createTestLogger()` - Logger Winston silencieux
- `createOracleContractAdapter(contract)` - adapte ethers.Contract → interface OracleContract
- `createTestOrchestrator(opts)` - factory complète assembles tous les composants
- `createTestQueryInput(overrides?)` - génère un GenericQueryRequest valide

**Données mock par défaut** (RulesAnalyzer → score 95) :
```
walletAge: 3 ans (+10), txCount: 500 (+10), defiProtocols: 4 (+15), liquidations: 0, chainCount: 3 (+10)
Base 50 + 10 + 10 + 15 + 10 = 95 → tier "prime"
```

### Tests 7-9 (pipeline-basic.integration.test.ts) - 10 tests, pas d'Anvil

7. **Validation des entrées** (4 tests) : input valide passe ; key manquant, schemaHash invalide, chains vide → VALIDATION_ERROR
8. **Rate limiting pipeline** (3 tests) : première requête passe ; même clé bloquée ; clé différente passe
9. **Data provider flow** (3 tests) : output capturé ; provider en échec → pipeline s'arrête ; `includeAnalysis: false` → analyzer skipped

### Tests 10-11 (pipeline-analysis.integration.test.ts) - 5 tests, pas d'Anvil

10. **RulesAnalyzer** (3 tests) : score élevé 95/prime ; score bas 50/standard ; pénalité liquidation 30/basic
11. **HybridAnalyzer** (2 tests) : AI 60% + Rules 40% → score 81 ; Claude fail → fallback rules-only → 95

### Tests 12-14 (pipeline-oracle-ccip.integration.test.ts) - 7 tests, Anvil requis

12. **Pipeline → Oracle → SDK** (3 tests) : pipeline écrit sur Oracle ; SDK relit `isValid=true` ; decode round-trip match
13. **CCIP response** (2 tests) : pipeline avec messageId → `sendResponse` success (nécessite de fonder l'Oracle en ETH pour les CCIP fees) ; sans messageId → step absent
14. **Round-trip complet** (2 tests) : sans analyse → providerOutput encodé/décodé ; avec analyse → analyzerOutput encodé/décodé

**Note test 13a** : Le contrat Oracle a besoin d'ETH pour payer les fees CCIP lors du `sendResponse()`. Le test envoie 0.02 ETH au contrat avant d'exécuter le pipeline. De plus, il faut d'abord délivrer le message CCIP à l'Oracle via `router.deliverMessage()` pour que `queryRequests[messageId]` soit rempli.

---

## Phase 3 : E2E tests SDK → API → Oracle → Cache (17 tests)

### Concept

Phase 3 teste le flux complet de bout en bout : le SDK appelle une API Gateway HTTP, qui exécute le pipeline WorkflowOrchestrator, écrit sur l'Oracle, et le SDK relit les données. Inclut aussi le round-trip CCIP complet (Cache → Oracle → Pipeline → sendResponse → Cache).

L'API Gateway n8n est remplacée par un **MockApiGateway** (serveur HTTP Node.js `http` module, port aléatoire) qui :
- Reçoit `POST /api/query`
- Parse le body JSON
- Crée un `WorkflowOrchestrator` via `createTestOrchestrator()`
- Transforme `OrchestratorResult` → `QueryResult` (format SDK)
- Retourne 200/400/500

### e2e-helpers.ts - Infrastructure Phase 3

Fournit :
- `MockApiGateway` - serveur HTTP mock, `start()`/`stop()`/`url`
- `simulateCCIPRoundTrip(params)` - exécute le flux complet : `cache.requestData()` → `router.deliverMessage()` → fund Oracle → `orchestrator.execute(input with messageId)`
- `deliverOracleResponseToCache(contracts, messageId, key, schemaHash)` - lit la valeur depuis Oracle et la délivre au Cache via CCIP
- `createE2ESDK(contracts, apiUrl?)` - factory SDK configuré pour les tests E2E

### Tests 15-17 (e2e-api-gateway.integration.test.ts) - 8 tests, Anvil requis

15. **SDK → API Gateway → Oracle** (3 tests) : `sdk.query()` déclenche le pipeline complet ; SDK relit depuis Oracle ; avec analyse → score 95/prime
16. **Error handling** (3 tests) : input invalide → `ApiError` ; provider en échec → `ApiError` ; API injoignable → `ApiError`
17. **Domain accessors** (2 tests) : reputation write → Oracle readable ; price write → Oracle readable

### Tests 18-20 (e2e-ccip-roundtrip.integration.test.ts) - 9 tests, Anvil requis

18. **Full CCIP round-trip** (3 tests) : Cache.requestData → CCIP → Oracle → Pipeline(updateData+sendResponse) → CCIP → Cache.ccipReceive → SDK lit cached data (`isFromCache=true`) ; decode round-trip match ; avec analyse
19. **CCIP + Cache TTL** (3 tests) : données fraîches après CCIP ; stale après 25h (`needsUpdate=true`) ; nouveau requestData réussit après TTL + rate limit expiry
20. **SDK convenience accessors** (3 tests) : reputation CCIP round-trip ; price CCIP round-trip ; 3 requêtes séquentielles sur des clés différentes → toutes cachées indépendamment

---

## Fichiers source clés à relire si besoin

- `module6-sdk/packages/sdk/src/ChainMeshSDK.ts` - le SDK
- `module6-sdk/packages/sdk/src/adapters/ReputationAdapter.ts` - encode/decode reputation
- `module6-sdk/packages/sdk/src/adapters/PriceAdapter.ts` - encode/decode price
- `module6-sdk/packages/sdk/src/contracts/abis.ts` - ABIs minimales du SDK
- `module6-sdk/packages/sdk/src/types.ts` - types, schemas Zod, erreurs
- `module1-blockchain/contracts/src/GenericCache.sol` - contrat cache
- `module1-blockchain/contracts/src/GenericOracle.sol` - contrat oracle
- `module1-blockchain/contracts/test/mocks/MockCCIPRouter.sol` - mock CCIP router
- `module2-orchestration/src/orchestrator/WorkflowOrchestrator.ts` - pipeline principal
- `module2-orchestration/src/orchestrator/RateLimiter.ts` - rate limiter + InMemoryStorage
- `module2-orchestration/src/analyzers/RulesAnalyzer.ts` - analyse déterministe
- `module2-orchestration/src/analyzers/HybridAnalyzer.ts` - combine AI + Rules
- `module2-orchestration/src/signers/SignerFactory.ts` - factory Lit→DevWallet
- `module2-orchestration/src/signers/DevWalletSigner.ts` - signer testnet
