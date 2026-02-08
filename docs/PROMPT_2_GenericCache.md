# Prompt 2/3 : GenericCache.sol - Cache Générique Consumer Chains

**Date :** 6 février 2026  
**Module :** ChainMesh Module 1 - Blockchain Layer  
**Conversation :** 2/3 (Focus GenericCache uniquement)  
**Prérequis :** GenericOracle.sol terminé (Conversation 1/3)

---

## 🎯 Mission

Refactorer `ChainMeshCache.sol` (actuellement hardcodé pour "Reputation") en `GenericCache.sol` : un cache TTL générique qui peut requêter et stocker **N'IMPORTE QUEL type de données** provenant du GenericOracle.

**Objectif :** Cache agnostique compatible avec tous les adapters.

---

## 📋 Décisions Techniques Validées

### 1. Default Values
**Décision :** Configurable via mapping `defaultValues[schemaHash]`  
**Rationale :** Chaque type de données peut avoir son propre default

### 2. Schema Validation  
**Décision :** Pas de validation stricte (trust GenericOracle)  
**Rationale :** La validation se fait côté Oracle, pas côté Cache

### 3. Versioning Schemas
**Décision :** Stocker `schemaHash` dans le cache pour traçabilité  
**Rationale :** Permet de savoir quelle version des données est cachée

### 4. Trade-off Gas vs Flexibilité
**Décision :** Accepter +10-15% gas pour la généricité  
**Target :** <130k gas pour requestData (vs 110k actuel pour requestReputation)

---

## 🔄 Transformation Conceptuelle

### AVANT : ChainMeshCache (Spécifique)
- Structure `CachedReputation` (score, timestamp, expiryTime, evidenceHash)
- Fonction `getReputation(address wallet)` → retourne score 0-100
- Fonction `requestReputation(address wallet)` → envoie CCIP query pour wallet
- Default score hardcodé : `uint8 public constant DEFAULT_SCORE = 60`
- **Problème :** Impossible de cacher autre chose que des scores de réputation

### APRÈS : GenericCache (Infrastructure)
- Structure `CachedData` avec key-value (bytes encodés)
- Fonction `getData(bytes32 key)` → retourne bytes encodés
- Fonction `requestData(bytes32 key, bytes32 schemaHash)` → envoie CCIP query générique
- Default values configurables : `mapping(bytes32 => bytes) public defaultValues`
- **Avantage :** Cache réutilisable pour prix, métadatas NFT, etc.

---

## 📝 Spécifications Fonctionnelles

### Stockage Cache Générique

**Concept clé :** Remplacer `mapping(address => CachedReputation)` par `mapping(bytes32 => CachedData)`

**Structure CachedData doit inclure :**
- `key` : Identifiant de la donnée (bytes32)
- `value` : Données cachées encodées (bytes)
- `timestamp` : Timestamp de la source Oracle (uint32)
- `expiryTime` : Expiration du cache local (uint256)
- `schemaHash` : Type de données (bytes32)
- `isValid` : Flag de validité (bool)

---

### Constantes TTL

**À CONSERVER :**
- `CACHE_TTL = 24 hours` (durée de validité du cache)
- `MIN_REQUEST_INTERVAL = 1 hour` (rate limiting)

---

### Fonctions Principales

#### 1. getData() - Lecture avec Cache
- Remplace `getReputation()`
- Accepte : `bytes32 key`
- Retourne : `(bytes value, bool isFromCache, bool needsUpdate)`
- Logique :
  - Cache miss → retourne `(defaultValues[schemaHash], false, true)`
  - Cache hit fresh → retourne `(cachedValue, true, false)`
  - Cache hit stale → retourne `(cachedValue, true, true)`

#### 2. requestData() - Requête CCIP Générique
- Remplace `requestReputation()`
- Accepte : `bytes32 key`, `bytes32 schemaHash`
- Payable (pour CCIP fees)
- Rate limiting : 1 requête/heure par `key` (pas par msg.sender)
- Message CCIP envoyé : `abi.encode(key, schemaHash, address(this))`
- Retourne : `bytes32 messageId`
- Refund automatique de l'excédent ETH

#### 3. setDefaultValue() - Configuration Defaults
- Nouvelle fonction admin
- Accepte : `bytes32 schemaHash`, `bytes memory value`
- Stocke : `defaultValues[schemaHash] = value`
- Émet : `DefaultValueSet(schemaHash, value)`

---

### Messages CCIP Adaptés

#### Query (Cache → Oracle)
- **Ancien format :** `(address wallet, address requester)`
- **Nouveau format :** `(bytes32 key, bytes32 schemaHash, address requester)`

#### Response (Oracle → Cache)
- **Ancien format :** `(address wallet, uint8 score, uint32 timestamp, bytes32 evidence)`
- **Nouveau format :** `(bytes32 key, bytes value, uint32 timestamp, bytes32 schemaHash)`

---

### _ccipReceive() - Réception Réponse Générique

**Adaptation nécessaire :**
- Décoder payload générique : `(bytes32 key, bytes value, uint32 timestamp, bytes32 schema)`
- Stocker dans cache : `cache[key] = CachedData({...})`
- Calculer `expiryTime = block.timestamp + CACHE_TTL`
- Émettre : `DataCached(key, schemaHash, expiryTime)`

---

### Rate Limiting

**Changement clé :** Appliquer par `key` au lieu de par `msg.sender`

**Logique :**
- `mapping(bytes32 => uint256) public lastRequestTime`
- Vérifier : `block.timestamp - lastRequestTime[key] >= MIN_REQUEST_INTERVAL`
- Exception : Skip rate limit pour première requête d'une key (lastRequestTime == 0)

---

### Fonctions Admin

#### Existantes à conserver :
- `invalidateCache(bytes32 key)` : Marquer entrée comme invalide

#### Nouvelles à ajouter :
- `setDefaultValue(bytes32 schemaHash, bytes memory value)` : Configurer default
- `getDefaultValue(bytes32 schemaHash)` : Lire default configuré

---

### Events Adaptés

**Remplacer :**
- `ReputationQueried` → `DataQueried(bytes32 key, bytes32 schema, address requester, bytes32 messageId)`
- `ReputationCached` → `DataCached(bytes32 key, bytes32 schema, uint256 expiryTime)`
- Garder : `CacheHit`, `CacheMiss` (optionnels, pour monitoring)

**Nouveau :**
- `DefaultValueSet(bytes32 schemaHash, bytes memory value)`

---

## 🔒 Sécurité à Conserver

**CRITIQUE : NE PAS affaiblir la sécurité existante**

Conserver TOUTES les protections actuelles :
- ✅ Source chain validation (uniquement ORACLE_CHAIN_SELECTOR accepté)
- ✅ Sender validation (uniquement ORACLE_ADDRESS accepté)
- ✅ CCIP fee calculation et validation
- ✅ Refund automatique de l'excédent ETH
- ✅ Access Control (DEFAULT_ADMIN_ROLE)
- ✅ Custom errors (gas efficient)

**Variables immutable à conserver :**
- `ORACLE_ADDRESS` : Adresse du GenericOracle sur Sepolia
- `ORACLE_CHAIN_SELECTOR` : Chain selector de Sepolia

---

## 🧪 Tests Requis

### GenericCache.t.sol (Foundry)

**Minimum 20 tests couvrant :**

**Tests de base :**
- Get data pour key inexistante → cache miss, return default
- Get data pour key cachée fresh → cache hit, needsUpdate=false
- Get data pour key cachée stale → cache hit, needsUpdate=true
- Request data avec fees suffisantes → success + messageId
- Request data avec fees insuffisantes → revert
- Refund excédent ETH → success

**Tests rate limiting :**
- Request data première fois → success (skip rate limit)
- Request data deux fois rapidement → revert RateLimitExceeded
- Request data après 1h → success

**Tests CCIP response :**
- Receive response de Oracle → update cache
- Receive response de chain non autorisée → revert
- Receive response de sender non autorisé → revert

**Tests admin :**
- Set default value → success + event
- Get default value → return configured default
- Invalidate cache → isValid = false

**Tests default values :**
- Cache miss avec default configuré → return default
- Cache miss sans default → return empty bytes

**Tests gas :**
- Benchmark requestData() → target <130k gas
- Benchmark getData() → <6k gas (view function)

**Coverage target :** >80% sur toutes les fonctions publiques/externes

---

## ✅ Success Criteria

Le refactoring est réussi si :

1. **Généricité démontrée :**
   - ✅ Peut cacher des données de types différents
   - ✅ Aucune référence à "Reputation" dans le code
   - ✅ Compatible avec N'IMPORTE QUEL adapter

2. **Fonctionnalité cache intacte :**
   - ✅ Cache hit/miss/stale logic fonctionne
   - ✅ TTL de 24h respecté
   - ✅ Rate limiting par key fonctionne

3. **Tests robustes :**
   - ✅ 20+ tests passent (100% success rate)
   - ✅ Coverage >80%
   - ✅ Tests CCIP avec mock Oracle

4. **Performance acceptable :**
   - ✅ requestData() <130k gas
   - ✅ getData() <6k gas

---

## 🚫 Contraintes & Interdictions

**NE PAS modifier :**
- ❌ `CCIPReceiver.sol` (contrat de base Chainlink)
- ❌ `CACHE_TTL` et `MIN_REQUEST_INTERVAL` (déjà bien calibrés)
- ❌ Logique de refund ETH (déjà optimisée)

**NE PAS introduire :**
- ❌ Logique métier spécifique (ex: "score < 50 = risky")
- ❌ Validation de schemaHash (délégué à Oracle)

**GARDER obligatoirement :**
- ✅ Solidity 0.8.20
- ✅ OpenZeppelin AccessControl
- ✅ Custom errors
- ✅ Immutable ORACLE_ADDRESS et ORACLE_CHAIN_SELECTOR
- ✅ NatSpec documentation complète

---

## 📦 Livrables Attendus

1. **GenericCache.sol** 
   - Code Solidity complet et fonctionnel
   - NatSpec documentation
   - Optimisé pour le gas

2. **GenericCache.t.sol**
   - 20+ tests Foundry
   - Coverage >80%
   - Tests avec mock Oracle

3. **Gas Report**
   - `forge test --gas-report`
   - Comparaison avec ChainMeshCache (requestReputation = 110k gas)

---

## 🔗 Intégration avec GenericOracle

**Le cache doit être compatible avec les messages du GenericOracle :**

**Query envoyée par Cache :**
```
Format: (bytes32 key, bytes32 schemaHash, address requesterCache)
```

**Response reçue de Oracle :**
```
Format: (bytes32 key, bytes value, uint32 timestamp, bytes32 schemaHash)
```

**Important :** Le cache NE décode PAS le `value`. Il stocke les bytes tels quels. C'est le rôle des adapters de décoder.

---

## 💡 Analogie SOA pour Contexte (Felix)

**GenericCache** = **Proxy/Gateway avec cache TTL**

Dans une architecture SOA/ESB :
- Cache TTL = Response cache (évite appels répétés au backend)
- Rate limiting = Throttling policy
- Default value = Fallback value si backend down
- Cache miss → CCIP query = Cache miss → HTTP call au service

**Flow typique :**
```
Client → Proxy Cache → (cache miss) → Backend Service
                     ← (response) ← 
Client ← Proxy Cache (cached) ←
```

---

**Prêt à créer le cache générique ? Go ! 🚀**
