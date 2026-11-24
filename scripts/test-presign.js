require('dotenv').config();
const storage = require('../services/storage');

async function main() {
  console.log(`Testando geração de URL de envio (${storage.driver})...`);
  await storage.init();

  const { uploadUrl, storageKey } = await storage.createUploadUrl({
    filename: 'teste-presign.jpg',
    contentType: 'image/jpeg',
    ownerKey: 'teste',
  });

  console.log('OK — storageKey:', storageKey);
  console.log('OK — uploadUrl (início):', uploadUrl.slice(0, 80) + '...');
  console.log('URL de envio gerada com sucesso.');
}

main().catch((err) => {
  console.error('Falha no teste de URL de envio:', err.message);
  process.exit(1);
});
