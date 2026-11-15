/* ponte.js - adaptador entre a interface (ui/) e o mundo real.
 * Escuta "holives:acao", substitui os dados simulados de mock.js em window.HolivesState e liga:
 * RTC das cameras, mixer de video, mesa de audio, gravacao e transmissao. */
(function () {
  'use strict';
  var nativo = window.holivesNativo;
  if (!nativo) return; // aberto no navegador comum (sem Electron): continua a simulacao do mock
  window.HolivesReal = true;

  var S = window.HolivesState, N = window.HolivesNucleo;
  var SLOTS = N.SLOTS;
  var info = null, cfg = null;
  var mixer, mesa, gravador, rtc;
  var streams = {};            // slot -> MediaStream recebido
  var videosFonte = {};        // slot -> <video> oculto usado pelo mixer
  var rtcEstado = {}, wsOk = {}, ativos = {};
  var pendentes = {};          // id -> {id, nome}
  var programaAlvo = 'cam1';
  var ultimaPrevia = null;
  var ipAtual = '';

  function $(id) { return document.getElementById(id); }
  function rerender() { if (window.HolivesRenderMestre) window.HolivesRenderMestre(); }
  function fonte(id) { return S.fontes.find(function (f) { return f.id === id; }); }
  function canal(id) { return S.audio.canais.find(function (c) { return c.id === id; }); }
  function guardar(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  function toast(msg, erro) {
    var a = $('toasts'); if (!a) return;
    var t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : '');
    var s1 = document.createElement('strong'); s1.textContent = erro ? 'Erro' : 'Pronto';
    var s2 = document.createElement('span'); s2.textContent = msg;
    t.appendChild(s1); t.appendChild(s2); a.appendChild(t);
    setTimeout(function () { t.remove(); }, erro ? 7000 : 3600);
  }
  function abrirModal(id) { var m = $(id); if (m) m.classList.add('aberto'); }

  // ---------------------------------------------------------------- estado inicial real
  function zerarEstado() {
    S.fontes = SLOTS.map(function (id, i) {
      return { id: id, tipo: 'camera', nome: 'Câmera ' + (i + 1), estado: 'sem-sinal', bateria: null, sinal: 0, resolucao: '—', temAudio: false };
    });
    S.previaId = 'cam2'; S.noArId = 'cam1'; programaAlvo = 'cam1';
    S.cenario = 'primeiro-uso';
    S.transmissao = { estado: 'offline', inicio: null, kbps: 0, fps: cfg.fps, quadrosPerdidos: 0, cpu: 0 };
    S.gravacao = { ativa: false, inicio: null };
    S.aguardando = [];
    S.destinos.forEach(function (d, i) { d.estado = 'desligado'; d.chave = ''; });
    S.destinos[0].servidor = cfg.destino.servidor;
    S.sobreposicoes.holyrics.conexao = 'não configurado';
    S.config.pastaGravacao = cfg.pastaGravacao; S.config.ipMestre = ''; S.config.porta = info.porta;
    S.config.resolucao = cfg.resolucao; S.config.fps = cfg.fps;
    var salvo = guardar('holives.audio') || {};
    S.audio.canais.forEach(function (c) {
      c.nivel = 0;
      var s = salvo[c.id]; if (s) { c.volume = s.volume; c.mudo = s.mudo; if (typeof s.seguirVideo === 'boolean') c.seguirVideo = s.seguirVideo; if (typeof s.atraso === 'number') c.atraso = s.atraso; }
      if (SLOTS.indexOf(c.id) >= 0) c.nome = 'Câmera ' + (SLOTS.indexOf(c.id) + 1);
    });
  }
  function salvarAudio() {
    var o = {}; S.audio.canais.forEach(function (c) { o[c.id] = { volume: c.volume, mudo: c.mudo, seguirVideo: c.seguirVideo, atraso: c.atraso }; });
    guardar('holives.audio', o);
  }

  // ---------------------------------------------------------------- cameras
  function recomputar(slot) {
    var f = fonte(slot); if (!f) return;
    var antes = f.estado, rs = rtcEstado[slot], novo;
    if (!ativos[slot]) novo = 'sem-sinal';
    else if (rs === 'connected') novo = 'conectada';
    else if (rs === 'new' || rs === 'connecting' || rs === 'disconnected') novo = 'conectando';
    else novo = wsOk[slot] ? 'conectando' : 'sem-sinal';
    f.estado = novo;
    if (novo === 'sem-sinal') { f.sinal = 0; }
    var algum = SLOTS.some(function (s) { return ativos[s]; });
    S.cenario = algum || Object.keys(pendentes).length ? 'pronto' : 'primeiro-uso';
    if (antes !== novo) { rerender(); atualizarMonitores(); }
  }

  function iniciarFonteVideo(slot) {
    var v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'position:fixed;left:-9999px;top:0;width:16px;height:9px;opacity:0;pointer-events:none';
    document.body.appendChild(v); videosFonte[slot] = v; mixer.definirFonte(slot, v);
  }

  function aoStream(slot, stream) {
    streams[slot] = stream || null;
    var v = videosFonte[slot];
    if (v) { v.srcObject = stream || null; if (stream) v.play().catch(function () {}); }
    // o audio remoto passa pela mesa; o <video> mudo acima mantem o fluxo "puxado" (necessario no Chromium)
    mesa.definirFonteStream(slot, stream);
    var f = fonte(slot); if (f && stream) f.temAudio = stream.getAudioTracks().length > 0;
    anexarCartoes(); atualizarMonitores();
  }

  function anexarCartoes() {
    document.querySelectorAll('#lista-fontes .fonte-card[data-fonte-id]').forEach(function (card) {
      var v = card.querySelector('video'), s = streams[card.dataset.fonteId];
      if (v && s && v.srcObject !== s) { v.srcObject = s; v.muted = true; v.play().catch(function () {}); }
    });
  }

  function atualizarMonitores() {
    var vp = document.querySelector('#monitor-previa video'), s = streams[S.previaId] || null;
    if (vp && vp.srcObject !== s) { vp.srcObject = s; if (s) vp.play().catch(function () {}); }
  }

  function enviarTally() { rtc.enviarTally(S.previaId, programaAlvo); }

  function renderPendentes() {
    var lista = $('lista-aguardando'); if (!lista) return;
    lista.innerHTML = '';
    var ids = Object.keys(pendentes);
    if (!ids.length) {
      var p = document.createElement('p'); p.className = 'small muted'; p.textContent = 'Nenhuma câmera aguardando.'; lista.appendChild(p); return;
    }
    ids.forEach(function (id) {
      var nome = pendentes[id].nome;
      var linha = document.createElement('div'); linha.className = 'linha';
      linha.style.cssText = 'justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--borda)';
      var n = document.createElement('span'); n.textContent = nome;
      var grupo = document.createElement('span'); grupo.className = 'linha';
      [['aceitar-camera', 'Aceitar'], ['recusar-camera', 'Recusar']].forEach(function (a) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.dataset.acao = a[0]; b.dataset.nome = nome; b.textContent = a[1]; grupo.appendChild(b);
      });
      linha.appendChild(n); linha.appendChild(grupo); lista.appendChild(linha);
    });
  }
  function idPendentePorNome(nome) {
    return Object.keys(pendentes).find(function (id) { return pendentes[id].nome === nome; });
  }

  function aplicarCamera(slot, nome, i) {
    ativos[slot] = true; wsOk[slot] = true;
    var f = fonte(slot); f.nome = nome || f.nome; f.temAudio = !!(i && i.audio);
    var c = canal(slot); if (c) c.nome = f.nome;
    recomputar(slot); rerender();
  }

  function criarRtc() {
    rtc = new window.HolivesRtcMestre(info.portaLocal, {
      aoConectarSinalizacao: function () { enviarTally(); },
      aoRoster: function (m) {
        pendentes = {}; m.pendentes.forEach(function (p) { pendentes[p.id] = p; }); renderPendentes();
        SLOTS.forEach(function (s) { ativos[s] = false; wsOk[s] = false; });
        m.cameras.forEach(function (c) { aplicarCamera(c.slot, c.nome, c.info); wsOk[c.slot] = c.conectada; recomputar(c.slot); });
        SLOTS.forEach(recomputar); rerender(); enviarTally();
      },
      aoPendente: function (p) {
        pendentes[p.id] = p; renderPendentes(); abrirModal('modal-camera'); toast(p.nome + ' quer entrar como câmera.');
      },
      aoPendenteRemovido: function (id) { delete pendentes[id]; renderPendentes(); recomputar('cam1'); },
      aoCameraConectou: function (m) {
        aplicarCamera(m.slot, m.nome, m.info); enviarTally();
        toast(m.nome + (m.reconexao ? ' reconectou.' : ' conectada — aguardando vídeo.'));
      },
      aoCameraDesconectou: function (slot) { wsOk[slot] = false; recomputar(slot); },
      aoCameraRemovida: function (slot) {
        ativos[slot] = false; wsOk[slot] = false; rtcEstado[slot] = 'closed';
        var f = fonte(slot), i = SLOTS.indexOf(slot);
        f.nome = 'Câmera ' + (i + 1); f.bateria = null; f.resolucao = '—'; f.temAudio = false;
        var c = canal(slot); if (c) c.nome = f.nome;
        recomputar(slot); rerender();
      },
      aoStream: aoStream,
      aoEstadoRtc: function (slot, st) { rtcEstado[slot] = st; recomputar(slot); },
      aoEstadoCamera: function (slot, i) { var f = fonte(slot); if (f && typeof i.bateria === 'number') { f.bateria = i.bateria; rerender(); } },
      aoStats: function (slot, st) {
        var f = fonte(slot); if (!f) return;
        if (st.altura) f.resolucao = N.rotuloResolucao(st.altura);
        f.sinal = Math.max(0, Math.min(100, Math.round(100 - (st.perdaPct || 0) * 8)));
      },
      aoErro: function (msg) { toast(msg, true); }
    });
    rtc.conectar();
  }

  // ---------------------------------------------------------------- audio
  function aplicarAudio(constante) { mesa.aplicar(S.audio.canais, programaAlvo, constante); }

  function aplicarPreset(p) {
    var mesaC = canal('mesa'), midia = canal('midia');
    var cams = S.audio.canais.filter(function (c) { return SLOTS.indexOf(c.id) >= 0; });
    cams.forEach(function (c) { c.seguirVideo = true; c.mudo = (p === 'so-mesa'); });
    mesaC.mudo = (p === 'so-video' || p === 'so-camera');
    midia.mudo = (p === 'so-mesa' || p === 'so-camera');
    S.audio.preset = p;
  }

  function atualizarMedidores() {
    var n = mesa.niveis();
    var porId = {};
    S.audio.canais.forEach(function (c) { if (typeof n[c.id] === 'number') c.nivel = c.mudo ? 0 : n[c.id]; porId[c.id] = c; });
    document.querySelectorAll('#canais .canal').forEach(function (el) {
      var fader = el.querySelector('[data-fonte-id]'); if (!fader) return;
      var c = porId[fader.dataset.fonteId], vu = el.querySelector('.vu');
      if (c && vu) vu.style.setProperty('--nivel', String(c.nivel));
    });
  }

  // ---------------------------------------------------------------- config / dispositivos
  function campoPor(rotulo) {
    var ls = document.querySelectorAll('#modal-config .campo > label');
    for (var i = 0; i < ls.length; i++) if (ls[i].textContent.trim().indexOf(rotulo) === 0) return ls[i].parentElement;
    return null;
  }
  function trocarPorSelect(campo, idNovo) {
    var antigo = campo.querySelector('input,select');
    if (antigo && antigo.tagName === 'SELECT') { antigo.id = idNovo; return antigo; }
    var s = document.createElement('select'); s.id = idNovo;
    if (antigo) antigo.replaceWith(s); else campo.appendChild(s);
    return s;
  }
  function opcao(valor, rotulo, selecionado) {
    var o = document.createElement('option'); o.value = valor; o.textContent = rotulo; if (selecionado) o.selected = true; return o;
  }

  async function listarDispositivos(pedirPermissao) {
    var selM = $('cfg-entrada-mesa'), selF = $('cfg-saida-fone'); if (!selM || !selF) return;
    try {
      var lista = await navigator.mediaDevices.enumerateDevices();
      if (pedirPermissao && !lista.some(function (d) { return d.kind === 'audioinput' && d.label; })) {
        try { var t = await navigator.mediaDevices.getUserMedia({ audio: true }); t.getTracks().forEach(function (x) { x.stop(); }); lista = await navigator.mediaDevices.enumerateDevices(); } catch (e) { /* sem permissao: lista sem nomes */ }
      }
      var atualM = selM.value || cfg.entradaMesaId, atualF = selF.value || cfg.saidaFoneId;
      selM.innerHTML = ''; selF.innerHTML = '';
      selM.appendChild(opcao('', '(nenhuma — mesa desligada)', !atualM));
      selF.appendChild(opcao('', 'Padrão do sistema', !atualF));
      lista.forEach(function (d, i) {
        if (d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications') selM.appendChild(opcao(d.deviceId, d.label || 'Entrada de áudio ' + (i + 1), d.deviceId === atualM));
        if (d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications') selF.appendChild(opcao(d.deviceId, d.label || 'Saída de áudio ' + (i + 1), d.deviceId === atualF));
      });
    } catch (e) { /* ignora */ }
  }

  function prepararConfig() {
    var c;
    if ((c = campoPor('Resolução'))) c.querySelector('select').value = cfg.resolucao;
    if ((c = campoPor('FPS'))) c.querySelector('select').value = String(cfg.fps);
    if ((c = campoPor('Dispositivo de entrada da mesa'))) trocarPorSelect(c, 'cfg-entrada-mesa');
    if ((c = campoPor('Dispositivo de saída do fone'))) trocarPorSelect(c, 'cfg-saida-fone');
    if ((c = campoPor('Pasta de gravação'))) { var i = c.querySelector('input'); i.id = 'cfg-pasta'; i.value = cfg.pastaGravacao; }
    if ((c = campoPor('Holyrics'))) { var h = c.querySelector('input'); h.disabled = true; h.title = 'Integração com o Holyrics: fase futura'; }
    if ((c = campoPor('Rede'))) {
      var sel = trocarPorSelect(c, 'cfg-ip');
      info.ips.forEach(function (x) { sel.appendChild(opcao(x.ip, x.ip + ' (' + x.nome + ')', x.ip === ipAtual)); });
      if (!info.ips.length) sel.appendChild(opcao('', 'Nenhuma rede encontrada', true));
      sel.addEventListener('change', function () { definirIp(sel.value); });
    }
  }

  async function definirIp(ip) {
    if (!ip) return;
    ipAtual = ip; S.config.ipMestre = ip;
    var r = await nativo.qr(ip); if (!r) return;
    var qr = document.querySelector('#modal-camera .qr');
    if (qr) {
      qr.innerHTML = '';
      var img = document.createElement('img'); img.src = r.imagem; img.alt = 'QR code para ' + r.url;
      img.style.cssText = 'width:100%;height:100%;image-rendering:pixelated';
      qr.style.padding = '4px'; qr.appendChild(img);
    }
    var p = document.querySelector('#modal-camera p');
    if (p) { p.innerHTML = ''; var st = document.createElement('strong'); st.textContent = 'Endereço:'; p.appendChild(st); p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(r.url)); }
  }

  function lerDestino() {
    var card = document.querySelector('#modal-destinos .destino-card');
    var ins = card.querySelectorAll('input'), sw = card.querySelector('.switch');
    return { servidor: ins[0].value.trim(), chave: ins[1].value.trim(), ativo: sw.getAttribute('aria-checked') === 'true' };
  }
  function preencherDestino() {
    var card = document.querySelector('#modal-destinos .destino-card'), ins = card.querySelectorAll('input');
    ins[0].value = cfg.destino.servidor; ins[1].value = cfg.destino.chave; // a chave so vem do cofre do sistema, nunca do codigo
    ins[1].autocomplete = 'off';
    document.querySelectorAll('#modal-destinos .destino-card').forEach(function (cd, i) {
      if (i > 0) { var x = cd.querySelectorAll('input'); x.forEach(function (inp) { if (inp.type === 'password') inp.value = ''; }); }
    });
    var cs = document.querySelectorAll('#modal-destinos .destino-card .switch');
    if (cs[0]) cs[0].setAttribute('aria-checked', 'true');
    if (cs[1]) cs[1].setAttribute('aria-checked', 'false');
    if (cs[2]) cs[2].setAttribute('aria-checked', 'false');
    var aviso = document.createElement('p'); aviso.className = 'small muted';
    aviso.textContent = 'Fase 1: apenas o primeiro destino (YouTube) transmite. Facebook, Instagram e destinos extras vêm em fase futura.';
    card.parentElement.insertBefore(aviso, card);
  }
  function atualizarEstadoDestino() {
    var d = lerDestino();
    S.destinos[0].estado = S.transmissao.estado === 'ao-vivo' ? 'ao-vivo' : (d.ativo && d.chave ? 'pronto' : 'desligado');
  }

  function aplicarVideoCfg() {
    if (gravador.estaAtivo('live') || gravador.estaAtivo('gravacao')) return false;
    var r = N.resolucaoDe(cfg.resolucao); mixer.configurar(r.largura, r.altura, cfg.fps); return true;
  }

  async function salvarConfig() {
    var selRes = campoPor('Resolução').querySelector('select'), selFps = campoPor('FPS').querySelector('select');
    var antesMesa = cfg.entradaMesaId, antesFone = cfg.saidaFoneId;
    cfg.resolucao = selRes.value; cfg.fps = parseInt(selFps.value, 10) === 60 ? 60 : 30;
    cfg.entradaMesaId = ($('cfg-entrada-mesa') || {}).value || '';
    cfg.saidaFoneId = ($('cfg-saida-fone') || {}).value || '';
    cfg.pastaGravacao = ($('cfg-pasta') || {}).value || cfg.pastaGravacao;
    await nativo.configSalvar({ pastaGravacao: cfg.pastaGravacao, resolucao: cfg.resolucao, fps: cfg.fps, entradaMesaId: cfg.entradaMesaId, saidaFoneId: cfg.saidaFoneId, ipEscolhido: ipAtual });
    if (!aplicarVideoCfg()) toast('Resolução e FPS valem a partir da próxima gravação/transmissão.');
    S.transmissao.fps = cfg.fps;
    if (cfg.entradaMesaId !== antesMesa) {
      var r = await mesa.definirEntradaMesa(cfg.entradaMesaId);
      if (!r.ok) toast(r.erro, true); else if (cfg.entradaMesaId) toast('Entrada da mesa de som ligada.');
    }
    if (cfg.saidaFoneId !== antesFone) { var ok = await mesa.definirSaidaFone(cfg.saidaFoneId); if (!ok && cfg.saidaFoneId) toast('Não foi possível trocar a saída do fone.', true); }
  }

  // ---------------------------------------------------------------- gravacao e transmissao
  function streamMisto() {
    return new MediaStream([].concat(mixer.stream.getVideoTracks(), mesa.destino.stream.getAudioTracks()));
  }
  function kbpsVideo() { return (cfg.resolucao === '720p' ? 4000 : 6000) * (cfg.fps === 60 ? 1.5 : 1); }

  function falhaLive(msg) {
    S.transmissao.estado = 'offline'; S.transmissao.kbps = 0; atualizarEstadoDestino();
    if (S.destinos[0].estado !== 'desligado') S.destinos[0].estado = 'erro';
    toast(msg, true); rerender();
  }
  function falhaGravacao(msg) { S.gravacao.ativa = false; toast(msg, true); rerender(); }

  async function iniciarLive() {
    if (gravador.estaAtivo('live')) return;
    var d = lerDestino(), v = N.montarUrlRtmp(d.servidor, d.chave);
    if (!d.ativo) { abrirModal('modal-destinos'); return falhaLive('O destino YouTube está desligado. Ative-o em Destinos.'); }
    if (!v.ok) { abrirModal('modal-destinos'); return falhaLive(v.erro); }
    await mesa.retomar(); aplicarVideoCfg();
    var r = await gravador.iniciar('live', streamMisto(), { fps: cfg.fps, kbps: kbpsVideo(), servidor: d.servidor, chave: d.chave });
    if (!r.ok) return falhaLive(r.erro);
    S.transmissao.estado = 'ao-vivo'; S.destinos[0].estado = 'ao-vivo'; rerender();
  }

  async function encerrarLive() {
    await gravador.parar('live');
    if (gravador.estaAtivo('gravacao')) { await gravador.parar('gravacao'); S.gravacao.ativa = false; }
    S.transmissao.estado = 'offline'; S.transmissao.kbps = 0; atualizarEstadoDestino(); rerender();
  }

  async function iniciarGravacao() {
    if (gravador.estaAtivo('gravacao')) return;
    await mesa.retomar(); aplicarVideoCfg();
    var r = await gravador.iniciar('gravacao', streamMisto(), { fps: cfg.fps, kbps: kbpsVideo() });
    if (!r.ok) return falhaGravacao(r.erro);
    toast('Gravando em: ' + r.caminho);
  }

  nativo.aoStatusFfmpeg(function (s) {
    if (s.job === 'live' && s.estado === 'progresso') {
      var p = s.progresso;
      if (typeof p.kbps === 'number') S.transmissao.kbps = p.kbps;
      if (typeof p.fps === 'number') S.transmissao.fps = Math.round(p.fps);
      if (p.quadros) S.transmissao.quadrosPerdidos = 100 * (p.perdidos || 0) / p.quadros;
    } else if (s.estado === 'erro') {
      if (s.job === 'live') { gravador.parar('live'); falhaLive('A transmissão caiu. ' + (s.mensagem || '')); }
      else { gravador.parar('gravacao'); falhaGravacao('A gravação parou com erro. ' + (s.mensagem || '')); }
    } else if (s.estado === 'encerrado' && s.job === 'gravacao' && s.caminho) {
      toast('Gravação salva em: ' + s.caminho);
    }
  });

  // ---------------------------------------------------------------- eventos da interface
  function lidar(d) {
    switch (d.tipo) {
      case 'cortar': {
        var alvo = d.fonteId || S.previaId;
        programaAlvo = alvo; mixer.cortar(alvo); S.noArId = alvo;
        aplicarAudio(0.01); enviarTally(); break;
      }
      case 'transicao': {
        var dur = S.transicao.duracao || 500, alvoT = S.previaId;
        if (alvoT === programaAlvo) break;
        programaAlvo = alvoT;
        mixer.transicionar(alvoT, d.estilo || S.transicao.tipo, dur);
        aplicarAudio(Math.max(0.02, dur / 3000)); enviarTally(); break;
      }
      case 'audio-volume':
        if (d.preset) aplicarPreset(d.preset);
        aplicarAudio(); salvarAudio(); rerender(); break;
      case 'audio-mudo': case 'audio-seguir-video': aplicarAudio(); salvarAudio(); break;
      case 'audio-atraso': { var m = canal('mesa'); mesa.definirAtraso(m.atraso); salvarAudio(); break; }
      case 'camera-adicionar': { var id = idPendentePorNome(d.nome); if (id) rtc.aceitar(id); break; }
      case 'camera-remover': { var id2 = idPendentePorNome(d.nome); if (id2) rtc.recusar(id2); break; }
      case 'iniciar-live': iniciarLive(); break;
      case 'encerrar-live': encerrarLive(); break;
      case 'iniciar-gravacao': iniciarGravacao(); break;
      case 'parar-gravacao': gravador.parar('gravacao'); break;
      case 'config-salvar': salvarConfig(); break;
      case 'destino-salvar': {
        var dd = lerDestino();
        nativo.configSalvar({ destino: { servidor: dd.servidor, chave: dd.chave } });
        atualizarEstadoDestino(); rerender();
        if (dd.chave && !cfg.podeGuardarChave) toast('Este sistema não tem cofre de senhas: a chave não será lembrada ao fechar.');
        break;
      }
      default: break;
    }
  }

  function ligarEventos() {
    document.addEventListener('holives:acao', function (e) { lidar(e.detail || {}); });

    // a interface nao trata estes dois botoes por conta propria
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-acao]'); if (!b) return;
      if (b.dataset.acao === 'audio-ouvir') {
        var c = canal(b.dataset.fonteId); if (c) { c.ouvir = !c.ouvir; aplicarAudio(); rerender(); }
      }
      if (b.dataset.acao === 'destino-alternar') {
        b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')); atualizarEstadoDestino(); rerender();
      }
      if (b.dataset.acao === 'abrir-config') listarDispositivos(true);
      if (b.dataset.acao === 'testar-destino') toast('Teste de conexão ainda não existe: use "Iniciar transmissão".');
      if (b.dataset.acao === 'camera-adicionar' || b.closest('#lista-fontes') && b.classList.contains('vazio')) { renderPendentes(); }
      mesa.retomar();
    });
    document.addEventListener('keydown', function () { mesa.retomar(); });

    // F2 (cenarios simulados) nao faz sentido com dados reais
    window.addEventListener('keydown', function (e) { if (e.key === 'F2') { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

    new MutationObserver(anexarCartoes).observe($('lista-fontes'), { childList: true });
    if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', function () { listarDispositivos(false); });

    // card/teclado mudam S.previaId sem emitir evento: observa por polling leve
    setInterval(function () {
      if (S.previaId !== ultimaPrevia) { ultimaPrevia = S.previaId; atualizarMonitores(); if (rtc) enviarTally(); }
      if (S.noArId !== programaAlvo) { S.noArId = programaAlvo; rerender(); }
    }, 100);
    setInterval(atualizarMedidores, 80);
    setInterval(async function () { S.transmissao.cpu = await nativo.cpu(); }, 2000);
    window.addEventListener('beforeunload', function () { rtc && rtc.fechar(); });
  }

  // ---------------------------------------------------------------- partida
  async function iniciar() {
    info = await nativo.info(); cfg = await nativo.configObter();
    if (!info || !cfg) return;
    zerarEstado();

    var res = N.resolucaoDe(cfg.resolucao);
    mixer = new window.HolivesMixerVideo({
      largura: res.largura, altura: res.altura, fps: cfg.fps,
      aoTerminarTransicao: function (id) { S.noArId = id; rerender(); }
    });
    SLOTS.forEach(iniciarFonteVideo);
    mixer.programaId = 'cam1';
    mixer.iniciar();
    var vAr = document.querySelector('#monitor-no-ar video');
    if (vAr) { vAr.srcObject = mixer.stream; vAr.play().catch(function () {}); }

    mesa = new window.HolivesMesaAudio().iniciar(S.audio.canais.map(function (c) { return c.id; }));
    var cm = canal('mesa'); mesa.definirAtraso(cm.atraso);
    aplicarAudio();
    gravador = new window.HolivesGravador(nativo);

    // painel de cameras: QR code, endereco e lista de aprovacao reais
    var h3s = document.querySelectorAll('#modal-camera h3'), titulo = h3s[h3s.length - 1];
    if (titulo) {
      var cont = document.createElement('div'); cont.id = 'lista-aguardando';
      var ant = titulo.nextElementSibling; while (ant && ant.classList && ant.classList.contains('linha')) { var prox = ant.nextElementSibling; ant.remove(); ant = prox; }
      titulo.after(cont);
    }
    renderPendentes();
    ipAtual = (info.ips.find(function (x) { return x.ip === cfg.ipEscolhido; }) || info.ips[0] || {}).ip || '';
    prepararConfig(); preencherDestino(); atualizarEstadoDestino();
    await listarDispositivos(false);
    if (ipAtual) await definirIp(ipAtual); else { var q = document.querySelector('#modal-camera .qr'); if (q) q.textContent = 'Sem rede'; }

    criarRtc();
    ligarEventos();
    if (cfg.entradaMesaId) { var r = await mesa.definirEntradaMesa(cfg.entradaMesaId); if (!r.ok) toast(r.erro, true); }
    if (cfg.saidaFoneId) mesa.definirSaidaFone(cfg.saidaFoneId);
    ultimaPrevia = S.previaId; atualizarMonitores();
    rerender();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { iniciar(); });
  else iniciar();
})();
