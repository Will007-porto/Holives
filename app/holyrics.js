/* holyrics.js - (processo principal) le do Holyrics o texto do slide que esta na tela.
 * Usa o "API Server" do Holyrics (Arquivo > Configuracoes > API Server), acao GetCurrentPresentation:
 *   POST http://IP:PORTA/api/GetCurrentPresentation?token=TOKEN   corpo {"include_slides":true}
 * Documentacao: https://github.com/holyrics/API-Server
 * Limite conhecido: o Holyrics nao devolve a lista de slides para versiculos da Biblia; nesse caso
 * so a referencia (nome do item) e mostrada. */
'use strict';
const http = require('http');

const PORTA_PADRAO = 8091;

/** "192.168.0.20", "192.168.0.20:8091" ou "pc-do-louvor:8091" -> {host, porta} ou null. */
function lerEndereco(texto) {
  const t = String(texto || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!t) return null;
  const m = /^([a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?)(?::(\d{1,5}))?$/i.exec(t);
  if (!m) return null;
  const porta = m[3] ? parseInt(m[3], 10) : PORTA_PADRAO;
  if (porta < 1 || porta > 65535) return null;
  return { host: m[1], porta };
}

/** Tira marcacoes simples do texto do slide e limita o tamanho. */
function limparTexto(t) {
  return String(t == null ? '' : t)
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]{0,200}>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .split(/\r?\n/).map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').trim().slice(0, 600);
}

/**
 * Converte a resposta de GetCurrentPresentation em {visivel, texto, titulo}.
 * slides: lista de slides ja conhecida deste item (o Holyrics so manda quando pedimos include_slides).
 */
function interpretar(resposta, slides) {
  const d = resposta && resposta.status === 'ok' ? resposta.data : null;
  if (!d) return { visivel: false, texto: '', titulo: '' };
  const titulo = String(d.name || '').slice(0, 120);
  if (d.slide_type && d.slide_type !== 'default') return { visivel: false, texto: '', titulo }; // papel de parede, tela vazia/preta, slide final
  if (d.type === 'verse') return { visivel: !!titulo, texto: titulo, titulo };
  if (d.type !== 'song' && d.type !== 'text' && d.type !== 'announcement' && d.type !== 'quick_presentation') return { visivel: false, texto: '', titulo };
  const lista = Array.isArray(d.slides) ? d.slides : (slides || []);
  const atual = lista.find((s) => s && s.number === d.slide_number);
  const texto = limparTexto(atual ? atual.text : '');
  return { visivel: !!texto, texto, titulo };
}

class Holyrics {
  constructor(aoEstado) {
    this.aoEstado = aoEstado || function () {};
    this.cfg = null;            // {host, porta, token}
    this.timer = null; this.ocupado = false;
    this.itemId = null; this.slides = [];
    this.ultimo = '';
    this.falhas = 0;
  }

  /** endereco: texto digitado pelo usuario; token: token do API Server. Vazio = desligado. */
  configurar(endereco, token) {
    const e = lerEndereco(endereco);
    this.parar();
    if (!e || !token) { this.cfg = null; this._emitir({ conexao: endereco && !e ? 'endereço inválido' : 'não configurado', visivel: false, texto: '', titulo: '' }); return false; }
    this.cfg = { host: e.host, porta: e.porta, token: String(token) };
    this.itemId = null; this.slides = []; this.falhas = 0;
    this._emitir({ conexao: 'conectando', visivel: false, texto: '', titulo: '' });
    this.timer = setInterval(() => this._consultar(), 400);
    this._consultar();
    return true;
  }

  parar() { clearInterval(this.timer); this.timer = null; }

  _emitir(e) {
    const chave = JSON.stringify(e);
    if (chave === this.ultimo) return;
    this.ultimo = chave; this.aoEstado(e);
  }

  _pedir(corpo) {
    const cfg = this.cfg;
    return new Promise((resolve, reject) => {
      const dados = Buffer.from(JSON.stringify(corpo));
      const req = http.request({
        host: cfg.host, port: cfg.porta, method: 'POST', timeout: 1500,
        path: '/api/GetCurrentPresentation?token=' + encodeURIComponent(cfg.token),
        headers: { 'Content-Type': 'application/json', 'Content-Length': dados.length }
      }, (res) => {
        const partes = []; let total = 0;
        res.on('data', (b) => { total += b.length; if (total > 2 * 1024 * 1024) { req.destroy(new Error('resposta grande demais')); return; } partes.push(b); });
        res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (e) { reject(new Error('resposta inesperada')); } });
      });
      req.on('timeout', () => req.destroy(new Error('sem resposta')));
      req.on('error', reject);
      req.end(dados);
    });
  }

  async _consultar() {
    if (this.ocupado || !this.cfg) return;
    this.ocupado = true;
    const cfg = this.cfg;
    try {
      let r = await this._pedir({});
      if (cfg !== this.cfg) return;
      if (r && r.status === 'error') {
        const msg = String(r.error || '').toLowerCase();
        this._emitir({ conexao: /token|permission|permiss/.test(msg) ? 'token inválido ou sem permissão' : 'erro do Holyrics', visivel: false, texto: '', titulo: '' });
        return;
      }
      const d = r && r.data;
      // a lista de slides so e pedida quando o item muda (e mais pesada)
      if (d && d.id !== this.itemId) {
        this.itemId = d.id; this.slides = [];
        if (d.type !== 'verse') {
          const completo = await this._pedir({ include_slides: true });
          if (cfg !== this.cfg) return;
          if (completo && completo.status === 'ok' && completo.data && Array.isArray(completo.data.slides)) { this.slides = completo.data.slides; r = completo; }
        }
      } else if (!d) { this.itemId = null; this.slides = []; }
      this.falhas = 0;
      this._emitir(Object.assign({ conexao: 'conectado' }, interpretar(r, this.slides)));
    } catch (e) {
      if (cfg !== this.cfg) return;
      // uma falha isolada nao apaga a letra da tela; depois de algumas, avisa e esconde
      if (++this.falhas >= 5) this._emitir({ conexao: 'sem resposta', visivel: false, texto: '', titulo: '' });
    } finally { this.ocupado = false; }
  }
}

module.exports = { Holyrics, lerEndereco, limparTexto, interpretar, PORTA_PADRAO };
