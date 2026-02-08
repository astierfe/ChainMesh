// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IRouterClient} from "./interfaces/IRouterClient.sol";
import {Client} from "./interfaces/Client.sol";
import {CCIPReceiver} from "./CCIPReceiver.sol";

/// @title GenericCache
/// @notice Generic TTL cache contract for cross-chain data queries via CCIP
/// @dev Infrastructure contract - schema-agnostic, reusable for any AI agent
/// @dev Deployed on consumer chains (Arbitrum, Base, Optimism, etc.)
contract GenericCache is CCIPReceiver, AccessControl {
    // ========== Custom Errors ==========
    error ZeroAddress();
    error InvalidKey();
    error InvalidSchemaHash();
    error RateLimitExceeded(uint256 timeUntilNext);
    error InsufficientFees(uint256 required, uint256 provided);
    error InvalidSourceChain(uint64 chainSelector);
    error UnauthorizedSender(address sender);
    error RefundFailed();

    // ========== Constants ==========
    uint256 public constant CACHE_TTL = 24 hours;
    uint256 public constant MIN_REQUEST_INTERVAL = 1 hours;

    // ========== Immutable Variables ==========
    address public immutable ORACLE_ADDRESS;
    uint64 public immutable ORACLE_CHAIN_SELECTOR;

    // ========== Structs ==========

    /// @notice Generic cached data with TTL
    struct CachedData {
        bytes32 key;            // Data identifier
        bytes value;            // Encoded data (schema-specific)
        uint32 timestamp;       // Source Oracle timestamp
        uint256 expiryTime;     // Local cache expiry
        bytes32 schemaHash;     // Schema identifier
        bool isValid;           // Entry validity flag
    }

    // ========== State Variables ==========

    /// @notice Cached data by key
    mapping(bytes32 => CachedData) public cache;

    /// @notice Default values per schema (configurable)
    mapping(bytes32 => bytes) public defaultValues;

    /// @notice Last request time per key (for rate limiting)
    mapping(bytes32 => uint256) public lastRequestTime;

    /// @notice Pending requests by messageId
    mapping(bytes32 => bytes32) public pendingRequests;

    // ========== Events ==========

    /// @notice Emitted when data is queried via CCIP
    event DataQueried(
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        address indexed requester,
        bytes32 messageId
    );

    /// @notice Emitted when data is cached
    event DataCached(
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        uint256 expiryTime
    );

    /// @notice Emitted on cache hit
    event CacheHit(
        bytes32 indexed key,
        bytes32 schemaHash,
        bool isFresh
    );

    /// @notice Emitted on cache miss
    event CacheMiss(
        bytes32 indexed key,
        bytes32 schemaHash
    );

    /// @notice Emitted when default value is set
    event DefaultValueSet(
        bytes32 indexed schemaHash,
        bytes value
    );

    // ========== Constructor ==========

    /// @notice Initialize the GenericCache contract
    /// @param router CCIP Router address on consumer chain
    /// @param oracleAddress Oracle contract address on oracle chain (e.g., Sepolia)
    /// @param oracleChainSelector Oracle chain selector
    constructor(
        address router,
        address oracleAddress,
        uint64 oracleChainSelector
    ) CCIPReceiver(router) {
        if (router == address(0)) revert ZeroAddress();
        if (oracleAddress == address(0)) revert ZeroAddress();

        ORACLE_ADDRESS = oracleAddress;
        ORACLE_CHAIN_SELECTOR = oracleChainSelector;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ========== External Functions ==========

    /// @notice Get generic data for a key (with cache)
    /// @param key The key to query
    /// @return value Encoded data (cached or default)
    /// @return isFromCache If the data is from cache
    /// @return needsUpdate If cache is stale or missing
    function getData(bytes32 key)
        external
        view
        returns (
            bytes memory value,
            bool isFromCache,
            bool needsUpdate
        )
    {
        CachedData memory cached = cache[key];

        // Cache miss
        if (!cached.isValid) {
            bytes memory defaultValue = defaultValues[cached.schemaHash];
            return (defaultValue, false, true);
        }

        // Cache hit (fresh)
        if (block.timestamp <= cached.expiryTime) {
            return (cached.value, true, false);
        }

        // Cache hit (stale)
        return (cached.value, true, true);
    }

    /// @notice Request data via CCIP
    /// @param key The key to query
    /// @param schemaHash Schema identifier
    /// @return messageId CCIP message ID
    function requestData(bytes32 key, bytes32 schemaHash)
        external
        payable
        returns (bytes32 messageId)
    {
        if (key == bytes32(0)) revert InvalidKey();
        if (schemaHash == bytes32(0)) revert InvalidSchemaHash();

        // Step 1: Rate limiting check (per key, not per msg.sender)
        uint256 lastRequest = lastRequestTime[key];
        if (lastRequest != 0) {
            uint256 timeSinceLastRequest = block.timestamp - lastRequest;
            if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
                revert RateLimitExceeded(MIN_REQUEST_INTERVAL - timeSinceLastRequest);
            }
        }

        lastRequestTime[key] = block.timestamp;

        // Step 2: Build CCIP Message
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(ORACLE_ADDRESS),
            data: abi.encode(key, schemaHash, address(this)),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: 200_000})
            ),
            feeToken: address(0) // Native token
        });

        // Step 3: Calculate fees
        uint256 fees = IRouterClient(getRouter()).getFee(
            ORACLE_CHAIN_SELECTOR,
            message
        );

        // Step 4: Validate payment
        if (msg.value < fees) {
            revert InsufficientFees(fees, msg.value);
        }

        // Step 5: Send CCIP message
        messageId = IRouterClient(getRouter()).ccipSend{value: fees}(
            ORACLE_CHAIN_SELECTOR,
            message
        );

        // Step 6: Track pending request
        pendingRequests[messageId] = key;

        // Step 7: Emit event
        emit DataQueried(key, schemaHash, msg.sender, messageId);

        // Step 8: Refund excess ETH
        if (msg.value > fees) {
            (bool success, ) = msg.sender.call{value: msg.value - fees}("");
            if (!success) revert RefundFailed();
        }
    }

    // ========== Admin Functions ==========

    /// @notice Set default value for a schema
    /// @param schemaHash Schema identifier
    /// @param value Default value (bytes encoded)
    function setDefaultValue(bytes32 schemaHash, bytes memory value)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (schemaHash == bytes32(0)) revert InvalidSchemaHash();
        defaultValues[schemaHash] = value;
        emit DefaultValueSet(schemaHash, value);
    }

    /// @notice Get default value for a schema
    /// @param schemaHash Schema identifier
    /// @return Default value (empty bytes if not set)
    function getDefaultValue(bytes32 schemaHash)
        external
        view
        returns (bytes memory)
    {
        return defaultValues[schemaHash];
    }

    /// @notice Invalidate cache for a key (admin only)
    /// @param key Key to invalidate
    function invalidateCache(bytes32 key) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (key == bytes32(0)) revert InvalidKey();
        cache[key].isValid = false;
    }

    /// @notice Override supportsInterface from AccessControl and CCIPReceiver
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControl, CCIPReceiver)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ========== Internal Functions ==========

    /// @notice Handle incoming CCIP messages (responses from Oracle)
    /// @dev Override from CCIPReceiver
    /// @param message Incoming CCIP message
    function _ccipReceive(Client.Any2EVMMessage memory message)
        internal
        override
    {
        // Step 1: Authentication - verify source chain
        if (message.sourceChainSelector != ORACLE_CHAIN_SELECTOR) {
            revert InvalidSourceChain(message.sourceChainSelector);
        }

        // Step 2: Authentication - verify sender
        address sender = abi.decode(message.sender, (address));
        if (sender != ORACLE_ADDRESS) {
            revert UnauthorizedSender(sender);
        }

        // Step 3: Decode response (generic format)
        (
            bytes32 key,
            bytes memory value,
            uint32 timestamp,
            bytes32 schemaHash
        ) = abi.decode(message.data, (bytes32, bytes, uint32, bytes32));

        // Step 4: Update cache
        uint256 expiryTime = block.timestamp + CACHE_TTL;

        cache[key] = CachedData({
            key: key,
            value: value,
            timestamp: timestamp,
            expiryTime: expiryTime,
            schemaHash: schemaHash,
            isValid: true
        });

        // Step 5: Emit event
        emit DataCached(key, schemaHash, expiryTime);
    }
}
