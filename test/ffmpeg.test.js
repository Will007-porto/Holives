'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { GerenteFfmpeg, caminhoFfmpeg } = require('../app/ffmpeg');

const bin = caminhoFfmpeg();

function gerarWebm(arq) {
  const r = spawnSync(bin, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '2', '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', arq], { encoding: 'utf8' });
  return r.status === 0;
}

test('gravacao: WebM entra pelo stdin e sai um MP4 com video e audio', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holives-ff-'));
  const webm = path.join(dir, 'in.webm');
  if (!fs.existsSync(bin) || !gerarWebm(webm)) return t.skip('ffmpeg sem libvpx/libopus neste ambiente');
  const eventos = [];
  const g = new GerenteFfmpeg((s) => eventos.push(s));
  const r = await g.iniciar({ job: 'gravacao', mime: 'video/webm;codecs=vp8,opus', pasta: dir, fps: 30 });
  assert.ok(r.ok, r.erro);
  const dados = fs.readFileSync(webm);
  for (let i = 0; i < dados.length; i += 4096) g.dados('gravacao', dados.subarray(i, i + 4096));
  await g.parar('gravacao');
  assert.ok(fs.existsSync(r.caminho) && fs.statSync(r.caminho).size > 1000);
  const info = spawnSync(bin, ['-hide_banner', '-i', r.caminho], { encoding: 'utf8' }).stderr;
  assert.match(info, /Video: h264/);
  assert.match(info, /Audio: aac/);
  assert.ok(eventos.some((e) => e.estado === 'encerrado'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('live: recusa destino invalido sem iniciar processo', async () => {
  const g = new GerenteFfmpeg(() => {});
  assert.strictEqual((await g.iniciar({ job: 'live', servidor: 'http://x', chave: 'k' })).ok, false);
  assert.strictEqual((await g.iniciar({ job: 'live', servidor: 'rtmp://x/y', chave: '' })).ok, false);
  assert.strictEqual((await g.iniciar({ job: 'qualquer' })).ok, false);
  assert.strictEqual(g.jobs.size, 0);
});

test('live: servidor RTMP inalcancavel gera erro sem vazar a chave', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holives-ff-'));
  const webm = path.join(dir, 'in.webm');
  if (!fs.existsSync(bin) || !gerarWebm(webm)) return t.skip('ffmpeg sem libvpx/libopus neste ambiente');
  const eventos = [];
  const g = new GerenteFfmpeg((s) => eventos.push(s));
  const r = await g.iniciar({ job: 'live', mime: 'video/webm', servidor: 'rtmp://127.0.0.1:1/live', chave: 'CHAVE-SECRETA-123', fps: 30 });
  assert.ok(r.ok);
  const dados = fs.readFileSync(webm);
  g.dados('live', dados.subarray(0, 60000));
  await new Promise((ok) => { const i = setInterval(() => { if (eventos.some((e) => e.estado === 'erro')) { clearInterval(i); ok(); } }, 100); setTimeout(ok, 8000); });
  const erro = eventos.find((e) => e.estado === 'erro');
  assert.ok(erro, 'esperava evento de erro');
  assert.ok(!JSON.stringify(eventos).includes('CHAVE-SECRETA-123'));
  fs.rmSync(dir, { recursive: true, force: true });
});
