/* mixer-audio.js - mesa de audio com Web Audio API.
 * Cada canal: fonte -> ganho (fader/mudo) -> medidor -> ganho "seguir video" -> barramento -> saida.
 * A mesa de som entra por getUserMedia e passa por um DelayNode (atraso em ms). */
(function (raiz) {
  'use strict';
  var N = raiz.HolivesNucleo;
  var CONST_TEMPO = 0.02;

  function Mesa() {
    this.ctx = null;
    this.canais = {};       // id -> {fonte, fader, analisador, seguir, buffer}
    this.entradaMesa = null; // {stream, fonte, atraso}
    this.entradaId = '';
    this.atrasoMs = 0;
  }

  Mesa.prototype.iniciar = function (idsCanais) {
    var AC = raiz.AudioContext || raiz.webkitAudioContext;
    this.ctx = new AC({ sampleRate: 48000, latencyHint: 'interactive' });
    var ctx = this.ctx;
    this.barramento = ctx.createGain();
    this.saida = ctx.createGain();          // "Saida geral" (fader + mudo)
    this.analisadorSaida = ctx.createAnalyser(); this.analisadorSaida.fftSize = 1024;
    this.destino = ctx.createMediaStreamDestination(); // o que vai para gravacao/transmissao
    this.monitor = ctx.createGain();        // fone do operador
    this.barramento.connect(this.saida);
    this.saida.connect(this.analisadorSaida);
    this.saida.connect(this.destino);
    this.monitor.connect(ctx.destination);
    this.saidaOuvir = ctx.createGain(); this.saidaOuvir.gain.value = 0;
    this.saida.connect(this.saidaOuvir); this.saidaOuvir.connect(this.monitor);
    var self = this;
    idsCanais.forEach(function (id) {
      if (id === 'saida') return;
      var fader = ctx.createGain(), an = ctx.createAnalyser(), seguir = ctx.createGain(), ouvir = ctx.createGain();
      an.fftSize = 1024; ouvir.gain.value = 0;
      fader.connect(an); an.connect(seguir); seguir.connect(self.barramento);
      seguir.connect(ouvir); ouvir.connect(self.monitor);
      self.canais[id] = { id: id, fonte: null, fader: fader, analisador: an, seguir: seguir, ouvir: ouvir, buffer: new Float32Array(an.fftSize) };
    });
    this.bufferSaida = new Float32Array(this.analisadorSaida.fftSize);
    // entrada da mesa tem um DelayNode proprio, ligado ao canal "mesa"
    this.atraso = ctx.createDelay(1.0);
    this.atraso.delayTime.value = this.atrasoMs / 1000;
    if (this.canais.mesa) this.atraso.connect(this.canais.mesa.fader);
    return this;
  };

  Mesa.prototype.retomar = function () { if (this.ctx && this.ctx.state !== 'running') return this.ctx.resume(); };

  /** Liga/desliga o audio de uma camera (stream com faixa de audio). */
  Mesa.prototype.definirFonteStream = function (id, stream) {
    var c = this.canais[id]; if (!c) return;
    if (c.fonte) { try { c.fonte.disconnect(); } catch (e) { /* */ } c.fonte = null; }
    if (stream && stream.getAudioTracks().length) {
      c.fonte = this.ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      c.fonte.connect(c.fader);
    }
  };

  /** Liga o som de um elemento <video> (tela de midia) a um canal. So pode ser chamado uma vez por elemento. */
  Mesa.prototype.definirFonteElemento = function (id, elemento) {
    var c = this.canais[id]; if (!c || c.fonte) return;
    c.fonte = this.ctx.createMediaElementSource(elemento);
    c.fonte.connect(c.fader);
  };

  /** Abre a interface de audio escolhida. deviceId '' = desligada. */
  Mesa.prototype.definirEntradaMesa = async function (deviceId) {
    if (this.entradaMesa) {
      try { this.entradaMesa.fonte.disconnect(); } catch (e) { /* */ }
      this.entradaMesa.stream.getTracks().forEach(function (t) { t.stop(); });
      this.entradaMesa = null;
    }
    this.entradaId = deviceId || '';
    if (!deviceId) return { ok: true };
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 }
      }, video: false });
      var fonte = this.ctx.createMediaStreamSource(stream);
      fonte.connect(this.atraso);
      this.entradaMesa = { stream: stream, fonte: fonte };
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: e && e.name === 'NotAllowedError' ? 'Permissão de microfone negada.' : 'Não foi possível abrir a entrada de áudio (' + (e && e.name) + ').' };
    }
  };

  Mesa.prototype.definirAtraso = function (ms) {
    this.atrasoMs = Math.max(0, Math.min(1000, ms || 0));
    if (this.atraso) this.atraso.delayTime.setTargetAtTime(this.atrasoMs / 1000, this.ctx.currentTime, 0.05);
  };

  Mesa.prototype.definirSaidaFone = async function (deviceId) {
    if (this.ctx && typeof this.ctx.setSinkId === 'function') {
      try { await this.ctx.setSinkId(deviceId || ''); return true; } catch (e) { return false; }
    }
    return false;
  };

  /** Aplica volume/mudo/seguir-video/ouvir de todos os canais. canaisEstado: S.audio.canais; noArId: fonte no ar. */
  Mesa.prototype.aplicar = function (canaisEstado, noArId, constante) {
    if (!this.ctx) return;
    var t = this.ctx.currentTime, tc = constante || CONST_TEMPO, self = this;
    canaisEstado.forEach(function (c) {
      if (c.id === 'saida') {
        self.saida.gain.setTargetAtTime(c.mudo ? 0 : N.dbParaLinear(c.volume), t, tc);
        self.saidaOuvir.gain.setTargetAtTime(c.ouvir ? 1 : 0, t, tc);
        return;
      }
      var k = self.canais[c.id]; if (!k) return;
      // fader e mudo
      k.fader.gain.setTargetAtTime(c.mudo ? 0 : N.dbParaLinear(c.volume), t, tc);
      // "seguir video": camera so soa quando esta no ar
      // o som da midia tambem so vai para a live quando a tela de midia esta no ar
      var segue = c.id === 'midia' ? (noArId === 'midia' ? 1 : 0)
        : (c.seguirVideo && N.SLOTS.indexOf(c.id) >= 0) ? (c.id === noArId ? 1 : 0) : 1;
      k.seguir.gain.setTargetAtTime(segue, t, constante || CONST_TEMPO);
      k.ouvir.gain.setTargetAtTime(c.ouvir ? 1 : 0, t, tc);
    });
  };

  function rms(an, buf) {
    an.getFloatTimeDomainData(buf);
    var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /** Niveis 0..1 para os medidores. */
  Mesa.prototype.niveis = function () {
    var r = {}, self = this;
    Object.keys(this.canais).forEach(function (id) { var k = self.canais[id]; r[id] = N.nivelDeRms(rms(k.analisador, k.buffer)); });
    if (this.analisadorSaida) r.saida = N.nivelDeRms(rms(this.analisadorSaida, this.bufferSaida));
    return r;
  };

  raiz.HolivesMesaAudio = Mesa;
})(window);
