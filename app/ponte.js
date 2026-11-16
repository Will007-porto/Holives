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
  var fase2 = null;            // fontes locais, midia e layout vertical (ponte-fase2.js)
  var destinos = [];           // {id, nome, servidor, chave, formato, ativo, estado}
  var grupos = { live: [], 'live-v': [] }; // destinos de cada codificacao em andamento
  var verticalEmUso = false;
  var EXTRAS = [
    { id: 'webcam', tipo: 'webcam', nome: 'Câmera do computador' },
    { id: 'captura', tipo: 'captura', nome: 'Datashow' },
    { id: 'tela', tipo: 'tela', nome: 'Tela do computador' },
    { id: 'midia', tipo: 'midia', nome: 'Tela de mídia' }
  ];

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
    }).concat(EXTRAS.map(function (x) {
      return { id: x.id, tipo: x.tipo, nome: x.nome, estado: 'sem-sinal', bateria: null, sinal: 0, resolucao: '—', temAudio: false };
    }));
    S.previaId = 'cam2'; S.noArId = 'cam1'; programaAlvo = 'cam1';
    S.cenario = 'primeiro-uso';
    S.transmissao = { estado: 'offline', inicio: null, kbps: 0, fps: cfg.fps, quadrosPerdidos: 0, cpu: 0 };
    S.gravacao = { ativa: false, inicio: null };
    S.aguardando = [];
    destinos = cfg.destinos.map(function (d) {
      return { id: d.id, nome: d.nome, servidor: d.servidor, chave: d.chave, formato: d.formato, ativo: d.ativo, estado: 'desligado' };
    });
    recalcularDestinos();
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

  // ---------------------------------------------------------------- destinos (varios ao mesmo tempo)
  var FIXOS = ['youtube', 'facebook', 'instagram'];
  var DICAS = {
    youtube: 'No YouTube Studio: Criar > Transmitir ao vivo > copie a "Chave de transmissão".',
    facebook: 'No Facebook: Vídeo ao vivo > Software de streaming > copie a "Chave de stream".',
    instagram: 'No Instagram pelo computador (conta profissional): Criar > Vídeo ao vivo > copie a URL e a chave. Sempre vertical 9:16.'
  };
  function aoVivo() { return gravador && (gravador.estaAtivo('live') || gravador.estaAtivo('live-v')); }
  /** Estado de cada destino fora do ar: "pronto" se ligado e com chave. Nao mexe em quem esta ao vivo/erro durante a live. */
  function recalcularDestinos() {
    var vivo = aoVivo();
    destinos.forEach(function (d) {
      if (vivo && (d.estado === 'ao-vivo' || d.estado === 'erro')) return;
      d.estado = d.ativo && d.chave && d.servidor ? 'pronto' : 'desligado';
    });
    S.destinos = destinos.map(function (d) { return { id: d.id, nome: d.nome, estado: d.estado, formato: d.formato }; });
  }
  function elemento(tag, classe, texto) { var e = document.createElement(tag); if (classe) e.className = classe; if (texto) e.textContent = texto; return e; }

  function renderDestinos() {
    var caixa = document.querySelector('#modal-destinos .modal-caixa'); if (!caixa) return;
    caixa.querySelectorAll('.destino-card, .aviso-destinos').forEach(function (x) { x.remove(); });
    var ancora = caixa.querySelector('[data-acao="destino-adicionar"]');
    var aviso = elemento('p', 'small muted aviso-destinos', 'Ligue os destinos que vão receber a live. Todos os ligados transmitem ao mesmo tempo. As chaves ficam guardadas cifradas neste computador.');
    aviso.style.marginBottom = '12px';
    caixa.insertBefore(aviso, ancora);
    destinos.forEach(function (d) {
      var fixo = FIXOS.indexOf(d.id) >= 0;
      var card = elemento('div', 'destino-card'); card.dataset.destinoId = d.id;
      var topo = elemento('div', 'linha'); topo.style.justifyContent = 'space-between';
      if (fixo) topo.appendChild(elemento('strong', '', d.nome + (d.id === 'instagram' ? ' — sempre vertical' : '')));
      else { var nome = elemento('input'); nome.dataset.campo = 'nome'; nome.value = d.nome; nome.maxLength = 40; nome.setAttribute('aria-label', 'Nome do destino'); nome.style.maxWidth = '260px'; topo.appendChild(nome); }
      var lado = elemento('span', 'linha');
      if (!fixo) { var rm = elemento('button', 'btn', 'Remover'); rm.type = 'button'; rm.dataset.acao = 'destino-remover'; lado.appendChild(rm); }
      var sw = elemento('button', 'switch'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(!!d.ativo));
      sw.setAttribute('aria-label', 'Ativar ' + d.nome); sw.dataset.acao = 'destino-ligar';
      lado.appendChild(sw); topo.appendChild(lado); card.appendChild(topo);
      [['servidor', 'Endereço do servidor', 'text'], ['chave', 'Chave de transmissão', 'password']].forEach(function (c) {
        var campo = elemento('div', 'campo'), id = 'dest-' + d.id + '-' + c[0];
        var l = elemento('label', '', c[1]); l.htmlFor = id;
        var i = elemento('input'); i.id = id; i.type = c[2]; i.dataset.campo = c[0]; i.value = d[c[0]] || ''; i.autocomplete = 'off'; i.spellcheck = false;
        if (c[0] === 'servidor') i.placeholder = 'rtmp:// ou rtmps://';
        campo.appendChild(l); campo.appendChild(i); card.appendChild(campo);
      });
      if (d.id !== 'instagram') {
        var linha = elemento('div', 'linha'), sel = elemento('select'); sel.dataset.campo = 'formato'; sel.setAttribute('aria-label', 'Formato de ' + d.nome);
        sel.appendChild(opcao('horizontal', 'Horizontal 16:9', d.formato !== 'vertical')); sel.appendChild(opcao('vertical', 'Vertical 9:16', d.formato === 'vertical'));
        linha.appendChild(sel); card.appendChild(linha);
      }
      if (DICAS[d.id]) card.appendChild(elemento('p', 'small muted', DICAS[d.id]));
      caixa.insertBefore(card, ancora);
    });
  }
  /** Passa o que esta digitado na janela para a lista de destinos. */
  function lerDestinosDoModal() {
    document.querySelectorAll('#modal-destinos .destino-card').forEach(function (card) {
      var d = destinos.find(function (x) { return x.id === card.dataset.destinoId; }); if (!d) return;
      var v = function (c) { var e = card.querySelector('[data-campo="' + c + '"]'); return e ? e.value.trim() : null; };
      d.servidor = v('servidor') || ''; d.chave = v('chave') || '';
      if (v('nome') !== null) d.nome = v('nome') || 'Destino extra';
      d.formato = d.id === 'instagram' ? 'vertical' : (v('formato') === 'vertical' ? 'vertical' : 'horizontal');
      d.ativo = card.querySelector('.switch').getAttribute('aria-checked') === 'true';
    });
  }
  function salvarDestinos() {
    lerDestinosDoModal();
    nativo.configSalvar({ destinos: destinos.map(function (d) { return { id: d.id, nome: d.nome, servidor: d.servidor, chave: d.chave, formato: d.formato, ativo: d.ativo }; }) });
    recalcularDestinos(); rerender();
    if (destinos.some(function (d) { return d.chave; }) && !cfg.podeGuardarChave) toast('Este sistema não tem cofre de senhas: as chaves não serão lembradas ao fechar.');
    if (aoVivo()) toast('As mudanças nos destinos valem a partir da próxima transmissão.');
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

  function streamVertical() {
    return new MediaStream([].concat(fase2.vertical.stream.getVideoTracks(), mesa.destino.stream.getAudioTracks()));
  }
  function soltarVertical() { if (verticalEmUso) { verticalEmUso = false; fase2.vertical.soltar(); } }
  function marcarGrupo(job, estado) { grupos[job].forEach(function (d) { d.estado = estado; }); }

  function falhaLive(msg) {
    S.transmissao.estado = 'offline'; S.transmissao.kbps = 0;
    grupos.live = []; grupos['live-v'] = []; soltarVertical();
    recalcularDestinos();
    toast(msg, true); rerender();
  }
  function falhaGravacao(msg) { S.gravacao.ativa = false; toast(msg, true); rerender(); }

  async function iniciarLive() {
    if (aoVivo()) return;
    var ligados = destinos.filter(function (d) { return d.ativo; });
    if (!ligados.length) { abrirModal('modal-destinos'); return falhaLive('Nenhum destino está ligado. Ative pelo menos um em Destinos.'); }
    for (var i = 0; i < ligados.length; i++) {
      var v = N.montarUrlRtmp(ligados[i].servidor, ligados[i].chave);
      if (!v.ok) { abrirModal('modal-destinos'); return falhaLive(ligados[i].nome + ': ' + v.erro); }
    }
    var hor = ligados.filter(function (d) { return d.formato !== 'vertical'; });
    var ver = ligados.filter(function (d) { return d.formato === 'vertical'; });
    var paraFfmpeg = function (l) { return l.map(function (d) { return { servidor: d.servidor, chave: d.chave }; }); };
    await mesa.retomar(); aplicarVideoCfg();
    var erros = [], algum = false, r;
    if (hor.length) {
      r = await gravador.iniciar('live', streamMisto(), { fps: cfg.fps, kbps: kbpsVideo(), destinos: paraFfmpeg(hor) });
      grupos.live = hor;
      if (r.ok) { marcarGrupo('live', 'ao-vivo'); algum = true; } else { marcarGrupo('live', 'erro'); grupos.live = []; erros.push(r.erro); }
    }
    if (ver.length) {
      verticalEmUso = true; fase2.vertical.usar();
      // 720x1280 a 30 quadros: o que o Instagram aceita
      r = await gravador.iniciar('live-v', streamVertical(), { fps: 30, kbps: 3500, destinos: paraFfmpeg(ver) });
      grupos['live-v'] = ver;
      if (r.ok) { marcarGrupo('live-v', 'ao-vivo'); algum = true; } else { marcarGrupo('live-v', 'erro'); grupos['live-v'] = []; soltarVertical(); erros.push(r.erro); }
    }
    if (!algum) return falhaLive(erros.join(' '));
    S.transmissao.estado = 'ao-vivo'; recalcularDestinos(); rerender();
    if (erros.length) toast('Parte dos destinos não iniciou: ' + erros.join(' '), true);
  }

  async function encerrarLive() {
    await Promise.all([gravador.parar('live'), gravador.parar('live-v')]);
    grupos.live = []; grupos['live-v'] = []; soltarVertical();
    if (gravador.estaAtivo('gravacao')) { await gravador.parar('gravacao'); S.gravacao.ativa = false; }
    S.transmissao.estado = 'offline'; S.transmissao.kbps = 0;
    destinos.forEach(function (d) { d.estado = 'desligado'; }); recalcularDestinos(); rerender();
  }

  /** Uma das codificacoes (horizontal ou vertical) caiu inteira. */
  function quedaDeGrupo(job, mensagem) {
    var nomes = grupos[job].map(function (d) { return d.nome; }).join(', ');
    gravador.parar(job);
    marcarGrupo(job, 'erro'); grupos[job] = [];
    if (job === 'live-v') soltarVertical();
    var outro = job === 'live' ? 'live-v' : 'live';
    if (gravador.estaAtivo(outro) && grupos[outro].length) {
      S.destinos = destinos.map(function (d) { return { id: d.id, nome: d.nome, estado: d.estado, formato: d.formato }; });
      toast(nomes + ' caiu. Os outros destinos continuam no ar. ' + (mensagem || ''), true); rerender();
    } else falhaLive('A transmissão caiu (' + nomes + '). ' + (mensagem || ''));
  }

  async function iniciarGravacao() {
    if (gravador.estaAtivo('gravacao')) return;
    await mesa.retomar(); aplicarVideoCfg();
    var r = await gravador.iniciar('gravacao', streamMisto(), { fps: cfg.fps, kbps: kbpsVideo() });
    if (!r.ok) return falhaGravacao(r.erro);
    toast('Gravando em: ' + r.caminho);
  }

  nativo.aoStatusFfmpeg(function (s) {
    var ehLive = s.job === 'live' || s.job === 'live-v';
    if (ehLive && s.estado === 'progresso') {
      // os indicadores do topo mostram a codificacao horizontal; a vertical so quando e a unica
      if (s.job === 'live-v' && gravador.estaAtivo('live')) return;
      var p = s.progresso;
      if (typeof p.kbps === 'number') S.transmissao.kbps = p.kbps;
      if (typeof p.fps === 'number') S.transmissao.fps = Math.round(p.fps);
      if (p.quadros) S.transmissao.quadrosPerdidos = 100 * (p.perdidos || 0) / p.quadros;
    } else if (ehLive && s.estado === 'destino-falhou') {
      var caiu = grupos[s.job][s.indice];
      if (caiu && caiu.estado !== 'erro') {
        caiu.estado = 'erro';
        S.destinos = destinos.map(function (d) { return { id: d.id, nome: d.nome, estado: d.estado, formato: d.formato }; });
        toast(caiu.nome + ' caiu. Os outros destinos continuam no ar.', true); rerender();
      }
    } else if (s.estado === 'erro') {
      if (ehLive) { if (grupos[s.job].length) quedaDeGrupo(s.job, s.mensagem); }
      else { gravador.parar('gravacao'); falhaGravacao('A gravação parou com erro. ' + (s.mensagem || '')); }
    } else if (s.estado === 'encerrado' && s.job === 'gravacao' && s.caminho) {
      toast('Gravação salva em: ' + s.caminho);
    }
  });

  // ---------------------------------------------------------------- eventos da interface
  function lidar(d) {
    switch (d.tipo) {
      case 'cortar': {
        var alvo = d.fonteId || S.previaId, antesC = programaAlvo;
        programaAlvo = alvo; mixer.cortar(alvo); S.noArId = alvo;
        aplicarAudio(0.01); enviarTally();
        if (fase2 && antesC !== alvo) fase2.aoMudarPrograma(antesC, alvo);
        break;
      }
      case 'transicao': {
        var dur = S.transicao.duracao || 500, alvoT = S.previaId;
        if (alvoT === programaAlvo) break;
        var antesT = programaAlvo;
        programaAlvo = alvoT;
        mixer.transicionar(alvoT, d.estilo || S.transicao.tipo, dur);
        aplicarAudio(Math.max(0.02, dur / 3000)); enviarTally();
        if (fase2) fase2.aoMudarPrograma(antesT, alvoT);
        break;
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
      if (b.dataset.acao === 'destino-ligar') b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
      if (b.dataset.acao === 'destino-adicionar') {
        lerDestinosDoModal();
        if (destinos.length >= 8) toast('O limite é de 8 destinos.', true);
        else { destinos.push({ id: 'extra' + Date.now(), nome: 'Destino extra', servidor: '', chave: '', formato: 'horizontal', ativo: true, estado: 'desligado' }); renderDestinos(); }
      }
      if (b.dataset.acao === 'destino-remover') {
        lerDestinosDoModal();
        var idRm = b.closest('.destino-card').dataset.destinoId;
        destinos = destinos.filter(function (x) { return x.id !== idRm; }); renderDestinos();
      }
      if (b.dataset.acao === 'abrir-destinos') renderDestinos();
      if (b.dataset.acao === 'destino-salvar' && b.closest('#modal-destinos')) salvarDestinos();
      if (b.dataset.acao === 'abrir-config') listarDispositivos(true);
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
      // o guia de primeiro uso some assim que qualquer fonte (camera, webcam, tela, midia) tem sinal
      var cen = (S.fontes.some(function (f) { return f.estado === 'conectada'; }) || Object.keys(pendentes).length || SLOTS.some(function (x) { return ativos[x]; })) ? 'pronto' : 'primeiro-uso';
      if (cen !== S.cenario) { S.cenario = cen; rerender(); }
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
    prepararConfig(); renderDestinos();
    await listarDispositivos(false);
    if (ipAtual) await definirIp(ipAtual); else { var q = document.querySelector('#modal-camera .qr'); if (q) q.textContent = 'Sem rede'; }

    // fontes locais, tela de midia e layout vertical
    if (window.HolivesFase2) {
      fase2 = window.HolivesFase2.iniciar({
        S: S, N: N, nativo: nativo, cfg: cfg, mixer: mixer, mesa: mesa, streams: streams,
        toast: toast, rerender: rerender, fonte: fonte, canal: canal, campoPor: campoPor, opcao: opcao,
        aoStream: aoStream, iniciarFonteVideo: iniciarFonteVideo, anexarCartoes: anexarCartoes, atualizarMonitores: atualizarMonitores,
        aplicarAudio: aplicarAudio, salvarAudio: salvarAudio,
        programa: function () { return programaAlvo; },
        cortar: function (id) { lidar({ tipo: 'cortar', fonteId: id }); rerender(); }
      });
    }

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
