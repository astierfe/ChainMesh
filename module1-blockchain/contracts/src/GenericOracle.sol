// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRouterClient} from "./interfaces/IRouterClient.sol";
import {Client} from "./interfaces/Client.sol";
import {CCIPReceiver} from "./CCIPReceiver.sol";

/// @title GenericOracle
/// @notice Generic key-value oracle for cross-chain data queries via CCIP
/// @dev Infrastructure contract - schema-agnostic, reusable for any AI agent
/// @dev Deployed on oracle chain (e.g., Sepolia), receives CCIP queries from consumer chains
contract GenericOracle is CCIPReceiver, AccessControl, ReentrancyGuard {
    // ========== Custom Errors ==========
    error ZeroAddress();
    error InvalidKey();
    error InvalidValue();
    error InvalidSchemaHash();
    error SchemaNotRegistered(bytes32 schemaHash);
    error QueryNotFound(bytes32 messageId);
    error QueryAlreadyProcessed(bytes32 messageId);
    error InsufficientBalance(uint256 required, uint256 available);
    error InvalidSourceChain(uint64 chainSelector);
    error UnauthorizedSender(address sender);
    error MessageAlreadyProcessed(bytes32 messageId);

    // ========== Roles ==========
    bytes32 public constant UPDATER_ROLE = keccak256("UPDATER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ========== Structs ==========

    /// @notice Generic data storage with schema versioning
    /// @dev Gas-optimized: value stored separately to avoid slot packing issues
    struct DataEntry {
        bytes32 key;           // Unique identifier (e.g., keccak256(wallet + "reputation"))
        bytes32 schemaHash;    // Schema version (e.g., keccak256("ReputationV1"))
        uint32 timestamp;      // Last update timestamp
        bool isValid;          // Entry validity flag
    }

    /// @notice Query request tracking (unchanged from ChainMeshOracle)
    struct QueryRequest {
        address requester;     // Who requested the query
        uint64 sourceChain;    // Source chain selector
        uint32 requestedAt;    // When requested
        bool processed;        // If already processed
    }

    // ========== State Variables ==========

    /// @notice Generic data storage by key
    mapping(bytes32 => DataEntry) public dataEntries;

    /// @notice Value storage separated for gas optimization
    mapping(bytes32 => bytes) public dataValues;

    /// @notice Default values per schema (configurable)
    mapping(bytes32 => bytes) public defaultValues;

    /// @notice Query requests by CCIP messageId
    mapping(bytes32 => QueryRequest) public queryRequests;

    /// @notice Processed messages for replay protection
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Whitelisted source chains (consumer chains)
    mapping(uint64 => bool) public whitelistedChains;

    /// @notice Registered schemas (for strict mode)
    mapping(bytes32 => bool) public registeredSchemas;

    /// @notice Strict mode flag (validates schema registration)
    bool public strictMode;

    // ========== Events ==========

    /// @notice Emitted when a query is received via CCIP
    event QueryReceived(
        bytes32 indexed messageId,
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        uint64 sourceChain,
        address requester
    );

    /// @notice Emitted when data is updated
    event DataUpdated(
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        uint256 timestamp
    );

    /// @notice Emitted when a response is sent via CCIP
    event ResponseSent(
        bytes32 indexed messageId,
        uint64 destinationChain,
        bytes32 key,
        bytes32 schemaHash
    );

    /// @notice Emitted when a schema is registered
    event SchemaRegistered(bytes32 indexed schemaHash);

    /// @notice Emitted when strict mode is toggled
    event StrictModeToggled(bool enabled);

    /// @notice Emitted when a data entry is invalidated
    event DataInvalidated(bytes32 indexed key);

    /// @notice Emitted when a default value is set
    event DefaultValueSet(bytes32 indexed schemaHash);

    // ========== Constructor ==========

    /// @notice Initialize the GenericOracle contract
    /// @param router CCIP Router address on oracle chain
    constructor(address router) CCIPReceiver(router) {
        if (router == address(0)) revert ZeroAddress();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
    }

    // ========== External Functions ==========

    /// @notice Update generic data for a key
    /// @dev Called by n8n via Lit Protocol after AI analysis
    /// @param key Unique identifier for the data (e.g., keccak256(wallet + "reputation"))
    /// @param value Encoded data (bytes, schema-specific format)
    /// @param schemaHash Schema version identifier (e.g., keccak256("ReputationV1"))
    function updateData(
        bytes32 key,
        bytes memory value,
        bytes32 schemaHash
    ) external onlyRole(UPDATER_ROLE) {
        if (key == bytes32(0)) revert InvalidKey();
        if (value.length == 0) revert InvalidValue();
        if (schemaHash == bytes32(0)) revert InvalidSchemaHash();

        // Strict mode validation
        if (strictMode && !registeredSchemas[schemaHash]) {
            revert SchemaNotRegistered(schemaHash);
        }

        dataEntries[key] = DataEntry({
            key: key,
            schemaHash: schemaHash,
            timestamp: uint32(block.timestamp),
            isValid: true
        });

        dataValues[key] = value;

        emit DataUpdated(key, schemaHash, block.timestamp);
    }

    /// @notice Get generic data for a key
    /// @param key The key to query
    /// @return value Encoded data (bytes)
    /// @return timestamp When the data was last updated
    /// @return schemaHash Schema version identifier
    /// @return isValid If the data entry is valid
    function getData(bytes32 key)
        external
        view
        returns (
            bytes memory value,
            uint32 timestamp,
            bytes32 schemaHash,
            bool isValid
        )
    {
        DataEntry memory entry = dataEntries[key];
        return (dataValues[key], entry.timestamp, entry.schemaHash, entry.isValid);
    }

    /// @notice Send response back to consumer chain via CCIP
    /// @dev Called by n8n after updateData
    /// @param messageId Original query messageId
    /// @param key Key to send data for
    /// @return responseMessageId CCIP message ID of the response
    function sendResponse(bytes32 messageId, bytes32 key)
        external
        onlyRole(UPDATER_ROLE)
        nonReentrant
        returns (bytes32 responseMessageId)
    {
        // Step 1: Lookup query
        QueryRequest storage query = queryRequests[messageId];
        if (query.requester == address(0)) revert QueryNotFound(messageId);

        // Step 2: Validation
        if (query.processed) revert QueryAlreadyProcessed(messageId);

        DataEntry memory entry = dataEntries[key];
        if (!entry.isValid) revert QueryNotFound(messageId);

        bytes memory value = dataValues[key];

        // Step 3: Build CCIP Message
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(query.requester),
            data: abi.encode(key, value, entry.timestamp, entry.schemaHash),
            tokenAmounts: new Client.EVMTokenAmount[](0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV1({gasLimit: 200_000})
            ),
            feeToken: address(0) // Native token
        });

        // Step 4: Calculate fees
        uint256 fees = IRouterClient(getRouter()).getFee(
            query.sourceChain,
            message
        );

        if (address(this).balance < fees) {
            revert InsufficientBalance(fees, address(this).balance);
        }

        // Step 5: Mark as processed BEFORE external call (CEI pattern)
        query.processed = true;

        // Step 6: Send CCIP message
        responseMessageId = IRouterClient(getRouter()).ccipSend{value: fees}(
            query.sourceChain,
            message
        );

        // Step 7: Emit event
        emit ResponseSent(responseMessageId, query.sourceChain, key, entry.schemaHash);
    }

    // ========== Admin Functions ==========

    /// @notice Whitelist a source chain
    /// @param chainSelector Chain selector to whitelist
    function whitelistChain(uint64 chainSelector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedChains[chainSelector] = true;
    }

    /// @notice Remove a chain from whitelist
    /// @param chainSelector Chain selector to remove
    function removeChainFromWhitelist(uint64 chainSelector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedChains[chainSelector] = false;
    }

    /// @notice Register a schema for strict mode validation
    /// @param schemaHash Schema identifier to register
    function registerSchema(bytes32 schemaHash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (schemaHash == bytes32(0)) revert InvalidSchemaHash();
        registeredSchemas[schemaHash] = true;
        emit SchemaRegistered(schemaHash);
    }

    /// @notice Enable or disable strict mode
    /// @param enabled True to enable, false to disable
    function setStrictMode(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        strictMode = enabled;
        emit StrictModeToggled(enabled);
    }

    /// @notice Invalidate a data entry
    /// @param key Key to invalidate
    function invalidateData(bytes32 key) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (key == bytes32(0)) revert InvalidKey();
        dataEntries[key].isValid = false;
        emit DataInvalidated(key);
    }

    /// @notice Set default value for a schema
    /// @param schemaHash Schema identifier
    /// @param defaultValue Default value (bytes encoded)
    function setDefaultValue(bytes32 schemaHash, bytes memory defaultValue)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (schemaHash == bytes32(0)) revert InvalidSchemaHash();
        defaultValues[schemaHash] = defaultValue;
        emit DefaultValueSet(schemaHash);
    }

    /// @notice Withdraw contract balance
    /// @param to Address to send funds to
    /// @param amount Amount to withdraw
    function withdraw(address payable to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) {
            revert InsufficientBalance(amount, address(this).balance);
        }

        (bool success, ) = to.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /// @notice Receive ETH for CCIP fees
    receive() external payable {}

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

    /// @notice Handle incoming CCIP messages
    /// @dev Override from CCIPReceiver
    /// @param message Incoming CCIP message
    function _ccipReceive(Client.Any2EVMMessage memory message)
        internal
        override
    {
        // Step 1: Authentication - verify source chain
        if (!whitelistedChains[message.sourceChainSelector]) {
            revert InvalidSourceChain(message.sourceChainSelector);
        }

        // Step 2: Replay Protection
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                message.messageId,
                message.sourceChainSelector,
                message.sender
            )
        );

        if (processedMessages[messageHash]) {
            revert MessageAlreadyProcessed(message.messageId);
        }

        processedMessages[messageHash] = true;

        // Step 3: Decode payload (generic format)
        (bytes32 key, bytes32 schemaHash, address requester) = abi.decode(
            message.data,
            (bytes32, bytes32, address)
        );

        if (key == bytes32(0)) revert InvalidKey();
        if (schemaHash == bytes32(0)) revert InvalidSchemaHash();

        // Step 4: Store query
        queryRequests[message.messageId] = QueryRequest({
            requester: requester,
            sourceChain: message.sourceChainSelector,
            requestedAt: uint32(block.timestamp),
            processed: false
        });

        // Step 5: Emit event for n8n to process
        emit QueryReceived(
            message.messageId,
            key,
            schemaHash,
            message.sourceChainSelector,
            requester
        );
    }
}
