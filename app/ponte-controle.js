/* ponte-controle.js - roda no tablet/celular (controle.html servido pelo mestre).
 * Recebe o estado real do mestre por WebSocket e envia as acoes do operador. */
(function () {
  'use strict';
  if (location.protocol === 'file:') return; // aberto direto do disco: continua a simulacao
  var S = window.HolivesState;
  var token = new URLSearchParams(location.search).get('t') || '';
  var ws = null, conectado = false, miniaturas = {}, inicioLive = 0, ultimoDesenho = '', arrastando = false;
  function $(id) { return document.getElementById(id); }

  function aplicarConexao() {
    var chip = document.querySelector('.controle-topo .chip.ok, .controle-topo .chip.erro-conexao');
    if (chip) {
      chip.className = 'chip ' + (conectado ? 'ok' : 'erro-conexao');
      chip.innerHTML = '<span class="ponto"></span>' + (conectado ? 'Conectado ao mestre' : 'Sem conexão');
    }
    var aviso = $('sem-conexao'); if (aviso) aviso.style.display = conectado ? 'none' : 'block';
    document.querySelectorAll('main button, main input').forEach(function (b) { b.disabled = !conectado; });
    var dica = document.querySelector('.controle-main section > p.small'); if (dica) dica.textContent = 'Toque para prévia · Toque duas vezes para ir direto ao ar.';
  }

  function enviar(acao) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'acao', acao: acao })); }

  function miniaturasNaTela() {
    document.querySelectorAll('#grade-fontes .fonte-grande').forEach(function (b) {
      var v = b.querySelector('video'), m = miniaturas[b.dataset.fonteId];
      if (v && m && v.getAttribute('poster') !== m) v.setAttribute('poster', m);
    });
  }
  function redesenhar() {
    document.dispatchEvent(new CustomEvent('holives:tick'));
    miniaturasNaTela();
    document.querySelectorAll('[data-acao="sobreposicao-alternar"]').forEach(function (b) {
      var k = b.dataset.id, v = S.sobreposicoes[k]; if (!v) return;
      b.setAttribute('aria-checked', String(k === 'holyrics' ? !!v.mostrar : !!v.ativa));
    });
    aplicarConexao();
  }

  function aoEstado(e) {
    S.fontes = e.fontes.map(function (f) { return { id: f.id, nome: f.nome, estado: f.estado }; });
    S.previaId = e.previaId; S.noArId = e.noArId;
    S.transmissao.estado = e.aoVivo ? 'ao-vivo' : 'offline'; S.gravacao.ativa = e.gravando;
    S.transicao.tipo = e.transicao;
    S.audio.canais = e.canais.map(function (c) { return { id: c.id, nome: c.nome, volume: c.volume, mudo: c.mudo }; });
    S.sobreposicoes = { logo: { ativa: e.sobre.logo }, tarja: { ativa: e.sobre.tarja }, holyrics: { mostrar: e.sobre.holyrics } };
    inicioLive = e.aoVivo ? Date.now() - (e.segLive || 0) * 1000 : 0; // relogio do proprio tablet
    // redesenhar apaga os botoes: nao faz isso no meio de um arrasto de volume nem sem mudanca
    var chave = JSON.stringify([e.fontes, e.previaId, e.noArId, e.aoVivo, e.canais, e.sobre]);
    if (chave !== ultimoDesenho && !arrastando) { ultimoDesenho = chave; redesenhar(); }
  }

  function conectar() {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws-controle?t=' + encodeURIComponent(token));
    ws.onopen = function () { conectado = true; aplicarConexao(); };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'controle-estado' && m.estado) aoEstado(m.estado);
      else if (m.t === 'controle-miniaturas' && m.m) { miniaturas = m.m; miniaturasNaTela(); }
    };
    ws.onclose = function (ev) {
      conectado = false; aplicarConexao();
      if (ev.code === 4403) { var a = $('sem-conexao'); if (a) a.textContent = 'Código inválido ou trocado. Leia de novo o QR code em Configurações no computador mestre.'; return; }
      setTimeout(conectar, 1500);
    };
  }

  document.addEventListener('DOMContentLoaded', function () {
    // a interface ja atualiza a tela na hora; aqui as acoes seguem para o mestre
    document.addEventListener('holives:acao', function (e) {
      var d = e.detail || {};
      if (d.tipo === 'selecionar-previa' || d.tipo === 'cortar') enviar({ tipo: d.tipo, fonteId: d.fonteId });
      else if (d.tipo === 'transicao') enviar({ tipo: 'transicao' });
      else if (d.tipo === 'audio-mudo') enviar({ tipo: 'audio-mudo', canalId: d.canalId });
      else if (d.tipo === 'audio-volume' && d.preset) enviar({ tipo: 'audio-volume', preset: d.preset });
    });
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-acao="sobreposicao-alternar"]');
      if (b) enviar({ tipo: 'sobreposicao', id: b.dataset.id, ativo: b.getAttribute('aria-checked') === 'true' });
    });
    // volume: a interface nao trata os controles deslizantes
    document.addEventListener('pointerdown', function (e) { if (e.target.matches && e.target.matches('input[type=range]')) arrastando = true; });
    ['pointerup', 'pointercancel'].forEach(function (t) { document.addEventListener(t, function () { arrastando = false; }); });
    var ultimoEnvio = 0;
    function volume(e, forcar) {
      var r = e.target; if (!r.matches || !r.matches('input[data-acao="audio-volume"]')) return;
      if (!forcar && Date.now() - ultimoEnvio < 80) return; ultimoEnvio = Date.now();
      enviar({ tipo: 'audio-volume', canalId: r.dataset.fonteId, volume: parseInt(r.value, 10) });
    }
    document.addEventListener('input', function (e) { volume(e, false); });
    document.addEventListener('change', function (e) { volume(e, true); });

    var relogio = document.querySelector('.controle-topo .numero');
    setInterval(function () {
      if (!relogio) return;
      var seg = inicioLive ? Math.max(0, Math.floor((Date.now() - inicioLive) / 1000)) : 0;
      var z = function (n) { return String(n).padStart(2, '0'); };
      relogio.textContent = z(Math.floor(seg / 3600)) + ':' + z(Math.floor(seg % 3600 / 60)) + ':' + z(seg % 60);
    }, 1000);

    S.fontes = []; S.audio.canais = []; redesenhar();
    if (!token) { var a = $('sem-conexao'); if (a) { a.style.display = 'block'; a.textContent = 'Abra esta página pelo QR code em Configurações no computador mestre.'; } return; }
    conectar();
  });
})();
