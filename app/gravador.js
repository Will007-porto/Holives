/* gravador.js - captura o canvas + audio misturado com MediaRecorder e entrega os blocos ao ffmpeg
 * (processo principal) por IPC. Duas tarefas independentes: "gravacao" (arquivo) e "live" (RTMP). */
(function (raiz) {
  'use strict';
  var MIMES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=avc1,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

  function escolherMime() {
    for (var i = 0; i < MIMES.length; i++) if (MediaRecorder.isTypeSupported(MIMES[i])) return MIMES[i];
    return '';
  }

  function Gravador(nativo) { this.nativo = nativo; this.ativos = {}; }

  /** opcoes: {fps, kbps, servidor, chave} */
  Gravador.prototype.iniciar = async function (job, stream, opcoes) {
    if (this.ativos[job]) return { ok: false, erro: 'Já está em andamento.' };
    var mime = escolherMime();
    if (!mime) return { ok: false, erro: 'Este sistema não suporta MediaRecorder com WebM.' };
    var r = await this.nativo.ffmpegIniciar(Object.assign({ job: job, mime: mime }, opcoes));
    if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || 'Falha ao iniciar o ffmpeg.' };
    var self = this, fila = Promise.resolve(), rec;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: (opcoes.kbps || 6000) * 1000 * (job === 'gravacao' ? 1.3 : 1),
        audioBitsPerSecond: 192000
      });
    } catch (e) {
      await this.nativo.ffmpegParar(job);
      return { ok: false, erro: 'Não foi possível criar o gravador: ' + e.message };
    }
    rec.ondataavailable = function (ev) {
      if (!ev.data || !ev.data.size) return;
      // a fila garante a ordem dos blocos mesmo com arrayBuffer() assincrono
      fila = fila.then(function () { return ev.data.arrayBuffer(); }).then(function (buf) { self.nativo.ffmpegDados(job, buf); });
    };
    rec.onerror = function () { self.parar(job); };
    rec.start(250);
    this.ativos[job] = { rec: rec, fila: function () { return fila; } };
    return { ok: true, caminho: r.caminho, mime: mime };
  };

  Gravador.prototype.parar = async function (job) {
    var a = this.ativos[job]; if (!a) return;
    delete this.ativos[job];
    await new Promise(function (resolve) {
      a.rec.onstop = resolve;
      try { if (a.rec.state !== 'inactive') a.rec.stop(); else resolve(); } catch (e) { resolve(); }
    });
    await a.fila(); // espera o ultimo bloco chegar ao ffmpeg
    await this.nativo.ffmpegParar(job);
  };

  Gravador.prototype.estaAtivo = function (job) { return !!this.ativos[job]; };

  raiz.HolivesGravador = Gravador;
})(window);
