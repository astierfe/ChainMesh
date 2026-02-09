// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {GenericOracle} from "../src/GenericOracle.sol";
import {IGenericOracle} from "../src/interfaces/IGenericOracle.sol";
import {GenericCache} from "../src/GenericCache.sol";
import {ReputationAdapter} from "../src/adapters/ReputationAdapter.sol";
import {PriceAdapter} from "../src/adapters/PriceAdapter.sol";
import {MockCCIPRouter} from "./mocks/MockCCIPRouter.sol";
import {Client} from "../src/interfaces/Client.sol";

/// @title Integration Tests
/// @notice Cross-adapter integration tests proving GenericOracle handles multiple data types
contract IntegrationTest is Test {
    GenericOracle public oracle;
    GenericCache public cache;
    MockCCIPRouter public router;

    ReputationAdapter public repAdapter;
    PriceAdapter public priceAdapter;

    address public owner;
    address public updater;
    address public alice;

    uint64 public constant SEPOLIA_CHAIN_SELECTOR = 16015286601757825753;
    uint64 public constant ARBITRUM_CHAIN_SELECTOR = 4949039107694359620;

    function setUp() public {
        owner = address(this);
        updater = makeAddr("updater");
        alice = makeAddr("alice");

        // Deploy infrastructure
        router = new MockCCIPRouter();
        oracle = new GenericOracle(address(router));
        cache = new GenericCache(
            address(router),
            address(oracle),
            SEPOLIA_CHAIN_SELECTOR
        );

        // Deploy adapters
        repAdapter = new ReputationAdapter();
        priceAdapter = new PriceAdapter();

        // Setup permissions
        oracle.grantRole(oracle.UPDATER_ROLE(), updater);
        oracle.grantRole(oracle.UPDATER_ROLE(), address(repAdapter));
        oracle.grantRole(oracle.UPDATER_ROLE(), address(priceAdapter));
        oracle.whitelistChain(ARBITRUM_CHAIN_SELECTOR);
    }

    // ========== Test 1: Coexistence ==========

    function test_Integration_Coexistence() public {
        // Store Reputation for Alice
        vm.prank(updater);
        repAdapter.updateReputation(IGenericOracle(address(oracle)), alice, 85, bytes32("alice-evidence"));

        // Store Price for ETH
        vm.prank(updater);
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3000 ether, 18);

        // Retrieve Reputation
        (uint8 score, , bytes32 evidence, bool repValid) =
            repAdapter.getReputation(IGenericOracle(address(oracle)), alice);
        assertEq(score, 85);
        assertEq(evidence, bytes32("alice-evidence"));
        assertTrue(repValid);

        // Retrieve Price
        (uint256 price, uint8 decimals, ) = priceAdapter.getPrice(IGenericOracle(address(oracle)), "ETH");
        assertEq(price, 3000 ether);
        assertEq(decimals, 18);

        // Verify no collision
        assertTrue(repAdapter.getKey(alice) != priceAdapter.getKey("ETH"), "Keys should not collide");
    }

    // ========== Test 2: Isolation ==========

    function test_Integration_Isolation() public {
        // Store both types
        vm.prank(updater);
        repAdapter.updateReputation(IGenericOracle(address(oracle)), alice, 90, bytes32("rep"));

        vm.prank(updater);
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "BTC", 50000 ether, 8);

        // Invalidate reputation
        bytes32 repKey = repAdapter.getKey(alice);
        oracle.invalidateData(repKey);

        // Check reputation is invalid
        (, , , bool repValid) = repAdapter.getReputation(IGenericOracle(address(oracle)), alice);
        assertFalse(repValid, "Reputation should be invalid");

        // Check price is still valid
        bytes32 priceKey = priceAdapter.getKey("BTC");
        (, , , bool priceValid) = oracle.getData(priceKey);
        assertTrue(priceValid, "Price should still be valid");
    }

    // ========== Test 3: Schema Distinction ==========

    function test_Integration_SchemasDistinct() public {
        // Store both types
        vm.prank(updater);
        repAdapter.updateReputation(IGenericOracle(address(oracle)), alice, 75, bytes32(0));

        vm.prank(updater);
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "SOL", 100 ether, 18);

        // Get raw data and verify schemas
        bytes32 repKey = repAdapter.getKey(alice);
        (, , bytes32 repSchema, ) = oracle.getData(repKey);

        bytes32 priceKey = priceAdapter.getKey("SOL");
        (, , bytes32 priceSchema, ) = oracle.getData(priceKey);

        // Verify schemas are different
        assertTrue(repSchema != priceSchema, "Schemas should be different");
        assertEq(repSchema, keccak256("ReputationV1"));
        assertEq(priceSchema, keccak256("PriceV1"));
    }

    // ========== Test 4: CCIP Cross-Adapter ==========

    function test_Integration_CCIP_CrossAdapter() public {
        bytes32 repMessageId = keccak256("rep-query");
        bytes32 priceMessageId = keccak256("price-query");

        bytes32 repKey = repAdapter.getKey(alice);
        bytes32 priceKey = priceAdapter.getKey("ETH");

        // Simulate Cache queries via CCIP
        router.deliverMessage(
            address(oracle),
            repMessageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(address(cache)),
            abi.encode(repKey, repAdapter.getSchemaHash(), address(cache))
        );

        router.deliverMessage(
            address(oracle),
            priceMessageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(address(cache)),
            abi.encode(priceKey, priceAdapter.getSchemaHash(), address(cache))
        );

        // Update data in Oracle
        vm.prank(updater);
        repAdapter.updateReputation(IGenericOracle(address(oracle)), alice, 88, bytes32("ccip-rep"));

        vm.prank(updater);
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3200 ether, 18);

        // Fund oracle to pay CCIP fees
        vm.deal(address(oracle), 1 ether);

        // Send responses
        vm.prank(updater);
        oracle.sendResponse(repMessageId, repKey);

        vm.prank(updater);
        oracle.sendResponse(priceMessageId, priceKey);

        // Verify responses were sent (check processed via replay protection hash)
        bytes32 repHash = keccak256(abi.encodePacked(repMessageId, ARBITRUM_CHAIN_SELECTOR, abi.encode(address(cache))));
        bytes32 priceHash = keccak256(abi.encodePacked(priceMessageId, ARBITRUM_CHAIN_SELECTOR, abi.encode(address(cache))));
        assertTrue(oracle.processedMessages(repHash));
        assertTrue(oracle.processedMessages(priceHash));

        // Simulate CCIP delivery of responses to cache
        _deliverResponseToCache(repKey, keccak256("resp-rep"));
        _deliverResponseToCache(priceKey, keccak256("resp-price"));

        // Verify cache received data
        (bytes memory repCached, , ) = cache.getData(repKey);
        (bytes memory priceCached, , ) = cache.getData(priceKey);

        // Decode and verify
        (uint8 score, bytes32 evidence) = abi.decode(repCached, (uint8, bytes32));
        assertEq(score, 88);
        assertEq(evidence, bytes32("ccip-rep"));

        (uint256 price, uint8 decimals) = abi.decode(priceCached, (uint256, uint8));
        assertEq(price, 3200 ether);
        assertEq(decimals, 18);
    }

    // ========== Test 5: Multiple Updates Same Type ==========

    function test_Integration_MultipleUpdates() public {
        // Update multiple wallets
        vm.startPrank(updater);
        repAdapter.updateReputation(IGenericOracle(address(oracle)), alice, 80, bytes32("alice"));
        repAdapter.updateReputation(IGenericOracle(address(oracle)), makeAddr("bob"), 70, bytes32("bob"));
        repAdapter.updateReputation(IGenericOracle(address(oracle)), makeAddr("charlie"), 90, bytes32("charlie"));

        // Update multiple assets
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3000 ether, 18);
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "BTC", 50000 ether, 8);
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "SOL", 100 ether, 18);
        vm.stopPrank();

        // Verify all stored correctly
        (uint8 aliceScore, , , ) = repAdapter.getReputation(IGenericOracle(address(oracle)), alice);
        assertEq(aliceScore, 80);

        (uint256 ethPrice, , ) = priceAdapter.getPrice(IGenericOracle(address(oracle)), "ETH");
        assertEq(ethPrice, 3000 ether);

        (uint256 btcPrice, , ) = priceAdapter.getPrice(IGenericOracle(address(oracle)), "BTC");
        assertEq(btcPrice, 50000 ether);
    }

    // ========== Test 6: Default Values Per Schema ==========

    function test_Integration_DefaultValuesPerSchema() public {
        // Set default values
        oracle.setDefaultValue(
            repAdapter.getSchemaHash(),
            abi.encode(uint8(60), bytes32(0))
        );

        oracle.setDefaultValue(
            priceAdapter.getSchemaHash(),
            abi.encode(uint256(0), uint8(18))
        );

        // Verify defaults are independent
        bytes memory repDefault = oracle.defaultValues(repAdapter.getSchemaHash());
        bytes memory priceDefault = oracle.defaultValues(priceAdapter.getSchemaHash());

        (uint8 defaultScore, ) = abi.decode(repDefault, (uint8, bytes32));
        assertEq(defaultScore, 60);

        (uint256 defaultPrice, uint8 defaultDecimals) = abi.decode(priceDefault, (uint256, uint8));
        assertEq(defaultPrice, 0);
        assertEq(defaultDecimals, 18);
    }

    // ========== Test 7: Adapter Independence ==========

    function test_Integration_AdapterIndependence() public {
        // This test proves adapters don't interfere with each other

        // Create 10 reputation entries
        vm.startPrank(updater);
        for (uint160 i = 1; i <= 10; i++) {
            address wallet = address(i);
            repAdapter.updateReputation(IGenericOracle(address(oracle)), wallet, uint8(50 + i), bytes32(uint256(i)));
        }

        // Create 10 price entries
        for (uint256 i = 1; i <= 10; i++) {
            string memory symbol = string(abi.encodePacked("TOKEN", vm.toString(i)));
            priceAdapter.updatePrice(IGenericOracle(address(oracle)), symbol, i * 1000 ether, 18);
        }
        vm.stopPrank();

        // Verify all 20 entries are distinct and correct
        for (uint160 i = 1; i <= 10; i++) {
            (uint8 score, , , ) = repAdapter.getReputation(IGenericOracle(address(oracle)), address(i));
            assertEq(score, uint8(50 + i), "Reputation score mismatch");
        }

        for (uint256 i = 1; i <= 10; i++) {
            string memory symbol = string(abi.encodePacked("TOKEN", vm.toString(i)));
            (uint256 price, , ) = priceAdapter.getPrice(IGenericOracle(address(oracle)), symbol);
            assertEq(price, i * 1000 ether, "Price mismatch");
        }
    }

    // ========== Test 8: Cache Integration Both Types ==========

    function test_Integration_Cache_BothTypes() public {
        bytes32 repKey = repAdapter.getKey(alice);
        bytes32 priceKey = priceAdapter.getKey("ETH");

        // Update Oracle
        vm.startPrank(updater);
        repAdapter.updateReputation(IGenericOracle(address(oracle)), alice, 95, bytes32("cache-test"));
        priceAdapter.updatePrice(IGenericOracle(address(oracle)), "ETH", 3500 ether, 18);
        vm.stopPrank();

        // Simulate CCIP query from Cache
        bytes32 msgId1 = keccak256("cache-rep");
        router.deliverMessage(
            address(oracle),
            msgId1,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(address(cache)),
            abi.encode(repKey, repAdapter.getSchemaHash(), address(cache))
        );

        // Fund oracle to pay CCIP fees
        vm.deal(address(oracle), 1 ether);

        // Send response
        vm.prank(updater);
        oracle.sendResponse(msgId1, repKey);

        _deliverResponseToCache(repKey, keccak256("resp-cache-rep"));

        // Verify Cache received reputation data
        (bytes memory cachedRep, bool isFromCache, ) = cache.getData(repKey);
        assertTrue(isFromCache, "Should be cached");

        (uint8 score, ) = abi.decode(cachedRep, (uint8, bytes32));
        assertEq(score, 95);

        // Now do same for price
        bytes32 msgId2 = keccak256("cache-price");
        router.deliverMessage(
            address(oracle),
            msgId2,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(address(cache)),
            abi.encode(priceKey, priceAdapter.getSchemaHash(), address(cache))
        );

        vm.prank(updater);
        oracle.sendResponse(msgId2, priceKey);

        _deliverResponseToCache(priceKey, keccak256("resp-cache-price"));

        (bytes memory cachedPrice, bool isPriceCached, ) = cache.getData(priceKey);
        assertTrue(isPriceCached, "Price should be cached");

        (uint256 price, ) = abi.decode(cachedPrice, (uint256, uint8));
        assertEq(price, 3500 ether);
    }

    // ========== Helpers ==========

    /// @dev Simulate CCIP delivery of an oracle response to the cache
    function _deliverResponseToCache(bytes32 key, bytes32 messageId) internal {
        (bytes memory value, uint32 timestamp, bytes32 schemaHash, ) = oracle.getData(key);
        router.deliverMessage(
            address(cache),
            messageId,
            SEPOLIA_CHAIN_SELECTOR,
            abi.encode(address(oracle)),
            abi.encode(key, value, timestamp, schemaHash)
        );
    }
}
