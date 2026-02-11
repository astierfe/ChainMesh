#!/bin/bash

# Script to deploy GenericOracle on Sepolia
# Usage: ./script/deploy-oracle.sh

set -e

echo "🚀 Deploying GenericOracle on Sepolia..."

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

if [ -z "$ETHEREUM_RPC_URL" ]; then
    echo "❌ Error: ETHEREUM_RPC_URL not set in .env"
    exit 1
fi

# Deploy
forge script script/DeployGenericOracle.s.sol:DeployGenericOracle \
    --rpc-url "$ETHEREUM_RPC_URL" \
    --broadcast \
    --verify \
    --etherscan-api-key "$ETHEREUM_EXPLORER_API_KEY" \
    -vvvv

echo ""
echo "✅ GenericOracle deployment complete!"
echo "⚠️  Don't forget to copy the ORACLE_ADDRESS_SEPOLIA to your .env file"
