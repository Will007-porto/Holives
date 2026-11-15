/* camera.js — somente interação. Sem captura real. */
(function(){
  var S = window.HolivesState;
  function emitir(tipo, extra){ document.dispatchEvent(new CustomEvent("holives:acao",{detail:Object.assign({tipo:tipo},extra||{})})); }
  function mostrar(id){ document.querySelectorAll(".tela-camera").forEach(function(el){ el.style.display="none"; }); document.getElementById(id).style.display="flex"; }
  document.addEventListener("DOMContentLoaded", function(){
    var controles = document.getElementById("controles-camera");
    var timer;
    function esconder(){ if(controles) controles.classList.add("ocultos"); }
    function mostrarControles(){ if(!controles) return; controles.classList.remove("ocultos"); clearTimeout(timer); timer=setTimeout(esconder, 4000); }
    document.getElementById("tela-live-camera").addEventListener("click", mostrarControles);
    mostrarControles();
    document.addEventListener("click", function(e){
      var btn=e.target.closest("[data-acao]"); if(!btn) return;
      var a=btn.dataset.acao;
      if(a==="camera-conectar"){
        if(!window.HolivesReal) document.getElementById("estado-conexao").textContent="Conectando… aguardando o operador aceitar.";
        emitir("camera-adicionar",{nome:document.getElementById("nome-aparelho").value});
        if(!window.HolivesReal) setTimeout(function(){ mostrar("tela-live-camera"); document.getElementById("estado-conexao").textContent="Conectado"; }, 900);
      }
      if(a==="camera-virar" || a==="camera-microfone" || a==="camera-lanterna" || a==="camera-travar-foco" || a==="camera-travar-orientacao"){
        btn.classList.toggle("ativo"); emitir(a,{});
      }
      if(a==="camera-ver-retorno"){ var r=document.getElementById("retorno"); r.style.display = r.style.display==="block" ? "none" : "block"; emitir("camera-ver-retorno",{}); }
      if(a==="camera-sair"){ document.getElementById("modal-sair").classList.add("aberto"); }
      if(a==="fechar-modal"){ btn.closest(".modal").classList.remove("aberto"); }
      if(a==="confirmar-sair"){ btn.closest(".modal").classList.remove("aberto"); mostrar("tela-conexao"); emitir("camera-remover",{}); }
      if(a==="camera-reconectar"){ document.getElementById("faixa-reconectando").style.display="none"; emitir("camera-adicionar",{}); }
      if(a==="camera-tentar-de-novo"){ document.getElementById("estado-conexao").textContent="Tentando conectar novamente…"; emitir("camera-adicionar",{}); }
    });
    // tally inicial: prévia
    var tally=document.getElementById("tally");
    if(S.cameraAtual.tally==="previa"){ tally.className="tally previa"; document.getElementById("tally-label").textContent="PRÉVIA"; }
  });
})();
