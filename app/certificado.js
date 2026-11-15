/* certificado.js - gera (uma vez) e reaproveita o certificado autoassinado do servidor HTTPS.
 * Fica na pasta de dados do usuario, nunca no repositorio. Regenera se os IPs locais mudarem. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

function ipsLocais() {
  const r = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach((nome) => (ifs[nome] || []).forEach((i) => {
    if (i.family === 'IPv4' && !i.internal) r.push({ nome, ip: i.address });
  }));
  return r;
}

async function obterCertificado(pasta, ips) {
  fs.mkdirSync(pasta, { recursive: true });
  const arqCert = path.join(pasta, 'holives-cert.pem');
  const arqChave = path.join(pasta, 'holives-chave.pem');
  const arqMeta = path.join(pasta, 'holives-cert.json');
  const lista = Array.from(new Set(['127.0.0.1'].concat(ips))).sort();
  try {
    const meta = JSON.parse(fs.readFileSync(arqMeta, 'utf8'));
    const valido = meta.expira > Date.now() + 30 * 864e5;
    const cobre = lista.every((ip) => meta.ips.indexOf(ip) >= 0);
    if (valido && cobre) return { cert: fs.readFileSync(arqCert, 'utf8'), key: fs.readFileSync(arqChave, 'utf8'), gerado: false };
  } catch (e) { /* gera novo */ }
  const dias = 3650;
  const altNames = [{ type: 2, value: 'localhost' }, { type: 2, value: 'holives.local' }]
    .concat(lista.map((ip) => ({ type: 7, ip })));
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'Holives' }], {
    days: dias, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }]
  });
  fs.writeFileSync(arqCert, pems.cert);
  fs.writeFileSync(arqChave, pems.private, { mode: 0o600 });
  fs.writeFileSync(arqMeta, JSON.stringify({ ips: lista, expira: Date.now() + dias * 864e5 }));
  return { cert: pems.cert, key: pems.private, gerado: true };
}

module.exports = { obterCertificado, ipsLocais };
