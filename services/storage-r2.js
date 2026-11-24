const {
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  getR2Client,
  getR2ServerClient,
  getBucket,
  getPublicBaseUrl,
} = require('../config/storage-client');

const PUT_EXPIRES_IN = 60 * 5; // 5 minutos

/**
 * Leitura assinada em janelas fixas: dentro da mesma janela a URL de uma foto é sempre
 * a mesma (o navegador reaproveita o cache) e continua válida por pelo menos 6h.
 */
const GET_WINDOW_MS = 6 * 60 * 60 * 1000;
const GET_EXPIRES_IN = 12 * 60 * 60;
const signedCache = { window: 0, urls: new Map() };

function init() {
  getBucket();
  getR2Client();
}

/** O R2 não limita o tamanho pela URL assinada: o limite é conferido no pedido da URL. */
function signPut(key, contentType) {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: PUT_EXPIRES_IN });
}

/** URL pública (se R2_PUBLIC_URL) ou presigned GET. */
async function getPhotoUrl(storageKey) {
  const publicBase = getPublicBaseUrl();
  if (publicBase) {
    return `${publicBase}/${storageKey}`;
  }

  const windowStart = Math.floor(Date.now() / GET_WINDOW_MS) * GET_WINDOW_MS;
  if (signedCache.window !== windowStart) {
    signedCache.window = windowStart;
    signedCache.urls.clear();
  }
  const cached = signedCache.urls.get(storageKey);
  if (cached) return cached;

  const command = new GetObjectCommand({ Bucket: getBucket(), Key: storageKey });
  const url = await getSignedUrl(getR2Client(), command, {
    expiresIn: GET_EXPIRES_IN,
    signingDate: new Date(windowStart),
  });
  signedCache.urls.set(storageKey, url);
  return url;
}

/** Lista todas as chaves do bucket sob um prefixo (paginando). */
async function listKeys(prefix) {
  const client = getR2ServerClient();
  const bucket = getBucket();
  const keys = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    (page.Contents || []).forEach((obj) => {
      if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
    });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function getObjectStream(storageKey) {
  const { Body } = await getR2ServerClient().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: storageKey })
  );
  return Body;
}

async function exists(storageKey) {
  try {
    await getR2ServerClient().send(new HeadObjectCommand({ Bucket: getBucket(), Key: storageKey }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || (err.$metadata && err.$metadata.httpStatusCode === 404)) return false;
    throw err;
  }
}

module.exports = {
  name: 'r2',
  init,
  signPut,
  getPhotoUrl,
  listKeys,
  getObjectStream,
  exists,
};
