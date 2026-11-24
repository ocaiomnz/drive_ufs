/**
 * Porta Google Drive — espelha arquivos via OAuth refresh token ou service account.
 * Config esperada:
 * {
 *   clientId, clientSecret, refreshToken,   // OAuth instalado
 *   // OU
 *   serviceAccountJson,                     // JSON string da service account
 *   folderId?                               // pasta destino (padrão: root)
 * }
 */
const crypto = require('crypto');

async function getAccessToken(config) {
  if (config.serviceAccountJson) {
    const sa = typeof config.serviceAccountJson === 'string'
      ? JSON.parse(config.serviceAccountJson)
      : config.serviceAccountJson;
    return serviceAccountToken(sa);
  }

  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error('Google Drive: informe refreshToken+clientId+clientSecret ou serviceAccountJson');
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function serviceAccountToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const jwt = `${unsigned}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google SA token: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Envia o arquivo para o Drive (multipart upload).
 * @returns {{ remoteId: string }}
 */
async function push({ filename, mimeType, stream, config }) {
  const token = await getAccessToken(config);
  const buffer = await streamToBuffer(stream);
  const metadata = {
    name: filename,
    parents: config.folderId ? [config.folderId] : undefined,
  };

  const boundary = `ufs_${crypto.randomBytes(8).toString('hex')}`;
  const metaPart = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType || 'application/octet-stream'}`,
    '',
  ].join('\r\n');
  const end = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(metaPart, 'utf8'),
    buffer,
    Buffer.from(end, 'utf8'),
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google Drive upload: ${data.error?.message || res.status}`);
  }
  return { remoteId: data.id, link: data.webViewLink || null };
}

async function test(config) {
  const token = await getAccessToken(config);
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return { ok: true, user: data.user?.emailAddress || data.user?.displayName || 'ok' };
}

module.exports = { push, test, label: 'Google Drive' };
