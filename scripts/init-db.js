require('dotenv').config();
const { ensureSchema, pool } = require('../config/db');

async function main() {
  console.log('Criando tabelas files / sync_ports / sync_jobs (se não existirem)...');
  await ensureSchema();
  console.log('Schema OK.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('Falha:', err.message);
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
