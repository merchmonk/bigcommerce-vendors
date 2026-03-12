const { Pool } = require('pg');
require('dotenv').config();

async function main() {
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable must be set for PostgreSQL migrations.');
  }

  const pool = new Pool({ connectionString: DATABASE_URL });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        userId INTEGER NOT NULL UNIQUE,
        email TEXT NOT NULL,
        username TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        storeHash VARCHAR(10) NOT NULL UNIQUE,
        accessToken TEXT,
        scope TEXT
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS storeUsers (
        id SERIAL PRIMARY KEY,
        userId INTEGER NOT NULL,
        storeHash VARCHAR(10) NOT NULL,
        isAdmin BOOLEAN,
        UNIQUE (userId, storeHash)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        vendor_id SERIAL PRIMARY KEY,
        vendor_name VARCHAR(255) NOT NULL,
        vendor_api_url VARCHAR(2048),
        vendor_account_id VARCHAR(255),
        vendor_secret TEXT,
        is_promo_standards BOOLEAN NOT NULL DEFAULT FALSE,
        promo_endpoints JSONB,
        format_data TEXT,
        api_service_type VARCHAR(32),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        datetime_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        datetime_modified TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

