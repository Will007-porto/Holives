'use strict';
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { criarServidor, resolverArquivo } = require('../app/servidor');
const { obterCertificado } = require('../app/certificado');

const raiz = path.join(__dirname, '..');

async function subir() {
  const s = criarServidor({ tls: false, porta: 0, raizUi: path.join(raiz, 'ui'), raizApp: path.join(raiz, 'app') });
  const { porta, portaLocal } = await s.iniciar();
  return { s, porta, portaLocal };
}

// cliente com fila de mensagens recebidas
function cliente(url) {
  const ws = new WebSocket(url);
  const fila = []; const esperas = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    const i = esperas.findIndex((e) => e.f(m));
    if (i >= 0) esperas.splice(i, 1)[0].r(m); else fila.push(m);
  });
  return {
    ws,
    aberto: () => new Promise((r, j) => { ws.on('open', r); ws.on('error', j); }),
    enviar: (o) => ws.send(JSON.stringify(o)),
    espera: (f, ms = 1500) => new Promise((r, j) => {
      const i = fila.findIndex(f);
      if (i >= 0) return r(fila.splice(i, 1)[0]);
      const e = { f, r };
      esperas.push(e);
      setTimeout(() => j(new Error('timeout esperando mensagem')), ms).unref();
    }),
    fechar: () => ws.close()
  };
}
const tipo = (t) => (m) => m.t === t;

async function camera(porta, nome, id) {
  const c = cliente('ws://127.0.0.1:' + porta + '/ws');
  await c.aberto();
  c.enviar({ t: 'ola', nome, idAparelho: id, camera: 'traseira', qualidade: '1080p', audio: true });
  return c;
}

test('fluxo: camera pede, mestre aceita, SDP e tally passam', async () => {
  const { s, porta, portaLocal } = await subir();
  try {
    const m = cliente('ws://127.0.0.1:' + portaLocal + '/ws-mestre'); await m.aberto();
    await m.espera(tipo('estado-inicial'));
    const c = await camera(porta, 'iPhone de Ana', 'a1');
    const pend = await m.espera(tipo('pendente'));
    assert.strictEqual(pend.nome, 'iPhone de Ana');
    m.enviar({ t: 'aceitar', id: pend.id });
    const ac = await c.espera(tipo('aceito'));
    assert.strictEqual(ac.slot, 'cam1');
    await m.espera(tipo('camera-conectou'));
    c.enviar({ t: 'sdp', dados: { type: 'offer', sdp: 'x' } });
    const sdp = await m.espera(tipo('sdp'));
    assert.strictEqual(sdp.slot, 'cam1');
    m.enviar({ t: 'sdp', slot: 'cam1', dados: { type: 'answer', sdp: 'y' } });
    assert.strictEqual((await c.espera(tipo('sdp'))).dados.type, 'answer');
    m.enviar({ t: 'tally', previa: 'cam2', noAr: 'cam1' });
    assert.strictEqual((await c.espera((x) => x.t === 'tally' && x.estado === 'no-ar')).estado, 'no-ar');
    m.enviar({ t: 'tally', previa: 'cam1', noAr: 'cam2' });
    assert.strictEqual((await c.espera((x) => x.t === 'tally' && x.estado === 'previa')).estado, 'previa');
    c.fechar(); m.fechar();
  } finally { s.parar(); }
});

test('limite de 4 cameras: a quinta e recusada', async () => {
  const { s, porta, portaLocal } = await subir();
  try {
    const m = cliente('ws://127.0.0.1:' + portaLocal + '/ws-mestre'); await m.aberto();
    const cams = [];
    for (let i = 1; i <= 4; i++) {
      const c = await camera(porta, 'Cam ' + i, 'id' + i);
      const p = await m.espera(tipo('pendente'));
      m.enviar({ t: 'aceitar', id: p.id });
      const a = await c.espera(tipo('aceito'));
      assert.strictEqual(a.slot, 'cam' + i);
      cams.push(c);
    }
    const quinta = await camera(porta, 'Cam 5', 'id5');
    const r = await quinta.espera(tipo('recusado'));
    assert.strictEqual(r.motivo, 'lotado');
    cams.forEach((c) => c.fechar()); m.fechar();
  } finally { s.parar(); }
});

test('recusar, nomes repetidos e reconexao no mesmo slot', async () => {
  const { s, porta, portaLocal } = await subir();
  try {
    const m = cliente('ws://127.0.0.1:' + portaLocal + '/ws-mestre'); await m.aberto();
    const a = await camera(porta, 'Galaxy', 'g1');
    const pa = await m.espera(tipo('pendente'));
    const b = await camera(porta, 'Galaxy', 'g2');
    const pb = await m.espera(tipo('pendente'));
    assert.strictEqual(pb.nome, 'Galaxy (2)');
    m.enviar({ t: 'recusar', id: pb.id });
    assert.strictEqual((await b.espera(tipo('recusado'))).motivo, 'operador');
    m.enviar({ t: 'aceitar', id: pa.id });
    await a.espera(tipo('aceito'));
    a.fechar();
    const desc = await m.espera(tipo('camera-desconectou'));
    assert.strictEqual(desc.slot, 'cam1');
    const a2 = await camera(porta, 'Galaxy', 'g1'); // mesmo aparelho volta sem nova aprovacao
    const ac = await a2.espera(tipo('aceito'));
    assert.strictEqual(ac.slot, 'cam1');
    const rec = await m.espera((x) => x.t === 'camera-conectou' && x.reconexao);
    assert.ok(rec.reconexao);
    a2.fechar(); m.fechar();
  } finally { s.parar(); }
});

test('camera sem aprovacao nao consegue enviar SDP; novo mestre pede renegociacao', async () => {
  const { s, porta, portaLocal } = await subir();
  try {
    const m = cliente('ws://127.0.0.1:' + portaLocal + '/ws-mestre'); await m.aberto();
    const c = await camera(porta, 'Intruso', 'x1');
    const p = await m.espera(tipo('pendente'));
    c.enviar({ t: 'sdp', dados: { type: 'offer' } });
    await new Promise((r) => setTimeout(r, 150));
    await assert.rejects(m.espera(tipo('sdp'), 200));
    m.enviar({ t: 'aceitar', id: p.id }); await c.espera(tipo('aceito'));
    m.fechar();
    await c.espera(tipo('mestre-offline'));
    const m2 = cliente('ws://127.0.0.1:' + portaLocal + '/ws-mestre'); await m2.aberto();
    const est = await m2.espera(tipo('estado-inicial'));
    assert.strictEqual(est.cameras.length, 1);
    await c.espera(tipo('renegociar'));
    c.fechar(); m2.fechar();
  } finally { s.parar(); }
});

test('servidor HTTP: serve camera e bloqueia mestre/traversal', async () => {
  const { s, porta } = await subir();
  const get = (p) => new Promise((r) => http.get({ host: '127.0.0.1', port: porta, path: p }, (res) => { res.resume(); res.on('end', () => r(res.statusCode)); }));
  try {
    assert.strictEqual(await get('/camera'), 200);
    assert.strictEqual(await get('/css/base.css'), 200);
    assert.strictEqual(await get('/app/ponte-camera.js'), 200);
    assert.strictEqual(await get('/mestre.html'), 404);
    assert.strictEqual(await get('/app/principal.js'), 404);
    assert.strictEqual(await get('/..%2fpackage.json'), 404);
    assert.strictEqual(await get('/css/..%2f..%2fpackage.json'), 404);
  } finally { s.parar(); }
  assert.strictEqual(resolverArquivo('/a/ui', '/a/app', '/../etc/passwd'), null);
});

test('certificado autoassinado e gerado uma vez e reaproveitado', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'holives-cert-'));
  const c1 = await obterCertificado(pasta, ['192.168.0.10']);
  assert.ok(c1.gerado && c1.cert.includes('BEGIN CERTIFICATE'));
  const c2 = await obterCertificado(pasta, ['192.168.0.10']);
  assert.strictEqual(c2.gerado, false);
  assert.strictEqual(c2.cert, c1.cert);
  const c3 = await obterCertificado(pasta, ['192.168.0.99']); // IP novo: regenera
  assert.strictEqual(c3.gerado, true);
  fs.rmSync(pasta, { recursive: true, force: true });
});
