/* mixer-video.js - mixer de video em canvas: programa (NO AR), corte e transicoes. */
(function (raiz) {
  'use strict';
  function suavizar(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function MixerVideo(opcoes) {
    this.largura = opcoes.largura || 1920;
    this.altura = opcoes.altura || 1080;
    this.fps = opcoes.fps || 30;
    this.aoTerminarTransicao = opcoes.aoTerminarTransicao || function () {};
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.largura; this.canvas.height = this.altura;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.fontes = {};          // id -> elemento <video>
    this.programaId = null;
    this.transicao = null;     // {de, para, estilo, inicio, duracao}
    this.timer = null;
    this.stream = this.canvas.captureStream(this.fps);
    this._pintarPreto();
  }

  MixerVideo.prototype._pintarPreto = function () {
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.largura, this.altura);
  };

  /** Troca resolucao/fps (so com o mixer parado de gravar/transmitir). */
  MixerVideo.prototype.configurar = function (largura, altura, fps) {
    var mudouTam = largura !== this.largura || altura !== this.altura;
    this.largura = largura; this.altura = altura;
    if (mudouTam) { this.canvas.width = largura; this.canvas.height = altura; }
    if (fps !== this.fps) { this.fps = fps; if (this.timer) { this.parar(); this.iniciar(); } }
  };

  MixerVideo.prototype.definirFonte = function (id, videoEl) {
    if (videoEl) this.fontes[id] = videoEl; else delete this.fontes[id];
  };

  MixerVideo.prototype.cortar = function (id) {
    this.transicao = null; this.programaId = id;
  };

  MixerVideo.prototype.transicionar = function (id, estilo, duracao) {
    if (id === this.programaId && !this.transicao) return;
    var de = this.transicao ? this.transicao.para : this.programaId; // se ja em transicao, parte do destino atual
    if (this.transicao) this.programaId = this.transicao.para;
    this.transicao = { de: de, para: id, estilo: estilo || 'fade', inicio: performance.now(), duracao: Math.max(50, duracao || 500) };
  };

  MixerVideo.prototype._desenharFonte = function (id, alpha, dx, escala) {
    var v = id && this.fontes[id];
    if (!v) return;
    // a fonte pode ser <video> (cameras, webcam, captura, tela, video de midia) ou <img> (imagem de midia)
    var fw, fh;
    if (v.tagName === 'VIDEO') { if (v.readyState < 2) return; fw = v.videoWidth; fh = v.videoHeight; }
    else { if (v.complete === false) return; fw = v.naturalWidth || v.width; fh = v.naturalHeight || v.height; }
    if (!fw || !fh) return;
    var cw = this.largura, ch = this.altura;
    var r = Math.min(cw / fw, ch / fh) * (escala || 1);
    var w = fw * r, h = fh * r;
    var c = this.ctx;
    c.globalAlpha = Math.max(0, Math.min(1, alpha));
    try { c.drawImage(v, (cw - w) / 2 + (dx || 0), (ch - h) / 2, w, h); } catch (e) { /* quadro indisponivel neste instante */ }
    c.globalAlpha = 1;
  };

  /** Um quadro completo: programa (com transicao) e, por cima, as sobreposicoes. */
  MixerVideo.prototype.desenhar = function () {
    this._programa();
    if (this.aoDesenhar) { try { this.aoDesenhar(this.ctx, this.largura, this.altura); } catch (e) { /* uma sobreposicao com erro nao pode parar o video */ } }
  };

  MixerVideo.prototype._programa = function () {
    this._pintarPreto();
    var t = this.transicao;
    if (!t) { this._desenharFonte(this.programaId, 1); return; }
    var p = (performance.now() - t.inicio) / t.duracao;
    if (p >= 1) {
      this.programaId = t.para; this.transicao = null;
      this._desenharFonte(this.programaId, 1);
      this.aoTerminarTransicao(this.programaId);
      return;
    }
    var e = suavizar(p), W = this.largura;
    if (t.estilo === 'deslizar') {
      this._desenharFonte(t.de, 1, -e * W);
      this._desenharFonte(t.para, 1, (1 - e) * W);
    } else if (t.estilo === 'zoom') {
      this._desenharFonte(t.de, 1 - e, 0, 1);
      this._desenharFonte(t.para, e, 0, 1.3 - 0.3 * e);
    } else { // fade (padrao): a nova fonte entra por cima, com opacidade crescente
      this._desenharFonte(t.de, 1);
      this._desenharFonte(t.para, e);
    }
  };

  MixerVideo.prototype.iniciar = function () {
    if (this.timer) return;
    var self = this;
    // setInterval (e nao requestAnimationFrame) para continuar com a janela minimizada ou coberta
    this.timer = setInterval(function () { self.desenhar(); }, 1000 / this.fps);
  };
  MixerVideo.prototype.parar = function () { clearInterval(this.timer); this.timer = null; };

  raiz.HolivesMixerVideo = MixerVideo;
})(window);
