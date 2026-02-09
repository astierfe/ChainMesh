# ChainMesh Module 1 - Architecture & Design

Infrastructure oracle cross-chain generique construite sur Chainlink CCIP. Le systeme permet a des agents IA (via n8n/Lit Protocol) de stocker et distribuer des donnees (reputation, prix, etc.) entre blockchains via un pattern adapters schema-agnostique.

---

## Vue d'ensemble

```mermaid
graph TB
    subgraph "Consumer Chain (Arbitrum, Base, ...)"
        User([Agent IA / DApp])
        Cache[GenericCache]
        Router2[CCIP Router]
    end

    subgraph "CCIP Network"
        CCIP{{Chainlink CCIP}}
    end

    subgraph "Oracle Chain (Sepolia)"
        Router1[CCIP Router]
        Oracle[GenericOracle]
        RepAdapter[ReputationAdapter]
        PriceAdapter[PriceAdapter]
        Updater([n8n / Lit Protocol])
    end

    User -->|"1. requestData(key, schema)"| Cache
    Cache -->|"2. ccipSend(query)"| Router2
    Router2 -->|"3. cross-chain"| CCIP
    CCIP -->|"4. cross-chain"| Router1
    Router1 -->|"5. ccipReceive(query)"| Oracle
    Oracle -.->|"6. emit QueryReceived"| Updater
    Updater -->|"7. updateData(key, value)"| RepAdapter
    Updater -->|"7. updateData(key, value)"| PriceAdapter
    RepAdapter -->|"encode + store"| Oracle
    PriceAdapter -->|"encode + store"| Oracle
    Updater -->|"8. sendResponse(msgId, key)"| Oracle
    Oracle -->|"9. ccipSend(response)"| Router1
    Router1 -->|"10. cross-chain"| CCIP
    CCIP -->|"11. cross-chain"| Router2
    Router2 -->|"12. ccipReceive(response)"| Cache
    User -->|"13. getData(key)"| Cache
```

Le flux complet : un utilisateur sur la chain consommateur demande une donnee via le Cache. Le Cache envoie une requete CCIP a l'Oracle. L'Oracle emet un evenement capte par un agent off-chain (n8n), qui met a jour la donnee via un Adapter, puis declenche l'envoi de la reponse. Le Cache la recoit et la stocke avec un TTL de 24h.

---

## Hierarchie des contrats

```mermaid
classDiagram
    class CCIPReceiver {
        <<abstract>>
        -address i_ccipRouter
        +ccipReceive(message)*
        #_ccipReceive(message)*
        +getRouter() address
        +supportsInterface(bytes4) bool
    }

    class AccessControl {
        <<OpenZeppelin>>
        +grantRole()
        +revokeRole()
        +hasRole()
    }

    class ReentrancyGuard {
        <<OpenZeppelin>>
        #nonReentrant
    }

    class IDataAdapter {
        <<interface>>
        +getSchemaHash() bytes32
        +getDefaultValue() bytes
    }

    class GenericOracle {
        +UPDATER_ROLE bytes32
        +PAUSER_ROLE bytes32
        +dataEntries mapping
        +dataValues mapping
        +queryRequests mapping
        +processedMessages mapping
        +whitelistedChains mapping
        +strictMode bool
        +updateData(key, value, schema)
        +getData(key)
        +sendResponse(msgId, key)
        +invalidateData(key)
        +whitelistChain(selector)
        #_ccipReceive(message)
    }

    class GenericCache {
        +CACHE_TTL = 24h
        +MIN_REQUEST_INTERVAL = 1h
        +ORACLE_ADDRESS address
        +ORACLE_CHAIN_SELECTOR uint64
        +cache mapping
        +lastRequestTime mapping
        +getData(key)
        +requestData(key, schema)
        +invalidateCache(key)
        #_ccipReceive(message)
    }

    class ReputationAdapter {
        +SCHEMA_HASH = keccak256 ReputationV1
        +DEFAULT_SCORE = 60
        +getKey(wallet) bytes32
        +updateReputation(oracle, wallet, score, evidence)
        +getReputation(oracle, wallet)
        +encode(score, evidence) bytes
        +decode(data)
    }

    class PriceAdapter {
        +SCHEMA_HASH = keccak256 PriceV1
        +getKey(symbol) bytes32
        +updatePrice(oracle, symbol, price, decimals)
        +getPrice(oracle, symbol)
    }

    CCIPReceiver <|-- GenericOracle
    AccessControl <|-- GenericOracle
    ReentrancyGuard <|-- GenericOracle

    CCIPReceiver <|-- GenericCache
    AccessControl <|-- GenericCache

    IDataAdapter <|.. ReputationAdapter
    IDataAdapter <|.. PriceAdapter
```

L'Oracle et le Cache heritent tous deux de `CCIPReceiver` (reception de messages cross-chain) et `AccessControl` (gestion des roles). L'Oracle ajoute `ReentrancyGuard` pour proteger `sendResponse`. Les Adapters sont stateless : ils implementent `IDataAdapter` et servent uniquement d'encodeurs/decodeurs entre donnees metier et le format generique `bytes` de l'Oracle.

---

## Fichiers sources

### Infrastructure

| Fichier | Role |
|---|---|
| `src/CCIPReceiver.sol` | Base abstraite : recoit les messages CCIP via le modifier `onlyRouter`, delegue a `_ccipReceive()` |
| `src/GenericOracle.sol` | Oracle chain : stocke les donnees cle-valeur, recoit les requetes CCIP, envoie les reponses |
| `src/GenericCache.sol` | Consumer chain : cache TTL 24h, rate-limit 1h/cle, requetes CCIP vers l'Oracle |

### Interfaces

| Fichier | Role |
|---|---|
| `src/interfaces/Client.sol` | Library : structs CCIP (`Any2EVMMessage`, `EVM2AnyMessage`, `EVMExtraArgsV1`) |
| `src/interfaces/IRouterClient.sol` | Interface du router CCIP (`ccipSend`, `getFee`) |
| `src/interfaces/IAny2EVMMessageReceiver.sol` | Interface de reception CCIP (`ccipReceive`) |
| `src/interfaces/IGenericOracle.sol` | Interface Oracle pour les Adapters (`updateData`, `getData`) |
| `src/interfaces/IDataAdapter.sol` | Interface standard Adapter (`getSchemaHash`, `getDefaultValue`) |

### Adapters

| Fichier | Role |
|---|---|
| `src/adapters/ReputationAdapter.sol` | Schema `ReputationV1` : encode `(uint8 score, bytes32 evidenceHash)`, cle = `keccak256(wallet + "reputation")` |
| `src/adapters/PriceAdapter.sol` | Schema `PriceV1` : encode `(uint256 value, uint8 decimals)`, cle = `keccak256(symbol + "price")` |

---

## Flux de donnees detaille

### Requete cross-chain (Cache -> Oracle -> Cache)

```mermaid
sequenceDiagram
    participant User as DApp / Agent
    participant Cache as GenericCache<br/>(Arbitrum)
    participant Router as CCIP Router
    participant Oracle as GenericOracle<br/>(Sepolia)
    participant N8N as n8n / Lit Protocol
    participant Adapter as Adapter

    User->>Cache: requestData(key, schemaHash) + ETH
    activate Cache
    Note over Cache: Rate limit check<br/>1 req/key/hour
    Cache->>Router: ccipSend(oracleChain, message)
    Note over Cache: Track pendingRequests[msgId]
    Cache-->>User: messageId
    deactivate Cache

    Router-->>Oracle: ccipReceive(message)
    activate Oracle
    Note over Oracle: Verify whitelisted chain<br/>Replay protection<br/>Store QueryRequest
    Oracle--)N8N: emit QueryReceived(msgId, key, schema)
    deactivate Oracle

    N8N->>Adapter: updateReputation() ou updatePrice()
    Adapter->>Oracle: updateData(key, encodedValue, schema)
    Note over Oracle: Store in dataEntries + dataValues

    N8N->>Oracle: sendResponse(msgId, key)
    activate Oracle
    Note over Oracle: Build CCIP response<br/>Mark query processed<br/>Pay fee from balance
    Oracle->>Router: ccipSend(sourceChain, response)
    deactivate Oracle

    Router-->>Cache: ccipReceive(response)
    activate Cache
    Note over Cache: Verify source chain + sender<br/>Decode (key, value, ts, schema)<br/>Cache with TTL = now + 24h
    deactivate Cache

    User->>Cache: getData(key)
    Cache-->>User: (value, isFromCache=true, needsUpdate=false)
```

Le diagramme montre le cycle complet d'une requete. Trois points cles de securite : le rate-limiting cote Cache (evite le spam), la protection replay cote Oracle (empeche le rejeu), et la double validation de la reponse cote Cache (chain selector + adresse oracle).

### Lecture locale (Cache hit/miss)

```mermaid
flowchart TD
    A[getData key] --> B{cache.isValid?}
    B -->|Non| C[Cache Miss]
    C --> D[Return defaultValues + needsUpdate=true]
    B -->|Oui| E{block.timestamp <= expiryTime?}
    E -->|Oui| F[Cache Hit Fresh]
    F --> G["Return (value, isFromCache=true, needsUpdate=false)"]
    E -->|Non| H[Cache Hit Stale]
    H --> I["Return (value, isFromCache=true, needsUpdate=true)"]
```

Trois etats possibles : miss (pas de donnee, retourne le defaut), hit fresh (donnee valide dans le TTL), hit stale (donnee expiree mais encore retournee en attendant un refresh). Le flag `needsUpdate` signale au consommateur qu'un `requestData` serait pertinent.

---

## Pattern Adapter

```mermaid
flowchart LR
    subgraph "Domaine Metier"
        Rep["score: uint8<br/>evidence: bytes32"]
        Price["value: uint256<br/>decimals: uint8"]
    end

    subgraph "Adapters (stateless)"
        RA[ReputationAdapter<br/>schema: ReputationV1<br/>key: wallet+reputation]
        PA[PriceAdapter<br/>schema: PriceV1<br/>key: symbol+price]
    end

    subgraph "GenericOracle"
        Store["dataValues[key] = bytes<br/>dataEntries[key].schemaHash"]
    end

    Rep -->|"abi.encode(score, evidence)"| RA
    Price -->|"abi.encode(value, decimals)"| PA
    RA -->|"updateData(key, bytes, schema)"| Store
    PA -->|"updateData(key, bytes, schema)"| Store
    Store -->|"getData(key) -> bytes"| RA
    Store -->|"getData(key) -> bytes"| PA
    RA -->|"abi.decode -> (score, evidence)"| Rep
    PA -->|"abi.decode -> (value, decimals)"| Price
```

Les Adapters sont la couche de traduction. Ils n'ont aucun state — ils encodent les donnees metier en `bytes` generiques pour l'Oracle et les decodent en retour. Pour ajouter un nouveau type de donnee, il suffit de creer un nouvel Adapter implementant `IDataAdapter`, sans modifier l'Oracle ni le Cache. La separation cle/schema evite les collisions : `keccak256(wallet + "reputation")` ne peut jamais egal `keccak256("ETH" + "price")`.

---

## Modele de securite

```mermaid
flowchart TB
    subgraph "GenericOracle - Securite"
        direction TB
        A1[Access Control]
        A2[Chain Whitelisting]
        A3[Replay Protection]
        A4[Reentrancy Guard]
        A5[Strict Mode - optionnel]

        A1 -->|"UPDATER_ROLE"| U1["updateData()"]
        A1 -->|"UPDATER_ROLE"| U2["sendResponse()"]
        A1 -->|"DEFAULT_ADMIN"| U3["whitelistChain(), setStrictMode()..."]
        A2 -->|"whitelistedChains[selector]"| U4["_ccipReceive()"]
        A3 -->|"keccak256(msgId, chain, sender)"| U4
        A4 -->|"nonReentrant"| U2
        A5 -->|"registeredSchemas[hash]"| U1
    end

    subgraph "GenericCache - Securite"
        direction TB
        B1["Immutable Oracle Address"]
        B2["Rate Limiting - 1h/key"]
        B3["Source Validation"]
        B4["TTL Expiration - 24h"]

        B1 -->|"ORACLE_ADDRESS immutable"| V1["_ccipReceive()"]
        B2 -->|"lastRequestTime[key]"| V2["requestData()"]
        B3 -->|"sourceChain + sender check"| V1
        B4 -->|"block.timestamp vs expiryTime"| V3["getData()"]
    end
```

L'Oracle concentre la securite en ecriture : seuls les comptes UPDATER_ROLE (agents n8n) peuvent modifier les donnees ou envoyer des reponses. Le Cache concentre la securite en lecture/requete : adresse oracle immutable (pas de changement post-deploy), rate-limiting pour eviter l'abus, et validation stricte de la source des reponses CCIP.

---

## Stockage Oracle

```mermaid
erDiagram
    DataEntry {
        bytes32 key PK
        bytes32 schemaHash
        uint32 timestamp
        bool isValid
    }

    DataValues {
        bytes32 key PK
        bytes value
    }

    QueryRequest {
        bytes32 messageId PK
        address requester
        uint64 sourceChain
        uint32 requestedAt
        bool processed
    }

    CachedData {
        bytes32 key PK
        bytes value
        uint32 timestamp
        uint256 expiryTime
        bytes32 schemaHash
        bool isValid
    }

    DataEntry ||--|| DataValues : "same key"
    QueryRequest }o--|| DataEntry : "references"
    CachedData }o--|| DataEntry : "mirrors"
```

`dataEntries` et `dataValues` sont separes volontairement (optimisation gas : les metadonnees legeres dans un slot, les bytes lourds dans un autre). `QueryRequest` lie un message CCIP entrant a un requester et une source chain. `CachedData` (cote Cache) est le miroir local avec TTL.

---

## Deploiement multi-chain

```mermaid
graph LR
    subgraph "Sepolia - Oracle Chain"
        O[GenericOracle]
        RA[ReputationAdapter]
        PA[PriceAdapter]
    end

    subgraph Arbitrum
        C1[GenericCache<br/>oracle=O, chain=Sepolia]
    end

    subgraph Base
        C2[GenericCache<br/>oracle=O, chain=Sepolia]
    end

    subgraph Optimism
        C3[GenericCache<br/>oracle=O, chain=Sepolia]
    end

    C1 <-->|CCIP| O
    C2 <-->|CCIP| O
    C3 <-->|CCIP| O
```

Un seul Oracle sur Sepolia sert N caches sur differentes chains. Chaque Cache est configure avec l'adresse Oracle et le chain selector Sepolia en immutable. Les Adapters sont deployes uniquement cote Oracle (c'est la qu'on ecrit les donnees).
