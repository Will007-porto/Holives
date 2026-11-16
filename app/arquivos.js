/* arquivos.js - (processo principal) registro dos arquivos de midia que o operador escolheu.
 * O renderer nunca le o disco direto: ele recebe um endereco http://127.0.0.1:PORTA/midia/TOKEN/ID
 * servido so no loopback, com CORS liberado (sem isso o canvas do mixer ficaria "contaminado"
 * e a gravacao/transmissao falhariam). So arquivos registrados aqui podem ser lidos. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIPOS = {
  '.mp4': ['video', 'video/mp4'], '.m4v': ['video', 'video/mp4'], '.webm': ['video', 'video/webm'],
  '.mov': ['video', 'video/quicktime'], '.mkv': ['video', 'video/x-matroska'], '.ogv': ['video', 'video/ogg'],
  '.jpg': ['imagem', 'image/jpeg'], '.jpeg': ['imagem', 'image/jpeg'], '.png': ['imagem', 'image/png'],
  '.webp': ['imagem', 'image/webp'], '.gif': ['imagem', 'image/gif'], '.bmp': ['imagem', 'image/bmp']
};

function tipoDe(caminho) { return TIPOS[path.extname(String(caminho)).toLowerCase()] || null; }

class Arquivos {
  constructor() {
    this.token = crypto.randomBytes(16).toString('hex');
    this.porId = new Map();     // id -> {id, caminho, tipo, mime, nome}
    this.porCaminho = new Map();
  }

  /** Registra um arquivo existente de tipo aceito. Retorna o item ou null. */
  registrar(caminho) {
    if (typeof caminho !== 'string' || !caminho || caminho.length > 1000) return null;
    const abs = path.resolve(caminho);
    const t = tipoDe(abs);
    if (!t) return null;
    try { if (!fs.statSync(abs).isFile()) return null; } catch (e) { return null; }
    if (this.porCaminho.has(abs)) return this.porCaminho.get(abs);
    const item = { id: crypto.randomBytes(6).toString('hex'), caminho: abs, tipo: t[0], mime: t[1], nome: path.basename(abs, path.extname(abs)) };
    this.porId.set(item.id, item); this.porCaminho.set(abs, item);
    return item;
  }

  remover(id) {
    const i = this.porId.get(id); if (!i) return false;
    this.porId.delete(id); this.porCaminho.delete(i.caminho); return true;
  }

  /** O que o renderer recebe (sem o caminho completo nao ha o que esconder: e a maquina do proprio usuario). */
  publico(item, porta) {
    return { id: item.id, nome: item.nome, tipo: item.tipo, url: 'http://127.0.0.1:' + porta + '/midia/' + this.token + '/' + item.id };
  }

  /** Atende GET /midia/TOKEN/ID com suporte a Range (necessario para avancar/voltar videos). */
  atender(req, res) {
    const m = /^\/midia\/([0-9a-f]+)\/([0-9a-f]+)$/.exec((req.url || '').split('?')[0]);
    if (!m) return false;
    const cab = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const item = m[1] === this.token ? this.porId.get(m[2]) : null;
    if (!item || (req.method !== 'GET' && req.method !== 'HEAD')) { res.writeHead(404, cab); res.end(); return true; }
    let st;
    try { st = fs.statSync(item.caminho); } catch (e) { res.writeHead(404, cab); res.end(); return true; }
    cab['Content-Type'] = item.mime; cab['Accept-Ranges'] = 'bytes';
    let ini = 0, fim = st.size - 1, status = 200;
    const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (r && (r[1] || r[2])) {
      if (r[1]) { ini = parseInt(r[1], 10); if (r[2]) fim = Math.min(fim, parseInt(r[2], 10)); }
      else ini = Math.max(0, st.size - parseInt(r[2], 10));
      if (ini > fim || ini >= st.size) { cab['Content-Range'] = 'bytes */' + st.size; res.writeHead(416, cab); res.end(); return true; }
      status = 206; cab['Content-Range'] = 'bytes ' + ini + '-' + fim + '/' + st.size;
    }
    cab['Content-Length'] = fim - ini + 1;
    res.writeHead(status, cab);
    if (req.method === 'HEAD' || st.size === 0) { res.end(); return true; }
    const fluxo = fs.createReadStream(item.caminho, { start: ini, end: fim });
    fluxo.on('error', () => res.destroy());
    res.on('close', () => fluxo.destroy());
    fluxo.pipe(res);
    return true;
  }
}

module.exports = { Arquivos, tipoDe };
