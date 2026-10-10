/* =========================================================
   PKT taker (agent) — Kahoot-style screen: one question at a time, big coloured answer tiles with
   shapes, a progress bar, and ONE countdown for the whole PKT (set by Quality in minutes). No
   per-question timer. The agent can move back and forth and change answers until they submit or
   the clock hits zero (then it auto-submits with whatever is answered).

   Every click is written to the attempt doc, so Quality sees progress live, and a refresh / lost
   connection resumes where the agent left off — the clock runs from the stored start time, it never
   restarts. Quality's "Preview" runs this same screen in memory (nothing saved or synced).
   ========================================================= */

let pktRun = null;            // {pktId, empId, preview, pkt, att, idx}
let pktPreviewResult = null;  // {p, att} for the result screen after a preview
let pktTicker = null;

function pktReset(){          // called on logout so the next login never inherits a quiz
  pktRun = null; pktPreviewResult = null; pktResultAttId = null; pktView = "home";
  pktStopTicker();
}
function pktStopTicker(){ if(pktTicker){ clearInterval(pktTicker); pktTicker = null; } }
function pktEnsureTicker(){ if(!pktTicker) pktTicker = setInterval(pktTick, 1000); }

/* ---- Ordering (stable across refreshes: the shuffle is stored on the attempt) ---- */
function pktOrderedQuestions(p, att){
  const qs = p.questions || [];
  const byId = new Map(qs.map(q=>[q.id,q]));
  const out = ((att && att.qOrder) || []).map(id=>byId.get(id)).filter(Boolean);
  qs.forEach(q=>{ if(!out.includes(q)) out.push(q); });
  return out;
}
function pktOrderedOptions(q, att){
  const ord = att && att.oOrder && att.oOrder[q.id];
  if(!ord) return q.options;
  const byId = new Map(q.options.map(o=>[o.id,o]));
  const out = ord.map(id=>byId.get(id)).filter(Boolean);
  q.options.forEach(o=>{ if(!out.includes(o)) out.push(o); });
  return out;
}
function pktBuildOrders(p){
  const qIds = (p.questions||[]).map(q=>q.id);
  const oOrder = {};
  (p.questions||[]).forEach(q=>{ const ids = q.options.map(o=>o.id); oOrder[q.id] = p.shuffleOptions ? pktShuffle(ids) : ids; });
  return {qOrder: p.shuffleQuestions ? pktShuffle(qIds) : qIds, oOrder};
}

/* ---- Starting ---- */
function pktRunContext(){
  if(!pktRun) return null;
  if(pktRun.preview) return {p:pktRun.pkt, att:pktRun.att};
  const p = pktById(pktRun.pktId), att = pktAttempt(pktRun.pktId, pktRun.empId);
  return (p && att) ? {p, att} : null;
}
function pktStartFlow(pktId){
  const me = pktMyAgent(), p = pktById(pktId);
  if(!me || !p) return;
  const att = pktAttempt(pktId, me.empId);
  if(att && att.status==="submitted"){ showToast("You've already submitted this PKT."); return; }
  if(att && att.status==="in_progress"){
    if(pktRemainingMs(att, p) <= 0){ pktSubmitAttempt(att, true); pktResultAttId = att.id; pktView = "result"; render(); return; }
    pktBeginRun(att); return;
  }
  if(!pktIsOpen(p)){ showToast("This PKT is no longer open."); return; }
  const n = (p.questions||[]).length;
  const ov = showModal(`
    <div class="modal-title">${esc(p.title||"PKT")}</div>
    <div style="font-size:12.5px;line-height:1.7;">
      • <b>${n}</b> question${n===1?"":"s"}, one correct answer each<br>
      • You have <b>${p.durationMins} minutes</b> for the whole PKT — there's no timer on individual questions<br>
      • The clock starts now and <b>can't be paused</b>; if you close the page it keeps running<br>
      • You can go back and change answers until you submit<br>
      • You get <b>one attempt</b>${p.passMark ? ` · pass mark ${pktPct(p.passMark)}` : ""}
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="pktSNo">Not yet</button><button class="btn btn-accent" id="pktSYes">▶ Start now</button></div>`);
  ov.querySelector("#pktSNo").addEventListener("click", closeModal);
  ov.querySelector("#pktSYes").addEventListener("click", ()=>{
    closeModal();
    if(pktAttempt(pktId, me.empId)){ pktStartFlow(pktId); return; } // started meanwhile (another tab/device)
    const orders = pktBuildOrders(p), now = new Date().toISOString();
    const a = {
      id: pktAttId(pktId, me.empId), pktId, empId: me.empId, agentName: me.name, tlName: me.tlName||"", lob: me.lob||"",
      status:"in_progress", startedAt: now, answers:{}, qOrder: orders.qOrder, oOrder: orders.oOrder, updatedAt: now
    };
    if(!state.pktAttempts) state.pktAttempts = [];
    state.pktAttempts.push(a);
    saveState();
    pktBeginRun(a);
  });
}
function pktBeginRun(att){
  const p = pktById(att.pktId);
  const qs = pktOrderedQuestions(p, att);
  let idx = qs.findIndex(q=>!(att.answers||{})[q.id]); if(idx<0) idx = 0;
  pktRun = {pktId: att.pktId, empId: att.empId, preview:false, idx};
  pktView = "quiz"; pktEnsureTicker(); render();
}
// Author's "Preview" button in the editor — runs the real screen on a cleaned copy of the draft.
function pktCleanedPreview(){
  const d = JSON.parse(JSON.stringify(pktDraft));
  d.questions.forEach(q=>{ q.options = q.options.filter(o=>o.text.trim()); });
  d.questions = d.questions.filter(q=> q.text.trim() && q.options.length>=2);
  if(!d.questions.length){ showToast("Add at least one complete question (text + 2 answers) to preview."); return; }
  if(pktDirty) pktCommitDraft();
  const orders = pktBuildOrders(d), now = new Date().toISOString();
  const att = {id:"__preview", pktId:d.id, empId:"__preview", agentName:"Preview", status:"in_progress", startedAt:now, answers:{}, qOrder:orders.qOrder, oOrder:orders.oOrder, updatedAt:now};
  pktRun = {pktId:d.id, empId:"__preview", preview:true, pkt:d, att, idx:0};
  pktView = "quiz"; pktEnsureTicker(); render();
}

/* ---- Clock ---- */
function pktTick(){
  if(!pktRun || !currentUser){ pktStopTicker(); pktRun = null; return; }
  const cx = pktRunContext(); if(!cx){ pktStopTicker(); return; }
  if(cx.att.status!=="in_progress") return;
  const rem = pktRemainingMs(cx.att, cx.p);
  const el = document.getElementById("pktTimer");
  if(el){ el.textContent = pktFmtSec(rem/1000); el.className = "pkt-timer" + (rem<=60000 ? " danger" : rem<=120000 ? " warn" : ""); }
  if(rem <= 0){ showToast("⏱ Time's up — submitting your PKT"); pktFinishRun(true); }
}
function pktFinishRun(auto){
  const cx = pktRunContext(); if(!cx) return;
  const preview = pktRun.preview;
  pktSubmitAttempt(cx.att, auto);
  if(preview){ pktPreviewResult = {p:cx.p, att:cx.att}; pktResultAttId = "__preview"; }
  else pktResultAttId = cx.att.id;
  closeModal();
  pktRun = null; pktView = "result"; pktStopTicker(); render();
}

/* ---- Quiz screen ---- */
function pktRenderQuiz(content, topActions){
  topActions.innerHTML = "";
  const cx = pktRunContext();
  if(!cx){ pktRun = null; pktView = "home"; renderPkt(content, topActions); return; }
  const {p, att} = cx;
  if(att.status==="submitted"){ pktResultAttId = att.id; pktRun = null; pktView = "result"; renderPkt(content, topActions); return; }
  const qs = pktOrderedQuestions(p, att);
  pktRun.idx = Math.max(0, Math.min(pktRun.idx, qs.length-1));
  const q = qs[pktRun.idx], opts = pktOrderedOptions(q, att);
  const sel = (att.answers||{})[q.id] || "";
  const answered = qs.filter(x=>(att.answers||{})[x.id]).length;
  const sig = [att.id, pktRun.idx, sel, answered, att.status].join("|");
  // Nothing changed (e.g. another agent's snapshot arrived) → leave the DOM alone so images don't flicker.
  if(content.querySelector('#pktRoot[data-sig="'+sig+'"]')) return;
  const rem = pktRemainingMs(att, p);
  const img = pktSafeImg(q.image);
  const isLast = pktRun.idx === qs.length-1;
  content.innerHTML = `
  <div class="pkt-play" id="pktRoot" data-sig="${esc(sig)}">
    ${pktRun.preview ? `<div class="pkt-banner" style="margin:0 0 10px;">👁 <b>Preview</b> — this is exactly what agents see. Nothing is saved or counted. <button class="btn btn-ghost btn-sm" id="pktExitPrev" style="margin-left:8px;">← Back to editor</button></div>` : ""}
    <div class="pkt-play-top">
      <div class="pkt-play-title">${esc(p.title||"PKT")}</div>
      <div class="pkt-play-count">Question <b>${pktRun.idx+1}</b> of ${qs.length} · ${answered} answered</div>
      <div class="pkt-timer ${rem<=60000?"danger":rem<=120000?"warn":""}" id="pktTimer" title="Time left for the whole PKT">${pktFmtSec(rem/1000)}</div>
    </div>
    <div class="pkt-bar"><div style="width:${Math.round(answered/qs.length*100)}%;"></div></div>
    <div class="pkt-play-q">
      <div class="pkt-play-qtext">${esc(q.text)}</div>
      ${img ? `<img class="pkt-play-img" id="pktPlayImg" src="${img}" alt="Question image" title="Click to enlarge">` : ""}
    </div>
    <div class="pkt-play-opts n${Math.min(opts.length,6)} ${sel?"has-sel":""}">
      ${opts.map((o,i)=>{ const col = PKT_COLORS[i%PKT_COLORS.length]; return `<button type="button" class="pkt-play-opt ${sel===o.id?"sel":""}" style="--tc:${col.c};" data-oid="${esc(o.id)}"><span class="pkt-play-shape">${col.s}</span><span class="pkt-play-otext">${esc(o.text)}</span>${sel===o.id?`<span class="pkt-play-check">✓</span>`:""}</button>`; }).join("")}
    </div>
    <div class="pkt-play-foot">
      <button class="btn" id="pktPrev" ${pktRun.idx===0?"disabled":""}>← Previous</button>
      <div class="pkt-dots">${qs.map((x,i)=>`<button type="button" class="pkt-dot ${i===pktRun.idx?"cur":""} ${(att.answers||{})[x.id]?"done":""}" data-goto="${i}" title="Question ${i+1}">${i+1}</button>`).join("")}</div>
      ${isLast ? `<button class="btn btn-accent" id="pktSubmit">Submit PKT ✓</button>` : `<button class="btn btn-accent" id="pktNext">Next →</button>`}
    </div>
    ${isLast ? "" : `<div style="text-align:center;margin-top:10px;"><button class="btn btn-ghost btn-sm" id="pktSubmit2">Submit now</button></div>`}
    <div class="help-note" style="text-align:center;margin-top:8px;">Tip: press <b>1–${Math.min(opts.length,6)}</b> to pick an answer, <b>←</b> / <b>→</b> to move.</div>
  </div>`;
  const $ = id => document.getElementById(id);
  content.querySelectorAll(".pkt-play-opt").forEach(b=> b.addEventListener("click", ()=> pktPick(q, b.dataset.oid)));
  content.querySelectorAll("[data-goto]").forEach(b=> b.addEventListener("click", ()=>{ pktRun.idx = Number(b.dataset.goto); render(); }));
  if($("pktPrev")) $("pktPrev").addEventListener("click", ()=>{ pktRun.idx--; render(); });
  if($("pktNext")) $("pktNext").addEventListener("click", ()=>{ pktRun.idx++; render(); });
  if($("pktSubmit")) $("pktSubmit").addEventListener("click", pktConfirmSubmit);
  if($("pktSubmit2")) $("pktSubmit2").addEventListener("click", pktConfirmSubmit);
  if($("pktPlayImg")) $("pktPlayImg").addEventListener("click", ()=> openImageLightbox(img, ""));
  if($("pktExitPrev")) $("pktExitPrev").addEventListener("click", ()=>{ pktRun = null; pktStopTicker(); pktView = pktDraft ? "editor" : "home"; render(); });
}
function pktPick(q, oid){
  const cx = pktRunContext(); if(!cx || cx.att.status!=="in_progress") return;
  if(pktRemainingMs(cx.att, cx.p) <= 0) return;
  if(!cx.att.answers) cx.att.answers = {};
  cx.att.answers[q.id] = oid;
  cx.att.updatedAt = new Date().toISOString();
  if(!pktRun.preview) saveState();   // live progress for Quality
  render();
}
function pktConfirmSubmit(){
  const cx = pktRunContext(); if(!cx) return;
  const qs = pktOrderedQuestions(cx.p, cx.att);
  const left = qs.filter(q=>!(cx.att.answers||{})[q.id]).length;
  const ov = showModal(`
    <div class="modal-title">Submit your PKT?</div>
    <p style="font-size:12.5px;color:var(--text-muted);line-height:1.6;margin:0;">${left ? `<b style="color:var(--yellow);">${left} question${left===1?" is":"s are"} still unanswered</b> and will count as wrong. ` : "You've answered every question. "}Once you submit, you can't change your answers.</p>
    <div class="modal-actions"><button class="btn btn-ghost" id="pktCsNo">Keep going</button><button class="btn btn-accent" id="pktCsYes">Submit</button></div>`);
  ov.querySelector("#pktCsNo").addEventListener("click", closeModal);
  ov.querySelector("#pktCsYes").addEventListener("click", ()=> pktFinishRun(false));
}
// Keyboard shortcuts (1–6 pick, arrows move) — only while a quiz is on screen and no dialog is open.
document.addEventListener("keydown", e=>{
  if(pktView!=="quiz" || !pktRun || currentTab!=="pkt") return;
  if(document.querySelector(".modal-overlay") || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target||{}).tagName||"")) return;
  const cx = pktRunContext(); if(!cx) return;
  const qs = pktOrderedQuestions(cx.p, cx.att), q = qs[pktRun.idx], opts = pktOrderedOptions(q, cx.att);
  if(/^[1-6]$/.test(e.key) && opts[Number(e.key)-1]){ pktPick(q, opts[Number(e.key)-1].id); }
  else if(e.key==="ArrowRight" && pktRun.idx < qs.length-1){ pktRun.idx++; render(); }
  else if(e.key==="ArrowLeft" && pktRun.idx > 0){ pktRun.idx--; render(); }
});

/* ---- Result screen ---- */
function pktRenderResult(content, topActions){
  topActions.innerHTML = "";
  const preview = pktResultAttId==="__preview";
  const att = preview ? (pktPreviewResult && pktPreviewResult.att) : (state.pktAttempts||[]).find(a=>a.id===pktResultAttId);
  const p = preview ? (pktPreviewResult && pktPreviewResult.p) : (att && pktById(att.pktId));
  if(!att || !p || att.status!=="submitted"){ pktResultAttId = null; pktView = "home"; renderPkt(content, topActions); return; }
  const passed = att.passed, deg = Math.round(Math.max(0,Math.min(100,att.score))*3.6);
  const col = passed ? "var(--green)" : "var(--red)";
  const showReview = preview || p.showAnswers;
  let note = "";
  if(!preview){
    if(att.syncStatus==="synced") note = `✅ Your score has been added to your Daily Data (PKT Score) for ${esc(fmtDate(att.syncedIso))}.`;
    else if(att.syncStatus==="week_has_score") note = `ℹ️ A PKT score was already recorded for you this week, so this result wasn't written to Daily Data. Quality has been notified through the results screen.`;
    else if(att.syncStatus==="failed") note = `⚠ Your result is saved, but couldn't be added to Daily Data yet — Quality can sync it.`;
    else note = `Saving your score to Daily Data…`;
  }
  const qs = pktOrderedQuestions(p, att);
  const review = showReview ? `<div class="section" style="margin-top:16px;"><div class="section-head"><div class="section-title">Answer review</div></div><div class="section-body">${qs.map((q,i)=>{
    const ans = (att.answers||{})[q.id], ao = q.options.find(o=>o.id===ans), co = q.options.find(o=>o.id===q.correctId), ok = ans && ans===q.correctId;
    return `<div style="padding:9px 0;border-bottom:1px solid var(--border);"><div style="font-size:12.5px;font-weight:600;">${i+1}. ${esc(q.text)}</div>
      <div style="font-size:12px;margin-top:4px;">Your answer: <b style="color:${ok?"var(--green)":"var(--red)"};">${ao?esc(ao.text):"— not answered"}</b> ${ok?"✓":"✗"}</div>
      ${ok?"":`<div style="font-size:12px;color:var(--text-muted);">Correct answer: <b>${co?esc(co.text):"—"}</b></div>`}</div>`;
  }).join("")}</div></div>` : "";
  content.innerHTML = `
  <div class="pkt-result">
    ${preview ? `<div class="pkt-banner" style="margin:0 0 12px;">👁 Preview result — nothing was saved.</div>` : ""}
    <div class="pkt-ring" style="background:conic-gradient(${col} ${deg}deg, var(--surface-3) 0);"><div class="pkt-ring-in"><div class="pkt-ring-score">${pktPct(att.score)}</div><div class="pkt-ring-sub">${att.correct} / ${att.total} correct</div></div></div>
    <div class="pkt-result-msg" style="color:${col};">${passed ? "🎉 Well done — you passed!" : "Below the pass mark this time"}</div>
    <div class="help-note" style="text-align:center;">${esc(p.title||"")} · pass mark ${pktPct(p.passMark||0)} · time taken ${pktFmtSec(att.timeTakenSec||0)}${att.autoSubmitted ? " · auto-submitted when time ran out" : ""}</div>
    ${note ? `<div class="pkt-banner" style="max-width:560px;margin:14px auto 0;text-align:center;">${note}</div>` : ""}
    <div style="text-align:center;margin-top:16px;"><button class="btn btn-accent" id="pktResBack">${preview ? "← Back to editor" : "Done"}</button></div>
    ${review}
  </div>`;
  document.getElementById("pktResBack").addEventListener("click", ()=>{
    pktResultAttId = null; pktPreviewResult = null;
    pktView = (preview && pktDraft) ? "editor" : "home"; render();
  });
}
