// Central Postgres connection pool. Every query in the app goes through this
// module so there's exactly one place that knows how to connect.
//
// Serverless changes the rules here. Each Vercel invocation may land in a
// fresh container, and a container that opens a 10-connection pool for a
// single query will exhaust Postgres the moment a handful of them spin up at
// once. Two things keep that under control:
//   1. max: 1 -- one connection per container, no more.
//   2. the pool is cached on globalThis, so warm invocations (which reuse the
//      same container) reuse the connection instead of opening another.
// The real pooling is Neon's job: use the "-pooler" host from the Neon
// dashboard (its pgBouncer endpoint), not the direct one.
const { Pool } = require('pg');
require('dotenv').config();

function buildConfig() {
  const connectionString = process.env.DATABASE_URL;

  const shared = {
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  };

  if (connectionString) {
    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
    return {
      ...shared,
      connectionString,
      // Neon (and every other hosted Postgres) requires TLS; a local docker
      // Postgres almost never has a certificate, so don't ask it for one.
      ssl: isLocal ? false : { rejectUnauthorized: true },
    };
  }

  // Fallback for local development without a single connection URL.
  return {
    ...shared,
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
}

function createPool() {
  const pool = new Pool(buildConfig());

  pool.on('error', (err) => {
    // Fires for errors on idle clients in the pool (e.g. the DB restarted).
    // Without this handler an unhandled 'error' event would crash the process.
    console.error('Unexpected Postgres pool error', err);
  });

  return pool;
}

const pool = globalThis.__chatterPgPool || (globalThis.__chatterPgPool = createPool());

module.exports = {
  pool,
  // Thin wrapper so call sites can do `const { rows } = await query(sql, params)`
  // instead of importing the pool everywhere.
  query: (text, params) => pool.query(text, params),
};
