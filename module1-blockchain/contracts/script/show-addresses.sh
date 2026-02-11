#!/bin/bash

# Script to display deployed contract addresses
# Usage: ./script/show-addresses.sh

set -e

# Load environment variables
ENV_FILE="../../.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    exit 1
fi

source "$ENV_FILE"

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║         ChainMesh Module 1 - Deployed Contract Addresses      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# GenericOracle on Sepolia
echo "📍 GenericOracle (Sepolia)"
echo "   ├─ Chain: Sepolia Testnet"
echo "   ├─ Chain Selector: $SEPOLIA_CHAIN_SELECTOR"
if [ -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
    echo "   └─ Address: ❌ NOT DEPLOYED"
    echo ""
    echo "      Run: ./script/deploy-oracle.sh"
else
    echo "   ├─ Address: $ORACLE_ADDRESS_SEPOLIA"
    echo "   └─ Explorer: https://sepolia.etherscan.io/address/$ORACLE_ADDRESS_SEPOLIA"
fi

echo ""

# GenericCache on Arbitrum Sepolia
echo "📍 GenericCache (Arbitrum Sepolia)"
echo "   ├─ Chain: Arbitrum Sepolia Testnet"
echo "   ├─ Chain Selector: $ARBITRUM_CHAIN_SELECTOR"
if [ -z "$CACHE_ADDRESS_ARBITRUM" ]; then
    echo "   └─ Address: ❌ NOT DEPLOYED"
    echo ""
    echo "      Run: ./script/deploy-cache.sh arbitrum-sepolia"
else
    echo "   ├─ Address: $CACHE_ADDRESS_ARBITRUM"
    echo "   ├─ Explorer: https://sepolia.arbiscan.io/address/$CACHE_ADDRESS_ARBITRUM"
    # Show balance
    BALANCE=$(cast balance $CACHE_ADDRESS_ARBITRUM --rpc-url $ARBITRUM_RPC_URL 2>/dev/null || echo "0")
    BALANCE_ETH=$(cast --to-unit $BALANCE ether 2>/dev/null || echo "0")
    echo "   └─ Balance: $BALANCE_ETH ETH"
fi

echo ""

# GenericCache on Base Sepolia
echo "📍 GenericCache (Base Sepolia)"
echo "   ├─ Chain: Base Sepolia Testnet"
echo "   ├─ Chain Selector: $BASE_CHAIN_SELECTOR"
if [ -z "$CACHE_ADDRESS_BASE" ]; then
    echo "   └─ Address: ❌ NOT DEPLOYED"
    echo ""
    echo "      Run: ./script/deploy-cache.sh base-sepolia"
else
    echo "   ├─ Address: $CACHE_ADDRESS_BASE"
    echo "   ├─ Explorer: https://sepolia.basescan.org/address/$CACHE_ADDRESS_BASE"
    # Show balance
    BALANCE=$(cast balance $CACHE_ADDRESS_BASE --rpc-url $BASE_RPC_URL 2>/dev/null || echo "0")
    BALANCE_ETH=$(cast --to-unit $BALANCE ether 2>/dev/null || echo "0")
    echo "   └─ Balance: $BALANCE_ETH ETH"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                      Deployment Status                         ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Count deployed contracts
DEPLOYED=0
TOTAL=3

if [ ! -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
    DEPLOYED=$((DEPLOYED + 1))
fi

if [ ! -z "$CACHE_ADDRESS_ARBITRUM" ]; then
    DEPLOYED=$((DEPLOYED + 1))
fi

if [ ! -z "$CACHE_ADDRESS_BASE" ]; then
    DEPLOYED=$((DEPLOYED + 1))
fi

echo "   Deployed: $DEPLOYED / $TOTAL contracts"
echo ""

if [ $DEPLOYED -eq 0 ]; then
    echo "   ❌ No contracts deployed yet"
    echo ""
    echo "   🚀 Quick Start:"
    echo "      1. ./script/deploy-oracle.sh"
    echo "      2. ./script/deploy-cache.sh arbitrum-sepolia"
    echo "      3. ./script/deploy-cache.sh base-sepolia"
    echo "      4. ./script/configure-contracts.sh"
elif [ $DEPLOYED -lt 3 ]; then
    echo "   ⚠️  Partial deployment"
    echo ""
    echo "   📝 Next steps:"
    if [ -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
        echo "      1. Deploy Oracle: ./script/deploy-oracle.sh"
    fi
    if [ -z "$CACHE_ADDRESS_ARBITRUM" ]; then
        echo "      2. Deploy Arbitrum Cache: ./script/deploy-cache.sh arbitrum-sepolia"
    fi
    if [ -z "$CACHE_ADDRESS_BASE" ]; then
        echo "      3. Deploy Base Cache: ./script/deploy-cache.sh base-sepolia"
    fi
    echo "      4. Configure: ./script/configure-contracts.sh"
else
    echo "   ✅ All contracts deployed!"
    echo ""
    echo "   📝 Configuration status:"

    # Check if chains are configured
    if [ ! -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
        echo "      Run: ./script/test-deployment.sh to verify"
        echo ""
        echo "   🎯 Ready to use in Module 2!"
    fi
fi

echo ""
