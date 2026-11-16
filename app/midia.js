/* midia.js - "Tela de midia": mostra uma imagem ou toca um video escolhido pelo operador.
 * Fornece ao mixer um elemento desenhavel (img ou video) e uma previa leve para os cartoes/monitor. */
(function (raiz) {
  'use strict';

  function fmt(seg) {
    if (!isFinite(seg) || seg <= 0) return '—';
    seg = Math.round(seg);
    var m = Math.floor(seg / 60), s = seg % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function oculto(el) {
    el.style.cssText = 'position:fixed;left:-9999px;top:0;width:16px;height:9px;opacity:0;pointer-events:none';
    document.body.appendChild(el); return el;
  }

  /** opcoes: {aoMudar(), aoTerminar(), aoErro(msg)} */
  function Midia(opcoes) {
    this.o = opcoes || {};
    this.itens = [];            // {id, nome, tipo, url, duracao, thumb}
    this.atual = null;
    this.loop = true;
    var self = this;
    this.video = oculto(document.createElement('video'));
    this.video.crossOrigin = 'anonymous'; this.video.playsInline = true; this.video.preload = 'auto';
    this.video.addEventListener('ended', function () { if (!self.video.loop && self.o.aoTerminar) self.o.aoTerminar(); self._mudou(); });
    this.video.addEventListener('pause', function () { self._mudou(); });
    this.video.addEventListener('play', function () { self._mudou(); });
    this.video.addEventListener('loadedmetadata', function () {
      if (self.atual && self.atual.tipo === 'video') { self.atual.duracao = fmt(self.video.duration); self._mudou(); }
    });
    this.video.addEventListener('error', function () {
      if (self.atual && self.atual.tipo === 'video' && self.o.aoErro) self.o.aoErro('Este vídeo não pôde ser aberto. Prefira arquivos MP4 (H.264) ou WebM.');
    });
    this.img = new Image(); this.img.crossOrigin = 'anonymous';
    this.img.addEventListener('load', function () { self._mudou(); });
    // previa leve (cartao da fonte e monitor de previa)
    this.canvas = document.createElement('canvas'); this.canvas.width = 640; this.canvas.height = 360;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.stream = this.canvas.captureStream(10);
    this.timer = setInterval(function () { self._previa(); }, 100);
    this._previa();
  }

  Midia.prototype._mudou = function () { if (this.o.aoMudar) this.o.aoMudar(); };

  /** Elemento que o mixer desenha (ou null se nada escolhido). */
  Midia.prototype.desenhavel = function () {
    if (!this.atual) return null;
    return this.atual.tipo === 'video' ? this.video : this.img;
  };

  Midia.prototype.pronto = function () {
    var d = this.desenhavel(); if (!d) return false;
    return d === this.video ? (d.readyState >= 2 && d.videoWidth > 0) : (d.complete && d.naturalWidth > 0);
  };

  Midia.prototype._previa = function () {
    var c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (!this.pronto()) return;
    var d = this.desenhavel(), w = d.videoWidth || d.naturalWidth, h = d.videoHeight || d.naturalHeight;
    var r = Math.min(W / w, H / h);
    try { c.drawImage(d, (W - w * r) / 2, (H - h * r) / 2, w * r, h * r); } catch (e) { /* quadro ainda nao disponivel */ }
  };

  Midia.prototype.definirItens = function (lista) {
    var antigos = {}; this.itens.forEach(function (i) { antigos[i.id] = i; });
    this.itens = lista.map(function (i) {
      var a = antigos[i.id] || {};
      return { id: i.id, nome: i.nome, tipo: i.tipo, url: i.url, duracao: a.duracao || '—', thumb: a.thumb || (i.tipo === 'imagem' ? i.url : '') };
    });
    if (this.atual && !this.itens.some(function (i) { return i.id === this.atual.id; }, this)) this.selecionar(null);
    this._miniaturas();
    this._mudou();
  };

  Midia.prototype.item = function (id) { return this.itens.find(function (i) { return i.id === id; }) || null; };

  Midia.prototype.selecionar = function (id) {
    var it = id ? this.item(id) : null;
    this.video.pause();
    this.atual = it;
    if (!it) { this.video.removeAttribute('src'); this.video.load(); this.img.removeAttribute('src'); this._mudou(); return; }
    if (it.tipo === 'video') { this.video.loop = this.loop; this.video.src = it.url; this.video.currentTime = 0; }
    else { this.video.removeAttribute('src'); this.video.load(); this.img.src = it.url; }
    this._mudou();
  };

  Midia.prototype.ehVideo = function () { return !!this.atual && this.atual.tipo === 'video'; };
  Midia.prototype.tocando = function () { return this.ehVideo() && !this.video.paused && !this.video.ended; };
  Midia.prototype.tocar = function () {
    if (!this.ehVideo()) return;
    if (this.video.ended) this.video.currentTime = 0;
    var self = this;
    this.video.play().catch(function () { if (self.o.aoErro) self.o.aoErro('Não foi possível tocar o vídeo.'); });
  };
  Midia.prototype.pausar = function () { if (this.ehVideo()) this.video.pause(); };
  Midia.prototype.reiniciar = function () { if (this.ehVideo()) { this.video.currentTime = 0; this._mudou(); } };
  Midia.prototype.definirLoop = function (v) { this.loop = !!v; this.video.loop = this.loop; };
  Midia.prototype.posicao = function () { return this.ehVideo() ? { atual: this.video.currentTime || 0, total: this.video.duration || 0 } : { atual: 0, total: 0 }; };

  /** Gera a miniatura dos videos (um quadro perto do inicio), um de cada vez. */
  Midia.prototype._miniaturas = function () {
    if (this._gerando) return;
    var pend = this.itens.filter(function (i) { return i.tipo === 'video' && !i.thumb && !i.semThumb; })[0];
    if (!pend) return;
    this._gerando = true;
    var self = this, v = document.createElement('video'), feito = false;
    function fim(url) {
      if (feito) return; feito = true;
      if (url) pend.thumb = url; else pend.semThumb = true;
      v.removeAttribute('src'); v.load(); self._gerando = false; self._mudou(); self._miniaturas();
    }
    v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'metadata';
    v.addEventListener('loadedmetadata', function () { pend.duracao = fmt(v.duration); v.currentTime = Math.min(1, (v.duration || 2) / 2); });
    v.addEventListener('seeked', function () {
      try {
        var c = document.createElement('canvas'); c.width = 128; c.height = 72;
        c.getContext('2d').drawImage(v, 0, 0, 128, 72); fim(c.toDataURL('image/jpeg', 0.7));
      } catch (e) { fim(''); }
    });
    v.addEventListener('error', function () { fim(''); });
    setTimeout(function () { fim(''); }, 8000);
    v.src = pend.url;
  };

  raiz.HolivesMidia = Midia;
})(window);
