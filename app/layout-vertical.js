/* layout-vertical.js - saida 9:16 (Instagram): o programa 16:9 fica deitado no meio,
 * com uma arte em cima e outra embaixo. Desenha a partir do canvas do mixer (programa). */
(function (raiz) {
  'use strict';
  var N = raiz.HolivesNucleo;

  /** fonte: canvas do mixer. cfg: {cor, texto, topoUrl, baseUrl} */
  function LayoutVertical(fonte, fps) {
    this.fonte = fonte; this.fps = fps || 30;
    this.largura = 720; this.altura = 1280;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.largura; this.canvas.height = this.altura;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.cfg = { cor: '#15171C', texto: '', topoUrl: '', baseUrl: '' };
    this.imgTopo = null; this.imgBase = null;
    this.stream = this.canvas.captureStream(this.fps);
    this.usos = 0; this.timer = null;
    this.desenhar();
  }

  function carregar(url, pronto) {
    if (!url) return null;
    var i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = pronto; i.src = url; return i;
  }

  LayoutVertical.prototype.configurar = function (cfg) {
    var self = this, antes = this.cfg;
    this.cfg = { cor: cfg.cor || '#15171C', texto: String(cfg.texto || '').slice(0, 80), topoUrl: cfg.topoUrl || '', baseUrl: cfg.baseUrl || '' };
    if (this.cfg.topoUrl !== antes.topoUrl) this.imgTopo = carregar(this.cfg.topoUrl, function () { self.desenhar(); });
    if (this.cfg.baseUrl !== antes.baseUrl) this.imgBase = carregar(this.cfg.baseUrl, function () { self.desenhar(); });
    this.desenhar();
  };

  LayoutVertical.prototype._faixa = function (img, r) {
    var c = this.ctx;
    if (!img || !img.complete || !img.naturalWidth) return false;
    var k = N.recorteCobrir(img.naturalWidth, img.naturalHeight, r.w, r.h);
    c.drawImage(img, k.sx, k.sy, k.sw, k.sh, r.x, r.y, r.w, r.h);
    return true;
  };

  LayoutVertical.prototype.desenhar = function () {
    var c = this.ctx, L = N.layoutVertical(this.largura, this.altura);
    c.fillStyle = this.cfg.cor; c.fillRect(0, 0, this.largura, this.altura);
    this._faixa(this.imgTopo, L.topo);
    var temBase = this._faixa(this.imgBase, L.base);
    c.fillStyle = '#000'; c.fillRect(L.video.x, L.video.y, L.video.w, L.video.h);
    try { c.drawImage(this.fonte, L.video.x, L.video.y, L.video.w, L.video.h); } catch (e) { /* mixer ainda sem quadro */ }
    if (this.cfg.texto) {
      // texto logo abaixo do video; com arte embaixo, ganha uma faixa escura para continuar legivel
      var y = L.base.y + 70;
      c.font = '600 34px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      if (temBase) { c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(0, L.base.y, this.largura, 140); }
      c.fillStyle = '#FFFFFF';
      var linhas = quebrar(c, this.cfg.texto, this.largura - 80);
      for (var i = 0; i < linhas.length && i < 2; i++) c.fillText(linhas[i], this.largura / 2, y + (i - (Math.min(linhas.length, 2) - 1) / 2) * 44);
    }
  };

  function quebrar(c, texto, larguraMax) {
    var palavras = texto.split(/\s+/), linhas = [], atual = '';
    palavras.forEach(function (p) {
      var t = atual ? atual + ' ' + p : p;
      if (c.measureText(t).width > larguraMax && atual) { linhas.push(atual); atual = p; } else atual = t;
    });
    if (atual) linhas.push(atual);
    return linhas;
  }

  /** Liga o desenho continuo enquanto alguem usa (transmissao vertical ou a janela de ajuste). */
  LayoutVertical.prototype.usar = function () {
    this.usos++;
    if (!this.timer) { var self = this; this.timer = setInterval(function () { self.desenhar(); }, 1000 / this.fps); }
  };
  LayoutVertical.prototype.soltar = function () {
    this.usos = Math.max(0, this.usos - 1);
    if (!this.usos && this.timer) { clearInterval(this.timer); this.timer = null; }
  };

  raiz.HolivesLayoutVertical = LayoutVertical;
})(window);
