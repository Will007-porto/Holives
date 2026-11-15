/* Holives — mock.js — ÚNICO lugar de estado simulado. Nenhuma lógica real de vídeo/rede. */
window.HolivesState = {
  cenario: "pronto",
  transmissao: { estado: "offline", inicio: null, kbps: 0, fps: 30, quadrosPerdidos: 0.2, cpu: 18 },
  gravacao: { ativa: false, inicio: null },
  destinos: [
    { id: "youtube", nome: "YouTube", estado: "pronto", formato: "horizontal", qualidade: "1080p", kbps: 6000, servidor: "rtmp://a.rtmp.youtube.com/live2", chave: "••••••••" },
    { id: "facebook", nome: "Facebook", estado: "desligado", formato: "horizontal", qualidade: "720p", kbps: 4500, servidor: "rtmps://live-api-s.facebook.com:443/rtmp/", chave: "••••••••" },
    { id: "instagram", nome: "Instagram", estado: "pronto", formato: "vertical", qualidade: "720p", kbps: 4500, servidor: "rtmps://instagram.com/live", chave: "••••••••" }
  ],
  fontes: [
    { id: "cam1", tipo: "camera", nome: "Câmera central", estado: "conectada", bateria: 82, sinal: 92, resolucao: "1080p", temAudio: true },
    { id: "cam2", tipo: "camera", nome: "Câmera do púlpito", estado: "conectada", bateria: 64, sinal: 88, resolucao: "1080p", temAudio: true },
    { id: "cam3", tipo: "camera", nome: "Câmera do louvor", estado: "conectando", bateria: 48, sinal: 61, resolucao: "720p", temAudio: false },
    { id: "cam4", tipo: "camera", nome: "Câmera lateral", estado: "sem-sinal", bateria: 12, sinal: 0, resolucao: "1080p", temAudio: true },
    { id: "webcam", tipo: "webcam", nome: "Câmera do computador", estado: "conectada", bateria: null, sinal: 100, resolucao: "720p", temAudio: true },
    { id: "captura", tipo: "captura", nome: "Datashow", estado: "conectada", bateria: null, sinal: 100, resolucao: "1080p", temAudio: false },
    { id: "tela", tipo: "tela", nome: "Tela do computador", estado: "conectada", bateria: null, sinal: 100, resolucao: "1080p", temAudio: false },
    { id: "midia", tipo: "midia", nome: "Tela de mídia", estado: "conectada", bateria: null, sinal: 100, resolucao: "1080p", temAudio: true }
  ],
  previaId: "cam2",
  noArId: "cam1",
  transicao: { tipo: "fade", duracao: 500, progresso: 0 },
  audio: {
    canais: [
      { id: "mesa", nome: "Mesa de som", volume: -12, mudo: false, ouvir: false, seguirVideo: false, nivel: 0.62, atraso: 120 },
      { id: "cam1", nome: "Câmera central", volume: -18, mudo: false, ouvir: false, seguirVideo: true, nivel: 0.28, atraso: 0 },
      { id: "cam2", nome: "Câmera do púlpito", volume: -20, mudo: false, ouvir: false, seguirVideo: true, nivel: 0.18, atraso: 0 },
      { id: "cam3", nome: "Câmera do louvor", volume: -22, mudo: true, ouvir: false, seguirVideo: true, nivel: 0.05, atraso: 0 },
      { id: "cam4", nome: "Câmera lateral", volume: -20, mudo: false, ouvir: false, seguirVideo: true, nivel: 0, atraso: 0 },
      { id: "midia", nome: "Mídia", volume: -14, mudo: false, ouvir: false, seguirVideo: false, nivel: 0.42, atraso: 0 },
      { id: "saida", nome: "Saída geral", volume: -8, mudo: false, ouvir: true, seguirVideo: false, nivel: 0.68, atraso: 0 }
    ],
    preset: "mesa-video"
  },
  midia: {
    itens: [
      { id: "m1", nome: "Vídeo de abertura", tipo: "video", duracao: "00:42", thumb: "Abertura" },
      { id: "m2", nome: "Aviso da semana", tipo: "video", duracao: "01:12", thumb: "Aviso" },
      { id: "m3", nome: "Versículo — Salmos 122", tipo: "imagem", duracao: "—", thumb: "Salmos" },
      { id: "m4", nome: "Logo igreja — fundo escuro", tipo: "imagem", duracao: "—", thumb: "Logo" }
    ],
    selecionadoId: "m1", tocando: false, posicao: 12, loop: true, aoTerminar: "voltar"
  },
  sobreposicoes: {
    logo: { ativa: true, posicao: "superior-direita", tamanho: 72, opacidade: 90 },
    tarja: { ativa: true, linha1: "Pr. Rafael Souza", linha2: "Mensagem — Domingo 19h", salvas: ["Pr. Rafael Souza — Mensagem", "Louvor — Equipe Adoração", "Avisos — Secretaria"] },
    texto: { ativa: false, conteudo: "Bem-vindos! Compartilhe esta live." },
    holyrics: { ativa: true, conexao: "conectado", posicao: "inferior", mostrar: true }
  },
  config: { resolucao: "1080p", fps: 30, codificador: "H.264", entradaMesa: "Mesa de som USB", saidaFone: "Fone do operador", amostragem: "48 kHz", pastaGravacao: "C:\\Holives\\Gravações", formatoGravacao: "MP4", holyricsIp: "192.168.0.20", holyricsPorta: 8080, holyricsToken: "holives-igreja", ipMestre: "192.168.0.10", porta: 8443 },
  aguardando: [
    { id: "aguard1", nome: "iPhone de Ana", modelo: "iPhone 14" },
    { id: "aguard2", nome: "Galaxy de Pedro", modelo: "Galaxy S23" }
  ],
  mensagemOperador: "Aproxime mais — mostre o púlpito",
  cameraAtual: { nome: "Câmera do corredor", camera: "traseira", qualidade: "1080p", enviarAudio: true, estado: "conectada", tally: "previa" }
};
(function animar(){
  var s = window.HolivesState;
  setInterval(function(){
    var t = s.transmissao;
    if(t.estado === "ao-vivo"){
      t.kbps = Math.max(3200, Math.min(6800, t.kbps + (Math.random()*240-120)));
      t.fps = 29 + Math.round(Math.random()*2);
      t.cpu = Math.max(12, Math.min(68, t.cpu + (Math.random()*6-3)));
      t.quadrosPerdidos = Math.max(0, Math.min(3.2, t.quadrosPerdidos + (Math.random()*0.4-0.2)));
    }
    s.audio.canais.forEach(function(c){
      if(c.mudo){ c.nivel = 0; return; }
      var base = c.id === "mesa" ? .62 : c.id === "saida" ? .68 : c.id === "midia" ? .42 : .22;
      c.nivel = Math.max(0, Math.min(1, base + (Math.random()*0.18-0.09)));
    });
    document.dispatchEvent(new CustomEvent("holives:tick"));
  }, 800);
})();
