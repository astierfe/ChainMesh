// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDataAdapter} from "../interfaces/IDataAdapter.sol";
import {IGenericOracle} from "../interfaces/IGenericOracle.sol";

/// @title ReputationAdapter
/// @notice Adapter for wallet reputation data (backward compatible with ChainMeshOracle)
/// @dev Stateless helper contract - does not store data, only encodes/decodes
/// @dev Schema: ReputationV1 = (uint8 score, bytes32 evidenceHash)
contract ReputationAdapter is IDataAdapter {
    // ========== Constants ==========

    /// @notice Schema identifier for ReputationV1
    bytes32 public constant SCHEMA_HASH = keccak256("ReputationV1");

    /// @notice Default reputation score (used as fallback)
    uint8 public constant DEFAULT_SCORE = 60;

    // ========== Custom Errors ==========

    error InvalidScore();
    error ZeroAddress();

    // ========== IDataAdapter Implementation ==========

    /// @notice Get schema hash for reputation data
    /// @return schemaHash keccak256("ReputationV1")
    function getSchemaHash() external pure override returns (bytes32) {
        return SCHEMA_HASH;
    }

    /// @notice Get default reputation value (score 60, empty evidence)
    /// @return defaultValue Encoded default: (uint8(60), bytes32(0))
    function getDefaultValue() external pure override returns (bytes memory) {
        return abi.encode(uint8(DEFAULT_SCORE), bytes32(0));
    }

    // ========== Helper Functions ==========

    /// @notice Generate key for a wallet's reputation
    /// @param wallet Address to generate key for
    /// @return key Unique identifier for this wallet's reputation
    function getKey(address wallet) public pure returns (bytes32) {
        if (wallet == address(0)) revert ZeroAddress();
        return keccak256(abi.encodePacked(wallet, "reputation"));
    }

    /// @notice Update reputation for a wallet (backward compatible API)
    /// @dev Calls GenericOracle.updateData - requires UPDATER_ROLE on caller
    /// @param oracle GenericOracle contract address
    /// @param wallet Wallet address to update
    /// @param score Reputation score (0-100)
    /// @param evidenceHash IPFS hash of evidence (optional)
    function updateReputation(
        IGenericOracle oracle,
        address wallet,
        uint8 score,
        bytes32 evidenceHash
    ) external {
        if (address(oracle) == address(0)) revert ZeroAddress();
        if (wallet == address(0)) revert ZeroAddress();
        if (score > 100) revert InvalidScore();

        bytes32 key = getKey(wallet);
        bytes memory value = abi.encode(score, evidenceHash);

        oracle.updateData(key, value, SCHEMA_HASH);
    }

    /// @notice Get reputation for a wallet (backward compatible API)
    /// @param oracle GenericOracle contract address
    /// @param wallet Wallet address to query
    /// @return score Reputation score (0-100)
    /// @return timestamp Last update timestamp
    /// @return evidenceHash IPFS hash of evidence
    /// @return isValid Whether the data is valid
    function getReputation(IGenericOracle oracle, address wallet)
        external
        view
        returns (
            uint8 score,
            uint32 timestamp,
            bytes32 evidenceHash,
            bool isValid
        )
    {
        if (address(oracle) == address(0)) revert ZeroAddress();
        if (wallet == address(0)) revert ZeroAddress();

        bytes32 key = getKey(wallet);

        (
            bytes memory value,
            uint32 ts,
            bytes32 schema,
            bool valid
        ) = oracle.getData(key);

        // If no data exists, return default
        if (!valid || value.length == 0) {
            return (DEFAULT_SCORE, 0, bytes32(0), false);
        }

        // Verify schema matches
        require(schema == SCHEMA_HASH, "Schema mismatch");

        // Decode reputation data
        (score, evidenceHash) = abi.decode(value, (uint8, bytes32));
        timestamp = ts;
        isValid = valid;
    }

    /// @notice Encode reputation data
    /// @param score Reputation score (0-100)
    /// @param evidenceHash IPFS hash of evidence
    /// @return Encoded bytes
    function encode(uint8 score, bytes32 evidenceHash)
        external
        pure
        returns (bytes memory)
    {
        if (score > 100) revert InvalidScore();
        return abi.encode(score, evidenceHash);
    }

    /// @notice Decode reputation data
    /// @param data Encoded reputation bytes
    /// @return score Reputation score
    /// @return evidenceHash IPFS hash of evidence
    function decode(bytes memory data)
        external
        pure
        returns (uint8 score, bytes32 evidenceHash)
    {
        return abi.decode(data, (uint8, bytes32));
    }
}
