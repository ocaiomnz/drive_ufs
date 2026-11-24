const archiver = require('archiver');
const path = require('path');
const File = require('../models/File');
const { UPLOAD_PREFIX, listKeys, getObjectStream } = require('./storage');

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

function waitEntry(archive, res) {
  return new Promise((resolve, reject) => {
    const done = (fn) => (arg) => {
      archive.off('entry', onEntry);
      archive.off('error', onError);
      res.off('close', onClose);
      fn(arg);
    };
    const onEntry = done(resolve);
    const onError = done(reject);
    const onClose = done(resolve);
    archive.once('entry', onEntry);
    archive.once('error', onError);
    res.once('close', onClose);
  });
}

function folderName(name) {
  return String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'sem-nome';
}

async function collectEntries(ownerKey) {
  const prefix = UPLOAD_PREFIX + (ownerKey ? `${ownerKey}/` : '');
  const [bucketKeys, rows] = await Promise.all([
    listKeys(prefix),
    (ownerKey ? File.findByOwner(ownerKey) : File.findAll()).catch((err) => {
      console.warn('[zip] banco indisponível, usando só o storage:', err.message);
      return [];
    }),
  ]);

  const rowByKey = new Map(rows.map((r) => [r.storage_key, r]));
  const labels = new Map();
  [...rows]
    .sort((a, b) => a.id - b.id)
    .forEach((r) => {
      if (!labels.has(r.owner_key)) labels.set(r.owner_key, r.owner_name);
    });

  const keys = [...new Set([...rows.map((r) => r.storage_key), ...bucketKeys])];
  return keys.map((key) => {
    const parts = key.slice(UPLOAD_PREFIX.length).split('/');
    const row = rowByKey.get(key);
    const folderKey = row ? row.owner_key : parts[0];
    return {
      key,
      folder: folderName(labels.get(folderKey) || folderKey),
      base: parts[parts.length - 1].replace(UUID_PREFIX, ''),
    };
  });
}

async function sendAlbumZip(res, { ownerKey = '', zipName }) {
  const entries = await collectEntries(ownerKey);

  res.attachment(zipName);
  res.type('application/zip');

  const archive = archiver('zip', { store: true });
  let aborted = false;
  res.on('close', () => {
    if (!res.writableFinished) {
      aborted = true;
      archive.abort();
    }
  });
  archive.on('warning', (err) => console.warn('[zip]', err.message));
  archive.on('error', (err) => {
    console.error('[zip]', err);
    res.destroy(err);
  });
  archive.pipe(res);

  const used = new Set();
  for (const entry of entries) {
    if (aborted) return;

    let body;
    try {
      body = await getObjectStream(entry.key);
    } catch (err) {
      console.warn('[zip] arquivo ausente:', entry.key, err.name || err.message);
      continue;
    }

    const prefix = ownerKey ? '' : `${entry.folder}/`;
    const ext = path.extname(entry.base);
    let name = prefix + entry.base;
    for (let i = 2; used.has(name.toLowerCase()); i += 1) {
      name = `${prefix}${path.basename(entry.base, ext)} (${i})${ext}`;
    }
    used.add(name.toLowerCase());

    archive.append(body, { name });
    await waitEntry(archive, res);
  }

  if (!aborted) await archive.finalize();
}

module.exports = { sendAlbumZip };
