/* controle.js — somente interação, lê window.HolivesState */
(function(){
  var S = window.HolivesState;
  function emitir(tipo, extra){ document.dispatchEvent(new CustomEvent("holives:acao",{detail:Object.assign({tipo:tipo},extra||{})})); }
  function render(){
    var grade=document.getElementById("grade-fontes"); if(!grade) return; grade.innerHTML="";
    S.fontes.forEach(function(f){
      var b=document.createElement("button"); b.type="button"; b.className="fonte-grande"+(f.id===S.previaId?" previa":"")+(f.id===S.noArId?" no-ar":""); b.dataset.acao="selecionar-previa"; b.dataset.fonteId=f.id;
      b.innerHTML='<div class="video-wrap '+(f.estado==="conectada"?"com-sinal":"")+'"><video muted playsinline aria-label="'+f.nome+'"></video><div class="sem-sinal"><span>'+f.nome+'</span><small>'+f.estado+'</small></div></div><div style="display:flex;justify-content:space-between;margin-top:8px"><strong>'+f.nome+'</strong><span class="etiqueta '+(f.id===S.previaId?"previa":f.id===S.noArId?"no-ar":"")+'">'+(f.id===S.previaId?"PRÉVIA":f.id===S.noArId?"NO AR":"")+'</span></div>';
      b.addEventListener("click", function(){ S.previaId=f.id; emitir("selecionar-previa",{fonteId:f.id}); render(); });
      b.addEventListener("dblclick", function(){ S.noArId=f.id; emitir("cortar",{fonteId:f.id}); render(); });
      grade.appendChild(b);
    });
    document.getElementById("status-controle").textContent = S.transmissao.estado==="ao-vivo" ? "AO VIVO" : "OFFLINE";
    document.getElementById("status-controle").className = "chip " + (S.transmissao.estado==="ao-vivo" ? "ao-vivo pulsar" : "");
    var audio=document.getElementById("audio-controle"); audio.innerHTML="";
    S.audio.canais.slice(0,4).forEach(function(c){
      var d=document.createElement("div"); d.className="canal-mini";
      d.innerHTML='<span style="min-width:110px;font-size:13px">'+c.nome+'</span><input type="range" min="-60" max="0" value="'+c.volume+'" aria-label="Volume '+c.nome+'" data-acao="audio-volume" data-fonte-id="'+c.id+'"><button type="button" class="btn" style="min-height:36px" data-acao="audio-mudo" data-fonte-id="'+c.id+'">'+(c.mudo?"Mudo":"Som")+'</button>';
      audio.appendChild(d);
    });
  }
  document.addEventListener("DOMContentLoaded", function(){
    render();
    document.addEventListener("holives:tick", render);
    document.addEventListener("click", function(e){
      var btn=e.target.closest("[data-acao]"); if(!btn) return;
      var a=btn.dataset.acao;
      if(a==="cortar"){ S.noArId=S.previaId; emitir("cortar",{fonteId:S.noArId}); render(); }
      if(a==="transicao"){ emitir("transicao",{estilo:S.transicao.tipo}); S.noArId=S.previaId; render(); }
      if(a==="audio-mudo"){ var c=S.audio.canais.find(function(x){return x.id===btn.dataset.fonteId}); if(c) c.mudo=!c.mudo; emitir("audio-mudo",{canalId:btn.dataset.fonteId}); render(); }
      if(a==="preset-audio"){ emitir("audio-volume",{preset:btn.dataset.preset}); }
      if(a==="sobreposicao-alternar"){ btn.setAttribute("aria-checked", btn.getAttribute("aria-checked")==="true" ? "false" : "true"); emitir("sobreposicao-alternar",{id:btn.dataset.id}); }
    });
  });
})();
