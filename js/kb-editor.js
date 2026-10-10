/* =========================================================
   Knowledge Base — authoring (Trainer / TL / SME / Quality / Admin)
     - Editor: form on the left, live preview of exactly what agents will read on the right.
     - Manage: every article incl. drafts/archived, with 👍/👎 counts and "review due" flags.
     - Feedback & requests: what agents said was missing/unclear + topics they asked for.
   ========================================================= */

let kbDraft = null;
let kbDirty = false;
let kbMgr = {lob:"all", status:"all", q:"", due:false};
let kbFbFilter = "open";

const KB_TEMPLATE = `## When to use this
Describe the situation / the question the agent is facing.

## Steps
1. First step
2. Second step
3. Third step

>! Watch out: the mistake agents most often make here.

## Disposition
\`Exact disposition text\`

## Escalate when
- The situation where the agent should involve a TL / supervisor
`;

function kbBlankDraft(prefill){
  const now = new Date().toISOString(), p = prefill || {};
  return {id:kbNewId("kb"), title:p.title||"", lob:p.lob||"", category:"", summary:"", body:"", tags:[], images:[], status:"draft", pinned:false,
    createdBy:currentUser.name, createdByUsername:currentUser.username||"", createdAt:now, updatedAt:now, updatedBy:currentUser.name, version:0, changeNote:"", reviewedAt:"",
    __new:true, __fromRequest:p.fromRequest||""};
}
function kbOpenEditor(id, prefill){
  if(!canManageKB()) return;
  if(id){ const a = kbById(id); if(!a || !canEditKB(a)) return; kbDraft = JSON.parse(JSON.stringify(a)); }
  else kbDraft = kbBlankDraft(prefill);
  kbDirty = false; kbView = "editor"; currentTab = "kb"; kbOpenId = null; render();
}
function kbDraftSize(){ try{ return JSON.stringify(kbDraft).length; }catch(e){ return 0; } }
function kbCategories(){ return Array.from(new Set((state.kbArticles||[]).map(a=>a.category).filter(Boolean))).sort(); }

function kbRenderEditor(content, topActions){
  topActions.innerHTML = "";
  if(content.querySelector('#kbRoot[data-editor="'+kbDraft.id+'"]')) return;   // don't rebuild while typing
  kbEdRender();
}
function kbEdRender(){
  const content = document.getElementById("content"), d = kbDraft;
  const lobs = LOB_OPTIONS, size = kbDraftSize();
  content.innerHTML = `
  <div class="kb-editor" id="kbRoot" data-editor="${esc(d.id)}">
    <div class="pkt-ed-top">
      <button class="btn btn-ghost btn-sm" id="kbEdBack">← Back</button>
      <div style="flex:1;font-family:'Space Grotesk',sans-serif;font-weight:700;">${d.__new?"New article":"Edit article"} <span class="badge ${d.status==="published"?"badge-green":"badge-gray"}">${esc(d.status)}</span></div>
      <span class="pkt-chip">${Math.round(size/1024)} KB / ${Math.round(KB_DOC_LIMIT/1024)} KB</span>
      <button class="btn btn-sm" id="kbEdSave">💾 Save${d.status==="published"?" changes":" draft"}</button>
      ${d.status==="published" ? `<button class="btn btn-ghost btn-sm" id="kbEdUnpub">Unpublish</button>` : `<button class="btn btn-accent btn-sm" id="kbEdPub">🚀 Publish</button>`}
    </div>
    <div class="kb-ed-grid">
      <div class="kb-ed-form">
        <div class="field"><label>Title <span style="color:var(--text-dim);font-weight:400;">— write it the way an agent would ask the question</span></label>
          <input type="text" id="kbTitle" maxlength="140" placeholder="e.g. How to handle a claim denied for timely filing" value="${esc(d.title)}"></div>
        <div class="kb-row">
          <div class="field"><label>Applies to</label><select id="kbLob"><option value="">General — all LOBs</option>${lobs.map(l=>`<option value="${esc(l)}" ${d.lob===l?"selected":""}>${esc(l)} only</option>`).join("")}</select></div>
          <div class="field"><label>Topic / category</label><input type="text" id="kbCatIn" list="kbCatList" maxlength="40" placeholder="e.g. Denials" value="${esc(d.category)}"><datalist id="kbCatList">${kbCategories().map(c=>`<option value="${esc(c)}">`).join("")}</datalist></div>
        </div>
        <div class="field"><label>⚡ Quick answer <span style="color:var(--text-dim);font-weight:400;">— 1–3 sentences an agent can act on right away</span></label>
          <textarea id="kbSummary" rows="3" maxlength="400" placeholder="The short answer. Agents see this first.">${esc(d.summary)}</textarea></div>
        <div class="field"><label>Details</label>
          <div class="kb-toolbar">
            <button type="button" data-ins="h">H</button><button type="button" data-ins="b"><b>B</b></button><button type="button" data-ins="ul">• List</button><button type="button" data-ins="ol">1. List</button>
            <button type="button" data-ins="note">ℹ️ Note</button><button type="button" data-ins="warn">⚠️ Warning</button><button type="button" data-ins="tip">💡 Tip</button>
            <button type="button" data-ins="code">&lt;/&gt; Copy text</button><button type="button" data-ins="table">▦ Table</button><button type="button" data-ins="link">🔗 Link</button>
            <button type="button" data-ins="ilink">[[ ]] Article link</button>
            <button type="button" id="kbTplBtn" title="Insert a standard layout">📋 Template</button></div>
          <textarea id="kbBody" rows="16" class="kb-body-in" placeholder="Steps, rules, examples… Use the buttons above for headings, lists, warnings and tables.">${esc(d.body)}</textarea>
          <div class="help-note">Tip: wrap anything an agent has to copy (a code, phone number, disposition) in backticks — one click copies it for them.</div></div>
        <div class="field"><label>Images <span style="color:var(--text-dim);font-weight:400;">— screenshots help; insert one into the details with its number</span></label>
          <div class="kb-imgs">${d.images.map((im,i)=>`<div class="kb-imgcard"><img src="${pktSafeImg(im.data)}" alt=""><div class="kb-imgnum">![${i+1}]</div>
            <input type="text" data-imgcap="${i}" placeholder="Caption" value="${esc(im.caption||"")}" maxlength="80">
            <div style="display:flex;gap:4px;"><button type="button" class="btn btn-ghost btn-sm" data-imgins="${i}">Insert</button><button type="button" class="btn btn-ghost btn-sm" data-imgrm="${i}">✕</button></div></div>`).join("")}
            <label class="kb-imgadd"><input type="file" id="kbImgIn" accept="image/*" hidden><span>🖼</span>Add image</label></div></div>
        <div class="field"><label>Search words / aliases <span style="color:var(--text-dim);font-weight:400;">— other ways agents might look for this, comma-separated</span></label>
          <input type="text" id="kbTags" placeholder="e.g. timely filing, TF, late claim, 90 days" value="${esc((d.tags||[]).join(", "))}"></div>
        <div class="kb-row">
          <div class="field"><label>What changed <span style="color:var(--text-dim);font-weight:400;">(shown for 2 weeks)</span></label><input type="text" id="kbChange" maxlength="140" placeholder="e.g. New limit effective 1 Nov" value="${esc(d.changeNote||"")}"></div>
          <div class="field"><label class="pkt-check" style="margin-top:22px;"><input type="checkbox" id="kbPinned" ${d.pinned?"checked":""}> 📌 Pin as a “Quick answer” on the home page</label></div>
        </div>
        ${d.__new ? "" : `<div style="margin-top:6px;"><button class="btn btn-danger btn-sm" id="kbEdDel">🗑 Delete article</button></div>`}
      </div>
      <div class="kb-ed-prev"><div class="kb-prev-label">Live preview — what agents will see</div><div class="kb-article" id="kbPrev"></div></div>
    </div>
  </div>`;
  kbPrevRefresh(); kbEdWire(content);
}
function kbPrevRefresh(){
  const d = kbDraft, el = document.getElementById("kbPrev"); if(!el) return;
  el.innerHTML = `<div class="kb-card-meta" style="margin:0 0 8px;">${kbLobBadge(d)}${d.category?`<span class="kb-cat-tag">${esc(d.category)}</span>`:""}</div>
    <h2 class="kb-art-title">${esc(d.title||"Untitled article")}</h2>
    ${d.summary ? `<div class="kb-quick"><div class="kb-quick-h">⚡ Quick answer</div><div class="kb-quick-b">${kbMd(d.summary, d).replace(/^<p>|<\/p>$/g,"")}</div></div>` : ""}
    <div class="kb-body">${d.body.trim() ? kbMd(d.body, d) : `<div class="help-note">Details will appear here as you type.</div>`}</div>
    ${(d.tags||[]).length ? `<div class="kb-tags">${d.tags.map(t=>`<span class="kb-tag">#${esc(t)}</span>`).join("")}</div>`:""}`;
  el.querySelectorAll(".kb-copy").forEach(c=> c.addEventListener("click", ()=> kbCopy(c.dataset.copy)));
  el.querySelectorAll(".kb-img").forEach(im=> im.addEventListener("click", ()=> openImageLightbox(im.src, im.alt)));
}
function kbInsert(kind){
  const ta = document.getElementById("kbBody"), v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s,e);
  const lineStart = v.lastIndexOf("\n", s-1)+1, atLine = s===lineStart;
  const pre = atLine ? "" : "\n";
  const map = {
    h: [pre+"## ", sel||"Heading", "\n"], b: ["**", sel||"bold text", "**"], code: ["`", sel||"text to copy", "`"],
    ul: [pre+"- ", sel||"item", "\n- "], ol: [pre+"1. ", sel||"step", "\n2. "],
    note: [pre+"> ", sel||"Helpful note", "\n"], warn: [pre+">! ", sel||"Important warning", "\n"], tip: [pre+">+ ", sel||"Handy tip", "\n"],
    table: [pre, "| Column A | Column B |\n|---|---|\n| value | value |", "\n"], link: ["[", sel||"link text", "](https://)"], ilink: ["[[", sel||"Exact article title", "]]"]
  }[kind];
  if(!map) return;
  ta.value = v.slice(0,s) + map[0] + map[1] + map[2] + v.slice(e);
  const a = s + map[0].length; ta.focus(); ta.setSelectionRange(a, a + map[1].length);
  kbDraft.body = ta.value; kbDirty = true; kbPrevRefresh();
}
function kbEdWire(content){
  const d = kbDraft, $ = id => document.getElementById(id);
  const touch = ()=>{ kbDirty = true; };
  $("kbEdBack").addEventListener("click", ()=>{
    const leave = ()=>{ kbDraft = null; kbView = "list"; render(); };
    if(kbDirty) showConfirm("Leave without saving your changes?", leave, "Discard changes"); else leave();
  });
  $("kbTitle").addEventListener("input", e=>{ d.title = e.target.value; touch(); kbPrevRefresh(); });
  $("kbLob").addEventListener("change", e=>{ d.lob = e.target.value; touch(); kbPrevRefresh(); });
  $("kbCatIn").addEventListener("input", e=>{ d.category = e.target.value.trim(); touch(); kbPrevRefresh(); });
  $("kbSummary").addEventListener("input", e=>{ d.summary = e.target.value; touch(); kbPrevRefresh(); });
  $("kbBody").addEventListener("input", e=>{ d.body = e.target.value; touch(); kbPrevRefresh(); });
  $("kbTags").addEventListener("input", e=>{ d.tags = e.target.value.split(",").map(t=>t.trim()).filter(Boolean).slice(0,20); touch(); kbPrevRefresh(); });
  $("kbChange").addEventListener("input", e=>{ d.changeNote = e.target.value; touch(); });
  $("kbPinned").addEventListener("change", e=>{ d.pinned = e.target.checked; touch(); });
  content.querySelectorAll("[data-ins]").forEach(b=> b.addEventListener("click", ()=> kbInsert(b.dataset.ins)));
  $("kbTplBtn").addEventListener("click", ()=>{
    const go = ()=>{ d.body = KB_TEMPLATE; $("kbBody").value = d.body; touch(); kbPrevRefresh(); };
    if(d.body.trim()) showConfirm("Replace what's in Details with the standard template?", go, "Replace"); else go();
  });
  const imgIn = $("kbImgIn");
  imgIn.addEventListener("change", async e=>{
    const f = e.target.files && e.target.files[0]; if(!f) return;
    try{
      const data = await pktImageToDataUrl(f);
      d.images.push({id:kbNewId("img"), data, caption:""});
      if(kbDraftSize() > KB_DOC_LIMIT){ d.images.pop(); showToast("That image would make the article too large to save. Try a smaller one."); return; }
      touch(); const keep = {body:d.body}; kbEdRender(); d.body = keep.body;
    }catch(err){ showToast(err.message || "Couldn't add that image."); }
  });
  content.querySelectorAll("[data-imgcap]").forEach(i=> i.addEventListener("input", e=>{ d.images[Number(i.dataset.imgcap)].caption = e.target.value; touch(); }));
  content.querySelectorAll("[data-imgins]").forEach(b=> b.addEventListener("click", ()=>{
    const ta = $("kbBody"), n = Number(b.dataset.imgins)+1, pos = ta.selectionStart, pre = (pos===0 || ta.value[pos-1]==="\n") ? "" : "\n";
    ta.value = ta.value.slice(0,pos) + pre + `![${n}]\n` + ta.value.slice(pos); d.body = ta.value; touch(); kbPrevRefresh();
  }));
  content.querySelectorAll("[data-imgrm]").forEach(b=> b.addEventListener("click", ()=>{
    const i = Number(b.dataset.imgrm);
    showConfirm("Remove this image? Any <b>![n]</b> markers in the details will need updating (later images shift up by one).", ()=>{ d.images.splice(i,1); touch(); kbEdRender(); }, "Remove");
  }));
  $("kbEdSave").addEventListener("click", ()=> kbSave(false));
  if($("kbEdPub")) $("kbEdPub").addEventListener("click", ()=> kbSave(true));
  if($("kbEdUnpub")) $("kbEdUnpub").addEventListener("click", ()=>{ d.status = "draft"; kbSave(false, true); });
  if($("kbEdDel")) $("kbEdDel").addEventListener("click", ()=> kbDelete(kbById(d.id), true));
}
function kbSave(publish, keepStatus){
  const d = kbDraft;
  const probs = [];
  if(!d.title.trim()) probs.push("Give the article a title.");
  if(publish){
    if(!d.summary.trim() && !d.body.trim()) probs.push("Add a quick answer or some details before publishing.");
  }
  if(kbDraftSize() > KB_DOC_LIMIT) probs.push("This article is too large to save — remove or shrink some images.");
  if(probs.length){ showToast("⚠ " + probs[0]); return false; }
  const wasPublished = d.status==="published";
  if(publish) d.status = "published";
  const now = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(d));
  const fromReq = copy.__fromRequest; delete copy.__new; delete copy.__fromRequest;
  copy.title = copy.title.trim(); copy.updatedAt = now; copy.updatedBy = currentUser.name; copy.version = (copy.version||0)+1;
  if(copy.status==="published") copy.reviewedAt = now;     // saving a published article counts as a review
  if(!state.kbArticles) state.kbArticles = [];
  const i = state.kbArticles.findIndex(a=>a.id===copy.id);
  if(i>=0) state.kbArticles[i] = copy; else state.kbArticles.push(copy);
  if(fromReq && copy.status==="published"){
    const f = (state.kbFeedback||[]).find(x=>x.id===fromReq);
    if(f){ f.status = "done"; f.resolvedArticleId = copy.id; f.updatedAt = now; }
  }
  logAudit(publish && !wasPublished ? "kb_publish" : "kb_update", `${publish && !wasPublished ? "Published" : "Saved"} Knowledge Base article "${copy.title}" (${copy.lob||"General"})`, {});
  saveState();
  kbDirty = false; kbDraft = null; kbView = "list"; kbSubTab = "manage";
  showToast(copy.status==="published" ? "✅ Published — agents can find it now" : "Saved as draft");
  render(); return true;
}
function kbDelete(a, fromEditor){
  if(!a) return;
  showConfirm(`Delete “${esc(a.title)}”? This can't be undone. (To just hide it, use Unpublish or Archive instead.)`, ()=>{
    state.kbArticles = state.kbArticles.filter(x=>x.id!==a.id);
    state.kbFeedback = (state.kbFeedback||[]).filter(f=>f.articleId!==a.id);
    logAudit("kb_delete", `Deleted Knowledge Base article "${a.title}"`, {});
    if(fromEditor){ kbDraft = null; kbDirty = false; kbView = "list"; kbSubTab = "manage"; }
    saveState(); render();
  }, "Delete");
}

/* ---------------- manage ---------------- */
function kbManageRows(){
  const f = kbMgr, q = f.q.trim().toLowerCase();
  return (state.kbArticles||[]).filter(a=>{
    if(f.lob!=="all" && (a.lob||"")!==f.lob) return false;
    if(f.status!=="all" && a.status!==f.status) return false;
    if(f.due && !(a.status==="published" && kbDaysSince(a.reviewedAt||a.updatedAt) > KB_REVIEW_DAYS)) return false;
    if(q && !`${a.title} ${a.category} ${(a.tags||[]).join(" ")}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function kbManageHtml(){
  const all = state.kbArticles||[], rows = kbManageRows();
  const due = all.filter(a=>a.status==="published" && kbDaysSince(a.reviewedAt||a.updatedAt) > KB_REVIEW_DAYS).length;
  const sel = (id, label, opts, val)=>`<select class="week-select" id="${id}"><option value="all">${label}</option>${opts.map(o=>`<option value="${esc(o[0])}" ${val===o[0]?"selected":""}>${esc(o[1])}</option>`).join("")}</select>`;
  const body = rows.map(a=>{
    const st = kbVoteStats(a.id), days = kbDaysSince(a.reviewedAt||a.updatedAt), isDue = a.status==="published" && days > KB_REVIEW_DAYS;
    const mine = canEditKB(a);
    return `<tr data-id="${esc(a.id)}"><td><b>${a.pinned?"📌 ":""}${esc(a.title||"(untitled)")}</b><div class="help-note">${esc(a.category||"—")}</div></td>
      <td>${kbLobBadge(a)}</td>
      <td>${a.status==="published"?`<span class="badge badge-green">Published</span>`:a.status==="archived"?`<span class="badge badge-gray">Archived</span>`:`<span class="badge badge-yellow">Draft</span>`}</td>
      <td>${esc(fmtDate((a.updatedAt||"").slice(0,10)))}<div class="help-note">${esc(a.updatedBy||"")}</div></td>
      <td>${a.status==="published" ? (isDue ? `<span class="badge badge-red" title="Last reviewed ${days} days ago">Review due</span>` : `<span class="badge badge-green">${days}d ago</span>`) : "—"}</td>
      <td class="num">👍 ${st.up} · 👎 ${st.down}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost btn-sm" data-act="open">👁 View</button>
        ${mine ? `<button class="btn btn-ghost btn-sm" data-act="edit">✏️ Edit</button>` : ""}
        ${mine && isDue ? `<button class="btn btn-ghost btn-sm" data-act="reviewed" title="Confirm it's still accurate">✓ Still correct</button>` : ""}
        ${mine && a.status==="published" ? `<button class="btn btn-ghost btn-sm" data-act="archive">📦 Archive</button>` : ""}
        ${mine && a.status!=="published" ? `<button class="btn btn-ghost btn-sm" data-act="publish">🚀 Publish</button>` : ""}
        <button class="btn btn-ghost btn-sm" data-act="dup" title="Duplicate">⧉</button>
        ${mine ? `<button class="btn btn-ghost btn-sm" data-act="del" title="Delete">🗑</button>` : ""}
      </td></tr>`;
  }).join("");
  return `<div class="section"><div class="section-head" style="flex-wrap:wrap;gap:8px;"><div class="section-title">All articles (${all.length})</div>
      <div class="section-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
        ${sel("kbMLob","All LOBs",[["","General"]].concat(LOB_OPTIONS.map(l=>[l,l])),kbMgr.lob)}
        ${sel("kbMStatus","All statuses",[["published","Published"],["draft","Draft"],["archived","Archived"]],kbMgr.status)}
        <label class="pkt-check" style="margin:0!important;align-items:center;"><input type="checkbox" id="kbMDue" ${kbMgr.due?"checked":""}> Review due${due?` (${due})`:""}</label>
        <input type="text" class="week-select" id="kbMSearch" placeholder="🔍 Search…" value="${esc(kbMgr.q)}" style="width:150px;"></div></div>
    <div class="section-body">${rows.length ? `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Article</th><th>Audience</th><th>Status</th><th>Updated</th><th>Reviewed</th><th class="num">Feedback</th><th></th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="help-note" style="margin-top:8px;">Articles not reviewed for ${KB_REVIEW_DAYS}+ days are flagged. Agents see a “may be outdated” warning after ${KB_STALE_DAYS} days, so click <b>Still correct</b> when you've re-checked one.</div>`
      : `<div class="help-note" style="padding:10px 2px;">${all.length ? "No articles match these filters." : "No articles yet — use “＋ New article”."}</div>`}</div></div>`;
}
function kbWireManage(content){
  [["kbMLob","lob"],["kbMStatus","status"]].forEach(([id,k])=>{ const el = document.getElementById(id); if(el) el.addEventListener("change", e=>{ kbMgr[k] = e.target.value; render(); }); });
  const due = document.getElementById("kbMDue"); if(due) due.addEventListener("change", e=>{ kbMgr.due = e.target.checked; render(); });
  const s = document.getElementById("kbMSearch"); if(s) s.addEventListener("input", e=>{ kbMgr.q = e.target.value; render(); });
  content.querySelectorAll("tr[data-id] [data-act]").forEach(b=> b.addEventListener("click", ()=>{
    const a = kbById(b.closest("tr").dataset.id); if(!a) return;
    const act = b.dataset.act, now = new Date().toISOString();
    if(act==="open"){ kbOpenId = a.id; kbSubTab = "browse"; render(); }
    else if(act==="edit") kbOpenEditor(a.id);
    else if(act==="reviewed"){ a.reviewedAt = now; a.updatedAt = now; saveState(); showToast("✓ Marked as reviewed"); render(); }
    else if(act==="archive"){ a.status = "archived"; a.updatedAt = now; saveState(); render(); showToast("Archived — hidden from agents"); }
    else if(act==="publish"){ kbOpenEditor(a.id); }
    else if(act==="dup"){
      const c = JSON.parse(JSON.stringify(a)); c.id = kbNewId("kb"); c.title += " (copy)"; c.status = "draft"; c.pinned = false; c.version = 0;
      c.createdBy = currentUser.name; c.createdByUsername = currentUser.username||""; c.createdAt = c.updatedAt = now; c.reviewedAt = "";
      state.kbArticles.push(c); saveState(); render(); showToast("Duplicated as a draft");
    } else if(act==="del") kbDelete(a);
  }));
}

/* ---------------- feedback & requests ---------------- */
function kbFeedbackItems(){
  return (state.kbFeedback||[]).filter(f=> f.type==="request" || (f.type==="vote" && f.value<0))
    .filter(f=> kbFbFilter==="all" || f.status===kbFbFilter)
    .sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
}
function kbFeedbackHtml(){
  const items = kbFeedbackItems();
  const rows = items.map(f=>{
    const art = f.articleId && kbById(f.articleId);
    const isReq = f.type==="request";
    return `<div class="kb-fbitem" data-id="${esc(f.id)}">
      <div class="kb-fbitem-top"><span class="badge ${isReq?"badge-yellow":"badge-red"}">${isReq?"Topic request":"👎 Not helpful"}</span>
        ${f.status==="done"?`<span class="badge badge-green">Resolved</span>`:""}
        <span class="help-note">${esc(f.name||"Someone")} · ${esc(f.lob||"—")} · ${esc(fmtDate((f.createdAt||"").slice(0,10)))}</span></div>
      <div class="kb-fbitem-text">${isReq ? esc(f.text) : `On <b>${esc(f.articleTitle||"")}</b>${f.comment?`: “${esc(f.comment)}”`:" (no comment)"}`}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        ${art ? `<button class="btn btn-ghost btn-sm" data-act="viewart">👁 Open article</button>${canEditKB(art)?`<button class="btn btn-ghost btn-sm" data-act="editart">✏️ Fix article</button>`:""}` : ""}
        ${isReq && f.status==="open" ? `<button class="btn btn-accent btn-sm" data-act="create">＋ Write article</button>` : ""}
        ${f.status==="open" ? `<button class="btn btn-ghost btn-sm" data-act="resolve">✓ Mark resolved</button>` : `<button class="btn btn-ghost btn-sm" data-act="reopen">Reopen</button>`}
        <button class="btn btn-ghost btn-sm" data-act="del" title="Delete">🗑</button></div></div>`;
  }).join("");
  return `<div class="section"><div class="section-head"><div class="section-title">Feedback &amp; topic requests</div>
      <div class="section-actions"><select class="week-select" id="kbFbSel"><option value="open" ${kbFbFilter==="open"?"selected":""}>Open</option><option value="done" ${kbFbFilter==="done"?"selected":""}>Resolved</option><option value="all" ${kbFbFilter==="all"?"selected":""}>All</option></select></div></div>
    <div class="section-body">${items.length ? rows : `<div class="empty-state" style="padding:26px 16px;text-align:center;"><div class="big">🎉</div><p>${kbFbFilter==="open" ? "Nothing waiting — agents' doubts are all covered." : "Nothing here."}</p></div>`}
    <div class="help-note" style="margin-top:8px;">This is where the knowledge base improves: every “Not helpful” vote and every topic an agent couldn't find lands here.</div></div></div>`;
}
function kbWireFeedback(content){
  const sel = document.getElementById("kbFbSel"); if(sel) sel.addEventListener("change", e=>{ kbFbFilter = e.target.value; render(); });
  content.querySelectorAll(".kb-fbitem [data-act]").forEach(b=> b.addEventListener("click", ()=>{
    const f = (state.kbFeedback||[]).find(x=>x.id===b.closest(".kb-fbitem").dataset.id); if(!f) return;
    const act = b.dataset.act, now = new Date().toISOString();
    if(act==="viewart"){ kbOpenId = f.articleId; kbSubTab = "browse"; render(); }
    else if(act==="editart") kbOpenEditor(f.articleId);
    else if(act==="create") kbOpenEditor(null, {title:f.text.slice(0,120), lob:f.lob||"", fromRequest:f.id});
    else if(act==="resolve"){ f.status = "done"; f.updatedAt = now; saveState(); render(); }
    else if(act==="reopen"){ f.status = "open"; f.updatedAt = now; saveState(); render(); }
    else if(act==="del"){ state.kbFeedback = state.kbFeedback.filter(x=>x.id!==f.id); saveState(); render(); }
  }));
}
