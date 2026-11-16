/* sobreposicoes.js - desenha por cima do programa: logo, tarja (legenda inferior), aviso e letras do Holyrics.
 * O mixer chama desenhar(ctx, W, H) no fim de cada quadro, entao vale para gravacao e para todos os destinos. */
(function (raiz) {
  'use strict';

  function Sobreposicoes() {
    this.logo = { ativa: false, img: null, posicao: 'superior-direita', tamanho: 96, opacidade: 90 };
    this.tarja = { ativa: false, linha1: '', linha2: '' };
    this.texto = { ativa: false, conteudo: '' };
    this.letra = { ativa: false, visivel: false, conteudo: '' };
    // opacidade animada (0..1) de cada camada, para entrar e sair suavemente
    this.a = { logo: 0, tarja: 0, texto: 0, letra: 0 };
    this.ultimaLetra = ''; this.ultimaTarja = ['', '']; this.ultimoTexto = '';
    this.t = performance.now();
  }

  Sobreposicoes.prototype.definirLogo = function (url) {
    if (!url) { this.logo.img = null; this.logo.url = ''; return; }
    if (url === this.logo.url) return;
    var i = new Image(); i.crossOrigin = 'anonymous'; i.src = url;
    this.logo.img = i; this.logo.url = url;
  };

  function quebrar(c, texto, larguraMax, maxLinhas) {
    var saida = [];
    String(texto).split('\n').forEach(function (paragrafo) {
      var atual = '';
      paragrafo.split(/\s+/).forEach(function (p) {
        var t = atual ? atual + ' ' + p : p;
        if (c.measureText(t).width > larguraMax && atual) { saida.push(atual); atual = p; } else atual = t;
      });
      if (atual) saida.push(atual);
    });
    return saida.slice(0, maxLinhas);
  }
  function caixa(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    c.fill();
  }
  function fonte(peso, px) { return peso + ' ' + Math.round(px) + 'px Inter, "Segoe UI", system-ui, sans-serif'; }

  Sobreposicoes.prototype._animar = function () {
    var agora = performance.now(), passo = Math.min(1, (agora - this.t) / 250); this.t = agora;
    var alvo = {
      logo: this.logo.ativa && this.logo.img ? 1 : 0,
      tarja: this.tarja.ativa && (this.tarja.linha1 || this.tarja.linha2) ? 1 : 0,
      texto: this.texto.ativa && this.texto.conteudo ? 1 : 0,
      letra: this.letra.ativa && this.letra.visivel && this.letra.conteudo ? 1 : 0
    };
    for (var k in alvo) {
      var d = alvo[k] - this.a[k];
      this.a[k] = Math.abs(d) <= passo ? alvo[k] : this.a[k] + (d > 0 ? passo : -passo);
    }
    // guarda o ultimo conteudo para ele continuar visivel enquanto some
    if (alvo.letra) this.ultimaLetra = this.letra.conteudo;
    if (alvo.tarja) this.ultimaTarja = [this.tarja.linha1, this.tarja.linha2];
    if (alvo.texto) this.ultimoTexto = this.texto.conteudo;
  };

  Sobreposicoes.prototype.desenhar = function (c, W, H) {
    this._animar();
    var s = H / 1080, a = this.a;
    c.save();
    c.textBaseline = 'middle';

    if (a.logo > 0.01) {
      var img = this.logo.img;
      if (img && img.complete && img.naturalWidth) {
        var h = this.logo.tamanho * s, w = h * img.naturalWidth / img.naturalHeight, m = 36 * s, p = this.logo.posicao;
        var x = p.indexOf('esquerda') >= 0 ? m : W - m - w, y = p.indexOf('inferior') >= 0 ? H - m - h : m;
        c.globalAlpha = a.logo * this.logo.opacidade / 100;
        try { c.drawImage(img, x, y, w, h); } catch (e) { /* */ }
      }
    }

    if (a.texto > 0.01) {
      c.globalAlpha = a.texto; c.font = fonte(600, 34 * s); c.textAlign = 'center';
      var lt = quebrar(c, this.ultimoTexto, W * 0.76, 2), alt = 50 * s, larg = 0;
      lt.forEach(function (l) { larg = Math.max(larg, c.measureText(l).width); });
      var bw = larg + 72 * s, bh = lt.length * alt + 24 * s, bx = (W - bw) / 2, by = 36 * s;
      c.fillStyle = 'rgba(110,123,255,0.94)'; caixa(c, bx, by, bw, bh, 14 * s);
      c.fillStyle = '#FFFFFF';
      lt.forEach(function (l, i) { c.fillText(l, W / 2, by + 12 * s + alt * (i + 0.5)); });
    }

    if (a.tarja > 0.01) {
      var l1 = this.ultimaTarja[0], l2 = this.ultimaTarja[1];
      c.globalAlpha = a.tarja; c.textAlign = 'left';
      c.font = fonte(700, 46 * s); var w1 = l1 ? c.measureText(l1).width : 0;
      c.font = fonte(400, 30 * s); var w2 = l2 ? c.measureText(l2).width : 0;
      var th = (l1 ? 58 * s : 0) + (l2 ? 42 * s : 0) + 36 * s;
      var tw = Math.min(W * 0.8, Math.max(w1, w2) + 84 * s), tx = 60 * s - (1 - a.tarja) * 40 * s, ty = H - 96 * s - th;
      c.fillStyle = 'rgba(11,12,15,0.88)'; caixa(c, tx, ty, tw, th, 12 * s);
      c.fillStyle = '#6E7BFF'; caixa(c, tx, ty, 10 * s, th, 5 * s);
      var yy = ty + 18 * s;
      c.save(); c.beginPath(); c.rect(tx, ty, tw - 20 * s, th); c.clip();
      if (l1) { c.fillStyle = '#FFFFFF'; c.font = fonte(700, 46 * s); c.fillText(l1, tx + 38 * s, yy + 29 * s); yy += 58 * s; }
      if (l2) { c.fillStyle = '#C9CDD6'; c.font = fonte(400, 30 * s); c.fillText(l2, tx + 38 * s, yy + 21 * s); }
      c.restore();
    }

    if (a.letra > 0.01) {
      c.globalAlpha = a.letra; c.textAlign = 'center';
      var px = 56 * s; c.font = fonte(700, px);
      var linhas = quebrar(c, this.ultimaLetra, W * 0.86, 8);
      if (linhas.length > 4) { px = 44 * s; c.font = fonte(700, px); linhas = quebrar(c, this.ultimaLetra, W * 0.88, 6); }
      var al = px * 1.28, bloco = linhas.length * al, y0 = H - 64 * s - bloco;
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(0, y0 - 26 * s, W, bloco + 52 * s);
      c.fillStyle = '#FFFFFF'; c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 8 * s; c.shadowOffsetY = 2 * s;
      linhas.forEach(function (l, i) { c.fillText(l, W / 2, y0 + al * (i + 0.5)); });
    }
    c.restore();
  };

  raiz.HolivesSobreposicoes = Sobreposicoes;
})(window);
