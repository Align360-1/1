/* =========================================================
   Knowledge Base — "Import from document" (Trainer / TL / SME / Quality / Admin)
   ---------------------------------------------------------
   Upload an SOP (.docx, or .txt/.md) → js/kb-ai.js finds the topics and writes a quick answer for each →
   a REVIEW screen shows every proposed article (tick/untick, fix title / quick answer / category / LOB,
   preview) → "Save as drafts" or "Publish". Nothing reaches agents until a person confirms.

   Re-uploading a revised SOP: articles that came from the same file (and weren't hand-edited since) are
   offered as "Update existing" instead of creating duplicates. Hand-edited ones default to "Skip".

   Word files are read in the browser with mammoth.js (js/vendor, BSD-2) — loaded only when someone opens
   this screen. The document never leaves the browser; only the articles you save go to Firestore.
   ========================================================= */

let kbImp = null;       // {token, step:"upload"|"review", lob, file, docTitle, items[], notes[], busy, err}
const KB_IMP_MAX_BYTES = 20 * 1024 * 1024;
const KB_IMP_IMG_BUDGET = 640 * 1024;   // per article, leaves headroom under KB_DOC_LIMIT for the text
let kbImpLibPromise = null;

function kbOpenImport(){
  if(!canManageKB()) return;
  kbImp = {token:kbNewId("imp"), step:"upload", lob:"", file:"", docTitle:"", items:[], notes:[], busy:"", err:""};
  kbView = "import"; currentTab = "kb"; kbOpenId = null; render();
}
function kbImpClose(){ kbImp = null; kbView = "list"; render(); }
function kbImpLoadLib(){
  if(typeof mammoth !== "undefined") return Promise.resolve();
  if(!kbImpLibPromise) kbImpLibPromise = new Promise((res, rej)=>{
    const s = document.createElement("script"); s.src = "js/vendor/mammoth.browser.min.js";
    s.onload = ()=> typeof mammoth !== "undefined" ? res() : rej(new Error("The Word reader didn't start."));
    s.onerror = ()=>{ kbImpLibPromise = null; rej(new Error("Couldn't load the Word reader — check your connection and try again.")); };
    document.head.appendChild(s);
  });
  return kbImpLibPromise;
}

/* ---------------- entry from renderKB ---------------- */
function kbImportRender(content, topActions){
  topActions.innerHTML = "";
  if(content.querySelector('#kbImpRoot[data-imp="'+kbImp.token+'"][data-step="'+kbImp.step+'"]')) return;   // don't rebuild while typing
  kbImpDraw(content);
}
function kbImpDraw(content){
  content = content || document.getElementById("content");
  if(kbImp.step === "review") kbImpDrawReview(content); else kbImpDrawUpload(content);
}

/* ---------------- step 1: upload ---------------- */
function kbImpDrawUpload(content){
  const lobs = LOB_OPTIONS;
  content.innerHTML = `
  <div class="kb-imp" id="kbImpRoot" data-imp="${esc(kbImp.token)}" data-step="upload">
    <div class="pkt-ed-top"><button class="btn btn-ghost btn-sm" id="kbImpBack">← Back</button>
      <div style="flex:1;font-family:'Space Grotesk',sans-serif;font-weight:700;">Import articles from a document</div></div>
    <div class="section" style="max-width:760px;"><div class="section-body">
      <p class="kb-imp-lead">Upload an SOP and the topics, quick answers and articles are created for you — no copy-pasting. You'll review everything before anything is saved.</p>
      <div class="field"><label>Who is this SOP for?</label>
        <select id="kbImpLob"><option value="">General — all LOBs</option>${lobs.map(l=>`<option value="${esc(l)}" ${kbImp.lob===l?"selected":""}>${esc(l)} only</option>`).join("")}</select>
        <div class="help-note">Agents only see articles for their own LOB plus General. You can change this per article on the next screen.</div></div>
      <label class="kb-imp-drop" id="kbImpDrop" tabindex="0">
        <input type="file" id="kbImpFile" accept=".docx,.txt,.md,.markdown" hidden>
        <div class="kb-imp-drop-ic">📄</div>
        <div class="kb-imp-drop-t" id="kbImpDropT">${kbImp.busy ? esc(kbImp.busy) : "Drop the SOP here, or click to choose a file"}</div>
        <div class="help-note">Word (.docx) works best · also .txt and .md · up to 20 MB</div>
      </label>
      ${kbImp.err ? `<div class="pkt-banner" style="margin-top:12px;border-color:var(--red);background:var(--red-dim);">${esc(kbImp.err)}</div>` : ""}
      <div class="kb-imp-how"><b>How it decides what to create</b>
        <ul class="kb-list" style="margin:6px 0 0;">
          <li>Each <b>Heading</b> in the Word file becomes an article; the heading above it becomes the topic (category).</li>
          <li>The <b>⚡ Quick answer</b> is the key sentence(s) of that section — or a short step summary if the section is just a procedure.</li>
          <li>Steps, bullets, tables, notes / warnings and screenshots carry over. Phone numbers and emails become one-click copy.</li>
          <li>Revision history, approvals and similar admin sections are left unticked.</li>
          <li>Everything is saved as a <b>draft</b> unless you choose Publish.</li></ul>
        <div class="help-note" style="margin-top:8px;">Tip: if your SOP uses Word's Heading 1 / Heading 2 styles, topics split cleanly. Re-uploading a revised version updates the same articles instead of duplicating them.</div></div>
    </div></div>
  </div>`;
  const $ = id => document.getElementById(id), inp = $("kbImpFile"), drop = $("kbImpDrop");
  $("kbImpBack").addEventListener("click", kbImpClose);
  $("kbImpLob").addEventListener("change", e=>{ kbImp.lob = e.target.value; });
  inp.addEventListener("change", e=>{ const f = e.target.files && e.target.files[0]; e.target.value = ""; if(f) kbImpHandleFile(f); });
  ["dragenter","dragover"].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave","drop"].forEach(ev=> drop.addEventListener(ev, e=>{ e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e=>{ const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) kbImpHandleFile(f); });
  drop.addEventListener("keydown", e=>{ if(e.key==="Enter" || e.key===" "){ e.preventDefault(); inp.click(); } });
}
function kbImpStatus(msg){
  kbImp.busy = msg;
  const t = document.getElementById("kbImpDropT"), d = document.getElementById("kbImpDrop");
  if(t) t.textContent = msg || "Drop the SOP here, or click to choose a file";
  if(d) d.classList.toggle("busy", !!msg);
}
async function kbImpHandleFile(file){
  if(kbImp.busy) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase(), base = file.name.replace(/\.[^.]+$/,"");
  kbImp.err = "";
  const fail = msg=>{ kbImp.err = msg; kbImpStatus(""); kbImpDraw(); };
  if(ext === "doc") return fail("That's an old-format Word file (.doc). Open it in Word and choose Save As → Word Document (.docx), then upload it again.");
  if(!["docx","txt","md","markdown"].includes(ext)) return fail("Please upload a Word (.docx), .txt or .md file.");
  if(file.size > KB_IMP_MAX_BYTES) return fail("That file is over 20 MB. Remove large images or split the SOP and try again.");
  kbImpStatus("Reading the document…");
  try{
    let res, raw = [];
    if(ext === "docx"){
      await kbImpLoadLib();
      const buf = await file.arrayBuffer();
      const r = await mammoth.convertToHtml({arrayBuffer:buf}, {
        styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p:fresh"],
        convertImage: mammoth.images.imgElement(img=> img.readAsArrayBuffer().then(b=>{ raw.push({type:img.contentType||"", buf:b}); return {src:"kbimg:"+(raw.length-1)}; }))
      });
      kbImpStatus("Finding topics and writing quick answers…");
      res = kbAi.fromHtml(r.value, {fileTitle:base});
    } else {
      kbImpStatus("Finding topics and writing quick answers…");
      res = kbAi.fromText(await file.text(), {fileTitle:base});
    }
    if(!res.articles.length) return fail("No readable text was found in that file.");
    kbImpStatus("Preparing screenshots…");
    const items = await kbImpBuildItems(res.articles, raw, file.name);
    kbImp.items = items; kbImp.notes = res.notes.slice(); kbImp.file = file.name; kbImp.docTitle = res.docTitle;
    if(raw.length && !items.some(a=>a.images.length) && res.articles.some(a=>a.imgRefs.length)) kbImp.notes.push("Some images couldn't be converted (unsupported picture format) and were left out.");
    kbImp.step = "review"; kbImp.busy = ""; render();
  }catch(err){
    console.error("KB import failed", err);
    const em = String(err && err.message || "");
    fail(/password|encrypt/i.test(em) ? "That file is password-protected. Remove the password in Word and try again."
      : /zip|central directory|corrupt/i.test(em) ? "That doesn't look like a valid Word (.docx) file — it may be damaged or renamed from another format. Open it in Word, Save As .docx, and try again."
      : "Couldn't read that document" + (err && err.message ? " — " + err.message : ".") + " If it keeps happening, re-save it as .docx from Word and try again.");
  }
}

/* images: compress once, give each article its own budget; markers ![n] are renumbered when one is dropped */
async function kbImpBuildItems(articles, raw, fileName){
  const cache = {};
  const dataFor = async idx=>{
    if(idx in cache) return cache[idx];
    const r = raw[idx]; let data = "";
    try{ if(r && /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(r.type)) data = await pktImageToDataUrl(new File([r.buf], "img", {type:r.type})); }catch(e){ data = ""; }
    return (cache[idx] = data);
  };
  const out = [];
  for(const a of articles){
    const keep = [], images = []; let used = 0, dropped = 0;
    for(const ref of a.imgRefs){
      const data = await dataFor(ref.idx);
      if(data && used + data.length <= KB_IMP_IMG_BUDGET){ used += data.length; keep.push(images.length+1); images.push({id:kbNewId("img"), data, caption:ref.caption||""}); }
      else { keep.push(0); dropped++; }
    }
    let body = a.body;
    if(a.imgRefs.length) body = body.replace(/^!\[(\d+)\][ \t]*$/gm, (m,n)=>{ const k = keep[Number(n)-1]; return k ? `![${k}]` : ""; }).replace(/\n{3,}/g,"\n\n").trim();
    const warnings = a.warnings.slice();
    if(dropped) warnings.push(`${dropped} screenshot${dropped===1?" was":"s were"} left out (too large or unsupported) — add ${dropped===1?"it":"them"} in the editor if needed.`);
    const it = Object.assign({}, a, {body, images, warnings, sel:a.include, lob:kbImp.lob, action:"new", matchId:"", matchNote:""});
    kbImpMatch(it, fileName);
    out.push(it);
  }
  return out;
}
function kbImpMatch(it, fileName){
  const nt = kbAi.normTitle(it.title), arts = state.kbArticles || [];
  const bySource = arts.find(x=> x.source && String(x.source.file||"").toLowerCase()===fileName.toLowerCase() && x.source.section===nt);
  const byTitle = bySource || arts.find(x=> kbAi.normTitle(x.title)===nt);
  if(!byTitle) return;
  it.matchId = byTitle.id;
  const untouched = !!(bySource && bySource.source.hash === kbAi.hashStr((bySource.summary||"")+"\u0001"+(bySource.body||"")));
  if(untouched){ it.action = "update"; it.matchNote = `Already in the knowledge base (${byTitle.status}) from this file — will be updated.`; }
  else { it.action = "skip"; it.matchNote = bySource ? "Already in the knowledge base and edited by hand since — skipped so your edits aren't overwritten." : "An article with this title already exists — skipped to avoid a duplicate."; it.sel = false; }
}

/* ---------------- step 2: review ---------------- */
function kbImpCounts(){
  const sel = kbImp.items.filter(i=>i.sel);
  return {sel:sel.length, total:kbImp.items.length, upd:sel.filter(i=>i.action==="update").length, skip:sel.filter(i=>i.action==="skip").length,
          noQa:sel.filter(i=>i.action!=="skip" && !i.summary.trim()).length};
}
function kbImpCardHtml(it, i){
  const lobs = LOB_OPTIONS, match = it.matchId ? kbById(it.matchId) : null;
  const nSteps = (it.body.match(/^\s*\d+[.)]\s/gm)||[]).length, nTables = (it.body.match(/^\|---/gm)||[]).length;
  const facts = [nSteps?`${nSteps} step${nSteps===1?"":"s"}`:"", nTables?`${nTables} table${nTables===1?"":"s"}`:"", it.images.length?`${it.images.length} image${it.images.length===1?"":"s"}`:""].filter(Boolean).join(" · ");
  const warn = (it.include ? it.warnings : []).map(w=>`<div class="kb-imp-warn">⚠ ${esc(w)}</div>`).join("") + (it.reason && !it.sel ? `<div class="kb-imp-warn off">ℹ ${esc(it.reason)}</div>` : "") + (it.matchNote ? `<div class="kb-imp-warn ${it.action==="update"?"upd":""}">${it.action==="update"?"🔄":"⚠"} ${esc(it.matchNote)}</div>` : "");
  return `<div class="kb-imp-card ${it.sel?"":"off"}" data-i="${i}">
    <div class="kb-imp-head">
      <label class="kb-imp-tick"><input type="checkbox" data-f="sel" ${it.sel?"checked":""} aria-label="Include this article"></label>
      <input type="text" class="kb-imp-title" data-f="title" maxlength="140" value="${esc(it.title)}" aria-label="Article title">
      ${it.matchId ? `<select class="week-select kb-imp-act" data-f="action" title="What to do with the existing article“${esc(match?match.title:"")}”"><option value="new" ${it.action==="new"?"selected":""}>Create new copy</option><option value="update" ${it.action==="update"?"selected":""}>Update existing</option><option value="skip" ${it.action==="skip"?"selected":""}>Skip</option></select>` : `<span class="badge badge-green">New</span>`}
    </div>
    <div class="kb-imp-body">
      <div class="kb-row">
        <div class="field"><label>Topic / category</label><input type="text" data-f="category" maxlength="40" list="kbCatList2" value="${esc(it.category)}"></div>
        <div class="field"><label>Applies to</label><select data-f="lob"><option value="">General — all LOBs</option>${lobs.map(l=>`<option value="${esc(l)}" ${it.lob===l?"selected":""}>${esc(l)} only</option>`).join("")}</select></div>
      </div>
      ${warn}
      <div class="field"><label>⚡ Quick answer</label><textarea data-f="summary" rows="2" maxlength="400" placeholder="Write the short answer agents see first.">${esc(it.summary)}</textarea></div>
      <details class="kb-imp-det" data-i="${i}"><summary>Preview &amp; edit details${facts ? ` <span class="help-note">— ${esc(facts)}</span>` : ""}</summary>
        <div class="kb-imp-detgrid"><div><div class="kb-prev-label">Details (text)</div><textarea data-f="body" rows="12" class="kb-body-in"></textarea></div>
        <div><div class="kb-prev-label">What agents will see</div><div class="kb-article kb-imp-prev"></div></div></div></details>
      <div class="field" style="margin-bottom:0;"><label>Search words</label><input type="text" data-f="tags" placeholder="comma-separated" value="${esc((it.tags||[]).join(", "))}"></div>
    </div></div>`;
}
function kbImpDrawReview(content){
  const lobs = LOB_OPTIONS, c = kbImpCounts();
  content.innerHTML = `
  <div class="kb-imp" id="kbImpRoot" data-imp="${esc(kbImp.token)}" data-step="review">
    <div class="pkt-ed-top"><button class="btn btn-ghost btn-sm" id="kbImpBack">← Back</button>
      <div style="flex:1;font-family:'Space Grotesk',sans-serif;font-weight:700;">Review articles from “${esc(kbImp.file)}”</div>
      <span class="pkt-chip" id="kbImpChip"></span></div>
    <datalist id="kbCatList2">${kbCategories().map(x=>`<option value="${esc(x)}">`).join("")}</datalist>
    <div class="pkt-banner kb-imp-intro">Found <b>${c.total}</b> topic${c.total===1?"":"s"}${kbImp.docTitle?` in <b>${esc(kbImp.docTitle)}</b>`:""}. Tick the ones you want, fix anything that looks off, then save. Nothing is visible to agents until it's published.</div>
    ${kbImp.notes.map(n=>`<div class="pkt-banner" style="border-color:var(--yellow);background:var(--yellow-dim);">⚠ ${esc(n)}</div>`).join("")}
    <div class="kb-imp-tools">
      <button class="btn btn-ghost btn-sm" id="kbImpAll">Select all</button><button class="btn btn-ghost btn-sm" id="kbImpNone">Select none</button>
      <span style="flex:1"></span>
      <label class="help-note" style="display:flex;gap:6px;align-items:center;">Set “Applies to” for all:
        <select class="week-select" id="kbImpBulkLob"><option value="__">— choose —</option><option value="">General — all LOBs</option>${lobs.map(l=>`<option value="${esc(l)}">${esc(l)} only</option>`).join("")}</select></label>
    </div>
    <div id="kbImpList">${kbImp.items.map(kbImpCardHtml).join("")}</div>
    <div class="kb-imp-foot">
      <div class="help-note" id="kbImpFootNote" style="flex:1;"></div>
      <button class="btn" id="kbImpDraft">💾 Save as drafts</button>
      <button class="btn btn-accent" id="kbImpPub">🚀 Publish</button>
    </div>
  </div>`;
  kbImpWireReview(content); kbImpUpdateFoot();
}
function kbImpUpdateFoot(){
  const c = kbImpCounts(), $ = id => document.getElementById(id); if(!$("kbImpChip")) return;
  const n = kbImp.items.filter(i=>i.sel && i.action!=="skip").length;
  $("kbImpChip").textContent = `${c.sel} of ${c.total} selected`;
  $("kbImpDraft").textContent = n ? `💾 Save ${n} as draft${n===1?"":"s"}` : "💾 Save as drafts";
  $("kbImpPub").textContent = n ? `🚀 Publish ${n}` : "🚀 Publish";
  $("kbImpDraft").disabled = $("kbImpPub").disabled = !n;
  $("kbImpFootNote").textContent = c.noQa ? `⚠ ${c.noQa} selected article${c.noQa===1?" has":"s have"} no quick answer yet.` : (c.upd ? `${c.upd} existing article${c.upd===1?"":"s"} will be updated.` : "");
}
function kbImpPrev(card, it){
  const prev = card.querySelector(".kb-imp-prev"); if(!prev) return;
  prev.innerHTML = it.body.trim() ? kbMd(it.body, it) : `<div class="help-note">Nothing in the details — the quick answer is the whole article.</div>`;
  prev.querySelectorAll(".kb-copy").forEach(cp=> cp.addEventListener("click", ()=> kbCopy(cp.dataset.copy)));
  prev.querySelectorAll(".kb-img").forEach(im=> im.addEventListener("click", ()=> openImageLightbox(im.src, im.alt)));
}
function kbImpWireReview(content){
  const $ = id => document.getElementById(id), list = $("kbImpList");
  $("kbImpBack").addEventListener("click", ()=> showConfirm("Discard this import? Nothing has been saved yet.", kbImpClose, "Discard"));
  const setAll = v=>{ kbImp.items.forEach((it,i)=>{ if(v && it.action==="skip" && it.matchId) return; it.sel = v; }); list.querySelectorAll(".kb-imp-card").forEach(cd=>{ const it = kbImp.items[Number(cd.dataset.i)]; cd.querySelector('[data-f="sel"]').checked = it.sel; cd.classList.toggle("off", !it.sel); }); kbImpUpdateFoot(); };
  $("kbImpAll").addEventListener("click", ()=> setAll(true));
  $("kbImpNone").addEventListener("click", ()=> setAll(false));
  $("kbImpBulkLob").addEventListener("change", e=>{
    if(e.target.value === "__") return;
    kbImp.items.forEach(it=> it.lob = e.target.value);
    list.querySelectorAll('[data-f="lob"]').forEach(s=> s.value = e.target.value);
    showToast("Applies-to updated for all articles"); e.target.value = "__";
  });
  list.addEventListener("input", e=>{
    const el = e.target, f = el.dataset.f, card = el.closest(".kb-imp-card"); if(!f || !card) return;
    const it = kbImp.items[Number(card.dataset.i)];
    if(f === "title") it.title = el.value;
    else if(f === "category") it.category = el.value.trim();
    else if(f === "summary"){ it.summary = el.value; kbImpUpdateFoot(); }
    else if(f === "body"){ it.body = el.value; kbImpPrev(card, it); }
    else if(f === "tags") it.tags = el.value.split(",").map(t=>t.trim()).filter(Boolean).slice(0,20);
  });
  list.addEventListener("change", e=>{
    const el = e.target, f = el.dataset.f, card = el.closest(".kb-imp-card"); if(!f || !card) return;
    const it = kbImp.items[Number(card.dataset.i)];
    if(f === "sel"){ it.sel = el.checked; card.classList.toggle("off", !it.sel); }
    else if(f === "lob") it.lob = el.value;
    else if(f === "action"){ it.action = el.value; if(it.action!=="skip") { it.sel = true; card.querySelector('[data-f="sel"]').checked = true; card.classList.remove("off"); } }
    kbImpUpdateFoot();
  });
  list.addEventListener("toggle", e=>{
    const d = e.target; if(!(d.classList && d.classList.contains("kb-imp-det")) || !d.open) return;
    const card = d.closest(".kb-imp-card"), it = kbImp.items[Number(card.dataset.i)], ta = card.querySelector('[data-f="body"]');
    if(!ta.dataset.ready){ ta.value = it.body; ta.dataset.ready = "1"; }
    kbImpPrev(card, it);
  }, true);
  $("kbImpDraft").addEventListener("click", ()=> kbImpCommit(false));
  $("kbImpPub").addEventListener("click", ()=>{
    const c = kbImpCounts();
    showConfirm(`Publish ${kbImp.items.filter(i=>i.sel && i.action!=="skip").length} article(s) straight to agents? They were generated automatically — if you haven't skimmed them, “Save as drafts” is safer.${c.noQa ? `<br><br><b>${c.noQa}</b> of them have no quick answer.` : ""}`, ()=> kbImpCommit(true), "Publish now");
  });
}

/* ---------------- save ---------------- */
function kbImpCommit(publish){
  const chosen = kbImp.items.filter(i=>i.sel && i.action!=="skip");
  if(!chosen.length){ showToast("Nothing selected"); return; }
  const bad = chosen.find(i=>!i.title.trim());
  if(bad){ showToast("⚠ Every selected article needs a title"); return; }
  if(publish){ const empty = chosen.find(i=>!i.summary.trim() && !i.body.trim()); if(empty){ showToast(`⚠ “${empty.title}” has no content — untick it or add some`); return; } }
  // "Related articles": link articles that share distinctive search words (only to articles being saved now)
  const tagSet = i=> new Set((i.tags||[]).map(t=>String(t).toLowerCase()).filter(t=>t.length>=4));
  const relatedOf = it=>{
    const mine = tagSet(it);
    return chosen.filter(x=>x!==it).map(x=>({x, n:Array.from(tagSet(x)).filter(t=>mine.has(t)).length})).filter(r=>r.n>0)
      .sort((a,b)=>b.n-a.n).slice(0,3).map(r=>r.x);
  };
  const now = new Date().toISOString(), file = kbImp.file;
  if(!state.kbArticles) state.kbArticles = [];
  let created = 0, updated = 0;
  chosen.forEach(it=>{
    let body = it.body.trim(); const sibs = relatedOf(it);
    if(sibs.length && !/\[\[/.test(body)) body += (body?"\n\n":"") + "## Related articles\n" + sibs.map(x=>`- [[${x.title.trim().replace(/[\[\]]/g,"")}]]`).join("\n");
    const summary = it.summary.trim();
    const src = {file, section:kbAi.normTitle(it.title), importedAt:now, hash:kbAi.hashStr(summary+"\u0001"+body)};
    const imgs = it.images.map(im=>({id:im.id, data:im.data, caption:im.caption||""}));
    const existing = it.action!=="new" && it.matchId ? kbById(it.matchId) : null;
    let a;
    if(existing && it.action==="update"){
      a = existing;
      Object.assign(a, {title:it.title.trim(), lob:it.lob, category:it.category, summary, body, tags:it.tags||[], images:imgs, source:src,
        updatedAt:now, updatedBy:currentUser.name, version:(a.version||0)+1, changeNote:`Updated from ${file}`.slice(0,140)});
      if(publish){ a.status = "published"; a.reviewedAt = now; }
      updated++;
    } else {
      a = {id:kbNewId("kb"), title:it.title.trim(), lob:it.lob, category:it.category, summary, body, tags:it.tags||[], images:imgs,
        status:publish?"published":"draft", pinned:false, createdBy:currentUser.name, createdByUsername:currentUser.username||"", createdAt:now,
        updatedAt:now, updatedBy:currentUser.name, version:1, changeNote:"", reviewedAt:publish?now:"", source:src};
      state.kbArticles.push(a); created++;
    }
    if(JSON.stringify(a).length > KB_DOC_LIMIT){ a.images = []; a.body = a.body.replace(/^!\[\d+\][ \t]*$/gm,"").trim(); }   // last-resort guard: text always saves
  });
  logAudit("kb_import", `Imported ${created+updated} Knowledge Base article(s) from "${file}" (${created} new, ${updated} updated, ${publish?"published":"drafts"})`, {});
  saveState();
  kbImp = null; kbView = "list"; kbSubTab = "manage"; kbOpenId = null;
  kbMgr.lob = "all"; kbMgr.q = ""; kbMgr.due = false; kbMgr.status = publish ? "published" : "draft";
  showToast(publish ? `✅ ${created+updated} article(s) published` : `✅ ${created+updated} draft(s) saved — review them in Manage articles`);
  render();
}
