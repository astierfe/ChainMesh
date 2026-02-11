// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GenericCache} from "../src/GenericCache.sol";

/// @title DeployGenericCache
/// @notice Script to deploy GenericCache on consumer chains (Arbitrum, Base, etc.)
/// @dev Requires ORACLE_ADDRESS_SEPOLIA in .env
contract DeployGenericCache is Script {
    // CCIP Router addresses per chain
    address constant CCIP_ROUTER_ARBITRUM_SEPOLIA = 0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165;
    address constant CCIP_ROUTER_BASE_SEPOLIA = 0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93;

    // CCIP Chain Selectors
    uint64 constant SEPOLIA_CHAIN_SELECTOR = 16015286601757825753;

    function run() external returns (GenericCache) {
        // Get configuration from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address oracleAddress = vm.envAddress("ORACLE_ADDRESS_SEPOLIA");
        string memory targetChain = vm.envString("TARGET_CHAIN");

        // Determine CCIP Router based on target chain
        address ccipRouter;
        if (keccak256(bytes(targetChain)) == keccak256(bytes("arbitrum-sepolia"))) {
            ccipRouter = CCIP_ROUTER_ARBITRUM_SEPOLIA;
        } else if (keccak256(bytes(targetChain)) == keccak256(bytes("base-sepolia"))) {
            ccipRouter = CCIP_ROUTER_BASE_SEPOLIA;
        } else {
            revert("Unsupported target chain");
        }

        console2.log("Deploying GenericCache on", targetChain);
        console2.log("Deployer address:", deployer);
        console2.log("CCIP Router:", ccipRouter);
        console2.log("Oracle address (Sepolia):", oracleAddress);
        console2.log("Oracle chain selector:", SEPOLIA_CHAIN_SELECTOR);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy GenericCache
        GenericCache cache = new GenericCache(
            ccipRouter,
            oracleAddress,
            SEPOLIA_CHAIN_SELECTOR
        );

        vm.stopBroadcast();

        console2.log("GenericCache deployed at:", address(cache));
        console2.log("\n=== Add this to your .env file ===");
        if (keccak256(bytes(targetChain)) == keccak256(bytes("arbitrum-sepolia"))) {
            console2.log("CACHE_ADDRESS_ARBITRUM=%s", address(cache));
        } else if (keccak256(bytes(targetChain)) == keccak256(bytes("base-sepolia"))) {
            console2.log("CACHE_ADDRESS_BASE=%s", address(cache));
        }

        return cache;
    }
}
