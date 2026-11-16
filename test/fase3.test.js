'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { Holyrics, lerEndereco, limparTexto, interpretar } = require('../app/holyrics');
const { criarServidor } = require('../app/servidor');

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

test('holyrics: lerEndereco aceita IP, IP:porta e nome; recusa o resto', () => {
  assert.deepStrictEqual(lerEndereco('192.168.0.20'), { host: '192.168.0.20', porta: 8091 });
  assert.deepStrictEqual(lerEndereco(' http://192.168.0.20:9000/api '), { host: '192.168.0.20', porta: 9000 });
  assert.deepStrictEqual(lerEndereco('pc-louvor:8091'), { host: 'pc-louvor', porta: 8091 });
  assert.strictEqual(lerEndereco(''), null);
  assert.strictEqual(lerEndereco('192.168.0.20:99999'), null);
  assert.strictEqual(lerEndereco('a b'), null);
  assert.strictEqual(lerEndereco('x@evil.com'), null);
});

test('holyrics: limparTexto tira marcacoes e linhas vazias repetidas', () => {
  assert.strictEqual(limparTexto('<b>Grande</b> é o Senhor<br>e mui digno'), 'Grande é o Senhor\ne mui digno');
  assert.strictEqual(limparTexto('  a  \n\n\n  b  '), 'a\n\nb');
  assert.strictEqual(limparTexto(null), '');
  assert.ok(limparTexto('x'.repeat(5000)).length <= 600);
});

test('holyrics: interpretar escolhe o slide atual e esconde tela preta/vazia', () => {
  const slides = [{ number: 1, text: 'um' }, { number: 2, text: 'dois' }];
  const r = (d) => ({ status: 'ok', data: d });
  assert.deepStrictEqual(interpretar(r({ id: 'a', type: 'song', name: 'Musica', slide_number: 2, slide_type: 'default' }), slides), { visivel: true, texto: 'dois', titulo: 'Musica' });
  assert.strictEqual(interpretar(r({ id: 'a', type: 'song', name: 'M', slide_number: 2, slide_type: 'black' }), slides).visivel, false);
  assert.strictEqual(interpretar(r({ id: 'a', type: 'song', name: 'M', slide_number: 9 }), slides).visivel, false);
  assert.deepStrictEqual(interpretar(r({ id: 'v', type: 'verse', name: 'João 3:16' }), []), { visivel: true, texto: 'João 3:16', titulo: 'João 3:16' });
  assert.strictEqual(interpretar(r({ id: 'i', type: 'image', name: 'foto' }), []).visivel, false);
  assert.strictEqual(interpretar(r(null), []).visivel, false);
  assert.strictEqual(interpretar({ status: 'error', error: 'x' }, []).visivel, false);
});

test('holyrics: consulta o API Server, pede os slides so quando o item muda e avisa token invalido', async () => {
  const estado = { slide: 1, comSlides: 0, pedidos: 0 };
  const srv = http.createServer((req, res) => {
    let corpo = ''; req.on('data', (d) => corpo += d);
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      res.setHeader('Content-Type', 'application/json');
      if (u.searchParams.get('token') !== 'certo') return res.end(JSON.stringify({ status: 'error', error: 'invalid token' }));
      estado.pedidos++;
      const data = { id: 'm1', type: 'song', name: 'Louvor', slide_number: estado.slide, slide_type: 'default' };
      if (JSON.parse(corpo || '{}').include_slides) { estado.comSlides++; data.slides = [{ number: 1, text: 'primeiro' }, { number: 2, text: 'segundo' }]; }
      res.end(JSON.stringify({ status: 'ok', data }));
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const eventos = [];
  const h = new Holyrics((e) => eventos.push(e));
  try {
    assert.strictEqual(h.configurar('', ''), false);
    assert.strictEqual(eventos.at(-1).conexao, 'não configurado');
    h.configurar('127.0.0.1:' + srv.address().port, 'errado');
    await espera(700);
    assert.match(eventos.at(-1).conexao, /token/);
    h.configurar('127.0.0.1:' + srv.address().port, 'certo');
    await espera(1000);
    assert.deepStrictEqual(eventos.at(-1), { conexao: 'conectado', visivel: true, texto: 'primeiro', titulo: 'Louvor' });
    estado.slide = 2;
    await espera(1000);
    assert.strictEqual(eventos.at(-1).texto, 'segundo');
    assert.strictEqual(estado.comSlides, 1, 'a lista de slides so deve ser pedida uma vez por item');
    assert.ok(estado.pedidos >= 3);
  } finally { h.parar(); await new Promise((ok) => srv.close(ok)); }
});

function abrir(url) {
  const ws = new WebSocket(url); const msgs = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  return { ws, msgs, aberto: () => new Promise((ok, falha) => { ws.once('open', ok); ws.once('error', falha); }), fechou: () => new Promise((ok) => ws.once('close', (c) => ok(c))) };
}

test('controle remoto: exige o codigo, repassa acoes ao mestre, recebe o estado e cai quando o codigo troca', async () => {
  const raiz = path.join(__dirname, '..');
  let token = 'a'.repeat(32);
  const s = criarServidor({ tls: false, porta: 0, raizUi: path.join(raiz, 'ui'), raizApp: path.join(raiz, 'app'), tokenControle: () => token });
  const { porta, portaLocal } = await s.iniciar();
  try {
    // a pagina do controle e servida; a do mestre continua bloqueada
    assert.strictEqual((await fetch('http://127.0.0.1:' + porta + '/controle?t=x')).status, 200);
    assert.strictEqual((await fetch('http://127.0.0.1:' + porta + '/app/ponte-controle.js')).status, 200);
    assert.strictEqual((await fetch('http://127.0.0.1:' + porta + '/mestre.html')).status, 404);
    assert.strictEqual((await fetch('http://127.0.0.1:' + porta + '/app/ponte.js')).status, 404);

    const mestre = abrir('ws://127.0.0.1:' + portaLocal + '/ws-mestre'); await mestre.aberto();
    for (const errado of ['', 'b'.repeat(32), 'a'.repeat(31)]) {
      const x = abrir('ws://127.0.0.1:' + porta + '/ws-controle?t=' + errado);
      assert.strictEqual(await x.fechou(), 4403);
    }
    const c = abrir('ws://127.0.0.1:' + porta + '/ws-controle?t=' + token); await c.aberto();
    await espera(100);
    assert.deepStrictEqual(mestre.msgs.filter((m) => m.t === 'controle-qtd').at(-1), { t: 'controle-qtd', n: 1 });
    c.ws.send(JSON.stringify({ t: 'acao', acao: { tipo: 'cortar', fonteId: 'cam2' } }));
    c.ws.send(JSON.stringify({ t: 'aceitar', id: 'c1' }));          // um controle nao pode aceitar cameras
    c.ws.send(JSON.stringify({ t: 'acao', acao: 'texto' }));          // formato invalido
    await espera(100);
    const acoes = mestre.msgs.filter((m) => m.t === 'controle-acao');
    assert.deepStrictEqual(acoes, [{ t: 'controle-acao', acao: { tipo: 'cortar', fonteId: 'cam2' } }]);
    mestre.ws.send(JSON.stringify({ t: 'controle-estado', estado: { previaId: 'cam1' } }));
    await espera(100);
    assert.deepStrictEqual(c.msgs.at(-1), { t: 'controle-estado', estado: { previaId: 'cam1' } });
    // codigo trocado: o controle antigo cai e o codigo antigo deixa de valer
    const caiu = c.fechou();
    token = 'c'.repeat(32); s.sinal.derrubarControles();
    assert.strictEqual(await caiu, 4403);
    const velho = abrir('ws://127.0.0.1:' + porta + '/ws-controle?t=' + 'a'.repeat(32));
    assert.strictEqual(await velho.fechou(), 4403);
    mestre.ws.close();
  } finally { s.parar(); }
});
