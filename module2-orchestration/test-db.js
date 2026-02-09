require('dotenv').config();
const { Client } = require('pg');

/**
 * Script de test de connexion PostgreSQL
 * Vérifie que la connexion fonctionne et que les tables existent
 */

async function testDatabase() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: process.env.POSTGRES_DB || 'chainmesh_n8n',
    user: process.env.POSTGRES_USER || 'chainmesh',
    password: process.env.POSTGRES_PASSWORD
  });

  try {
    console.log('🔌 Attempting to connect to PostgreSQL...');
    await client.connect();
    console.log('✅ PostgreSQL connection successful!');

    // Test 1: Get current timestamp
    const timeResult = await client.query('SELECT NOW()');
    console.log('✅ Current timestamp:', timeResult.rows[0].now);

    // Test 2: Check if tables exist
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log('\n📊 Tables found:');
    if (tablesResult.rows.length === 0) {
      console.log('⚠️  No tables found. Please run the migration: migrations/001_initial_schema.sql');
    } else {
      tablesResult.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
    }

    // Test 3: Check circuit breakers if table exists
    const hasCircuitBreakers = tablesResult.rows.some(r => r.table_name === 'circuit_breakers');
    if (hasCircuitBreakers) {
      const cbResult = await client.query('SELECT provider, state FROM circuit_breakers');
      console.log('\n🔄 Circuit Breakers Status:');
      cbResult.rows.forEach(row => {
        const emoji = row.state === 'CLOSED' ? '✅' : row.state === 'OPEN' ? '❌' : '⚠️';
        console.log(`   ${emoji} ${row.provider}: ${row.state}`);
      });
    }

    console.log('\n✅ Database test completed successfully!\n');
  } catch (error) {
    console.error('❌ Database test failed:');
    console.error('   Error:', error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 PostgreSQL is not running or not accessible');
      console.error('   - Check that PostgreSQL is started');
      console.error('   - Verify connection settings in .env');
    } else if (error.code === '28P01') {
      console.error('\n💡 Authentication failed');
      console.error('   - Check POSTGRES_USER and POSTGRES_PASSWORD in .env');
    } else if (error.code === '3D000') {
      console.error('\n💡 Database does not exist');
      console.error('   - Create database: CREATE DATABASE chainmesh_n8n;');
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

testDatabase();
