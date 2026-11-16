/* principal.js - processo principal do Electron (mestre Holives). */
'use strict';
const { app, BrowserWindow, ipcMain, session, safeStorage, shell, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const N = require('./nucleo');
const { obterCertificado, ipsLocais } = require('./certificado');
const { criarServidor } = require('./servidor');
const { GerenteFfmpeg } = require('./ffmpeg');
const { Arquivos } = require('./arquivos');

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
const arquivos = new Arquivos();
let telaEscolhida = '';

// ---- configuracoes (pasta de dados do usuario; a chave de transmissao so e salva cifrada) ----
function arquivoConfig() { return path.join(app.getPath('userData'), 'config.json'); }
function lerConfig() {
  try { return JSON.parse(fs.readFileSync(arquivoConfig(), 'utf8')); } catch (e) { return {}; }
}
function decifrar(texto) {
  if (!texto || !safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(texto, 'base64')); } catch (e) { return ''; }
}
const DESTINOS_PADRAO = [
  { id: 'youtube', nome: 'YouTube', servidor: 'rtmp://a.rtmp.youtube.com/live2', formato: 'horizontal', ativo: true },
  { id: 'facebook', nome: 'Facebook', servidor: 'rtmps://live-api-s.facebook.com:443/rtmp/', formato: 'horizontal', ativo: false },
  { id: 'instagram', nome: 'Instagram', servidor: 'rtmps://live-upload.instagram.com:443/rtmp/', formato: 'vertical', ativo: false }
];
/** Lista de destinos guardada (com chaves cifradas). Migra o formato antigo de um destino so. */
function destinosGuardados(c) {
  if (Array.isArray(c.destinos) && c.destinos.length) return c.destinos;
  return DESTINOS_PADRAO.map((d) => Object.assign({}, d, d.id === 'youtube' ? { servidor: c.servidor || d.servidor, chaveCifrada: c.chaveCifrada || '' } : {}));
}
function configParaRenderer() {
  const c = lerConfig();
  const destinos = destinosGuardados(c).map((d) => ({
    id: d.id, nome: d.nome, servidor: d.servidor || '', formato: d.formato === 'vertical' ? 'vertical' : 'horizontal',
    ativo: !!d.ativo, chave: decifrar(d.chaveCifrada)
  }));
  return {
    pastaGravacao: c.pastaGravacao || path.join(app.getPath('videos'), 'Holives'),
    resolucao: c.resolucao || '1080p', fps: c.fps || 30,
    entradaMesaId: c.entradaMesaId || '', saidaFoneId: c.saidaFoneId || '',
    ipEscolhido: c.ipEscolhido || '',
    webcamId: c.webcamId || '', capturaId: c.capturaId || '', telaId: c.telaId || '',
    destinos,
    podeGuardarChave: safeStorage.isEncryptionAvailable()
  };
}
function salvarConfig(novo) {
  const c = lerConfig();
  ['pastaGravacao', 'resolucao', 'entradaMesaId', 'saidaFoneId', 'ipEscolhido', 'webcamId', 'capturaId', 'telaId'].forEach((k) => { if (typeof novo[k] === 'string') c[k] = novo[k].slice(0, 500); });
  if (novo.fps) c.fps = novo.fps === 60 ? 60 : 30;
  if (Array.isArray(novo.destinos)) {
    const antigos = destinosGuardados(c);
    c.destinos = novo.destinos.slice(0, 8).map((d, i) => {
      const id = String(d.id || 'destino' + i).replace(/[^\w-]/g, '').slice(0, 30) || 'destino' + i;
      const antigo = antigos.find((a) => a.id === id) || {};
      const r = {
        id, nome: String(d.nome || 'Destino').slice(0, 40), servidor: String(d.servidor || '').slice(0, 500),
        formato: d.formato === 'vertical' ? 'vertical' : 'horizontal', ativo: !!d.ativo, chaveCifrada: antigo.chaveCifrada || ''
      };
      // a chave so e guardada cifrada pelo cofre do sistema; sem cofre, nao e guardada
      if (typeof d.chave === 'string') r.chaveCifrada = d.chave && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(d.chave.slice(0, 500)).toString('base64') : '';
      return r;
    });
    delete c.servidor; delete c.chaveCifrada;
  }
  if (Array.isArray(novo.midia)) c.midia = novo.midia.filter((x) => typeof x === 'string').slice(0, 200);
  if (novo.vertical && typeof novo.vertical === 'object') {
    c.vertical = {
      topo: String(novo.vertical.topo || '').slice(0, 1000), base: String(novo.vertical.base || '').slice(0, 1000),
      cor: /^#[0-9a-f]{6}$/i.test(novo.vertical.cor || '') ? novo.vertical.cor : '#15171C',
      texto: String(novo.vertical.texto || '').slice(0, 80)
    };
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
  // ---- arquivos de midia (so os que o operador escolheu)
  const listaMidia = () => (lerConfig().midia || []).map((p) => arquivos.registrar(p)).filter(Boolean).map((i) => arquivos.publico(i, infoRede.portaLocal));
  ipcMain.handle('holives:midia-listar', (e) => (senderConfiavel(e) ? listaMidia() : []));
  ipcMain.handle('holives:midia-adicionar', (e, caminhos) => {
    if (!senderConfiavel(e) || !Array.isArray(caminhos)) return { itens: [], recusados: 0 };
    const atuais = lerConfig().midia || [];
    let recusados = 0;
    caminhos.slice(0, 100).forEach((p) => {
      const item = arquivos.registrar(p);
      if (!item) { recusados++; return; }
      if (!atuais.includes(item.caminho)) atuais.push(item.caminho);
    });
    salvarConfig({ midia: atuais });
    return { itens: listaMidia(), recusados };
  });
  ipcMain.handle('holives:midia-remover', (e, id) => {
    if (!senderConfiavel(e)) return [];
    const item = arquivos.porId.get(String(id));
    if (item) { salvarConfig({ midia: (lerConfig().midia || []).filter((p) => p !== item.caminho) }); arquivos.remover(item.id); }
    return listaMidia();
  });
  // ---- layout vertical (Instagram): artes de cima e de baixo, cor e texto
  const verticalPublico = () => {
    const v = lerConfig().vertical || {};
    const url = (p) => { const i = p && arquivos.registrar(p); return i && i.tipo === 'imagem' ? arquivos.publico(i, infoRede.portaLocal).url : ''; };
    return { topoUrl: url(v.topo), baseUrl: url(v.base), cor: v.cor || '#15171C', texto: v.texto || '' };
  };
  ipcMain.handle('holives:vertical-obter', (e) => (senderConfiavel(e) ? verticalPublico() : null));
  ipcMain.handle('holives:vertical-salvar', (e, v) => {
    if (!senderConfiavel(e) || !v) return null;
    const atual = lerConfig().vertical || {};
    // topo/base: caminho novo (texto), '' para remover, undefined para manter o que ja estava
    const escolher = (novo, antigo) => {
      if (novo === undefined) return antigo || '';
      const i = novo && arquivos.registrar(novo);
      return i && i.tipo === 'imagem' ? i.caminho : '';
    };
    salvarConfig({ vertical: { topo: escolher(v.topo, atual.topo), base: escolher(v.base, atual.base), cor: v.cor, texto: v.texto } });
    return verticalPublico();
  });
  // ---- captura de tela do computador
  ipcMain.handle('holives:telas', async (e) => {
    if (!senderConfiavel(e)) return [];
    try { return (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })).map((s, i) => ({ id: s.id, nome: s.name || 'Tela ' + (i + 1) })); }
    catch (err) { return []; }
  });
  ipcMain.handle('holives:tela-escolher', (e, id) => { if (senderConfiavel(e)) telaEscolhida = String(id || ''); return true; });

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
    raizUi: path.join(RAIZ, 'ui'), raizApp: __dirname, arquivos
  });
  const portas = await servidor.iniciar();
  infoRede = { ips, porta: portas.porta, portaLocal: portas.portaLocal };

  ffmpeg = new GerenteFfmpeg((s) => { if (janela && !janela.isDestroyed()) janela.webContents.send('holives:ffmpeg-status', s); });
  registrarIpc();

  // camera e microfone so para a propria janela do mestre
  const ses = session.defaultSession;
  const permitido = (wc, perm) => wc === (janela && janela.webContents) && ['media', 'audioCapture', 'videoCapture', 'display-capture'].includes(perm);
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(permitido(wc, perm)));
  ses.setPermissionCheckHandler((wc, perm) => permitido(wc, perm));
  // "Tela do computador": entrega a tela escolhida em Configuracoes, sem abrir seletor
  ses.setDisplayMediaRequestHandler((pedido, responder) => {
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((fontes) => { const f = fontes.find((s) => s.id === telaEscolhida) || fontes[0]; if (f) responder({ video: f }); else responder({}); })
      .catch(() => responder({}));
  });

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
