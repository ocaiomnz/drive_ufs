/**
 * Porta Dropbox — espelha via access token (ou refresh).
 * Config: { accessToken, folderPath? }  // folderPath padrão: /UFS Drive
 */

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function destPath(config, filename) {
  const base = (config.folderPath || '/UFS Drive').replace(/\/$/, '');
  return `${base}/${filename}`;
}

async function push({ filename, stream, config }) {
  if (!config.accessToken) throw new Error('Dropbox: accessToken obrigatório');
  const buffer = await streamToBuffer(stream);
  const path = destPath(config, filename);

  const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({
        path,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
    },
    body: buffer,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Dropbox upload: ${data.error_summary || data.error || res.status}`);
  }
  return { remoteId: data.id || data.path_display || path };
}

async function test(config) {
  if (!config.accessToken) throw new Error('Dropbox: accessToken obrigatório');
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_summary || `HTTP ${res.status}`);
  return { ok: true, user: data.email || data.name?.display_name || 'ok' };
}

module.exports = { push, test, label: 'Dropbox' };
