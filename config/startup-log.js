const fs = require('fs');
const path = require('path');

/**
 * A hospedagem Node.js da Hostinger não mostra o log de execução: a inicialização e os
 * erros fatais também vão para logs/startup.log (abrir pelo Gerenciador de Arquivos).
 * TEMPORÁRIO: cópia em public/diagnostico.txt para ler pelo navegador; remover após o deploy.
 */
const FILES = [
  path.join(__dirname, '..', 'logs', 'startup.log'),
  path.join(__dirname, '..', 'public', 'diagnostico.txt'),
];

function write(level, args) {
  const text = args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ');
  const line = `${new Date().toISOString()} ${level} ${text}\n`;
  FILES.forEach((file) => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, line);
    } catch (_) {}
  });
}

function log(...args) {
  console.log(...args);
  write('INFO', args);
}

function error(...args) {
  console.error(...args);
  write('ERRO', args);
}

/** TEMPORÁRIO: limites do processo na hospedagem e sinais de vida nos primeiros segundos. */
function readProc(file, pattern) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((l) => pattern.test(l)).map((l) => l.replace(/\s+/g, ' ').trim()).join(' | ');
  } catch (_) {
    return '(indisponível)';
  }
}
const os = require('os');
function cgroupLimits() {
  try {
    const rel = fs.readFileSync('/proc/self/cgroup', 'utf8').trim().split('\n');
    const out = [`cgroup ${rel.join(' ; ')}`];
    rel.forEach((line) => {
      const [, controllers, p] = line.split(':');
      const bases = controllers ? controllers.split(',').map((c) => `/sys/fs/cgroup/${c}${p}`) : [`/sys/fs/cgroup${p}`];
      bases.forEach((base) => {
        ['pids.max', 'pids.current', 'memory.max', 'memory.current', 'memory.limit_in_bytes', 'memory.usage_in_bytes', 'memory.swap.max']
          .forEach((f) => {
            try {
              out.push(`${f}=${fs.readFileSync(`${base}/${f}`, 'utf8').trim()}`);
            } catch (_) {}
          });
      });
    });
    return out.join(' | ');
  } catch (_) {
    return 'cgroup (indisponível)';
  }
}
write('INFO', [cgroupLimits()]);
write('INFO', [
  `pid ${process.pid} | cpus ${os.cpus().length} | mem ${Math.round(os.totalmem() / 1048576)} MB | ` +
    `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE || '(padrão 4)'} | ` +
    readProc('/proc/self/limits', /processes|address space|open files|data size/) + ' | ' +
    readProc('/proc/self/status', /^(Threads|VmPeak|VmRSS)/),
]);
const started = Date.now();
const heartbeat = setInterval(() => {
  write('INFO', [`pid ${process.pid} vivo há ${Math.round((Date.now() - started) / 1000)} s | ${readProc('/proc/self/status', /^Threads/)}`]);
  if (Date.now() - started > 8000) clearInterval(heartbeat);
}, 1000);
heartbeat.unref();
process.on('exit', (code) => write('INFO', [`pid ${process.pid} saiu com código ${code}`]));

process.on('uncaughtException', (err) => {
  error('Erro fatal:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  error('Erro fatal (promise sem tratamento):', err);
  process.exit(1);
});

module.exports = { log, error };
