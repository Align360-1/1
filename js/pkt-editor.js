/* =========================================================
   PKT creator (Quality / Admin / Manager) — modelled on Kahoot's quiz builder:
     left   = question list (add / reorder / duplicate / delete)
     centre = the question: text, optional image, coloured answer tiles (tick = correct)
     right  = PKT settings — duration in MINUTES for the whole PKT (there is deliberately no
              per-question time limit), pass mark, audience, due date, shuffle, show answers.
   Edits happen on an in-memory draft and autosave into state.pkts a moment after you stop typing,
   so nothing is lost and no snapshot from another browser can clobber what's on screen.
   ========================================================= */

let pktDraft = null;          // the PKT being edited (deep copy)
let pktSelQ = 0;              // selected question index
let pktDirty = false;
let pktSaveTimer = null;
let pktPublishOnOpen = false;

function pktNewQuestion(){
  return {id: pktNewId("q"), text:"", image:"", options: [0,1,2,3].map(()=>({id:pktNewId("o"), text:""})), correctId:""};
}
function pktDefaultPassMark(){ const m = pktMetric(); return Number(m.threshold) > 0 ? Number(m.threshold) : 80; }
function pktNewDraft(){
  const now = new Date().toISOString();
  return {
    id: pktNewId("pkt"), title:"", lob:"", status:"draft", durationMins:15, passMark:pktDefaultPassMark(), dueDate:"",
    shuffleQuestions:false, shuffleOptions:false, showAnswers:false, questions:[pktNewQuestion()],
    createdBy: currentUser.name, createdByUsername: currentUser.username||"", createdAt: now, updatedAt: now
  };
}
function pktOpenEditor(id, publishNow){
  if(!canAuthorPKT()) return;
  if(id){
    const p = pktById(id); if(!p) return;
    pktDraft = JSON.parse(JSON.stringify(p));
  } else {
    pktDraft = pktNewDraft(); pktDraft.__isNew = true;
  }
  pktSelQ = 0; pktDirty = false; pktView = "editor"; pktPublishOnOpen = !!publishNow;
  render();
}
function pktEdLocked(){ return !!pktDraft && pktAttemptsOf(pktDraft.id).length > 0; }
function pktDraftSize(){ try{ return JSON.stringify(pktDraft).length; }catch(e){ return 0; } }

/* ---- Saving ---- */
function pktTouch(){
  pktDirty = true;
  pktSetChip("Saving…");
  clearTimeout(pktSaveTimer);
  pktSaveTimer = setTimeout(()=>{ pktCommitDraft(); }, 1200);
}
function pktSetChip(txt){ const c = document.getElementById("pktSaveChip"); if(c) c.textContent = txt; }
function pktDraftHasContent(){
  return !!(pktDraft.title.trim() || pktDraft.questions.some(q=> q.text.trim() || q.image || q.options.some(o=>o.text.trim())));
}
// Writes the draft into state.pkts (and so to Firestore). Returns false if there's nothing worth saving
// yet, or the PKT is too big for one Firestore document.
function pktCommitDraft(){
  clearTimeout(pktSaveTimer);
  if(!pktDraft) return false;
  if(!pktDraftHasContent()){ pktSetChip("Draft"); return false; }
  if(pktDraftSize() > PKT_DOC_LIMIT){
    pktSetChip("⚠ Too large to save");
    showToast("⚠ This PKT is too large to save — remove or shrink some images.");
    return false;
  }
  const copy = JSON.parse(JSON.stringify(pktDraft));
  delete copy.__isNew;
  copy.updatedAt = new Date().toISOString();
  if(!state.pkts) state.pkts = [];
  const i = state.pkts.findIndex(p=>p.id===copy.id);
  if(i>=0) state.pkts[i] = copy; else state.pkts.push(copy);
  pktDraft.updatedAt = copy.updatedAt;
  if(pktDraft.__isNew){ pktDraft.__isNew = false; }
  pktDirty = false;
  saveState();
  pktSetChip("Saved ✓");
  return true;
}
function pktCloseEditor(){
  if(pktDirty) pktCommitDraft();
  pktDraft = null; pktView = "home"; render();
}

/* ---- Validation ---- */
function pktQuestionProblem(q){
  if(!q.text.trim()) return "Add the question text";
  const filled = q.options.filter(o=>o.text.trim());
  if(filled.length < PKT_MIN_OPTIONS) return "Needs at least 2 answers";
  if(q.options.some(o=>!o.text.trim() && o.id===q.correctId)) return "The correct answer is empty";
  if(!q.correctId || !filled.some(o=>o.id===q.correctId)) return "Tick the correct answer";
  return "";
}
function pktValidate(){
  const probs = [];
  if(!pktDraft.title.trim()) probs.push("Give the PKT a title.");
  if(!pktDraft.questions.length) probs.push("Add at least one question.");
  pktDraft.questions.forEach((q,i)=>{ const pr = pktQuestionProblem(q); if(pr) probs.push(`Question ${i+1}: ${pr}.`); });
  if(!(Number(pktDraft.durationMins) >= 1)) probs.push("Set how many minutes agents get (at least 1).");
  const pm = Number(pktDraft.passMark); if(!(pm>=0 && pm<=100)) probs.push("Pass mark must be between 0 and 100.");
  return probs;
}
// Blank answer boxes are dropped when publishing so agents never see an empty tile.
function pktCleanForPublish(){
  pktDraft.questions.forEach(q=>{ q.options = q.options.filter(o=>o.text.trim()); });
}
function pktPublish(){
  const probs = pktValidate();
  if(probs.length){
    const ov = showModal(`<div class="modal-title">Almost there</div><div style="font-size:12.5px;line-height:1.6;">${probs.map(x=>`• ${esc(x)}`).join("<br>")}</div><div class="modal-actions"><button class="btn btn-accent" id="pktProbOk">OK</button></div>`);
    ov.querySelector("#pktProbOk").addEventListener("click", closeModal);
    return;
  }
  const wasLive = pktDraft.status==="live";
  if(!pktEdLocked()) pktCleanForPublish();
  pktDraft.status = "live";
  if(!pktDraft.publishedAt) pktDraft.publishedAt = new Date().toISOString();
  if(!pktCommitDraft()){ pktDraft.status = wasLive ? "live" : "draft"; return; }
  logAudit(wasLive ? "pkt_update" : "pkt_publish", `${wasLive ? "Updated" : "Published"} PKT "${pktDraft.title}" (${pktDraft.questions.length} questions, ${pktDraft.durationMins} min)`, {});
  showToast(wasLive ? "✅ PKT updated" : "✅ PKT is live — agents can see it now");
  pktDraft = null; pktView = "home"; render();
}

/* ---- Images ---- */
function pktImageToDataUrl(file){
  return new Promise((resolve, reject)=>{
    if(!file || !/^image\//.test(file.type)) return reject(new Error("Please choose an image file."));
    const fr = new FileReader();
    fr.onerror = ()=> reject(new Error("Couldn't read that file."));
    fr.onload = ()=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error("That image couldn't be opened."));
      img.onload = ()=>{
        const MAX = 900, scale = Math.min(1, MAX/Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width*scale)), h = Math.max(1, Math.round(img.height*scale));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const ctx = cv.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0,0,w,h); // flatten transparency (JPEG has none)
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.72));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
async function pktAttachImage(file){
  if(pktEdLocked()) return;
  try{
    const url = await pktImageToDataUrl(file);
    const q = pktDraft.questions[pktSelQ]; const prev = q.image;
    q.image = url;
    if(pktDraftSize() > PKT_DOC_LIMIT){ q.image = prev; showToast("That image would make the PKT too large to save. Try a smaller image."); return; }
    pktTouch(); pktEdRender();
  }catch(e){ showToast(e.message || "Couldn't add that image."); }
}

/* ---- Rendering ---- */
function pktRenderEditor(content, topActions){
  topActions.innerHTML = "";
  // Re-render only when not already showing the editor — snapshots from other users must not rebuild
  // (and blur) the form you're typing in. The editor re-renders itself via pktEdRender().
  if(content.querySelector('#pktRoot[data-editor="'+pktDraft.id+'"]')) return;
  pktEdRender();
  if(pktPublishOnOpen){ pktPublishOnOpen = false; setTimeout(pktPublish, 50); }
}
function pktEdRender(){
  const content = document.getElementById("content");
  const scroll = content.querySelector(".pkt-ed-main") ? content.querySelector(".pkt-ed-main").scrollTop : 0;
  content.innerHTML = pktEditorHtml();
  pktEdWire(content);
  const m = content.querySelector(".pkt-ed-main"); if(m) m.scrollTop = scroll;
}
function pktEditorHtml(){
  const d = pktDraft, locked = pktEdLocked(), q = d.questions[pktSelQ] || d.questions[0];
  if(pktSelQ >= d.questions.length) pktSelQ = d.questions.length-1;
  const isLive = d.status==="live";
  const list = d.questions.map((qq,i)=>{
    const prob = pktQuestionProblem(qq);
    return `<div class="pkt-qcard ${i===pktSelQ?"active":""}" data-qi="${i}">
      <div class="pkt-qcard-n">${i+1}</div>
      <div class="pkt-qcard-body">
        <div class="pkt-qcard-text">${qq.text.trim() ? esc(qq.text.slice(0,70)) : `<i style="color:var(--text-dim);">Untitled question</i>`}</div>
        <div class="pkt-qcard-dots">${qq.options.map((o,oi)=>`<span style="background:${PKT_COLORS[oi%PKT_COLORS.length].c};opacity:${o.text.trim()?1:.28};${o.id===qq.correctId?"outline:2px solid var(--text);outline-offset:1px;":""}"></span>`).join("")}${qq.image?`<span class="pkt-qcard-img" title="Has an image">🖼</span>`:""}${prob?`<span class="pkt-qcard-warn" title="${esc(prob)}">⚠</span>`:""}</div>
      </div>
      ${locked ? "" : `<div class="pkt-qcard-acts">
        <button data-qact="up" title="Move up" ${i===0?"disabled":""}>↑</button>
        <button data-qact="down" title="Move down" ${i===d.questions.length-1?"disabled":""}>↓</button>
        <button data-qact="dup" title="Duplicate">⧉</button>
        <button data-qact="del" title="Delete" ${d.questions.length===1?"disabled":""}>🗑</button>
      </div>`}
    </div>`;
  }).join("");
  const tiles = q.options.map((o,oi)=>{
    const col = PKT_COLORS[oi%PKT_COLORS.length];
    const isCorrect = o.id===q.correctId;
    return `<div class="pkt-tile ${isCorrect?"correct":""}" style="--tc:${col.c};" data-oi="${oi}">
      <span class="pkt-tile-shape">${col.s}</span>
      <textarea class="pkt-tile-input" rows="2" data-opt="${oi}" placeholder="Add answer ${oi+1}${oi>=PKT_MIN_OPTIONS?" (optional)":""}" ${locked?"disabled":""}>${esc(o.text)}</textarea>
      <button type="button" class="pkt-tick" data-tick="${oi}" title="${isCorrect?"This is the correct answer":"Mark as the correct answer"}" ${locked?"disabled":""}>${isCorrect?"✓":""}</button>
      ${!locked && q.options.length>PKT_MIN_OPTIONS ? `<button type="button" class="pkt-tile-x" data-rmopt="${oi}" title="Remove this answer">✕</button>` : ""}
    </div>`;
  }).join("");
  const img = pktSafeImg(q.image);
  const size = pktDraftSize();
  const lobs = LOB_OPTIONS;
  const presets = [10,15,20,30,45,60];
  return `
  <div class="pkt-editor" id="pktRoot" data-editor="${esc(d.id)}">
    <div class="pkt-ed-top">
      <button class="btn btn-ghost btn-sm" id="pktEdBack">← Back</button>
      <input type="text" id="pktTitle" class="pkt-title-input" placeholder="Enter PKT title…" value="${esc(d.title)}" maxlength="120">
      <span class="pkt-chip" id="pktSaveChip">${pktDirty?"Saving…":(d.__isNew && !pktDraftHasContent() ? "Draft" : "Saved ✓")}</span>
      ${isLive ? `<span class="badge badge-green">Live</span>` : `<span class="badge badge-gray">Draft</span>`}
      <button class="btn btn-sm" id="pktEdPreview">▶ Preview</button>
      <button class="btn btn-accent btn-sm" id="pktEdPublish">${isLive ? "💾 Save changes" : "🚀 Publish"}</button>
    </div>
    ${locked ? `<div class="pkt-banner">🔒 ${pktAttemptsOf(d.id).length} agent${pktAttemptsOf(d.id).length===1?" has":"s have"} already started this PKT, so its questions and answers are locked to keep scores fair. You can still change the duration, pass mark, due date and other settings, or <b>duplicate</b> it from the PKT list to make a new version.</div>` : ""}
    <div class="pkt-ed-body">
      <aside class="pkt-ed-left">
        <div class="pkt-ed-list">${list}</div>
        ${locked ? "" : `<button class="btn btn-accent pkt-add-q" id="pktAddQ">＋ Add question</button>`}
      </aside>
      <main class="pkt-ed-main">
        <div class="pkt-q-canvas">
          <textarea id="pktQText" class="pkt-q-input" rows="2" placeholder="Start typing your question" ${locked?"disabled":""}>${esc(q.text)}</textarea>
          ${img ? `<div class="pkt-img-wrap"><img src="${img}" alt="Question image">${locked?"":`<button type="button" class="pkt-img-x" id="pktImgRm" title="Remove image">✕ Remove</button>`}</div>`
            : (locked ? "" : `<label class="pkt-drop" id="pktDrop"><input type="file" id="pktImgIn" accept="image/*" hidden><div class="pkt-drop-ic">🖼</div><div><b>Add an image</b> <span>(optional)</span></div><div class="help-note">Click to browse, or drag &amp; drop a picture here</div></label>`)}
        </div>
        <div class="pkt-tiles n${Math.min(q.options.length,6)}">${tiles}</div>
        ${locked || q.options.length>=PKT_MAX_OPTIONS ? "" : `<button class="btn btn-ghost btn-sm" id="pktAddOpt" style="margin-top:10px;">＋ Add another answer</button>`}
        <div class="help-note" style="margin-top:12px;">Tick the circle on the right of the correct answer. Each question is worth the same share of the score, and there's <b>no time limit per question</b> — agents get one timer for the whole PKT.</div>
      </main>
      <aside class="pkt-ed-right">
        <div class="pkt-set-title">PKT settings</div>
        <div class="pkt-set">
          <label>⏱ PKT duration</label>
          <div class="pkt-dur"><input type="number" id="pktDur" min="1" max="240" step="1" value="${Number(d.durationMins)||""}"><span>minutes</span></div>
          <div class="pkt-presets">${presets.map(m=>`<button type="button" class="pkt-preset ${Number(d.durationMins)===m?"on":""}" data-preset="${m}">${m}</button>`).join("")}</div>
          <div class="help-note">One countdown for the whole PKT. When it hits zero the PKT is submitted automatically. No per-question limit.</div>
        </div>
        <div class="pkt-set">
          <label>🎯 Pass mark (%)</label>
          <input type="number" id="pktPass" min="0" max="100" step="1" value="${Number(d.passMark)}">
        </div>
        <div class="pkt-set">
          <label>👥 Who takes it</label>
          <select id="pktLob"><option value="">All LOBs</option>${lobs.map(l=>`<option value="${esc(l)}" ${d.lob===l?"selected":""}>${esc(l)} only</option>`).join("")}</select>
        </div>
        <div class="pkt-set">
          <label>📅 Due date <span style="font-weight:400;color:var(--text-dim);">(optional)</span></label>
          <input type="date" id="pktDue" value="${esc(d.dueDate||"")}">
          <div class="help-note">After this date agents who haven't started can't begin it.</div>
        </div>
        <div class="pkt-set">
          <label class="pkt-check"><input type="checkbox" id="pktShufQ" ${d.shuffleQuestions?"checked":""} ${locked?"disabled":""}> Shuffle question order</label>
          <label class="pkt-check"><input type="checkbox" id="pktShufO" ${d.shuffleOptions?"checked":""} ${locked?"disabled":""}> Shuffle answer order</label>
          <label class="pkt-check"><input type="checkbox" id="pktShowAns" ${d.showAnswers?"checked":""}> Show correct answers to agents after they submit</label>
        </div>
        <div class="pkt-summary">
          <div><b>${d.questions.length}</b> question${d.questions.length===1?"":"s"} · <b>${d.questions.length ? pktPct(100/d.questions.length) : "—"}</b> each</div>
          <div>Size ${Math.round(size/1024)} KB of ${Math.round(PKT_DOC_LIMIT/1024)} KB${size > PKT_DOC_LIMIT*0.8 ? ` <span style="color:var(--yellow);">⚠ getting large</span>` : ""}</div>
        </div>
      </aside>
    </div>
  </div>`;
}

/* ---- Wiring ---- */
function pktEdWire(content){
  const d = pktDraft, locked = pktEdLocked();
  const q = ()=> d.questions[pktSelQ];
  const $ = id => document.getElementById(id);
  $("pktEdBack").addEventListener("click", pktCloseEditor);
  $("pktTitle").addEventListener("input", e=>{ d.title = e.target.value; pktTouch(); });
  $("pktEdPublish").addEventListener("click", pktPublish);
  $("pktEdPreview").addEventListener("click", ()=>{
    pktCleanedPreview();
  });
  // question list
  content.querySelectorAll(".pkt-qcard").forEach(card=> card.addEventListener("click", e=>{
    if(e.target.closest("[data-qact]")) return;
    pktSelQ = Number(card.dataset.qi); pktEdRender();
  }));
  content.querySelectorAll("[data-qact]").forEach(b=> b.addEventListener("click", e=>{
    e.stopPropagation();
    const i = Number(b.closest(".pkt-qcard").dataset.qi), act = b.dataset.qact;
    if(act==="up" && i>0){ [d.questions[i-1], d.questions[i]] = [d.questions[i], d.questions[i-1]]; pktSelQ = i-1; }
    else if(act==="down" && i<d.questions.length-1){ [d.questions[i+1], d.questions[i]] = [d.questions[i], d.questions[i+1]]; pktSelQ = i+1; }
    else if(act==="dup"){
      const c = JSON.parse(JSON.stringify(d.questions[i])); const map = {};
      c.id = pktNewId("q"); c.options.forEach(o=>{ const old=o.id; o.id=pktNewId("o"); map[old]=o.id; }); c.correctId = map[c.correctId]||"";
      d.questions.splice(i+1, 0, c); pktSelQ = i+1;
    } else if(act==="del" && d.questions.length>1){
      d.questions.splice(i,1); pktSelQ = Math.max(0, Math.min(pktSelQ, d.questions.length-1));
    }
    pktTouch(); pktEdRender();
  }));
  const add = $("pktAddQ");
  if(add) add.addEventListener("click", ()=>{ d.questions.push(pktNewQuestion()); pktSelQ = d.questions.length-1; pktTouch(); pktEdRender(); const t=$("pktQText"); if(t) t.focus(); });
  // question text + options
  const qt = $("pktQText");
  qt.addEventListener("input", e=>{
    q().text = e.target.value; pktTouch();
    const card = content.querySelector(`.pkt-qcard[data-qi="${pktSelQ}"] .pkt-qcard-text`);
    if(card) card.innerHTML = q().text.trim() ? esc(q().text.slice(0,70)) : `<i style="color:var(--text-dim);">Untitled question</i>`;
  });
  content.querySelectorAll("[data-opt]").forEach(t=> t.addEventListener("input", e=>{ q().options[Number(t.dataset.opt)].text = e.target.value; pktTouch(); }));
  content.querySelectorAll("[data-tick]").forEach(b=> b.addEventListener("click", ()=>{
    const o = q().options[Number(b.dataset.tick)];
    q().correctId = (q().correctId===o.id) ? "" : o.id;
    pktTouch(); pktEdRender();
  }));
  content.querySelectorAll("[data-rmopt]").forEach(b=> b.addEventListener("click", ()=>{
    const i = Number(b.dataset.rmopt), o = q().options[i];
    if(o.text.trim()){ /* removing a filled answer is deliberate — no confirm needed, it's a draft */ }
    if(q().correctId===o.id) q().correctId = "";
    q().options.splice(i,1); pktTouch(); pktEdRender();
  }));
  const addOpt = $("pktAddOpt");
  if(addOpt) addOpt.addEventListener("click", ()=>{ q().options.push({id:pktNewId("o"), text:""}); pktTouch(); pktEdRender(); });
  // image
  const inp = $("pktImgIn");
  if(inp) inp.addEventListener("change", e=>{ const f = e.target.files && e.target.files[0]; if(f) pktAttachImage(f); });
  const drop = $("pktDrop");
  if(drop){
    ["dragenter","dragover"].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave","drop"].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", e=>{ const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) pktAttachImage(f); });
  }
  const rm = $("pktImgRm");
  if(rm) rm.addEventListener("click", ()=>{ q().image = ""; pktTouch(); pktEdRender(); });
  // settings
  const setDur = v=>{ d.durationMins = v; pktTouch(); };
  $("pktDur").addEventListener("input", e=>{
    const v = Math.floor(Number(e.target.value)); setDur(v>0 ? Math.min(v,240) : 0);
    content.querySelectorAll(".pkt-preset").forEach(p=> p.classList.toggle("on", Number(p.dataset.preset)===d.durationMins));
  });
  content.querySelectorAll(".pkt-preset").forEach(b=> b.addEventListener("click", ()=>{
    setDur(Number(b.dataset.preset)); $("pktDur").value = d.durationMins;
    content.querySelectorAll(".pkt-preset").forEach(p=> p.classList.toggle("on", p===b));
  }));
  $("pktPass").addEventListener("input", e=>{ d.passMark = Math.max(0, Math.min(100, Number(e.target.value)||0)); pktTouch(); });
  $("pktLob").addEventListener("change", e=>{ d.lob = e.target.value; pktTouch(); });
  $("pktDue").addEventListener("change", e=>{ d.dueDate = e.target.value; pktTouch(); });
  $("pktShufQ").addEventListener("change", e=>{ d.shuffleQuestions = e.target.checked; pktTouch(); });
  $("pktShufO").addEventListener("change", e=>{ d.shuffleOptions = e.target.checked; pktTouch(); });
  $("pktShowAns").addEventListener("change", e=>{ d.showAnswers = e.target.checked; pktTouch(); });
}
