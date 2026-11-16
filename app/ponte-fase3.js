/* ponte-fase3.js - sobreposicoes (logo, tarja, aviso), letras do Holyrics e controle pelo tablet.
 * Carregado antes de ponte.js, que chama HolivesFase3.iniciar(api). */
(function (raiz) {
  'use strict';

  function iniciar(api) {
    var S = api.S, nativo = api.nativo;
    function $(id) { return document.getElementById(id); }
    function el(tag, classe, texto) { var e = document.createElement(tag); if (classe) e.className = classe; if (texto) e.textContent = texto; return e; }

    // ================================================================ sobreposicoes
    var sobre = new raiz.HolivesSobreposicoes();
    api.mixer.aoDesenhar = function (ctx, W, H) { sobre.desenhar(ctx, W, H); };
    var NOMES_POS = { 'superior-direita': 'Canto superior direito', 'superior-esquerda': 'Canto superior esquerdo', 'inferior-direita': 'Canto inferior direito', 'inferior-esquerda': 'Canto inferior esquerdo' };
    var temLogo = false, resumoLogo = null;

    S.sobreposicoes = {
      logo: { ativa: false, posicao: 'superior-direita', tamanho: 96, opacidade: 90 },
      tarja: { ativa: false, linha1: '', linha2: '', salvas: [] },
      texto: { ativa: false, conteudo: '' },
      holyrics: { ativa: false, conexao: 'não configurado', posicao: 'inferior', mostrar: false }
    };

    /** Passa o estado da interface para o desenho. */
    function aplicar() {
      var s = S.sobreposicoes;
      sobre.logo.ativa = !!s.logo.ativa; sobre.logo.posicao = s.logo.posicao; sobre.logo.tamanho = s.logo.tamanho; sobre.logo.opacidade = s.logo.opacidade;
      sobre.tarja.ativa = !!s.tarja.ativa; sobre.tarja.linha1 = s.tarja.linha1; sobre.tarja.linha2 = s.tarja.linha2;
      sobre.texto.ativa = !!s.texto.ativa; sobre.texto.conteudo = s.texto.conteudo;
      sobre.letra.ativa = !!s.holyrics.mostrar;
      if (resumoLogo) resumoLogo.textContent = temLogo ? NOMES_POS[s.logo.posicao] + ' · ' + s.logo.tamanho + ' px · ' + s.logo.opacidade + '%' : 'Nenhuma imagem escolhida ainda.';
    }
    var salvarDepois = null;
    function salvar(extra) {
      clearTimeout(salvarDepois);
      var envio = function () {
        var s = S.sobreposicoes;
        return nativo.sobreSalvar(Object.assign({
          logo: { ativa: s.logo.ativa, posicao: s.logo.posicao, tamanho: s.logo.tamanho, opacidade: s.logo.opacidade },
          tarja: { linha1: s.tarja.linha1, linha2: s.tarja.linha2 }, texto: { conteudo: s.texto.conteudo }, holyrics: { mostrar: s.holyrics.mostrar }
        }, extra || {}));
      };
      if (extra) return envio();
      salvarDepois = setTimeout(envio, 600);
    }
    function definirAtiva(id, ativo) {
      var s = S.sobreposicoes;
      if (id === 'logo') { if (ativo && !temLogo) { api.toast('Escolha a imagem do logo primeiro (aba Sobreposições).', true); ativo = false; } s.logo.ativa = ativo; }
      else if (id === 'tarja') s.tarja.ativa = ativo;
      else if (id === 'texto') s.texto.ativa = ativo;
      else if (id === 'holyrics') { s.holyrics.mostrar = ativo; s.holyrics.ativa = ativo; }
      else return;
      aplicar(); salvar(); api.rerender();
    }

    function prepararPainel() {
      // abas "Midia | Sobreposicoes": a interface so trata o seletor; os botoes passam a aciona-lo
      var seletor = $('sel-aba-midia');
      document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-acao="trocar-aba"]'); if (!b || !seletor) return;
        seletor.value = b.dataset.aba; seletor.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelectorAll('[data-acao="trocar-aba"]').forEach(function (x) { x.classList.toggle('ativa', x === b); });
      });
      if (seletor) seletor.style.display = 'none';

      // interruptores: a interface emite {id:'sw-logo', ativo} em cada clique
      document.addEventListener('holives:acao', function (e) {
        var d = e.detail || {};
        if (d.tipo === 'sobreposicao-alternar' && typeof d.ativo === 'boolean') definirAtiva(String(d.id).replace(/^sw-/, ''), d.ativo);
        if (d.tipo === 'config-salvar') salvarHolyrics();
      });
      [['tarja-linha1', 'tarja', 'linha1'], ['tarja-linha2', 'tarja', 'linha2'], ['texto-livre', 'texto', 'conteudo']].forEach(function (c) {
        var campo = $(c[0]); if (!campo) return;
        campo.maxLength = c[1] === 'tarja' ? 60 : 140;
        campo.addEventListener('input', function () { S.sobreposicoes[c[1]][c[2]] = campo.value; aplicar(); salvar(); });
      });
      if ($('tarja-linha1')) $('tarja-linha1').placeholder = 'Nome (ex.: Pr. João Silva)';
      if ($('tarja-linha2')) $('tarja-linha2').placeholder = 'Função ou título';
      if ($('texto-livre')) $('texto-livre').placeholder = 'Aviso que aparece no alto da tela';

      // controles do logo
      var sw = $('sw-logo'), bloco = sw && sw.parentElement.firstElementChild;
      if (bloco) {
        bloco.style.flex = '1';
        resumoLogo = bloco.querySelector('p') || bloco.appendChild(el('p', 'small muted'));
        var arquivo = el('input'); arquivo.type = 'file'; arquivo.accept = 'image/*'; arquivo.style.display = 'none'; arquivo.id = 'logo-arquivo';
        arquivo.addEventListener('change', function () {
          if (!arquivo.files[0]) return;
          salvar({ logoCaminho: nativo.caminhoArquivo(arquivo.files[0]) }).then(function (r) {
            arquivo.value = '';
            if (!r || !r.logoUrl) return api.toast('Essa imagem não pôde ser usada como logo.', true);
            temLogo = true; sobre.definirLogo(r.logoUrl); S.sobreposicoes.logo.ativa = true; aplicar(); salvar(); api.rerender();
          });
        });
        var escolher = el('button', 'btn', 'Escolher imagem'); escolher.type = 'button'; escolher.style.cssText = 'min-height:34px;padding:4px 10px;font-size:12px;margin-top:6px';
        escolher.addEventListener('click', function () { arquivo.click(); });
        var pos = el('select'); pos.id = 'logo-posicao'; pos.setAttribute('aria-label', 'Posição do logo'); pos.style.marginTop = '6px';
        Object.keys(NOMES_POS).forEach(function (k) { var o = el('option', '', NOMES_POS[k]); o.value = k; pos.appendChild(o); });
        pos.addEventListener('change', function () { S.sobreposicoes.logo.posicao = pos.value; aplicar(); salvar(); });
        function deslizante(id, rotulo, min, max, chave) {
          var l = el('label', 'small muted', rotulo); l.htmlFor = id;
          var r = el('input'); r.type = 'range'; r.id = id; r.min = min; r.max = max; r.value = S.sobreposicoes.logo[chave];
          r.addEventListener('input', function (e) { e.stopPropagation(); S.sobreposicoes.logo[chave] = parseInt(r.value, 10); aplicar(); salvar(); });
          r.addEventListener('change', function (e) { e.stopPropagation(); });
          bloco.appendChild(l); bloco.appendChild(r);
        }
        bloco.appendChild(arquivo); bloco.appendChild(escolher); bloco.appendChild(pos);
        deslizante('logo-tamanho', 'Tamanho', 40, 320, 'tamanho');
        deslizante('logo-opacidade', 'Opacidade', 20, 100, 'opacidade');
      }
    }

    // ================================================================ Holyrics
    function prepararHolyrics(inicial) {
      var campo = api.campoPor('Holyrics'); if (!campo) return;
      campo.querySelector('label').textContent = 'Holyrics — endereço do computador (IP ou IP:porta)';
      var end = campo.querySelector('input'); end.id = 'cfg-holyrics-endereco'; end.disabled = false; end.title = '';
      end.value = inicial.endereco || ''; end.placeholder = 'ex.: 192.168.0.20:8091';
      var c2 = el('div', 'campo'), l2 = el('label', '', 'Holyrics — token do API Server'); l2.htmlFor = 'cfg-holyrics-token';
      var tok = el('input'); tok.type = 'password'; tok.id = 'cfg-holyrics-token'; tok.autocomplete = 'off'; tok.value = inicial.token || '';
      var dica = el('p', 'small muted', 'No Holyrics: Arquivo > Configurações > API Server > gerenciar permissões. Crie um token com permissão para "GetCurrentPresentation".');
      c2.appendChild(l2); c2.appendChild(tok); c2.appendChild(dica); campo.after(c2);
    }
    function salvarHolyrics() {
      var end = $('cfg-holyrics-endereco'), tok = $('cfg-holyrics-token'); if (!end || !tok) return;
      nativo.holyricsSalvar({ endereco: end.value.trim(), token: tok.value.trim() }).then(function (r) {
        if (r && r.erro) api.toast(r.erro, true);
      });
    }
    nativo.aoHolyrics(function (e) {
      S.sobreposicoes.holyrics.conexao = e.conexao;
      sobre.letra.visivel = !!e.visivel; if (e.visivel) sobre.letra.conteudo = e.texto;
      var st = $('holyrics-status'); if (st) st.textContent = e.conexao + (e.conexao === 'conectado' && e.titulo ? ' · ' + e.titulo : '');
    });
    // a interface reescreve o texto do status a cada redesenho; mantem o titulo do item junto
    function textoStatus() { return S.sobreposicoes.holyrics.conexao; }
    void textoStatus;

    // ================================================================ controle pelo tablet
    var qtdControles = 0, ultimoEstado = '';
    function estadoParaControle() {
      var s = S.sobreposicoes;
      return {
        fontes: S.fontes.map(function (f) { return { id: f.id, nome: f.nome, estado: f.estado }; }),
        previaId: S.previaId, noArId: api.programa(),
        aoVivo: S.transmissao.estado === 'ao-vivo', gravando: !!S.gravacao.ativa,
        transicao: S.transicao.tipo,
        canais: S.audio.canais.map(function (c) { return { id: c.id, nome: c.nome, volume: c.volume, mudo: !!c.mudo }; }),
        sobre: { logo: !!s.logo.ativa, tarja: !!s.tarja.ativa, holyrics: !!s.holyrics.mostrar }
      };
    }
    var inicioLive = 0;
    setInterval(function () {
      var e = estadoParaControle();
      if (e.aoVivo && !inicioLive) inicioLive = Date.now(); if (!e.aoVivo) inicioLive = 0;
      var txt = JSON.stringify(e);
      if (txt !== ultimoEstado) { ultimoEstado = txt; e.segLive = inicioLive ? Math.round((Date.now() - inicioLive) / 1000) : 0; api.enviarSinal({ t: 'controle-estado', estado: e }); }
    }, 250);

    var mini = document.createElement('canvas'); mini.width = 192; mini.height = 108;
    var mctx = mini.getContext('2d', { alpha: false });
    setInterval(function () {
      if (!qtdControles) return;
      var m = {};
      S.fontes.forEach(function (f) {
        if (f.estado !== 'conectada') return;
        var v = api.elementoFonte(f.id); if (!v) return;
        var w = v.videoWidth || v.naturalWidth, h = v.videoHeight || v.naturalHeight; if (!w || !h) return;
        var r = Math.min(192 / w, 108 / h);
        mctx.fillStyle = '#000'; mctx.fillRect(0, 0, 192, 108);
        try { mctx.drawImage(v, (192 - w * r) / 2, (108 - h * r) / 2, w * r, h * r); m[f.id] = mini.toDataURL('image/jpeg', 0.5); } catch (e) { /* */ }
      });
      api.enviarSinal({ t: 'controle-miniaturas', m: m });
    }, 1500);

    /** Acao pedida por um tablet. So o que esta nesta lista e aceito. */
    function acaoDoControle(a) {
      if (!a || typeof a.tipo !== 'string') return;
      var temFonte = function (id) { return typeof id === 'string' && !!api.fonte(id); };
      switch (a.tipo) {
        case 'selecionar-previa': if (temFonte(a.fonteId)) { S.previaId = a.fonteId; api.rerender(); } break;
        case 'cortar': if (temFonte(a.fonteId || S.previaId)) { api.lidar({ tipo: 'cortar', fonteId: a.fonteId || S.previaId }); api.rerender(); } break;
        case 'transicao': api.lidar({ tipo: 'transicao', estilo: S.transicao.tipo }); api.rerender(); break;
        case 'audio-mudo': { var c = api.canal(a.canalId); if (c) { c.mudo = !c.mudo; api.lidar({ tipo: 'audio-mudo' }); api.rerender(); } break; }
        case 'audio-volume': {
          if (['so-mesa', 'mesa-video', 'so-video', 'so-camera'].indexOf(a.preset) >= 0) { S.audio.preset = a.preset; api.lidar({ tipo: 'audio-volume', preset: a.preset }); break; }
          var cv = api.canal(a.canalId), v = Number(a.volume);
          if (cv && isFinite(v)) { cv.volume = Math.max(-60, Math.min(0, Math.round(v))); api.lidar({ tipo: 'audio-volume' }); }
          break;
        }
        case 'sobreposicao': if (['logo', 'tarja', 'holyrics'].indexOf(a.id) >= 0) definirAtiva(a.id, !!a.ativo); break;
        default: break;
      }
    }
    function aoSinal(m) {
      if (m.t === 'controle-acao') acaoDoControle(m.acao);
      else if (m.t === 'controle-qtd') { qtdControles = m.n | 0; ultimoEstado = ''; atualizarQtd(); }
    }

    var blocoControle = null;
    function atualizarQtd() {
      var q = blocoControle && blocoControle.querySelector('.qtd-controles');
      if (q) q.textContent = qtdControles ? qtdControles + ' tablet(s) conectado(s) agora.' : 'Nenhum tablet conectado.';
    }
    async function mostrarQr(novo) {
      if (!blocoControle) return;
      var r = await nativo.controleQr(api.ipAtual(), !!novo);
      var img = blocoControle.querySelector('img'), end = blocoControle.querySelector('.endereco');
      if (!r) { end.textContent = 'Sem rede: conecte o computador ao Wi-Fi.'; img.removeAttribute('src'); return; }
      img.src = r.imagem; img.alt = 'QR code do controle remoto'; end.textContent = r.url;
      if (novo) api.toast('Código novo gerado. Os tablets conectados com o código antigo foram desligados.');
    }
    function prepararControle() {
      var salvarBtn = document.querySelector('#modal-config [data-acao="config-salvar"]'); if (!salvarBtn) return;
      blocoControle = el('div', 'destino-card'); blocoControle.style.marginTop = '12px';
      blocoControle.appendChild(el('strong', '', 'Controle pelo tablet ou celular'));
      blocoControle.appendChild(el('p', 'small muted', 'Leia o código com o tablet no mesmo Wi-Fi. Quem tiver este código consegue trocar a câmera e mexer no som, então mostre só para a equipe.'));
      var linha = el('div'); linha.style.cssText = 'display:flex;gap:14px;align-items:center;margin-top:8px';
      var img = el('img'); img.style.cssText = 'width:132px;height:132px;background:#fff;border-radius:10px;padding:4px;image-rendering:pixelated;flex:none';
      var lado = el('div'); lado.style.minWidth = '0';
      var end = el('p', 'small endereco'); end.style.wordBreak = 'break-all';
      var qtd = el('p', 'small muted qtd-controles');
      var novo = el('button', 'btn', 'Gerar novo código'); novo.type = 'button'; novo.style.cssText = 'min-height:34px;padding:4px 10px;font-size:12px;margin-top:8px';
      novo.addEventListener('click', function () { mostrarQr(true); });
      lado.appendChild(end); lado.appendChild(qtd); lado.appendChild(novo); linha.appendChild(img); linha.appendChild(lado); blocoControle.appendChild(linha);
      salvarBtn.parentElement.before(blocoControle);
      document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-acao="abrir-config"]')) mostrarQr(false); });
      atualizarQtd();
    }

    // ================================================================ partida
    prepararPainel();
    prepararControle();
    var pronto = (async function () {
      var h = await nativo.holyricsObter(); prepararHolyrics(h || {});
      var c = await nativo.sobreObter(); if (!c) return;
      var s = S.sobreposicoes;
      if (c.logo) { s.logo.posicao = NOMES_POS[c.logo.posicao] ? c.logo.posicao : s.logo.posicao; s.logo.tamanho = c.logo.tamanho || s.logo.tamanho; s.logo.opacidade = c.logo.opacidade || s.logo.opacidade; }
      temLogo = !!c.logoUrl; if (temLogo) sobre.definirLogo(c.logoUrl);
      s.logo.ativa = temLogo && !!(c.logo && c.logo.ativa);
      if (c.tarja) { s.tarja.linha1 = c.tarja.linha1 || ''; s.tarja.linha2 = c.tarja.linha2 || ''; }
      if (c.texto) s.texto.conteudo = c.texto.conteudo || '';
      s.holyrics.mostrar = s.holyrics.ativa = !!(c.holyrics && c.holyrics.mostrar);
      if ($('logo-posicao')) $('logo-posicao').value = s.logo.posicao;
      if ($('logo-tamanho')) $('logo-tamanho').value = s.logo.tamanho;
      if ($('logo-opacidade')) $('logo-opacidade').value = s.logo.opacidade;
      aplicar(); api.rerender();
    })();

    return { aoSinal: aoSinal, sobre: sobre, pronto: pronto };
  }

  raiz.HolivesFase3 = { iniciar: iniciar };
})(window);
