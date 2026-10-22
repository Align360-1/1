/* =========================================================
   Knowledge Base — FULL DOCUMENTS + reader tools
   ---------------------------------------------------------
   "Import from document" turns a Word SOP into short articles. This file keeps the COMPLETE document too, so an agent
   can open the SOP exactly as it was written, jump around it with a contents list, and search inside it.

   Storage: same Firestore collection as the articles (trackerKb — no new collection, no new security rule), told apart by `kind`:
     {kind:"document", id, title, lob, file, status:"draft"|"published"|"archived", parts:N, version, createdBy…, updatedAt…}
     {kind:"docpart",  id:"kbp_<docId>_<i>", docId, idx, body (KB markdown), images:[{id,data,caption}], updatedAt}
   A document is split into parts of ≤ ~700 KB each because one Firestore document can't exceed 1 MB. The parts live in
   state.kbDocs (non-enumerable, so they are left out of the localStorage copy / backups — they come back from the cloud).

   Also here (shared by the article reader and the document reader): contents list, find-in-page with highlighting,
   "jump to the section" landing, "related articles", and the "From the full SOP" link on imported articles.
   ========================================================= */

/* ---------------- data ---------------- */
function kbDocList(){
  if(!state.kbDocs) Object.defineProperty(state, "kbDocs", {value:[], writable:true, enumerable:false, configurable:true});
  return state.kbDocs;
}
function kbDocs(){ return kbDocList().filter(d=>d.kind==="document"); }
function kbDocById(id){ return kbDocs().find(d=>d.id===id); }
function kbDocParts(d){ return kbDocList().filter(p=>p.kind==="docpart" && p.docId===d.id).sort((a,b)=>a.idx-b.idx); }
function kbDocVisible(d){
  if(!d || d.kind!=="document" || d.status!=="published") return false;
  if(isAgent()){ const me = kbMyAgent(); return !d.lob || d.lob === ((me && me.lob) || ""); }
  return true;
}
function kbDocScope(){
  let l = kbDocs().filter(kbDocVisible);
  if(!isAgent() && kbLobFilter!=="all") l = l.filter(d=>(d.lob||"")===kbLobFilter);
  return l.sort((a,b)=>String(a.title).localeCompare(String(b.title)));
}
function kbDocSig(d, parts){ return d.id+"|"+(d.version||0)+"|"+parts.length+"|"+parts.map(p=>p.updatedAt||"").join(","); }
const kbDocCache = {};          // id -> {sig, secs, html}   (rendering a big document is the slow part — do it once)
function kbDocSecs(d){
  const parts = kbDocParts(d), sig = kbDocSig(d, parts), c = kbDocCache[d.id];
  if(c && c.sig===sig && c.secs) return c.secs;
  const secs = kbSections(parts.map(p=>p.body).join("\n\n"));
  kbDocCache[d.id] = Object.assign(c && c.sig===sig ? c : {sig}, {secs});
  return secs;
}
function kbDocRendered(d, parts){
  const sig = kbDocSig(d, parts), c = kbDocCache[d.id];
  if(c && c.sig===sig && c.html) return c.html;
  const html = parts.map(p=>kbMd(p.body, p)).join("");
  kbDocCache[d.id] = Object.assign(c && c.sig===sig ? c : {sig}, {html});
  return html;
}
function kbDocArticles(d){
  const f = String(d.file||"").toLowerCase();
  return (state.kbArticles||[]).filter(a=>a.source && String(a.source.file||"").toLowerCase()===f && (kbVisible(a) || canManageKB()));
}

/* create / replace the document that came from `o.file` (a re-upload of a revised SOP replaces it, same id) */
function kbDocUpsert(o){
  const now = new Date().toISOString(), list = kbDocList();
  let d = list.find(x=>x.kind==="document" && String(x.file||"").toLowerCase()===String(o.file||"").toLowerCase());
  const isNew = !d;
  if(isNew){ d = {kind:"document", id:kbNewId("kbd"), createdBy:currentUser.name, createdByUsername:currentUser.username||"", createdAt:now, version:0, status:o.publish?"published":"draft"}; list.push(d); }
  Object.assign(d, {title:o.title, lob:o.lob||"", file:o.file, parts:o.parts.length, updatedAt:now, updatedBy:currentUser.name, version:(d.version||0)+1, importedAt:now});
  if(!isNew && o.publish) d.status = "published";
  const old = kbDocParts(d);
  o.parts.forEach((p,i)=>{
    const id = "kbp_"+d.id+"_"+i, row = list.find(x=>x.id===id);
    const data = {kind:"docpart", id, docId:d.id, idx:i, body:p.body, images:p.images||[], updatedAt:now};
    if(JSON.stringify(data).length > KB_DOC_LIMIT){ data.images = []; data.body = data.body.replace(/^!\[\d+\][ \t]*$/gm,"").trim(); }   // last resort: the text always saves
    if(row) Object.assign(row, data); else list.push(data);
  });
  old.forEach(p=>{ if(p.idx >= o.parts.length){ const i = list.indexOf(p); if(i>=0) list.splice(i,1); } });
  delete kbDocCache[d.id];
  return d;
}
function kbDocRemove(d){
  const list = kbDocList();
  for(let i = list.length-1; i >= 0; i--){ if(list[i].id===d.id || (list[i].kind==="docpart" && list[i].docId===d.id)) list.splice(i,1); }
  delete kbDocCache[d.id];
}

/* ---------------- cards ---------------- */
function kbDocCard(d){
  const n = kbDocSecs(d).filter(s=>s.title).length;
  return `<div class="kb-card kb-doccard" data-kbdoc="${esc(d.id)}" tabindex="0">
    <div class="kb-card-top"><div class="kb-card-title">📄 ${esc(d.title||"Document")}</div></div>
    <div class="kb-card-sum">The complete document, exactly as written — open it, jump to any section, search inside it.</div>
    <div class="kb-card-meta">${kbLobBadge(d)}<span>${n} section${n===1?"":"s"}</span><span>Updated ${esc(fmtDate((d.updatedAt||"").slice(0,10)))}</span></div></div>`;
}
function kbDocHitCard(h){
  const terms = kbHiTerms(kbQuery), t = h.sec.text, low = t.toLowerCase();
  let pos = -1; for(const w of terms){ pos = low.indexOf(w); if(pos>=0) break; }
  const snip = pos<0 ? t.slice(0,150) : (pos>60?"…":"") + t.slice(Math.max(0,pos-60), pos+130) + (pos+130<t.length?"…":"");
  return `<div class="kb-card kb-doccard" data-kbdoc="${esc(h.d.id)}" data-kbanchor="${esc(h.sec.key)}" tabindex="0">
    <div class="kb-card-top"><div class="kb-card-title">📄 ${kbHighlight(h.d.title||"Document", terms)} <span class="kb-crumb-sep">›</span> ${kbHighlight(h.sec.title||"Introduction", terms)}</div></div>
    ${snip ? `<div class="kb-card-snip">${kbHighlight(snip, terms)}</div>` : ""}
    <div class="kb-card-meta">${kbLobBadge(h.d)}<span>Full document</span></div></div>`;
}
/* sections of the full documents that answer the question (skips ones an article already shown for the same section) */
function kbDocSearch(q, shownArticles){
  const terms = kbTerms(q); if(!terms.length) return [];
  const altsOf = terms.map(kbAlts), seen = new Set();
  (shownArticles||[]).forEach(a=>{ if(a.source) seen.add(String(a.source.file||"").toLowerCase()+"|"+(a.source.anchor||a.source.section||"")); });
  const out = [];
  kbDocScope().forEach(d=>{
    const f = String(d.file||"").toLowerCase();
    kbDocSecs(d).forEach(sec=>{
      let sc = 0, n = 0;
      altsOf.forEach(al=>{
        const th = sec.title ? kbBestHit(sec.tlow, al) : 0, bh = sec.low ? kbBestHit(sec.low, al) : 0;
        if(th || bh){ n++; sc += th*6 + bh*1.5 + (bh ? Math.min(3, kbCountWords(sec.low, al, 4))*0.3 : 0); }
      });
      if(n === terms.length && !seen.has(f+"|"+sec.key)) out.push({d, sec, score:sc});
    });
  });
  return out.sort((a,b)=>b.score-a.score).slice(0,8);
}

/* ---------------- article extras ---------------- */
function kbSourceBox(a){
  if(!a.source || !a.source.file) return "";
  const f = String(a.source.file).toLowerCase();
  const d = kbDocs().find(x=>String(x.file||"").toLowerCase()===f && (kbDocVisible(x) || canManageKB()));
  if(!d) return "";
  return `<div class="kb-source">📄 This article comes from <b>${esc(d.title)}</b>${d.status!=="published"?` <span class="badge badge-yellow">${esc(d.status)}</span>`:""}
    <button class="btn btn-ghost btn-sm" data-kbdoc="${esc(d.id)}" data-kbanchor="${esc(a.source.anchor||a.source.section||"")}">Open this part of the full document →</button></div>`;
}
function kbRelatedHtml(a){
  const myTags = new Set((a.tags||[]).map(t=>String(t).toLowerCase())), myWords = new Set(kbTerms(a.title).map(kbStem)), linked = new Set();
  String(a.body||"").replace(/\[\[(.+?)\]\]/g, (m,t)=>{ linked.add(t.trim().toLowerCase()); return m; });
  const r = (state.kbArticles||[]).filter(x=>x.id!==a.id && kbVisible(x) && !linked.has(String(x.title||"").trim().toLowerCase())).map(x=>{
    let sc = 0;
    (x.tags||[]).forEach(t=>{ if(myTags.has(String(t).toLowerCase())) sc += 2; });
    if(a.category && x.category===a.category) sc += 1;
    kbTerms(x.title).forEach(w=>{ if(myWords.has(kbStem(w))) sc += 1; });
    return sc >= 2 ? {x, sc} : null;
  }).filter(Boolean).sort((p,q)=>q.sc-p.sc).slice(0,4);
  if(!r.length) return "";
  return `<div class="kb-related"><div class="kb-sec-title">🔗 You may also need</div><div class="kb-related-list">${r.map(z=>`<a href="#" class="kb-ilink" data-kbopen="${esc(z.x.id)}">${esc(z.x.title)}</a>`).join("")}</div></div>`;
}

/* ---------------- open ---------------- */
function kbOpenDoc(id, opts){
  const d = kbDocById(id); if(!d) return;
  kbJump = {anchor:(opts && opts.anchor) || "", find:(opts && opts.find) || ""};
  kbOpenDocId = id; kbOpenId = null; kbSubTab = "browse";
  if(currentTab!=="kb") currentTab = "kb";
  render(); const m = document.getElementById("main"); if(m) m.scrollTop = 0;
}
function kbDocViewHtml(d){
  const parts = kbDocParts(d), missing = (d.parts||0) > parts.length;
  const arts = kbDocArticles(d);
  return `<div class="kb-article kb-doc" id="kbDocView" data-doc="${esc(d.id)}">
    <div class="kb-art-bar"><button class="btn btn-ghost btn-sm" id="kbBack">← Back</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-ghost btn-sm" id="kbFindBtn">🔎 Find in document</button><button class="btn btn-ghost btn-sm" id="kbTopBtn">⬆ Top</button></div></div>
    <div class="kb-art-head">
      <div class="kb-card-meta" style="margin:0 0 8px;">${kbLobBadge(d)}<span class="kb-cat-tag">Full document</span>${d.status!=="published"?`<span class="badge badge-yellow">${esc(d.status)}</span>`:""}</div>
      <h2 class="kb-art-title">${esc(d.title)}</h2>
      <div class="help-note">${esc(d.file||"")} · Updated ${esc(fmtDate((d.updatedAt||"").slice(0,10)))}${d.updatedBy?` by ${esc(d.updatedBy)}`:""}${d.version>1?` · v${d.version}`:""}</div>
      <div class="help-note" style="margin-top:6px;">This is the complete document as it was uploaded. For quick answers, use the short articles${arts.length?` (${arts.length} made from it)`:""}.</div>
      ${missing ? `<div class="pkt-banner" style="margin:10px 0 0;border-color:var(--yellow);background:var(--yellow-dim);">Still loading the document… (${parts.length} of ${d.parts} parts received). It will complete by itself.</div>` : ""}
    </div>
    <div class="kb-find-bar" id="kbFindBar"><input type="text" id="kbFind" placeholder="Find in this document…" autocomplete="off"><span class="help-note" id="kbFindCnt"></span><button class="btn btn-ghost btn-sm" id="kbFindPrev" title="Previous (Shift+Enter)">↑</button><button class="btn btn-ghost btn-sm" id="kbFindNext" title="Next (Enter)">↓</button></div>
    <div class="kb-doc-grid"><nav class="kb-doc-toc" id="kbDocToc" aria-label="Contents"></nav>
      <div class="kb-doc-main"><div class="kb-body" id="kbBodyText">${kbDocRendered(d, parts)}</div></div></div>
    ${arts.length ? `<div class="kb-related"><div class="kb-sec-title">⚡ Short articles made from this document</div><div class="kb-related-list">${arts.map(a=>`<a href="#" class="kb-ilink" data-kbopen="${esc(a.id)}">${esc(a.title)}</a>`).join("")}</div></div>` : ""}
  </div>`;
}
function kbWireDoc(content){
  const $ = id => document.getElementById(id);
  $("kbBack").addEventListener("click", ()=>{ kbOpenDocId = null; render(); });
  $("kbTopBtn").addEventListener("click", ()=>{ const m = document.getElementById("main"); if(m) m.scrollTo ? m.scrollTo({top:0, behavior:"smooth"}) : (m.scrollTop = 0); });
  const body = $("kbBodyText");
  body.addEventListener("click", e=>{                                   // delegation: survives the find-highlighting rewrites
    const c = e.target.closest && e.target.closest(".kb-copy"); if(c){ kbCopy(c.dataset.copy); return; }
    const im = e.target.closest && e.target.closest(".kb-img"); if(im) openImageLightbox(im.src, im.alt);
    const il = e.target.closest && e.target.closest("[data-kbopen]"); if(il){ e.preventDefault(); kbOpenArticle(il.dataset.kbopen); }
  });
  content.querySelectorAll(".kb-related [data-kbopen]").forEach(el=> el.addEventListener("click", e=>{ e.preventDefault(); kbOpenArticle(el.dataset.kbopen); }));
  kbSetupReader(content, {doc:true});
}

/* ---------------- reader tools: contents, find-in-page, jump ---------------- */
let kbScrollFn = null;
function kbMarkDom(roots, terms){
  const re = kbHiRegex(terms, "ig"); if(!re) return [];
  const out = [];
  roots.forEach(root=>{
    if(!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = []; let n;
    while((n = w.nextNode())){ if(n.parentNode && /^(SCRIPT|STYLE|MARK)$/.test(n.parentNode.nodeName)) continue; nodes.push(n); }
    nodes.forEach(t=>{
      if(out.length >= 800) return;
      const txt = t.nodeValue; re.lastIndex = 0; if(!re.test(txt)) return; re.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0, m;
      while((m = re.exec(txt))){
        if(!m[0].length){ re.lastIndex++; continue; }
        if(m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
        const mk = document.createElement("mark"); mk.className = "kb-find"; mk.textContent = m[0]; frag.appendChild(mk); out.push(mk); last = m.index + m[0].length;
      }
      if(last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  });
  return out;
}
function kbSetupReader(root, o){
  o = o || {};
  const body = root.querySelector("#kbBodyText"); if(!body) return;
  const heads = Array.from(body.querySelectorAll(".kb-h")); heads.forEach((h,i)=>{ h.id = "kbh"+i; });
  const go = el=>{ if(!el) return; el.scrollIntoView({behavior:"smooth", block:"start"}); el.classList.remove("kb-flash"); void el.offsetWidth; el.classList.add("kb-flash"); };
  // contents
  if(o.doc){
    const toc = root.querySelector("#kbDocToc");
    if(toc){
      toc.innerHTML = heads.length ? `<div class="kb-toc-h">Contents</div>` + heads.map((h,i)=>`<button type="button" class="kb-toc-i l${Math.min(2, Number(h.tagName[1])-3)}" data-go="kbh${i}">${esc(h.textContent)}</button>`).join("") : `<div class="help-note">No headings in this document.</div>`;
      toc.querySelectorAll("[data-go]").forEach(b=> b.addEventListener("click", ()=> go(document.getElementById(b.dataset.go))));
    }
  } else if(heads.length >= 3){
    const nav = document.createElement("nav"); nav.className = "kb-toc";
    nav.innerHTML = `<span class="kb-toc-h">On this page:</span>` + heads.map((h,i)=>`<button type="button" class="kb-toc-chip" data-go="kbh${i}">${esc(h.textContent)}</button>`).join("");
    body.parentNode.insertBefore(nav, body);
    nav.querySelectorAll("[data-go]").forEach(b=> b.addEventListener("click", ()=> go(document.getElementById(b.dataset.go))));
  }
  // highlight which section you're reading (document view)
  const sc = document.getElementById("main");
  if(kbScrollFn && sc) sc.removeEventListener("scroll", kbScrollFn);
  kbScrollFn = null;
  if(o.doc && sc && heads.length){
    let tick = false;
    kbScrollFn = ()=>{ if(tick) return; tick = true; requestAnimationFrame(()=>{
      tick = false; let cur = -1;
      for(let i=0;i<heads.length;i++){ if(heads[i].getBoundingClientRect().top <= 140) cur = i; else break; }
      root.querySelectorAll(".kb-toc-i").forEach((b,i)=> b.classList.toggle("on", i===cur));
    }); };
    sc.addEventListener("scroll", kbScrollFn, {passive:true});
  }
  // find in page
  const bar = root.querySelector("#kbFindBar"), inp = root.querySelector("#kbFind"), cnt = root.querySelector("#kbFindCnt");
  if(!bar || !inp) return;
  const roots = ()=> [body, root.querySelector(".kb-quick-b")];
  let marks = [], idx = -1;
  const clear = ()=>{ roots().forEach(r=>{ if(r){ r.querySelectorAll("mark.kb-find").forEach(m=> m.replaceWith(document.createTextNode(m.textContent))); r.normalize(); } }); marks = []; idx = -1; };
  const show = i=>{
    if(!marks.length) return;
    idx = (i + marks.length) % marks.length;
    marks.forEach(m=> m.classList.remove("cur")); marks[idx].classList.add("cur");
    marks[idx].scrollIntoView({behavior:"smooth", block:"center"});
    cnt.textContent = (idx+1)+" of "+marks.length+(marks.length>=800?"+":"");
  };
  const run = (q, jump)=>{
    clear(); cnt.textContent = "";
    if(!q.trim()) return;
    marks = kbMarkDom(roots(), kbHiTerms(q));
    if(!marks.length){ cnt.textContent = "No matches"; return; }
    if(jump) show(0); else cnt.textContent = marks.length+" match"+(marks.length===1?"":"es");
  };
  const openBar = ()=>{ bar.style.display = "flex"; };
  const fb = root.querySelector("#kbFindBtn"); if(fb) fb.addEventListener("click", ()=>{ openBar(); inp.focus(); inp.select(); });
  let t = null;
  inp.addEventListener("input", ()=>{ clearTimeout(t); t = setTimeout(()=> run(inp.value, true), 160); });
  inp.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); if(!marks.length) run(inp.value, true); else show(idx + (e.shiftKey ? -1 : 1)); } else if(e.key==="Escape"){ inp.value = ""; clear(); cnt.textContent = ""; } });
  root.querySelector("#kbFindNext").addEventListener("click", ()=>{ if(!marks.length) run(inp.value, true); else show(idx+1); });
  root.querySelector("#kbFindPrev").addEventListener("click", ()=>{ if(!marks.length) run(inp.value, true); else show(idx-1); });
  // landing: a section to jump to and/or the words the person searched for
  const q = (o.doc ? kbJump.find : kbQuery) || "";
  const target = kbJump.anchor && (heads.find(h=>h.dataset.kbh===kbJump.anchor) || heads.find(h=>h.dataset.kbh && (h.dataset.kbh.indexOf(kbJump.anchor)===0 || kbJump.anchor.indexOf(h.dataset.kbh)===0)));
  if(q.trim()){ openBar(); inp.value = q; run(q, !target); }
  if(target) setTimeout(()=> go(target), 60);
  kbJump = {anchor:"", find:""};
}
