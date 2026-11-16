/* nucleo.js - funcoes puras compartilhadas (renderer e Node). Sem acesso a DOM, rede ou disco. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.HolivesNucleo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  var MAX_CAMERAS = 4;
  var SLOTS = ['cam1', 'cam2', 'cam3', 'cam4'];

  /** dB (-60..0) -> ganho linear. Abaixo de -60 dB vira silencio. */
  function dbParaLinear(db) {
    if (typeof db !== 'number' || !isFinite(db) || db <= -60) return 0;
    if (db > 6) db = 6;
    return Math.pow(10, db / 20);
  }

  /** RMS linear (0..1) -> nivel do medidor (0..1), escala de -60 dBFS a 0 dBFS. */
  function nivelDeRms(rms) {
    if (!(rms > 0)) return 0;
    var db = 20 * Math.log10(rms);
    return Math.max(0, Math.min(1, (db + 60) / 60));
  }

  /**
   * Ganho efetivo de um canal.
   * canal: {id, volume(dB), mudo, seguirVideo}; noArId: id da fonte no ar.
   * Canais de camera com "seguir video" so soam quando a camera esta no ar.
   */
  function ganhoEfetivo(canal, noArId) {
    if (canal.mudo) return 0;
    var ehCamera = SLOTS.indexOf(canal.id) >= 0;
    if (ehCamera && canal.seguirVideo && canal.id !== noArId) return 0;
    return dbParaLinear(canal.volume);
  }

  /** Converte "720p"/"1080p" em {largura, altura}. */
  function resolucaoDe(texto) {
    return String(texto) === '720p' ? { largura: 1280, altura: 720 } : { largura: 1920, altura: 1080 };
  }

  /** Estado do tally para cada slot a partir de previa e no ar. */
  function calcularTally(previaId, noArId) {
    var r = {};
    SLOTS.forEach(function (s) { r[s] = s === noArId ? 'no-ar' : s === previaId ? 'previa' : 'espera'; });
    return r;
  }

  /** Valida o endereco RTMP e monta a URL final com a chave. Retorna {ok, url, erro}. */
  function montarUrlRtmp(servidor, chave) {
    servidor = String(servidor || '').trim();
    chave = String(chave || '').trim();
    if (!/^rtmps?:\/\/[^\s]+$/i.test(servidor)) return { ok: false, erro: 'Endereço do servidor inválido. Use rtmp:// ou rtmps://' };
    if (!chave) return { ok: false, erro: 'Informe a chave de transmissão.' };
    if (/\s/.test(chave)) return { ok: false, erro: 'A chave de transmissão não pode ter espaços.' };
    return { ok: true, url: servidor.replace(/\/+$/, '') + '/' + chave };
  }

  /** Remove a chave de qualquer texto (logs, mensagens de erro). */
  function redigirChave(texto, chave) {
    texto = String(texto == null ? '' : texto);
    if (chave) texto = texto.split(chave).join('***');
    return texto.replace(/(rtmps?:\/\/[^\s\/]+\/[^\s\/]*\/)[^\s]+/gi, '$1***');
  }

  /**
   * Monta os argumentos do ffmpeg.
   * opcoes: {tipo:'arquivo'|'rtmp', mime, caminho, url, kbps, fps}
   * A entrada e o fluxo WebM do MediaRecorder lido por stdin.
   */
  function argsFfmpeg(o) {
    var fps = o.fps || 30;
    var args = ['-hide_banner', '-loglevel', 'info', '-stats', '-f', 'webm', '-i', 'pipe:0'];
    var h264 = /h264|avc1/i.test(o.mime || '');
    if (o.tipo === 'arquivo') {
      if (h264) args.push('-c:v', 'copy');
      else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', String(fps * 2));
      args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', o.caminho);
    } else {
      var kbps = o.kbps || 4500;
      var urls = o.urls && o.urls.length ? o.urls : [o.url];
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
        '-b:v', kbps + 'k', '-maxrate', kbps + 'k', '-bufsize', (kbps * 2) + 'k',
        '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
      if (urls.length === 1) args.push('-f', 'flv', urls[0]);
      else {
        // varios destinos com uma unica codificacao; se um cair, os outros continuam (onfail=ignore)
        args.push('-flags', '+global_header', '-map', '0:v:0', '-map', '0:a:0', '-f', 'tee',
          urls.map(function (u) { return '[f=flv:onfail=ignore]' + escaparTee(u); }).join('|'));
      }
    }
    return args;
  }

  /** Escapa um endereco para o muxer "tee" do ffmpeg. */
  function escaparTee(url) {
    return String(url).replace(/[\\'|\[\]]/g, function (c) { return '\\' + c; });
  }

  /** Linha do ffmpeg avisando que um dos destinos do "tee" caiu -> indice (0..n) ou -1. */
  function parseFalhaTee(linha) {
    var m = /Slave muxer #(\d+) failed/i.exec(String(linha || ''));
    return m ? parseInt(m[1], 10) : -1;
  }

  /** Volume 0..100 (controle deslizante simples) -> dB (-60..0). */
  function percentualParaDb(p) {
    p = Math.max(0, Math.min(100, Number(p) || 0));
    if (p <= 0) return -60;
    return Math.max(-60, Math.round(20 * Math.log10(p / 100) * 1.5));
  }

  /**
   * Layout vertical 9:16: o video 16:9 fica deitado no meio, com uma faixa em cima e outra embaixo.
   * Retorna os retangulos {x,y,w,h} de cada parte.
   */
  function layoutVertical(largura, altura) {
    var hVideo = Math.round(largura * 9 / 16);
    var topo = Math.floor((altura - hVideo) / 2);
    return {
      topo: { x: 0, y: 0, w: largura, h: topo },
      video: { x: 0, y: topo, w: largura, h: hVideo },
      base: { x: 0, y: topo + hVideo, w: largura, h: altura - topo - hVideo }
    };
  }

  /** Retangulo de origem para preencher (cortando as sobras) um destino dw x dh com uma imagem sw x sh. */
  function recorteCobrir(sw, sh, dw, dh) {
    var r = Math.max(dw / sw, dh / sh), w = dw / r, h = dh / r;
    return { sx: (sw - w) / 2, sy: (sh - h) / 2, sw: w, sh: h };
  }

  /** Extrai fps, kbps, quadros e perdidos de uma linha de progresso do ffmpeg. */
  function parseProgressoFfmpeg(linha) {
    var r = {}, m;
    if ((m = /frame=\s*(\d+)/.exec(linha))) r.quadros = parseInt(m[1], 10);
    if ((m = /fps=\s*([\d.]+)/.exec(linha))) r.fps = parseFloat(m[1]);
    if ((m = /bitrate=\s*([\d.]+)\s*kbits\/s/.exec(linha))) r.kbps = parseFloat(m[1]);
    if ((m = /drop=\s*(\d+)/.exec(linha))) r.perdidos = parseInt(m[1], 10);
    return Object.keys(r).length ? r : null;
  }

  /** Escolhe o IP local mais provavel de ser o da rede Wi-Fi/Ethernet real. */
  function pontuarInterface(nome, ip) {
    var p = 0;
    if (/^192\.168\./.test(ip)) p += 30;
    else if (/^10\./.test(ip)) p += 20;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) p += 10;
    else if (/^169\.254\./.test(ip)) p -= 50;
    if (/vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|vpn|bluetooth/i.test(nome)) p -= 40;
    if (/wi-?fi|wlan|wireless|ethernet|^en\d|^eth/i.test(nome)) p += 5;
    return p;
  }
  function ordenarIps(lista) { // lista: [{nome, ip}]
    return lista.slice().sort(function (a, b) { return pontuarInterface(b.nome, b.ip) - pontuarInterface(a.nome, a.ip); });
  }

  /** Converte altura em texto "1080p". */
  function rotuloResolucao(altura) {
    if (!altura) return '—';
    return altura >= 1000 ? '1080p' : altura >= 700 ? '720p' : altura + 'p';
  }

  return {
    MAX_CAMERAS: MAX_CAMERAS, SLOTS: SLOTS,
    dbParaLinear: dbParaLinear, nivelDeRms: nivelDeRms, ganhoEfetivo: ganhoEfetivo,
    resolucaoDe: resolucaoDe, calcularTally: calcularTally, montarUrlRtmp: montarUrlRtmp,
    redigirChave: redigirChave, argsFfmpeg: argsFfmpeg, parseProgressoFfmpeg: parseProgressoFfmpeg,
    ordenarIps: ordenarIps, rotuloResolucao: rotuloResolucao,
    escaparTee: escaparTee, parseFalhaTee: parseFalhaTee, percentualParaDb: percentualParaDb,
    layoutVertical: layoutVertical, recorteCobrir: recorteCobrir
  };
});
