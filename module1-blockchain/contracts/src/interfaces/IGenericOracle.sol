// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IGenericOracle
/// @notice Interface for GenericOracle contract functions used by adapters
interface IGenericOracle {
    /// @notice Update data for a key
    function updateData(bytes32 key, bytes memory value, bytes32 schemaHash) external;

    /// @notice Get data for a key
    function getData(bytes32 key)
        external
        view
        returns (
            bytes memory value,
            uint32 timestamp,
            bytes32 schemaHash,
            bool isValid
        );
}
