# ChainMesh - Guide de Développement Modulaire (Claude.md)

**Version:** 1.0  
**Date:** 31 janvier 2026  
**Objectif:** Source de vérité unique pour développement isolé par module

---

## Principes de Base

### Règle Absolue
Chaque module est développé **en isolation complète**. Un agent travaillant sur un module ne lit JAMAIS le code source d'un autre module, uniquement les interfaces définies dans ce document.

### Architecture Modulaire

```
ChainMesh = 6 Modules Indépendants
├── Module 1: Blockchain (Solidity)
├── Module 2: Orchestration (n8n)
├── Module 3: AI Engine (Claude API)
├── Module 4: Security (Lit Protocol)
├── Module 5: Data Layer (Goldsky)
└── Module 6: SDK & Plugin (TypeScript)
```

**Analogie:** Comme dans une architecture SOA où chaque service expose un WSDL (contrat), ici chaque module expose une interface TypeScript/Solidity stricte.

---

## Contrats de Données

### 1. ChainMesh Schema v1 (JSON)

**Fichier de référence:** `schemas/chainmesh-data-v1.schema.json`

**Structure simplifiée:**
```typescript
interface ChainMeshData {
  version: "1.0";
  
  wallet: {
    address: string;        // Format: EIP-55 checksum (0xAbC...)
    ens?: string;           // Optional ENS name
    labels: string[];       // Ex: ["whale", "early-adopter"]
  };
  
  activity: {
    chains: Array<{
      name: string;         // 'sepolia' | 'arbitrum' | 'base'
      firstSeen: string;    // ISO 8601
      lastActive: string;   // ISO 8601
      transactionCount: number;
      transactions: Transaction[];
    }>;
  };
  
  defi: {
    protocols: Array<{
      name: string;         // 'Aave' | 'Uniswap' | 'Compound'
      action: string;       // 'supply' | 'borrow' | 'swap'
      amount: string;       // Wei format (avoid float)
      timestamp: string;
    }>;
    liquidations: Liquidation[];
  };
}
```

**Validation:** Utiliser `ajv` (JSON Schema validator)

**Producteur:** Module 5 (Data Layer)  
**Consommateur:** Module 3 (AI Engine)

---

### 2. ScoringResult (TypeScript)

```typescript
interface ScoringResult {
  // Core scoring
  score: number;              // INTEGER 0-100
  tier: 'prime' | 'standard' | 'risky';
  confidence: number;         // FLOAT 0.0-1.0
  
  // Analysis details
  reasoning: string;          // Max 500 chars
  patterns: {
    isBot: boolean;
    botConfidence: number;    // 0.0-1.0
    washTrading: boolean;
  };
  riskFlags: string[];        // ['liquidation-history', ...]
  
  // Metadata
  analyzedAt: string;         // ISO 8601
}
```

**Producteur:** Module 3 (AI Engine)  
**Consommateur:** Module 2 (n8n), Module 4 (Lit)

---

### 3. SignablePayload (Solidity-compatible)

```typescript
interface SignablePayload {
  wallet: string;             // EIP-55 address
  score: number;              // 0-100 (cast to uint8)
  timestamp: number;          // Unix timestamp (cast to uint256)
  evidenceHash: string;       // IPFS CID v1 (format: "Qm..." or "bafy...")
}

// Encoding function (for Lit Protocol)
function encodePayload(payload: SignablePayload): string {
  return ethers.utils.defaultAbiCoder.encode(
    ['address', 'uint8', 'uint256', 'bytes32'],
    [payload.wallet, payload.score, payload.timestamp, payload.evidenceHash]
  );
}
```

**Note critique:** `evidenceHash` DOIT être un IPFS CID v1 encodé en SHA-256. Format: `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi` (base32).

---

## Interfaces de Modules

### Module 1: Blockchain (Solidity)

**Responsabilité:** Réception CCIP, stockage reputation, envoi responses

#### Fonctions Exposées

```solidity
// ChainMeshOracle.sol

// Function 1: Update reputation (called by n8n)
function updateReputation(
    address wallet,
    uint8 score,           // 0-100
    bytes32 evidenceHash   // IPFS CID v1 (bytes32 truncated)
) external onlyRole(UPDATER_ROLE);

// Function 2: Get reputation (public view)
function getReputation(address wallet) 
    external 
    view 
    returns (
        uint8 score,
        uint256 timestamp,
        bytes32 evidenceHash,
        bool isValid
    );
```

#### Events Émis

```solidity
event QueryReceived(
    bytes32 indexed messageId,
    address indexed wallet,
    uint64 sourceChain,
    address requester
);

event ReputationUpdated(
    address indexed wallet,
    uint8 score,
    bytes32 evidenceHash,
    uint256 timestamp
);
```

#### Consommation

**Par Module 2 (n8n):**
- Écoute `QueryReceived` via webhook
- Appelle `updateReputation()` après analyse AI

**Par Module 6 (SDK):**
- Appelle `getReputation()` pour lire cache

---

### Module 2: Orchestration (n8n)

**Responsabilité:** Coordination Data → AI → Signing → Blockchain

#### Workflow Principal: ScanMultiChain_Reputation

**Input (Webhook):**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "chains": ["sepolia", "arbitrum"],
  "includeAI": true
}
```

**Étapes:**
1. Call Module 5: `getWalletData(address, chains)` → `ChainMeshData`
2. Call Module 3: `analyzeReputation(data)` → `ScoringResult`
3. Validate AI output (anti-hallucination)
4. Hybrid scoring: `(AI × 0.6) + (Rules × 0.4)`
5. Call Module 4: `signPayload(payload)` → `MPCSignature`
6. Call Module 1: `updateReputation(wallet, score, evidenceHash, signature)`

**Output (HTTP Response):**
```json
{
  "statusCode": 200,
  "data": {
    "score": 87,
    "processingTime": "125s",
    "cached": false
  }
}
```

#### Abstractions Requises

```typescript
// À implémenter dans n8n Sub-Workflows

interface IDataProvider {
  getWalletData(address: string, chains: string[]): Promise<ChainMeshData>;
}

interface IScoringEngine {
  analyzeReputation(data: ChainMeshData): Promise<ScoringResult>;
}

interface ILitSigner {
  signPayload(payload: SignablePayload): Promise<string>;
}
```

**Note:** n8n NE doit PAS contenir la logique interne de ces modules, juste les appeler via interfaces.

---

### Module 3: AI Engine (Claude API)

**Responsabilité:** Analyse comportementale blockchain data → scoring

#### Fonction Principale

```typescript
async function analyzeReputation(
  data: ChainMeshData
): Promise<ScoringResult> {
  // 1. Validate input schema
  validateChainMeshSchema(data);
  
  // 2. Build prompt (internal logic)
  const prompt = buildPrompt(data);
  
  // 3. Call Claude API
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }]
  });
  
  // 4. Parse JSON response
  const result = JSON.parse(response.content[0].text);
  
  // 5. Return ScoringResult
  return result as ScoringResult;
}
```

#### Prompt Template (Interne au Module)

**Fichier:** `prompts/reputation-analysis-v1.txt`

**Structure (résumée):**
```
You are a blockchain reputation analyst.

INPUT DATA (JSON):
{...ChainMesh Schema v1...}

SCORING CRITERIA:
- Wallet age: 2+ years = +15 points
- Transaction volume: 1000+ txs = +10 points
- DeFi diversity: 5+ protocols = +15 points
- No liquidations: +20 points
- Bot detection: -30 points if true

OUTPUT FORMAT (STRICT JSON):
{
  "score": 0-100,
  "tier": "prime" | "standard" | "risky",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  "patterns": {...}
}

CRITICAL: Use ONLY provided data. Do NOT hallucinate.
```

**Isolation:** Module 2 (n8n) ne doit JAMAIS voir ce prompt. Il appelle juste `analyzeReputation(data)`.

---

### Module 4: Security (Lit Protocol)

**Responsabilité:** MPC signing du payload reputation

#### Fonction Principale

```typescript
async function signPayload(
  payload: SignablePayload
): Promise<string> {
  // 1. Serialize payload (ABI encoding)
  const encodedPayload = encodePayload(payload);
  
  // 2. Hash payload
  const hash = ethers.utils.keccak256(encodedPayload);
  
  // 3. Call Lit Protocol PKP
  const signature = await litNodeClient.executeJs({
    code: litActionCode,
    authSig: sessionSigs,
    jsParams: {
      toSign: ethers.utils.arrayify(hash),
      publicKey: pkpPublicKey
    }
  });
  
  // 4. Return signature (r,s,v format)
  return signature;
}
```

#### Configuration

```typescript
interface LitConfig {
  network: 'datil-test' | 'datil';
  pkpPublicKey: string;        // Set at deployment
  capacityTokenId: string;
}
```

**Isolation:** Module 4 ne connaît rien de la source du payload (AI, Blockchain, etc.). C'est juste un signer.

---

### Module 5: Data Layer (Goldsky)

**Responsabilité:** Query multi-chain → normalize to ChainMesh Schema

#### Fonction Principale

```typescript
async function getWalletData(
  address: string,
  chains: string[]
): Promise<ChainMeshData> {
  // 1. Query Goldsky (parallel)
  const promises = chains.map(chain => 
    queryGoldsky(address, chain)
  );
  const rawData = await Promise.all(promises);
  
  // 2. Normalize to ChainMesh Schema v1
  const normalized = normalizeToSchema(rawData);
  
  // 3. Validate against JSON Schema
  validateChainMeshSchema(normalized);
  
  return normalized;
}
```

#### Goldsky Query Template

```graphql
query GetWalletActivity($address: String!, $chain: String!) {
  transactions(
    where: {
      OR: [{ from: $address }, { to: $address }],
      chain: $chain
    },
    orderBy: timestamp_DESC,
    first: 1000
  ) {
    hash
    from
    to
    value
    timestamp
    token { symbol decimals }
  }
}
```

#### Fallback Strategy

```typescript
// Provider priority
const providers = [
  { name: 'goldsky', priority: 1, timeout: 10000 },
  { name: 'alchemy', priority: 2, timeout: 5000 },
  { name: 'etherscan', priority: 3, timeout: 8000 }
];

// Circuit breaker
if (failureCount[provider] >= 3) {
  skipProvider(provider, 60000); // 1 min cooldown
}
```

**Isolation:** Module 5 produit UNIQUEMENT du ChainMesh Schema v1. Consommateurs ne voient jamais le format Goldsky brut.

---

### Module 6: SDK & Plugin (Developer Interface)

**Responsabilité:** API simple pour developers

#### SDK API

```typescript
// chainmesh-sdk/src/ChainMesh.ts

class ChainMesh {
  constructor(config: ChainMeshConfig);
  
  // Method 1: Cache-first query
  async getReputation(address: string): Promise<ReputationResult>;
  
  // Method 2: Direct query (bypass cache)
  async queryMultiChain(
    address: string, 
    options?: QueryOptions
  ): Promise<ReputationResult>;
  
  // Method 3: CCIP async request
  async requestReputation(address: string): Promise<string>; // Returns requestId
}
```

#### ElizaOS Plugin

```typescript
// @elizaos/plugin-chainmesh

export const getReputationAction: Action = {
  name: 'GET_REPUTATION',
  similes: ['check reputation', 'get wallet score'],
  
  validate: (runtime, message) => {
    // Check if message contains address
    return /0x[a-fA-F0-9]{40}/.test(message.content.text);
  },
  
  handler: async (runtime, message) => {
    const address = extractAddress(message.content.text);
    const chainmesh = initializeSDK(runtime);
    const reputation = await chainmesh.getReputation(address);
    
    return formatResponse(reputation);
  }
};
```

**Isolation:** SDK utilise uniquement Contract ABI (interface publique). Ne dépend pas de n8n, AI, ou Data Layer.

---

## Développement par Module

### Workflow pour Agent Claude-code

#### Scenario: Développer Module 3 (AI Engine)

**Étape 1: Lire uniquement**
- ✅ Ce fichier (`Claude.md`)
- ✅ `schemas/chainmesh-data-v1.schema.json`
- ✅ `types/scoring.ts`

**Étape 2: NE PAS lire**
- ❌ n8n workflows code
- ❌ Blockchain contracts code
- ❌ SDK code

**Étape 3: Implémenter**
```typescript
// ai-engine/src/analyzer.ts

import { ChainMeshData } from '../types/data';
import { ScoringResult } from '../types/scoring';

export async function analyzeReputation(
  data: ChainMeshData
): Promise<ScoringResult> {
  // Implementation ici
  // Utilise UNIQUEMENT ChainMeshData en input
  // Retourne UNIQUEMENT ScoringResult en output
}
```

**Étape 4: Tester en isolation**
```typescript
// ai-engine/test/analyzer.test.ts

const mockData: ChainMeshData = { /* valid schema */ };
const result = await analyzeReputation(mockData);

expect(result.score).toBeGreaterThanOrEqual(0);
expect(result.score).toBeLessThanOrEqual(100);
expect(result.tier).toMatch(/prime|standard|risky/);
```

**Étape 5: Documenter interface**
```typescript
// ai-engine/README.md

## API

### analyzeReputation(data: ChainMeshData): Promise<ScoringResult>

**Input:** ChainMesh Schema v1 compliant object
**Output:** ScoringResult with score 0-100
**Throws:** ValidationError if schema invalid
```

---

## Checklist de Développement Isolé

### Avant de Commencer un Module

- [ ] J'ai lu `Claude.md` (ce fichier)
- [ ] J'ai identifié mon module (1-6)
- [ ] J'ai identifié les interfaces d'entrée/sortie
- [ ] J'ai les schemas de données requis

### Pendant le Développement

- [ ] Je n'ai PAS importé de code d'autres modules
- [ ] Je respecte les interfaces TypeScript/Solidity
- [ ] Je valide les inputs/outputs (schemas)
- [ ] Je documente mon API publique

### Avant de Commit

- [ ] Tests unitaires passent (isolation)
- [ ] Pas de dépendances cross-module
- [ ] Interface documentée dans README
- [ ] Exemple d'usage fourni

---

## Résolution de Conflits

### Si Interface Manquante

**Exemple:** "Je travaille sur Module 2 (n8n) et j'ai besoin d'appeler Module 5 (Data Layer) mais l'interface n'est pas claire."

**Solution:**
1. Consulter `Module_Interfaces_ChainMesh.md`
2. Si encore flou, créer une issue: "Interface undefined: Module 2 → Module 5"
3. **NE PAS** lire le code de Module 5 pour deviner

### Si Schema Invalide

**Exemple:** "Module 3 (AI) reçoit des données qui ne matchent pas ChainMesh Schema v1."

**Solution:**
1. Valider avec JSON Schema validator
2. Identifier qui produit les données (Module 5)
3. Créer issue: "Schema validation failed: Module 5 output"
4. **NE PAS** adapter Module 3 à des données non-standard

---

## Version & Maintenance

**Version actuelle:** 1.0  
**Dernière mise à jour:** 31 janvier 2026

**Changelog:**
- v1.0 (2026-01-31): Version initiale

**Prochaines mises à jour:**
- Après Phase 1 (Week 4): Validation post-implémentation
- Après Phase 2 (Week 11): Intégration Lit + Goldsky + ElizaOS

**Responsable:** Felix (felix@chainmesh.dev)

---

## Références Rapides

### Schemas Critiques

| Schema | Fichier | Producteur | Consommateur |
|--------|---------|------------|--------------|
| ChainMesh Data v1 | `schemas/chainmesh-data-v1.schema.json` | Module 5 | Module 3 |
| ScoringResult | `types/scoring.ts` | Module 3 | Module 2, 4 |
| SignablePayload | `types/signing.ts` | Module 2 | Module 4 |

### Commandes Utiles

```bash
# Valider ChainMesh Schema
ajv validate -s schemas/chainmesh-data-v1.schema.json -d data.json

# Tester un module en isolation
cd module-3-ai-engine
npm test

# Vérifier dépendances cross-module (DANGER)
madge --circular src/
```

---

**Fin de Claude.md v1.0**

Ce document est la **source de vérité unique** pour développement isolé. En cas de contradiction avec TAD/PRD, ce fichier fait foi pour les interfaces.
