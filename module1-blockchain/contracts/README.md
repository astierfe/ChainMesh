# ChainMesh - Module 1 (Blockchain Layer)

> Infrastructure cross-chain de réputation décentralisée basée sur Chainlink CCIP

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue.svg)](https://soliditylang.org/)
[![Tests](https://img.shields.io/badge/Tests-40%2F40-brightgreen.svg)](./test/)
[![Coverage](https://img.shields.io/badge/Coverage-%3E90%25-brightgreen.svg)](./test/)

## 🚀 Quick Start

```bash
# Installation (si pas déjà fait)
cd /home/astier-flx/projects/chain-mesh/contracts
source ~/.bashrc  # Active PATH Foundry

# Compiler
forge build

# Tests
forge test

# Coverage
forge coverage

# Gas report
forge test --gas-report
```

## 📁 Structure

```
contracts/
├── src/
│   ├── ChainMeshOracle.sol    # Oracle Sepolia (source de vérité)
│   ├── ChainMeshCache.sol     # Cache consumer chains
│   ├── CCIPReceiver.sol       # Base CCIP
│   └── interfaces/            # CCIP interfaces
├── test/                      # 40 tests unitaires
├── script/                    # Scripts déploiement (TODO)
└── MODULE1_HANDOFF.md         # 📖 DOCUMENTATION COMPLÈTE
```

## 📖 Documentation

**[→ Lire MODULE1_HANDOFF.md](./MODULE1_HANDOFF.md)** pour :
- Architecture détaillée
- Guide d'intégration Module 2
- Events & Interfaces
- Configuration déploiement
- Gas estimates

## 🎯 Smart Contracts

### ChainMeshOracle (Sepolia)
Source de vérité centralisée pour toutes les réputations.
- `updateReputation()` : Mise à jour score (UPDATER_ROLE)
- `getReputation()` : Lecture publique
- `sendResponse()` : Envoi réponse via CCIP

### ChainMeshCache (Arbitrum, Base, Optimism)
Cache local avec TTL 24h et rate limiting.
- `getReputation()` : Lecture avec cache hit/miss
- `requestReputation()` : Requête CCIP (payable)

## 🧪 Tests

```bash
# Tous les tests
forge test

# Test spécifique
forge test --match-test test_UpdateReputation_Success

# Mode verbose
forge test -vv

# Très verbose (stack traces)
forge test -vvv
```

**Résultats** : 40/40 tests ✅ (100% pass rate)

## ⛽ Gas Benchmarks

| Fonction | Gas | Optimisé |
|----------|-----|----------|
| updateReputation | ~51k | ✅ <100k |
| sendResponse | ~48k | ✅ |
| requestReputation | ~110k | ✅ |
| getReputation | ~5k | ✅ |

## 🔧 Configuration

Variables d'environnement dans `../.env` :
```bash
ETHEREUM_RPC_URL=...
ARBITRUM_RPC_URL=...
BASE_RPC_URL=...
OPTIMISM_RPC_URL=...

SEPOLIA_ROUTER=0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59
ARBITRUM_ROUTER=0x2a138cDc982cb69107144663da6332130c6b8351
# ... etc
```

## 🚢 Déploiement

```bash
# TODO: Scripts à créer dans /script
forge script script/DeployOracle.s.sol --rpc-url $ETHEREUM_RPC_URL --broadcast
forge script script/DeployCache.s.sol --rpc-url $ARBITRUM_RPC_URL --broadcast
```

## 🔐 Sécurité

- ✅ Replay protection (CCIP messageId)
- ✅ Rate limiting (1 req/h par user)
- ✅ Access Control (OpenZeppelin)
- ✅ Zero address checks
- ✅ Score validation (0-100)
- ✅ Custom errors (gas efficient)

## 📊 Status

- [x] Smart contracts implémentés
- [x] Tests unitaires (40/40)
- [x] Coverage >90%
- [x] Gas optimisé
- [ ] Scripts déploiement
- [ ] Audit Slither
- [ ] Déploiement testnets

## 🔗 Liens

- [Foundry Book](https://book.getfoundry.sh/)
- [Chainlink CCIP Docs](https://docs.chain.link/ccip)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)

---

**Version** : 1.0.0
**Date** : 5 février 2026
**License** : MIT
