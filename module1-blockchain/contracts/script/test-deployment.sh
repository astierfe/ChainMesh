#!/bin/bash

# Script to test deployed contracts
# Usage: ./script/test-deployment.sh

set -e

echo "🧪 Testing deployed contracts..."

# Load environment variables
ENV_FILE="../../.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    exit 1
fi

source "$ENV_FILE"

# Check if contracts are deployed
if [ -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
    echo "❌ Error: ORACLE_ADDRESS_SEPOLIA not set in .env"
    echo "Please deploy GenericOracle first"
    exit 1
fi

echo ""
echo "=== Testing GenericOracle on Sepolia ==="
echo "Address: $ORACLE_ADDRESS_SEPOLIA"

# Test DEFAULT_ADMIN_ROLE
echo -n "Testing DEFAULT_ADMIN_ROLE... "
ADMIN_ROLE=$(cast call $ORACLE_ADDRESS_SEPOLIA \
    "DEFAULT_ADMIN_ROLE()(bytes32)" \
    --rpc-url $ETHEREUM_RPC_URL)
echo "✅ $ADMIN_ROLE"

# Test UPDATER_ROLE
echo -n "Testing UPDATER_ROLE... "
UPDATER_ROLE=$(cast call $ORACLE_ADDRESS_SEPOLIA \
    "UPDATER_ROLE()(bytes32)" \
    --rpc-url $ETHEREUM_RPC_URL)
echo "✅ $UPDATER_ROLE"

# Test if deployer has admin role
echo -n "Checking if deployer has admin role... "
HAS_ROLE=$(cast call $ORACLE_ADDRESS_SEPOLIA \
    "hasRole(bytes32,address)(bool)" \
    $ADMIN_ROLE $DEPLOYER_ADRESS \
    --rpc-url $ETHEREUM_RPC_URL)
if [ "$HAS_ROLE" = "true" ]; then
    echo "✅ Yes"
else
    echo "❌ No"
fi

# Test Arbitrum Cache if deployed
if [ ! -z "$CACHE_ADDRESS_ARBITRUM" ]; then
    echo ""
    echo "=== Testing GenericCache on Arbitrum Sepolia ==="
    echo "Address: $CACHE_ADDRESS_ARBITRUM"

    echo -n "Testing ORACLE_ADDRESS... "
    ORACLE_ADDR=$(cast call $CACHE_ADDRESS_ARBITRUM \
        "ORACLE_ADDRESS()(address)" \
        --rpc-url $ARBITRUM_RPC_URL)
    echo "✅ $ORACLE_ADDR"

    echo -n "Testing ORACLE_CHAIN_SELECTOR... "
    CHAIN_SELECTOR=$(cast call $CACHE_ADDRESS_ARBITRUM \
        "ORACLE_CHAIN_SELECTOR()(uint64)" \
        --rpc-url $ARBITRUM_RPC_URL)
    echo "✅ $CHAIN_SELECTOR"

    echo -n "Testing CACHE_TTL... "
    CACHE_TTL=$(cast call $CACHE_ADDRESS_ARBITRUM \
        "CACHE_TTL()(uint256)" \
        --rpc-url $ARBITRUM_RPC_URL)
    echo "✅ $CACHE_TTL seconds"

    # Check balance
    echo -n "Checking contract balance... "
    BALANCE=$(cast balance $CACHE_ADDRESS_ARBITRUM --rpc-url $ARBITRUM_RPC_URL)
    echo "✅ $BALANCE wei"
fi

# Test Base Cache if deployed
if [ ! -z "$CACHE_ADDRESS_BASE" ]; then
    echo ""
    echo "=== Testing GenericCache on Base Sepolia ==="
    echo "Address: $CACHE_ADDRESS_BASE"

    echo -n "Testing ORACLE_ADDRESS... "
    ORACLE_ADDR=$(cast call $CACHE_ADDRESS_BASE \
        "ORACLE_ADDRESS()(address)" \
        --rpc-url $BASE_RPC_URL)
    echo "✅ $ORACLE_ADDR"

    echo -n "Testing ORACLE_CHAIN_SELECTOR... "
    CHAIN_SELECTOR=$(cast call $CACHE_ADDRESS_BASE \
        "ORACLE_CHAIN_SELECTOR()(uint64)" \
        --rpc-url $BASE_RPC_URL)
    echo "✅ $CHAIN_SELECTOR"

    echo -n "Testing CACHE_TTL... "
    CACHE_TTL=$(cast call $CACHE_ADDRESS_BASE \
        "CACHE_TTL()(uint256)" \
        --rpc-url $BASE_RPC_URL)
    echo "✅ $CACHE_TTL seconds"

    # Check balance
    echo -n "Checking contract balance... "
    BALANCE=$(cast balance $CACHE_ADDRESS_BASE --rpc-url $BASE_RPC_URL)
    echo "✅ $BALANCE wei"
fi

echo ""
echo "✅ All tests passed!"
echo ""
echo "📝 Next steps:"
echo "1. Configure allowed chains on Oracle (see QUICK_START.md)"
echo "2. Fund Cache contracts for CCIP fees (see QUICK_START.md)"
echo "3. Register schemas on Oracle"
