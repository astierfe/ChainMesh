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

## 📁 Structure du Monorepo

```
chainmesh/
├── module1-blockchain/       # Smart contracts Foundry/Solidity
│   └── contracts/
│       ├── src/              # Contrats sources
│       ├── test/             # Tests unitaires et d'intégration
│       ├── script/           # Scripts de déploiement
│       └── foundry.toml      # Configuration Foundry
│
├── module2-orchestration/    # Backend orchestration (à venir)
│   ├── src/                  # Code source TypeScript/Node.js
│   ├── tests/                # Tests
│   ├── workflows/            # n8n workflows
│   └── migrations/           # Migrations DB
│
├── docs/                     # Documentation globale
└── README.md                 # Ce fichier
```

## 🚀 Quick Start

### Module 1 - Blockchain Layer

Infrastructure blockchain avec GenericOracle, GenericCache et Adapters.

```bash
cd module1-blockchain/contracts
forge install
forge test
```

📖 **Documentation complète** : [module1-blockchain/contracts/README.md](module1-blockchain/contracts/README.md)

**État actuel :** ✅ Complété (123 tests, >80% coverage)

### Module 2 - Orchestration (À venir)

Backend d'orchestration avec n8n, OpenAI et webhooks.

```bash
cd module2-orchestration
npm install
npm run dev
```

**État actuel :** 🚧 Structure créée, implémentation à venir

## 🏗️ Architecture Globale

### Module 1 : Blockchain Layer
- **GenericOracle** : Stockage key-value générique avec CCIP
- **GenericCache** : Cache TTL avec rate limiting
- **Adapters** : ReputationAdapter, PriceAdapter (pluggables)

### Module 2 : Orchestration Layer (Planifié)
- **Providers** : Intégrations blockchain (Ethers, viem)
- **Analyzers** : Analyse des données on-chain
- **Signers** : Gestion des transactions
- **Workflows** : Automatisations n8n

### Module 3 : Frontend (Futur)
- Dashboard utilisateur
- Visualisation des données
- Admin panel

## 📊 Statistiques

### Module 1 - Blockchain
- **123 tests** au total
- **97.10%** coverage (GenericOracle)
- **96.36%** coverage (GenericCache)
- **>80%** coverage (Adapters)

## 🔑 Concepts Clés

### Schema Versioning
Chaque adapter définit un schema unique pour supporter différents types de données :
```solidity
bytes32 public constant SCHEMA_HASH = keccak256("ReputationV1");
```

### Generic Storage
Stockage flexible basé sur `bytes` au lieu de structures hardcodées :
```solidity
struct DataEntry {
    bytes32 key;
    bytes32 schemaHash;
    uint32 timestamp;
    bool isValid;
}
mapping(bytes32 => bytes) public dataValues;
```

### Adapters Stateless
Helpers d'encodage/décodage sans état propre :
```solidity
interface IDataAdapter {
    function getSchemaHash() external pure returns (bytes32);
    function getDefaultValue() external pure returns (bytes memory);
}
```

## 📖 Documentation

### Documentation par Module
- [Module 1 - Blockchain](module1-blockchain/contracts/README.md)
- [Module 2 - Orchestration](module2-orchestration/README.md) *(à créer)*

### Documentation Technique
- [Architecture Module 1](docs/SPEC_Module1_Blockchain.md)
- [Architecture détaillée](docs/MODULE1_ARCHITECTURE.md)
- [Rapport de refactoring](module1-blockchain/contracts/REFACTORING_REPORT.md)

## 🗺️ Roadmap

### ✅ Module 1 - Blockchain Layer (Complété)
- [x] GenericOracle avec CCIP
- [x] GenericCache avec TTL et rate limiting
- [x] ReputationAdapter
- [x] PriceAdapter
- [x] Tests complets (>80% coverage)

### 🚧 Module 2 - Orchestration (En cours)
- [ ] Structure du projet créée
- [ ] Configuration n8n workflows
- [ ] Intégration OpenAI
- [ ] Webhook endpoints
- [ ] Tests unitaires et d'intégration

### 📋 Module 3 - Frontend (Futur)
- [ ] Dashboard utilisateur
- [ ] Visualisation des données
- [ ] Admin panel

## 🔐 Sécurité

- ✅ CEI pattern (Checks-Effects-Interactions)
- ✅ ReentrancyGuard
- ✅ AccessControl (OpenZeppelin)
- ✅ Rate limiting
- ✅ Schema validation
- ✅ Whitelist de chains

## 🛠️ Technologies

### Module 1
- Solidity 0.8.20
- Foundry
- Chainlink CCIP
- OpenZeppelin

### Module 2 (Planifié)
- Node.js / TypeScript
- n8n
- OpenAI API
- Ethers.js / viem

## 📝 License

MIT

## 👥 Contribution

Les contributions sont les bienvenues ! Consultez la documentation de chaque module pour comprendre l'architecture avant de contribuer.

## 🔗 Liens Utiles

- **Documentation CCIP** : https://docs.chain.link/ccip
- **Foundry Book** : https://book.getfoundry.sh
- **OpenZeppelin** : https://docs.openzeppelin.com/contracts

---

**Built with ❤️ for the decentralized AI agent ecosystem**
