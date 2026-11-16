'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const N = require('../app/nucleo');
const { Arquivos, tipoDe } = require('../app/arquivos');
const { GerenteFfmpeg } = require('../app/ffmpeg');

test('argsFfmpeg: um destino usa flv direto; varios usam tee com onfail=ignore', () => {
  const um = N.argsFfmpeg({ tipo: 'rtmp', urls: ['rtmp://a/b/c'], kbps: 4000, fps: 30 });
  assert.deepStrictEqual(um.slice(-3), ['-f', 'flv', 'rtmp://a/b/c']);
  const dois = N.argsFfmpeg({ tipo: 'rtmp', urls: ['rtmp://a/b/c', 'rtmps://d/e/f?x=1&y=2'], kbps: 4000, fps: 30 });
  assert.strictEqual(dois[dois.length - 2], 'tee');
  assert.strictEqual(dois[dois.length - 1], '[f=flv:onfail=ignore]rtmp://a/b/c|[f=flv:onfail=ignore]rtmps://d/e/f?x=1&y=2');
  assert.ok(dois.includes('+global_header'));
});

test('escaparTee protege os separadores do tee', () => {
  const B = String.fromCharCode(92); // barra invertida
  assert.strictEqual(N.escaparTee('rtmp://a/b|c[d]'), 'rtmp://a/b' + B + '|c' + B + '[d' + B + ']');
  assert.strictEqual(N.escaparTee("a'b" + B + 'c'), 'a' + B + "'b" + B + B + 'c');
});

test('parseFalhaTee, percentualParaDb, layoutVertical e recorteCobrir', () => {
  assert.strictEqual(N.parseFalhaTee('[tee @ 0x1] Slave muxer #1 failed: Connection refused, continuing with 1/2 slaves.'), 1);
  assert.strictEqual(N.parseFalhaTee('frame= 10 fps=30'), -1);
  assert.strictEqual(N.percentualParaDb(100), 0);
  assert.strictEqual(N.percentualParaDb(0), -60);
  assert.ok(N.percentualParaDb(50) < 0 && N.percentualParaDb(50) > -20);
  const L = N.layoutVertical(720, 1280);
  assert.deepStrictEqual(L.video, { x: 0, y: 437, w: 720, h: 405 });
  assert.strictEqual(L.topo.h + L.video.h + L.base.h, 1280);
  const r = N.recorteCobrir(1000, 1000, 720, 437);
  assert.strictEqual(Math.round(r.sw), 1000);
  assert.ok(Math.abs(r.sw / r.sh - 720 / 437) < 0.001);
});

test('ffmpeg: varios destinos sao validados e a tarefa live-v e aceita', async () => {
  const g = new GerenteFfmpeg(() => {});
  assert.strictEqual((await g.iniciar({ job: 'live', destinos: [{ servidor: 'rtmp://a/b', chave: 'k' }, { servidor: 'http://x', chave: 'k' }] })).ok, false);
  assert.strictEqual((await g.iniciar({ job: 'live-v', destinos: [{ servidor: 'rtmp://a/b', chave: '' }] })).ok, false);
  assert.strictEqual(g.jobs.size, 0);
});

test('arquivos: so registra imagem/video existente e serve com Range e CORS, exigindo o token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holives-arq-'));
  const png = path.join(dir, 'foto.png'), txt = path.join(dir, 'segredo.txt');
  fs.writeFileSync(png, Buffer.from('0123456789')); fs.writeFileSync(txt, 'x');
  const a = new Arquivos();
  assert.strictEqual(a.registrar(txt), null);
  assert.strictEqual(a.registrar(path.join(dir, 'nao-existe.png')), null);
  assert.strictEqual(a.registrar(dir), null);
  assert.strictEqual(tipoDe('x.MP4')[0], 'video');
  const item = a.registrar(png);
  assert.ok(item && item.tipo === 'imagem' && item.nome === 'foto');
  assert.strictEqual(a.registrar(png).id, item.id); // nao duplica
  const srv = http.createServer((req, res) => { if (!a.atender(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const url = a.publico(item, srv.address().port).url;
  let r = await fetch(url);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual(await r.text(), '0123456789');
  r = await fetch(url, { headers: { Range: 'bytes=2-5' } });
  assert.strictEqual(r.status, 206);
  assert.strictEqual(r.headers.get('content-range'), 'bytes 2-5/10');
  assert.strictEqual(await r.text(), '2345');
  r = await fetch(url, { headers: { Range: 'bytes=50-' } }); assert.strictEqual(r.status, 416); await r.arrayBuffer();
  r = await fetch(base + '/midia/' + '0'.repeat(32) + '/' + item.id); assert.strictEqual(r.status, 404); await r.arrayBuffer();
  r = await fetch(base + '/midia/' + a.token + '/ffffffffffff'); assert.strictEqual(r.status, 404); await r.arrayBuffer();
  assert.strictEqual(a.remover(item.id), true);
  r = await fetch(url); assert.strictEqual(r.status, 404); await r.arrayBuffer();
  await new Promise((ok) => srv.close(ok));
  fs.rmSync(dir, { recursive: true, force: true });
});
