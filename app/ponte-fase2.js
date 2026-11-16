/* ponte-fase2.js - fontes locais (webcam, placa de captura, tela), tela de midia e layout vertical.
 * Carregado antes de ponte.js, que chama HolivesFase2.iniciar(api) com o que este modulo precisa. */
(function (raiz) {
  'use strict';

  function iniciar(api) {
    var S = api.S, N = api.N, nativo = api.nativo, cfg = api.cfg;
    function $(id) { return document.getElementById(id); }

    // ================================================================ fontes locais
    var LOCAIS = ['webcam', 'captura', 'tela'];
    var abertos = {};   // id -> {stream, chave}
    LOCAIS.forEach(function (id) { api.iniciarFonteVideo(id); });

    function fechar(id) {
      var a = abertos[id]; if (!a) return;
      delete abertos[id];
      a.stream.getTracks().forEach(function (t) { t.onended = null; t.stop(); });
      api.aoStream(id, null);
    }
    function marcar(id, stream) {
      var f = api.fonte(id); if (!f) return;
      if (stream) {
        var cfgTrilha = stream.getVideoTracks()[0].getSettings();
        f.estado = 'conectada'; f.sinal = 100; f.resolucao = N.rotuloResolucao(cfgTrilha.height);
      } else { f.estado = 'sem-sinal'; f.sinal = 0; f.resolucao = '—'; }
      api.rerender(); api.atualizarMonitores();
    }
    function ligar(id, stream, chave) {
      abertos[id] = { stream: stream, chave: chave };
      stream.getVideoTracks()[0].onended = function () {
        if (abertos[id] && abertos[id].stream === stream) { fechar(id); marcar(id, null); api.toast(api.fonte(id).nome + ' foi desconectada.', true); }
      };
      api.aoStream(id, stream); marcar(id, stream);
    }

    async function abrirDispositivo(id, deviceId) {
      if (abertos[id] && abertos[id].chave === deviceId) return;
      fechar(id);
      if (!deviceId) { marcar(id, null); return; }
      try {
        var stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 }
        } });
        ligar(id, stream, deviceId);
      } catch (e) {
        marcar(id, null);
        api.toast('Não foi possível abrir ' + api.fonte(id).nome + (e && e.name === 'NotReadableError' ? ': o dispositivo está em uso por outro programa.' : ' (' + (e && e.name) + ').'), true);
      }
    }

    async function abrirTela(telaId) {
      if (abertos.tela && abertos.tela.chave === telaId) return;
      fechar('tela');
      if (!telaId) { marcar('tela', null); return; }
      try {
        await nativo.telaEscolher(telaId);
        var stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
        ligar('tela', stream, telaId);
      } catch (e) { marcar('tela', null); api.toast('Não foi possível capturar a tela (' + (e && e.name) + ').', true); }
    }

    function aplicarLocais() {
      // a mesma entrada de video nao pode servir de webcam e de captura ao mesmo tempo
      var cap = cfg.capturaId && cfg.capturaId === cfg.webcamId ? '' : cfg.capturaId;
      return Promise.all([abrirDispositivo('webcam', cfg.webcamId), abrirDispositivo('captura', cap), abrirTela(cfg.telaId)]);
    }

    function campoNovo(depoisDe, rotulo, id) {
      var d = document.createElement('div'); d.className = 'campo';
      var l = document.createElement('label'); l.textContent = rotulo; l.htmlFor = id;
      var s = document.createElement('select'); s.id = id;
      d.appendChild(l); d.appendChild(s); depoisDe.after(d); return d;
    }
    function prepararConfig() {
      var ref = api.campoPor('Dispositivo de saída do fone'); if (!ref || $('cfg-webcam')) return;
      var c3 = campoNovo(ref, 'Tela do computador (fonte de vídeo)', 'cfg-tela');
      var c2 = campoNovo(ref, 'Placa de captura (datashow)', 'cfg-captura');
      campoNovo(ref, 'Câmera do computador', 'cfg-webcam');
      void c2; void c3;
    }
    async function listarVideo(pedirPermissao) {
      var sw = $('cfg-webcam'), sc = $('cfg-captura'), st = $('cfg-tela'); if (!sw) return;
      try {
        var lista = await navigator.mediaDevices.enumerateDevices();
        if (pedirPermissao && !lista.some(function (d) { return d.kind === 'videoinput' && d.label; }) && lista.some(function (d) { return d.kind === 'videoinput'; })) {
          try { var t = await navigator.mediaDevices.getUserMedia({ video: true }); t.getTracks().forEach(function (x) { x.stop(); }); lista = await navigator.mediaDevices.enumerateDevices(); } catch (e) { /* lista sem nomes */ }
        }
        var cams = lista.filter(function (d) { return d.kind === 'videoinput'; });
        [[sw, cfg.webcamId], [sc, cfg.capturaId]].forEach(function (par) {
          var atual = par[0].options.length ? par[0].value : par[1];
          par[0].innerHTML = '';
          par[0].appendChild(api.opcao('', '(desligada)', !atual));
          cams.forEach(function (d, i) { par[0].appendChild(api.opcao(d.deviceId, d.label || 'Entrada de vídeo ' + (i + 1), d.deviceId === atual)); });
        });
        var telas = await nativo.telas(), atualT = st.options.length ? st.value : cfg.telaId;
        st.innerHTML = '';
        st.appendChild(api.opcao('', '(desligada)', !atualT));
        telas.forEach(function (t) { st.appendChild(api.opcao(t.id, t.nome, t.id === atualT)); });
      } catch (e) { /* ignora */ }
    }
    async function salvarConfigLocais() {
      var sw = $('cfg-webcam'); if (!sw || !sw.options.length) return;
      cfg.webcamId = sw.value; cfg.capturaId = $('cfg-captura').value; cfg.telaId = $('cfg-tela').value;
      if (cfg.capturaId && cfg.capturaId === cfg.webcamId) api.toast('A câmera do computador e a placa de captura estão no mesmo dispositivo: só a câmera foi ligada.', true);
      await nativo.configSalvar({ webcamId: cfg.webcamId, capturaId: cfg.capturaId, telaId: cfg.telaId });
      aplicarLocais();
    }

    // ================================================================ tela de midia
    var anteriorAMidia = null;
    var midia = new raiz.HolivesMidia({
      aoMudar: function () { sincronizarMidia(); },
      aoErro: function (m) { api.toast(m, true); },
      aoTerminar: function () {
        if (S.midia.aoTerminar === 'voltar' && api.programa() === 'midia' && anteriorAMidia && anteriorAMidia !== 'midia') api.cortar(anteriorAMidia);
      }
    });
    api.mesa.definirFonteElemento('midia', midia.video);
    api.streams.midia = midia.stream;
    S.midia = { itens: [], selecionadoId: null, tocando: false, posicao: 0, loop: false, aoTerminar: 'voltar' };
    midia.definirLoop(false);

    var agendado = false;
    function sincronizarMidia() {
      if (agendado) return; agendado = true;
      setTimeout(function () {
        agendado = false;
        S.midia.itens = midia.itens.map(function (i) { return { id: i.id, nome: i.nome, tipo: i.tipo, duracao: i.duracao, thumb: i.thumb }; });
        S.midia.selecionadoId = midia.atual ? midia.atual.id : null;
        S.midia.tocando = midia.tocando();
        var f = api.fonte('midia');
        f.estado = midia.atual ? 'conectada' : 'sem-sinal'; f.sinal = midia.atual ? 100 : 0;
        f.temAudio = midia.ehVideo(); f.resolucao = midia.atual ? (midia.ehVideo() ? N.rotuloResolucao(midia.video.videoHeight) : 'imagem') : '—';
        f.nome = midia.atual ? 'Mídia: ' + midia.atual.nome : 'Tela de mídia';
        api.mixer.definirFonte('midia', midia.desenhavel());
        api.rerender(); miniaturas(); api.anexarCartoes(); api.atualizarMonitores();
      }, 0);
    }
    function miniaturas() {
      document.querySelectorAll('#lista-midia .midia-item').forEach(function (b) {
        var it = midia.item(b.dataset.fonteId), img = b.querySelector('img');
        if (it && img && it.thumb && img.getAttribute('src') !== it.thumb) img.src = it.thumb;
        b.title = 'Clique para escolher · botão direito remove da lista';
      });
    }
    function tempo(seg) { seg = Math.max(0, Math.round(seg || 0)); return String(Math.floor(seg / 60)).padStart(2, '0') + ':' + String(seg % 60).padStart(2, '0'); }

    async function adicionarArquivos(arquivos) {
      var caminhos = [].map.call(arquivos || [], function (a) { return nativo.caminhoArquivo(a); }).filter(Boolean);
      if (!caminhos.length) return;
      var r = await nativo.midiaAdicionar(caminhos);
      midia.definirItens(r.itens);
      if (r.recusados) api.toast(r.recusados + ' arquivo(s) não são imagem nem vídeo aceitos e ficaram de fora.', true);
      else api.toast(caminhos.length === 1 ? 'Arquivo adicionado à mídia.' : caminhos.length + ' arquivos adicionados à mídia.');
      if (!midia.atual && midia.itens.length) midia.selecionar(midia.itens[0].id);
    }

    function prepararMidia() {
      var seletor = document.createElement('input');
      seletor.type = 'file'; seletor.multiple = true; seletor.accept = 'image/*,video/*'; seletor.style.display = 'none';
      seletor.addEventListener('change', function () { adicionarArquivos(seletor.files); seletor.value = ''; });
      document.body.appendChild(seletor);

      var painel = $('painel-midia');
      var dica = painel && painel.querySelector('p.small');
      if (dica) dica.textContent = 'Arraste imagens e vídeos para cá. Clique num item para pôr na Tela de mídia; botão direito tira da lista.';
      var btnLoop = document.querySelector('[data-acao="midia-loop"]'); if (btnLoop) btnLoop.textContent = 'Loop: desligado';
      var nome = $('midia-nome'), pos = document.createElement('div');
      pos.id = 'midia-posicao'; pos.className = 'small muted numero'; if (nome) nome.after(pos);
      setInterval(function () {
        var p = midia.posicao();
        pos.textContent = midia.ehVideo() ? tempo(p.atual) + ' / ' + tempo(p.total) + (midia.tocando() ? ' · tocando' : ' · parado') : (midia.atual ? 'Imagem' : 'Nenhum arquivo escolhido');
        if (S.midia.tocando !== midia.tocando()) sincronizarMidia();
      }, 500);

      // arrastar e soltar em qualquer lugar da coluna lateral
      document.addEventListener('dragover', function (e) { e.preventDefault(); });
      document.addEventListener('drop', function (e) {
        e.preventDefault();
        if (e.target.closest && e.target.closest('.lateral') && e.dataTransfer && e.dataTransfer.files.length) adicionarArquivos(e.dataTransfer.files);
      });

      // botoes que a interface nao trata (ou trata de forma diferente do necessario)
      document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-acao]'); if (!b) return;
        if (b.dataset.acao === 'midia-adicionar') { seletor.click(); }
        else if (b.dataset.acao === 'midia-pause' && b.id !== 'midia-play') { e.stopPropagation(); midia.reiniciar(); } // botao "Reiniciar"
      }, true);
      document.addEventListener('contextmenu', function (e) {
        var b = e.target.closest && e.target.closest('#lista-midia .midia-item'); if (!b) return;
        e.preventDefault();
        var it = midia.item(b.dataset.fonteId); if (!it) return;
        nativo.midiaRemover(it.id).then(function (lista) { midia.definirItens(lista); api.toast('"' + it.nome + '" saiu da lista. O arquivo continua no computador.'); });
      });

      // o controle de volume da midia vai de 0 a 100; a mesa trabalha em dB
      var vol = $('midia-volume');
      if (vol) {
        var aplicar = function (e) {
          e.stopPropagation();
          var c = api.canal('midia'); c.volume = N.percentualParaDb(vol.value); c.mudo = false;
          api.aplicarAudio(); api.salvarAudio(); if (e.type === 'change') api.rerender();
        };
        vol.addEventListener('input', aplicar); vol.addEventListener('change', aplicar);
        vol.value = String(Math.round(Math.pow(10, api.canal('midia').volume / 30) * 100));
      }
      var fim = $('midia-fim'); if (fim) fim.addEventListener('change', function () { S.midia.aoTerminar = fim.value; });
      var lista = $('lista-midia'); if (lista) new MutationObserver(miniaturas).observe(lista, { childList: true });
    }

    function lidarMidia(d) {
      switch (d.tipo) {
        case 'midia-selecionar': midia.selecionar(d.midiaId); if (api.programa() === 'midia' && midia.ehVideo()) midia.tocar(); break;
        case 'midia-play': midia.tocar(); break;
        case 'midia-pause': midia.pausar(); break;
        case 'midia-loop': midia.definirLoop(!!d.loop); break;
        case 'config-salvar': salvarConfigLocais(); break;
        default: break;
      }
    }

    /** ponte.js avisa quando a fonte no ar muda: o video comeca ao entrar no ar e para ao sair. */
    function aoMudarPrograma(anterior, novo) {
      if (novo === 'midia' && anterior !== 'midia') { anteriorAMidia = anterior; if (midia.ehVideo()) midia.tocar(); }
      else if (anterior === 'midia' && novo !== 'midia') midia.pausar();
    }

    // ================================================================ layout vertical (Instagram)
    var vertical = new raiz.HolivesLayoutVertical(api.mixer.canvas, 30);
    var vcfg = { topoUrl: '', baseUrl: '', cor: '#15171C', texto: '' };
    var previaVertical = false;

    function prepararVertical() {
      var modal = $('modal-vertical'); if (!modal) return;
      var caixa = modal.querySelector('.modal-caixa > div:nth-of-type(2)') || modal.querySelector('.modal-caixa > div:last-child');
      var falso = caixa && caixa.firstElementChild;
      if (falso) {
        var v = document.createElement('video');
        v.muted = true; v.autoplay = true; v.playsInline = true; v.srcObject = vertical.stream;
        v.style.cssText = 'width:168px;flex:none;align-self:flex-start;aspect-ratio:9/16;background:#000;border:1px solid var(--borda);border-radius:12px;object-fit:contain';
        v.setAttribute('aria-label', 'Prévia do layout vertical');
        falso.replaceWith(v); v.play().catch(function () {});
      }
      var arquivos = modal.querySelectorAll('input[type=file]'), cor = modal.querySelector('input[type=color]'), texto = modal.querySelector('input:not([type=file]):not([type=color])');
      function salvar(extra) {
        return nativo.verticalSalvar(Object.assign({ cor: cor.value, texto: texto.value }, extra || {})).then(function (r) { if (r) { vcfg = r; vertical.configurar(vcfg); } });
      }
      [['topo', 0], ['base', 1]].forEach(function (par) {
        var inp = arquivos[par[1]]; if (!inp) return;
        inp.accept = 'image/*';
        inp.addEventListener('change', function () {
          var o = {}; o[par[0]] = inp.files[0] ? nativo.caminhoArquivo(inp.files[0]) : '';
          salvar(o);
        });
        var tirar = document.createElement('button'); tirar.type = 'button'; tirar.className = 'btn'; tirar.textContent = 'Remover arte';
        tirar.style.cssText = 'margin-top:6px;min-height:32px;padding:4px 10px;font-size:12px';
        tirar.addEventListener('click', function () { var o = {}; o[par[0]] = ''; inp.value = ''; salvar(o); });
        inp.after(tirar);
      });
      cor.value = vcfg.cor; texto.value = vcfg.texto; texto.maxLength = 80;
      cor.addEventListener('input', function () { vertical.configurar(Object.assign({}, vcfg, { cor: cor.value, texto: texto.value })); });
      texto.addEventListener('input', function () { vertical.configurar(Object.assign({}, vcfg, { cor: cor.value, texto: texto.value })); });
      cor.addEventListener('change', function () { salvar(); }); texto.addEventListener('change', function () { salvar(); });
      var aplicar = modal.querySelector('[data-acao="destino-salvar"]');
      if (aplicar) aplicar.addEventListener('click', function () { salvar(); });
      // desenha continuamente so enquanto a janela esta aberta (ou ha transmissao vertical)
      new MutationObserver(function () {
        var aberto = modal.classList.contains('aberto');
        if (aberto && !previaVertical) { previaVertical = true; vertical.usar(); }
        else if (!aberto && previaVertical) { previaVertical = false; vertical.soltar(); }
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    // ================================================================ partida
    prepararConfig();
    prepararMidia();
    document.addEventListener('holives:acao', function (e) { lidarMidia(e.detail || {}); });
    document.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-acao="abrir-config"]'); if (b) listarVideo(true);
    });
    if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', function () { listarVideo(false); });

    var pronto = (async function () {
      await listarVideo(false);
      midia.definirItens(await nativo.midiaListar());
      var v = await nativo.verticalObter(); if (v) { vcfg = v; vertical.configurar(vcfg); }
      prepararVertical();
      sincronizarMidia();
      await aplicarLocais();
    })();

    return { vertical: vertical, midia: midia, aoMudarPrograma: aoMudarPrograma, pronto: pronto };
  }

  raiz.HolivesFase2 = { iniciar: iniciar };
})(window);
