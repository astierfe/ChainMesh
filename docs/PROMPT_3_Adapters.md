# Prompt 3/3 : Adapters - ReputationAdapter & PriceAdapter

**Date :** 6 février 2026  
**Module :** ChainMesh Module 1 - Blockchain Layer  
**Conversation :** 3/3 (Focus Adapters + Integration)  
**Prérequis :** GenericOracle.sol + GenericCache.sol terminés

---

## 🎯 Mission

Créer 2 adapters démontrant la réutilisabilité de l'infrastructure générique :
1. **ReputationAdapter** : Migre la logique métier "Reputation" actuelle
2. **PriceAdapter** : Démontre qu'on peut créer un nouvel adapter en <1h

**Objectif :** Prouver que l'infrastructure est vraiment réutilisable.

---

## 📋 Décisions Techniques Validées

### 1. Interface Standard
**Décision :** Tous les adapters implémentent `IDataAdapter`  
**Rationale :** Garantit compatibilité et predictabilité

### 2. Adapters = Stateless
**Décision :** Adapters ne stockent pas de données, juste encode/decode  
**Rationale :** Le storage est dans GenericOracle, adapters = helpers purs

### 3. Helper Functions
**Décision :** Adapters peuvent fournir des helpers UX (ex: `updateReputation()`)  
**Rationale :** Facilite l'intégration pour les devs sans sacrifier la généricité

### 4. Backward Compatibility
**Décision :** ReputationAdapter offre la même API que l'ancien ChainMeshOracle  
**Rationale :** Migration transparente pour les apps existantes

---

## 📝 Spécifications Fonctionnelles

### IDataAdapter.sol - Interface Standard

**Rôle :** Contrat d'interface que tous les adapters doivent implémenter

**Fonctions requises :**
- `getSchemaHash()` : Retourne l'identifiant du schema (ex: keccak256("ReputationV1"))
- `getDefaultValue()` : Retourne la valeur par défaut encodée (ex: score 60 pour Reputation)
- `encode()` : Optionnel - Helper pour encoder des données
- `decode()` : Optionnel - Helper pour décoder des données

**NatSpec :** Documenter clairement le but de chaque fonction

---

### ReputationAdapter.sol - Migration Logique Métier

**Objectif :** Démontrer backward compatibility

**Schema identifier :**
- `SCHEMA_HASH = keccak256("ReputationV1")`

**Structure logique Reputation (pour référence) :**
- `score` : uint8 (0-100)
- `timestamp` : uint32
- `evidenceHash` : bytes32 (IPFS CID)
- `isValid` : bool

**Fonctions IDataAdapter (implémentation) :**

#### getSchemaHash()
- Retourne : `keccak256("ReputationV1")`

#### getDefaultValue()
- Retourne : bytes encodés représentant score 60
- Format : `abi.encode(uint8(60), uint32(0), bytes32(0), false)`

---

**Helpers UX (pour faciliter l'usage) :**

#### getKey(address wallet)
- Calcule la clé pour un wallet
- Logique : `keccak256(abi.encodePacked(wallet, "reputation"))`
- Retourne : `bytes32`

#### updateReputation(address oracle, address wallet, uint8 score, bytes32 evidence)
- Encode les données Reputation
- Appelle `GenericOracle.updateData(key, value, SCHEMA_HASH)`
- Facilite la migration pour les apps existantes

#### getReputation(address oracle, address wallet)
- Récupère les données via `GenericOracle.getData(key)`
- Décode les bytes en structure Reputation
- Retourne : `(uint8 score, uint32 timestamp, bytes32 evidence, bool isValid)`

---

### PriceAdapter.sol - Exemple Simple

**Objectif :** Démontrer qu'on peut créer un adapter en <50 lignes

**Use case :** Cache de prix pour assets (ex: ETH, BTC)

**Schema identifier :**
- `SCHEMA_HASH = keccak256("PriceV1")`

**Structure logique Price (pour référence) :**
- `value` : uint256 (prix en wei)
- `decimals` : uint8 (ex: 18 pour ETH)
- `timestamp` : uint32

**Fonctions IDataAdapter (implémentation) :**

#### getSchemaHash()
- Retourne : `keccak256("PriceV1")`

#### getDefaultValue()
- Retourne : prix 0 encodé
- Format : `abi.encode(uint256(0), uint8(18), uint32(0))`

---

**Helpers UX :**

#### getKey(string memory symbol)
- Calcule la clé pour un asset
- Logique : `keccak256(abi.encodePacked(symbol, "price"))`
- Exemple : `getKey("ETH")` → clé pour prix ETH

#### updatePrice(address oracle, string memory symbol, uint256 price, uint8 decimals)
- Encode les données Price
- Appelle `GenericOracle.updateData(key, value, SCHEMA_HASH)`

#### getPrice(address oracle, string memory symbol)
- Récupère les données via `GenericOracle.getData(key)`
- Décode les bytes en structure Price
- Retourne : `(uint256 value, uint8 decimals, uint32 timestamp)`

---

## 🧪 Tests Requis

### ReputationAdapter.t.sol

**Minimum 15 tests couvrant :**

**Tests IDataAdapter :**
- getSchemaHash() retourne bon hash
- getDefaultValue() retourne bytes valides (décodables)

**Tests helpers :**
- getKey() génère clés uniques pour différents wallets
- updateReputation() appelle correctement GenericOracle
- getReputation() décode correctement les bytes
- updateReputation() puis getReputation() → round-trip success

**Tests edge cases :**
- getReputation() pour wallet inexistant → default value
- updateReputation() avec score > 100 → revert (validation Oracle)
- updateReputation() par non-UPDATER → revert (access control)

**Tests backward compatibility :**
- Même API que ancien ChainMeshOracle fonctionne
- Migration transparente possible

---

### PriceAdapter.t.sol

**Minimum 10 tests couvrant :**

**Tests IDataAdapter :**
- getSchemaHash() retourne bon hash
- getDefaultValue() retourne bytes valides

**Tests helpers :**
- getKey() génère clés uniques pour différents symbols
- updatePrice() + getPrice() → round-trip success
- Différents decimals (6, 8, 18) fonctionnent correctement

---

### Integration.t.sol - Tests Cross-Adapter

**Objectif :** Prouver que GenericOracle gère plusieurs adapters simultanément

**Tests critiques :**

**Test 1 : Coexistence**
- Stocker Reputation pour wallet A
- Stocker Price pour ETH
- Récupérer les deux → success, pas de collision

**Test 2 : Isolation**
- Invalider Reputation pour wallet A
- Price pour ETH reste valide

**Test 3 : Schemas différents**
- Vérifier que schemaHash est stocké correctement
- Vérifier qu'on peut distinguer ReputationV1 de PriceV1

**Test 4 : CCIP cross-adapter**
- Cache requête Reputation via CCIP → success
- Cache requête Price via CCIP → success
- Vérifier pas de confusion entre les deux

**Coverage target :** >80% sur adapters + tests d'intégration

---

## ✅ Success Criteria

Le développement est réussi si :

1. **Réutilisabilité démontrée :**
   - ✅ PriceAdapter créé en <50 lignes de code
   - ✅ Les deux adapters coexistent sans conflit
   - ✅ On peut ajouter un 3ème adapter sans modifier GenericOracle

2. **Backward compatibility :**
   - ✅ ReputationAdapter offre même API que ancien système
   - ✅ Migration possible sans breaking changes

3. **Tests robustes :**
   - ✅ 25+ tests passent (ReputationAdapter + PriceAdapter + Integration)
   - ✅ Coverage >80%

4. **Documentation claire :**
   - ✅ NatSpec complet sur tous les adapters
   - ✅ README.md explique comment créer son propre adapter

---

## 🚫 Contraintes & Interdictions

**Adapters NE DOIVENT PAS :**
- ❌ Stocker des données (pas de state variables de données métier)
- ❌ Faire des appels CCIP directs (délégué à GenericOracle/Cache)
- ❌ Implémenter leur propre access control (délégué à GenericOracle)
- ❌ Avoir des dépendances complexes

**Adapters DOIVENT :**
- ✅ Être stateless (sauf constantes)
- ✅ Implémenter IDataAdapter
- ✅ Être simples (<100 lignes pour la plupart)
- ✅ Avoir NatSpec complet

---

## 📦 Livrables Attendus

1. **IDataAdapter.sol**
   - Interface standard
   - NatSpec complet

2. **ReputationAdapter.sol**
   - Implémentation IDataAdapter
   - Helpers UX (updateReputation, getReputation)
   - NatSpec complet

3. **PriceAdapter.sol**
   - Implémentation IDataAdapter
   - Helpers UX (updatePrice, getPrice)
   - Démonstration simplicité (<50 lignes)

4. **Tests**
   - ReputationAdapter.t.sol (15+ tests)
   - PriceAdapter.t.sol (10+ tests)
   - Integration.t.sol (5+ tests cross-adapter)

5. **Documentation**
   - README_ADAPTERS.md : Comment créer son adapter
   - Exemples d'usage pour devs

---

## 📚 Documentation à Créer

### README_ADAPTERS.md

**Contenu minimum :**

**Section 1 : Vue d'ensemble**
- Qu'est-ce qu'un adapter ?
- Pourquoi créer un adapter ?
- Architecture générale (diagramme)

**Section 2 : Créer votre adapter**
- Étapes à suivre
- Template de base
- Best practices

**Section 3 : Exemples**
- ReputationAdapter : Use case complet
- PriceAdapter : Use case simple
- Cas d'usage suggérés (NFT metadata, Swap quotes, etc.)

**Section 4 : Référence API**
- IDataAdapter interface
- Helpers communs
- Integration avec GenericOracle/Cache

---

## 💡 Analogie SOA pour Contexte (Felix)

**Adapters** = **Message Transformers** dans ESB

Dans TIBCO BusinessWorks :
- Generic format (XML) ↔ Domain format (SQL, REST, etc.)
- Transformer = bidirectionnel (encode/decode)
- Pluggable = ajouter transformer sans modifier ESB core

**ChainMesh adapters :**
- Generic format (bytes) ↔ Domain format (Reputation, Price, etc.)
- Adapter = bidirectionnel (encode/decode)
- Pluggable = ajouter adapter sans modifier GenericOracle

**Exemple workflow :**
```
App → ReputationAdapter.updateReputation()
    → encode(score, evidence)
    → GenericOracle.updateData(key, bytes, schema)
    → Storage générique
```

---

## 🎯 Prochaines Étapes Post-Adapters

Après cette conversation, l'infrastructure Module 1 est **100% complète** :
- ✅ GenericOracle (infrastructure storage + CCIP)
- ✅ GenericCache (cache TTL + rate limiting)
- ✅ Adapters (ReputationAdapter + PriceAdapter)
- ✅ Tests (>80% coverage)

**Next :**
- Scripts de déploiement (DeployGenericInfra.s.sol)
- Documentation complète (ARCHITECTURE.md, MIGRATION_GUIDE.md)
- Tests sur testnets réels

---

**Prêt à finaliser l'infrastructure avec les adapters ? Go ! 🚀**
