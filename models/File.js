const { query } = require('../config/db');

const COLUMNS = 'id, owner_name, owner_key, filename, mime_type, size_bytes, storage_key, thumb_key, uploaded_at';

async function create({
  owner_name,
  owner_key,
  filename,
  mime_type = null,
  size_bytes = null,
  storage_key,
  thumb_key = null,
}) {
  const result = await query(
    `INSERT INTO files (owner_name, owner_key, filename, mime_type, size_bytes, storage_key, thumb_key)
     VALUES (:owner_name, :owner_key, :filename, :mime_type, :size_bytes, :storage_key, :thumb_key)`,
    { owner_name, owner_key, filename, mime_type, size_bytes, storage_key, thumb_key }
  );

  return {
    id: result.insertId,
    owner_name,
    owner_key,
    filename,
    mime_type,
    size_bytes,
    storage_key,
    thumb_key,
    uploaded_at: new Date(),
  };
}

async function findAll() {
  return query(
    `SELECT ${COLUMNS}
     FROM files
     ORDER BY uploaded_at DESC, id DESC`
  );
}

async function findPage({ before, after, owner, limit }) {
  const where = [];
  const params = {};
  if (after != null) {
    where.push('id > :after');
    params.after = after;
  } else if (before != null) {
    where.push('id < :before');
    params.before = before;
  }
  if (owner) {
    where.push('owner_key = :owner');
    params.owner = owner;
  }
  const n = Math.max(1, Math.min(Number(limit) || 1, 500));
  return query(
    `SELECT ${COLUMNS}
     FROM files
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY id DESC
     LIMIT ${n}`,
    params
  );
}

async function count(owner) {
  const rows = owner
    ? await query('SELECT COUNT(*) AS n FROM files WHERE owner_key = :owner', { owner })
    : await query('SELECT COUNT(*) AS n FROM files');
  return Number(rows[0].n);
}

async function findByStorageKey(storage_key) {
  const rows = await query(
    `SELECT ${COLUMNS}
     FROM files
     WHERE storage_key = :storage_key
     LIMIT 1`,
    { storage_key }
  );
  return rows[0] || null;
}

async function findById(id) {
  const rows = await query(
    `SELECT ${COLUMNS}
     FROM files
     WHERE id = :id
     LIMIT 1`,
    { id }
  );
  return rows[0] || null;
}

async function findByOwner(owner_key) {
  return query(
    `SELECT ${COLUMNS}
     FROM files
     WHERE owner_key = :owner_key
     ORDER BY uploaded_at, id`,
    { owner_key }
  );
}

/** Uma pasta por dono: chave, nome usado no primeiro arquivo e total. */
async function findOwners() {
  return query(
    `SELECT owner_key,
            SUBSTRING_INDEX(GROUP_CONCAT(owner_name ORDER BY id SEPARATOR '\n'), '\n', 1) AS name,
            COUNT(*) AS count
     FROM files
     WHERE owner_key <> ''
     GROUP BY owner_key
     ORDER BY name`
  );
}

module.exports = {
  create,
  findAll,
  findPage,
  count,
  findByStorageKey,
  findById,
  findByOwner,
  findOwners,
};
