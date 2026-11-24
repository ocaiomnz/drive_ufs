/**
 * Orquestra espelhamento mútuo: cada arquivo salvo no disco/R2 do provedor
 * também é enviado às portas habilitadas (Google Drive, Dropbox, S3, webhook).
 */
const Port = require('../../models/Port');
const { getObjectStream } = require('../storage');

const PROVIDERS = {
  gdrive: () => require('./gdrive'),
  dropbox: () => require('./dropbox'),
  s3: () => require('./s3'),
  webhook: () => require('./webhook'),
};

function providerOf(name) {
  const factory = PROVIDERS[name];
  if (!factory) throw new Error(`Provedor desconhecido: ${name}`);
  return factory();
}

function providerLabels() {
  return Object.keys(PROVIDERS).map((key) => ({
    id: key,
    label: providerOf(key).label,
  }));
}

/**
 * Espelha um arquivo já confirmado no storage principal para todas as portas ativas.
 * Não bloqueia a resposta HTTP — roda em background.
 */
function mirrorFile(file) {
  setImmediate(() => {
    runMirror(file).catch((err) => console.error('[ports] mirror falhou:', err.message));
  });
}

async function runMirror(file) {
  const ports = await Port.findEnabled();
  if (!ports.length) return;

  for (const port of ports) {
    const jobId = await Port.createJob({ file_id: file.id, port_id: port.id });
    try {
      const driver = providerOf(port.provider);
      const stream = await getObjectStream(file.storage_key);
      const result = await driver.push({
        filename: file.filename,
        mimeType: file.mime_type,
        storageKey: file.storage_key,
        stream,
        config: port.config,
      });
      await Port.finishJob(jobId, {
        status: 'ok',
        remote_id: result.remoteId || null,
      });
      console.log(`[ports] ${port.provider}#${port.id} ← ${file.filename} (${result.remoteId || 'ok'})`);
    } catch (err) {
      console.error(`[ports] ${port.provider}#${port.id} erro:`, err.message);
      await Port.finishJob(jobId, {
        status: 'error',
        error_message: String(err.message || err).slice(0, 1000),
      });
    }
  }
}

async function testPort(port) {
  const driver = providerOf(port.provider);
  if (!driver.test) return { ok: true, note: 'sem teste' };
  return driver.test(port.config);
}

module.exports = {
  PROVIDERS: Object.keys(PROVIDERS),
  providerLabels,
  providerOf,
  mirrorFile,
  testPort,
};
