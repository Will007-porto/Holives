/* principal.js - processo principal do Electron (mestre Holives). */
'use strict';
const { app, BrowserWindow, ipcMain, session, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const N = require('./nucleo');
const { obterCertificado, ipsLocais } = require('./certificado');
const { criarServidor } = require('./servidor');
const { GerenteFfmpeg } = require('./ffmpeg');

const RAIZ = path.join(__dirname, '..');
const PORTA_PADRAO = 8443;

// A camera exige HTTPS; o mestre precisa tocar audio/video sem clique previo e nao ser freado em segundo plano.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let janela = null;
let servidor = null;
let infoRede = null;
let ffmpeg = null;

// ---- configuracoes (pasta de dados do usuario; a chave de transmissao so e salva cifrada) ----
function arquivoConfig() { return path.join(app.getPath('userData'), 'config.json'); }
function lerConfig() {
  try { return JSON.parse(fs.readFileSync(arquivoConfig(), 'utf8')); } catch (e) { return {}; }
}
function configParaRenderer() {
  const c = lerConfig();
  let chave = '';
  if (c.chaveCifrada && safeStorage.isEncryptionAvailable()) {
    try { chave = safeStorage.decryptString(Buffer.from(c.chaveCifrada, 'base64')); } catch (e) { chave = ''; }
  }
  return {
    pastaGravacao: c.pastaGravacao || path.join(app.getPath('videos'), 'Holives'),
    resolucao: c.resolucao || '1080p', fps: c.fps || 30,
    entradaMesaId: c.entradaMesaId || '', saidaFoneId: c.saidaFoneId || '',
    ipEscolhido: c.ipEscolhido || '',
    destino: { servidor: c.servidor || 'rtmp://a.rtmp.youtube.com/live2', chave: chave },
    podeGuardarChave: safeStorage.isEncryptionAvailable()
  };
}
function salvarConfig(novo) {
  const c = lerConfig();
  ['pastaGravacao', 'resolucao', 'entradaMesaId', 'saidaFoneId', 'ipEscolhido'].forEach((k) => { if (typeof novo[k] === 'string') c[k] = novo[k].slice(0, 500); });
  if (novo.fps) c.fps = novo.fps === 60 ? 60 : 30;
  if (novo.destino) {
    if (typeof novo.destino.servidor === 'string') c.servidor = novo.destino.servidor.slice(0, 500);
    if (typeof novo.destino.chave === 'string') {
      if (novo.destino.chave && safeStorage.isEncryptionAvailable()) c.chaveCifrada = safeStorage.encryptString(novo.destino.chave).toString('base64');
      else delete c.chaveCifrada;
    }
  }
  fs.mkdirSync(path.dirname(arquivoConfig()), { recursive: true });
  fs.writeFileSync(arquivoConfig(), JSON.stringify(c, null, 2));
}

function enderecoCamera(ip) { return 'https://' + ip + ':' + infoRede.porta + '/camera'; }

function senderConfiavel(e) {
  const url = e.senderFrame && e.senderFrame.url || '';
  return url.startsWith('file://') && janela && e.sender === janela.webContents;
}

function registrarIpc() {
  ipcMain.handle('holives:info', (e) => {
    if (!senderConfiavel(e)) return null;
    return { ips: infoRede.ips, porta: infoRede.porta, portaLocal: infoRede.portaLocal, versao: app.getVersion(), plataforma: process.platform };
  });
  ipcMain.handle('holives:qr', async (e, ip) => {
    if (!senderConfiavel(e) || !infoRede.ips.some((i) => i.ip === ip)) return null;
    const url = enderecoCamera(ip);
    return { url, imagem: await QRCode.toDataURL(url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) };
  });
  ipcMain.handle('holives:config-obter', (e) => (senderConfiavel(e) ? configParaRenderer() : null));
  ipcMain.handle('holives:config-salvar', (e, c) => { if (!senderConfiavel(e)) return false; salvarConfig(c || {}); return true; });
  ipcMain.handle('holives:cpu', (e) => {
    if (!senderConfiavel(e)) return 0;
    return Math.round(app.getAppMetrics().reduce((s, m) => s + (m.cpu ? m.cpu.percentCPUUsage : 0), 0));
  });
  ipcMain.handle('holives:ffmpeg-iniciar', (e, o) => {
    if (!senderConfiavel(e)) return { ok: false, erro: 'Origem não permitida.' };
    o = o || {};
    if (o.job === 'gravacao') o.pasta = configParaRenderer().pastaGravacao; // pasta vem sempre da configuracao salva
    return ffmpeg.iniciar(o);
  });
  ipcMain.on('holives:ffmpeg-dados', (e, job, buffer) => { if (senderConfiavel(e)) ffmpeg.dados(job, buffer); });
  ipcMain.handle('holives:ffmpeg-parar', (e, job) => (senderConfiavel(e) ? ffmpeg.parar(job) : false));
}

async function iniciar() {
  const ips = N.ordenarIps(ipsLocais());
  const pastaCert = path.join(app.getPath('userData'), 'certificado');
  const cert = await obterCertificado(pastaCert, ips.map((i) => i.ip));
  servidor = criarServidor({
    cert: cert.cert, key: cert.key, porta: PORTA_PADRAO,
    raizUi: path.join(RAIZ, 'ui'), raizApp: __dirname
  });
  const portas = await servidor.iniciar();
  infoRede = { ips, porta: portas.porta, portaLocal: portas.portaLocal };

  ffmpeg = new GerenteFfmpeg((s) => { if (janela && !janela.isDestroyed()) janela.webContents.send('holives:ffmpeg-status', s); });
  registrarIpc();

  // camera e microfone so para a propria janela do mestre
  const ses = session.defaultSession;
  const permitido = (wc, perm) => wc === (janela && janela.webContents) && ['media', 'audioCapture', 'videoCapture'].includes(perm);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(permitido(wc, perm)));
  ses.setPermissionCheckHandler((wc, perm) => permitido(wc, perm));

  janela = new BrowserWindow({
    width: 1440, height: 860, minWidth: 1100, minHeight: 680, backgroundColor: '#0B0C0F',
    title: 'Holives — Mestre', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false
    }
  });
  janela.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  janela.webContents.on('will-navigate', (ev, url) => { if (!url.startsWith('file://')) ev.preventDefault(); });
  janela.on('closed', () => { janela = null; });
  await janela.loadFile(path.join(RAIZ, 'ui', 'mestre.html'), { query: { ws: String(portas.portaLocal) } });
}

app.whenReady().then(iniciar).catch((e) => { console.error('Falha ao iniciar o Holives:', e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
let encerrando = false;
app.on('before-quit', (ev) => {
  if (encerrando) return;
  encerrando = true;
  if (ffmpeg && ffmpeg.jobs.size) {
    ev.preventDefault();
    ffmpeg.pararTudo().finally(() => { if (servidor) servidor.parar(); app.quit(); });
  } else if (servidor) servidor.parar();
});
app.on('second-instance', () => { if (janela) { if (janela.isMinimized()) janela.restore(); janela.focus(); } });
