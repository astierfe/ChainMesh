# ChainMesh Module 2 - Orchestration

Backend d'orchestration pour ChainMesh, gérant l'intégration entre les smart contracts blockchain et les services externes (OpenAI, n8n, webhooks).

## 🎯 Objectif

Ce module fournit la couche d'orchestration qui :
- Interagit avec les smart contracts du Module 1
- Intègre OpenAI pour l'analyse et la génération de données
- Orchestre les workflows via n8n
- Expose des webhooks pour l'intégration externe
- Gère les migrations et les mises à jour de données

## 📁 Structure

```
module2-orchestration/
├── src/
│   ├── providers/       # Intégrations blockchain (Ethers, viem)
│   ├── analyzers/       # Analyse des données on-chain
│   ├── signers/         # Gestion des transactions et signatures
│   ├── utils/           # Utilitaires partagés
│   ├── validators/      # Validation des données
│   └── config/          # Configuration de l'application
├── tests/
│   ├── unit/            # Tests unitaires
│   └── integration/     # Tests d'intégration
├── workflows/           # Workflows n8n (JSON)
├── migrations/          # Scripts de migration de données
├── logs/                # Fichiers de logs
├── .env.example         # Template des variables d'environnement
├── .gitignore
└── README.md            # Ce fichier
```

## 🚀 Quick Start

### Prérequis

- Node.js >= 18.x
- npm ou yarn
- Accès aux RPC nodes (Alchemy, Infura, etc.)
- Clés API OpenAI
- n8n installé (optionnel, pour les workflows)

### Installation

```bash
# Installation des dépendances
npm install

# Configuration de l'environnement
cp .env.example .env
# Éditer .env avec vos clés API et configurations
```

### Configuration

1. **Copier le fichier d'environnement :**
   ```bash
   cp .env.example .env
   ```

2. **Configurer les variables essentielles :**
   - `SEPOLIA_RPC_URL` : RPC URL pour Sepolia
   - `ARBITRUM_SEPOLIA_RPC_URL` : RPC URL pour Arbitrum Sepolia
   - `OPENAI_API_KEY` : Clé API OpenAI
   - `GENERIC_ORACLE_ADDRESS` : Adresse du GenericOracle déployé
   - `GENERIC_CACHE_ADDRESS` : Adresse du GenericCache déployé

3. **Vérifier la configuration :**
   ```bash
   npm run config:check
   ```

### Développement

```bash
# Mode développement avec hot-reload
npm run dev

# Build du projet
npm run build

# Lancer les tests
npm test

# Tests avec coverage
npm run test:coverage

# Linter
npm run lint

# Format du code
npm run format
```

## 🏗️ Architecture

### Providers
Gestion des connexions blockchain et interactions avec les smart contracts.
- `EthersProvider` : Wrapper autour d'ethers.js
- `ContractFactory` : Factory pour instancier les contrats
- `TransactionManager` : Gestion des transactions (nonce, gas, retry)

### Analyzers
Analyse des données on-chain et préparation pour les updates.
- `ReputationAnalyzer` : Analyse des scores de réputation
- `PriceAnalyzer` : Récupération et validation des prix
- `DataValidator` : Validation des données avant envoi

### Signers
Gestion sécurisée des clés privées et signature des transactions.
- `SecureSigner` : Wrapper sécurisé pour les signers
- `MultiSigManager` : Support multi-signature (futur)

### Workflows
Orchestration via n8n pour automatiser les processus.
- `reputation-update-workflow.json` : MAJ automatique des réputations
- `price-feed-workflow.json` : Flux de prix automatique
- `webhook-listener-workflow.json` : Écoute des événements externes

## 📊 Cas d'Usage

### 1. Mise à jour de réputation via OpenAI

```typescript
import { ReputationAnalyzer } from './src/analyzers/ReputationAnalyzer';
import { GenericOracleProvider } from './src/providers/GenericOracleProvider';

// Analyser la réputation d'un agent via OpenAI
const analyzer = new ReputationAnalyzer();
const reputation = await analyzer.analyzeAgent('agent-id-123');

// Mettre à jour sur la blockchain
const oracle = new GenericOracleProvider();
await oracle.updateReputation('agent-id-123', reputation);
```

### 2. Mise à jour de prix automatique

```typescript
import { PriceAnalyzer } from './src/analyzers/PriceAnalyzer';
import { GenericOracleProvider } from './src/providers/GenericOracleProvider';

// Récupérer le prix d'un asset
const priceAnalyzer = new PriceAnalyzer();
const price = await priceAnalyzer.getPrice('ETH/USD');

// Mettre à jour sur la blockchain
const oracle = new GenericOracleProvider();
await oracle.updatePrice('ETH/USD', price);
```

### 3. Webhook pour mise à jour externe

```typescript
import express from 'express';
import { WebhookHandler } from './src/utils/WebhookHandler';

const app = express();
const handler = new WebhookHandler();

app.post('/webhook/reputation', async (req, res) => {
  const result = await handler.handleReputationUpdate(req.body);
  res.json(result);
});
```

## 🔐 Sécurité

- ✅ Variables d'environnement pour les secrets
- ✅ Validation stricte des données entrantes
- ✅ Retry logic avec exponential backoff
- ✅ Rate limiting sur les appels API
- ✅ Gestion sécurisée des clés privées
- ✅ Logs des transactions pour auditabilité

## 🧪 Tests

```bash
# Tests unitaires
npm run test:unit

# Tests d'intégration
npm run test:integration

# Tests E2E
npm run test:e2e

# Coverage
npm run test:coverage
```

## 📖 Documentation

- [Architecture détaillée](./docs/ARCHITECTURE.md) *(à créer)*
- [Guide des Providers](./docs/PROVIDERS.md) *(à créer)*
- [Guide des Analyzers](./docs/ANALYZERS.md) *(à créer)*
- [Configuration n8n](./docs/N8N_SETUP.md) *(à créer)*

## 🗺️ Roadmap

### Phase 1 (À venir)
- [ ] Configuration du projet TypeScript
- [ ] Providers blockchain (Ethers/viem)
- [ ] Intégration OpenAI basique
- [ ] Tests unitaires

### Phase 2
- [ ] Analyzers pour réputation et prix
- [ ] Workflows n8n
- [ ] Webhook endpoints
- [ ] Tests d'intégration

### Phase 3
- [ ] Monitoring et alerting
- [ ] Dashboard admin
- [ ] Documentation complète
- [ ] Déploiement production

## 🛠️ Technologies

- **Node.js** : Runtime JavaScript
- **TypeScript** : Typage statique
- **Ethers.js / viem** : Interaction blockchain
- **OpenAI API** : Intelligence artificielle
- **n8n** : Automatisation des workflows
- **Jest** : Framework de tests
- **Express** : Serveur web (webhooks)

## 📝 License

MIT

## 🔗 Liens

- [Module 1 - Blockchain](../module1-blockchain/contracts/README.md)
- [Documentation principale](../README.md)

---

**Status actuel : 🚧 Structure créée, implémentation à venir**
