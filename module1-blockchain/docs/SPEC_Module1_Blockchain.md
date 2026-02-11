# Module 1 : Smart Contracts (Blockchain Layer)
# Spécification Fonctionnelle Détaillée

**Version:** 2.0
**Date:** 8 février 2026
**Status:** ✅ Implémenté (GenericOracle + GenericCache + Adapters)
**Architecture:** Infrastructure générique (pas application spécifique)

---

## 1. Vue d'Ensemble du Module

### 1.1 Responsabilités

**Ce que fait ce module :**
- Infrastructure générique key-value storage on-chain
- Recevoir requêtes cross-chain via CCIP (depuis consumer chains)
- Stocker données génériques avec schema versioning
- Envoyer réponses CCIP aux consumer chains
- Gérer cache TTL local sur chaque consumer chain (24h)
- Support adapters pluggables pour différents types de données

**Ce que ce module NE fait PAS :**
- ❌ Analyser les données (fait off-chain)
- ❌ Scanner les blockchains (fait par Module 5)
- ❌ Orchestrer les workflows (fait par Module 2 - n8n)
- ❌ Signer avec MPC (fait par Module 4 - Lit Protocol)

**Dépendances externes :**
- Chainlink CCIP (cross-chain messaging)
- OpenZeppelin (AccessControl, ReentrancyGuard)

---

### 1.2 Architecture Générique

```
┌─────────────────────────────────────────────────────────────┐
│                    Consumer Chain (Arbitrum)                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GenericCache (TTL 24h + Rate Limiting)                │ │
│  │  - Cache hit/miss/stale logic                          │ │
│  │  - Default values per schema                           │ │
│  │  - Rate limiting per-key (1 req/hour)                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                   │
│                           │ CCIP Request                      │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Oracle Chain (Sepolia)                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GenericOracle (Storage + CCIP)                        │ │
│  │  - Key-value storage générique                         │ │
│  │  - Schema versioning (bytes32 schemaHash)              │ │
│  │  - CCIP receiver/sender                                │ │
│  │  - Access control (UPDATER_ROLE)                       │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Adapters (Pluggable)
                            ▼
                    ┌──────────────┐
                    │ IDataAdapter │
                    ├──────────────┤
                    │ Reputation   │
                    │ Price        │
                    │ Custom...    │
                    └──────────────┘
```

**Interfaces exposées :**
- GenericOracle: `updateData()`, `getData()`, `sendResponse()`
- GenericCache: `getData()`, `requestData()`
- IDataAdapter: `getSchemaHash()`, `getDefaultValue()`

---

### 1.3 Contraintes Non-Fonctionnelles (NFR)

| Contrainte | Target | Mesure | Actuel |
|------------|--------|--------|---------|
| **Performance** | Gas < 200k par updateData | `forge test --gas-report` | ~171k ✅ |
| **Sécurité** | 0 vulnérabilités critiques | Tests + patterns | ✅ |
| **Coverage** | > 80% code coverage | `forge coverage` | 97.10% ✅ |
| **Tests** | 100% pass rate | `forge test` | 123 tests ✅ |
| **Scalabilité** | Support schemas multiples | Architecture | Illimité ✅ |

---

## 2. GenericOracle (Contrat Principal)

### 2.1 Rôle et Responsabilités

**Concept clé :** Infrastructure générique, pas application spécifique.

**Responsabilités :**
- Stocker données key-value avec schema versioning
- Recevoir messages CCIP depuis consumer chains
- Authentifier sources (anti-spoofing)
- Tracker requêtes (messageId mapping)
- Envoyer réponses CCIP

**Localisation :** Sepolia (Oracle chain unique)

**Fichier :** `contracts/src/GenericOracle.sol` (373 lignes)

---

### 2.2 State Management

#### 2.2.1 Generic Data Storage

**Structure DataEntry :**
```solidity
struct DataEntry {
    bytes32 key;           // Unique identifier
    bytes32 schemaHash;    // Schema version (e.g., keccak256("ReputationV1"))
    uint32 timestamp;      // Last update timestamp
    bool isValid;          // Entry validity flag
}
```

**Storage pattern :**
- `mapping(bytes32 => DataEntry) public dataEntries` - Métadonnées
- `mapping(bytes32 => bytes) public dataValues` - Données encodées

**Pourquoi séparé :**
- Évite packing issues avec bytes dynamiques
- Permet accès séparé (gas optimized)

**Schema Versioning :**
- Chaque adapter définit un `schemaHash` unique
- Exemple: `keccak256("ReputationV1")`, `keccak256("PriceV1")`
- Permet coexistence de multiples data types
- Facilite évolution (V1 → V2)

---

#### 2.2.2 Query Tracking

**Structure QueryRequest :**
```solidity
struct QueryRequest {
    address requester;     // Who requested
    uint64 sourceChain;    // Source chain selector
    uint32 requestedAt;    // When requested
    bool processed;        // If already processed
}
```

**Mapping :** `mapping(bytes32 => QueryRequest) public queryRequests`

**Replay Protection :** `mapping(bytes32 => bool) public processedMessages`

---

#### 2.2.3 Access Control

**Rôles :**
- `DEFAULT_ADMIN_ROLE` : Deployer (grant/revoke roles)
- `UPDATER_ROLE` : Off-chain updater (updateData)
- `PAUSER_ROLE` : Emergency pause

**Configuration initiale :**
1. Constructor : Deployer obtient DEFAULT_ADMIN_ROLE
2. Post-deployment : Grant UPDATER_ROLE à updater wallet
3. Whitelist chains : `whitelistChain(chainSelector)`

---

### 2.3 Fonctions Publiques

#### 2.3.1 updateData()

**Signature :**
```solidity
function updateData(bytes32 key, bytes memory value, bytes32 schemaHash)
    external onlyRole(UPDATER_ROLE);
```

**Comportement :**
1. **Validation :** key non nul, value non vide, schemaHash non nul
2. **State Change :** Créer/overwrite DataEntry + dataValues
3. **Event :** `DataUpdated(key, schemaHash, timestamp)`

**Gas Target :** ~171k gas (mesure actuelle)

**Cas d'usage :**
- Via adapter: `ReputationAdapter.updateReputation()` → encode → `updateData()`
- Direct: Pour données custom

---

#### 2.3.2 getData()

**Signature :**
```solidity
function getData(bytes32 key)
    external view
    returns (
        bytes memory value,
        uint32 timestamp,
        bytes32 schemaHash,
        bool isValid
    );
```

**Comportement :**
- Pure lecture (view function)
- Retourne données + métadonnées
- Si key inexistant → `isValid = false`, autres valeurs = default

---

#### 2.3.3 sendResponse()

**Signature :**
```solidity
function sendResponse(bytes32 messageId, bytes32 key)
    external onlyRole(UPDATER_ROLE)
    returns (bytes32 responseMessageId);
```

**Flow :**
1. Lookup QueryRequest via messageId
2. Validation : query existe, pas processed, data valide
3. Build CCIP message avec données
4. Calculate fees
5. Send CCIP
6. Mark processed
7. Emit `ResponseSent`

**Gas Target :** ~110k gas

---

### 2.4 Gestion CCIP

#### 2.4.1 Réception Messages (_ccipReceive)

**Flow :**
1. **Authentification :** Vérifier sourceChain whitelisté
2. **Replay Protection :** Check processedMessages mapping
3. **Décodage :** `abi.decode(message.data, (bytes32, bytes32, address))`
   - key : Clé demandée
   - schemaHash : Schema du data
   - requester : Cache qui demande
4. **Storage :** Créer QueryRequest
5. **Event :** `QueryReceived(messageId, key, schemaHash, sourceChain, requester)`

---

#### 2.4.2 Fees Management

**Funding :**
- Contract reçoit ETH via `receive() external payable {}`
- Admin fund manuellement

**Withdrawal :**
- `withdraw(address payable to, uint256 amount)` (onlyRole ADMIN)

---

### 2.5 Sécurité

**Patterns appliqués :**
- ✅ ReentrancyGuard (OpenZeppelin)
- ✅ AccessControl (OpenZeppelin)
- ✅ CEI Pattern (Checks-Effects-Interactions)
- ✅ Custom Errors (gas optimized)
- ✅ Replay Protection (processedMessages mapping)

---

## 3. GenericCache (Contrat Consumer)

### 3.1 Rôle et Responsabilités

**Concept :** Cache TTL générique avec rate limiting.

**Responsabilités :**
- Stocker cache local (TTL 24h)
- Fournir default values (configurables par schema)
- Rate limiting per-key (1 req/hour)
- Envoyer requêtes CCIP vers Oracle
- Recevoir réponses CCIP

**Localisation :** Chaque consumer chain (Arbitrum, Base, Optimism)

**Fichier :** `contracts/src/GenericCache.sol` (268 lignes)

---

### 3.2 Cache Management

#### 3.2.1 Cache Structure

**CachedData :**
```solidity
struct CachedData {
    bytes32 key;
    bytes value;           // Encoded data (schema-specific)
    uint32 timestamp;      // Source Oracle timestamp
    uint256 expiryTime;    // Local cache expiry
    bytes32 schemaHash;
    bool isValid;
}
```

**Mapping :** `mapping(bytes32 => CachedData) public cache`

---

#### 3.2.2 TTL Strategy

**Valeur :** 24 heures (86400 secondes)

**États :**
- **Fresh :** `block.timestamp <= expiryTime` + `isValid == true`
- **Stale :** `block.timestamp > expiryTime` + `isValid == true`
- **Miss :** `isValid == false`

---

#### 3.2.3 Default Values

**Pattern :**
- `mapping(bytes32 => bytes) public defaultValues` (per schema)
- Configuré par admin via `setDefaultValue(schemaHash, defaultValue)`
- Retourné lors de cache miss

**Exemples :**
- ReputationV1: `abi.encode(uint8(60), bytes32(0))` (score 60)
- PriceV1: `abi.encode(uint256(0), uint8(18))` (prix 0, 18 decimals)

---

### 3.3 Fonctions Publiques

#### 3.3.1 getData()

**Signature :**
```solidity
function getData(bytes32 key)
    external view
    returns (bytes memory value, bool isFromCache, bool needsUpdate);
```

**Comportement multi-cas :**
- **Cache Fresh :** `(cachedValue, true, false)` + emit `CacheHit(key, true)`
- **Cache Stale :** `(cachedValue, true, true)` + emit `CacheHit(key, false)`
- **Cache Miss :** `(defaultValue, false, true)` + emit `CacheMiss(key)`

---

#### 3.3.2 requestData()

**Signature :**
```solidity
function requestData(bytes32 key, bytes32 schemaHash)
    external payable
    returns (bytes32 messageId);
```

**Flow :**
1. **Rate Limiting :** Check lastRequestTime[key] (1 hour interval)
2. **Build CCIP Message :** receiver = oracleAddress, data = encode(key, schemaHash, msg.sender)
3. **Calculate Fees :** `router.getFee()`
4. **Validate Payment :** `msg.value >= fees`
5. **Send CCIP**
6. **Track :** `pendingRequests[messageId] = key`
7. **Refund :** Si `msg.value > fees`

**Gas Target :** ~110k gas

**Rate Limiting :** Per-key (pas per-user) pour éviter DoS sur keys populaires

---

### 3.4 Réception Responses CCIP

**Authentification critique :**
1. `message.sourceChainSelector == ORACLE_CHAIN_SELECTOR`
2. `abi.decode(message.sender) == oracleAddress`

**Update Cache :**
- Decode `(bytes32 key, bytes value, uint32 timestamp, bytes32 schemaHash)`
- Calculate `expiryTime = block.timestamp + CACHE_TTL`
- Store CachedData
- Emit `DataCached(key, schemaHash, expiryTime)`

---

## 4. Adapters (Couche Pluggable)

### 4.1 Concept

**Pattern :** Stateless helpers pour encoder/décoder données métier.

**Interface standard :** `IDataAdapter`

**Fichier :** `contracts/src/interfaces/IDataAdapter.sol`

---

### 4.2 Interface IDataAdapter

```solidity
interface IDataAdapter {
    function getSchemaHash() external pure returns (bytes32 schemaHash);
    function getDefaultValue() external pure returns (bytes memory defaultValue);
}
```

**Responsabilités :**
- Définir schema unique (keccak256("SchemaNameV1"))
- Fournir default value encodée
- Helpers optionnels pour encode/decode

---

### 4.3 ReputationAdapter

**Fichier :** `contracts/src/adapters/ReputationAdapter.sol` (137 lignes)

**Schema :** `keccak256("ReputationV1")`

**Structure logique :** `(uint8 score, bytes32 evidenceHash)`

**Helpers :**
- `getKey(address wallet)` : Génère clé unique
- `updateReputation(oracle, wallet, score, evidence)` : Wrapper UX
- `getReputation(oracle, wallet)` : Wrapper UX décodé
- `encode(score, evidence)` : Pure encoder
- `decode(data)` : Pure decoder

**Backward Compatibility :** API compatible avec ancien ChainMeshOracle

---

### 4.4 PriceAdapter

**Fichier :** `contracts/src/adapters/PriceAdapter.sol` (58 lignes)

**Schema :** `keccak256("PriceV1")`

**Structure logique :** `(uint256 value, uint8 decimals)`

**Helpers :**
- `getKey(string symbol)` : Génère clé pour asset
- `updatePrice(oracle, symbol, price, decimals)` : Wrapper UX
- `getPrice(oracle, symbol)` : Wrapper UX décodé

**Démonstration simplicité :** <60 lignes (prouve réutilisabilité infrastructure)

---

## 5. Gas Analysis

### 5.1 Mesures Actuelles

| Operation | Gas | Target | Status |
|-----------|-----|--------|--------|
| GenericOracle.updateData | ~171k | <200k | ✅ |
| GenericOracle.sendResponse | ~110k | <150k | ✅ |
| GenericCache.requestData | ~110k | <130k | ✅ |

### 5.2 Trade-offs Acceptés

**Généricité vs Gas :**
- Generic storage (bytes) coûte ~2-3x vs structs packed
- Trade-off acceptable car CCIP fees ($25) >> gas ($5)
- Priorisation : Architecture flexible > Optimisation marginale

---

## 6. Testing

### 6.1 Métriques Actuelles

| Composant | Tests | Coverage | Status |
|-----------|-------|----------|--------|
| GenericOracle | 45 | 97.10% lines | ✅ |
| GenericCache | 32 | 96.36% lines | ✅ |
| ReputationAdapter | 23 | >80% | ✅ |
| PriceAdapter | 15 | >80% | ✅ |
| Integration | 8 | Cross-adapter | ✅ |
| **Total** | **123** | **>80%** | ✅ |

### 6.2 Types de Tests

**Unit Tests :**
- Happy paths
- Edge cases
- Error cases
- Events emission
- Access control

**Integration Tests :**
- Cross-adapter coexistence
- CCIP full flow
- Cache invalidation
- Schema isolation

**Fuzz Tests :**
- Score boundaries
- Random addresses
- Timestamp variations

---

## 7. Deployment

### 7.1 Ordre

**Step 1 :** Deploy GenericOracle (Sepolia)
**Step 2 :** Deploy GenericCache (Arbitrum, Base, etc.)
**Step 3 :** Deploy Adapters (optionnel, stateless)
**Step 4 :** Grant UPDATER_ROLE
**Step 5 :** Whitelist chains
**Step 6 :** Fund Oracle (ETH for CCIP fees)

### 7.2 Configuration Post-Deployment

**GenericOracle :**
- Whitelist destination chains
- Grant UPDATER_ROLE à updater wallet
- Fund avec ETH (>0.1 ETH)
- Verify access control

**GenericCache :**
- Verify oracleAddress correct
- Set default values per schema (optionnel)
- No funding needed (users pay)

---

## 8. Évolutions Futures

### 8.1 Adapters Additionnels

**Exemples possibles :**
- NFTMetadataAdapter : Métadonnées cross-chain
- SwapQuoteAdapter : Prix swap DEX
- WeatherAdapter : Données météo oracle
- GameStateAdapter : État jeux blockchain

**Pattern :** Créer adapter = implémenter IDataAdapter (2 functions) + helpers UX

### 8.2 v2.0 Potentiel

**Features :**
- Historical data (versioning avec timestamps)
- Multi-oracle aggregation
- Subscription model
- On-chain computation (light)

---

## 9. Checklist Développement

### Code Implémenté ✅
- [x] GenericOracle.sol (373 lignes)
- [x] GenericCache.sol (268 lignes)
- [x] IDataAdapter.sol (interface)
- [x] ReputationAdapter.sol (137 lignes)
- [x] PriceAdapter.sol (58 lignes)
- [x] 123 tests (100% pass)
- [x] Coverage >80%
- [x] Gas optimized
- [x] Security patterns (ReentrancyGuard, AccessControl, CEI)

### Documentation ✅
- [x] NatSpec complet
- [x] README.md projet
- [x] REFACTORING_REPORT.md
- [x] Cette SPEC mise à jour

---

## 10. Différences vs v1.0 (Ancien)

**Architecture :**
- ❌ Ancien : Hardcodé Reputation (Reputation struct)
- ✅ Nouveau : Générique (bytes + schemaHash)

**Réutilisabilité :**
- ❌ Ancien : 1 type de data (reputation)
- ✅ Nouveau : N types via adapters

**Evolution :**
- ❌ Ancien : Breaking changes pour nouveaux types
- ✅ Nouveau : Ajouter adapter sans toucher infrastructure

**Default Values :**
- ❌ Ancien : Hardcodé DEFAULT_SCORE = 60
- ✅ Nouveau : Configurables per schema

**Rate Limiting :**
- ❌ Ancien : Per-user (msg.sender)
- ✅ Nouveau : Per-key (évite DoS keys populaires)

---

**Fin de SPEC_Module1_Blockchain.md**

**Version:** 2.0
**Status:** ✅ Implémenté et Testé
**Architecture:** Infrastructure générique (réutilisable)
**Tests:** 123 tests, 100% pass, >80% coverage
**Next Step:** Deployment testnet + Module 2 (Backend)
