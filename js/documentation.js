/* ---------------- DOCUMENTATION TEMPLATE ----------------
   LOB-scoped, copy-paste template library.

   Posting:  Trainer / TL / Admin click "Post template", pick an LOB (Claims,
             Eligibility, UM Intake — from LOB_OPTIONS), give it a Title + Subtitle,
             then write the template body in the rich text box below. Trainer/TL
             can only edit/delete their OWN posts; Admin has full CRUD on every post
             (see canEditDocEntry() in js/auth.js).
   Grouping: Multiple entries can share the same Title — the UI groups them, so
             clicking a title expands it to show every Subtitle posted under that
             title on the same page, each with its own Copy button.
   Email:    An entry can additionally be flagged "Email template" — available for
             any of the 3 LOBs.
   Agent:    Read + copy only. Sees only entries whose LOB matches their own
             roster record's LOB. An agent with no LOB set on their roster row
             sees nothing until WFM/TL assigns one (agentVisibleDocEntries()).
   WFM:      No access at all — excluded by canViewDocumentation().
*/
let docSearch = "";
let expandedDocTitles = new Set();
let docViewTab = "all"; // "all" | one of LOB_OPTIONS | "settings" (Trainer/TL/Admin only)
let docSettingsSubTab = "dispositions"; // "dispositions" | "ipa" — sub-tab within the Settings tab

function normalizeDocTitle(t){ return (t||"").trim().toLowerCase(); }

// Entries visible to the logged-in Agent: only their own roster LOB, never archived.
// Returns [] outright if their roster record has no LOB assigned yet.
function agentVisibleDocEntries(){
  if(!isAgent()) return [];
  const lob = agentLOB(currentUser.empId);
  if(!lob) return [];
  return (state.documentationTemplates||[]).filter(e=>!e.archived && e.lob===lob);
}

// Groups a flat entry list into [{title, entries:[...]}], newest group first
// (by the newest entry inside each group), entries within a group newest first.
function groupDocEntries(entries){
  const groups = new Map(); // normalizedTitle -> {title, entries:[]}
  entries.forEach(e=>{
    const key = normalizeDocTitle(e.title);
    if(!groups.has(key)) groups.set(key, {title: e.title, entries: []});
    groups.get(key).entries.push(e);
  });
  const list = Array.from(groups.values());
  list.forEach(g=> g.entries.sort((a,b)=>(b.postedAt||"").localeCompare(a.postedAt||"")));
  list.sort((a,b)=>{
    const aLatest = a.entries[0] ? a.entries[0].postedAt||"" : "";
    const bLatest = b.entries[0] ? b.entries[0].postedAt||"" : "";
    return bLatest.localeCompare(aLatest);
  });
  return list;
}

function htmlToPlainText(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return (tmp.textContent || tmp.innerText || "").trim();
}

async function copyDocEntry(entry, btn){
  const html = entry.body || "";
  const text = entry.bodyText || htmlToPlainText(html);
  try{
    if(navigator.clipboard && window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], {type:"text/html"}),
        "text/plain": new Blob([text], {type:"text/plain"})
      })]);
    } else if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error("no clipboard API");
    }
    showToast("✅ Copied to clipboard");
  }catch(e){
    // Fallback: select a hidden contenteditable node and use the legacy copy command.
    try{
      const holder = document.createElement("div");
      holder.contentEditable = "true";
      holder.style.position = "fixed";
      holder.style.left = "-9999px";
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const range = document.createRange();
      range.selectNodeContents(holder);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand("copy");
      sel.removeAllRanges();
      document.body.removeChild(holder);
      showToast("✅ Copied to clipboard");
    }catch(e2){
      showToast("⚠ Couldn't copy — try selecting the text manually");
    }
  }
  if(btn){
    const orig = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(()=>{ if(btn.isConnected) btn.textContent = orig; }, 1500);
  }
}

function docEntryRowHtml(e, opts){
  opts = opts || {};
  const editable = canEditDocEntry(e);
  return `<div class="doc-entry-row" data-id="${esc(e.id)}" style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:8px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
      <div style="min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <b style="font-size:12.5px;">${esc(e.subtitle||"(no subtitle)")}</b>
          <span class="badge badge-gray">${esc(e.lob||"—")}</span>
          ${e.isEmail ? `<span class="badge badge-green">✉ Email template</span>` : ""}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px;">By ${esc(e.postedBy||"—")} · ${e.postedAt ? new Date(e.postedAt).toLocaleString() : ""}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-accent btn-sm doc-use-btn" data-id="${esc(e.id)}">📝 Use template</button>
        ${editable ? `<button class="icon-btn doc-edit-btn" data-id="${esc(e.id)}" title="Edit">✎</button>
        <button class="icon-btn doc-del-btn" data-id="${esc(e.id)}" title="Delete">✕</button>` : ""}
      </div>
    </div>
    ${(e.dispositions&&e.dispositions.length) ? `<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">📋 Suggested disposition${e.dispositions.length>1?'s':''}: <b style="color:var(--text-muted);">${e.dispositions.map(d=>esc(d.value)).join(" · ")}</b></div>` : ""}
    <div class="doc-body-preview" style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin-top:8px;max-height:220px;overflow:auto;background:var(--surface-2);border-radius:6px;padding:8px 10px;">${e.body || ""}</div>
  </div>`;
}

function docGroupCardHtml(group){
  const isOpen = expandedDocTitles.has(normalizeDocTitle(group.title));
  return `<div class="section" style="margin-top:0;">
    <div class="doc-group-head" data-title="${esc(group.title)}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:12px;color:var(--text-dim);">${isOpen ? "▾" : "▸"}</span>
        <b style="font-size:13.5px;">${esc(group.title)}</b>
        <span class="badge badge-gray">${group.entries.length} template${group.entries.length>1?"s":""}</span>
      </div>
    </div>
    ${isOpen ? `<div class="section-body" style="padding-top:0;">${group.entries.map(e=>docEntryRowHtml(e)).join("")}</div>` : ""}
  </div>`;
}

function documentationSectionHtml(){
  const isAg = isAgent();
  let entries = isAg ? agentVisibleDocEntries() : (state.documentationTemplates||[]).filter(e=>!e.archived);

  const q = docSearch.trim().toLowerCase();
  if(q){
    entries = entries.filter(e=> [e.title, e.subtitle, e.bodyText, e.lob].filter(Boolean).join(" ").toLowerCase().indexOf(q) !== -1);
  }

  // Tabs (managers/trainers/admin only — agents only ever see their own single LOB,
  // so a tab row would just be noise for them). Trainer/TL/Admin additionally get a
  // "Settings" tab that swaps the template list out for the dispositions/IPA panels,
  // instead of those being permanently stacked above every template on the page.
  const showTabs = !isAg;
  const canSettings = canManageDocumentation();
  const validTabs = ["all", ...LOB_OPTIONS, ...(canSettings ? ["settings"] : [])];
  const activeTab = (showTabs && validTabs.includes(docViewTab)) ? docViewTab : "all";
  const onSettingsTab = showTabs && canSettings && activeTab === "settings";

  if(!onSettingsTab && activeTab !== "all"){
    entries = entries.filter(e=> e.lob === activeTab);
  }

  const groups = groupDocEntries(entries);
  const noLOBAgent = isAg && !agentLOB(currentUser.empId);

  const tabsHtml = showTabs ? `<div class="dash-tabs" style="flex-wrap:wrap;">
    <button class="dash-tab ${activeTab==='all'?'active':''}" data-doctab="all">All LOBs</button>
    ${LOB_OPTIONS.map(l=>`<button class="dash-tab ${activeTab===l?'active':''}" data-doctab="${esc(l)}">${esc(l)}</button>`).join("")}
    ${canSettings ? `<button class="dash-tab ${activeTab==='settings'?'active':''}" data-doctab="settings">⚙ Settings</button>` : ""}
  </div>` : "";

  const settingsSubTabsHtml = onSettingsTab ? `<div class="dash-tabs" style="flex-wrap:wrap;margin-top:8px;">
    <button class="dash-tab ${docSettingsSubTab==='dispositions'?'active':''}" data-docsettingstab="dispositions">Dispositions</button>
    <button class="dash-tab ${docSettingsSubTab==='ipa'?'active':''}" data-docsettingstab="ipa">IPA Directory</button>
  </div>` : "";

  const emptyMsg = noLOBAgent
    ? "No LOB is set on your roster record yet — ask your Team Leader or WFM to assign one before templates appear here."
    : (q ? "No templates match your search." : `No documentation templates posted yet.${canManageDocumentation() ? " Post one and it shows up here for the matching LOB." : ""}`);

  return `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">📄</span>Documentation Template${isAg ? ` — ${esc(agentLOB(currentUser.empId)||"unassigned")}` : (onSettingsTab ? " — Settings" : (activeTab!=="all" ? ` — ${esc(activeTab)}` : ""))}</div>
        <div class="section-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          ${(!onSettingsTab && canManageDocumentation()) ? `<button class="btn btn-accent btn-sm" id="postDocBtn">+ Post template</button>` : ""}
        </div>
      </div>
      ${tabsHtml ? `<div class="section-body" style="padding-bottom:0;padding-top:0;">${tabsHtml}${settingsSubTabsHtml}</div>` : ""}
      ${!onSettingsTab ? `<div class="section-body" style="padding-bottom:0;">
        <input type="text" id="docSearchInput" class="history-search" placeholder="🔍 Search templates by title, subtitle, or content..." value="${esc(docSearch)}" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px;font-size:12.5px;box-sizing:border-box;font-family:inherit;">
      </div>` : ""}
    </div>
    ${onSettingsTab
      ? (docSettingsSubTab === "ipa" ? docIpaPanelHtml() : docDispositionsPanelHtml())
      : (groups.length ? groups.map(docGroupCardHtml).join("") : `<div class="section"><div class="empty-state" style="padding:20px;"><p>${emptyMsg}</p></div></div>`)}
  `;
}

/* ---- Minimal rich text box (contenteditable + execCommand toolbar) ---- */
function richTextToolbarHtml(idPrefix){
  return `<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap;">
    <button type="button" class="btn btn-ghost btn-sm rt-cmd" data-cmd="bold" data-target="${idPrefix}" title="Bold"><b>B</b></button>
    <button type="button" class="btn btn-ghost btn-sm rt-cmd" data-cmd="italic" data-target="${idPrefix}" title="Italic"><i>I</i></button>
    <button type="button" class="btn btn-ghost btn-sm rt-cmd" data-cmd="underline" data-target="${idPrefix}" title="Underline"><u>U</u></button>
    <button type="button" class="btn btn-ghost btn-sm rt-cmd" data-cmd="insertUnorderedList" data-target="${idPrefix}" title="Bulleted list">• List</button>
    <button type="button" class="btn btn-ghost btn-sm rt-cmd" data-cmd="insertOrderedList" data-target="${idPrefix}" title="Numbered list">1. List</button>
    <button type="button" class="btn btn-ghost btn-sm rt-cmd" data-cmd="removeFormat" data-target="${idPrefix}" title="Clear formatting">Clear</button>
  </div>`;
}
function wireRichTextToolbar(overlay, idPrefix){
  overlay.querySelectorAll(`.rt-cmd[data-target="${idPrefix}"]`).forEach(btn=>{
    btn.addEventListener("mousedown", e=> e.preventDefault()); // keep focus/selection in the editor
    btn.addEventListener("click", ()=>{
      document.getElementById(idPrefix).focus();
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });
}

function openPostDocModal(existing){
  const isEdit = !!existing;
  const dispOpts = state.settings.dispositionOptions || [];
  const existingDispMap = new Map((existing && existing.dispositions || []).map(d=>[d.value, d.rule||""]));

  const overlay = showModal(`
    <div class="modal-title">${isEdit ? "Edit documentation template" : "Post a documentation template"}</div>
    <div class="field"><label>LOB</label>
      <select id="docLOB" style="width:100%;">
        ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${existing && existing.lob===l ? "selected":""}>${esc(l)}</option>`).join("")}
      </select>
      <div class="help-note">Only visible to agents assigned to this LOB.</div>
    </div>
    <label class="check-row"><input type="checkbox" id="docIsEmail" ${existing && existing.isEmail ? "checked":""}> Email template</label>
    <div class="field"><label>Title <span style="color:var(--text-dim);font-weight:400;">(Category)</span></label><input type="text" id="docTitle" value="${existing?esc(existing.title):""}" placeholder="e.g. Claim Denied"></div>
    <div class="field"><label>Subtitle <span style="color:var(--text-dim);font-weight:400;">(Sub Category)</span></label><input type="text" id="docSubtitle" value="${existing?esc(existing.subtitle):""}" placeholder="e.g. IPA Responsibility"></div>
    <div class="field">
      <label>Template</label>
      ${richTextToolbarHtml("docBody")}
      <div id="docBody" contenteditable="true" style="min-height:160px;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:10px;font-size:12.5px;line-height:1.5;overflow:auto;">${existing ? existing.body||"" : ""}</div>
      <div class="help-note">
        Use <code>{{field_name}}</code> for anything that changes per call, e.g. <code>{{claim_received_date}}</code> or <code>{{claim_received_date:date}}</code> for a date picker. The agent fills each one on this template's own form — Align360 doesn't capture caller name, member ID, claim number, DOB, or other call-reference fields for you, since that's already entered in ServiceNow. The only exceptions are <code>{{agent_name}}</code> and <code>{{today}}</code>, which fill automatically from who's logged in and today's date — nothing to type for either.
        Wrap an optional clause in <code>[[ ]]</code> so it disappears cleanly if its field is left blank, e.g. <code>[[Claim received date: {{claim_received_date}}.]]</code>.
        For a group of optional fields like an IPA's name/phone/address, wrap the whole connecting clause together with <code>{{list:...}}</code> in <code>[[ ]]</code> so the entire sentence disappears if none of them were filled — e.g. <code>[[Informed the provider and provided {{list:ipa_name=the IPA name,ipa_phone=phone number,ipa_address=address}}.]]</code> — it joins only the fields the agent actually filled in with proper "and"/comma punctuation.
        Add <code>{{additional_notes}}</code> alone on its own line at the end for anything call-specific this template doesn't cover — it's dropped automatically when left blank.
      </div>
    </div>
    <div class="field">
      <label>Suggested disposition</label>
      <div id="docDispositionList" style="display:flex;flex-direction:column;gap:6px;max-height:170px;overflow:auto;border:1px solid var(--border);border-radius:6px;padding:8px;">
        ${dispOpts.length ? dispOpts.map(d=>`
          <div class="doc-disp-row">
            <label class="check-row"><input type="checkbox" class="doc-disp-cb" value="${esc(d)}" ${existingDispMap.has(d)?'checked':''}> ${esc(d)}</label>
            <input type="text" class="doc-disp-rule" placeholder="When to pick this one (only needed if you check more than one)" value="${esc(existingDispMap.get(d)||'')}" style="width:100%;margin:4px 0 2px 22px;font-size:11.5px;box-sizing:border-box;">
          </div>`).join("") : `<div style="color:var(--text-dim);font-size:12px;">No dispositions defined yet — a Trainer, TL, or Admin can add them from Documentation → ⚙ Settings → Dispositions.</div>`}
      </div>
      <div class="help-note">Check one for a clear-cut mapping, or check a few with a short rule each when the right disposition depends on something specific the call reveals.</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="docCancel">Cancel</button>
      <button class="btn btn-accent" id="docSave">${isEdit ? "Save changes" : "Post template"}</button>
    </div>
  `);
  wireRichTextToolbar(overlay, "docBody");

  overlay.querySelector("#docCancel").addEventListener("click", closeModal);
  overlay.querySelector("#docSave").addEventListener("click", ()=>{
    const lob = document.getElementById("docLOB").value;
    const isEmail = document.getElementById("docIsEmail").checked;
    const title = document.getElementById("docTitle").value.trim();
    const subtitle = document.getElementById("docSubtitle").value.trim();
    const bodyEl = document.getElementById("docBody");
    const body = bodyEl.innerHTML.trim();
    const bodyText = htmlToPlainText(body);
    if(!title || !subtitle){ showToast("Enter a title and subtitle"); return; }
    if(!bodyText){ showToast("Template body can't be empty"); return; }
    const dispositions = [];
    overlay.querySelectorAll(".doc-disp-row").forEach(row=>{
      const cb = row.querySelector(".doc-disp-cb");
      if(!cb || !cb.checked) return;
      const ruleInput = row.querySelector(".doc-disp-rule");
      dispositions.push({value: cb.value, rule: ruleInput ? ruleInput.value.trim() : ""});
    });

    if(!state.documentationTemplates) state.documentationTemplates = [];
    if(isEdit){
      const before = {lob: existing.lob, title: existing.title, subtitle: existing.subtitle};
      Object.assign(existing, {lob, isEmail, title, subtitle, body, bodyText, dispositions,
        editedBy: (currentUser&&currentUser.name)||"", editedAt: new Date().toISOString()});
      logAudit("doc_template_edit", `Edited documentation template "${title}"`, {before, after:{lob,title,subtitle}});
    } else {
      state.documentationTemplates.push({
        id: "doc"+Date.now(),
        lob, isEmail, title, subtitle, body, bodyText, dispositions,
        postedBy: (currentUser&&currentUser.name)||"",
        postedByUsername: (currentUser&&currentUser.username)||"",
        postedAt: new Date().toISOString(),
        archived: false
      });
      logAudit("doc_template_post", `Posted documentation template "${title}"`, {after:{lob,title,subtitle}});
    }
    expandedDocTitles.add(normalizeDocTitle(title));
    saveState(); closeModal(); render();
    showToast(isEdit ? "✅ Template updated" : "✅ Template posted");
  });
}

function wireDocumentationListeners(content){
  if(canManageDocumentation()) wireDocAdminPanel(content);

  const postBtn = document.getElementById("postDocBtn");
  if(postBtn) postBtn.addEventListener("click", ()=> openPostDocModal(null));

  content.querySelectorAll("[data-doctab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      docViewTab = btn.dataset.doctab;
      render();
    });
  });

  content.querySelectorAll("[data-docsettingstab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      docSettingsSubTab = btn.dataset.docsettingstab;
      render();
    });
  });

  const searchInput = document.getElementById("docSearchInput");
  if(searchInput){
    searchInput.addEventListener("input", ()=>{
      docSearch = searchInput.value;
      const pos = searchInput.selectionStart;
      render();
      const fresh = document.getElementById("docSearchInput");
      if(fresh){ fresh.focus(); fresh.setSelectionRange(pos,pos); }
    });
  }

  content.querySelectorAll(".doc-group-head").forEach(head=>{
    head.addEventListener("click", ()=>{
      const key = normalizeDocTitle(head.dataset.title);
      if(expandedDocTitles.has(key)) expandedDocTitles.delete(key);
      else expandedDocTitles.add(key);
      render();
    });
  });

  content.querySelectorAll(".doc-use-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const entry = (state.documentationTemplates||[]).find(x=>x.id===btn.dataset.id);
      if(entry) openDocFillModal(entry);
    });
  });

  content.querySelectorAll(".doc-edit-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const entry = (state.documentationTemplates||[]).find(x=>x.id===btn.dataset.id);
      if(entry && canEditDocEntry(entry)) openPostDocModal(entry);
    });
  });

  content.querySelectorAll(".doc-del-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      const id = btn.dataset.id;
      const entry = (state.documentationTemplates||[]).find(x=>x.id===id);
      if(!entry || !canEditDocEntry(entry)) return;
      showConfirm("Delete this documentation template? This can't be undone.", ()=>{
        state.documentationTemplates = state.documentationTemplates.filter(x=>x.id!==id);
        logAudit("doc_template_delete", `Deleted documentation template "${entry.title}"`, {before:{title:entry.title,lob:entry.lob}});
        saveState(); render();
      }, "Delete");
    });
  });
}

function renderDocumentation(content, topActions){
  if(topActions){ topActions.innerHTML = ""; window.__topActionsEl = topActions; }
  content.innerHTML = documentationSectionHtml();
  wireDocumentationListeners(content);
}
