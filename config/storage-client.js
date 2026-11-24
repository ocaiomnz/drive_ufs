const { S3Client } = require('@aws-sdk/client-s3');

/**
 * Cliente S3-compatible (Cloudflare R2 em prod, MinIO no Docker local).
 * - R2: defina R2_ACCOUNT_ID (endpoint derivado) ou R2_ENDPOINT manual.
 * - MinIO: R2_ENDPOINT=http://localhost:9000 e R2_FORCE_PATH_STYLE=true
 */
function createR2Client(endpointOverride) {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  const customEndpoint = (endpointOverride || process.env.R2_ENDPOINT || '').replace(/\/$/, '');

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'Storage incompleto: defina R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY no .env'
    );
  }

  let endpoint = customEndpoint;
  if (!endpoint) {
    if (!accountId) {
      throw new Error(
        'Storage incompleto: defina R2_ENDPOINT ou R2_ACCOUNT_ID no .env'
      );
    }
    endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  }

  const forcePathStyle =
    process.env.R2_FORCE_PATH_STYLE === 'true' ||
    process.env.R2_FORCE_PATH_STYLE === '1';

  return new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint,
    forcePathStyle,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // Evita x-amz-checksum-* nas URLs presignadas (quebra PUT do browser / MinIO)
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

let client;
let serverClient;

/** Cliente para URLs assinadas: o host precisa ser o que o navegador alcança. */
function getR2Client() {
  if (!client) {
    client = createR2Client();
  }
  return client;
}

/**
 * Cliente para chamadas feitas pelo próprio servidor (listar, baixar para ZIP).
 * No Docker local o MinIO é "minio:9000" por dentro e "localhost:9000" por fora.
 */
function getR2ServerClient() {
  if (!process.env.R2_INTERNAL_ENDPOINT) return getR2Client();
  if (!serverClient) {
    serverClient = createR2Client(process.env.R2_INTERNAL_ENDPOINT);
  }
  return serverClient;
}

function getBucket() {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    throw new Error('R2_BUCKET não definido no .env');
  }
  return bucket;
}

function getPublicBaseUrl() {
  const url = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  return url || null;
}

module.exports = {
  createR2Client,
  getR2Client,
  getR2ServerClient,
  getBucket,
  getPublicBaseUrl,
};
