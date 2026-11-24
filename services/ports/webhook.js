/**
 * Porta webhook genérica — POST multipart com o arquivo para qualquer serviço compatível.
 * Config: { url, headers?, fieldName? }
 */

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function push({ filename, mimeType, stream, config }) {
  if (!config.url) throw new Error('Webhook: url obrigatória');
  const buffer = await streamToBuffer(stream);
  const field = config.fieldName || 'file';
  const boundary = `----ufs${Date.now()}`;
  const head = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="${field}"; filename="${filename.replace(/"/g, '')}"`,
    `Content-Type: ${mimeType || 'application/octet-stream'}`,
    '',
  ].join('\r\n');
  const body = Buffer.concat([
    Buffer.from(`${head}\r\n`, 'utf8'),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  ]);

  const headers = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': String(body.length),
    ...(config.headers || {}),
  };

  const res = await fetch(config.url, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${text.slice(0, 200)}`);
  let remoteId = null;
  try {
    const json = JSON.parse(text);
    remoteId = json.id || json.fileId || json.path || null;
  } catch (_) {
    remoteId = text.slice(0, 120) || 'ok';
  }
  return { remoteId: String(remoteId) };
}

async function test(config) {
  if (!config.url) throw new Error('Webhook: url obrigatória');
  const res = await fetch(config.url, {
    method: 'OPTIONS',
    headers: config.headers || {},
  }).catch(() => null);
  return { ok: true, user: config.url, note: res ? `HTTP ${res.status}` : 'URL registrada' };
}

module.exports = { push, test, label: 'Webhook' };
