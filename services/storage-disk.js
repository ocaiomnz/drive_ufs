const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const fsp = fs.promises;

/**
 * Arquivos no disco do servidor: <STORAGE_DIR>/uploads/<dono>/... e <STORAGE_DIR>/thumbs/...
 * O envio imita a URL assinada do R2: PUT /api/files/<chave>?ct=&max=&exp=&sig= (HMAC com
 * UPLOAD_SECRET), então o navegador faz o mesmo PUT nos dois casos.
 */
const ROOT = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..', 'storage'));
const INCOMING = path.join(ROOT, '.incoming');
const MEDIA_PATH = '/media/';
const FOLDERS = ['uploads', 'thumbs'];

/** Atrás do nginx o corpo chega inteiro só no fim do envio: no 4G ruim isso passa de minutos. */
const PUT_EXPIRES_IN = 60 * 60;
const STALE_PART_MS = 6 * 60 * 60 * 1000;
const KEY_RE = /^(uploads|thumbs)\/[a-z0-9-]{1,80}\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,130}$/;

class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function secret() {
  const value = process.env.UPLOAD_SECRET;
  if (!value) {
    throw new Error('UPLOAD_SECRET não definido no .env (gere com: openssl rand -hex 32)');
  }
  return value;
}

function signature(key, contentType, maxBytes, exp) {
  return crypto
    .createHmac('sha256', secret())
    .update([key, contentType, maxBytes, exp].join('\n'))
    .digest('hex');
}

function resolveKey(key) {
  const full = path.resolve(ROOT, String(key));
  if (!KEY_RE.test(key) || !full.startsWith(ROOT + path.sep)) {
    throw new UploadError(400, 'Chave de arquivo inválida');
  }
  return full;
}

async function removeStaleParts() {
  const names = await fsp.readdir(INCOMING).catch(() => []);
  await Promise.all(names.map(async (name) => {
    const file = path.join(INCOMING, name);
    const stat = await fsp.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > STALE_PART_MS) await fsp.unlink(file).catch(() => {});
  }));
}

async function init() {
  secret();
  await fsp.mkdir(INCOMING, { recursive: true });
  await Promise.all(FOLDERS.map((f) => fsp.mkdir(path.join(ROOT, f), { recursive: true })));
  await fsp.access(ROOT, fs.constants.W_OK);
  await removeStaleParts();
}

function signPut(key, contentType, maxBytes) {
  resolveKey(key);
  const exp = Math.floor(Date.now() / 1000) + PUT_EXPIRES_IN;
  const query = new URLSearchParams({
    ct: contentType,
    max: String(maxBytes),
    exp: String(exp),
    sig: signature(key, contentType, maxBytes, exp),
  });
  return `/api/files/${key}?${query}`;
}

function checkSignature(key, query) {
  const { ct, max, exp, sig } = query;
  if (![ct, max, exp, sig].every((v) => typeof v === 'string' && v)) {
    throw new UploadError(403, 'Link de envio inválido');
  }
  if (Number(exp) * 1000 < Date.now()) {
    throw new UploadError(403, 'Link de envio expirado, tente de novo');
  }
  const expected = Buffer.from(signature(key, ct, max, exp));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new UploadError(403, 'Link de envio inválido');
  }
  return { contentType: ct, maxBytes: Number(max) };
}

/** Grava o PUT em .incoming e só move para o lugar final quando o arquivo chegou inteiro. */
async function receiveUpload(req, key) {
  const target = resolveKey(key);
  const { contentType, maxBytes } = checkSignature(key, req.query);

  const sent = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (sent !== contentType) {
    throw new UploadError(400, 'Tipo de arquivo diferente do informado');
  }
  const declared = Number(req.get('content-length')) || 0;
  if (declared > maxBytes) {
    throw new UploadError(413, 'Arquivo maior que o limite');
  }

  const tmp = path.join(INCOMING, `${crypto.randomUUID()}.part`);
  let size = 0;
  const limit = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) return callback(new UploadError(413, 'Arquivo maior que o limite'));
      callback(null, chunk);
    },
  });

  try {
    await pipeline(req, limit, fs.createWriteStream(tmp, { flags: 'wx' }));
    if (!size) throw new UploadError(400, 'Arquivo vazio');
    if (!req.complete || (declared && size !== declared)) {
      throw new UploadError(400, 'Envio incompleto, tente de novo');
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  return size;
}

async function getPhotoUrl(storageKey) {
  return MEDIA_PATH + storageKey;
}

async function listKeys(prefix) {
  const keys = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) keys.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  }
  await walk(path.join(ROOT, prefix));
  return keys;
}

async function getObjectStream(storageKey) {
  const handle = await fsp.open(resolveKey(storageKey), 'r');
  return handle.createReadStream();
}

async function exists(storageKey) {
  try {
    return (await fsp.stat(resolveKey(storageKey))).isFile();
  } catch (_) {
    return false;
  }
}

module.exports = {
  name: 'disk',
  ROOT,
  FOLDERS,
  init,
  signPut,
  receiveUpload,
  getPhotoUrl,
  listKeys,
  getObjectStream,
  exists,
};
