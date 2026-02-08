// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDataAdapter} from "../interfaces/IDataAdapter.sol";
import {IGenericOracle} from "../interfaces/IGenericOracle.sol";

/// @title PriceAdapter
/// @notice Simple adapter for asset price feeds (demonstrates <50 lines simplicity)
/// @dev Stateless helper - does not store data, only encodes/decodes
/// @dev Schema: PriceV1 = (uint256 value, uint8 decimals)
contract PriceAdapter is IDataAdapter {
    // ========== Constants ==========

    bytes32 public constant SCHEMA_HASH = keccak256("PriceV1");

    // ========== IDataAdapter Implementation ==========

    function getSchemaHash() external pure override returns (bytes32) {
        return SCHEMA_HASH;
    }

    function getDefaultValue() external pure override returns (bytes memory) {
        return abi.encode(uint256(0), uint8(18)); // Default: 0 price, 18 decimals
    }

    // ========== Helper Functions ==========

    function getKey(string memory symbol) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(symbol, "price"));
    }

    function updatePrice(
        IGenericOracle oracle,
        string memory symbol,
        uint256 price,
        uint8 decimals
    ) external {
        bytes32 key = getKey(symbol);
        bytes memory value = abi.encode(price, decimals);
        oracle.updateData(key, value, SCHEMA_HASH);
    }

    function getPrice(IGenericOracle oracle, string memory symbol)
        external
        view
        returns (uint256 value, uint8 decimals, uint32 timestamp)
    {
        bytes32 key = getKey(symbol);
        (bytes memory data, uint32 ts, , bool isValid) = oracle.getData(key);

        if (!isValid || data.length == 0) {
            return (0, 18, 0); // Default
        }

        (value, decimals) = abi.decode(data, (uint256, uint8));
        timestamp = ts;
    }
}
