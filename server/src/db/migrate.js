// Applies schema.sql to whatever database DATABASE_URL/.env points at.
// Run with: npm run db:migrate
// Safe to design idempotently later, but for a fresh learning project we just
// assume you're running this once against an empty database.
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  console.log('Applying schema.sql ...');
  await pool.query(schema);
  console.log('Schema applied successfully.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
