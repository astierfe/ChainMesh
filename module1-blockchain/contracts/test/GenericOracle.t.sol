// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/GenericOracle.sol";
import "./mocks/MockCCIPRouter.sol";

// Helper contract to receive ETH
contract Receiver {
    receive() external payable {}
}

contract GenericOracleTest is Test {
    GenericOracle public oracle;
    MockCCIPRouter public router;

    address public admin;
    address public updater;
    address public alice;
    address public bob;

    uint64 constant ARBITRUM_CHAIN_SELECTOR = 3478487238524512106;
    uint64 constant BASE_CHAIN_SELECTOR = 10344971235874465080;

    // Schema identifiers
    bytes32 constant REPUTATION_SCHEMA = keccak256("ReputationV1");
    bytes32 constant PRICE_SCHEMA = keccak256("PriceV1");
    bytes32 constant NFT_SCHEMA = keccak256("NFTV1");

    // Sample keys
    bytes32 aliceRepKey;
    bytes32 bobRepKey;
    bytes32 ethPriceKey;

    event QueryReceived(
        bytes32 indexed messageId,
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        uint64 sourceChain,
        address requester
    );

    event DataUpdated(
        bytes32 indexed key,
        bytes32 indexed schemaHash,
        uint256 timestamp
    );

    event ResponseSent(
        bytes32 indexed messageId,
        uint64 destinationChain,
        bytes32 key,
        bytes32 schemaHash
    );

    event SchemaRegistered(bytes32 indexed schemaHash);
    event StrictModeToggled(bool enabled);
    event DataInvalidated(bytes32 indexed key);
    event DefaultValueSet(bytes32 indexed schemaHash);

    function setUp() public {
        admin = address(this);
        updater = makeAddr("updater");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        router = new MockCCIPRouter();
        oracle = new GenericOracle(address(router));

        // Grant UPDATER_ROLE to updater
        oracle.grantRole(oracle.UPDATER_ROLE(), updater);

        // Whitelist chains
        oracle.whitelistChain(ARBITRUM_CHAIN_SELECTOR);
        oracle.whitelistChain(BASE_CHAIN_SELECTOR);

        // Fund oracle with ETH
        vm.deal(address(oracle), 10 ether);

        // Generate sample keys
        aliceRepKey = keccak256(abi.encodePacked(alice, "reputation"));
        bobRepKey = keccak256(abi.encodePacked(bob, "reputation"));
        ethPriceKey = keccak256(abi.encodePacked("ETH", "price"));
    }

    // ========== Constructor Tests ==========

    function test_Constructor_Success() public {
        assertTrue(oracle.hasRole(oracle.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(oracle.hasRole(oracle.PAUSER_ROLE(), admin));
        assertEq(oracle.getRouter(), address(router));
        assertFalse(oracle.strictMode());
    }

    function test_Constructor_RevertsZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(CCIPReceiver.InvalidRouter.selector, address(0)));
        new GenericOracle(address(0));
    }

    // ========== updateData Tests ==========

    function test_UpdateData_Success() public {
        vm.prank(updater);
        bytes memory value = abi.encode(uint8(85), bytes32("evidence"));

        vm.expectEmit(true, true, false, true);
        emit DataUpdated(aliceRepKey, REPUTATION_SCHEMA, block.timestamp);

        oracle.updateData(aliceRepKey, value, REPUTATION_SCHEMA);

        (bytes memory storedValue, uint32 timestamp, bytes32 schema, bool isValid) = oracle.getData(aliceRepKey);
        assertEq(storedValue, value);
        assertEq(timestamp, uint32(block.timestamp));
        assertEq(schema, REPUTATION_SCHEMA);
        assertTrue(isValid);
    }

    function test_UpdateData_DifferentSchemas() public {
        vm.startPrank(updater);

        // Reputation data
        bytes memory repValue = abi.encode(uint8(85), bytes32("evidence"));
        oracle.updateData(aliceRepKey, repValue, REPUTATION_SCHEMA);

        // Price data
        bytes memory priceValue = abi.encode(uint256(3000e18));
        oracle.updateData(ethPriceKey, priceValue, PRICE_SCHEMA);

        vm.stopPrank();

        (bytes memory repData,, bytes32 repSchema,) = oracle.getData(aliceRepKey);
        (bytes memory priceData,, bytes32 priceSchema,) = oracle.getData(ethPriceKey);

        assertEq(repData, repValue);
        assertEq(repSchema, REPUTATION_SCHEMA);
        assertEq(priceData, priceValue);
        assertEq(priceSchema, PRICE_SCHEMA);
    }

    function test_UpdateData_RevertInvalidKey() public {
        vm.prank(updater);
        vm.expectRevert(GenericOracle.InvalidKey.selector);
        oracle.updateData(bytes32(0), abi.encode(uint8(50)), REPUTATION_SCHEMA);
    }

    function test_UpdateData_RevertInvalidValue() public {
        vm.prank(updater);
        vm.expectRevert(GenericOracle.InvalidValue.selector);
        oracle.updateData(aliceRepKey, "", REPUTATION_SCHEMA);
    }

    function test_UpdateData_RevertInvalidSchemaHash() public {
        vm.prank(updater);
        vm.expectRevert(GenericOracle.InvalidSchemaHash.selector);
        oracle.updateData(aliceRepKey, abi.encode(uint8(50)), bytes32(0));
    }

    function test_UpdateData_RevertUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert();
        oracle.updateData(aliceRepKey, abi.encode(uint8(50)), REPUTATION_SCHEMA);
    }

    function test_UpdateData_Overwrite() public {
        vm.startPrank(updater);

        bytes memory value1 = abi.encode(uint8(50), bytes32("evidence1"));
        oracle.updateData(aliceRepKey, value1, REPUTATION_SCHEMA);

        bytes memory value2 = abi.encode(uint8(90), bytes32("evidence2"));
        oracle.updateData(aliceRepKey, value2, REPUTATION_SCHEMA);

        vm.stopPrank();

        (bytes memory storedValue,,,) = oracle.getData(aliceRepKey);
        assertEq(storedValue, value2);
    }

    function test_UpdateData_MultipleKeys() public {
        vm.startPrank(updater);

        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);
        oracle.updateData(bobRepKey, abi.encode(uint8(92)), REPUTATION_SCHEMA);

        vm.stopPrank();

        (bytes memory aliceData,,,) = oracle.getData(aliceRepKey);
        (bytes memory bobData,,,) = oracle.getData(bobRepKey);

        (uint8 aliceScore) = abi.decode(aliceData, (uint8));
        (uint8 bobScore) = abi.decode(bobData, (uint8));

        assertEq(aliceScore, 85);
        assertEq(bobScore, 92);
    }

    // ========== getData Tests ==========

    function test_GetData_NonExistent() public {
        (bytes memory value, uint32 timestamp, bytes32 schema, bool isValid) = oracle.getData(aliceRepKey);
        assertEq(value.length, 0);
        assertEq(timestamp, 0);
        assertEq(schema, bytes32(0));
        assertFalse(isValid);
    }

    function test_GetData_ValidEntry() public {
        vm.prank(updater);
        bytes memory value = abi.encode(uint8(75), bytes32("test"));
        oracle.updateData(aliceRepKey, value, REPUTATION_SCHEMA);

        (bytes memory storedValue, uint32 timestamp, bytes32 schema, bool isValid) = oracle.getData(aliceRepKey);
        assertEq(storedValue, value);
        assertEq(timestamp, uint32(block.timestamp));
        assertEq(schema, REPUTATION_SCHEMA);
        assertTrue(isValid);
    }

    function test_GetData_AfterInvalidation() public {
        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(75)), REPUTATION_SCHEMA);

        vm.prank(admin);
        oracle.invalidateData(aliceRepKey);

        (,, , bool isValid) = oracle.getData(aliceRepKey);
        assertFalse(isValid);
    }

    // ========== _ccipReceive Tests ==========

    function test_CcipReceive_Success() public {
        bytes32 messageId = keccak256("msg1");
        bytes memory data = abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob);

        vm.expectEmit(true, true, true, true);
        emit QueryReceived(messageId, aliceRepKey, REPUTATION_SCHEMA, ARBITRUM_CHAIN_SELECTOR, bob);

        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(alice),
            data
        );

        (address requester, uint64 sourceChain, uint32 requestedAt, bool processed) =
            oracle.queryRequests(messageId);

        assertEq(requester, bob);
        assertEq(sourceChain, ARBITRUM_CHAIN_SELECTOR);
        assertEq(requestedAt, uint32(block.timestamp));
        assertFalse(processed);
    }

    function test_CcipReceive_DifferentSchemas() public {
        bytes32 msg1 = keccak256("msg1");
        bytes32 msg2 = keccak256("msg2");

        router.deliverMessage(
            address(oracle),
            msg1,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(alice),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        router.deliverMessage(
            address(oracle),
            msg2,
            BASE_CHAIN_SELECTOR,
            abi.encode(alice),
            abi.encode(ethPriceKey, PRICE_SCHEMA, bob)
        );

        (address req1,,,) = oracle.queryRequests(msg1);
        (address req2,,,) = oracle.queryRequests(msg2);

        assertEq(req1, bob);
        assertEq(req2, bob);
    }

    function test_CcipReceive_RevertInvalidSourceChain() public {
        bytes32 messageId = keccak256("msg1");
        uint64 invalidChain = 999999;

        vm.expectRevert(abi.encodeWithSelector(GenericOracle.InvalidSourceChain.selector, invalidChain));

        router.deliverMessage(
            address(oracle),
            messageId,
            invalidChain,
            abi.encode(alice),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );
    }

    function test_CcipReceive_RevertReplayAttack() public {
        bytes32 messageId = keccak256("msg1");
        bytes memory data = abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob);

        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(alice),
            data
        );

        vm.expectRevert(abi.encodeWithSelector(GenericOracle.MessageAlreadyProcessed.selector, messageId));

        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(alice),
            data
        );
    }

    function test_CcipReceive_RevertInvalidKey() public {
        bytes32 messageId = keccak256("msg1");

        vm.expectRevert(GenericOracle.InvalidKey.selector);

        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(alice),
            abi.encode(bytes32(0), REPUTATION_SCHEMA, bob)
        );
    }

    function test_CcipReceive_RevertInvalidSchemaHash() public {
        bytes32 messageId = keccak256("msg1");

        vm.expectRevert(GenericOracle.InvalidSchemaHash.selector);

        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(alice),
            abi.encode(aliceRepKey, bytes32(0), bob)
        );
    }

    // ========== sendResponse Tests ==========

    function test_SendResponse_Success() public {
        // Setup: Receive query first
        bytes32 messageId = keccak256("msg1");
        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        // Update data
        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);

        // Send response
        vm.prank(updater);
        vm.expectEmit(false, true, false, true);
        emit ResponseSent(bytes32(0), ARBITRUM_CHAIN_SELECTOR, aliceRepKey, REPUTATION_SCHEMA);

        bytes32 responseId = oracle.sendResponse(messageId, aliceRepKey);
        assertTrue(router.sentMessages(responseId));

        // Verify query marked as processed
        (,,, bool processed) = oracle.queryRequests(messageId);
        assertTrue(processed);
    }

    function test_SendResponse_DifferentDataTypes() public {
        // Reputation query
        bytes32 msgRep = keccak256("msgRep");
        router.deliverMessage(
            address(oracle),
            msgRep,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        // Price query
        bytes32 msgPrice = keccak256("msgPrice");
        router.deliverMessage(
            address(oracle),
            msgPrice,
            BASE_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(ethPriceKey, PRICE_SCHEMA, bob)
        );

        vm.startPrank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);
        oracle.updateData(ethPriceKey, abi.encode(uint256(3000e18)), PRICE_SCHEMA);

        bytes32 respRep = oracle.sendResponse(msgRep, aliceRepKey);
        bytes32 respPrice = oracle.sendResponse(msgPrice, ethPriceKey);
        vm.stopPrank();

        assertTrue(router.sentMessages(respRep));
        assertTrue(router.sentMessages(respPrice));
    }

    function test_SendResponse_RevertQueryNotFound() public {
        bytes32 invalidMessageId = keccak256("invalid");

        vm.prank(updater);
        vm.expectRevert(abi.encodeWithSelector(GenericOracle.QueryNotFound.selector, invalidMessageId));
        oracle.sendResponse(invalidMessageId, aliceRepKey);
    }

    function test_SendResponse_RevertAlreadyProcessed() public {
        bytes32 messageId = keccak256("msg1");
        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        vm.startPrank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);
        oracle.sendResponse(messageId, aliceRepKey);

        vm.expectRevert(abi.encodeWithSelector(GenericOracle.QueryAlreadyProcessed.selector, messageId));
        oracle.sendResponse(messageId, aliceRepKey);
        vm.stopPrank();
    }

    function test_SendResponse_RevertInsufficientBalance() public {
        bytes32 messageId = keccak256("msg1");
        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);

        // Drain oracle balance
        Receiver receiver = new Receiver();
        vm.prank(admin);
        oracle.withdraw(payable(address(receiver)), 10 ether);

        vm.prank(updater);
        vm.expectRevert();
        oracle.sendResponse(messageId, aliceRepKey);
    }

    function test_SendResponse_RevertDataInvalid() public {
        bytes32 messageId = keccak256("msg1");
        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);

        // Invalidate data
        vm.prank(admin);
        oracle.invalidateData(aliceRepKey);

        vm.prank(updater);
        vm.expectRevert(abi.encodeWithSelector(GenericOracle.QueryNotFound.selector, messageId));
        oracle.sendResponse(messageId, aliceRepKey);
    }

    // ========== Admin Functions Tests ==========

    function test_WhitelistChain() public {
        uint64 newChain = 12345;
        oracle.whitelistChain(newChain);
        assertTrue(oracle.whitelistedChains(newChain));
    }

    function test_RemoveChainFromWhitelist() public {
        oracle.removeChainFromWhitelist(ARBITRUM_CHAIN_SELECTOR);
        assertFalse(oracle.whitelistedChains(ARBITRUM_CHAIN_SELECTOR));
    }

    function test_RegisterSchema() public {
        vm.expectEmit(true, false, false, false);
        emit SchemaRegistered(NFT_SCHEMA);

        oracle.registerSchema(NFT_SCHEMA);
        assertTrue(oracle.registeredSchemas(NFT_SCHEMA));
    }

    function test_RegisterSchema_RevertInvalidHash() public {
        vm.expectRevert(GenericOracle.InvalidSchemaHash.selector);
        oracle.registerSchema(bytes32(0));
    }

    function test_SetStrictMode() public {
        vm.expectEmit(false, false, false, true);
        emit StrictModeToggled(true);

        oracle.setStrictMode(true);
        assertTrue(oracle.strictMode());

        vm.expectEmit(false, false, false, true);
        emit StrictModeToggled(false);

        oracle.setStrictMode(false);
        assertFalse(oracle.strictMode());
    }

    function test_StrictMode_RevertUnregisteredSchema() public {
        oracle.setStrictMode(true);

        vm.prank(updater);
        vm.expectRevert(abi.encodeWithSelector(GenericOracle.SchemaNotRegistered.selector, REPUTATION_SCHEMA));
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);
    }

    function test_StrictMode_SuccessRegisteredSchema() public {
        oracle.registerSchema(REPUTATION_SCHEMA);
        oracle.setStrictMode(true);

        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);

        (,, bytes32 schema, bool isValid) = oracle.getData(aliceRepKey);
        assertEq(schema, REPUTATION_SCHEMA);
        assertTrue(isValid);
    }

    function test_InvalidateData() public {
        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);

        vm.expectEmit(true, false, false, false);
        emit DataInvalidated(aliceRepKey);

        oracle.invalidateData(aliceRepKey);

        (,, , bool isValid) = oracle.getData(aliceRepKey);
        assertFalse(isValid);
    }

    function test_InvalidateData_RevertInvalidKey() public {
        vm.expectRevert(GenericOracle.InvalidKey.selector);
        oracle.invalidateData(bytes32(0));
    }

    function test_SetDefaultValue() public {
        bytes memory defaultRep = abi.encode(uint8(60));

        vm.expectEmit(true, false, false, false);
        emit DefaultValueSet(REPUTATION_SCHEMA);

        oracle.setDefaultValue(REPUTATION_SCHEMA, defaultRep);

        bytes memory stored = oracle.defaultValues(REPUTATION_SCHEMA);
        assertEq(stored, defaultRep);
    }

    function test_SetDefaultValue_RevertInvalidHash() public {
        vm.expectRevert(GenericOracle.InvalidSchemaHash.selector);
        oracle.setDefaultValue(bytes32(0), abi.encode(uint8(60)));
    }

    function test_Withdraw_Success() public {
        Receiver receiver = new Receiver();
        uint256 balanceBefore = address(receiver).balance;
        oracle.withdraw(payable(address(receiver)), 1 ether);
        assertEq(address(receiver).balance, balanceBefore + 1 ether);
    }

    function test_Withdraw_RevertZeroAddress() public {
        vm.expectRevert(GenericOracle.ZeroAddress.selector);
        oracle.withdraw(payable(address(0)), 1 ether);
    }

    function test_Withdraw_RevertInsufficientBalance() public {
        vm.expectRevert();
        oracle.withdraw(payable(admin), 100 ether);
    }

    // ========== Gas Benchmarks ==========

    function test_GasBenchmark_UpdateData() public {
        vm.prank(updater);
        uint256 gasBefore = gasleft();
        oracle.updateData(aliceRepKey, abi.encode(uint8(85), bytes32("evidence")), REPUTATION_SCHEMA);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("updateData gas", gasUsed);
        // Final measured cost: ~171k gas (3.35x compared to ChainMeshOracle's 51k)
        // Trade-off: +120k gas (~$3 @ 30 gwei) vs CCIP fees (~$25) = negligible
        // Benefit: Infinite flexibility for any data type without redeployment
        assertLt(gasUsed, 175_000, "updateData should use < 175k gas");
    }

    function test_GasBenchmark_SendResponse() public {
        bytes32 messageId = keccak256("msg1");
        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);

        vm.prank(updater);
        uint256 gasBefore = gasleft();
        oracle.sendResponse(messageId, aliceRepKey);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("sendResponse gas", gasUsed);
        // Final measured cost: ~110k gas (2.29x compared to ChainMeshOracle's 48k)
        // Trade-off: +62k gas (~$1.86 @ 30 gwei) vs CCIP fees (~$25) = 7% overhead
        // Benefit: Generic response format supports any schema
        assertLt(gasUsed, 115_000, "sendResponse should use < 115k gas");
    }

    // ========== Integration Tests ==========

    function test_Integration_FullFlow() public {
        // Step 1: Consumer sends query
        bytes32 messageId = keccak256("integration");
        router.deliverMessage(
            address(oracle),
            messageId,
            ARBITRUM_CHAIN_SELECTOR,
            abi.encode(bob),
            abi.encode(aliceRepKey, REPUTATION_SCHEMA, bob)
        );

        // Step 2: Updater processes and updates data
        vm.prank(updater);
        oracle.updateData(aliceRepKey, abi.encode(uint8(92), bytes32("evidence")), REPUTATION_SCHEMA);

        // Step 3: Updater sends response
        vm.prank(updater);
        bytes32 responseId = oracle.sendResponse(messageId, aliceRepKey);

        // Verify
        assertTrue(router.sentMessages(responseId));
        (,,, bool processed) = oracle.queryRequests(messageId);
        assertTrue(processed);
    }

    function test_Integration_MultipleSchemas() public {
        // Register schemas in strict mode
        oracle.registerSchema(REPUTATION_SCHEMA);
        oracle.registerSchema(PRICE_SCHEMA);
        oracle.setStrictMode(true);

        vm.startPrank(updater);

        // Update different data types
        oracle.updateData(aliceRepKey, abi.encode(uint8(85)), REPUTATION_SCHEMA);
        oracle.updateData(ethPriceKey, abi.encode(uint256(3000e18)), PRICE_SCHEMA);

        vm.stopPrank();

        // Verify independence
        (bytes memory repData,, bytes32 repSchema, bool repValid) = oracle.getData(aliceRepKey);
        (bytes memory priceData,, bytes32 priceSchema, bool priceValid) = oracle.getData(ethPriceKey);

        assertTrue(repValid);
        assertTrue(priceValid);
        assertEq(repSchema, REPUTATION_SCHEMA);
        assertEq(priceSchema, PRICE_SCHEMA);
        assertTrue(repData.length > 0);
        assertTrue(priceData.length > 0);
    }

    // ========== Fuzz Tests ==========

    function testFuzz_UpdateData_AnyValue(bytes memory value) public {
        vm.assume(value.length > 0);
        vm.assume(value.length < 10000); // Reasonable limit

        vm.prank(updater);
        oracle.updateData(aliceRepKey, value, REPUTATION_SCHEMA);

        (bytes memory storedValue,,,) = oracle.getData(aliceRepKey);
        assertEq(storedValue, value);
    }

    function testFuzz_Keys_Collision(bytes32 key1, bytes32 key2) public {
        vm.assume(key1 != bytes32(0));
        vm.assume(key2 != bytes32(0));
        vm.assume(key1 != key2);

        vm.startPrank(updater);
        oracle.updateData(key1, abi.encode(uint8(50)), REPUTATION_SCHEMA);
        oracle.updateData(key2, abi.encode(uint8(75)), REPUTATION_SCHEMA);
        vm.stopPrank();

        (bytes memory data1,,,) = oracle.getData(key1);
        (bytes memory data2,,,) = oracle.getData(key2);

        (uint8 val1) = abi.decode(data1, (uint8));
        (uint8 val2) = abi.decode(data2, (uint8));

        assertEq(val1, 50);
        assertEq(val2, 75);
    }
}
