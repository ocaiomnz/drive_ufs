/** Hospedagem compartilhada (CloudLinux) derruba o processo ao abrir as 4 threads padrão do libuv. */
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '2';
const startupLog = require('./config/startup-log');
require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const { ensureSchema } = require('./config/db');
const storage = require('./services/storage');
const homeRoutes = require('./routes/home');
const filesApi = require('./routes/api');
const adminRoutes = require('./routes/admin');
const portsApi = require('./routes/ports');

const app = express();
const PORT = process.env.PORT || 3000;

const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
const KEEP_ALIVE_MS = 65 * 1000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.disable('x-powered-by');
if (storage.driver === 'disk') {
  app.use(require('./routes/files'));
}
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
}));

app.use(homeRoutes);
app.use(adminRoutes);
app.use('/api', filesApi);
app.use('/api/ports', portsApi);

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('[error]', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Erro interno' });
  }
  res.status(500).send('Erro interno do servidor');
});

async function prepareDatabase() {
  if (!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME)) {
    startupLog.error('MySQL: variáveis incompletas (DB_HOST, DB_USER, DB_NAME) — schema não inicializado');
    return;
  }
  try {
    await ensureSchema();
    startupLog.log('MySQL: schema verificado');
  } catch (err) {
    startupLog.error('MySQL: falha ao garantir schema —', err.code || '', err.message);
  }
}

async function start() {
  const env = process.env;
  startupLog.log(
    `Iniciando: Node ${process.version} | PORT=${env.PORT || '(vazio → 3000)'} | NODE_ENV=${env.NODE_ENV || '(vazio)'} | ` +
      `STORAGE=${storage.driver} | STORAGE_DIR=${env.STORAGE_DIR || '(padrão)'} | DB_HOST=${env.DB_HOST || '(vazio)'} | ` +
      `UPLOAD_SECRET ${env.UPLOAD_SECRET ? 'ok' : 'AUSENTE'} | ADMIN_PASSWORD ${env.ADMIN_PASSWORD ? 'ok' : 'AUSENTE'} | pasta ${__dirname}`
  );

  try {
    startupLog.log('Preparando armazenamento...');
    await storage.init();
    startupLog.log(`Armazenamento: ${storage.driver} (limite ${storage.MAX_UPLOAD_MB} MB por arquivo)`);
  } catch (err) {
    startupLog.error(`Armazenamento (${storage.driver}) indisponível —`, err.message);
    startupLog.error('Confira STORAGE_DIR (pasta com permissão de escrita) e UPLOAD_SECRET nas variáveis de ambiente.');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    startupLog.log(`UFS DRIVE rodando em ${PORT}`);
  });
  server.on('error', (err) => {
    startupLog.error(`Não foi possível escutar em ${PORT} —`, err.code || '', err.message);
    process.exit(1);
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 1000;

  await prepareDatabase();
}

start();
