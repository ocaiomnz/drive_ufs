/**
 * Chave estável da pasta de um usuário a partir do nome:
 * "João Marcos" → "joao-marcos". Mesma chave = mesma pasta.
 * Espelhada em public/js/drive.js — manter igual.
 */
function ownerKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

module.exports = { ownerKey };
