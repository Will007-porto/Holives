/* servidor.js - HTTPS (camera) + WebSocket de sinalizacao (cameras) + WebSocket local (mestre).
 * - https://IP:PORTA/camera  -> ui/camera.html
 * - wss://IP:PORTA/ws        -> cameras
 * - ws://127.0.0.1:PORTA_LOCAL/ws-mestre -> somente o mestre (loopback, sem certificado)
 * Para testes, opcoes.tls=false usa HTTP simples. */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Sinalizacao } = require('./sinalizacao');

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};

// Somente estes caminhos sao publicados na rede. O mestre (mestre.html) nunca e servido.
function caminhoPermitido(rel) {
  return rel === 'camera.html' || /^css\/[\w.-]+\.css$/.test(rel) ||
    rel === 'js/mock.js' || rel === 'js/camera.js' ||
    rel === 'app/ponte-camera.js' || rel === 'app/nucleo.js';
}

function resolverArquivo(raizUi, raizApp, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { return null; }
  if (p === '/camera' || p === '/camera/' || p === '/') p = '/camera.html';
  const rel = path.posix.normalize(p).replace(/^\/+/, '');
  if (rel.indexOf('..') >= 0 || !caminhoPermitido(rel)) return null;
  const base = rel.startsWith('app/') ? path.dirname(raizApp) : raizUi;
  const abs = path.join(base, rel);
  const raizReal = path.resolve(base);
  if (!path.resolve(abs).startsWith(raizReal + path.sep)) return null;
  return abs;
}

function criarServidor(opcoes) {
  const raizUi = opcoes.raizUi;
  const raizApp = opcoes.raizApp;
  const sinal = new Sinalizacao();
  const manipulador = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const abs = resolverArquivo(raizUi, raizApp, req.url || '/');
    if (!abs) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
    fs.readFile(abs, (err, dados) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
      res.writeHead(200, {
        'Content-Type': TIPOS[path.extname(abs)] || 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
      });
      res.end(dados);
    });
  };
  const servidorCameras = opcoes.tls === false
    ? http.createServer(manipulador)
    : https.createServer({ cert: opcoes.cert, key: opcoes.key }, manipulador);
  const wssCameras = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  servidorCameras.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
    wssCameras.handleUpgrade(req, socket, head, (ws) => sinal.conectar(ws, 'camera'));
  });

  // loopback: sinalizacao do mestre e arquivos de midia escolhidos pelo operador
  const servidorLocal = http.createServer((req, res) => {
    if (opcoes.arquivos && opcoes.arquivos.atender(req, res)) return;
    res.writeHead(404); res.end();
  });
  const wssMestre = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  servidorLocal.on('upgrade', (req, socket, head) => {
    const ok = (req.url || '').split('?')[0] === '/ws-mestre' &&
      /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(req.socket.remoteAddress || '');
    if (!ok) { socket.destroy(); return; }
    wssMestre.handleUpgrade(req, socket, head, (ws) => sinal.conectar(ws, 'mestre'));
  });

  const escutar = (srv, porta, host) => new Promise((ok, falha) => {
    srv.once('error', falha);
    srv.listen(porta, host, () => { srv.removeListener('error', falha); ok(srv.address().port); });
  });

  return {
    sinal,
    async iniciar() {
      const portaLocal = await escutar(servidorLocal, 0, '127.0.0.1');
      let porta;
      // porta 0 = "qualquer porta livre" (usado nos testes); sem valor = 8443
      try { porta = await escutar(servidorCameras, opcoes.porta == null ? 8443 : opcoes.porta, '0.0.0.0'); }
      catch (e) {
        if (e.code === 'EADDRINUSE' && opcoes.porta) porta = await escutar(servidorCameras, 0, '0.0.0.0');
        else throw e;
      }
      return { porta, portaLocal };
    },
    parar() {
      [wssCameras, wssMestre].forEach((w) => w.clients.forEach((c) => { try { c.terminate(); } catch (e) { /* */ } }));
      servidorCameras.close(); servidorLocal.close();
    }
  };
}

module.exports = { criarServidor, resolverArquivo, caminhoPermitido };
