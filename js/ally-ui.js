/* =========================================================
   ALLY — chat widget  (js/ally-ui.js)
   ---------------------------------------------------------
   Floating "Ally" button, bottom-right, on every page for every logged-in role. All text is placed with
   textContent (never innerHTML), so nothing typed or stored in Align360 can inject markup.
   The conversation lives in memory only: it is wiped on logout / when a different person signs in, and is
   never written to localStorage or Firestore (a shared PC must not keep someone else's answers).
   ========================================================= */
const AllyUI = (function(){
  "use strict";
  let root, fab, panel, log, chipsBox, input, sendBtn, headRole, headScope;
  let st = {open:false, key:null, msgs:[], mem:null, busy:false, history:[], hIdx:-1};

  function h(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text!=null) e.textContent = text; return e; }
  function rich(parent, text){
    String(text==null?"":text).split(/(\*\*[^*]+\*\*)/).forEach(part=>{
      if(/^\*\*[^*]+\*\*$/.test(part)) parent.appendChild(h("strong", null, part.slice(2,-2)));
      else if(part) parent.appendChild(document.createTextNode(part));
    });
    return parent;
  }

  /* ---------- block renderers ---------- */
  function cell(td, v){
    if(v && typeof v==="object"){
      if(v.badge){ td.appendChild(h("span","ally-b ally-b-"+v.badge, v.text)); return; }
      const s = h("span", (v.mono?"ally-mono ":"")+(v.status?"ally-s-"+v.status:""), v.text);
      td.appendChild(s); return;
    }
    td.textContent = v==null ? "" : String(v);
  }
  function renderBlock(b, onAction){
    if(b.t==="p"){ return rich(h("p","ally-p"), b.text); }
    if(b.t==="note"){ return h("p","ally-note", b.text); }
    if(b.t==="list"){ const ul = h("ul","ally-list"); b.items.forEach(i=>ul.appendChild(h("li",null,i))); return ul; }
    if(b.t==="stat"){
      const d = h("div","ally-stat"+(b.status?" ally-stat-"+b.status:""));
      d.appendChild(h("div","ally-stat-label", b.label));
      const v = h("div","ally-stat-value"); v.appendChild(h("span",null,b.value)); if(b.unit) v.appendChild(h("small",null,b.unit)); d.appendChild(v);
      if(b.sub) d.appendChild(h("div","ally-stat-sub", b.sub));
      return d;
    }
    if(b.t==="table"){
      const wrap = h("div","ally-table-wrap"), t = h("table","ally-table");
      const hasHead = b.head.some(x=>x!=="");
      if(hasHead){ const tr = h("tr"); b.head.forEach(x=>tr.appendChild(h("th",null,x))); const th = h("thead"); th.appendChild(tr); t.appendChild(th); }
      const tb = h("tbody");
      b.rows.forEach(r=>{ const tr = h("tr"); r.forEach((v,i)=>{ const td = h("td", !hasHead && i===0 ? "ally-k" : null); cell(td, v); tr.appendChild(td); }); tb.appendChild(tr); });
      t.appendChild(tb); wrap.appendChild(t); return wrap;
    }
    if(b.t==="cards"){
      const box = h("div","ally-cards");
      b.items.forEach(it=>{
        const c = h("div","ally-card");
        c.appendChild(h("div","ally-card-title", it.title));
        if(it.meta) c.appendChild(h("div","ally-card-meta", it.meta));
        if(it.text) c.appendChild(h("div","ally-card-text", it.text));
        if(it.warn) c.appendChild(h("div","ally-card-warn", "⚠ "+it.warn));
        if(it.actions && it.actions.length){ const a = h("div","ally-card-actions"); it.actions.forEach(x=>{ const bt = h("button","ally-link", x.label+" →"); bt.type="button"; bt.addEventListener("click",()=>onAction(x)); a.appendChild(bt); }); c.appendChild(a); }
        box.appendChild(c);
      });
      return box;
    }
    return h("span");
  }

  /* ---------- conversation ---------- */
  function scrollDown(){ log.scrollTop = log.scrollHeight; }
  function renderChips(chips){
    chipsBox.textContent = "";
    (chips||[]).forEach(c=>{
      const b = h("button","ally-chip", c.label); b.type = "button";
      b.addEventListener("click", ()=>{ if(c.nav) doNav(c.nav); else send(c.q); });
      chipsBox.appendChild(b);
    });
  }
  function doAction(a){
    const S = AllyScope.build(); if(!S) return;
    if(a.kb) S.actions.openArticle(a.kb); else if(a.nav) S.actions.nav(a.nav);
    if(window.matchMedia && window.matchMedia("(max-width:760px)").matches) setOpen(false);
  }
  function doNav(tab){ doAction({nav:tab}); }

  function addMsg(m){
    st.msgs.push(m);
    const row = h("div","ally-row ally-"+m.who);
    const bubble = h("div","ally-bubble");
    if(m.who==="me") bubble.textContent = m.text;
    else {
      (m.blocks||[]).forEach(b=>bubble.appendChild(renderBlock(b, doAction)));
      if(m.source){ bubble.appendChild(h("div","ally-source","Source: "+m.source)); }
    }
    row.appendChild(bubble); log.appendChild(row);
    scrollDown();
  }
  function typing(on){
    const old = log.querySelector(".ally-typing"); if(old) old.remove();
    if(on){ const r = h("div","ally-row ally-bot ally-typing"); const b = h("div","ally-bubble"); b.setAttribute("aria-label","Ally is typing"); for(let i=0;i<3;i++) b.appendChild(h("i")); r.appendChild(b); log.appendChild(r); scrollDown(); }
  }

  async function send(text){
    text = String(text||"").trim().slice(0,300);
    if(!text || st.busy) return;
    st.busy = true; sendBtn.disabled = true;
    st.history.push(text); st.hIdx = -1;
    chipsBox.textContent = "";
    addMsg({who:"me", text});
    input.value = "";
    typing(true);
    let out;
    try{ out = await AllyEngine.ask(text, st.mem); }
    catch(e){ out = {blocks:[{t:"p",text:"Something went wrong — please try again."}], chips:[], source:""}; }
    // someone else signed in while we were thinking: drop the answer
    if(out.identityKey && st.key && out.identityKey!==st.key){ typing(false); st.busy=false; sendBtn.disabled=false; return; }
    await new Promise(r=>setTimeout(r, 140));
    typing(false);
    st.mem = out.mem || st.mem;
    addMsg({who:"bot", blocks:out.blocks, source:out.source});
    renderChips(out.chips);
    st.busy = false; sendBtn.disabled = false;
    if(st.open) input.focus();
  }

  function greet(S){
    const first = (S.userName||"").split(" ")[0] || "there";
    addMsg({who:"bot", blocks:[
      {t:"p", text:"Hi "+first+"! I'm **Ally**, your Align360 assistant."},
      {t:"note", text:"I only use Align360's own data — nothing from the internet — and only what your "+S.roleLabel+" login is allowed to see."}
    ]});
    renderChips(AllyEngine.starterChips(S));
  }
  function reset(S){
    st.msgs = []; st.mem = null; st.history = []; st.hIdx = -1; st.busy = false;
    if(sendBtn) sendBtn.disabled = false;
    if(log){ log.textContent = ""; chipsBox.textContent = ""; }
    if(S) greet(S);
  }
  function setHeader(S){
    headRole.textContent = S.roleLabel;
    headScope.textContent = S.scopeLabel;
  }

  /* ---------- open / close ---------- */
  function setOpen(on){
    st.open = !!on;
    root.setAttribute("data-open", on ? "true" : "false");
    fab.setAttribute("aria-expanded", on ? "true" : "false");
    try{ sessionStorage.setItem("a360_ally_open", on ? "1" : "0"); }catch(e){}
    if(on){ setTimeout(()=>{ input.focus(); scrollDown(); }, 30); }
  }

  /* ---------- mount ---------- */
  const SPARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-4 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M12 8.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor" stroke="none"/></svg>';
  function mount(){
    if(root) return;
    root = h("div","ally-root"); root.id = "allyRoot"; root.setAttribute("data-open","false");
    fab = h("button","ally-fab"); fab.type="button"; fab.setAttribute("aria-label","Ask Ally"); fab.setAttribute("aria-expanded","false"); fab.setAttribute("aria-controls","allyPanel");
    fab.innerHTML = SPARK;                         // static, constant markup (no data)
    fab.appendChild(h("span","ally-fab-label","Ally"));
    panel = h("section","ally-panel"); panel.id = "allyPanel"; panel.setAttribute("role","dialog"); panel.setAttribute("aria-label","Ally assistant");

    const head = h("header","ally-head");
    const av = h("div","ally-avatar","A");
    const ti = h("div","ally-titles"); ti.appendChild(h("div","ally-name","Ally"));
    const sub = h("div","ally-sub"); headRole = h("span","ally-role"); headScope = h("span","ally-scope"); sub.appendChild(headRole); sub.appendChild(headScope); ti.appendChild(sub);
    const bNew = h("button","ally-icon","↺"); bNew.type="button"; bNew.title="New chat"; bNew.setAttribute("aria-label","Start a new chat");
    const bX = h("button","ally-icon","✕"); bX.type="button"; bX.title="Close"; bX.setAttribute("aria-label","Close Ally");
    head.appendChild(av); head.appendChild(ti); head.appendChild(bNew); head.appendChild(bX);

    log = h("div","ally-log"); log.setAttribute("role","log"); log.setAttribute("aria-live","polite");
    chipsBox = h("div","ally-chips");
    const form = h("form","ally-form");
    input = h("input","ally-input"); input.type="text"; input.maxLength=300; input.placeholder="Ask about your Align360 data…"; input.setAttribute("aria-label","Message Ally"); input.autocomplete="off";
    sendBtn = h("button","ally-send","↑"); sendBtn.type="submit"; sendBtn.setAttribute("aria-label","Send");
    form.appendChild(input); form.appendChild(sendBtn);
    const foot = h("div","ally-foot","Answers come only from Align360 data you're allowed to see.");

    panel.appendChild(head); panel.appendChild(log); panel.appendChild(chipsBox); panel.appendChild(form); panel.appendChild(foot);
    root.appendChild(panel); root.appendChild(fab);
    document.body.appendChild(root);

    fab.addEventListener("click", ()=>setOpen(!st.open));
    bX.addEventListener("click", ()=>{ setOpen(false); fab.focus(); });
    bNew.addEventListener("click", ()=>{ const S = AllyScope.build(); reset(S); input.focus(); });
    form.addEventListener("submit", e=>{ e.preventDefault(); send(input.value); });
    input.addEventListener("keydown", e=>{
      if(e.key==="ArrowUp" && !input.value && st.history.length){ e.preventDefault(); st.hIdx = Math.min(st.history.length-1, st.hIdx+1); input.value = st.history[st.history.length-1-st.hIdx]; }
      else if(e.key==="ArrowDown" && st.hIdx>=0){ e.preventDefault(); st.hIdx--; input.value = st.hIdx<0 ? "" : st.history[st.history.length-1-st.hIdx]; }
    });
    panel.addEventListener("keydown", e=>{ if(e.key==="Escape"){ e.stopPropagation(); setOpen(false); fab.focus(); } });
    let wasOpen = false; try{ wasOpen = sessionStorage.getItem("a360_ally_open")==="1"; }catch(e){}
    if(wasOpen) setOpen(true);
  }

  /* called from render() in app.js — cheap: only builds a scope when the identity changes */
  function onRender(){
    const key = AllyScope.identity();
    if(!key){
      if(root){ root.hidden = true; }
      if(st.key){ st.key = null; reset(null); setOpen(false); }
      return;
    }
    mount(); root.hidden = false;
    if(st.key!==key){
      const S = AllyScope.build(); if(!S) return;
      st.key = key; reset(S); setHeader(S);
    }
  }

  return {onRender};
})();
