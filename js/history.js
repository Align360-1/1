/* ---------------- PROCESS UPDATES ---------------- */
/* Rich text for update details: only bold / italic / underline / line breaks / font size survive.
   Everything else (scripts, links, event handlers, styles, colours...) is stripped, both when posting
   and again when rendering, since the text is stored in Firestore and shown to everyone. */
const PU_FONT_PX = {1:10, 2:12, 3:13, 4:16, 5:18, 6:24, 7:32};
function sanitizeRichHtml(html){
  const doc = new DOMParser().parseFromString("<body>"+String(html||"")+"</body>", "text/html");
  const out = document.createElement("div");
  const walk = (src, dst)=>{
    src.childNodes.forEach(n=>{
      if(n.nodeType===3){ dst.appendChild(document.createTextNode(n.nodeValue)); return; }
      if(n.nodeType!==1) return;
      const t = n.tagName.toLowerCase();
      let el = null;
      if(t==="b"||t==="strong") el = document.createElement("b");
      else if(t==="i"||t==="em") el = document.createElement("i");
      else if(t==="u") el = document.createElement("u");
      else if(t==="br") { dst.appendChild(document.createElement("br")); return; }
      else if(t==="div"||t==="p") el = document.createElement("div");
      else if(t==="font" || t==="span"){
        const px = t==="font" ? PU_FONT_PX[parseInt(n.getAttribute("size"),10)] : null;
        const m = t==="span" && /font-size\s*:\s*(\d{1,2})px/i.exec(n.getAttribute("style")||"");
        const size = px || (m && Math.min(40, Math.max(9, +m[1])));
        const w = /font-weight\s*:\s*(bold|[6-9]00)/i.test(n.getAttribute("style")||"");
        const it = /font-style\s*:\s*italic/i.test(n.getAttribute("style")||"");
        const ul = /text-decoration[^;]*underline/i.test(n.getAttribute("style")||"");
        let cur = dst;
        if(w){ const b=document.createElement("b"); cur.appendChild(b); cur=b; }
        if(it){ const i=document.createElement("i"); cur.appendChild(i); cur=i; }
        if(ul){ const u=document.createElement("u"); cur.appendChild(u); cur=u; }
        if(size){ const sp=document.createElement("span"); sp.style.fontSize=size+"px"; cur.appendChild(sp); cur=sp; }
        walk(n, cur); return;
      }
      else if(["script","style","iframe","object","embed"].includes(t)) return; // drop with content
      else { walk(n, dst); return; } // unknown tag: keep its text only
      dst.appendChild(el); walk(n, el);
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}
function richToPlain(html){
  const d = document.createElement("div");
  d.innerHTML = sanitizeRichHtml(html).replace(/<br\s*\/?>/gi,"\n").replace(/<div>/gi,"\n");
  return (d.textContent||"").replace(/\n{3,}/g,"\n\n").trim();
}
// What the card shows: the rich version when there is one, else the old plain text (escaped).
function updateBodyHtml(u){ return u.messageHtml ? sanitizeRichHtml(u.messageHtml) : esc(u.message); }
let processUpdateSearch = "";
let expandedUpdateIds = new Set();
let puLOBFilter = "all"; // manager-side browse filter, "all" | "" (All LOBs posts) | one of LOB_OPTIONS

// Entries an Agent is allowed to see: posted as "All LOBs" (u.lob === ""), or
// matching their own roster LOB. Same gating shape as Documentation template.
function agentVisibleProcessUpdates(updates){
  if(!isAgent()) return updates;
  const lob = agentLOB(currentUser.empId);
  return updates.filter(u=> !u.lob || u.lob === lob);
}

// ---- "New" badge read-state (per logged-in user, kept in this browser's
// localStorage — same pattern as notifGrantedKey/userViewKey elsewhere) ----
// Once a user opens an update the badge should disappear for good, not just
// while it's expanded, so this is tracked separately from expandedUpdateIds
// (which is just in-memory expand/collapse UI state).
function readUpdatesKey(){
  const key = userViewKey();
  return key ? ("a360_read_updates_"+key) : null;
}
function loadReadUpdateIds(){
  const key = readUpdatesKey();
  if(!key) return new Set();
  try{
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  }catch(e){ return new Set(); }
}
function markUpdateRead(id){
  const key = readUpdatesKey();
  if(!key) return;
  const ids = loadReadUpdateIds();
  if(ids.has(id)) return;
  ids.add(id);
  try{ localStorage.setItem(key, JSON.stringify(Array.from(ids))); }catch(e){}
}

// Full sort order used everywhere: pinned first, then by orderIndex descending
// (higher orderIndex = higher up). orderIndex defaults to postedAt's timestamp
// so freshly-posted updates land on top same as before — manually moving an
// update up/down just overwrites orderIndex on the two swapped entries.
function sortProcessUpdates(updates){
  return updates.slice().sort((a,b)=>{
    if(!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.orderIndex||0) - (a.orderIndex||0);
  });
}

// Moves an update up/down one slot within its own pin group (pinned items only
// reorder against other pinned items, unpinned against other unpinned) — using
// the FULL unfiltered/unsearched list, so reordering still works correctly even
// while a search or LOB filter is narrowing what's currently on screen.
function moveProcessUpdate(id, direction){
  const all = sortProcessUpdates((state.processUpdates||[]).filter(u=>!u.archived));
  const group = all.filter(u=> !!u.pinned === !!(all.find(x=>x.id===id)||{}).pinned);
  const idx = group.findIndex(u=>u.id===id);
  if(idx===-1) return;
  const swapIdx = direction==="up" ? idx-1 : idx+1;
  if(swapIdx<0 || swapIdx>=group.length) return;
  const a = group[idx], b = group[swapIdx];
  const tmp = a.orderIndex||0;
  a.orderIndex = b.orderIndex||0;
  b.orderIndex = tmp;
  // Equal orderIndex values (legacy entries) would produce a no-op swap — nudge
  // apart by 1ms so the move is always visible.
  if(a.orderIndex === b.orderIndex){
    if(direction==="up") a.orderIndex += 1; else b.orderIndex += 1;
  }
  saveState(); render();
}

function processUpdatesSectionHtml(){
  const q = processUpdateSearch.trim().toLowerCase();
  let updates = (state.processUpdates||[]).filter(u=>!u.archived);
  updates = sortProcessUpdates(updates);
  updates = agentVisibleProcessUpdates(updates);
  const totalCount = updates.length;
  if(!isAgent() && puLOBFilter !== "all"){
    updates = updates.filter(u=> (u.lob||"") === puLOBFilter);
  }
  if(q){
    updates = updates.filter(u=> ((u.title||"")+" "+(u.message||"")+" "+(u.postedBy||"")).toLowerCase().indexOf(q)!==-1);
  }
  const pinGroupFull = sortProcessUpdates((state.processUpdates||[]).filter(u=>!u.archived));
  const readIds = loadReadUpdateIds();
  const itemsHtml = updates.length ? updates.map(u=>{
    const withinNewWindow = u.postedAt && (Date.now() - new Date(u.postedAt).getTime()) < 7*24*60*60*1000;
    const isNew = withinNewWindow && !readIds.has(u.id);
    const isOpen = expandedUpdateIds.has(u.id);
    const groupList = pinGroupFull.filter(x=> !!x.pinned === !!u.pinned);
    const posInGroup = groupList.findIndex(x=>x.id===u.id);
    const canMoveUp = posInGroup > 0;
    const canMoveDown = posInGroup !== -1 && posInGroup < groupList.length-1;
    return `<div class="update-card${u.pinned?' pinned':''}${isOpen?' expanded':''}" data-id="${esc(u.id)}" style="cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            ${u.pinned ? `<span class="badge badge-yellow">📌 Pinned</span>` : ""}
            ${isNew ? `<span class="badge badge-green">New</span>` : ""}
            <span class="badge badge-gray">${esc(u.lob||"All LOBs")}</span>
            <b style="font-size:13px;">${esc(u.title)}</b>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);white-space:pre-wrap;line-height:1.5;${isOpen ? "" : "overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;"}">${updateBodyHtml(u)}</div>
          ${isOpen && u.attachments && u.attachments.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            ${u.attachments.map(a=> (a.type||"").startsWith("image/")
              ? `<img src="${a.dataUrl}" data-lightbox-src="${a.dataUrl}" data-lightbox-name="${esc(a.name)}" title="${esc(a.name)}" class="attachment-thumb" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:zoom-in;" onclick="event.stopPropagation();openImageLightbox(this.dataset.lightboxSrc,this.dataset.lightboxName);">`
              : `<a href="${a.dataUrl}" download="${esc(a.name)}" class="badge badge-gray" style="text-decoration:none;" onclick="event.stopPropagation();">📄 ${esc(a.name)}</a>`
            ).join("")}
          </div>` : (!isOpen && u.attachments && u.attachments.length ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">📎 ${u.attachments.length} attachment${u.attachments.length>1?'s':''}</div>` : "")}
          <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">By ${esc(u.postedBy||"Team Leader")} · ${u.postedAt ? new Date(u.postedAt).toLocaleString() : ""}</div>
        </div>
        ${canPinProcessUpdate() ? `<div style="display:flex;gap:4px;flex-shrink:0;">
          ${canManageProcessUpdates() ? `<button class="icon-btn move-update-btn" data-id="${esc(u.id)}" data-dir="up" title="Move up" ${canMoveUp?"":"disabled"}>▲</button>
          <button class="icon-btn move-update-btn" data-id="${esc(u.id)}" data-dir="down" title="Move down" ${canMoveDown?"":"disabled"}>▼</button>` : ""}
          <button class="icon-btn pin-update-btn" data-id="${esc(u.id)}" title="${u.pinned ? 'Unpin' : 'Pin to top'}">${u.pinned ? '📌' : '📍'}</button>
          ${canManageProcessUpdates() ? `<button class="icon-btn del-update-btn" data-id="${esc(u.id)}" title="Archive update">✕</button>` : ""}
        </div>` : ""}
      </div>
    </div>`;
  }).join("") : `<div class="empty-state" style="padding:20px;"><p>${q ? "No updates match your search." : `No process updates posted yet.${canManageProcessUpdates() ? ' Post one and it shows up here for everyone, TLs and agents alike.' : ''}`}</p></div>`;

  const lobFilterHtml = !isAgent() ? `
    <select class="week-select" id="puLOBSel" style="font-size:12px;">
      <option value="all" ${puLOBFilter==='all'?'selected':''}>All LOBs (browse)</option>
      <option value="" ${puLOBFilter===''?'selected':''}>Posted as "All LOBs" only</option>
      ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${puLOBFilter===l?'selected':''}>${esc(l)}</option>`).join("")}
    </select>` : "";

  return `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">📢</span>Process Updates</div>
        <div class="section-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          ${lobFilterHtml}
          ${canManageProcessUpdates() ? `<button class="btn btn-accent btn-sm" id="postUpdateBtn">+ Post update</button>` : ""}
        </div>
      </div>
      ${totalCount ? `<div class="section-body" style="padding-bottom:0;">
        <input type="text" id="processUpdateSearchInput" class="history-search" placeholder="🔍 Search by title, details, or who posted it..." value="${esc(processUpdateSearch)}" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px;font-size:12.5px;box-sizing:border-box;font-family:inherit;">
      </div>` : ""}
      <div class="section-body" style="display:flex;flex-direction:column;gap:10px;">
        ${itemsHtml}
      </div>
    </div>`;
}
function openPostUpdateModal(){
  const overlay = showModal(`
    <div class="modal-title">Post a process update</div>
    <div class="field"><label>LOB</label>
      <select id="upLOB" style="width:100%;">
        <option value="">All LOBs</option>
        ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("")}
      </select>
      <div class="help-note">"All LOBs" is visible to every agent. Picking a specific LOB scopes it to agents assigned to that LOB only.</div>
    </div>
    <div class="field"><label>Title</label><input type="text" id="upTitle" placeholder="e.g. New QA scoring rubric effective Monday"></div>
    <div class="field"><label>Details</label>
      <div class="rt-toolbar" id="upToolbar">
        <button type="button" class="rt-btn" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" class="rt-btn" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
        <button type="button" class="rt-btn" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <span class="rt-sep"></span>
        <button type="button" class="rt-btn" data-size="-1" title="Decrease font size">A−</button>
        <button type="button" class="rt-btn" data-size="1" title="Increase font size" style="font-size:15px;">A+</button>
        <select class="rt-size" id="upSizeSel" title="Font size">
          <option value="2">Small</option><option value="3" selected>Normal</option><option value="5">Large</option><option value="6">Extra large</option>
        </select>
        <span class="rt-sep"></span>
        <button type="button" class="rt-btn" data-cmd="removeFormat" title="Clear formatting">Tx</button>
      </div>
      <div id="upMessage" class="rt-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="What's changing and what agents need to do... (select text and press Ctrl+B / Ctrl+I / Ctrl+U to format)"></div>
    </div>
    <div class="field">
      <label>Attachments (optional)</label>
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button type="button" class="btn btn-ghost btn-sm" id="upAttachDocBtn">📎 Upload Document</button>
        <button type="button" class="btn btn-ghost btn-sm" id="upAttachPhotoBtn">📷 Add Photo</button>
      </div>
      <input type="file" id="upDocInput" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,image/*" style="display:none;">
      <input type="file" id="upPhotoInput" accept="image/*" capture="environment" style="display:none;">
      <div id="upAttachList" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div class="help-note">Keep files under ~250KB each, up to 3 per update — they're stored with the update for everyone to see.</div>
    </div>
    <div class="field"><label>Posted by (optional)</label><input type="text" id="upPostedBy" value="${esc((currentUser&&currentUser.name)||'')}" placeholder="Your name"></div>
    <label class="check-row"><input type="checkbox" id="upPinned"> Pin to top</label>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="upCancel">Cancel</button>
      <button class="btn btn-accent" id="upSave">Post update</button>
    </div>
  `);
  let upAttachments = []; // {name, type, dataUrl, size}
  function renderAttachList(){
    const wrap = document.getElementById("upAttachList");
    if(!wrap) return;
    wrap.innerHTML = upAttachments.map((a,i)=>`
      <div style="display:flex;align-items:center;gap:8px;font-size:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:5px 8px;">
        ${a.type.startsWith("image/") ? `<img src="${a.dataUrl}" style="width:26px;height:26px;object-fit:cover;border-radius:3px;flex-shrink:0;">` : `<span style="flex-shrink:0;">📄</span>`}
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.name)}</span>
        <button type="button" class="icon-btn" data-i="${i}" title="Remove">✕</button>
      </div>`).join("");
    wrap.querySelectorAll("button[data-i]").forEach(btn=>{
      btn.addEventListener("click", ()=>{ upAttachments.splice(Number(btn.dataset.i),1); renderAttachList(); });
    });
  }
  function handleAttachFile(file){
    if(!file) return;
    if(upAttachments.length>=3){ showToast("⚠ Up to 3 attachments per update"); return; }
    if(file.size > 250*1024){ showToast("⚠ That file is too large — please keep attachments under ~250KB"); return; }
    const reader = new FileReader();
    reader.onload = ()=>{
      upAttachments.push({name:file.name, type:file.type||"application/octet-stream", dataUrl:reader.result, size:file.size});
      renderAttachList();
    };
    reader.onerror = ()=> showToast("⚠ Could not read that file");
    reader.readAsDataURL(file);
  }
  overlay.querySelector("#upAttachDocBtn").addEventListener("click", ()=> overlay.querySelector("#upDocInput").click());
  overlay.querySelector("#upAttachPhotoBtn").addEventListener("click", ()=> overlay.querySelector("#upPhotoInput").click());
  overlay.querySelector("#upDocInput").addEventListener("change", e=>{ handleAttachFile(e.target.files[0]); e.target.value=""; });
  overlay.querySelector("#upPhotoInput").addEventListener("change", e=>{ handleAttachFile(e.target.files[0]); e.target.value=""; });
  // ---- rich text editor ----
  const rtEd = overlay.querySelector("#upMessage"), rtBar = overlay.querySelector("#upToolbar"), rtSel = overlay.querySelector("#upSizeSel");
  const rtRefresh = ()=>{
    rtBar.querySelectorAll("[data-cmd]").forEach(b=>{
      let on = false; try{ on = ["bold","italic","underline"].includes(b.dataset.cmd) && document.queryCommandState(b.dataset.cmd); }catch(e){}
      b.classList.toggle("on", !!on);
    });
  };
  const rtSize = n=>{ rtEd.focus(); document.execCommand("fontSize", false, String(Math.min(7, Math.max(1, n)))); rtRefresh(); };
  // Un-sized text is "Normal" (3); the browser would report its raw pixel size instead, so only trust an explicit size.
  const rtCurSize = ()=>{
    const sl = window.getSelection(); if(!sl || !sl.anchorNode) return 3;
    const n = sl.anchorNode.nodeType===1 ? sl.anchorNode : sl.anchorNode.parentElement;
    const f = n && n.closest && n.closest("font[size]");
    return f && rtEd.contains(f) ? (parseInt(f.getAttribute("size"),10) || 3) : 3;
  };
  rtBar.addEventListener("mousedown", e=>{ if(e.target.closest("button")) e.preventDefault(); }); // keep the selection
  rtBar.addEventListener("click", e=>{
    const b = e.target.closest("button"); if(!b) return;
    rtEd.focus();
    if(b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null);
    else if(b.dataset.size) rtSize(rtCurSize() + Number(b.dataset.size));
    rtRefresh();
  });
  rtSel.addEventListener("change", ()=>{ rtSize(Number(rtSel.value)); });
  rtEd.addEventListener("keydown", e=>{
    if(!(e.ctrlKey||e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const cmd = {b:"bold", i:"italic", u:"underline"}[k];
    if(cmd){ e.preventDefault(); document.execCommand(cmd, false, null); rtRefresh(); }
  });
  // paste as plain text so formatting from Word/web pages can't sneak in
  rtEd.addEventListener("paste", e=>{
    e.preventDefault();
    const t = (e.clipboardData||window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, t);
  });
  const rtSelChange = ()=>{ if(document.activeElement===rtEd){ rtRefresh(); const v=rtCurSize(); rtSel.value = [2,3,5,6].includes(v)?String(v):(v<3?"2":v===4?"3":"6"); } };
  document.addEventListener("selectionchange", rtSelChange);
  const rtObs = new MutationObserver(()=>{ if(!document.body.contains(rtEd)){ document.removeEventListener("selectionchange", rtSelChange); rtObs.disconnect(); } });
  rtObs.observe(document.body, {childList:true, subtree:true});
  try{ document.execCommand("styleWithCSS", false, false); }catch(e){}
  overlay.querySelector("#upCancel").addEventListener("click", closeModal);
  overlay.querySelector("#upSave").addEventListener("click", ()=>{
    const lob = document.getElementById("upLOB").value;
    const title = document.getElementById("upTitle").value.trim();
    const messageHtml = sanitizeRichHtml(document.getElementById("upMessage").innerHTML);
    const message = richToPlain(messageHtml);
    const postedBy = document.getElementById("upPostedBy").value.trim();
    const pinned = document.getElementById("upPinned").checked;
    if(!title || !message){ showToast("Enter a title and details"); return; }
    if(!state.processUpdates) state.processUpdates = [];
    state.processUpdates.push({
      id: "upd"+Date.now(),
      lob, title, message, messageHtml,
      postedBy: postedBy || "Team Leader",
      postedAt: new Date().toISOString(),
      orderIndex: Date.now(),
      pinned,
      attachments: upAttachments
    });
    saveState(); closeModal(); render();
    showToast(lob ? `✅ Update posted — visible to ${lob} agents` : "✅ Update posted — visible to everyone now");
  });
}
function toggleUpdateExpanded(id){
  if(expandedUpdateIds.has(id)) expandedUpdateIds.delete(id);
  else expandedUpdateIds.add(id);
  // Opening it (in either direction of the toggle) counts as "read" — the New
  // badge shouldn't come back just because the card gets collapsed again.
  markUpdateRead(id);
}

// Count of updates that would currently show the green "New" pill for this
// user (visible to them, not archived, within the 7-day New window, not yet
// opened) — drives the nav badge on the Process Update tab.
function unreadProcessUpdateCount(){
  const readIds = loadReadUpdateIds();
  const visible = agentVisibleProcessUpdates((state.processUpdates||[]).filter(u=>!u.archived));
  return visible.reduce((n,u)=>{
    const withinNewWindow = u.postedAt && (Date.now() - new Date(u.postedAt).getTime()) < 7*24*60*60*1000;
    return (withinNewWindow && !readIds.has(u.id)) ? n+1 : n;
  }, 0);
}

function wireProcessUpdateListeners(content){
  const postBtn = document.getElementById("postUpdateBtn");
  if(postBtn) postBtn.addEventListener("click", openPostUpdateModal);

  const lobSel = document.getElementById("puLOBSel");
  if(lobSel) lobSel.addEventListener("change", e=>{
    puLOBFilter = e.target.value;
    renderProcessUpdate(content, window.__topActionsEl || content.parentElement.querySelector(".top-actions"));
  });

  const searchInput = document.getElementById("processUpdateSearchInput");
  if(searchInput){
    searchInput.addEventListener("input", ()=>{
      processUpdateSearch = searchInput.value;
      const pos = searchInput.selectionStart;
      renderProcessUpdate(content, window.__topActionsEl || content.parentElement.querySelector(".top-actions"));
      const freshInput = document.getElementById("processUpdateSearchInput");
      if(freshInput){ freshInput.focus(); freshInput.setSelectionRange(pos,pos); }
    });
  }

  content.querySelectorAll(".update-card[data-id]").forEach(card=>{
    card.addEventListener("click", ()=>{
      toggleUpdateExpanded(card.dataset.id);
      const scrollEl = document.getElementById("main");
      const scrollPos = scrollEl ? scrollEl.scrollTop : 0;
      renderProcessUpdate(content, window.__topActionsEl || content.parentElement.querySelector(".top-actions"));
      if(scrollEl) scrollEl.scrollTop = scrollPos;
      // Card click can mark an update read without a full render() happening,
      // so nudge the nav badge counts to repaint in step with it.
      if(typeof refreshNavBadges==="function") refreshNavBadges();
    });
  });

  content.querySelectorAll(".move-update-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      if(btn.disabled) return;
      moveProcessUpdate(btn.dataset.id, btn.dataset.dir);
    });
  });

  content.querySelectorAll(".pin-update-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const id = btn.dataset.id;
      const u = state.processUpdates.find(x=>x.id===id);
      if(u){
        u.pinned = !u.pinned;
        saveState(); render();
        showToast(u.pinned ? "📌 Pinned to top" : "Unpinned");
      }
    });
  });
  content.querySelectorAll(".del-update-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const id = btn.dataset.id;
      showConfirm("Archive this update? It disappears from the live Dashboard, but stays saved in Process Update History with its date and time — nothing is lost.", ()=>{
        const u = state.processUpdates.find(x=>x.id===id);
        if(u){
          u.archived = true;
          u.archivedAt = new Date().toISOString();
          u.archivedBy = (currentUser && currentUser.name) || "";
        }
        saveState(); render();
      }, "Archive");
    });
  });
}

function renderProcessUpdate(content, topActions){
  if(topActions){ topActions.innerHTML = ""; window.__topActionsEl = topActions; }
  content.innerHTML = processUpdatesSectionHtml();
  wireProcessUpdateListeners(content);
}

/* ---------------- DASHBOARD ---------------- */

/* ---------------- HISTORY ---------------- */
// Names of agents currently on the given scoped roster subset — used to filter
// archived Month History rows, which only ever stored the agent's name (no
// empId/tlName), so team-scoping an SME's view has to go via a name match
// against today's roster. An agent later reassigned to a different TL, or
// removed from the roster entirely, won't perfectly reflect a past month's
// actual team membership — this is a best-effort match against current data,
// same limitation the app already accepts elsewhere for anything history-based.
function scopedHistoryNames(){
  return new Set(scopedRoster().map(a=>a.name));
}
function renderHistory(content, topActions){
  if(isAgent()){
    topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Your archived performance</span>`;
  } else if(isSME()){
    topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Read-only — ${esc(currentUser.tlName||"your team")}'s archived performance</span>`;
  } else {
    topActions.innerHTML = `<button class="btn btn-accent" id="archiveBtn">📦 Archive ${esc(viewPeriod.month)} ${viewPeriod.year}</button>`;
    document.getElementById("archiveBtn").addEventListener("click", ()=>{
      const mIdx = currentMonthIdx(), y = viewYear();
      const metrics = coreMetrics();
      const agg = sortByRoster(agentAggregate(monthDailyRows(mIdx,y,"all")));
      if(!agg.length){ showToast("No data to archive for this month yet"); return; }
      const rows = agg.map(a=>{
        const row = {agent:a.name};
        metrics.forEach(m=> row[m.field] = a.values[m.field]!=null ? Number(a.values[m.field].toFixed(m.field==="calls"?0:1)) : null);
        row.leaveDays = a.leaveDays; row.status = a.status;
        return row;
      });
      state.history.push({id:"h"+Date.now(), month: viewPeriod.month, year: viewPeriod.year,
        savedAt: new Date().toLocaleString(), metricsSnapshot: metrics.map(m=>({name:m.name,field:m.field,unit:m.unit})), rows});
      saveState(); render();
      showToast(`✅ Archived ${viewPeriod.month} ${viewPeriod.year}`);
    });
  }

  const blocks = state.history.slice().reverse().map(h=>{
    const snap = h.metricsSnapshot && h.metricsSnapshot.length ? h.metricsSnapshot : coreMetrics().map(m=>({name:m.name,field:m.field,unit:m.unit}));
    let rows = h.rows;
    if(isAgent()) rows = rows.filter(r=>r.agent === currentUser.name);
    else if(isSME()){ const names = scopedHistoryNames(); rows = rows.filter(r=>names.has(r.agent)); }
    if(!rows.length) return '';
    return `<div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">▥</span>${h.month} ${h.year}</div>
        <div class="help-note">Saved ${h.savedAt}</div>
      </div>
      <div class="section-body table-wrap">
        <table><thead><tr><th>Agent</th>${snap.map(m=>`<th class="num">${esc(m.name)}</th>`).join("")}<th class="num">Leave</th><th>Status</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
          <td>${esc(r.agent)}</td>${snap.map(m=>`<td class="num">${r[m.field]!=null?r[m.field]:"—"}</td>`).join("")}
          <td class="num">${r.leaveDays??0}</td>
          <td>${r.status?`<span class="badge badge-${r.status}">${r.status}</span>`:`<span class="badge badge-gray">—</span>`}</td>
        </tr>`).join("")}</tbody></table>
      </div>
    </div>`;
  }).filter(Boolean).join("");

  content.innerHTML = blocks || `<div class="section"><div class="empty-state"><div class="big">▥</div><div class="disp" style="font-size:15px;font-weight:600;">No archives yet</div><p>Archive the current month once it's complete to keep a permanent snapshot here.</p></div></div>`;
}

/* ---------------- SETTINGS ---------------- */
