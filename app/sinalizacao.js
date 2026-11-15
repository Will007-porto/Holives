/* sinalizacao.js - hub de sinalizacao WebSocket entre o mestre e ate 4 cameras.
 * Nao conhece Electron nem HTTPS: recebe conexoes ja aceitas (ws) e o papel de cada uma. */
'use strict';
const { SLOTS, MAX_CAMERAS, calcularTally } = require('./nucleo');

const MAX_PENDENTES = 8;

class Sinalizacao {
  constructor() {
    this.mestre = null;
    this.pendentes = new Map();   // id -> {id, ws, nome, idAparelho, info}
    this.slots = {};              // slot -> {slot, idAparelho, nome, ws|null, info}
    this.tally = { previa: null, noAr: null };
    this.proximoId = 1;
  }

  _enviar(ws, obj) {
    if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* conexao caiu */ } }
  }
  _paraMestre(obj) { this._enviar(this.mestre, obj); }

  _slotLivre() { return SLOTS.find((s) => !this.slots[s]); }
  _slotDoAparelho(idAparelho) {
    return SLOTS.find((s) => this.slots[s] && this.slots[s].idAparelho === idAparelho);
  }
  _estadoTally(slot) { return calcularTally(this.tally.previa, this.tally.noAr)[slot]; }

  _nomeUnico(nome) {
    nome = String(nome || 'Câmera').slice(0, 40);
    const usados = new Set([].concat(
      [...this.pendentes.values()].map((p) => p.nome),
      SLOTS.filter((s) => this.slots[s]).map((s) => this.slots[s].nome)));
    if (!usados.has(nome)) return nome;
    let n = 2;
    while (usados.has(nome + ' (' + n + ')')) n++;
    return nome + ' (' + n + ')';
  }

  /** Lista que o mestre recebe ao conectar. */
  _roster() {
    return {
      t: 'estado-inicial',
      max: MAX_CAMERAS,
      cameras: SLOTS.filter((s) => this.slots[s]).map((s) => ({
        slot: s, nome: this.slots[s].nome, conectada: !!this.slots[s].ws, info: this.slots[s].info
      })),
      pendentes: [...this.pendentes.values()].map((p) => ({ id: p.id, nome: p.nome, info: p.info }))
    };
  }

  /** Registra uma conexao. papel: 'mestre' | 'camera'. */
  conectar(ws, papel) {
    if (papel === 'mestre') return this._conectarMestre(ws);
    return this._conectarCamera(ws);
  }

  _conectarMestre(ws) {
    if (this.mestre && this.mestre !== ws) { try { this.mestre.close(4000, 'substituido'); } catch (e) { /* */ } }
    this.mestre = ws;
    this._enviar(ws, this._roster());
    // pede que as cameras ja conectadas renegociem o WebRTC com o novo mestre
    SLOTS.forEach((s) => { const c = this.slots[s]; if (c && c.ws) this._enviar(c.ws, { t: 'renegociar' }); });
    ws.on('message', (dados) => {
      const m = this._ler(dados); if (!m) return;
      this._mensagemMestre(m);
    });
    ws.on('close', () => {
      if (this.mestre === ws) {
        this.mestre = null;
        SLOTS.forEach((s) => { const c = this.slots[s]; if (c && c.ws) this._enviar(c.ws, { t: 'mestre-offline' }); });
      }
    });
  }

  _mensagemMestre(m) {
    switch (m.t) {
      case 'aceitar': return this.aceitar(m.id);
      case 'recusar': return this.recusar(m.id);
      case 'remover': return this.removerSlot(m.slot);
      case 'tally':
        this.tally = { previa: m.previa || null, noAr: m.noAr || null };
        SLOTS.forEach((s) => {
          const c = this.slots[s];
          if (c && c.ws) this._enviar(c.ws, { t: 'tally', estado: this._estadoTally(s) });
        });
        return;
      case 'sdp': case 'ice': case 'renegociar': {
        const c = this.slots[m.slot];
        if (c && c.ws) this._enviar(c.ws, m);
        return;
      }
      case 'mensagem': { // mensagem do operador para uma camera (ou todas)
        SLOTS.forEach((s) => {
          const c = this.slots[s];
          if (c && c.ws && (!m.slot || m.slot === s)) this._enviar(c.ws, { t: 'mensagem', texto: String(m.texto || '').slice(0, 200) });
        });
        return;
      }
      default: return;
    }
  }

  _conectarCamera(ws) {
    const conn = { ws, id: 'c' + (this.proximoId++), pendenteId: null };
    ws.on('message', (dados) => {
      const m = this._ler(dados); if (!m) return;
      this._mensagemCamera(conn, m);
    });
    ws.on('close', () => this._cameraFechou(conn));
  }

  _mensagemCamera(conn, m) {
    const slot = this._slotDaConexao(conn.ws);
    if (m.t === 'ola' && !slot && !conn.pendenteId) return this._ola(conn, m);
    if (m.t === 'sair') {
      if (conn.pendenteId) this.recusar(conn.pendenteId);
      if (slot) this.removerSlot(slot, true);
      try { conn.ws.close(1000, 'saiu'); } catch (e) { /* */ }
      return;
    }
    if (!slot) return; // so cameras aceitas podem sinalizar
    if (m.t === 'sdp' || m.t === 'ice') this._paraMestre({ t: m.t, slot, dados: m.dados });
    else if (m.t === 'estado') {
      const c = this.slots[slot]; if (c) c.info = Object.assign({}, c.info, m.info);
      this._paraMestre({ t: 'estado-camera', slot, info: m.info });
    }
  }

  _ola(conn, m) {
    const idAparelho = String(m.idAparelho || conn.id).slice(0, 64);
    const info = { camera: m.camera, qualidade: m.qualidade, audio: !!m.audio, modelo: String(m.modelo || '').slice(0, 60) };
    // reconexao de aparelho ja aceito nesta sessao: volta ao mesmo slot sem nova aprovacao
    const existente = this._slotDoAparelho(idAparelho);
    if (existente) {
      const c = this.slots[existente];
      if (c.ws && c.ws !== conn.ws) { try { c.ws.close(4001, 'substituida'); } catch (e) { /* */ } }
      c.ws = conn.ws; c.info = info;
      this._enviar(conn.ws, { t: 'aceito', slot: existente, nome: c.nome });
      this._enviar(conn.ws, { t: 'tally', estado: this._estadoTally(existente) });
      this._paraMestre({ t: 'camera-conectou', slot: existente, nome: c.nome, info, reconexao: true });
      return;
    }
    if (SLOTS.every((s) => this.slots[s]) ) {
      this._enviar(conn.ws, { t: 'recusado', motivo: 'lotado' });
      try { conn.ws.close(1000, 'lotado'); } catch (e) { /* */ }
      return;
    }
    if (this.pendentes.size >= MAX_PENDENTES) {
      this._enviar(conn.ws, { t: 'recusado', motivo: 'muitos-pendentes' });
      try { conn.ws.close(1000, 'pendentes'); } catch (e) { /* */ }
      return;
    }
    const nome = this._nomeUnico(m.nome);
    conn.pendenteId = conn.id;
    this.pendentes.set(conn.id, { id: conn.id, ws: conn.ws, nome, idAparelho, info });
    conn.idAparelho = idAparelho;
    this._enviar(conn.ws, { t: 'pendente' });
    this._paraMestre({ t: 'pendente', id: conn.id, nome, info });
  }

  aceitar(id) {
    const p = this.pendentes.get(id); if (!p) return false;
    const slot = this._slotLivre();
    if (!slot) { this._enviar(p.ws, { t: 'recusado', motivo: 'lotado' }); this.pendentes.delete(id); this._paraMestre({ t: 'pendente-removido', id }); return false; }
    this.pendentes.delete(id);
    this.slots[slot] = { slot, idAparelho: p.idAparelho, nome: p.nome, ws: p.ws, info: p.info };
    this._enviar(p.ws, { t: 'aceito', slot, nome: p.nome });
    this._enviar(p.ws, { t: 'tally', estado: this._estadoTally(slot) });
    this._paraMestre({ t: 'pendente-removido', id });
    this._paraMestre({ t: 'camera-conectou', slot, nome: p.nome, info: p.info, reconexao: false });
    return true;
  }

  recusar(id) {
    const p = this.pendentes.get(id); if (!p) return false;
    this.pendentes.delete(id);
    this._enviar(p.ws, { t: 'recusado', motivo: 'operador' });
    try { p.ws.close(1000, 'recusado'); } catch (e) { /* */ }
    this._paraMestre({ t: 'pendente-removido', id });
    return true;
  }

  removerSlot(slot, aPedidoDaCamera) {
    const c = this.slots[slot]; if (!c) return;
    delete this.slots[slot];
    if (c.ws && !aPedidoDaCamera) { this._enviar(c.ws, { t: 'removida' }); try { c.ws.close(1000, 'removida'); } catch (e) { /* */ } }
    this._paraMestre({ t: 'camera-removida', slot });
  }

  _cameraFechou(conn) {
    if (conn.pendenteId && this.pendentes.has(conn.pendenteId)) {
      this.pendentes.delete(conn.pendenteId);
      this._paraMestre({ t: 'pendente-removido', id: conn.pendenteId });
      return;
    }
    const slot = this._slotDaConexao(conn.ws);
    if (slot && this.slots[slot] && this.slots[slot].ws === conn.ws) {
      this.slots[slot].ws = null; // slot continua reservado ao aparelho ate sair/remover
      this._paraMestre({ t: 'camera-desconectou', slot });
    }
  }

  _slotDaConexao(ws) {
    return SLOTS.find((s) => this.slots[s] && this.slots[s].ws === ws) || null;
  }

  _ler(dados) {
    try {
      const txt = dados.toString();
      if (txt.length > 200000) return null;
      const m = JSON.parse(txt);
      return m && typeof m.t === 'string' ? m : null;
    } catch (e) { return null; }
  }
}

module.exports = { Sinalizacao, MAX_PENDENTES };
