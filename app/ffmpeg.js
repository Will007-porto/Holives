/* ffmpeg.js - (processo principal) gerencia os processos ffmpeg que recebem o WebM do MediaRecorder
 * pelo stdin e gravam em arquivo (job "gravacao") ou enviam por RTMP (job "live"). */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const N = require('./nucleo');

function caminhoFfmpeg() {
  let p = require('ffmpeg-static');
  if (p && p.indexOf('app.asar') >= 0) p = p.replace('app.asar', 'app.asar.unpacked'); // app empacotado
  return p;
}

function dataParaNome(d) {
  const z = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds());
}

function redigir(texto, chaves) {
  let t = String(texto == null ? '' : texto);
  [].concat(chaves || []).forEach((c) => { t = N.redigirChave(t, c); });
  return N.redigirChave(t, '');
}

class GerenteFfmpeg {
  constructor(aoStatus, binario) {
    this.aoStatus = aoStatus || function () {};
    this.binario = binario || caminhoFfmpeg();
    this.jobs = new Map();
  }

  /** opcoes: {job:'gravacao'|'live'|'live-v', mime, fps, kbps, pasta, servidor, chave, destinos:[{servidor,chave}]}
   *  "live" = destinos horizontais; "live-v" = destinos verticais (Instagram). Cada um tem a sua codificacao. */
  async iniciar(o) {
    if (o.job !== 'gravacao' && o.job !== 'live' && o.job !== 'live-v') return { ok: false, erro: 'Tarefa inválida.' };
    if (this.jobs.has(o.job)) return { ok: false, erro: 'Já está em andamento.' };
    let args, chave = [], caminho = null;
    if (o.job !== 'gravacao') {
      const lista = Array.isArray(o.destinos) && o.destinos.length ? o.destinos.slice(0, 8) : [{ servidor: o.servidor, chave: o.chave }];
      const urls = [];
      for (const d of lista) {
        const r = N.montarUrlRtmp(d && d.servidor, d && d.chave);
        if (!r.ok) return { ok: false, erro: r.erro };
        urls.push(r.url); chave.push(String(d.chave).trim());
      }
      args = N.argsFfmpeg({ tipo: 'rtmp', mime: o.mime, urls, kbps: Number(o.kbps) || 4500, fps: Number(o.fps) || 30 });
    } else {
      try {
        const pasta = path.resolve(String(o.pasta || ''));
        if (!o.pasta) throw new Error('Pasta de gravação não definida.');
        fs.mkdirSync(pasta, { recursive: true });
        caminho = path.join(pasta, 'holives-' + dataParaNome(new Date()) + '.mp4');
      } catch (e) { return { ok: false, erro: 'Não foi possível usar a pasta de gravação: ' + e.message }; }
      args = N.argsFfmpeg({ tipo: 'arquivo', mime: o.mime, caminho, fps: Number(o.fps) || 30 });
    }
    return new Promise((resolve) => {
      let proc;
      try { proc = spawn(this.binario, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true }); }
      catch (e) { return resolve({ ok: false, erro: 'Não foi possível iniciar o ffmpeg: ' + e.message }); }
      const job = { proc, chave, caminho, ultimas: [], perdidosBytes: 0, resolvido: false, parando: false };
      this.jobs.set(o.job, job);
      proc.once('spawn', () => { job.resolvido = true; resolve({ ok: true, caminho }); this.aoStatus({ job: o.job, estado: 'rodando', caminho }); });
      proc.once('error', (e) => {
        this.jobs.delete(o.job);
        if (!job.resolvido) { job.resolvido = true; resolve({ ok: false, erro: 'Falha ao executar o ffmpeg: ' + e.message }); }
        else this.aoStatus({ job: o.job, estado: 'erro', mensagem: redigir(e.message, chave) });
      });
      proc.stdin.on('error', () => { /* ffmpeg fechou o pipe: o evento "close" informa */ });
      proc.stderr.on('data', (buf) => {
        String(buf).split(/[\r\n]+/).forEach((linha) => {
          if (!linha.trim()) return;
          const p = N.parseProgressoFfmpeg(linha);
          if (p) this.aoStatus({ job: o.job, estado: 'progresso', progresso: p });
          else {
            const caiu = N.parseFalhaTee(linha);
            if (caiu >= 0) this.aoStatus({ job: o.job, estado: 'destino-falhou', indice: caiu });
            job.ultimas.push(redigir(linha, chave)); if (job.ultimas.length > 12) job.ultimas.shift();
          }
        });
      });
      proc.once('close', (codigo) => {
        this.jobs.delete(o.job);
        const ok = job.parando || codigo === 0;
        this.aoStatus({
          job: o.job, estado: ok ? 'encerrado' : 'erro', caminho,
          mensagem: ok ? '' : 'O ffmpeg terminou com erro (código ' + codigo + '). ' + job.ultimas.slice(-3).join(' | ')
        });
      });
    });
  }

  dados(job, buffer) {
    const j = this.jobs.get(job);
    if (!j || j.parando || !j.proc.stdin.writable) return false;
    if (j.proc.stdin.writableLength > 64 * 1024 * 1024) { j.perdidosBytes += buffer.length; return false; } // fila gigante: descarta
    j.proc.stdin.write(Buffer.from(buffer));
    return true;
  }

  parar(job) {
    const j = this.jobs.get(job);
    if (!j) return Promise.resolve(false);
    j.parando = true;
    return new Promise((resolve) => {
      const t = setTimeout(() => { try { j.proc.kill('SIGKILL'); } catch (e) { /* */ } }, 10000);
      j.proc.once('close', () => { clearTimeout(t); resolve(true); });
      try { j.proc.stdin.end(); } catch (e) { /* */ }
    });
  }

  pararTudo() { return Promise.all([...this.jobs.keys()].map((k) => this.parar(k))); }
}

module.exports = { GerenteFfmpeg, caminhoFfmpeg };
