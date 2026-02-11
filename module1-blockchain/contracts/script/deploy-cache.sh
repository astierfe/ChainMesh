#!/bin/bash

# Script to deploy GenericCache on consumer chains
# Usage: ./script/deploy-cache.sh <chain>
# Example: ./script/deploy-cache.sh arbitrum-sepolia

set -e

CHAIN=$1

if [ -z "$CHAIN" ]; then
    echo "❌ Error: Chain not specified"
    echo "Usage: ./script/deploy-cache.sh <chain>"
    echo "Available chains: arbitrum-sepolia, base-sepolia"
    exit 1
fi

echo "🚀 Deploying GenericCache on $CHAIN..."

# Load environment variables from project root
ENV_FILE="../../.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: .env file not found at $ENV_FILE"
    exit 1
fi

source "$ENV_FILE"

# Check required variables
if [ -z "$PRIVATE_KEY" ]; then
    echo "❌ Error: PRIVATE_KEY not set in .env"
    exit 1
fi

if [ -z "$ORACLE_ADDRESS_SEPOLIA" ]; then
    echo "❌ Error: ORACLE_ADDRESS_SEPOLIA not set in .env"
    echo "Please deploy GenericOracle first using ./script/deploy-oracle.sh"
    exit 1
fi

# Set RPC URL and Etherscan API key based on chain
case $CHAIN in
    arbitrum-sepolia)
        RPC_URL="$ARBITRUM_RPC_URL"
        ETHERSCAN_KEY="$ARBITRUM_EXPLORER_API_KEY"
        ;;
    base-sepolia)
        RPC_URL="$BASE_RPC_URL"
        ETHERSCAN_KEY="$BASE_EXPLORER_API_KEY"
        ;;
    *)
        echo "❌ Error: Unsupported chain: $CHAIN"
        echo "Available chains: arbitrum-sepolia, base-sepolia"
        exit 1
        ;;
esac

if [ -z "$RPC_URL" ]; then
    echo "❌ Error: RPC URL for $CHAIN not set in .env"
    exit 1
fi

# Deploy
export TARGET_CHAIN=$CHAIN
forge script script/DeployGenericCache.s.sol:DeployGenericCache \
    --rpc-url "$RPC_URL" \
    --broadcast \
    --verify \
    --etherscan-api-key "$ETHERSCAN_KEY" \
    -vvvv

echo ""
echo "✅ GenericCache deployment on $CHAIN complete!"
echo "⚠️  Don't forget to copy the CACHE_ADDRESS to your .env file"
