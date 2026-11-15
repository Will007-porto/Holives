/* ponte-camera.js - lado da camera (celular/tablet): captura, WebSocket de sinalizacao e WebRTC.
 * Roda em ui/camera.html servida pelo mestre em https://IP:PORTA/camera. */
(function () {
  'use strict';
  window.HolivesReal = true;
  var $ = function (id) { return document.getElementById(id); };
  var est = { ws: null, stream: null, pc: null, ativo: false, voluntario: false, timer: null, audioLigado: true, lanterna: false, faceAtual: null, wake: null, ultimaAltura: 0 };

  function guardar(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function idAparelho() {
    var id = guardar('holives.idAparelho');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
      guardar('holives.idAparelho', id);
    }
    return id;
  }
  function mostrar(id) {
    document.querySelectorAll('.tela-camera').forEach(function (el) { el.style.display = 'none'; });
    $(id).style.display = 'flex';
  }
  function texto(msg) { var e = $('estado-conexao'); if (e) e.textContent = msg; }
  function qualidade() { return $('qualidade') ? $('qualidade').value : '1080p'; }
  function facing() { return $('escolha-camera') && $('escolha-camera').value === 'frontal' ? 'user' : 'environment'; }
  function enviar(o) { if (est.ws && est.ws.readyState === 1) est.ws.send(JSON.stringify(o)); }

  function restricoes(face) {
    var alta = qualidade() === '1080p';
    return {
      video: { facingMode: { ideal: face }, width: { ideal: alta ? 1920 : 1280 }, height: { ideal: alta ? 1080 : 720 }, frameRate: { ideal: 30, max: 30 } },
      audio: est.audioLigado ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
    };
  }

  function chip(textoChip, classe) {
    var c = document.querySelector('.indicadores .chip');
    if (c) { c.className = 'chip ' + (classe || ''); c.innerHTML = '<span class="ponto"></span>'; c.appendChild(document.createTextNode(textoChip)); }
  }
  function faixa(visivel) { var f = $('faixa-reconectando'); if (f) f.style.display = visivel ? 'block' : 'none'; }

  async function pegarMidia() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este navegador só libera a câmera em endereço seguro. Abra o endereço https:// mostrado no computador mestre e aceite o aviso de segurança.');
    }
    est.faceAtual = facing();
    return navigator.mediaDevices.getUserMedia(restricoes(est.faceAtual));
  }

  async function conectar() {
    if (est.ws && (est.ws.readyState === 0)) return; // ja conectando
    if (est.ws && est.ws.readyState === 1 && est.stream) { iniciarPar(); return; }
    est.voluntario = false;
    texto('Pedindo permissão da câmera…');
    try {
      if (!est.stream) est.stream = await pegarMidia();
    } catch (e) {
      var msg = e && e.name === 'NotAllowedError' ? 'Permissão negada. Toque no cadeado do navegador e libere a câmera e o microfone.'
        : e && e.name === 'NotFoundError' ? 'Nenhuma câmera encontrada neste aparelho.'
        : (e && e.message) || 'Não foi possível abrir a câmera.';
      texto(msg); return;
    }
    abrirWs();
  }

  function abrirWs() {
    clearTimeout(est.timer);
    texto('Conectando ao computador mestre…');
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var ws = est.ws = new WebSocket(proto + location.host + '/ws');
    ws.onopen = function () {
      var nome = ($('nome-aparelho') && $('nome-aparelho').value.trim()) || 'Câmera';
      enviar({ t: 'ola', nome: nome, idAparelho: idAparelho(), camera: facing() === 'user' ? 'frontal' : 'traseira', qualidade: qualidade(), audio: est.audioLigado, modelo: navigator.userAgent.slice(0, 60) });
    };
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } mensagem(m); };
    ws.onclose = function () {
      if (est.ws !== ws) return;
      if (est.voluntario) return;
      if (est.ativo) { faixa(true); chip('Reconectando…', 'alerta'); }
      else if ($('tela-conexao').style.display !== 'none') texto('Conexão perdida. Toque em "Tentar de novo".');
      est.timer = setTimeout(function () { if (!est.voluntario && est.stream) abrirWs(); }, 2000);
    };
    ws.onerror = function () { /* onclose cuida */ };
  }

  function definirTally(estado) {
    var t = $('tally'), l = $('tally-label'); if (!t) return;
    t.className = 'tally ' + estado;
    l.textContent = estado === 'no-ar' ? 'NO AR' : estado === 'previa' ? 'PRÉVIA' : 'EM ESPERA';
    if (navigator.vibrate && estado === 'no-ar') try { navigator.vibrate(120); } catch (e) { /* */ }
  }

  async function mensagem(m) {
    switch (m.t) {
      case 'pendente': texto('Conectado. Aguardando o operador aceitar…'); break;
      case 'aceito':
        est.ativo = true; faixa(false);
        mostrar('tela-live-camera');
        var v = document.querySelector('#tela-live-camera video'); if (v) { v.srcObject = est.stream; v.muted = true; v.play().catch(function () {}); }
        chip('Conectando…', '');
        if (est.nomeAceito !== m.nome) { est.nomeAceito = m.nome; }
        iniciarPar(); pedirTela(); break;
      case 'recusado':
        est.ativo = false; pararTudo();
        mostrar('tela-conexao');
        texto(m.motivo === 'lotado' ? 'O mestre já tem 4 câmeras conectadas.' : m.motivo === 'operador' ? 'O operador recusou esta câmera.' : 'Não foi possível conectar.');
        break;
      case 'removida':
        est.ativo = false; pararTudo(); mostrar('tela-conexao'); texto('O operador removeu esta câmera.'); break;
      case 'tally': definirTally(m.estado); break;
      case 'sdp': if (est.pc && m.dados && m.dados.type === 'answer') { try { await est.pc.setRemoteDescription(m.dados); } catch (e) { /* */ } } break;
      case 'ice': if (est.pc && m.dados) { try { await est.pc.addIceCandidate(m.dados); } catch (e) { /* */ } } break;
      case 'renegociar': iniciarPar(); break;
      case 'mestre-offline': faixa(true); chip('Mestre desconectado', 'alerta'); break;
      case 'mensagem': var p = document.querySelector('.mensagem-operador p'); if (p) p.textContent = m.texto; break;
    }
  }

  async function iniciarPar() {
    if (!est.stream) return;
    if (est.pc) { try { est.pc.close(); } catch (e) { /* */ } }
    var pc = est.pc = new RTCPeerConnection({ iceServers: [] });
    est.stream.getTracks().forEach(function (t) { pc.addTrack(t, est.stream); });
    pc.onicecandidate = function (ev) { if (ev.candidate) enviar({ t: 'ice', dados: ev.candidate }); };
    pc.onconnectionstatechange = function () {
      if (est.pc !== pc) return;
      if (pc.connectionState === 'connected') { faixa(false); chip('Conectado · ' + qualidade(), 'ok'); ajustarTaxa(pc); }
      else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') { faixa(true); chip('Reconectando…', 'alerta'); if (pc.connectionState === 'failed') setTimeout(function () { if (est.pc === pc && est.ws && est.ws.readyState === 1) iniciarPar(); }, 1500); }
    };
    try {
      var oferta = await pc.createOffer();
      await pc.setLocalDescription(oferta);
      enviar({ t: 'sdp', dados: pc.localDescription });
    } catch (e) { texto('Falha ao iniciar o envio de vídeo: ' + e.message); }
  }

  async function ajustarTaxa(pc) {
    try {
      pc.getSenders().forEach(function (s) {
        if (!s.track || s.track.kind !== 'video') return;
        var p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = qualidade() === '1080p' ? 6000000 : 3000000;
        p.degradationPreference = 'maintain-resolution';
        s.setParameters(p).catch(function () {});
      });
    } catch (e) { /* navegador sem suporte */ }
  }

  async function pedirTela() {
    try { if (navigator.wakeLock) est.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* sem suporte */ }
  }

  function pararTudo() {
    clearTimeout(est.timer);
    if (est.pc) { try { est.pc.close(); } catch (e) { /* */ } est.pc = null; }
    if (est.stream) { est.stream.getTracks().forEach(function (t) { t.stop(); }); est.stream = null; }
    if (est.ws) { var w = est.ws; est.ws = null; try { w.close(); } catch (e) { /* */ } }
    if (est.wake) { try { est.wake.release(); } catch (e) { /* */ } est.wake = null; }
    est.ativo = false; faixa(false);
  }

  function sair() {
    est.voluntario = true;
    enviar({ t: 'sair' });
    pararTudo();
    texto('Câmera desconectada.');
  }

  async function virar() {
    if (!est.stream) return;
    var nova = est.faceAtual === 'user' ? 'environment' : 'user';
    try {
      var s = await navigator.mediaDevices.getUserMedia({ video: restricoes(nova).video, audio: false });
      var novaFaixa = s.getVideoTracks()[0];
      var antiga = est.stream.getVideoTracks()[0];
      est.stream.addTrack(novaFaixa); est.stream.removeTrack(antiga); antiga.stop();
      est.faceAtual = nova;
      if (est.pc) est.pc.getSenders().forEach(function (sd) { if (sd.track && sd.track.kind === 'video' || (!sd.track)) sd.replaceTrack(novaFaixa).catch(function () {}); });
    } catch (e) { /* aparelho com uma camera so */ }
  }

  function torch(ligar) {
    var t = est.stream && est.stream.getVideoTracks()[0]; if (!t) return;
    try { t.applyConstraints({ advanced: [{ torch: !!ligar }] }).catch(function () {}); } catch (e) { /* */ }
  }

  function atualizarBateria() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) {
      var pct = Math.round(b.level * 100);
      var chips = document.querySelectorAll('.indicadores .chip'); if (chips[1]) chips[1].textContent = '🔋 ' + pct + '%';
      enviar({ t: 'estado', info: { bateria: pct } });
      var av = $('aviso-bateria'); if (av) av.style.display = pct < 15 && !b.charging ? 'block' : 'none';
    }).catch(function () {});
  }

  document.addEventListener('holives:acao', function (e) {
    var d = e.detail || {};
    if (d.tipo === 'camera-adicionar') conectar();
    else if (d.tipo === 'camera-remover') sair();
    else if (d.tipo === 'camera-virar') virar();
    else if (d.tipo === 'camera-microfone') {
      est.stream && est.stream.getAudioTracks().forEach(function (t) { t.enabled = !t.enabled; });
    } else if (d.tipo === 'camera-lanterna') { est.lanterna = !est.lanterna; torch(est.lanterna); }
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-acao="camera-audio"]'); if (!b) return;
    est.audioLigado = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(est.audioLigado));
  });

  document.addEventListener('input', function (e) {
    var t = e.target; if (!t.matches || !t.matches('[data-acao="camera-zoom"]')) return;
    var faixaV = est.stream && est.stream.getVideoTracks()[0]; if (!faixaV) return;
    var rot = t.parentElement.querySelector('.numero'); if (rot) rot.textContent = parseFloat(t.value).toFixed(1) + '×';
    try { faixaV.applyConstraints({ advanced: [{ zoom: parseFloat(t.value) }] }).catch(function () {}); } catch (err) { /* */ }
  });

  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && est.ativo) pedirTela(); });
  window.addEventListener('beforeunload', function () { if (est.ws && est.ws.readyState === 1 && est.voluntario) enviar({ t: 'sair' }); });
  setInterval(function () { if (est.ativo) atualizarBateria(); }, 10000);
})();
