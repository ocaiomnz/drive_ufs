const express = require('express');
const File = require('../models/File');
const Port = require('../models/Port');
const { getFileUrl } = require('../services/storage');
const { sendAlbumZip } = require('../services/album-zip');
const { appLocals } = require('./home');
const { providerLabels } = require('../services/ports');
const {
  isAdmin,
  checkPassword,
  setAdminCookie,
  clearAdminCookie,
  requireAdmin,
} = require('../middleware/admin-auth');

const router = express.Router();

router.get('/admin', async (req, res, next) => {
  const base = {
    ...appLocals(),
    configured: Boolean(process.env.ADMIN_PASSWORD),
    providers: providerLabels(),
  };
  if (!isAdmin(req)) {
    return res.render('admin', { ...base, authorized: false, error: '' });
  }

  try {
    const [rows, ports, jobs] = await Promise.all([
      File.findAll(),
      Port.findAll(),
      Port.recentJobs(30),
    ]);

    const folders = new Map();
    for (const row of rows) {
      if (!folders.has(row.owner_key)) {
        folders.set(row.owner_key, {
          key: row.owner_key,
          name: row.owner_name,
          firstId: row.id,
          files: [],
        });
      }
      const folder = folders.get(row.owner_key);
      if (row.id < folder.firstId) {
        folder.firstId = row.id;
        folder.name = row.owner_name;
      }
      const uploadedAt = new Date(row.uploaded_at);
      folder.files.push({
        id: row.id,
        owner_name: row.owner_name,
        filename: row.filename,
        mime_type: row.mime_type,
        uploaded_at: uploadedAt.toISOString(),
        uploaded_label: uploadedAt.toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/Sao_Paulo',
        }),
        url: await getFileUrl(row.storage_key),
        thumb_url: row.thumb_key ? await getFileUrl(row.thumb_key) : null,
      });
    }

    const list = [...folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    res.render('admin', {
      ...base,
      authorized: true,
      folders: list,
      total: rows.length,
      ports: ports.map(Port.publicPort),
      jobs,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/entrar', (req, res) => {
  if (!checkPassword(req.body && req.body.password)) {
    return res.status(401).render('admin', {
      ...appLocals(),
      configured: Boolean(process.env.ADMIN_PASSWORD),
      authorized: false,
      providers: providerLabels(),
      error: 'Senha incorreta.',
    });
  }
  setAdminCookie(res);
  res.redirect('/admin');
});

router.post('/admin/sair', (req, res) => {
  clearAdminCookie(res);
  res.redirect('/admin');
});

router.get('/admin/baixar', requireAdmin, async (req, res, next) => {
  try {
    await sendAlbumZip(res, { zipName: 'ufs-drive-completo.zip' });
  } catch (err) {
    if (!res.headersSent) return next(err);
    console.error('[zip todos]', err);
    res.destroy(err);
  }
});

/** Redirect legado */
router.get('/noivos', (req, res) => res.redirect(301, '/admin'));

module.exports = router;
