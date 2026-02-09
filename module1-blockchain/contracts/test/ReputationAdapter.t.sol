// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {ReputationAdapter} from "../src/adapters/ReputationAdapter.sol";
import {GenericOracle} from "../src/GenericOracle.sol";
import {IGenericOracle} from "../src/interfaces/IGenericOracle.sol";
import {MockCCIPRouter} from "./mocks/MockCCIPRouter.sol";

contract ReputationAdapterTest is Test {
    ReputationAdapter public adapter;
    GenericOracle public oracle;
    MockCCIPRouter public router;

    address public owner;
    address public updater;
    address public alice;
    address public bob;

    uint64 public constant ARBITRUM_CHAIN_SELECTOR = 4949039107694359620;

    function setUp() public {
        owner = address(this);
        updater = makeAddr("updater");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy contracts
        router = new MockCCIPRouter();
        oracle = new GenericOracle(address(router));
        adapter = new ReputationAdapter();

        // Grant updater role
        oracle.grantRole(oracle.UPDATER_ROLE(), updater);
        oracle.grantRole(oracle.UPDATER_ROLE(), address(adapter));

        // Whitelist Arbitrum
        oracle.whitelistChain(ARBITRUM_CHAIN_SELECTOR);
    }

    // ========== IDataAdapter Tests ==========

    function test_GetSchemaHash() public view {
        bytes32 schemaHash = adapter.getSchemaHash();
        assertEq(schemaHash, keccak256("ReputationV1"));
    }

    function test_GetDefaultValue() public view {
        bytes memory defaultValue = adapter.getDefaultValue();
        (uint8 score, bytes32 evidence) = abi.decode(defaultValue, (uint8, bytes32));

        assertEq(score, 60, "Default score should be 60");
        assertEq(evidence, bytes32(0), "Default evidence should be empty");
    }

    // ========== Helper Tests ==========

    function test_GetKey_UniqueForDifferentWallets() public view {
        bytes32 aliceKey = adapter.getKey(alice);
        bytes32 bobKey = adapter.getKey(bob);

        assertTrue(aliceKey != bobKey, "Keys should be unique");
    }

    function test_GetKey_DeterministicForSameWallet() public view {
        bytes32 key1 = adapter.getKey(alice);
        bytes32 key2 = adapter.getKey(alice);

        assertEq(key1, key2, "Keys should be deterministic");
    }

    function test_GetKey_RevertsOnZeroAddress() public {
        vm.expectRevert(ReputationAdapter.ZeroAddress.selector);
        adapter.getKey(address(0));
    }

    function test_UpdateReputation_Success() public {
        vm.prank(updater);
        adapter.updateReputation(
            IGenericOracle(address(oracle)),
            alice,
            85,
            bytes32("ipfs://evidence")
        );

        // Verify data stored in oracle
        bytes32 key = adapter.getKey(alice);
        (bytes memory value, , bytes32 schema, bool isValid) = oracle.getData(key);

        assertTrue(isValid, "Data should be valid");
        assertEq(schema, adapter.getSchemaHash(), "Schema should match");

        (uint8 score, bytes32 evidence) = abi.decode(value, (uint8, bytes32));
        assertEq(score, 85, "Score should be 85");
        assertEq(evidence, bytes32("ipfs://evidence"), "Evidence should match");
    }

    function test_UpdateReputation_RevertsOnInvalidScore() public {
        vm.prank(updater);
        vm.expectRevert(ReputationAdapter.InvalidScore.selector);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 101, bytes32(0));
    }

    function test_UpdateReputation_RevertsOnZeroOracleAddress() public {
        vm.expectRevert(ReputationAdapter.ZeroAddress.selector);
        adapter.updateReputation(IGenericOracle(address(0)), alice, 85, bytes32(0));
    }

    function test_UpdateReputation_RevertsOnZeroWalletAddress() public {
        vm.expectRevert(ReputationAdapter.ZeroAddress.selector);
        adapter.updateReputation(IGenericOracle(address(oracle)), address(0), 85, bytes32(0));
    }

    function test_GetReputation_ReturnsDefaultForNonExistent() public view {
        (uint8 score, uint32 timestamp, bytes32 evidence, bool isValid) =
            adapter.getReputation(IGenericOracle(address(oracle)), alice);

        assertEq(score, 60, "Should return default score");
        assertEq(timestamp, 0, "Timestamp should be 0");
        assertEq(evidence, bytes32(0), "Evidence should be empty");
        assertFalse(isValid, "Should not be valid");
    }

    function test_GetReputation_ReturnsStoredData() public {
        // Store reputation
        vm.prank(updater);
        adapter.updateReputation(
            IGenericOracle(address(oracle)),
            alice,
            90,
            bytes32("ipfs://QmTest")
        );

        // Retrieve reputation
        (uint8 score, uint32 timestamp, bytes32 evidence, bool isValid) =
            adapter.getReputation(IGenericOracle(address(oracle)), alice);

        assertEq(score, 90, "Score should be 90");
        assertGt(timestamp, 0, "Timestamp should be set");
        assertEq(evidence, bytes32("ipfs://QmTest"), "Evidence should match");
        assertTrue(isValid, "Should be valid");
    }

    function test_GetReputation_RevertsOnZeroOracleAddress() public {
        vm.expectRevert(ReputationAdapter.ZeroAddress.selector);
        adapter.getReputation(IGenericOracle(address(0)), alice);
    }

    function test_GetReputation_RevertsOnZeroWalletAddress() public {
        vm.expectRevert(ReputationAdapter.ZeroAddress.selector);
        adapter.getReputation(IGenericOracle(address(oracle)), address(0));
    }

    // ========== Round-Trip Tests ==========

    function test_UpdateAndGet_RoundTrip() public {
        bytes32 evidenceHash = bytes32("ipfs://QmRoundTrip");

        // Update
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 75, evidenceHash);

        // Get
        (uint8 score, , bytes32 evidence, bool isValid) =
            adapter.getReputation(IGenericOracle(address(oracle)), alice);

        assertEq(score, 75, "Score should match");
        assertEq(evidence, evidenceHash, "Evidence should match");
        assertTrue(isValid, "Should be valid");
    }

    function test_UpdateMultipleWallets() public {
        // Update Alice
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 80, bytes32("alice-evidence"));

        // Update Bob
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), bob, 70, bytes32("bob-evidence"));

        // Verify Alice
        (uint8 aliceScore, , bytes32 aliceEvidence, ) =
            adapter.getReputation(IGenericOracle(address(oracle)), alice);
        assertEq(aliceScore, 80);
        assertEq(aliceEvidence, bytes32("alice-evidence"));

        // Verify Bob
        (uint8 bobScore, , bytes32 bobEvidence, ) =
            adapter.getReputation(IGenericOracle(address(oracle)), bob);
        assertEq(bobScore, 70);
        assertEq(bobEvidence, bytes32("bob-evidence"));
    }

    // ========== Encode/Decode Tests ==========

    function test_Encode_Success() public view {
        bytes memory encoded = adapter.encode(85, bytes32("evidence"));
        (uint8 score, bytes32 evidence) = abi.decode(encoded, (uint8, bytes32));

        assertEq(score, 85);
        assertEq(evidence, bytes32("evidence"));
    }

    function test_Encode_RevertsOnInvalidScore() public {
        vm.expectRevert(ReputationAdapter.InvalidScore.selector);
        adapter.encode(101, bytes32(0));
    }

    function test_Decode_Success() public view {
        bytes memory data = abi.encode(uint8(95), bytes32("test-evidence"));
        (uint8 score, bytes32 evidence) = adapter.decode(data);

        assertEq(score, 95);
        assertEq(evidence, bytes32("test-evidence"));
    }

    // ========== Backward Compatibility Tests ==========

    function test_BackwardCompatibility_SameAPIAsChainMeshOracle() public {
        // This test verifies that apps using old ChainMeshOracle API can migrate
        // Old API: getReputation(address) → (uint8, uint32, bytes32, bool)

        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 88, bytes32("migration-test"));

        // Old-style call
        (uint8 score, uint32 timestamp, bytes32 evidence, bool isValid) =
            adapter.getReputation(IGenericOracle(address(oracle)), alice);

        // Verify signature matches
        assertEq(score, 88);
        assertGt(timestamp, 0);
        assertEq(evidence, bytes32("migration-test"));
        assertTrue(isValid);
    }

    function test_BackwardCompatibility_DefaultScoreMatches() public view {
        // Verify default score matches old ChainMeshCache.DEFAULT_SCORE (60)
        assertEq(adapter.DEFAULT_SCORE(), 60);
    }

    // ========== Access Control Tests ==========

    function test_UpdateReputation_RequiresUpdaterRole() public {
        // Revoke adapter's role so Oracle will reject the call
        oracle.revokeRole(oracle.UPDATER_ROLE(), address(adapter));

        vm.expectRevert();
        adapter.updateReputation(IGenericOracle(address(oracle)), bob, 50, bytes32(0));
    }

    // ========== Edge Case Tests ==========

    function test_UpdateReputation_BoundaryScores() public {
        // Test score = 0
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 0, bytes32(0));
        (uint8 score1, , , ) = adapter.getReputation(IGenericOracle(address(oracle)), alice);
        assertEq(score1, 0);

        // Test score = 100
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), bob, 100, bytes32(0));
        (uint8 score2, , , ) = adapter.getReputation(IGenericOracle(address(oracle)), bob);
        assertEq(score2, 100);
    }

    function test_UpdateReputation_OverwritesExistingData() public {
        // First update
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 50, bytes32("old"));

        // Overwrite
        vm.prank(updater);
        adapter.updateReputation(IGenericOracle(address(oracle)), alice, 90, bytes32("new"));

        // Verify new data
        (uint8 score, , bytes32 evidence, ) =
            adapter.getReputation(IGenericOracle(address(oracle)), alice);
        assertEq(score, 90);
        assertEq(evidence, bytes32("new"));
    }
}
