# ChainMesh

**Infrastructure générique CCIP pour agents IA cross-chain**

ChainMesh est une infrastructure blockchain décentralisée permettant aux agents IA d'échanger des données entre différentes blockchains via Chainlink CCIP. Contrairement aux solutions spécialisées, ChainMesh est générique et réutilisable pour tout type de données.

## 🎯 Vision

> "ChainMesh n'est pas une application, c'est une infrastructure."

L'objectif est de fournir une couche d'infrastructure blockchain que n'importe quel agent IA peut utiliser pour :
- Stocker des données on-chain de manière générique
- Interroger ces données depuis n'importe quelle blockchain compatible CCIP
- Utiliser un système de cache TTL pour optimiser les coûts
- Adapter les données métier via des adapters pluggables

## 🏗️ Architecture Module 1 - Blockchain Layer

### Composants principaux

```
┌─────────────────────────────────────────────────────────────┐
│                    Consumer Chain (Arbitrum)                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  GenericCache (TTL 24h + Rate Limiting)                │ │
│  │  - Cache hit/miss/stale logic                          │ │
│  │  - Default values par schema                           │ │
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
│                           │                                   │
│                           │ CCIP Response                     │
└───────────────────────────┼───────────────────────────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │   Adapters   │
                    ├──────────────┤
                    │ Reputation   │
                    │ Price        │
                    │ Custom...    │
                    └──────────────┘
```

### 1. GenericOracle (Oracle Chain)

Infrastructure de stockage générique avec support CCIP.

**Fonctionnalités :**
- Stockage key-value avec versioning de schema
- Reception de requêtes CCIP cross-chain
- Envoi de réponses CCIP
- Gestion des accès (UPDATER_ROLE, admin)
- Whitelist de chains supportées

**Fichier :** [`contracts/src/GenericOracle.sol`](contracts/src/GenericOracle.sol)

### 2. GenericCache (Consumer Chain)

Cache TTL avec rate limiting pour optimiser les coûts CCIP.

**Fonctionnalités :**
- Cache 24h avec états fresh/stale
- Rate limiting per-key (1 requête/heure)
- Default values configurables par schema
- Fallback automatique sur valeurs par défaut

**Fichier :** [`contracts/src/GenericCache.sol`](contracts/src/GenericCache.sol)

### 3. Adapters (Pluggable)

Couche d'adaptation pour différents types de données.

**Adapters disponibles :**
- **ReputationAdapter** : Scores de réputation + evidence IPFS
- **PriceAdapter** : Prix d'assets avec decimals configurables

**Interface standard :** [`contracts/src/interfaces/IDataAdapter.sol`](contracts/src/interfaces/IDataAdapter.sol)

## 🚀 Quick Start

### Prérequis

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Solidity 0.8.20

### Installation

```bash
# Cloner le repo
git clone https://github.com/astierfe/ChainMesh.git
cd ChainMesh

# Installer les dépendances
cd contracts
forge install
```

### Tests

```bash
# Tous les tests
forge test

# Tests avec verbosité
forge test -vvv

# Tests avec coverage
forge coverage

# Tests spécifiques
forge test --match-contract GenericOracleTest
forge test --match-contract ReputationAdapterTest
```

### Coverage actuelle

- **GenericOracle** : 97.10% lines, 95.95% statements (45 tests)
- **GenericCache** : 96.36% lines, 93.44% statements (32 tests)
- **ReputationAdapter** : >80% coverage (23 tests)
- **PriceAdapter** : >80% coverage (15 tests)
- **Integration** : 8 tests cross-adapter

**Total : 123 tests**

## 📖 Documentation

### Pour les développeurs

- [Architecture complète](docs/ChainMesh_PRD_v1.2.md)
- [Rapport de refactoring](contracts/REFACTORING_REPORT.md)
- [Guide des adapters](contracts/README_ADAPTERS.md) *(à venir)*

### Guides de refactoring

- [Prompt 1/3 : GenericOracle](docs/PROMPT_1_GenericOracle.md)
- [Prompt 2/3 : GenericCache](docs/PROMPT_2_GenericCache.md)
- [Prompt 3/3 : Adapters](docs/PROMPT_3_Adapters.md)

## 🔑 Concepts clés

### Schema Versioning

Chaque adapter définit un schema unique via `schemaHash` :

```solidity
bytes32 public constant SCHEMA_HASH = keccak256("ReputationV1");
```

Cela permet :
- Coexistence de multiples types de données
- Évolution des schemas (V1 → V2)
- Validation au runtime

### Generic Storage

Au lieu de structures spécifiques :

```solidity
// ❌ Ancien (hardcodé)
struct Reputation {
    uint8 score;
    bytes32 evidenceHash;
    uint32 timestamp;
    bool isValid;
}

// ✅ Nouveau (générique)
struct DataEntry {
    bytes32 key;
    bytes32 schemaHash;
    uint32 timestamp;
    bool isValid;
}
mapping(bytes32 => bytes) public dataValues;
```

### Adapters Stateless

Les adapters sont de simples helpers d'encodage/décodage :

```solidity
interface IDataAdapter {
    function getSchemaHash() external pure returns (bytes32);
    function getDefaultValue() external pure returns (bytes memory);
}
```

## 🛠️ Créer votre propre Adapter

```solidity
contract MyCustomAdapter is IDataAdapter {
    bytes32 public constant SCHEMA_HASH = keccak256("MyDataV1");

    function getSchemaHash() external pure returns (bytes32) {
        return SCHEMA_HASH;
    }

    function getDefaultValue() external pure returns (bytes memory) {
        return abi.encode(/* vos valeurs par défaut */);
    }

    // Vos helpers d'encodage/décodage
}
```

## 📊 Gas Analysis

Trade-off accepté : +2-3x gas pour la généricité

| Operation | Ancien | Nouveau | Justification |
|-----------|--------|---------|---------------|
| updateData | ~60k | ~171k | CCIP fees ($25) >> gas ($5) |
| sendResponse | ~40k | ~110k | Architecture > optimisation |
| requestData | ~90k | ~110k | Minimal impact |

## 🔐 Sécurité

- ✅ CEI pattern (Checks-Effects-Interactions)
- ✅ ReentrancyGuard
- ✅ AccessControl (OpenZeppelin)
- ✅ Rate limiting
- ✅ Schema validation
- ✅ Whitelist de chains

## 🗺️ Roadmap

### Module 1 - Blockchain Layer ✅
- [x] GenericOracle
- [x] GenericCache
- [x] ReputationAdapter
- [x] PriceAdapter
- [x] Tests complets (>80% coverage)

### Module 2 - Backend (À venir)
- [ ] n8n workflows
- [ ] OpenAI integration
- [ ] Webhook endpoints

### Module 3 - Frontend (À venir)
- [ ] Dashboard utilisateur
- [ ] Visualisation des données
- [ ] Admin panel

## 📝 License

MIT

## 👥 Contribution

Les contributions sont les bienvenues ! Consultez le guide des adapters pour ajouter votre propre type de données.

## 🔗 Liens

- **Documentation CCIP** : https://docs.chain.link/ccip
- **Foundry Book** : https://book.getfoundry.sh
- **OpenZeppelin** : https://docs.openzeppelin.com/contracts

---

**Built with ❤️ for the decentralized AI agent ecosystem**
