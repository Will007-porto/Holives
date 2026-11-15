// Teste de fumaca manual (NAO roda no "npm test"): abre o Electron com camera/microfone FALSOS do Chromium,
// conecta uma camera falsa pelo Playwright e confere RTC, tally, mixer, gravacao e RTMP local.
// Uso (Linux): xvfb-run -a node test/manual/e2e-fumaca.js   (requer o pacote playwright instalado a parte)
const { _electron: electron, chromium } = require('playwright');
(async () => {
  const dados = require('fs').mkdtempSync('/tmp/holives-dados-');
  const app = await electron.launch({ executablePath: require('path').join(__dirname, '../../node_modules/electron/dist/electron'), cwd: require('path').join(__dirname, '../..'), args: ['.', '--no-sandbox', '--disable-gpu', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--user-data-dir=' + dados],
    env: { ...process.env, DISPLAY: process.env.DISPLAY } });
  const win = await app.firstWindow();
  const erros = [];
  win.on('console', (m) => { if (m.type() === 'error' || m.type()==='warning') erros.push(m.type()+': '+m.text()); });
  win.on('pageerror', (e) => erros.push('PAGEERROR ' + e.message));
  await win.waitForTimeout(3000);
  const r = await win.evaluate(() => ({
    nativo: typeof window.holivesNativo, real: window.HolivesReal,
    fontes: window.HolivesState.fontes.map(f => f.id + ':' + f.estado),
    qr: !!document.querySelector('#modal-camera .qr img'),
    end: document.querySelector('#modal-camera p').textContent,
    cenario: window.HolivesState.cenario
  }));
  console.log(JSON.stringify(r));
  const url = r.end.replace('Endereço:', '').trim();
  console.log('URL', url);
  const nav = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
  const ctx = await nav.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] });
  const cam = await ctx.newPage();
  cam.on('console', (m) => erros.push('CAM ' + m.type() + ': ' + m.text()));
  cam.on('pageerror', (e) => erros.push('CAMPAGEERROR ' + e.message));
  await cam.goto(url.replace(/^https:\/\/[^:]+/, 'https://127.0.0.1'));
  await cam.fill('#nome-aparelho', 'Camera de Teste');
  await cam.click('[data-acao="camera-conectar"]');
  await win.waitForTimeout(1500);
  console.log('pendentes', await win.evaluate(() => document.querySelector('#lista-aguardando').textContent));
  await win.click('#lista-aguardando [data-acao="aceitar-camera"]');
  await win.waitForTimeout(5000);
  const e1 = await win.evaluate(() => ({ f: window.HolivesState.fontes.map(f => f.id + ':' + f.nome + ':' + f.estado + ':' + f.resolucao + ':' + f.temAudio),
    tally: null }));
  console.log(JSON.stringify(e1));
  console.log('tally cam', await cam.evaluate(() => document.getElementById('tally-label').textContent));
  // corte para cam1 ja esta no ar (cam1). pixel check do canvas no ar
  const px = await win.evaluate(() => { const v = document.querySelector('#monitor-no-ar video'); const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return { s, w: v.videoWidth, h: v.videoHeight }; });
  console.log('no-ar pixels', JSON.stringify(px));
  // transicao: poe cam1 em previa e corta, etc
  await win.evaluate(() => { document.dispatchEvent(new CustomEvent('holives:acao', {detail:{tipo:'cortar', fonteId:'cam1'}})); });
  await win.waitForTimeout(500);
  console.log('tally apos corte', await cam.evaluate(() => document.getElementById('tally-label').textContent));
  // niveis de audio (maximo em 3s) e transicao
  const niv = await win.evaluate(async () => { const mx = {}; for (let k = 0; k < 40; k++) { window.HolivesState.audio.canais.forEach(c => { mx[c.id] = Math.max(mx[c.id] || 0, c.nivel); }); await new Promise(r => setTimeout(r, 75)); } return Object.entries(mx).map(([a, b]) => a + ':' + b.toFixed(2)).join(' '); });
  console.log('niveis max', niv);
  await win.evaluate(() => { const S = window.HolivesState; S.previaId = 'cam2'; });
  await win.waitForTimeout(300);
  console.log('tally previa', await cam.evaluate(() => document.getElementById('tally-label').textContent));
  // live para receptor RTMP local
  const { spawn } = require('child_process');
  const rx = spawn(require('ffmpeg-static'), ['-y', '-hide_banner', '-listen', '1', '-f', 'flv', '-i', 'rtmp://127.0.0.1:19350/live/teste', '-c', 'copy', '/tmp/holives-rx.flv'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let rxlog = ''; rx.stderr.on('data', d => rxlog += d);
  await new Promise(r => setTimeout(r, 1000));
  await win.evaluate(() => { const ins = document.querySelectorAll('#modal-destinos .destino-card')[0].querySelectorAll('input'); ins[0].value = 'rtmp://127.0.0.1:19350/live'; ins[1].value = 'teste'; document.dispatchEvent(new CustomEvent('holives:acao', {detail:{tipo:'destino-salvar'}})); });
  await win.evaluate(() => { window.HolivesState.transmissao.estado = 'ao-vivo'; document.dispatchEvent(new CustomEvent('holives:acao', {detail:{tipo:'iniciar-live'}})); });
  await win.waitForTimeout(2500);
  // transicao durante a live
  await win.evaluate(() => { document.dispatchEvent(new CustomEvent('holives:acao', {detail:{tipo:'transicao', estilo:'fade'}})); });
  await win.waitForTimeout(6000);
  console.log('estado live', await win.evaluate(() => JSON.stringify(window.HolivesState.transmissao)));
  await win.evaluate(() => { document.dispatchEvent(new CustomEvent('holives:acao', {detail:{tipo:'encerrar-live'}})); });
  await win.waitForTimeout(3000);
  rx.kill('SIGINT'); await new Promise(r => setTimeout(r, 1000));
  console.log('rx', rxlog.split(/[\r\n]+/).filter(l => /Stream|Input|frame=/.test(l)).slice(-5).join('\n'));
  console.log(require('child_process').execSync('ls -la /tmp/holives-rx.flv').toString());
  console.log('ERROS', erros.slice(0, 20).join('\n'));
  await nav.close(); await app.close();
})().catch((e) => { console.error('FALHA', e); process.exit(1); });
