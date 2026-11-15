'use strict';
const test = require('node:test');
const assert = require('node:assert');
const N = require('../app/nucleo');

test('dbParaLinear', () => {
  assert.strictEqual(N.dbParaLinear(-60), 0);
  assert.strictEqual(N.dbParaLinear(0), 1);
  assert.ok(Math.abs(N.dbParaLinear(-6) - 0.501) < 0.01);
  assert.strictEqual(N.dbParaLinear(NaN), 0);
});

test('nivelDeRms', () => {
  assert.strictEqual(N.nivelDeRms(0), 0);
  assert.strictEqual(N.nivelDeRms(1), 1);
  assert.ok(Math.abs(N.nivelDeRms(0.1) - (40 / 60)) < 1e-9);
});

test('ganhoEfetivo: mudo e seguir video', () => {
  const cam = { id: 'cam2', volume: 0, mudo: false, seguirVideo: true };
  assert.strictEqual(N.ganhoEfetivo(cam, 'cam1'), 0);
  assert.strictEqual(N.ganhoEfetivo(cam, 'cam2'), 1);
  assert.strictEqual(N.ganhoEfetivo(Object.assign({}, cam, { mudo: true }), 'cam2'), 0);
  assert.strictEqual(N.ganhoEfetivo({ id: 'mesa', volume: 0, mudo: false, seguirVideo: true }, 'cam1'), 1);
  assert.strictEqual(N.ganhoEfetivo(Object.assign({}, cam, { seguirVideo: false }), 'cam1'), 1);
});

test('calcularTally', () => {
  assert.deepStrictEqual(N.calcularTally('cam2', 'cam1'), { cam1: 'no-ar', cam2: 'previa', cam3: 'espera', cam4: 'espera' });
});

test('montarUrlRtmp valida e junta a chave', () => {
  assert.strictEqual(N.montarUrlRtmp('rtmp://a.b/live2/', 'abc').url, 'rtmp://a.b/live2/abc');
  assert.strictEqual(N.montarUrlRtmp('http://x', 'abc').ok, false);
  assert.strictEqual(N.montarUrlRtmp('rtmp://a.b/live2', '').ok, false);
  assert.strictEqual(N.montarUrlRtmp('rtmp://a.b/live2', 'a b').ok, false);
});

test('redigirChave esconde a chave', () => {
  const t = N.redigirChave('Error opening rtmp://a.rtmp.youtube.com/live2/segredo123: falhou', 'segredo123');
  assert.ok(!t.includes('segredo123'));
  const t2 = N.redigirChave('rtmp://srv/app/outrachave tudo', '');
  assert.ok(!t2.includes('outrachave'));
});

test('argsFfmpeg arquivo (h264 copia video) e rtmp (reencoda)', () => {
  const a = N.argsFfmpeg({ tipo: 'arquivo', mime: 'video/webm;codecs=h264,opus', caminho: '/tmp/x.mp4' });
  assert.ok(a.join(' ').includes('-c:v copy'));
  assert.strictEqual(a[a.length - 1], '/tmp/x.mp4');
  const v = N.argsFfmpeg({ tipo: 'arquivo', mime: 'video/webm;codecs=vp8,opus', caminho: '/tmp/x.mp4' });
  assert.ok(v.join(' ').includes('libx264'));
  const r = N.argsFfmpeg({ tipo: 'rtmp', mime: 'video/webm', url: 'rtmp://a/b/c', kbps: 6000, fps: 30 });
  assert.ok(r.join(' ').includes('-b:v 6000k'));
  assert.ok(r.join(' ').includes('-g 60'));
  assert.strictEqual(r[r.length - 1], 'rtmp://a/b/c');
});

test('parseProgressoFfmpeg', () => {
  const r = N.parseProgressoFfmpeg('frame=  300 fps= 30 q=28.0 size=    1024kB time=00:00:10.00 bitrate=4500.5kbits/s dup=0 drop=3 speed=1x');
  assert.deepStrictEqual(r, { quadros: 300, fps: 30, kbps: 4500.5, perdidos: 3 });
  assert.strictEqual(N.parseProgressoFfmpeg('qualquer texto'), null);
});

test('ordenarIps prefere 192.168 e evita adaptadores virtuais', () => {
  const o = N.ordenarIps([
    { nome: 'vEthernet (WSL)', ip: '172.20.0.1' },
    { nome: 'Wi-Fi', ip: '192.168.0.10' },
    { nome: 'VirtualBox Host-Only', ip: '192.168.56.1' }
  ]);
  assert.strictEqual(o[0].ip, '192.168.0.10');
});
