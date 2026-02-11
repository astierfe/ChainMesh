#!/bin/bash

# Script to configure deployed contracts (post-deployment)
# Usage: ./script/configure-contracts.sh

set -e

echo "⚙️  Configuring deployed contracts..."

# Load environment variables
ENV_FILE="../../.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    exit 1
fi

source "$ENV_FILE"

# Check if Oracle is deployed
if [ -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
    echo "❌ Error: ORACLE_ADDRESS_SEPOLIA not set in .env"
    echo "Please deploy GenericOracle first"
    exit 1
fi

echo ""
echo "=== Configuring GenericOracle on Sepolia ==="
echo "Oracle Address: $ORACLE_ADDRESS_SEPOLIA"

# Configure allowed chains on Oracle
echo ""
echo "1️⃣  Configuring allowed source chains..."

# Arbitrum Sepolia
echo -n "   Allowing Arbitrum Sepolia... "
cast send $ORACLE_ADDRESS_SEPOLIA \
    "setSourceChainConfig(uint64,bool)" \
    $ARBITRUM_CHAIN_SELECTOR true \
    --rpc-url $ETHEREUM_RPC_URL \
    --private-key $PRIVATE_KEY \
    --gas-limit 100000 > /dev/null 2>&1 && echo "✅" || echo "❌"

# Base Sepolia
echo -n "   Allowing Base Sepolia... "
cast send $ORACLE_ADDRESS_SEPOLIA \
    "setSourceChainConfig(uint64,bool)" \
    $BASE_CHAIN_SELECTOR true \
    --rpc-url $ETHEREUM_RPC_URL \
    --private-key $PRIVATE_KEY \
    --gas-limit 100000 > /dev/null 2>&1 && echo "✅" || echo "❌"

# Optimism Sepolia (optional)
echo -n "   Allowing Optimism Sepolia... "
cast send $ORACLE_ADDRESS_SEPOLIA \
    "setSourceChainConfig(uint64,bool)" \
    $OPTIMISM_CHAIN_SELECTOR true \
    --rpc-url $ETHEREUM_RPC_URL \
    --private-key $PRIVATE_KEY \
    --gas-limit 100000 > /dev/null 2>&1 && echo "✅" || echo "❌"

# Register default schemas
echo ""
echo "2️⃣  Registering default schemas..."

# ReputationV1 schema
REPUTATION_SCHEMA_HASH=$(cast keccak "ReputationV1")
echo -n "   Registering ReputationV1 schema... "
cast send $ORACLE_ADDRESS_SEPOLIA \
    "registerSchema(bytes32,string)" \
    $REPUTATION_SCHEMA_HASH "ReputationV1" \
    --rpc-url $ETHEREUM_RPC_URL \
    --private-key $PRIVATE_KEY \
    --gas-limit 100000 > /dev/null 2>&1 && echo "✅" || echo "⚠️  (may already exist)"

# PriceV1 schema
PRICE_SCHEMA_HASH=$(cast keccak "PriceV1")
echo -n "   Registering PriceV1 schema... "
cast send $ORACLE_ADDRESS_SEPOLIA \
    "registerSchema(bytes32,string)" \
    $PRICE_SCHEMA_HASH "PriceV1" \
    --rpc-url $ETHEREUM_RPC_URL \
    --private-key $PRIVATE_KEY \
    --gas-limit 100000 > /dev/null 2>&1 && echo "✅" || echo "⚠️  (may already exist)"

# Fund Cache contracts if deployed
echo ""
echo "3️⃣  Funding Cache contracts for CCIP fees..."

if [ ! -z "$CACHE_ADDRESS_ARBITRUM" ]; then
    echo -n "   Funding Arbitrum Cache with 0.1 ETH... "
    # Check current balance
    CURRENT_BALANCE=$(cast balance $CACHE_ADDRESS_ARBITRUM --rpc-url $ARBITRUM_RPC_URL)
    # Convert to ether (rough check if > 0.05 ETH)
    if [ $(echo "$CURRENT_BALANCE > 50000000000000000" | bc) -eq 1 ]; then
        echo "⏭️  (already funded: $(cast --to-unit $CURRENT_BALANCE ether) ETH)"
    else
        cast send $CACHE_ADDRESS_ARBITRUM \
            --value 0.1ether \
            --rpc-url $ARBITRUM_RPC_URL \
            --private-key $PRIVATE_KEY \
            --gas-limit 50000 > /dev/null 2>&1 && echo "✅" || echo "❌"
    fi
fi

if [ ! -z "$CACHE_ADDRESS_BASE" ]; then
    echo -n "   Funding Base Cache with 0.1 ETH... "
    # Check current balance
    CURRENT_BALANCE=$(cast balance $CACHE_ADDRESS_BASE --rpc-url $BASE_RPC_URL)
    # Convert to ether (rough check if > 0.05 ETH)
    if [ $(echo "$CURRENT_BALANCE > 50000000000000000" | bc) -eq 1 ]; then
        echo "⏭️  (already funded: $(cast --to-unit $CURRENT_BALANCE ether) ETH)"
    else
        cast send $CACHE_ADDRESS_BASE \
            --value 0.1ether \
            --rpc-url $BASE_RPC_URL \
            --private-key $PRIVATE_KEY \
            --gas-limit 50000 > /dev/null 2>&1 && echo "✅" || echo "❌"
    fi
fi

echo ""
echo "✅ Configuration complete!"
echo ""
echo "📝 Summary:"
echo "   - Allowed chains configured on Oracle"
echo "   - Default schemas registered (ReputationV1, PriceV1)"
echo "   - Cache contracts funded for CCIP"
echo ""
echo "🎉 Your contracts are ready to use!"
