# ChainMesh - Interfaces de Modules (Version 1.0)

**Date:** 31 janvier 2026  
**Objectif:** Définir les frontières strictes entre modules pour développement isolé

**Règle d'Or:** Un agent travaillant sur un module ne doit JAMAIS modifier ou dépendre de l'implémentation interne d'un autre module, uniquement de son interface définie ici.

---

## MODULE 1: Smart Contracts (Blockchain Layer)

**Technologie:** Solidity 0.8.20+ / Foundry  
**Localisation:** `contracts/src/`  
**Responsable:** Foundry agent

### Interface d'Entrée

**1.1 Requête de Réputation (depuis Cache contracts)**
```solidity
// Event émis par ChainMeshCache (consumer chain)
// Reçu via CCIP par ChainMeshOracle
event RequestSent(
    bytes32 indexed messageId,
    address indexed wallet,
    address requester
);

// Données CCIP message
struct QueryMessage {
    address wallet;      // Wallet à analyser
    address requester;   // Qui a fait la requête
}
```

**1.2 Mise à Jour de Réputation (depuis n8n via Lit)**
```solidity
// Fonction appelée par n8n après analyse AI
function updateReputation(
    address wallet,
    uint8 score,           // 0-100
    bytes32 evidenceHash   // IPFS CID v1 (SHA-256)
) external onlyRole(UPDATER_ROLE);
```

---

### Interface de Sortie

**1.3 Event Query Reçue**
```solidity
event QueryReceived(
    bytes32 indexed messageId,
    address indexed wallet,
    uint64 sourceChain,
    address requester
);
```
**Consommateur:** n8n (webhook trigger)

**1.4 Réponse CCIP**
```solidity
// Message CCIP envoyé vers consumer chain
struct ResponseMessage {
    address wallet;
    uint8 score;
    uint32 timestamp;
    bytes32 evidenceHash;
}

event ResponseSent(
    bytes32 indexed messageId,
    uint64 destinationChain,
    address wallet,
    uint8 score
);
```
**Consommateur:** ChainMeshCache (consumer chain)

---

### Dépendances Externes
- Chainlink CCIP Router (immutable, fourni par Chainlink)
- OpenZeppelin AccessControl, ReentrancyGuard

### Isolation
✅ **Complète** - Aucune connaissance de n8n, AI, ou Data Layer requis

---

## MODULE 2: Orchestration (n8n Layer)

**Technologie:** n8n (Docker), Node.js  
**Localisation:** n8n workflows (self-hosted)  
**Responsable:** n8n agent

### Interface d'Entrée

**2.1 Webhook HTTP (API Gateway)**
```json
POST /api/query
{
  "address": "0x742d35Cc...",
  "chains": ["sepolia", "arbitrum", "base"],
  "dataType": "reputation",
  "includeAI": true
}
```
**Déclencheur:** SDK, ElizaOS Plugin, dApps externes

**2.2 Blockchain Event (Query Reçue)**
```json
{
  "event": "QueryReceived",
  "messageId": "0xABC123...",
  "wallet": "0x742d35Cc...",
  "sourceChain": "3478487238524512106",
  "requester": "0xDEF456..."
}
```
**Déclencheur:** Event listener (webhook ou polling)

---

### Interface de Sortie

**2.3 Requête Data Provider**
```typescript
interface DataProviderRequest {
  address: string;           // EIP-55 checksum
  chains: string[];          // ['sepolia', 'arbitrum', ...]
  includeTransactions: boolean;
  includeDeFi: boolean;
}
```
**Consommateur:** Module 5 (Data Layer)

**2.4 Requête Scoring Engine**
```typescript
interface ScoringRequest {
  data: ChainMeshData;      // Format ChainMesh Schema v1
  includeAI: boolean;
}
```
**Consommateur:** Module 3 (AI Engine)

**2.5 Requête Signature**
```typescript
interface SignatureRequest {
  payload: {
    wallet: string;
    score: number;
    timestamp: number;
    evidenceHash: string;
  };
  pkpPublicKey: string;
}
```
**Consommateur:** Module 4 (Security - Lit Protocol)

**2.6 Transaction Blockchain**
```typescript
// Appel à ChainMeshOracle.updateReputation()
interface BlockchainUpdate {
  contractAddress: string;
  functionName: 'updateReputation';
  args: [wallet, score, evidenceHash];
  signature: string;          // Fourni par Lit
}
```
**Consommateur:** Module 1 (Blockchain)

---

### Contrat de Données
**Format standard:** ChainMesh Schema v1 (JSON)
- Produit par: Module 2 (après agrégation Data Layer)
- Consommé par: Module 3 (AI Engine)
- Schéma: `schemas/chainmesh-data-v1.schema.json`

---

### Isolation
⚠️ **Moyenne** - Dépend de:
- Interface `IDataProvider` (Module 5)
- Interface `IScoringEngine` (Module 3)
- Interface `ILitSigner` (Module 4)

**Point d'amélioration:** Abstraire ces dépendances

---

## MODULE 3: AI Engine (Claude API)

**Technologie:** Anthropic Claude API (Sonnet 4)  
**Localisation:** n8n Code Nodes, ou module TypeScript dédié  
**Responsable:** AI agent

### Interface d'Entrée

**3.1 Données Normalisées**
```typescript
interface ChainMeshData {
  version: "1.0";
  wallet: {
    address: string;
    ens?: string;
    labels: string[];
  };
  activity: {
    chains: ChainActivity[];
  };
  defi: {
    protocols: DeFiInteraction[];
    liquidations: Liquidation[];
  };
}
```
**Format complet:** Voir `schemas/chainmesh-data-v1.schema.json`  
**Producteur:** Module 2 (n8n après normalisation Data Layer)

---

### Interface de Sortie

**3.2 Résultat de Scoring**
```typescript
interface ScoringResult {
  score: number;              // 0-100 (integer)
  tier: 'prime' | 'standard' | 'risky';
  confidence: number;         // 0.0-1.0 (float)
  reasoning: string;          // Max 500 caractères
  patterns: {
    isBot: boolean;
    botConfidence: number;    // 0.0-1.0
    washTrading: boolean;
  };
  riskFlags: string[];
  analyzedAt: string;         // ISO 8601
}
```
**Consommateur:** Module 2 (n8n Validation Layer)

---

### Isolation
✅ **Excellente** - Aucune connaissance de:
- Blockchain (ne reçoit que JSON)
- CCIP (transparent pour l'IA)
- Lit Protocol (signature post-analyse)

**Note:** Le prompt Claude est un détail d'implémentation interne à ce module. n8n ne doit PAS construire le prompt.

---

## MODULE 4: Security (Lit Protocol MPC)

**Technologie:** Lit Protocol PKP (Datil-Test)  
**Localisation:** n8n Sub-Workflow ou SDK wrapper  
**Responsable:** Security agent

### Interface d'Entrée

**4.1 Payload à Signer**
```typescript
interface SignablePayload {
  wallet: string;             // Address EIP-55
  score: number;              // 0-100
  timestamp: number;          // Unix timestamp
  evidenceHash: string;       // IPFS CID v1
}
```
**Format sérialisé:** ABI-encode (Solidity compatible)

**4.2 Authentification**
```typescript
interface AuthSignature {
  sig: string;                // Session signature
  derivedVia: "web3.eth.personal.sign";
  signedMessage: string;
  address: string;
}
```

---

### Interface de Sortie

**4.3 Signature MPC**
```typescript
interface MPCSignature {
  signature: string;          // Signature ECDSA (r,s,v)
  signingTime: number;        // Latency in ms
  nodeCount: number;          // Nombre de nodes MPC (ex: 67/100)
}
```
**Consommateur:** Module 2 (n8n pour broadcast tx)

---

### Dépendances Externes
- Lit Protocol Network (100 nodes)
- Session signature (générée par n8n une fois par session)

---

### Isolation
✅ **Excellente** - Reçoit uniquement:
- Payload structuré (TypeScript interface)
- Auth signature

Ne connaît rien de:
- Source des données (AI, Blockchain, etc.)
- Utilisation finale (signature pour quoi?)

---

## MODULE 5: Data Layer (Goldsky + Fallbacks)

**Technologie:** Goldsky GraphQL, Alchemy RPC, Etherscan API  
**Localisation:** n8n Sub-Workflows ou module TypeScript  
**Responsable:** Data agent

### Interface d'Entrée

**5.1 Requête Multi-Chain**
```typescript
interface DataRequest {
  address: string;            // EIP-55 checksum
  chains: ChainName[];        // ['sepolia', 'arbitrum', 'base']
  dataTypes: DataType[];      // ['transactions', 'defi', 'nfts']
  timeRange?: {
    from: number;             // Unix timestamp
    to: number;
  };
}

type ChainName = 'sepolia' | 'arbitrum' | 'base' | 'optimism' | 'polygon';
type DataType = 'transactions' | 'defi' | 'nfts' | 'balances';
```
**Producteur:** Module 2 (n8n Orchestrator)

---

### Interface de Sortie

**5.2 Données Normalisées (ChainMesh Schema v1)**
```typescript
interface ChainMeshData {
  version: "1.0";
  wallet: WalletInfo;
  activity: ActivityData;
  defi: DeFiData;
  nfts?: NFTData;           // Optional
}
```
**Format complet:** `schemas/chainmesh-data-v1.schema.json`  
**Consommateur:** Module 3 (AI Engine)

**Validation:** JSON Schema automatique

---

### Fallback Strategy

**Providers (ordre de priorité):**
1. Goldsky (primary) - Latency: ~800ms
2. Alchemy RPC (fallback 1) - Latency: ~1.5s
3. Etherscan API (fallback 2) - Latency: ~3s
4. Public RPC (fallback 3) - Latency: ~5s

**Circuit Breaker:**
- 3 failures → Skip provider (1 min cooldown)
- Automatic recovery après cooldown

---

### Isolation
⚠️ **Moyenne** - Doit connaître:
- ChainMesh Schema v1 (contrat de données)

Ne connaît PAS:
- Utilisation finale (AI, Blockchain, etc.)
- Logique de scoring

**Point d'amélioration:** Interface `IDataProvider` abstraite

---

## MODULE 6: SDK & Plugin (Developer Interface)

**Technologie:** TypeScript (npm), ElizaOS Framework  
**Localisation:** `packages/chainmesh-sdk/`, `packages/elizaos-plugin/`  
**Responsable:** SDK agent

### Interface d'Entrée

**6.1 Configuration**
```typescript
interface ChainMeshConfig {
  chains: ChainConfig[];
  defaultChain: string;
  goldsky?: {
    enabled: boolean;
    endpoint: string;
  };
}
```

**6.2 Developer API Calls**
```typescript
// Méthode principale
async getReputation(address: string): Promise<ReputationResult>

// Méthode directe (bypass cache)
async queryMultiChain(
  address: string, 
  options?: QueryOptions
): Promise<ReputationResult>

// Méthode CCIP (async)
async requestReputation(address: string): Promise<RequestID>
```

---

### Interface de Sortie

**6.3 Résultat Unifié**
```typescript
interface ReputationResult {
  address: string;
  score: number;              // 0-100
  tier: string;               // 'prime' | 'standard' | 'risky'
  confidence: number;         // 0.0-1.0
  isFromCache: boolean;
  timestamp: string;          // ISO 8601
  expiresAt?: string;         // Si cached
}
```

**6.4 ElizaOS Actions**
```typescript
// Action: GET_REPUTATION
{
  name: 'GET_REPUTATION',
  similes: ['check reputation', 'get wallet score'],
  handler: async (runtime, message) => ReputationResult
}
```

---

### Dépendances Externes
- ethers.js v6 (blockchain interaction)
- ChainMesh smart contracts (ABI)

---

### Isolation
✅ **Bonne** - Utilise uniquement:
- Contract ABI (interface publique)
- RPC endpoints (standard)

⚠️ **Amélioration possible:** Ne pas assumer `DEFAULT_SCORE = 60`

---

## Schéma Global des Interfaces

```mermaid
graph TB
    subgraph "MODULE 6: SDK & Plugin"
        SDK[chainmesh-sdk]
        Plugin[elizaos-plugin]
    end
    
    subgraph "MODULE 1: Blockchain"
        Oracle[ChainMeshOracle]
        Cache[ChainMeshCache]
    end
    
    subgraph "MODULE 2: Orchestration"
        N8N[n8n Workflows]
        Gateway[API Gateway]
    end
    
    subgraph "MODULE 5: Data Layer"
        Goldsky[Goldsky Provider]
        Schema[ChainMesh Schema v1]
    end
    
    subgraph "MODULE 3: AI Engine"
        Claude[Claude API]
        Validation[Validation Layer]
    end
    
    subgraph "MODULE 4: Security"
        Lit[Lit Protocol MPC]
    end
    
    SDK -->|Contract ABI| Cache
    Plugin -->|SDK API| SDK
    
    Cache -->|CCIP Event| Oracle
    Oracle -->|Event: QueryReceived| Gateway
    
    Gateway -->|HTTP JSON| N8N
    N8N -->|DataRequest| Goldsky
    Goldsky -->|ChainMesh Schema v1| N8N
    
    N8N -->|ChainMesh Schema v1| Claude
    Claude -->|ScoringResult| Validation
    Validation -->|Validated Score| N8N
    
    N8N -->|SignablePayload| Lit
    Lit -->|MPCSignature| N8N
    
    N8N -->|updateReputation(signed)| Oracle
    Oracle -->|CCIP Response| Cache
    
    style Schema fill:#FFD700
    style Oracle fill:#87CEEB
    style Claude fill:#90EE90
    style Lit fill:#FF69B4
```

---

## Contrats de Données Critiques

### 1. ChainMesh Schema v1
- **Fichier:** `schemas/chainmesh-data-v1.schema.json`
- **Producteur:** Module 5 (Data Layer)
- **Consommateur:** Module 3 (AI Engine)
- **Validation:** JSON Schema Validator
- **Statut:** ❌ **À CRÉER (P0)**

### 2. ScoringResult Interface
- **Fichier:** `types/scoring.ts`
- **Producteur:** Module 3 (AI Engine)
- **Consommateur:** Module 2 (n8n), Module 4 (Lit)
- **Validation:** TypeScript compiler
- **Statut:** ⚠️ **Partiellement défini (P1)**

### 3. Contract ABI
- **Fichier:** Généré par Foundry (`out/`)
- **Producteur:** Module 1 (Blockchain)
- **Consommateur:** Module 6 (SDK)
- **Validation:** Solidity compiler
- **Statut:** ✅ **Auto-généré**

---

## Règles de Développement Isolé

### Pour Agents Claude-code

**Agent travaillant sur Module 1 (Blockchain):**
- ✅ Lire: Ce fichier (interfaces), Contract ABI
- ❌ Ne PAS lire: n8n code, AI code, Data code

**Agent travaillant sur Module 2 (n8n):**
- ✅ Lire: Ce fichier, ChainMesh Schema v1, ScoringResult types
- ❌ Ne PAS lire: Implémentation interne Claude, Lit, Goldsky
- ⚠️ Utiliser: Abstractions `IDataProvider`, `IScoringEngine`

**Agent travaillant sur Module 3 (AI):**
- ✅ Lire: ChainMesh Schema v1, ScoringResult interface
- ❌ Ne PAS lire: n8n code, Blockchain code
- ✅ Focus: Analyse de données JSON → Output JSON

**Agent travaillant sur Module 5 (Data):**
- ✅ Lire: ChainMesh Schema v1, DataRequest interface
- ❌ Ne PAS lire: AI code, Blockchain code
- ✅ Focus: Providers → Schema normalisé

---

## Prochaines Actions (Par Priorité)

**P0 - Bloquant:**
1. Créer `schemas/chainmesh-data-v1.schema.json`
2. Documenter format `evidenceHash` (IPFS CID v1, SHA-256)
3. Finaliser `Claude.md` avec ces interfaces

**P1 - Important:**
4. Créer `types/scoring.ts` (ScoringResult strict)
5. Créer `types/data-provider.ts` (IDataProvider interface)
6. Extraire prompt Claude dans fichier séparé

**P2 - Nice to have:**
7. Implémenter Circuit Breaker abstraction
8. Versioning automatique des schemas (v1.0, v1.1)

---

**Version:** 1.0  
**Dernière Mise à Jour:** 31 janvier 2026  
**Prochaine Révision:** Semaine 4 (après Phase 1)
