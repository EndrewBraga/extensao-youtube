'use strict';
// Registra (ou remove) o host nativo no Chrome. Só mexe em HKCU, sem admin.
//   node install.js              instala
//   node install.js --uninstall  remove
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST_NAME = 'com.local.yt_downloader';
const REG_KEY = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST_NAME;
const HOST_JSON = path.join(__dirname, HOST_NAME + '.json');
const HOST_BAT = path.join(__dirname, 'host.bat');
const MANIFEST = path.join(__dirname, '..', 'extension', 'manifest.json');

// ID do Chrome: SHA-256 da chave pública (DER), 32 primeiros hex mapeados 0-f -> a-p.
function extensionId(keyBase64) {
  return crypto.createHash('sha256').update(Buffer.from(keyBase64, 'base64')).digest('hex')
    .slice(0, 32).replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

function install() {
  const id = extensionId(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).key);
  const hostManifest = {
    name: HOST_NAME,
    description: 'Baixa videos do YouTube com yt-dlp (uso pessoal)',
    path: HOST_BAT,
    type: 'stdio',
    allowed_origins: ['chrome-extension://' + id + '/'],
  };
  fs.writeFileSync(HOST_JSON, JSON.stringify(hostManifest, null, 2));
  execFileSync('reg', ['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', HOST_JSON, '/f'], { stdio: 'ignore' });
  console.log('Host registrado.\n  ID da extensão: ' + id + '\n  JSON: ' + HOST_JSON);
}

function uninstall() {
  try {
    execFileSync('reg', ['delete', REG_KEY, '/f'], { stdio: 'ignore' });
  } catch { /* chave não existia */ }
  fs.rmSync(HOST_JSON, { force: true });
  console.log('Host removido.');
}

module.exports = { extensionId };

if (require.main === module) {
  if (process.argv.includes('--uninstall')) uninstall();
  else install();
}
