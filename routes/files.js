const path = require('path');
const express = require('express');
const disk = require('../services/storage-disk');

/** Só com STORAGE=disk. Em produção o nginx serve /media direto do disco (deploy/nginx.example.conf). */
const router = express.Router();

const mediaOptions = { maxAge: '365d', immutable: true, index: false, dotfiles: 'deny' };
disk.FOLDERS.forEach((folder) => {
  router.use(`/media/${folder}`, express.static(path.join(disk.ROOT, folder), mediaOptions));
});

/**
 * PUT /api/files/<chave>?ct=&max=&exp=&sig=
 * Corpo: o arquivo, com o Content-Type assinado.
 */
router.put('/api/files/*', async (req, res) => {
  try {
    await disk.receiveUpload(req, req.params[0]);
    res.status(200).end();
  } catch (err) {
    if (!err.status) {
      if (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
        console.warn(`[upload] envio interrompido pelo celular (${err.code}):`, req.params[0]);
        return;
      }
      console.error('[upload]', req.params[0], err);
    } else {
      console.warn(`[upload] recusado (${err.status} ${err.message}):`, req.params[0]);
    }
    if (res.headersSent || res.destroyed) return;
    res.set('Connection', 'close');
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível salvar o arquivo' });
  }
});

module.exports = router;
