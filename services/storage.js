const { v4: uuidv4 } = require('uuid');

const UPLOAD_PREFIX = 'uploads/';
const THUMB_PREFIX = 'thumbs/';

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 50;
const MAX_UPLOAD_BYTES = Math.round(MAX_UPLOAD_MB * 1024 * 1024);
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

/** STORAGE=disk (padrão) ou STORAGE=r2 (Cloudflare R2 / MinIO). Portas externas são espelho, não o driver principal. */
const DRIVERS = {
  disk: () => require('./storage-disk'),
  r2: () => require('./storage-r2'),
};
const driverName = (process.env.STORAGE || 'disk').toLowerCase();
if (!DRIVERS[driverName]) {
  throw new Error(`STORAGE inválido: "${process.env.STORAGE}". Use "disk" ou "r2".`);
}
const driver = DRIVERS[driverName]();

function sanitizeFilename(name) {
  return String(name || 'arquivo')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
}

function buildStorageKey(originalName, ownerKey) {
  const safe = sanitizeFilename(originalName);
  return `${UPLOAD_PREFIX}${ownerKey}/${uuidv4()}-${safe}`;
}

function thumbKeyFor(storageKey) {
  return THUMB_PREFIX + storageKey.slice(UPLOAD_PREFIX.length).replace(/\.[^./]*$/, '') + '.jpg';
}

async function createUploadUrl({ filename, contentType, ownerKey, withThumb }) {
  const storageKey = buildStorageKey(filename, ownerKey);
  const result = {
    uploadUrl: await driver.signPut(storageKey, contentType, MAX_UPLOAD_BYTES),
    storageKey,
  };

  if (withThumb) {
    result.thumbKey = thumbKeyFor(storageKey);
    result.thumbUploadUrl = await driver.signPut(result.thumbKey, 'image/jpeg', MAX_THUMB_BYTES);
  }
  return result;
}

module.exports = {
  driver: driver.name,
  UPLOAD_PREFIX,
  MAX_UPLOAD_MB,
  MAX_UPLOAD_BYTES,
  init: driver.init,
  thumbKeyFor,
  createUploadUrl,
  buildStorageKey,
  getFileUrl: driver.getPhotoUrl,
  getPhotoUrl: driver.getPhotoUrl,
  listKeys: driver.listKeys,
  getObjectStream: driver.getObjectStream,
  exists: driver.exists,
};
