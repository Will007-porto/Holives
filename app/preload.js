/* preload.js - ponte segura entre o renderer (interface) e o processo principal. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('holivesNativo', {
  info: () => ipcRenderer.invoke('holives:info'),
  qr: (ip) => ipcRenderer.invoke('holives:qr', ip),
  configObter: () => ipcRenderer.invoke('holives:config-obter'),
  configSalvar: (c) => ipcRenderer.invoke('holives:config-salvar', c),
  cpu: () => ipcRenderer.invoke('holives:cpu'),
  ffmpegIniciar: (o) => ipcRenderer.invoke('holives:ffmpeg-iniciar', o),
  ffmpegDados: (job, buffer) => ipcRenderer.send('holives:ffmpeg-dados', job, buffer),
  ffmpegParar: (job) => ipcRenderer.invoke('holives:ffmpeg-parar', job),
  aoStatusFfmpeg: (fn) => ipcRenderer.on('holives:ffmpeg-status', (_e, s) => fn(s))
});
