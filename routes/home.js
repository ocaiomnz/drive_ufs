const express = require('express');
const { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } = require('../services/storage');

const router = express.Router();

function appLocals() {
  return {
    appName: process.env.APP_NAME || 'UFS DRIVE',
    appTagline: process.env.APP_TAGLINE || 'Seus arquivos no provedor — e nas portas que você conectar.',
  };
}

router.get('/', (req, res) => {
  res.render('home', appLocals());
});

router.get('/drive', (req, res) => {
  res.render('drive', {
    ...appLocals(),
    maxUploadBytes: MAX_UPLOAD_BYTES,
    maxUploadMb: MAX_UPLOAD_MB,
  });
});

/** Atalho legado */
router.get('/fotos', (req, res) => {
  res.redirect(301, '/drive');
});

module.exports = router;
module.exports.appLocals = appLocals;
