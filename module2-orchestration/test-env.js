require('dotenv').config();

/**
 * Script de test des variables d'environnement
 * Vérifie que toutes les variables requises sont configurées
 */

const REQUIRED_VARS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD'
];

const OPTIONAL_VARS = [
  'ALCHEMY_API_KEY',
  'CLAUDE_API_KEY',
  'GOLDSKY_ENDPOINT',
  'LIT_PKP_PUBLIC_KEY',
  'SEPOLIA_RPC',
  'ARBITRUM_RPC',
  'BASE_RPC',
  'N8N_ENCRYPTION_KEY',
  'N8N_WEBHOOK_URL',
  'ORACLE_ADDRESS_SEPOLIA',
  'CACHE_ADDRESS_ARBITRUM',
  'CACHE_ADDRESS_BASE'
];

console.log('🔍 Testing environment variables...\n');

console.log('═══════════════════════════════════════════');
console.log('         REQUIRED VARIABLES');
console.log('═══════════════════════════════════════════\n');

let allRequiredPresent = true;

REQUIRED_VARS.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    // Masquer les valeurs sensibles
    const displayValue = varName.includes('PASSWORD') || varName.includes('KEY')
      ? '***' + value.slice(-4)
      : value;
    console.log(`✅ ${varName.padEnd(25)} = ${displayValue}`);
  } else {
    console.log(`❌ ${varName.padEnd(25)} = MISSING`);
    allRequiredPresent = false;
  }
});

console.log('\n═══════════════════════════════════════════');
console.log('         OPTIONAL VARIABLES');
console.log('═══════════════════════════════════════════\n');

let optionalConfigured = 0;

OPTIONAL_VARS.forEach(varName => {
  const value = process.env[varName];
  if (value && value !== 'not_configured_yet' && value !== '') {
    const displayValue = varName.includes('PASSWORD') || varName.includes('KEY') || varName.includes('RPC')
      ? '***' + value.slice(-6)
      : value;
    console.log(`✅ ${varName.padEnd(25)} = ${displayValue}`);
    optionalConfigured++;
  } else {
    console.log(`⚠️  ${varName.padEnd(25)} = Not configured (optional for MVP)`);
  }
});

console.log('\n═══════════════════════════════════════════');
console.log('              SUMMARY');
console.log('═══════════════════════════════════════════\n');

if (allRequiredPresent) {
  console.log('✅ All REQUIRED environment variables are set!');
} else {
  console.log('❌ Some REQUIRED environment variables are missing.');
  console.log('   Please check your .env file and configure the missing variables.');
}

console.log(`ℹ️  Optional variables configured: ${optionalConfigured}/${OPTIONAL_VARS.length}`);

if (optionalConfigured < OPTIONAL_VARS.length) {
  console.log('\n💡 Tips:');
  console.log('   - ALCHEMY_API_KEY: Get from https://www.alchemy.com/');
  console.log('   - CLAUDE_API_KEY: Get from https://console.anthropic.com/');
  console.log('   - GOLDSKY_ENDPOINT: Can skip for MVP (will use Alchemy fallback)');
  console.log('   - LIT_PKP_PUBLIC_KEY: Can skip for MVP (will use dev wallet)');
  console.log('   - Contract addresses: Deploy Module 1 first, then add addresses');
}

console.log('\n═══════════════════════════════════════════\n');

if (!allRequiredPresent) {
  process.exit(1);
}
