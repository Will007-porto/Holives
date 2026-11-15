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
      args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
        '-b:v', kbps + 'k', '-maxrate', kbps + 'k', '-bufsize', (kbps * 2) + 'k',
        '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0',
        '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-f', 'flv', o.url);
    }
    return args;
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
    ordenarIps: ordenarIps, rotuloResolucao: rotuloResolucao
  };
});
