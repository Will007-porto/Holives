# Holives — Fase 1 (mestre Electron + câmeras WebRTC)

Aplicativo de transmissão ao vivo para cultos: o **mestre** (Windows, Electron) recebe até 4 celulares/tablets pelo Wi-Fi,
o operador escolhe o que vai ao ar, mistura o áudio, grava e transmite por RTMP.

> **Estado honesto:** esta fase foi escrita numa sessão na nuvem, sem Windows, sem câmera real, sem interface de áudio e sem
> servidor RTMP real. O que foi (e o que não foi) verificado está descrito abaixo. **Teste tudo no computador antes de usar num culto.**

## Como instalar e rodar

Requisitos: Node.js 20 ou mais novo (testado com 22) e internet na primeira instalação (baixa o Electron e o ffmpeg).

```bash
npm install     # instala Electron, ws, selfsigned, qrcode e ffmpeg-static
npm start       # abre o mestre
npm test        # testes automáticos (sinalização, servidor, núcleo, ffmpeg)
```

Uso rápido:
1. `npm start`. O mestre abre e mostra o QR code em **Adicionar câmera** (clique em “Adicionar câmera”).
2. No celular (mesmo Wi-Fi), leia o QR code. O navegador avisará que o certificado não é confiável: aceite (é o certificado
   autoassinado do próprio mestre; sem HTTPS o navegador não libera a câmera).
3. Toque em **Conectar** no celular e **Aceitar** no mestre. A câmera aparece em “Fontes”.
4. Clique numa fonte para a prévia, **Cortar** (Espaço) ou **Transição** (Enter). Duplo clique vai direto ao ar.
5. Em **Configurações** escolha a entrada da mesa de som, a saída do fone e a pasta de gravação. Em **Destinos** (chip no topo)
   informe servidor e chave RTMP do YouTube. Depois **Gravar** e/ou **Iniciar transmissão**.

Dados do usuário (certificado, configurações) ficam na pasta de dados do Electron do usuário, **nunca no repositório**.
A chave de transmissão só é guardada se o sistema tiver cofre de senhas (Electron `safeStorage`; no Windows usa DPAPI), cifrada.

## O que foi implementado

| # | Item | Onde |
|---|------|------|
| 1 | Projeto Electron abrindo `ui/mestre.html` | `package.json`, `app/principal.js`, `app/preload.js` |
| 2 | HTTPS autoassinado gerado na 1ª execução (regenera se o IP mudar) + `/camera` + WebSocket de sinalização | `app/certificado.js`, `app/servidor.js`, `app/sinalizacao.js` |
| 3 | WebRTC: câmera envia vídeo+áudio; mestre aceita até 4, liga nas tags `video` e atualiza estado (conectada / conectando / sem sinal) | `app/ponte-camera.js`, `app/rtc-mestre.js`, `app/ponte.js` |
| 4 | QR code com `https://IP:PORTA/camera` no modal de câmera (com escolha do IP em Configurações > Rede) | `app/ponte.js`, `app/principal.js` |
| 5 | Mixer de vídeo em canvas: prévia, NO AR, corte, transição fade (e deslizar/zoom) com duração configurável; tally para as câmeras | `app/mixer-video.js`, `app/sinalizacao.js` |
| 6 | Mesa de áudio Web Audio: ganho/mudo por canal, medidores, entrada da mesa por `getUserMedia` com escolha de dispositivo, `DelayNode` (ms), “seguir vídeo” nas câmeras, “ouvir” no fone, predefinições | `app/mixer-audio.js` |
| 7 | Gravação local (MP4) e transmissão RTMP para 1 destino: `MediaRecorder` do canvas + áudio misturado → ffmpeg (`ffmpeg-static`) | `app/gravador.js`, `app/ffmpeg.js` |
| 8 | Adaptador `app/ponte.js`: escuta `holives:acao` e troca os dados do `mock.js` pelos reais | `app/ponte.js` |

### Como funciona (resumo)
- Câmeras entram por `wss://IP:8443/ws`; o mestre fala com o mesmo hub por `ws://127.0.0.1:<porta aleatória>/ws-mestre`
  (só loopback, sem certificado). Só `camera.html`, CSS, `mock.js`, `camera.js` e `app/ponte-camera.js` são publicados na rede.
- Novas câmeras ficam “aguardando aprovação”. Um aparelho já aceito volta ao mesmo slot sozinho se reconectar.
- O ffmpeg grava o MP4 (fragmentado, tolerante a queda; vídeo H.264 é copiado, sem recodificar) e, na transmissão,
  recodifica em H.264 `veryfast` com keyframe a cada 2 s + AAC (YouTube). Gravação e live são processos independentes.
- Encerrar a transmissão também para a gravação (como o texto do modal “Encerrar transmissão?” diz).

## O que foi verificado na nuvem (e como)
- `npm install` e **18 testes automáticos** (`npm test`): hub de sinalização (aceitar/recusar, limite de 4, reconexão no mesmo slot,
  relé de SDP/ICE, tally, mestre que reconecta), servidor (só serve a página da câmera; bloqueia `mestre.html` e `..`),
  certificado, funções puras (dB, medidor, ganho “seguir vídeo”, argumentos do ffmpeg, URL RTMP, redação da chave), e o ffmpeg
  real (WebM → MP4 com vídeo+áudio; RTMP inalcançável dá erro sem vazar a chave). `node --check` em todos os arquivos.
- **Teste de fumaça com dispositivos FALSOS** (`test/manual/e2e-fumaca.js`, Electron sob Xvfb, câmera/microfone falsos do Chromium,
  sem GPU): a câmera falsa conectou, foi aceita, apareceu como “conectada 1080p com áudio”, o tally mudou na câmera, o monitor NO AR
  recebeu pixels, os medidores de áudio se mexeram, a gravação gerou MP4 H.264+AAC e a transmissão chegou a um receptor RTMP local
  (ffmpeg em modo `-listen`). Isso valida a **fiação**; **não** valida hardware nem qualidade.

## O que NÃO pôde ser testado na nuvem (teste no computador)
- **Windows** (só rodou em Linux): janela, instalação, `safeStorage` (DPAPI), firewall do Windows (precisa liberar a porta 8443 na rede privada;
  o Windows costuma perguntar na primeira execução — aceite).
- **Câmeras reais** (Android/Chrome e iPhone/Safari): permissão, câmera traseira/frontal, qualidade 1080p, bateria, consumo e esquentar,
  tela ligada (`wakeLock`), lanterna e zoom (dependem do aparelho), troca de câmera (virar).
- **Áudio real**: interface/mesa de som USB, escolha do dispositivo, **sincronia (atraso em ms) com o vídeo**, eco/retorno no fone
  (o canal “Saída geral” vem com “Ouvir” ligado: use fone, senão pode haver microfonia), troca de saída do fone (`AudioContext.setSinkId`),
  áudio remoto das câmeras passando pelo Web Audio (há um `<video>` mudo escondido para contornar um problema conhecido do Chromium).
- **RTMP real** (YouTube/Facebook): chave, estabilidade, reconexão, qualidade e atraso. Só foi testado contra um receptor local.
- **Carga**: 4 câmeras 1080p ao mesmo tempo + canvas 1080p30 + recodificação por software (CPU). Sem placa de vídeo aqui para medir.
  Se a CPU não aguentar, use 720p em Configurações.
- **Rede Wi-Fi**: descoberta WebRTC entre aparelhos (iPhone pode usar nomes mDNS `.local` nos candidatos; o mestre desliga o
  ocultamento de IPs do próprio Chromium, mas depende de a rede permitir mDNS / isolamento de clientes do roteador desligado).

## Diferenças entre a interface real e o contrato combinado (anotadas)
1. **Evento de transição**: `mestre.js`/`controle.js` emitiam `{tipo:'transicao'}` mas o extra `{tipo: 'fade'}` sobrescrevia o tipo do
   evento (e `definir-transicao` ficava igual a `transicao`). Mudança mínima: o extra agora se chama `estilo`.
2. **Clique na fonte (prévia)** e **abrir-config/abrir-destinos/camera-adicionar (abrir modal)** não emitem `holives:acao`; `audio-ouvir` e
   `destino-alternar` nem são tratados. A ponte observa `S.previaId` (polling de 100 ms) e escuta cliques nesses botões.
3. `camera.js` simulava a conexão (`setTimeout` de 900 ms): foi guardado com `if(!window.HolivesReal)`. `mock.js` não anima mais
   quando existe `window.holivesNativo`. `mestre.html` e `camera.html` ganharam as tags `<script>` da ponte.
4. A lista “Aguardando aprovação”, o QR e o endereço eram texto fixo: a ponte os substitui em tempo de execução.
   Os campos “Dispositivo de entrada da mesa”, “saída do fone” e “Rede — IP” viram listas (`select`) criadas pela ponte.
5. As áreas de vídeo são recriadas a cada `renderAll()`: a ponte reaplica os `srcObject` nos cartões (MutationObserver).
6. O seletor de cenários (F2) é desativado no aplicativo real.
7. `destino-alternar`/`destino-salvar` fecham o modal e mostram “Salvo” (comportamento da interface); a ponte só faz o trabalho real.

## Fase 2 (feita no computador, em 15/11/2026)

| Item | Como usar | Onde |
|------|-----------|------|
| Tela de mídia | Coluna **Mídia**: “Adicionar arquivos” ou arrastar imagens/vídeos. Clique escolhe; botão direito tira da lista. A lista é lembrada ao reabrir. O vídeo começa ao entrar no ar e para ao sair; “Ao terminar” volta sozinho para a fonte anterior. O som da mídia só vai para a live quando a mídia está no ar. | `app/midia.js`, `app/arquivos.js`, `app/ponte-fase2.js` |
| Câmera do computador, placa de captura (datashow) e tela do computador | **Configurações**: escolha o dispositivo de cada uma. Viram as fontes 5, 6 e 7. | `app/ponte-fase2.js`, `app/principal.js` |
| Vários destinos ao mesmo tempo | Chips do topo > **Destinos**: ligue YouTube, Facebook, Instagram e até 5 extras. Os horizontais usam uma única codificação; se um cair, os outros continuam. | `app/ponte.js`, `app/ffmpeg.js`, `app/nucleo.js` |
| Layout vertical 9:16 (Instagram) | Botão **Layout vertical 9:16**: arte de cima, arte de baixo, cor de fundo e texto, com prévia ao vivo. Sai em 720×1280. | `app/layout-vertical.js` |

Verificado neste Windows com `npm test` (23 testes) e com um teste de ponta a ponta usando câmera falsa e três receptores RTMP
locais: mídia (vídeo com som e imagem) no ar, webcam e tela como fontes, três destinos simultâneos (dois em 1920×1080 e um em
720×1280), queda de um destino sem derrubar os outros, e gravação em MP4.
**Não verificado:** YouTube, Facebook e Instagram de verdade (só receptores locais), placa de captura real, e o endereço padrão
do Instagram (`rtmps://live-upload.instagram.com:443/rtmp/`) — copie a URL e a chave que o próprio Instagram mostrar.

Os arquivos de mídia são entregues ao programa por `http://127.0.0.1:<porta>/midia/<token>/<id>` (só neste computador, só os
arquivos que o operador adicionou). Isso é necessário para o mixer poder gravar e transmitir o que desenha.

## Pendências / próximos passos
- Sobreposições (logo/tarja/texto), Holyrics, controle por tablet (`controle.html` não tem ponte).
- Som da placa de captura (HDMI) e da tela do computador: hoje só entra a imagem.
- Com destinos horizontais e verticais juntos há duas codificações ao mesmo tempo; medir a CPU com 4 câmeras reais.
- “Testar conexão” do destino; reconexão automática do RTMP quando cai (hoje encerra e avisa).
- Botão no mestre para **remover** uma câmera já aceita (o hub já aceita `remover`); renomear câmera (modal existe, sem ação); mensagem do operador e retorno do NO AR na câmera (o hub já repassa `mensagem`; falta UI).
- Travar foco/exposição e travar orientação na câmera (botões existem, sem efeito).
- Codificação por placa de vídeo (NVENC/QuickSync) para aliviar a CPU; instalador (electron-builder; lembrar de desempacotar `ffmpeg-static` do asar — `app/ffmpeg.js` já trata o caminho).
- Medição real de CPU/FPS/perdas (hoje: CPU do Electron, kbps/fps/perdidos lidos do ffmpeg).
- Vídeo recebido em H.264/VP8 conforme o navegador negociar; não há controle de codec nem de taxa por câmera no mestre.
- Segurança: o servidor aceita qualquer aparelho da rede para aprovação manual (limite de 8 pendentes). Sem senha/PIN na entrada.
- O áudio da câmera em “seguir vídeo” troca no início da transição (rampa), não é um crossfade exato.
- Predefinições “Só vídeo” e “Só câmera no ar” diferem apenas no canal Mídia (ainda sem fonte).
