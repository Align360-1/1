/* ---------------- PROCESS UPDATES ---------------- */
let processUpdateSearch = "";
let expandedUpdateIds = new Set();
function processUpdatesSectionHtml(){
  const q = processUpdateSearch.trim().toLowerCase();
  let updates = (state.processUpdates||[]).filter(u=>!u.archived).slice().sort((a,b)=>{
    if(!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.postedAt||"").localeCompare(a.postedAt||"");
  });
  const totalCount = updates.length;
  if(q){
    updates = updates.filter(u=> ((u.title||"")+" "+(u.message||"")+" "+(u.postedBy||"")).toLowerCase().indexOf(q)!==-1);
  }
  const itemsHtml = updates.length ? updates.map(u=>{
    const isNew = u.postedAt && (Date.now() - new Date(u.postedAt).getTime()) < 7*24*60*60*1000;
    const isOpen = expandedUpdateIds.has(u.id);
    return `<div class="update-card${u.pinned?' pinned':''}${isOpen?' expanded':''}" data-id="${esc(u.id)}" style="cursor:pointer;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            ${u.pinned ? `<span class="badge badge-yellow">📌 Pinned</span>` : ""}
            ${isNew ? `<span class="badge badge-green">New</span>` : ""}
            <b style="font-size:13px;">${esc(u.title)}</b>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);white-space:pre-wrap;line-height:1.5;${isOpen ? "" : "overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;"}">${esc(u.message)}</div>
          ${isOpen && u.attachments && u.attachments.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            ${u.attachments.map(a=> (a.type||"").startsWith("image/")
              ? `<a href="${a.dataUrl}" download="${esc(a.name)}" target="_blank" title="${esc(a.name)}" onclick="event.stopPropagation();"><img src="${a.dataUrl}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);"></a>`
              : `<a href="${a.dataUrl}" download="${esc(a.name)}" class="badge badge-gray" style="text-decoration:none;" onclick="event.stopPropagation();">📄 ${esc(a.name)}</a>`
            ).join("")}
          </div>` : (!isOpen && u.attachments && u.attachments.length ? `<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">📎 ${u.attachments.length} attachment${u.attachments.length>1?'s':''}</div>` : "")}
          <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">By ${esc(u.postedBy||"Team Leader")} · ${u.postedAt ? new Date(u.postedAt).toLocaleString() : ""}</div>
        </div>
        ${isManager() ? `<div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="icon-btn pin-update-btn" data-id="${esc(u.id)}" title="${u.pinned ? 'Unpin' : 'Pin to top'}">${u.pinned ? '📌' : '📍'}</button>
          <button class="icon-btn del-update-btn" data-id="${esc(u.id)}" title="Archive update">✕</button>
        </div>` : ""}
      </div>
    </div>`;
  }).join("") : `<div class="empty-state" style="padding:20px;"><p>${q ? "No updates match your search." : `No process updates posted yet.${isManager() ? ' Post one and it shows up here for everyone, TLs and agents alike.' : ''}`}</p></div>`;

  return `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">📢</span>Process Updates</div>
        <div class="section-actions" style="display:flex;gap:8px;">
          ${isManager() ? `<button class="btn btn-accent btn-sm" id="postUpdateBtn">+ Post update</button>` : ""}
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
    <div class="field"><label>Title</label><input type="text" id="upTitle" placeholder="e.g. New QA scoring rubric effective Monday"></div>
    <div class="field"><label>Details</label><textarea id="upMessage" rows="4" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:8px 9px;font-size:12.5px;" placeholder="What's changing and what agents need to do..."></textarea></div>
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
  overlay.querySelector("#upCancel").addEventListener("click", closeModal);
  overlay.querySelector("#upSave").addEventListener("click", ()=>{
    const title = document.getElementById("upTitle").value.trim();
    const message = document.getElementById("upMessage").value.trim();
    const postedBy = document.getElementById("upPostedBy").value.trim();
    const pinned = document.getElementById("upPinned").checked;
    if(!title || !message){ showToast("Enter a title and details"); return; }
    if(!state.processUpdates) state.processUpdates = [];
    state.processUpdates.push({
      id: "upd"+Date.now(),
      title, message,
      postedBy: postedBy || "Team Leader",
      postedAt: new Date().toISOString(),
      pinned,
      attachments: upAttachments
    });
    saveState(); closeModal(); render();
    showToast("✅ Update posted — visible to everyone now");
  });
}
function toggleUpdateExpanded(id){
  if(expandedUpdateIds.has(id)) expandedUpdateIds.delete(id);
  else expandedUpdateIds.add(id);
}

function wireProcessUpdateListeners(content){
  const postBtn = document.getElementById("postUpdateBtn");
  if(postBtn) postBtn.addEventListener("click", openPostUpdateModal);

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
function renderHistory(content, topActions){
  if(isAgent()){
    topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Your archived performance</span>`;
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
