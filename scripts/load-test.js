/**
 * Teste de carga do UFS DRIVE.
 *
 * Uso: npm run test:carga -- <url> [cenário] [--opção=valor ...]
 *   navegacao  clientes listando o drive
 *   envios     uploads pelo fluxo completo
 *   festa      envios + navegação ao mesmo tempo (padrão)
 *   zip        admin: abre /admin e baixa o ZIP (precisa de --senha)
 *
 * Opções:
 *   --usuarios=500     pastas diferentes entre os envios
 *   --arquivos=1000    total de arquivos enviados
 *   --simultaneos=50   envios em paralelo
 *   --kbps=0           velocidade de envio em kbit/s (0 = sem limite)
 *   --conexoes=400     clientes navegando
 *   --rps=0            limite de req/s da navegação
 *   --duracao=30       segundos (cenário navegacao)
 *   --senha=           ADMIN_PASSWORD, para o cenário zip
 *
 * Limpeza:
 *   DELETE FROM files WHERE owner_key LIKE 'carga-teste-%';
 *   rm -rf <STORAGE_DIR>/uploads/carga-teste-* <STORAGE_DIR>/thumbs/carga-teste-*
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const autocannon = require('autocannon');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const opts = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.join('=')];
  })
);
const num = (key, fallback) => (opts[key] ? Number(opts[key]) : fallback);

const base = (positional[0] || 'http://localhost:3000').replace(/\/$/, '');
const scenario = positional[1] || 'festa';
const MB = 1024 * 1024;
const json = { 'content-type': 'application/json' };
const agents = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
};

const SIZE_MIX = [[1.5, 10], [2.5, 20], [3.5, 25], [5, 20], [7, 12], [10, 8], [14.5, 5]];
let bodies;
const thumbBody = crypto.randomBytes(60 * 1024);

function pickBody() {
  if (!bodies) bodies = SIZE_MIX.map(([mb, weight]) => ({ weight, buf: crypto.randomBytes(Math.round(mb * MB)) }));
  let r = Math.random() * 100;
  for (const b of bodies) {
    r -= b.weight;
    if (r <= 0) return b.buf;
  }
  return bodies[bodies.length - 1].buf;
}

function stats(list) {
  const s = [...list].sort((a, b) => a - b);
  const at = (q) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]) : 0);
  const avg = s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0;
  return `média ${avg} ms | p50 ${at(0.5)} ms | p95 ${at(0.95)} ms | p99 ${at(0.99)} ms | máx ${at(1)} ms`;
}

async function postJson(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status} ${data.error || ''}`.trim());
  return data;
}

function put(url, body, contentType, bytesPerSec) {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'PUT',
      agent: agents[url.protocol],
      headers: { 'content-type': contentType, 'content-length': body.length },
    }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode < 300 ? resolve() : reject(new Error(`PUT ${res.statusCode}`))));
    });
    req.on('error', (err) => reject(new Error(`PUT ${err.code || err.message}`)));
    if (!bytesPerSec) return req.end(body);

    const chunk = 16 * 1024;
    let offset = 0;
    const tick = () => {
      const end = Math.min(offset + chunk, body.length);
      req.write(body.subarray(offset, end));
      offset = end;
      if (offset >= body.length) req.end();
      else setTimeout(tick, (chunk / bytesPerSec) * 1000);
    };
    tick();
  });
}

async function runUploads() {
  const total = num('arquivos', num('fotos', 1000));
  const parallel = num('simultaneos', 50);
  const users = num('usuarios', num('convidados', 500));
  const bytesPerSec = (num('kbps', 0) * 1000) / 8;
  const times = [];
  const errors = new Map();
  let bytes = 0;
  let next = 0;
  const t0 = performance.now();

  const progress = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    console.log(`  envios: ${times.length}/${total} em ${s.toFixed(0)} s (${(bytes / MB / s).toFixed(1)} MB/s)`);
  }, 10000);

  async function worker() {
    while (next < total) {
      const n = next++;
      const body = pickBody();
      const owner = `Carga Teste ${1 + crypto.randomInt(users)}`;
      const filename = `IMG_${n}.jpg`;
      const start = performance.now();
      try {
        const up = await postJson('/api/upload-url', {
          filename,
          contentType: 'image/jpeg',
          owner_name: owner,
          thumb: true,
          size: body.length,
        });
        await put(new URL(up.uploadUrl, base), body, 'image/jpeg', bytesPerSec);
        await put(new URL(up.thumbUploadUrl, base), thumbBody, 'image/jpeg', bytesPerSec);
        await postJson('/api/files', {
          owner_name: owner,
          storage_key: up.storageKey,
          filename,
          mime_type: 'image/jpeg',
          size_bytes: body.length,
          thumb_key: up.thumbKey,
        });
        times.push(performance.now() - start);
        bytes += body.length;
      } catch (err) {
        const key = err.message.slice(0, 100);
        errors.set(key, (errors.get(key) || 0) + 1);
      }
    }
  }

  await Promise.all(Array.from({ length: parallel }, worker));
  clearInterval(progress);

  const secs = (performance.now() - t0) / 1000;
  const failed = [...errors.values()].reduce((a, b) => a + b, 0);
  console.log(`\nENVIOS — ${parallel} simultâneos${bytesPerSec ? `, ${num('kbps', 0)} kbit/s cada` : ''}`);
  console.log(`  ${times.length} ok, ${failed} falhas, ${(bytes / MB / 1024).toFixed(2)} GB em ${secs.toFixed(1)} s`);
  console.log(`  ${(times.length / secs).toFixed(1)} arq/s | ${(bytes / MB / secs).toFixed(1)} MB/s`);
  console.log(`  tempo por arquivo: ${stats(times)}`);
  errors.forEach((count, msg) => console.log(`  erro ×${count}: ${msg}`));
  return { ok: times.length, failed };
}

function cannon(options, stopWhen) {
  return new Promise((resolve, reject) => {
    const instance = autocannon(options, (err, result) => (err ? reject(err) : resolve(result)));
    if (stopWhen) stopWhen.finally(() => instance.stop()).catch(() => {});
  });
}

async function runBrowsing(stopWhen) {
  const connections = num('conexoes', 400);
  const rate = num('rps', 0);
  const first = await (await fetch(`${base}/api/files?limit=48`)).json();
  const rows = first.files || [];
  const since = rows.length ? rows[0].id : 0;
  const thumbs = rows
    .map((p) => p.thumb_url)
    .filter((u) => u && u.startsWith('/'))
    .slice(0, 8);

  const r = await cannon({
    url: base,
    connections,
    overallRate: rate || undefined,
    duration: stopWhen ? 24 * 3600 : num('duracao', 30),
    requests: [
      { method: 'GET', path: '/drive' },
      { method: 'GET', path: '/api/files?limit=48&count_owner=carga-teste-1' },
      { method: 'GET', path: '/api/owners' },
      ...thumbs.map((path) => ({ method: 'GET', path })),
      { method: 'GET', path: `/api/files?after=${since}&count_owner=carga-teste-1` },
    ],
  }, stopWhen);

  console.log(`\nNAVEGAÇÃO — ${connections} clientes${rate ? `, ${rate} req/s` : ', máximo'}`);
  console.log(
    `  ${Math.round(r.requests.average)} req/s | média ${Math.round(r.latency.average)} ms | ` +
      `p99 ${Math.round(r.latency.p99)} ms | máx ${Math.round(r.latency.max)} ms | ` +
      `${(r.throughput.average / MB).toFixed(1)} MB/s`
  );
  console.log(`  erros ${r.errors} | timeouts ${r.timeouts} | não-2xx ${r.non2xx} | total ${r.requests.total} req`);
  return r;
}

async function runZip() {
  if (!opts.senha) throw new Error('Informe --senha=<ADMIN_PASSWORD>');
  const login = await fetch(`${base}/admin/entrar`, {
    method: 'POST',
    body: new URLSearchParams({ password: opts.senha }),
    redirect: 'manual',
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (login.status !== 302 || !cookie) throw new Error(`Login admin falhou (${login.status})`);

  let t = performance.now();
  const page = await fetch(`${base}/admin`, { headers: { cookie } });
  const html = await page.text();
  console.log(`\n/admin: ${page.status} em ${Math.round(performance.now() - t)} ms, ${(html.length / 1024).toFixed(0)} KB`);

  t = performance.now();
  const zip = await fetch(`${base}/admin/baixar`, { headers: { cookie } });
  let bytes = 0;
  for await (const chunk of zip.body) bytes += chunk.length;
  const secs = (performance.now() - t) / 1000;
  console.log(`ZIP: ${zip.status}, ${(bytes / MB / 1024).toFixed(2)} GB em ${secs.toFixed(1)} s (${(bytes / MB / secs).toFixed(0)} MB/s)`);
}

async function main() {
  console.log(`Alvo: ${base} — cenário: ${scenario}`);
  if (scenario === 'navegacao') return runBrowsing();
  if (scenario === 'envios') return runUploads();
  if (scenario === 'zip') return runZip();
  if (scenario === 'festa') {
    const uploads = runUploads();
    await Promise.all([uploads, runBrowsing(uploads)]);
    return;
  }
  throw new Error(`Cenário desconhecido: ${scenario}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
