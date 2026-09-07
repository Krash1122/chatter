// Central Postgres connection pool. Every query in the app goes through this
// module so there's exactly one place that knows how to connect.
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      }
);

pool.on('error', (err) => {
  // Fires for errors on idle clients in the pool (e.g. the DB restarted).
  // Without this handler an unhandled 'error' event would crash the process.
  console.error('Unexpected Postgres pool error', err);
});

module.exports = {
  pool,
  // Thin wrapper so call sites can do `const { rows } = await query(sql, params)`
  // instead of importing the pool everywhere.
  query: (text, params) => pool.query(text, params),
};
