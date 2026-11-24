/**
 * Porta S3 / R2 / MinIO — segundo bucket espelho (além do STORAGE principal).
 * Config: { accessKeyId, secretAccessKey, bucket, endpoint?, region?, prefix?, forcePathStyle? }
 */
const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');

function clientFrom(config) {
  if (!config.accessKeyId || !config.secretAccessKey || !config.bucket) {
    throw new Error('S3: accessKeyId, secretAccessKey e bucket são obrigatórios');
  }
  return new S3Client({
    region: config.region || 'auto',
    endpoint: config.endpoint || undefined,
    forcePathStyle: Boolean(config.forcePathStyle),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function push({ filename, mimeType, storageKey, stream, config }) {
  const client = clientFrom(config);
  const prefix = (config.prefix || '').replace(/^\/+|\/+$/g, '');
  const key = prefix
    ? `${prefix}/${storageKey || filename}`
    : (storageKey || filename);
  const body = await streamToBuffer(stream);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: mimeType || 'application/octet-stream',
  }));
  return { remoteId: key };
}

async function test(config) {
  const client = clientFrom(config);
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  return { ok: true, user: config.bucket };
}

module.exports = { push, test, label: 'S3 / R2 / MinIO' };
