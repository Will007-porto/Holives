/* rtc-mestre.js - lado do mestre: WebSocket de sinalizacao local + uma RTCPeerConnection por camera. */
(function (raiz) {
  'use strict';

  function RtcMestre(portaLocal, cb) {
    this.url = 'ws://127.0.0.1:' + portaLocal + '/ws-mestre';
    this.cb = cb;
    this.pcs = {};        // slot -> {pc, stream, fila de ice, estado}
    this.ws = null;
    this.fechado = false;
  }

  RtcMestre.prototype.conectar = function () {
    var self = this;
    var ws = this.ws = new WebSocket(this.url);
    ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } self._msg(m); };
    ws.onclose = function () { if (!self.fechado) setTimeout(function () { self.conectar(); }, 1000); };
    ws.onopen = function () { if (self.cb.aoConectarSinalizacao) self.cb.aoConectarSinalizacao(); };
  };

  RtcMestre.prototype._enviar = function (o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); };
  RtcMestre.prototype.aceitar = function (id) { this._enviar({ t: 'aceitar', id: id }); };
  RtcMestre.prototype.recusar = function (id) { this._enviar({ t: 'recusar', id: id }); };
  RtcMestre.prototype.remover = function (slot) { this._enviar({ t: 'remover', slot: slot }); this._fechar(slot); };
  RtcMestre.prototype.enviarTally = function (previa, noAr) { this._enviar({ t: 'tally', previa: previa, noAr: noAr }); };
  RtcMestre.prototype.enviarMensagem = function (texto, slot) { this._enviar({ t: 'mensagem', texto: texto, slot: slot }); };

  RtcMestre.prototype._msg = function (m) {
    var cb = this.cb;
    switch (m.t) {
      case 'estado-inicial': cb.aoRoster(m); break;
      case 'pendente': cb.aoPendente(m); break;
      case 'pendente-removido': cb.aoPendenteRemovido(m.id); break;
      case 'camera-conectou': cb.aoCameraConectou(m); break;
      case 'camera-desconectou': cb.aoCameraDesconectou(m.slot); break;
      case 'camera-removida': this._fechar(m.slot); cb.aoCameraRemovida(m.slot); break;
      case 'estado-camera': cb.aoEstadoCamera(m.slot, m.info); break;
      case 'sdp': this._aoSdp(m.slot, m.dados); break;
      case 'ice': this._aoIce(m.slot, m.dados); break;
    }
  };

  RtcMestre.prototype._fechar = function (slot) {
    var p = this.pcs[slot]; if (!p) return;
    clearInterval(p.timerStats);
    try { p.pc.close(); } catch (e) { /* */ }
    delete this.pcs[slot];
    this.cb.aoStream(slot, null);
    this.cb.aoEstadoRtc(slot, 'closed');
  };

  RtcMestre.prototype._aoSdp = async function (slot, desc) {
    if (!desc || desc.type !== 'offer') return;
    var self = this;
    this._fechar(slot);
    var pc = new RTCPeerConnection({ iceServers: [] }); // rede local: sem STUN/TURN
    var p = this.pcs[slot] = { pc: pc, stream: new MediaStream(), ice: [], remotoPronto: false, timerStats: null };
    pc.ontrack = function (ev) {
      p.stream.addTrack(ev.track);
      ev.track.onended = function () { try { p.stream.removeTrack(ev.track); } catch (e) { /* */ } };
      self.cb.aoStream(slot, p.stream);
    };
    pc.onicecandidate = function (ev) { if (ev.candidate) self._enviar({ t: 'ice', slot: slot, dados: ev.candidate }); };
    pc.onconnectionstatechange = function () {
      self.cb.aoEstadoRtc(slot, pc.connectionState);
      if (pc.connectionState === 'failed') self._enviar({ t: 'renegociar', slot: slot });
    };
    p.timerStats = setInterval(function () { self._estatisticas(slot); }, 2000);
    try {
      await pc.setRemoteDescription(desc);
      p.remotoPronto = true;
      for (var i = 0; i < p.ice.length; i++) { try { await pc.addIceCandidate(p.ice[i]); } catch (e) { /* */ } }
      p.ice = [];
      var resp = await pc.createAnswer();
      await pc.setLocalDescription(resp);
      this._enviar({ t: 'sdp', slot: slot, dados: pc.localDescription });
    } catch (e) {
      this._fechar(slot);
      this.cb.aoErro('Falha ao negociar vídeo com ' + slot + ': ' + e.message);
    }
  };

  RtcMestre.prototype._aoIce = async function (slot, cand) {
    var p = this.pcs[slot]; if (!p || !cand) return;
    if (!p.remotoPronto) { p.ice.push(cand); return; }
    try { await p.pc.addIceCandidate(cand); } catch (e) { /* candidato tardio */ }
  };

  RtcMestre.prototype._estatisticas = async function (slot) {
    var p = this.pcs[slot]; if (!p) return;
    try {
      var rel = await p.pc.getStats(), info = {};
      rel.forEach(function (r) {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          info.altura = r.frameHeight; info.fps = r.framesPerSecond;
          var tot = (r.packetsReceived || 0) + (r.packetsLost || 0);
          info.perdaPct = tot ? (100 * (r.packetsLost || 0) / tot) : 0;
          info.quadros = r.framesDecoded;
        }
      });
      this.cb.aoStats(slot, info);
    } catch (e) { /* conexao fechando */ }
  };

  RtcMestre.prototype.fechar = function () {
    this.fechado = true;
    var self = this; Object.keys(this.pcs).forEach(function (s) { self._fechar(s); });
    if (this.ws) this.ws.close();
  };

  raiz.HolivesRtcMestre = RtcMestre;
})(window);
