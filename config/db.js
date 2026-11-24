const mysql = require('mysql2/promise');
const { ownerKey } = require('../services/owner-key');

const POOL_SIZE = Number(process.env.DB_POOL_SIZE) || 10;

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: POOL_SIZE,
  maxIdle: Math.max(1, Math.floor(POOL_SIZE / 2)),
  idleTimeout: 15000,
  enableKeepAlive: true,
  namedPlaceholders: true,
});

const LOST_CONNECTION = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE']);

async function query(sql, params) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    if (!LOST_CONNECTION.has(err.code)) throw err;
    const [rows] = await pool.execute(sql, params);
    return rows;
  }
}

async function addColumnIfMissing(table, column, alterSql) {
  const [cols] = await pool.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [column]);
  if (cols.length) return;
  try {
    await pool.query(alterSql);
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS files (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_name VARCHAR(120) NOT NULL,
      owner_key VARCHAR(80) NOT NULL DEFAULT '',
      filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NULL,
      size_bytes BIGINT NULL,
      storage_key VARCHAR(512) NOT NULL UNIQUE,
      thumb_key VARCHAR(512) NULL,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_files_owner_key (owner_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await addColumnIfMissing('files', 'mime_type', 'ALTER TABLE files ADD COLUMN mime_type VARCHAR(120) NULL AFTER filename');
  await addColumnIfMissing('files', 'size_bytes', 'ALTER TABLE files ADD COLUMN size_bytes BIGINT NULL AFTER mime_type');
  await addColumnIfMissing('files', 'thumb_key', 'ALTER TABLE files ADD COLUMN thumb_key VARCHAR(512) NULL AFTER storage_key');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_ports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      provider VARCHAR(40) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      config_json JSON NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ports_enabled (enabled)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_jobs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id INT NOT NULL,
      port_id INT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      remote_id VARCHAR(512) NULL,
      error_message TEXT NULL,
      synced_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_jobs_file (file_id),
      INDEX idx_jobs_port (port_id),
      INDEX idx_jobs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [legacy] = await pool.query("SELECT id, owner_name FROM files WHERE owner_key = ''");
  for (const row of legacy) {
    await pool.query('UPDATE files SET owner_key = ? WHERE id = ?', [
      ownerKey(row.owner_name),
      row.id,
    ]);
  }
}

module.exports = { pool, query, ensureSchema };
