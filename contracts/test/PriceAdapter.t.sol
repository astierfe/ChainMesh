// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {PriceAdapter} from "../src/adapters/PriceAdapter.sol";
import {GenericOracle} from "../src/GenericOracle.sol";
import {IGenericOracle} from "../src/interfaces/IGenericOracle.sol";
import {MockCCIPRouter} from "./mocks/MockCCIPRouter.sol";

contract PriceAdapterTest is Test {
    PriceAdapter public adapter;
    GenericOracle public oracle;
    MockCCIPRouter public router;

    address public owner;
    address public updater;

    function setUp() public {
        owner = address(this);
        updater = makeAddr("updater");

        // Deploy contracts
        router = new MockCCIPRouter();
        oracle = new GenericOracle(address(router));
        adapter = new PriceAdapter();

        // Grant updater role
        oracle.grantRole(oracle.UPDATER_ROLE(), updater);
        oracle.grantRole(oracle.UPDATER_ROLE(), address(repAdapter));
        oracle.grantRole(oracle.UPDATER_ROLE(), address(priceAdapter));
    }

    // ========== IDataAdapter Tests ==========

    function test_GetSchemaHash() public view {
        bytes32 schemaHash = adapter.getSchemaHash();
        assertEq(schemaHash, keccak256("PriceV1"));
    }

    function test_GetDefaultValue() public view {
        bytes memory defaultValue = adapter.getDefaultValue();
        (uint256 value, uint8 decimals) = abi.decode(defaultValue, (uint256, uint8));

        assertEq(value, 0, "Default price should be 0");
        assertEq(decimals, 18, "Default decimals should be 18");
    }

    // ========== Helper Tests ==========

    function test_GetKey_UniqueForDifferentSymbols() public view {
        bytes32 ethKey = adapter.getKey("ETH");
        bytes32 btcKey = adapter.getKey("BTC");

        assertTrue(ethKey != btcKey, "Keys should be unique");
    }

    function test_GetKey_DeterministicForSameSymbol() public view {
        bytes32 key1 = adapter.getKey("ETH");
        bytes32 key2 = adapter.getKey("ETH");

        assertEq(key1, key2, "Keys should be deterministic");
    }

    function test_UpdatePrice_Success() public {
        vm.prank(updater);
        adapter.updatePrice(
            IGenericOracle(address(oracle)),
            "ETH",
            3000 ether,
            18
        );

        // Verify data stored in oracle
        bytes32 key = adapter.getKey("ETH");
        (bytes memory value, , bytes32 schema, bool isValid) = oracle.getData(key);

        assertTrue(isValid, "Data should be valid");
        assertEq(schema, adapter.getSchemaHash(), "Schema should match");

        (uint256 price, uint8 decimals) = abi.decode(value, (uint256, uint8));
        assertEq(price, 3000 ether, "Price should be 3000 ETH");
        assertEq(decimals, 18, "Decimals should be 18");
    }

    function test_GetPrice_ReturnsDefaultForNonExistent() public view {
        (uint256 value, uint8 decimals, uint32 timestamp) =
            adapter.getPrice(IGenericOracle(address(oracle)), "UNKNOWN");

        assertEq(value, 0, "Should return default price");
        assertEq(decimals, 18, "Should return default decimals");
        assertEq(timestamp, 0, "Timestamp should be 0");
    }

    function test_GetPrice_ReturnsStoredData() public {
        // Store price
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "BTC", 50000 ether, 18);

        // Retrieve price
        (uint256 value, uint8 decimals, uint32 timestamp) =
            adapter.getPrice(IGenericOracle(address(oracle)), "BTC");

        assertEq(value, 50000 ether, "Price should be 50000");
        assertEq(decimals, 18, "Decimals should be 18");
        assertGt(timestamp, 0, "Timestamp should be set");
    }

    // ========== Round-Trip Tests ==========

    function test_UpdateAndGet_RoundTrip() public {
        // Update
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "SOL", 100 ether, 18);

        // Get
        (uint256 value, uint8 decimals, ) = adapter.getPrice(IGenericOracle(address(oracle)), "SOL");

        assertEq(value, 100 ether, "Price should match");
        assertEq(decimals, 18, "Decimals should match");
    }

    function test_UpdateMultipleAssets() public {
        // Update ETH
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3000 ether, 18);

        // Update BTC
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "BTC", 50000 ether, 8);

        // Verify ETH
        (uint256 ethPrice, uint8 ethDecimals, ) = adapter.getPrice(IGenericOracle(address(oracle)), "ETH");
        assertEq(ethPrice, 3000 ether);
        assertEq(ethDecimals, 18);

        // Verify BTC
        (uint256 btcPrice, uint8 btcDecimals, ) = adapter.getPrice(IGenericOracle(address(oracle)), "BTC");
        assertEq(btcPrice, 50000 ether);
        assertEq(btcDecimals, 8);
    }

    // ========== Different Decimals Tests ==========

    function test_DifferentDecimals_6() public {
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "USDC", 1e6, 6);

        (uint256 value, uint8 decimals, ) = adapter.getPrice(IGenericOracle(address(oracle)), "USDC");
        assertEq(value, 1e6);
        assertEq(decimals, 6);
    }

    function test_DifferentDecimals_8() public {
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "BTC", 50000e8, 8);

        (uint256 value, uint8 decimals, ) = adapter.getPrice(IGenericOracle(address(oracle)), "BTC");
        assertEq(value, 50000e8);
        assertEq(decimals, 8);
    }

    function test_DifferentDecimals_18() public {
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3000e18, 18);

        (uint256 value, uint8 decimals, ) = adapter.getPrice(IGenericOracle(address(oracle)), "ETH");
        assertEq(value, 3000e18);
        assertEq(decimals, 18);
    }

    // ========== Edge Case Tests ==========

    function test_UpdatePrice_OverwritesExistingData() public {
        // First update
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 2000 ether, 18);

        // Overwrite
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3500 ether, 18);

        // Verify new data
        (uint256 value, , ) = adapter.getPrice(IGenericOracle(address(oracle)), "ETH");
        assertEq(value, 3500 ether);
    }

    function test_UpdatePrice_ZeroPrice() public {
        vm.prank(updater);
        adapter.updatePrice(IGenericOracle(address(oracle)), "ZERO", 0, 18);

        (uint256 value, , ) = adapter.getPrice(IGenericOracle(address(oracle)), "ZERO");
        assertEq(value, 0);
    }

    // ========== Access Control Tests ==========

    function test_UpdatePrice_RequiresUpdaterRole() public {
        address nonUpdater = makeAddr("nonUpdater");

        vm.prank(nonUpdater);
        vm.expectRevert();
        adapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3000 ether, 18);
    }
}
