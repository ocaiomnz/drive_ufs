const express = require('express');
const File = require('../models/File');
const {
  createUploadUrl,
  getFileUrl,
  thumbKeyFor,
  exists,
  UPLOAD_PREFIX,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
} = require('../services/storage');
const { ownerKey } = require('../services/owner-key');
const { sendAlbumZip } = require('../services/album-zip');
const { mirrorFile } = require('../services/ports');

const router = express.Router();

/** Tipos aceitos no UFS DRIVE (imagens, docs, mídia, zip…). */
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
  'application/octet-stream',
]);

const OWNER_KEY_RE = /^[a-z0-9-]{1,80}$/;
const PAGE_SIZE = 48;
const MAX_PAGE = 100;
const MAX_NEW = 200;
const OWNERS_TTL_MS = 10 * 1000;
const COUNT_TTL_MS = 5 * 1000;
const countCache = new Map();
let ownersCache = { at: 0, data: null };

function cleanName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
}

function cursor(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function ownerParam(value) {
  return typeof value === 'string' && OWNER_KEY_RE.test(value) ? value : '';
}

function isImage(mime) {
  return typeof mime === 'string' && mime.startsWith('image/') && mime !== 'image/svg+xml';
}

async function toPublicFile(row) {
  const url = await getFileUrl(row.storage_key);
  return {
    id: row.id,
    owner_name: row.owner_name,
    owner_key: row.owner_key,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at,
    url,
    thumb_url: row.thumb_key ? await getFileUrl(row.thumb_key) : (isImage(row.mime_type) ? url : null),
  };
}

async function cachedCount(owner) {
  const hit = countCache.get(owner);
  if (hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.value;
  const value = await File.count(owner);
  if (countCache.size > 2000) countCache.clear();
  countCache.set(owner, { at: Date.now(), value });
  return value;
}

/**
 * POST /api/upload-url
 * Body: { filename, contentType, owner_name, thumb, size }
 */
router.post('/upload-url', async (req, res) => {
  try {
    const { filename, contentType, size } = req.body || {};
    const key = ownerKey(cleanName(req.body && req.body.owner_name));

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'filename é obrigatório' });
    }
    if (!key) {
      return res.status(400).json({ error: 'Informe seu nome antes de enviar' });
    }
    if (Number(size) > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: `Arquivo maior que ${MAX_UPLOAD_MB} MB` });
    }
    if (contentType && !ALLOWED_TYPES.has(contentType) && !contentType.startsWith('image/')) {
      return res.status(400).json({
        error: 'Tipo de arquivo não permitido.',
      });
    }

    const wantThumb = req.body.thumb === true && isImage(contentType);
    const result = await createUploadUrl({
      filename,
      contentType: contentType || 'application/octet-stream',
      ownerKey: key,
      withThumb: wantThumb,
    });

    res.json(result);
  } catch (err) {
    console.error('[upload-url]', err);
    res.status(500).json({ error: 'Não foi possível gerar URL de upload' });
  }
});

/**
 * POST /api/files
 * Body: { owner_name, storage_key, filename, mime_type?, size_bytes?, thumb_key? }
 */
router.post('/files', async (req, res) => {
  try {
    const { storage_key, filename, thumb_key, mime_type, size_bytes } = req.body || {};
    const ownerName = cleanName(req.body && req.body.owner_name);
    const key = ownerKey(ownerName);

    if (!key) {
      return res.status(400).json({ error: 'owner_name é obrigatório' });
    }
    if (!storage_key || typeof storage_key !== 'string') {
      return res.status(400).json({ error: 'storage_key é obrigatório' });
    }
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'filename é obrigatório' });
    }
    if (!storage_key.startsWith(`${UPLOAD_PREFIX}${key}/`)) {
      return res.status(400).json({ error: 'storage_key inválido' });
    }
    if (thumb_key != null && thumb_key !== thumbKeyFor(storage_key)) {
      return res.status(400).json({ error: 'thumb_key inválido' });
    }

    const existing = await File.findByStorageKey(storage_key);
    if (existing) {
      return res.status(200).json(await toPublicFile(existing));
    }

    const [stored, thumbStored] = await Promise.all([
      exists(storage_key),
      thumb_key ? exists(thumb_key) : false,
    ]);
    if (!stored) {
      return res.status(400).json({ error: 'O arquivo não chegou ao servidor, tente de novo' });
    }

    const file = await File.create({
      owner_name: ownerName,
      owner_key: key,
      filename: filename.slice(0, 255),
      mime_type: typeof mime_type === 'string' ? mime_type.slice(0, 120) : null,
      size_bytes: Number.isFinite(Number(size_bytes)) ? Number(size_bytes) : null,
      storage_key,
      thumb_key: thumbStored ? thumb_key : null,
    });
    ownersCache.at = 0;
    countCache.clear();

    // Espelha nas portas (Google Drive, etc.) sem atrasar a resposta.
    mirrorFile(file);

    res.status(201).json(await toPublicFile(file));
  } catch (err) {
    console.error('[files POST]', err);
    res.status(500).json({ error: 'Não foi possível salvar o arquivo' });
  }
});

/**
 * GET /api/files?limit=&before=&after=&owner=&count_owner=
 */
router.get('/files', async (req, res) => {
  try {
    const after = cursor(req.query.after);
    const before = cursor(req.query.before);
    const owner = ownerParam(req.query.owner || req.query.guest);
    const countOwner = ownerParam(req.query.count_owner || req.query.count_guest);
    const limit = after != null
      ? MAX_NEW
      : Math.min(cursor(req.query.limit) || PAGE_SIZE, MAX_PAGE);

    const [rows, total, ownerTotal] = await Promise.all([
      File.findPage({ after, before, owner, limit: limit + 1 }),
      cachedCount(owner),
      countOwner ? cachedCount(countOwner) : null,
    ]);

    const page = rows.slice(0, limit);
    const files = await Promise.all(page.map(toPublicFile));
    const body = {
      files,
      total,
      has_more: rows.length > limit,
    };
    if (ownerTotal != null) body.owner_total = ownerTotal;
    res.json(body);
  } catch (err) {
    console.error('[files GET]', err);
    res.status(500).json({ error: 'Não foi possível listar os arquivos' });
  }
});

/**
 * GET /api/owners — pastas existentes
 */
router.get('/owners', async (req, res) => {
  try {
    if (!ownersCache.data || Date.now() - ownersCache.at > OWNERS_TTL_MS) {
      const rows = await File.findOwners();
      ownersCache = {
        at: Date.now(),
        data: rows.map((r) => ({ key: r.owner_key, name: r.name, count: Number(r.count) })),
      };
    }
    res.json({ owners: ownersCache.data });
  } catch (err) {
    console.error('[owners GET]', err);
    res.status(500).json({ error: 'Não foi possível listar as pastas' });
  }
});

/**
 * GET /api/folders/:key/download — ZIP de uma pasta
 */
router.get('/folders/:key/download', async (req, res, next) => {
  const { key } = req.params;
  if (!OWNER_KEY_RE.test(key)) return res.status(404).json({ error: 'Pasta não encontrada' });
  try {
    await sendAlbumZip(res, { ownerKey: key, zipName: `ufs-drive-${key}.zip` });
  } catch (err) {
    if (!res.headersSent) return next(err);
    console.error('[folder zip]', err);
    res.destroy(err);
  }
});

module.exports = router;
