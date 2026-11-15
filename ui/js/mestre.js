/* mestre.js — somente interação de interface. Lê window.HolivesState e redesenha via render...() */
(function(){
  var S = window.HolivesState;
  function emitir(tipo, extra){
    document.dispatchEvent(new CustomEvent("holives:acao", { detail: Object.assign({ tipo: tipo }, extra || {}) }));
  }
  window.HolivesEmitir = emitir;
  function el(id){ return document.getElementById(id); }
  function fmtTempo(seg){ seg = Math.max(0, Math.floor(seg||0)); var h = String(Math.floor(seg/3600)).padStart(2,"0"), m = String(Math.floor(seg%3600/60)).padStart(2,"0"), s = String(seg%60).padStart(2,"0"); return h+":"+m+":"+s; }
  var inicioLive = Date.now(), inicioGrav = Date.now();
  function renderTopo(){
    var st = el("status-transmissao"); if(!st) return;
    var vivo = S.transmissao.estado === "ao-vivo";
    st.textContent = vivo ? "AO VIVO" : "OFFLINE";
    st.className = "chip " + (vivo ? "ao-vivo pulsar" : "");
    el("cronometro-live").textContent = vivo ? fmtTempo((Date.now()-inicioLive)/1000) : "00:00:00";
    var grav = el("status-gravacao");
    grav.textContent = S.gravacao.ativa ? "● GRAVANDO " + fmtTempo((Date.now()-inicioGrav)/1000) : "";
    grav.style.display = S.gravacao.ativa ? "inline-flex" : "none";
    el("stat-kbps").textContent = Math.round(S.transmissao.kbps) + " kbps";
    el("stat-fps").textContent = S.transmissao.fps + " FPS";
    el("stat-perda").textContent = S.transmissao.quadrosPerdidos.toFixed(1) + "% perdidos";
    el("stat-cpu").textContent = Math.round(S.transmissao.cpu) + "% CPU";
    el("stat-perda").closest(".item").className = "item numero " + (S.transmissao.quadrosPerdidos > 2 ? "perigo" : S.transmissao.quadrosPerdidos > 1 ? "alerta" : "");
    el("stat-cpu").closest(".item").className = "item numero " + (S.transmissao.cpu > 70 ? "perigo" : S.transmissao.cpu > 50 ? "alerta" : "");
    var btnLive = el("btn-live");
    btnLive.textContent = vivo ? "Encerrar transmissão" : "Iniciar transmissão";
    btnLive.className = "btn " + (vivo ? "btn-perigo" : "btn-primario");
    btnLive.dataset.acao = vivo ? "encerrar-live" : "iniciar-live";
    el("btn-gravar").textContent = S.gravacao.ativa ? "Parar gravação" : "Gravar";
    // destinos chips
    var dest = el("chips-destinos"); dest.innerHTML = "";
    S.destinos.forEach(function(d){
      var b = document.createElement("button"); b.type="button"; b.className="chip " + (d.estado==="ao-vivo"?"ao-vivo":d.estado==="pronto"?"ok":d.estado==="erro"?"ao-vivo":""); b.dataset.acao="abrir-destinos";
      b.innerHTML = '<span class="ponto"></span>' + d.nome + " · " + d.estado;
      dest.appendChild(b);
    });
  }
  function renderMonitores(){
    var prev = S.fontes.find(function(f){return f.id===S.previaId}) || S.fontes[0];
    var ar = S.fontes.find(function(f){return f.id===S.noArId}) || S.fontes[0];
    el("nome-previa").textContent = prev.nome;
    el("nome-no-ar").textContent = ar.nome;
    el("monitor-previa").classList.toggle("com-sinal", prev.estado==="conectada");
    el("monitor-no-ar").classList.toggle("com-sinal", ar.estado==="conectada");
    var aviso = el("aviso-sinal");
    if(ar.estado!=="conectada" && S.transmissao.estado==="ao-vivo"){
      aviso.style.display="block"; aviso.textContent = "Atenção: " + ar.nome + " perdeu o sinal enquanto está no ar. Troque para outra fonte agora — clique em outra câmera ou aperte 1 a 8.";
    } else if(S.cenario==="problemas"){
      aviso.style.display="block"; aviso.textContent = "Internet instável — a taxa de envio está oscilando. A transmissão continua, mas pode travar para quem assiste.";
    } else aviso.style.display="none";
    var guia = el("guia-primeiro-uso");
    if(guia) guia.style.display = (S.cenario==="primeiro-uso") ? "flex" : "none";
  }
  function renderFontes(){
    var lista = el("lista-fontes"); if(!lista) return; lista.innerHTML="";
    S.fontes.forEach(function(f, idx){
      var b = document.createElement("button"); b.type="button"; b.className="fonte-card" + (f.id===S.previaId?" selecionada-previa":"") + (f.id===S.noArId?" no-ar":"");
      b.dataset.acao="selecionar-previa"; b.dataset.fonteId=f.id;
      b.innerHTML = '<div class="video-wrap '+(f.estado==="conectada"?"com-sinal":"")+'"><video muted playsinline aria-label="Prévia de '+f.nome+'"></video><div class="sem-sinal"><strong>'+(f.estado==="sem-sinal"?"Sem sinal":f.estado==="conectando"?"Conectando…":"Sem sinal")+'</strong><span>'+f.nome+'</span></div></div>'
        + '<div class="linha"><strong>'+f.nome+'</strong><span class="atalho">'+(idx+1)+'</span></div>'
        + '<div class="linha small muted"><span>'+(f.estado==="conectada"?"● Conectada":f.estado==="conectando"?"◐ Conectando":"○ Sem sinal")+' · '+f.resolucao+'</span><span>'+(f.bateria!==null? "🔋 "+f.bateria+"%":"")+'</span></div>'
        + '<div class="linha small"><span class="etiqueta '+(f.id===S.previaId?"previa":f.id===S.noArId?"no-ar":"")+'">'+(f.id===S.previaId?"PRÉVIA":f.id===S.noArId?"NO AR":"")+'</span><span>'+(f.temAudio?"🎤":"🎤✕")+' · Wi-Fi '+(f.sinal||0)+'%</span></div>';
      b.addEventListener("dblclick", function(){ emitir("cortar",{fonteId:f.id}); S.noArId=f.id; renderAll(); });
      b.addEventListener("click", function(){ S.previaId=f.id; renderAll(); });
      lista.appendChild(b);
    });
    var vazio = document.createElement("button"); vazio.type="button"; vazio.className="fonte-card vazio"; vazio.dataset.acao="camera-adicionar";
    vazio.innerHTML="<span style='font-size:28px'>+</span><strong>Adicionar câmera</strong><span class='small'>Escanear QR code</span>";
    vazio.addEventListener("click", function(){ abrirModal("modal-camera"); });
    lista.appendChild(vazio);
  }
  function renderAudio(){
    var wrap = el("canais"); if(!wrap) return; wrap.innerHTML="";
    S.audio.canais.forEach(function(c){
      var d = document.createElement("div"); d.className="canal"+(c.id==="saida"?" largo":"");
      d.innerHTML='<div class="nome">'+c.nome+'</div><div class="vu" style="--nivel:'+c.nivel+'"><div class="vu-preenchimento"></div><div class="vu-marca"></div></div><span class="numero small">'+c.volume+' dB</span>'
        + '<input type="range" class="fader" min="-60" max="0" value="'+c.volume+'" aria-label="Volume de '+c.nome+'" data-acao="audio-volume" data-fonte-id="'+c.id+'">'
        + '<button type="button" class="btn mini-btn '+(c.mudo?"mudo-ativo":"")+'" data-acao="audio-mudo" data-fonte-id="'+c.id+'">'+(c.mudo?"Mudo":"Som")+'</button>'
        + '<button type="button" class="btn mini-btn '+(c.ouvir?"ativo":"")+'" data-acao="audio-ouvir" data-fonte-id="'+c.id+'">Ouvir</button>'
        + (c.id!=="mesa" && c.id!=="saida" && c.id!=="midia" ? '<button type="button" class="btn mini-btn '+(c.seguirVideo?"ativo":"")+'" data-acao="audio-seguir-video" data-fonte-id="'+c.id+'">Seguir vídeo</button>' : "")
        + (c.id==="mesa" ? '<div class="small muted">Atraso<br><span class="numero">'+c.atraso+' ms</span></div><div class="linha"><button type="button" class="btn mini-btn" data-acao="audio-atraso" data-fonte-id="mesa" data-valor="-10">−</button><button type="button" class="btn mini-btn" data-acao="audio-atraso" data-fonte-id="mesa" data-valor="10">+</button></div>' : "");
      wrap.appendChild(d);
    });
  }
  function renderMidia(){
    var lista = el("lista-midia"); if(!lista) return; lista.innerHTML="";
    S.midia.itens.forEach(function(m){
      var b=document.createElement("button"); b.type="button"; b.className="midia-item"+(m.id===S.midia.selecionadoId?" selecionado":""); b.dataset.acao="midia-selecionar"; b.dataset.fonteId=m.id;
      b.innerHTML='<img alt=""><span style="flex:1;text-align:left"><strong style="display:block">'+m.nome+'</strong><span class="small muted">'+m.tipo+' · '+m.duracao+'</span></span><span>'+(S.midia.tocando && m.id===S.midia.selecionadoId?"⏸":"▶")+'</span>';
      b.addEventListener("click", function(){ S.midia.selecionadoId=m.id; emitir("midia-selecionar",{midiaId:m.id}); renderAll(); });
      lista.appendChild(b);
    });
    el("midia-nome").textContent = (S.midia.itens.find(function(x){return x.id===S.midia.selecionadoId})||{}).nome || "Nenhuma mídia";
    el("midia-play").textContent = S.midia.tocando ? "Pausar" : "Tocar";
  }
  function renderSobreposicoes(){
    var s=S.sobreposicoes;
    el("sw-logo").setAttribute("aria-checked", s.logo.ativa);
    el("sw-tarja").setAttribute("aria-checked", s.tarja.ativa);
    el("sw-texto").setAttribute("aria-checked", s.texto.ativa);
    el("sw-holyrics").setAttribute("aria-checked", s.holyrics.mostrar);
    el("tarja-linha1").value = s.tarja.linha1; el("tarja-linha2").value = s.tarja.linha2;
    el("texto-livre").value = s.texto.conteudo;
    el("holyrics-status").textContent = s.holyrics.conexao;
  }
  function abrirModal(id){ document.getElementById(id).classList.add("aberto"); }
  function fecharModal(m){ m.classList.remove("aberto"); }
  function toast(msg, erro){
    var a=el("toasts"); var t=document.createElement("div"); t.className="toast"+(erro?" erro":""); t.innerHTML="<strong>"+(erro?"Erro":"Pronto")+"</strong><span>"+msg+"</span>"; a.appendChild(t); setTimeout(function(){ t.remove(); }, 3600);
  }
  function renderAll(){ renderTopo(); renderMonitores(); renderFontes(); renderAudio(); renderMidia(); renderSobreposicoes(); }
  window.HolivesRenderMestre = renderAll;
  document.addEventListener("DOMContentLoaded", function(){
    renderAll();
    document.addEventListener("holives:tick", renderAll);
    // cliques globais por data-acao
    document.addEventListener("click", function(e){
      var btn = e.target.closest("[data-acao]"); if(!btn) return;
      var acao = btn.dataset.acao, fid = btn.dataset.fonteId;
      if(acao==="cortar"){ S.noArId = S.previaId; emitir("cortar",{fonteId:S.noArId}); toast("Corte para "+ (S.fontes.find(function(f){return f.id===S.noArId})||{}).nome); }
      if(acao==="transicao"){ emitir("transicao",{estilo:S.transicao.tipo,duracao:S.transicao.duracao}); var bar=el("barra-transicao-fill"); bar.style.width="100%"; setTimeout(function(){ S.noArId=S.previaId; bar.style.width="0"; renderAll(); }, S.transicao.duracao); toast("Transição "+S.transicao.tipo+" executada"); }
      if(acao==="iniciar-live"){ S.transmissao.estado="ao-vivo"; S.transmissao.kbps=5400; inicioLive=Date.now(); emitir("iniciar-live",{}); toast("Transmissão iniciada — você está ao vivo"); }
      if(acao==="encerrar-live"){ abrirModal("modal-encerrar"); }
      if(acao==="confirmar-encerrar"){ S.transmissao.estado="offline"; S.transmissao.kbps=0; emitir("encerrar-live",{}); fecharModal(document.getElementById("modal-encerrar")); toast("Transmissão encerrada"); }
      if(acao==="iniciar-gravacao" || acao==="parar-gravacao" || btn.id==="btn-gravar"){ S.gravacao.ativa=!S.gravacao.ativa; inicioGrav=Date.now(); emitir(S.gravacao.ativa?"iniciar-gravacao":"parar-gravacao",{}); toast(S.gravacao.ativa?"Gravação iniciada":"Gravação parada"); }
      if(acao==="audio-mudo"){ var c=S.audio.canais.find(function(x){return x.id===fid}); if(c){ c.mudo=!c.mudo; emitir("audio-mudo",{canalId:fid,mudo:c.mudo}); } }
      if(acao==="audio-seguir-video"){ var c2=S.audio.canais.find(function(x){return x.id===fid}); if(c2){ c2.seguirVideo=!c2.seguirVideo; emitir("audio-seguir-video",{canalId:fid,ativo:c2.seguirVideo}); } }
      if(acao==="audio-atraso"){ var mesa=S.audio.canais.find(function(x){return x.id==="mesa"}); mesa.atraso=Math.max(0,Math.min(1000, mesa.atraso + parseInt(btn.dataset.valor||"0",10))); emitir("audio-atraso",{atraso:mesa.atraso}); }
      if(acao==="midia-play" || acao==="midia-pause"){ S.midia.tocando=!S.midia.tocando; emitir(S.midia.tocando?"midia-play":"midia-pause",{midiaId:S.midia.selecionadoId}); }
      if(acao==="midia-loop"){ S.midia.loop=!S.midia.loop; emitir("midia-loop",{loop:S.midia.loop}); btn.textContent = S.midia.loop ? "Loop: ligado" : "Loop: desligado"; }
      if(acao==="sobreposicao-alternar"){ emitir("sobreposicao-alternar",{id:btn.dataset.id}); }
      if(acao==="abrir-destinos"){ abrirModal("modal-destinos"); }
      if(acao==="abrir-config"){ abrirModal("modal-config"); }
      if(acao==="abrir-layout-vertical"){ abrirModal("modal-vertical"); }
      if(acao==="fechar-modal"){ fecharModal(btn.closest(".modal")); }
      if(acao==="destino-salvar" || acao==="config-salvar" || acao==="destino-alternar"){ emitir(acao,{}); toast("Salvo"); if(btn.closest(".modal")) fecharModal(btn.closest(".modal")); }
      if(acao==="camera-adicionar"){ abrirModal("modal-camera"); }
      if(acao==="aceitar-camera"){ emitir("camera-adicionar",{nome:btn.dataset.nome}); toast("Câmera aceita — aguardando sinal"); btn.closest("div").remove(); }
      if(acao==="recusar-camera"){ emitir("camera-remover",{nome:btn.dataset.nome}); btn.closest("div").remove(); }
      if(acao==="preset-audio"){ S.audio.preset=btn.dataset.preset; emitir("audio-volume",{preset:btn.dataset.preset}); toast("Predefinição: "+btn.textContent.trim()); }
      renderAll();
    });
    document.addEventListener("change", function(e){
      var t=e.target;
      if(t.dataset.acao==="audio-volume"){ var c=S.audio.canais.find(function(x){return x.id===t.dataset.fonteId}); if(c){ c.volume=parseInt(t.value,10); emitir("audio-volume",{canalId:c.id,volume:c.volume}); } }
      if(t.id==="sel-transicao"){ S.transicao.tipo=t.value; emitir("definir-transicao",{estilo:t.value,duracao:S.transicao.duracao}); }
      if(t.id==="sel-duracao"){ S.transicao.duracao=parseInt(t.value,10); emitir("definir-transicao",{estilo:S.transicao.tipo,duracao:S.transicao.duracao}); }
      if(t.id==="sel-aba-midia"){ document.getElementById("painel-midia").style.display = t.value==="midia" ? "block" : "none"; document.getElementById("painel-sobreposicoes").style.display = t.value==="sobreposicoes" ? "block" : "none"; }
      renderAll();
    });
    // switches sobreposições
    ["sw-logo","sw-tarja","sw-texto","sw-holyrics"].forEach(function(id){
      var sEl=document.getElementById(id); if(!sEl) return;
      sEl.addEventListener("click", function(){ var v=sEl.getAttribute("aria-checked")==="true"; sEl.setAttribute("aria-checked", String(!v)); emitir("sobreposicao-alternar",{id:id,ativo:!v}); });
    });
    // teclado
    document.addEventListener("keydown", function(e){
      if(e.key==="F2"){ e.preventDefault(); var sel=document.getElementById("seletor-cenario"); sel.style.display = sel.style.display==="block" ? "none" : "block"; }
      if(e.target.matches("input,textarea,select")) return;
      if(e.key>="1" && e.key<="8"){ var f=S.fontes[parseInt(e.key,10)-1]; if(f){ S.previaId=f.id; emitir("selecionar-previa",{fonteId:f.id}); renderAll(); } }
      if(e.key===" "){ e.preventDefault(); S.noArId=S.previaId; emitir("cortar",{fonteId:S.noArId}); renderAll(); }
      if(e.key==="Enter"){ e.preventDefault(); S.noArId=S.previaId; emitir("transicao",{estilo:S.transicao.tipo}); renderAll(); }
      if(e.key.toLowerCase()==="m"){ var saida=S.audio.canais.find(function(x){return x.id==="saida"}); saida.mudo=!saida.mudo; emitir("audio-mudo",{canalId:"saida",mudo:saida.mudo}); renderAll(); }
    });
    document.getElementById("seletor-cenario").addEventListener("change", function(e){
      S.cenario=e.target.value;
      if(S.cenario==="primeiro-uso"){ S.transmissao.estado="offline"; S.gravacao.ativa=false; }
      if(S.cenario==="pronto"){ S.transmissao.estado="offline"; }
      if(S.cenario==="ao-vivo"){ S.transmissao.estado="ao-vivo"; S.transmissao.kbps=5400; }
      if(S.cenario==="problemas"){ S.transmissao.estado="ao-vivo"; S.transmissao.quadrosPerdidos=2.8; S.transmissao.cpu=78; }
      toast("Cenário: "+e.target.options[e.target.selectedIndex].text);
      renderAll();
    });
    setInterval(renderTopo, 1000);
  });
})();
