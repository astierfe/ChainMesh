// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IDataAdapter
/// @notice Standard interface for ChainMesh data adapters
/// @dev All adapters must implement this interface to ensure compatibility with GenericOracle/Cache
/// @dev Adapters are stateless helpers that encode/decode domain-specific data to/from bytes
interface IDataAdapter {
    /// @notice Get the schema identifier for this adapter
    /// @dev Schema hash should be deterministic: keccak256("SchemaNameV1")
    /// @return schemaHash Unique identifier for this data schema
    function getSchemaHash() external pure returns (bytes32 schemaHash);

    /// @notice Get the default value for this schema
    /// @dev Used as fallback when data doesn't exist in cache/oracle
    /// @return defaultValue Encoded default value (schema-specific format)
    function getDefaultValue() external pure returns (bytes memory defaultValue);
}
