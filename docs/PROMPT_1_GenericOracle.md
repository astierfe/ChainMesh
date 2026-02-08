# Prompt 1/3 : GenericOracle.sol - Infrastructure Key-Value CCIP

**Date :** 6 février 2026  
**Module :** ChainMesh Module 1 - Blockchain Layer  
**Conversation :** 1/3 (Focus GenericOracle uniquement)

---

## 🎯 Mission

Refactorer `ChainMeshOracle.sol` (actuellement hardcodé pour "Reputation") en `GenericOracle.sol` : une infrastructure key-value agnostique qui peut stocker **N'IMPORTE QUEL type de données** pour n'importe quel agent IA.

**Objectif :** Passer d'une application spécifique à une infrastructure réutilisable.

---

## 📋 Décisions Techniques Validées

### 1. Default Values
**Décision :** Configurable via mapping  
**Rationale :** Chaque schemaHash peut avoir son propre default (ex: Reputation=60, Price=0)

### 2. Schema Validation  
**Décision :** Trust par défaut, avec mode strict optionnel  
**Rationale :** Flexibilité pour MVP, sécurisable en production si nécessaire

### 3. Versioning Schemas
**Décision :** Inclure `schemaHash` dans la structure dès maintenant (ex: keccak256("ReputationV1"))  
**Rationale :** Anticipe migrations V1→V2 sans nécessiter de proxy UUPS immédiatement

### 4. Trade-off Gas vs Flexibilité
**Décision :** Accepter +15-20% gas pour la généricité  
**Target :** <70k gas pour updateData (vs 51k actuel pour updateReputation)  
**Rationale :** CCIP fees (~$25) dominent, l'augmentation de gas (~$1-2) est négligeable

---

## 🔄 Transformation Conceptuelle

### AVANT : ChainMeshOracle (Spécifique)
- Structure hardcodée `Reputation` (score, timestamp, evidenceHash)
- Fonction `updateReputation(address wallet, uint8 score, bytes32 evidence)`
- Messages CCIP hardcodés : `abi.encode(address wallet, address requester)`
- **Problème :** Impossible de réutiliser pour Price Oracle, NFT Agent, etc.

### APRÈS : GenericOracle (Infrastructure)
- Structure générique `DataEntry` avec key-value (bytes encodés)
- Fonction `updateData(bytes32 key, bytes memory value, bytes32 schemaHash)`
- Messages CCIP génériques : `abi.encode(bytes32 key, bytes32 schema, address requester)`
- **Avantage :** Réutilisable pour TOUT type de données sans redéployer

---

## 📝 Spécifications Fonctionnelles

### Stockage Générique

**Concept clé :** Remplacer `mapping(address => Reputation)` par `mapping(bytes32 => DataEntry)`

**Structure DataEntry doit inclure :**
- `key` : Identifiant unique (bytes32, ex: hash(wallet + "reputation"))
- `value` : Données encodées (bytes, flexible)
- `timestamp` : Dernière mise à jour (uint32)
- `schemaHash` : Identifiant du type de données (bytes32, ex: keccak256("ReputationV1"))
- `isValid` : Flag de validité (bool)

**Exemples de keys possibles :**
- Reputation : `keccak256(abi.encodePacked(walletAddress, "reputation"))`
- Price : `keccak256(abi.encodePacked("ETH", "price"))`
- NFT : `keccak256(abi.encodePacked(tokenId, "metadata"))`

---

### Fonctions Principales

#### 1. updateData() - Écriture Générique
- Remplace `updateReputation()`
- Accepte : `bytes32 key`, `bytes memory value`, `bytes32 schemaHash`
- Validation : clé non nulle, valeur non vide
- Validation optionnelle : si `strictMode` activé, vérifier que schemaHash est enregistré
- Émet : `DataUpdated(key, schemaHash, timestamp)`

#### 2. getData() - Lecture Générique
- Remplace `getReputation()`
- Accepte : `bytes32 key`
- Retourne : `(bytes value, uint32 timestamp, bytes32 schema, bool isValid)`

#### 3. sendResponse() - Réponse CCIP Générique
- Même logique que l'ancien, mais avec payload générique
- Récupère `DataEntry` au lieu de `Reputation`
- Message CCIP : `abi.encode(key, value, timestamp, schemaHash)`

---

### Messages CCIP Adaptés

#### Query (Consumer → Oracle)
- **Ancien format :** `(address wallet, address requester)`
- **Nouveau format :** `(bytes32 key, bytes32 schemaHash, address requester)`

#### Response (Oracle → Consumer)
- **Ancien format :** `(address wallet, uint8 score, uint32 timestamp, bytes32 evidence)`
- **Nouveau format :** `(bytes32 key, bytes value, uint32 timestamp, bytes32 schemaHash)`

---

### Fonctions Admin Supplémentaires

**Pour mode strict (optionnel) :**
- `enableStrictMode()` : Activer validation de schemaHash
- `registerSchema(bytes32 schemaHash)` : Enregistrer un schema valide
- `invalidateData(bytes32 key)` : Marquer une entrée comme invalide

---

### Events Adaptés

**Remplacer :**
- `ReputationUpdated` → `DataUpdated`
- `QueryReceived` doit inclure `bytes32 key` et `bytes32 schemaHash` (pas juste `address wallet`)
- `ResponseSent` doit inclure `bytes32 key` et `bytes32 schemaHash`

---

## 🔒 Sécurité à Conserver

**CRITIQUE : NE PAS affaiblir la sécurité existante**

Conserver TOUTES les protections actuelles :
- ✅ Access Control (UPDATER_ROLE, DEFAULT_ADMIN_ROLE, PAUSER_ROLE)
- ✅ Replay protection (`processedMessages` mapping)
- ✅ Whitelist chains (`whitelistedChains`)
- ✅ Reentrancy guards (CEI pattern, nonReentrant)
- ✅ Custom errors (gas efficient)
- ✅ Zero address checks
- ✅ Fee validation et refund logic

**Structure QueryRequest** : Inchangée (requester, sourceChain, requestedAt, processed)

---

## 🧪 Tests Requis

### GenericOracle.t.sol (Foundry)

**Minimum 45 tests couvrant :**

**Tests de base :**
- Update data avec schema valide
- Get data pour clé existante
- Get data pour clé inexistante (should revert ou return invalid)
- Revert si clé nulle
- Revert si valeur vide
- Revert si caller n'a pas UPDATER_ROLE

**Tests CCIP :**
- Receive query générique et stocker dans queryRequests
- Send response avec payload générique
- Revert si source chain non whitelisted
- Revert si message déjà traité (replay protection)
- Revert si query introuvable
- Revert si query déjà processed

**Tests mode strict (optionnel) :**
- Update data avec schema non enregistré → revert si strictMode
- Register schema puis update → success
- Disable strictMode → accept unregistered schema

**Tests admin :**
- Whitelist chain (success + event)
- Remove from whitelist
- Invalidate data entry
- Withdraw funds

**Tests gas :**
- Benchmark updateData() → target <70k gas
- Benchmark sendResponse() → target <50k gas

**Coverage target :** >80% sur toutes les fonctions publiques/externes

---

## ✅ Success Criteria

Le refactoring est réussi si :

1. **Généricité démontrée :**
   - ✅ Peut stocker des données de types différents (pas juste uint8 score)
   - ✅ Aucune logique métier hardcodée (pas de "Reputation" dans le code)
   - ✅ Peut être utilisé par N'IMPORTE QUEL adapter sans modification

2. **Sécurité intacte :**
   - ✅ Toutes les protections existantes fonctionnent
   - ✅ Pas de nouvelles vulnérabilités introduites
   - ✅ Access control respecté

3. **Tests robustes :**
   - ✅ 45+ tests passent (100% success rate)
   - ✅ Coverage >80%
   - ✅ Tous les edge cases couverts

4. **Performance acceptable :**
   - ✅ updateData() <70k gas
   - ✅ sendResponse() <50k gas (vs 48k actuel)

---

## 🚫 Contraintes & Interdictions

**NE PAS modifier :**
- ❌ `CCIPReceiver.sol` (contrat de base Chainlink)
- ❌ `Client.sol`, `IRouterClient.sol` (interfaces CCIP)
- ❌ Logique de calcul de fees CCIP (déjà optimisée)
- ❌ Pattern CEI (Checks-Effects-Interactions)

**NE PAS introduire :**
- ❌ Dépendances externes non nécessaires
- ❌ Complexité inutile (KISS principle)
- ❌ Breaking changes dans les interfaces CCIP

**GARDER obligatoirement :**
- ✅ Solidity 0.8.20
- ✅ OpenZeppelin contracts (AccessControl, ReentrancyGuard)
- ✅ Custom errors (plus gas-efficient que require strings)
- ✅ NatSpec documentation complète
- ✅ Patterns de sécurité existants

---

## 📦 Livrables Attendus

1. **GenericOracle.sol** 
   - Code Solidity complet et fonctionnel
   - NatSpec documentation sur toutes les fonctions publiques
   - Structure optimisée pour le gas

2. **GenericOracle.t.sol**
   - 45+ tests Foundry
   - Coverage >80%
   - Tests d'intégration CCIP avec mock router

3. **Gas Report**
   - Résultat de `forge test --gas-report`
   - Comparaison avec l'ancien ChainMeshOracle (updateReputation = 51k gas)

---

## 💡 Analogie pour Contexte (Felix - Background SOA)

**Ancien système :**
```
ESB TIBCO avec workflow hardcodé "CustomerQuery"
→ Fonctionne, mais inflexible
```

**Nouveau système :**
```
Message Bus générique avec adapters pluggables
→ CustomerQuery, ProductQuery, OrderQuery, etc.
```

`GenericOracle` = **Message Bus transport-agnostic**  
`DataEntry.key` = **Routing key** (vers quel domaine métier)  
`DataEntry.schemaHash` = **Version WSDL** (ex: CustomerService_v1)  
`DataEntry.value` = **Payload XML/JSON** (format générique)

---

**Prêt à transformer l'application en infrastructure ? Go ! 🚀**
