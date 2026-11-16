/* preload.js - ponte segura entre o renderer (interface) e o processo principal. */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('holivesNativo', {
  info: () => ipcRenderer.invoke('holives:info'),
  qr: (ip) => ipcRenderer.invoke('holives:qr', ip),
  configObter: () => ipcRenderer.invoke('holives:config-obter'),
  configSalvar: (c) => ipcRenderer.invoke('holives:config-salvar', c),
  cpu: () => ipcRenderer.invoke('holives:cpu'),
  ffmpegIniciar: (o) => ipcRenderer.invoke('holives:ffmpeg-iniciar', o),
  ffmpegDados: (job, buffer) => ipcRenderer.send('holives:ffmpeg-dados', job, buffer),
  ffmpegParar: (job) => ipcRenderer.invoke('holives:ffmpeg-parar', job),
  // arquivos de midia: o renderer so informa o caminho do arquivo que o proprio usuario escolheu/arrastou
  caminhoArquivo: (arquivo) => { try { return webUtils.getPathForFile(arquivo); } catch (e) { return ''; } },
  midiaListar: () => ipcRenderer.invoke('holives:midia-listar'),
  midiaAdicionar: (caminhos) => ipcRenderer.invoke('holives:midia-adicionar', caminhos),
  midiaRemover: (id) => ipcRenderer.invoke('holives:midia-remover', id),
  verticalObter: () => ipcRenderer.invoke('holives:vertical-obter'),
  verticalSalvar: (v) => ipcRenderer.invoke('holives:vertical-salvar', v),
  telas: () => ipcRenderer.invoke('holives:telas'),
  telaEscolher: (id) => ipcRenderer.invoke('holives:tela-escolher', id),
  aoStatusFfmpeg: (fn) => ipcRenderer.on('holives:ffmpeg-status', (_e, s) => fn(s))
});
