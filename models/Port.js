const { query } = require('../config/db');

const PROVIDERS = new Set(['gdrive', 'dropbox', 's3', 'webhook']);

function parseRow(row) {
  if (!row) return null;
  let config = row.config_json;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (_) {
      config = {};
    }
  }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    enabled: Boolean(row.enabled),
    config,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Config sem segredos — para listagens na UI. */
function publicPort(row) {
  const port = parseRow(row);
  if (!port) return null;
  const { config } = port;
  const safe = {};
  if (config.folderId) safe.folderId = config.folderId;
  if (config.folderPath) safe.folderPath = config.folderPath;
  if (config.bucket) safe.bucket = config.bucket;
  if (config.prefix) safe.prefix = config.prefix;
  if (config.url) safe.url = String(config.url).replace(/([?&](token|key|secret)=)[^&]*/gi, '$1***');
  if (config.clientEmail) safe.clientEmail = config.clientEmail;
  if (config.hasRefreshToken || config.refreshToken) safe.hasRefreshToken = true;
  if (config.hasAccessToken || config.accessToken) safe.hasAccessToken = true;
  if (config.hasServiceAccount || config.serviceAccountJson) safe.hasServiceAccount = true;
  return { ...port, config: safe };
}

async function findAll() {
  const rows = await query(
    `SELECT id, name, provider, enabled, config_json, created_at, updated_at
     FROM sync_ports
     ORDER BY name`
  );
  return rows.map(parseRow);
}

async function findEnabled() {
  const rows = await query(
    `SELECT id, name, provider, enabled, config_json, created_at, updated_at
     FROM sync_ports
     WHERE enabled = 1
     ORDER BY id`
  );
  return rows.map(parseRow);
}

async function findById(id) {
  const rows = await query(
    `SELECT id, name, provider, enabled, config_json, created_at, updated_at
     FROM sync_ports
     WHERE id = :id
     LIMIT 1`,
    { id }
  );
  return parseRow(rows[0]);
}

async function create({ name, provider, enabled = true, config }) {
  if (!PROVIDERS.has(provider)) {
    throw Object.assign(new Error(`Provedor inválido: ${provider}`), { status: 400 });
  }
  const result = await query(
    `INSERT INTO sync_ports (name, provider, enabled, config_json)
     VALUES (:name, :provider, :enabled, :config_json)`,
    {
      name: String(name).slice(0, 120),
      provider,
      enabled: enabled ? 1 : 0,
      config_json: JSON.stringify(config || {}),
    }
  );
  return findById(result.insertId);
}

async function update(id, { name, enabled, config }) {
  const current = await findById(id);
  if (!current) return null;

  const nextConfig = config != null
    ? { ...current.config, ...config }
    : current.config;

  await query(
    `UPDATE sync_ports
     SET name = :name,
         enabled = :enabled,
         config_json = :config_json
     WHERE id = :id`,
    {
      id,
      name: String(name != null ? name : current.name).slice(0, 120),
      enabled: (enabled != null ? enabled : current.enabled) ? 1 : 0,
      config_json: JSON.stringify(nextConfig),
    }
  );
  return findById(id);
}

async function remove(id) {
  await query('DELETE FROM sync_jobs WHERE port_id = :id', { id });
  const result = await query('DELETE FROM sync_ports WHERE id = :id', { id });
  return result.affectedRows > 0;
}

async function createJob({ file_id, port_id }) {
  const result = await query(
    `INSERT INTO sync_jobs (file_id, port_id, status)
     VALUES (:file_id, :port_id, 'pending')`,
    { file_id, port_id }
  );
  return result.insertId;
}

async function finishJob(id, { status, remote_id = null, error_message = null }) {
  await query(
    `UPDATE sync_jobs
     SET status = :status,
         remote_id = :remote_id,
         error_message = :error_message,
         synced_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    { id, status, remote_id, error_message }
  );
}

async function jobsForFile(file_id) {
  return query(
    `SELECT j.id, j.file_id, j.port_id, j.status, j.remote_id, j.error_message, j.synced_at,
            p.name AS port_name, p.provider
     FROM sync_jobs j
     JOIN sync_ports p ON p.id = j.port_id
     WHERE j.file_id = :file_id
     ORDER BY j.id DESC`,
    { file_id }
  );
}

async function recentJobs(limit = 50) {
  const n = Math.max(1, Math.min(Number(limit) || 50, 200));
  return query(
    `SELECT j.id, j.file_id, j.port_id, j.status, j.remote_id, j.error_message, j.synced_at, j.created_at,
            p.name AS port_name, p.provider,
            f.filename
     FROM sync_jobs j
     JOIN sync_ports p ON p.id = j.port_id
     LEFT JOIN files f ON f.id = j.file_id
     ORDER BY j.id DESC
     LIMIT ${n}`
  );
}

module.exports = {
  PROVIDERS,
  publicPort,
  findAll,
  findEnabled,
  findById,
  create,
  update,
  remove,
  createJob,
  finishJob,
  jobsForFile,
  recentJobs,
};
