// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {GenericOracle} from "../src/GenericOracle.sol";

/// @title DeployGenericOracle
/// @notice Script to deploy GenericOracle on Sepolia (Oracle chain)
contract DeployGenericOracle is Script {
    // Sepolia CCIP Router address
    address constant CCIP_ROUTER_SEPOLIA = 0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59;

    function run() external returns (GenericOracle) {
        // Get deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying GenericOracle on Sepolia...");
        console2.log("Deployer address:", deployer);
        console2.log("CCIP Router:", CCIP_ROUTER_SEPOLIA);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy GenericOracle
        GenericOracle oracle = new GenericOracle(CCIP_ROUTER_SEPOLIA);

        vm.stopBroadcast();

        console2.log("GenericOracle deployed at:", address(oracle));
        console2.log("\n=== Add this to your .env file ===");
        console2.log("ORACLE_ADDRESS_SEPOLIA=%s", address(oracle));

        return oracle;
    }
}
