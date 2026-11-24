const express = require('express');
const Port = require('../models/Port');
const { isAdmin } = require('../middleware/admin-auth');
const { providerLabels, testPort } = require('../services/ports');

const router = express.Router();

router.use((req, res, next) => {
  if (isAdmin(req)) return next();
  return res.status(401).json({ error: 'Faça login em /admin' });
});

/** GET /api/ports — lista portas (sem segredos) + provedores disponíveis */
router.get('/', async (req, res) => {
  try {
    const ports = await Port.findAll();
    res.json({
      providers: providerLabels(),
      ports: ports.map(Port.publicPort),
    });
  } catch (err) {
    console.error('[ports GET]', err);
    res.status(500).json({ error: 'Não foi possível listar as portas' });
  }
});

/** GET /api/ports/jobs — histórico recente de sync */
router.get('/jobs', async (req, res) => {
  try {
    const jobs = await Port.recentJobs(Number(req.query.limit) || 50);
    res.json({ jobs });
  } catch (err) {
    console.error('[ports jobs]', err);
    res.status(500).json({ error: 'Não foi possível listar os jobs' });
  }
});

/**
 * POST /api/ports
 * Body: { name, provider, enabled?, config }
 */
router.post('/', async (req, res) => {
  try {
    const { name, provider, enabled, config } = req.body || {};
    if (!name || !provider) {
      return res.status(400).json({ error: 'name e provider são obrigatórios' });
    }
    if (!Port.PROVIDERS.has(provider)) {
      return res.status(400).json({
        error: `provider inválido. Use: ${[...Port.PROVIDERS].join(', ')}`,
      });
    }
    const port = await Port.create({ name, provider, enabled, config: config || {} });
    res.status(201).json(Port.publicPort(port));
  } catch (err) {
    console.error('[ports POST]', err);
    res.status(err.status || 500).json({ error: err.message || 'Não foi possível criar a porta' });
  }
});

/** PATCH /api/ports/:id */
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'id inválido' });
    const port = await Port.update(id, req.body || {});
    if (!port) return res.status(404).json({ error: 'Porta não encontrada' });
    res.json(Port.publicPort(port));
  } catch (err) {
    console.error('[ports PATCH]', err);
    res.status(500).json({ error: 'Não foi possível atualizar a porta' });
  }
});

/** DELETE /api/ports/:id */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const ok = await Port.remove(id);
    if (!ok) return res.status(404).json({ error: 'Porta não encontrada' });
    res.status(204).end();
  } catch (err) {
    console.error('[ports DELETE]', err);
    res.status(500).json({ error: 'Não foi possível remover a porta' });
  }
});

/** POST /api/ports/:id/test — valida credenciais */
router.post('/:id/test', async (req, res) => {
  try {
    const port = await Port.findById(Number(req.params.id));
    if (!port) return res.status(404).json({ error: 'Porta não encontrada' });
    const result = await testPort(port);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Falha no teste' });
  }
});

module.exports = router;
