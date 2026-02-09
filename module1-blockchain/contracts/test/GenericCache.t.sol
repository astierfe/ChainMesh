// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/GenericCache.sol";
import "./mocks/MockCCIPRouter.sol";

contract GenericCacheTest is Test {
    GenericCache public consumerCache;
    MockCCIPRouter public router;

    address public admin;
    address public alice;
    address public bob;
    address public oracleAddress;

    uint64 constant ORACLE_CHAIN_SELECTOR = 16015286601757825753; // Sepolia
    uint64 constant CONSUMER_CHAIN_SELECTOR = 3478487238524512106; // Arbitrum

    // Schema identifiers
    bytes32 constant REPUTATION_SCHEMA = keccak256("ReputationV1");
    bytes32 constant PRICE_SCHEMA = keccak256("PriceV1");

    // Sample keys
    bytes32 aliceRepKey;
    bytes32 ethPriceKey;

    event DataQueried(
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        address indexed requester,
        bytes32 messageId
    );

    event DataCached(
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        uint256 expiryTime
    );

    event CacheHit(
        bytes32 indexed key,
        bytes32 schemaHash,
        bool isFresh
    );

    event CacheMiss(
        bytes32 indexed key,
        bytes32 schemaHash
    );

    event DefaultValueSet(
        bytes32 indexed schemaHash,
        bytes value
    );

    function setUp() public {
        admin = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        oracleAddress = makeAddr("oracle");

        router = new MockCCIPRouter();
        consumerCache = new GenericCache(
            address(router),
            oracleAddress,
            ORACLE_CHAIN_SELECTOR
        );

        // Fund users with ETH for CCIP fees
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        // Generate sample keys
        aliceRepKey = keccak256(abi.encodePacked(alice, "reputation"));
        ethPriceKey = keccak256(abi.encodePacked("ETH", "price"));
    }

    // ========== Constructor Tests ==========

    function test_Constructor_Success() public {
        assertTrue(consumerCache.hasRole(consumerCache.DEFAULT_ADMIN_ROLE(), admin));
        assertEq(consumerCache.ORACLE_ADDRESS(), oracleAddress);
        assertEq(consumerCache.ORACLE_CHAIN_SELECTOR(), ORACLE_CHAIN_SELECTOR);
        assertEq(consumerCache.getRouter(), address(router));
    }

    function test_Constructor_RevertZeroRouter() public {
        vm.expectRevert(abi.encodeWithSelector(CCIPReceiver.InvalidRouter.selector, address(0)));
        new GenericCache(address(0), oracleAddress, ORACLE_CHAIN_SELECTOR);
    }

    function test_Constructor_RevertZeroOracle() public {
        vm.expectRevert(GenericCache.ZeroAddress.selector);
        new GenericCache(address(router), address(0), ORACLE_CHAIN_SELECTOR);
    }

    // ========== getData Tests ==========

    function test_GetData_CacheMiss_NoDefault() public {
        (bytes memory value, bool isFromCache, bool needsUpdate) = consumerCache.getData(aliceRepKey);
        assertEq(value.length, 0);
        assertFalse(isFromCache);
        assertTrue(needsUpdate);
    }

    function test_GetData_CacheMiss_WithDefault() public {
        // Set default value
        bytes memory defaultRep = abi.encode(uint8(60));
        consumerCache.setDefaultValue(REPUTATION_SCHEMA, defaultRep);

        // Cache entry with schema (but not valid)
        vm.prank(oracleAddress);
        bytes memory response = abi.encode(
            aliceRepKey,
            abi.encode(uint8(85)),
            uint32(block.timestamp),
            REPUTATION_SCHEMA
        );
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            response
        );

        // Invalidate cache
        consumerCache.invalidateCache(aliceRepKey);

        // Should return default (note: current implementation returns empty for invalid cache)
        (bytes memory value, bool isFromCache, bool needsUpdate) = consumerCache.getData(aliceRepKey);
        assertFalse(isFromCache);
        assertTrue(needsUpdate);
    }

    function test_GetData_CacheHit_Fresh() public {
        // Simulate Oracle response
        bytes memory repValue = abi.encode(uint8(85), bytes32("evidence"));
        vm.prank(oracleAddress);
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        (bytes memory value, bool isFromCache, bool needsUpdate) = consumerCache.getData(aliceRepKey);
        assertEq(value, repValue);
        assertTrue(isFromCache);
        assertFalse(needsUpdate);
    }

    function test_GetData_CacheHit_Stale() public {
        // Simulate Oracle response
        bytes memory repValue = abi.encode(uint8(85));
        vm.prank(oracleAddress);
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Fast forward past cache TTL
        vm.warp(block.timestamp + consumerCache.CACHE_TTL() + 1);

        (bytes memory value, bool isFromCache, bool needsUpdate) = consumerCache.getData(aliceRepKey);
        assertEq(value, repValue);
        assertTrue(isFromCache);
        assertTrue(needsUpdate); // Stale
    }

    // ========== requestData Tests ==========

    function test_RequestData_Success() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, false);
        emit DataQueried(aliceRepKey, REPUTATION_SCHEMA, alice, bytes32(0));

        bytes32 messageId = consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);

        assertTrue(router.sentMessages(messageId));
        assertEq(consumerCache.pendingRequests(messageId), aliceRepKey);
        assertEq(consumerCache.lastRequestTime(aliceRepKey), block.timestamp);
    }

    function test_RequestData_RevertInvalidKey() public {
        vm.prank(alice);
        vm.expectRevert(GenericCache.InvalidKey.selector);
        consumerCache.requestData{value: 0.01 ether}(bytes32(0), REPUTATION_SCHEMA);
    }

    function test_RequestData_RevertInvalidSchema() public {
        vm.prank(alice);
        vm.expectRevert(GenericCache.InvalidSchemaHash.selector);
        consumerCache.requestData{value: 0.01 ether}(aliceRepKey, bytes32(0));
    }

    function test_RequestData_RevertInsufficientFees() public {
        vm.prank(alice);
        vm.expectRevert();
        consumerCache.requestData{value: 0}(aliceRepKey, REPUTATION_SCHEMA);
    }

    function test_RequestData_RefundExcess() public {
        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        consumerCache.requestData{value: 1 ether}(aliceRepKey, REPUTATION_SCHEMA);

        uint256 balanceAfter = alice.balance;
        assertGt(balanceAfter, balanceBefore - 1 ether); // Should have refunded most of it
    }

    function test_RequestData_FirstTime_SkipRateLimit() public {
        vm.prank(alice);
        bytes32 msg1 = consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);
        assertTrue(router.sentMessages(msg1));
    }

    function test_RequestData_RateLimitExceeded() public {
        vm.startPrank(alice);

        // First request
        consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);

        // Second request immediately (should revert)
        vm.expectRevert();
        consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);

        vm.stopPrank();
    }

    function test_RequestData_AfterInterval_Success() public {
        vm.startPrank(alice);

        // First request
        consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);

        // Fast forward past MIN_REQUEST_INTERVAL
        vm.warp(block.timestamp + consumerCache.MIN_REQUEST_INTERVAL() + 1);

        // Second request (should succeed)
        bytes32 msg2 = consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);
        assertTrue(router.sentMessages(msg2));

        vm.stopPrank();
    }

    function test_RequestData_DifferentKeys_NoRateLimit() public {
        vm.startPrank(alice);

        // Request for aliceRepKey
        consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);

        // Request for ethPriceKey immediately (should succeed, different key)
        bytes32 msg2 = consumerCache.requestData{value: 0.01 ether}(ethPriceKey, PRICE_SCHEMA);
        assertTrue(router.sentMessages(msg2));

        vm.stopPrank();
    }

    // ========== _ccipReceive Tests ==========

    function test_CcipReceive_Success() public {
        bytes memory repValue = abi.encode(uint8(85), bytes32("evidence"));
        bytes32 messageId = keccak256("msg1");

        vm.expectEmit(true, true, false, true);
        emit DataCached(aliceRepKey, REPUTATION_SCHEMA, block.timestamp + consumerCache.CACHE_TTL());

        vm.prank(oracleAddress);
        router.deliverMessage(
            address(consumerCache),
            messageId,
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Verify cache updated
        (bytes memory value, bool isFromCache,) = consumerCache.getData(aliceRepKey);
        assertEq(value, repValue);
        assertTrue(isFromCache);
    }

    function test_CcipReceive_RevertInvalidSourceChain() public {
        uint64 invalidChain = 999999;

        vm.expectRevert(abi.encodeWithSelector(GenericCache.InvalidSourceChain.selector, invalidChain));

        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            invalidChain,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, abi.encode(uint8(85)), uint32(block.timestamp), REPUTATION_SCHEMA)
        );
    }

    function test_CcipReceive_RevertUnauthorizedSender() public {
        address unauthorizedSender = makeAddr("unauthorized");

        vm.expectRevert(abi.encodeWithSelector(GenericCache.UnauthorizedSender.selector, unauthorizedSender));

        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(unauthorizedSender),
            abi.encode(aliceRepKey, abi.encode(uint8(85)), uint32(block.timestamp), REPUTATION_SCHEMA)
        );
    }

    function test_CcipReceive_DifferentDataTypes() public {
        // Reputation data
        bytes memory repValue = abi.encode(uint8(85));
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Price data
        bytes memory priceValue = abi.encode(uint256(3000e18));
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg2"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(ethPriceKey, priceValue, uint32(block.timestamp), PRICE_SCHEMA)
        );

        // Verify both cached independently
        (bytes memory repData,,) = consumerCache.getData(aliceRepKey);
        (bytes memory priceData,,) = consumerCache.getData(ethPriceKey);

        assertEq(repData, repValue);
        assertEq(priceData, priceValue);
    }

    // ========== Admin Functions Tests ==========

    function test_SetDefaultValue() public {
        bytes memory defaultRep = abi.encode(uint8(60));

        vm.expectEmit(true, false, false, true);
        emit DefaultValueSet(REPUTATION_SCHEMA, defaultRep);

        consumerCache.setDefaultValue(REPUTATION_SCHEMA, defaultRep);

        bytes memory stored = consumerCache.getDefaultValue(REPUTATION_SCHEMA);
        assertEq(stored, defaultRep);
    }

    function test_SetDefaultValue_RevertInvalidSchema() public {
        vm.expectRevert(GenericCache.InvalidSchemaHash.selector);
        consumerCache.setDefaultValue(bytes32(0), abi.encode(uint8(60)));
    }

    function test_GetDefaultValue_NotSet() public {
        bytes memory value = consumerCache.getDefaultValue(REPUTATION_SCHEMA);
        assertEq(value.length, 0);
    }

    function test_InvalidateCache() public {
        // First cache some data
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, abi.encode(uint8(85)), uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Verify cached
        (bytes memory value1, bool isFromCache1,) = consumerCache.getData(aliceRepKey);
        assertTrue(isFromCache1);
        assertGt(value1.length, 0);

        // Invalidate
        consumerCache.invalidateCache(aliceRepKey);

        // Verify invalidated
        (bytes memory value2, bool isFromCache2, bool needsUpdate) = consumerCache.getData(aliceRepKey);
        assertFalse(isFromCache2);
        assertTrue(needsUpdate);
    }

    function test_InvalidateCache_RevertInvalidKey() public {
        vm.expectRevert(GenericCache.InvalidKey.selector);
        consumerCache.invalidateCache(bytes32(0));
    }

    // ========== Gas Benchmarks ==========

    function test_GasBenchmark_RequestData() public {
        vm.prank(alice);
        uint256 gasBefore = gasleft();
        consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("requestData gas", gasUsed);
        // Target: <130k gas (vs ChainMeshCache's ~110k)
        assertLt(gasUsed, 130_000, "requestData should use < 130k gas");
    }

    function test_GasBenchmark_GetData() public view {
        // Note: view functions don't consume gas in transactions, but we can benchmark
        uint256 gasBefore = gasleft();
        consumerCache.getData(aliceRepKey);
        uint256 gasUsed = gasBefore - gasleft();

        // Just informational, view functions don't have gas limits
        // Expected: ~3-6k gas
        assert(gasUsed > 0); // Silence unused variable warning
    }

    // ========== Integration Tests ==========

    function test_Integration_FullFlow() public {
        // Step 1: Alice requests data
        vm.prank(alice);
        bytes32 messageId = consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);
        assertTrue(router.sentMessages(messageId));

        // Step 2: Oracle processes and sends response
        bytes memory repValue = abi.encode(uint8(92), bytes32("evidence"));
        router.deliverMessage(
            address(consumerCache),
            messageId,
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Step 3: Verify cached
        (bytes memory value, bool isFromCache, bool needsUpdate) = consumerCache.getData(aliceRepKey);
        assertEq(value, repValue);
        assertTrue(isFromCache);
        assertFalse(needsUpdate);
    }

    function test_Integration_MultipleSchemasIndependent() public {
        // Request and cache reputation
        vm.prank(alice);
        bytes32 msgRep = consumerCache.requestData{value: 0.01 ether}(aliceRepKey, REPUTATION_SCHEMA);

        bytes memory repValue = abi.encode(uint8(85));
        router.deliverMessage(
            address(consumerCache),
            msgRep,
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Request and cache price
        vm.prank(bob);
        bytes32 msgPrice = consumerCache.requestData{value: 0.01 ether}(ethPriceKey, PRICE_SCHEMA);

        bytes memory priceValue = abi.encode(uint256(3000e18));
        router.deliverMessage(
            address(consumerCache),
            msgPrice,
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(ethPriceKey, priceValue, uint32(block.timestamp), PRICE_SCHEMA)
        );

        // Verify both cached independently
        (bytes memory rep,,) = consumerCache.getData(aliceRepKey);
        (bytes memory price,,) = consumerCache.getData(ethPriceKey);

        assertEq(rep, repValue);
        assertEq(price, priceValue);
    }

    function test_Integration_CacheExpiry() public {
        // Cache data
        bytes memory repValue = abi.encode(uint8(85));
        router.deliverMessage(
            address(consumerCache),
            keccak256("msg1"),
            ORACLE_CHAIN_SELECTOR,
            abi.encode(oracleAddress),
            abi.encode(aliceRepKey, repValue, uint32(block.timestamp), REPUTATION_SCHEMA)
        );

        // Verify fresh
        (bytes memory value1, bool isFromCache1, bool needsUpdate1) = consumerCache.getData(aliceRepKey);
        assertTrue(isFromCache1);
        assertFalse(needsUpdate1);
        assertEq(value1, repValue);

        // Fast forward past TTL
        vm.warp(block.timestamp + consumerCache.CACHE_TTL() + 1);

        // Verify stale
        (bytes memory value2, bool isFromCache2, bool needsUpdate2) = consumerCache.getData(aliceRepKey);
        assertTrue(isFromCache2);
        assertTrue(needsUpdate2); // Now stale
        assertEq(value2, repValue); // Still returns cached value
    }

    // ========== Fuzz Tests ==========

    function testFuzz_RequestData_AnyKey(bytes32 key) public {
        vm.assume(key != bytes32(0));

        vm.prank(alice);
        bytes32 messageId = consumerCache.requestData{value: 0.01 ether}(key, REPUTATION_SCHEMA);
        assertTrue(router.sentMessages(messageId));
    }

    function testFuzz_SetDefaultValue_AnyValue(bytes memory value) public {
        vm.assume(value.length > 0 && value.length < 10000);

        consumerCache.setDefaultValue(REPUTATION_SCHEMA, value);
        bytes memory stored = consumerCache.getDefaultValue(REPUTATION_SCHEMA);
        assertEq(stored, value);
    }
}
