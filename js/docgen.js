/* ---------------- Documentation Template: fill-in-and-generate engine ----------------
   Turns a posted template's rich text body into a live "fill the blanks" form that
   produces a ready-to-paste note, instead of the agent hand-editing a copy-pasted block.

   Token syntax authors write directly into the template body (see help text in
   openPostDocModal, js/documentation.js):
     {{field_name}}              simple fillable field
     {{field_name:date}}         date picker
     {{field_name:currency}}     numeric input
     {{field_name:select:A|B}}   dropdown with the given options
     [[ ... {{field_name}} ... ]]   optional clause — the whole bracketed span (including
                                     surrounding words/punctuation) disappears if every
                                     {{token}} referenced inside it is left blank
     {{list:f1=Label 1,f2=Label 2,...}}  joins whichever of f1/f2/... the agent actually
                                     filled in with proper "and"/comma punctuation, or
                                     produces nothing if none were filled. IMPORTANT: on
                                     its own this only removes the missing VALUES, not
                                     the surrounding sentence — wrap the connecting words
                                     together with the list token in [[ ]] whenever the
                                     whole clause should vanish too, e.g.
                                     [[and provided {{list:...}}.]]
     {{additional_notes}}        by convention, placed alone on its own line at the end —
                                     an optional catch-all for anything call-specific the
                                     template doesn't cover; the whole line disappears if
                                     left blank (this falls out of the same blank-line-drop
                                     rule used for any other now-empty line, no special case)

   Align360 deliberately does NOT capture caller name, member ID, claim number, DOB, or
   any of the other call-reference fields — that data already lives in ServiceNow, and
   duplicating entry of it here would just be another place for it to go stale or
   mismatch. Only `agent_name` and `today` are auto-filled (computed from the logged-in
   user and the current date — nothing typed, nothing duplicated). Every other value a
   template needs is a plain fillable field the agent enters on that template's own form.
*/
// Reserved names that auto-compute at generate time rather than being typed — see note
// above on why this list is intentionally short.
const DOC_RESERVED_IDS = new Set(["agent_name","today"]);

/* ---------------- Token parsing ---------------- */
function docParseListPayload(payload){
  return payload.split(",").map(pair=>{
    const idx = pair.indexOf("=");
    if(idx===-1) return null;
    return {field: pair.slice(0,idx).trim(), label: pair.slice(idx+1).trim()};
  }).filter(Boolean);
}

// Converts a template's HTML body into plain text with real line breaks, so the
// line-based render/collapse logic below can work on something predictable — bullet
// list items are kept as "• " prefixed lines rather than lost entirely.
function docHtmlToLines(html){
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  tmp.querySelectorAll("li").forEach(li=>{
    li.insertAdjacentText("afterbegin", "• ");
    li.insertAdjacentText("beforeend", "\n");
  });
  tmp.querySelectorAll("br").forEach(br=> br.replaceWith("\n"));
  tmp.querySelectorAll("div,p").forEach(el=> el.insertAdjacentText("beforeend","\n"));
  const text = tmp.textContent || tmp.innerText || "";
  return text.split("\n").map(l=>l.replace(/\s+$/,"")).join("\n");
}

// Every {{field_name}} / {{field_name:type}} / {{field_name:select:A|B}} match, name only.
const DOC_TOKEN_RE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)(?::([a-zA-Z]+))?(?::([^}]*))?\}\}/g;
const DOC_LIST_TOKEN_RE = /\{\{list:([^}]+)\}\}/g;

// Scans a template's raw (line-broken) text for every fillable field, in first-appearance
// order, skipping only the auto-computed reserved names (agent_name, today).
function docExtractFields(rawText){
  const order = [];
  const seen = new Set();
  let m;
  DOC_LIST_TOKEN_RE.lastIndex = 0;
  while((m = DOC_LIST_TOKEN_RE.exec(rawText))){
    docParseListPayload(m[1]).forEach(p=>{
      if(DOC_RESERVED_IDS.has(p.field) || seen.has(p.field)) return;
      seen.add(p.field);
      order.push({name:p.field, type: p.field==="ipa_name" ? "ipa-select" : "text", options:null});
    });
  }
  const withoutLists = rawText.replace(DOC_LIST_TOKEN_RE, "");
  DOC_TOKEN_RE.lastIndex = 0;
  while((m = DOC_TOKEN_RE.exec(withoutLists))){
    const name = m[1], type = m[2] || "text", opts = m[3];
    if(DOC_RESERVED_IDS.has(name) || seen.has(name)) continue;
    seen.add(name);
    order.push({name, type, options: (type==="select" && opts) ? opts.split("|").map(s=>s.trim()) : null});
  }
  return order;
}

function docFieldValue(name, values){
  if(values[name] !== undefined && values[name] !== null){
    const v = String(values[name]).trim();
    if(v!=="") return v;
  }
  return "";
}

function docRenderList(payload, values){
  const parts = docParseListPayload(payload);
  const filled = parts.map(p=>({...p, val: docFieldValue(p.field, values)})).filter(p=>p.val!=="");
  if(!filled.length) return "";
  const phrases = filled.map(p=> `${p.label} ${p.val}`.trim());
  if(phrases.length===1) return phrases[0];
  if(phrases.length===2) return `${phrases[0]} and ${phrases[1]}`;
  return phrases.slice(0,-1).join(", ") + ", and " + phrases[phrases.length-1];
}

// Turns a template's raw text + the fields the agent filled in (plus session/auto
// values) into the final note. See file header for the exact token rules.
//
// Order matters here: [[ ]] blocks are resolved BEFORE the global {{list:...}} pass,
// so that a list construct wrapped in brackets — e.g.
//   [[and provided {{list:ipa_name=the IPA name,ipa_phone=phone number,ipa_address=address}}.]]
// — can make the whole surrounding clause disappear when the list renders empty,
// not just leave a dangling "and provided ." A {{list:...}} left OUTSIDE any
// brackets is treated as always "present" (it just renders to "" if nothing in it
// was filled) — authors should wrap the connecting words together with the list
// token in [[ ]] whenever the whole clause should vanish, not just the values.
function docRenderTemplate(rawText, values){
  let out = rawText.replace(/\[\[([\s\S]*?)\]\]/g, (full, inner) => {
    const tokenRefs = [];
    inner.replace(DOC_TOKEN_RE, (f, name) => { if(name!=="list") tokenRefs.push({kind:"token", name}); return f; });
    const listRefs = [];
    inner.replace(DOC_LIST_TOKEN_RE, (f, payload) => { listRefs.push({kind:"list", payload}); return f; });
    const allRefs = tokenRefs.concat(listRefs);
    const isBlank = ref => ref.kind==="token" ? docFieldValue(ref.name, values)==="" : docRenderList(ref.payload, values)==="";
    const allBlank = allRefs.length>0 && allRefs.every(isBlank);
    if(allBlank) return "";
    let filled = inner.replace(DOC_LIST_TOKEN_RE, (f, payload) => docRenderList(payload, values));
    filled = filled.replace(DOC_TOKEN_RE, (f, name) => docFieldValue(name, values));
    return filled;
  });

  out = out.replace(DOC_LIST_TOKEN_RE, (full, payload) => docRenderList(payload, values));
  out = out.replace(DOC_TOKEN_RE, (f, name) => docFieldValue(name, values));

  // Any line left empty by a dropped [[block]] or a blank {{additional_notes}} on its
  // own line is removed entirely, rather than left as a dangling blank line.
  out = out.split("\n").filter(line => line.trim() !== "").join("\n");
  return out.trim();
}

function docLabelize(name){
  return name.replace(/_/g," ").replace(/\b\w/g, c=>c.toUpperCase());
}

// Auto-computed values every template can use without asking the agent to type
// anything — the logged-in agent's name and today's date. Everything else a template
// needs is a plain fillable field (see docExtractFields).
function docBaseValues(){
  return {
    agent_name: (currentUser && currentUser.name) || "",
    today: fmtDate(todayIso())
  };
}

async function docCopyPlainText(text, btn){
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); }
    else throw new Error("no clipboard api");
    showToast("✅ Copied to clipboard");
  }catch(e){
    try{
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy");
      document.body.removeChild(ta);
      showToast("✅ Copied to clipboard");
    }catch(e2){
      showToast("⚠ Couldn't copy — select the text in the box and copy manually (some VDI setups restrict clipboard access)");
    }
  }
  if(btn){
    const orig = btn.textContent;
    btn.textContent = "✓ Copied";
    setTimeout(()=>{ if(btn.isConnected) btn.textContent = orig; }, 1500);
  }
}

/* ---------------- Admin: disposition master list + IPA/vendor directory ---------------- */
function docDispositionsPanelHtml(){
  const dispOpts = state.settings.dispositionOptions || [];
  const dispRows = dispOpts.map((d,i)=>`
    <tr data-i="${i}"><td>${esc(d)}</td><td><button class="icon-btn del-disposition-btn" data-i="${i}">✕</button></td></tr>`).join("");
  return `<div class="section" style="margin-top:0;">
    <div class="section-head">
      <div class="section-title"><span class="eyebrow">⚙</span>Disposition master list</div>
    </div>
    <div class="section-body">
      <div class="help-note" style="margin:2px 0 10px;">Keep these matching ServiceNow's dropdown exactly — templates pick a suggested disposition from this list, so there's no drift between what Align360 suggests and what's actually selectable there.</div>
      <div class="table-wrap"><table class="mini-table"><thead><tr><th>Disposition</th><th></th></tr></thead><tbody id="dispositionBody">${dispRows || '<tr><td colspan="2" style="color:var(--text-dim);">None added yet</td></tr>'}</tbody></table></div>
      <div class="form-inline" style="margin-top:10px;">
        <div class="field"><label>New disposition</label><input type="text" id="newDispositionInput" placeholder="e.g. Claim Denial - IPA/Vendor Responsibility"></div>
        <button class="btn btn-sm btn-accent" id="addDispositionBtn">+ Add</button>
      </div>
    </div>
  </div>`;
}

function docIpaPanelHtml(){
  const ipaRows = (state.ipaDirectory||[]).map((ipa,i)=>`
    <tr data-i="${i}" data-id="${esc(ipa.id||"")}">
      <td>${esc(ipa.code||"—")}</td><td>${esc(ipa.name)}</td><td>${esc(ipa.phone||"—")}</td><td>${esc(ipa.address||"—")}</td>
      <td><button class="icon-btn del-ipa-btn" data-i="${i}">✕</button></td>
    </tr>`).join("");
  return `<div class="section" style="margin-top:0;">
    <div class="section-head">
      <div class="section-title"><span class="eyebrow">⚙</span>IPA / Vendor directory</div>
    </div>
    <div class="section-body">
      <div class="help-note" style="margin:2px 0 10px;">Agents pick an IPA by name in the fill form — phone and address auto-fill from here (still editable per call if something's changed on that particular call).</div>
      <div class="table-wrap"><table class="mini-table"><thead><tr><th>Code</th><th>Name</th><th>Phone</th><th>Address</th><th></th></tr></thead><tbody id="ipaBody">${ipaRows || '<tr><td colspan="5" style="color:var(--text-dim);">None added yet</td></tr>'}</tbody></table></div>
      <div style="margin-top:10px;">
        <button type="button" class="btn btn-sm btn-ghost" id="uploadIpaBtn">📤 Upload file (CSV/Excel)</button>
      </div>
      <div class="form-inline" style="margin-top:10px;flex-wrap:wrap;">
        <div class="field" style="max-width:110px;"><label>IPA code</label><input type="text" id="newIpaCode" placeholder="e.g. AL"></div>
        <div class="field"><label>IPA name</label><input type="text" id="newIpaName" placeholder="e.g. All Care"></div>
        <div class="field"><label>Phone</label><input type="text" id="newIpaPhone" placeholder="(555) 234-1190"></div>
        <div class="field" style="min-width:240px;flex:1;"><label>Address</label><input type="text" id="newIpaAddress" placeholder="4400 Medical Plaza Dr, Suite 210, Sacramento, CA 95817"></div>
        <button class="btn btn-sm btn-accent" id="addIpaBtn">+ Add</button>
      </div>
    </div>
  </div>`;
}

function wireDocAdminPanel(content){
  content.querySelectorAll(".del-disposition-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = +btn.dataset.i;
      const removed = state.settings.dispositionOptions[i];
      state.settings.dispositionOptions.splice(i,1);
      logAudit("disposition_delete", `Removed disposition "${removed}"`, {before:{value:removed}});
      saveState(); render();
    });
  });
  const addDispBtn = document.getElementById("addDispositionBtn");
  if(addDispBtn) addDispBtn.addEventListener("click", ()=>{
    const input = document.getElementById("newDispositionInput");
    const val = input.value.trim();
    if(!val){ showToast("Enter a disposition value"); return; }
    if((state.settings.dispositionOptions||[]).some(d=>d.toLowerCase()===val.toLowerCase())){ showToast("That disposition already exists"); return; }
    if(!state.settings.dispositionOptions) state.settings.dispositionOptions = [];
    state.settings.dispositionOptions.push(val);
    logAudit("disposition_add", `Added disposition "${val}"`, {after:{value:val}});
    saveState(); render();
  });

  content.querySelectorAll(".del-ipa-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = +btn.dataset.i;
      const removed = state.ipaDirectory[i];
      state.ipaDirectory.splice(i,1);
      logAudit("ipa_delete", `Removed IPA "${removed && removed.name}" from directory`, {before:{name:removed&&removed.name}});
      saveState(); render();
    });
  });
  const addIpaBtn = document.getElementById("addIpaBtn");
  if(addIpaBtn) addIpaBtn.addEventListener("click", ()=>{
    const code = document.getElementById("newIpaCode").value.trim();
    const name = document.getElementById("newIpaName").value.trim();
    const phone = document.getElementById("newIpaPhone").value.trim();
    const address = document.getElementById("newIpaAddress").value.trim();
    if(!code){ showToast("Enter an IPA code"); return; }
    if(!name){ showToast("Enter an IPA name"); return; }
    if(!state.ipaDirectory) state.ipaDirectory = [];
    if(state.ipaDirectory.some(i=> (i.code||"").trim().toLowerCase()===code.toLowerCase())){
      showToast(`Code "${code}" is already used by another IPA`); return;
    }
    if(state.ipaDirectory.some(i=> i.name.trim().toLowerCase()===name.toLowerCase())){
      showToast("That IPA name already exists"); return;
    }
    state.ipaDirectory.push({id:"ipa"+Date.now(), code, name, phone, address});
    logAudit("ipa_add", `Added IPA "${code} — ${name}" to directory`, {after:{code, name}});
    saveState(); render();
  });

  const uploadIpaBtn = document.getElementById("uploadIpaBtn");
  if(uploadIpaBtn) uploadIpaBtn.addEventListener("click", openIpaUploadModal);
}

/* ---------------- IPA directory: bulk upload (CSV/XLSX) ---------------- */
function docIpaNormalizeHeader(h){
  return String(h||"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function docIpaMatchField(normalized){
  // Deliberately narrower than the other three: a bare "code" pattern would also
  // false-match common address-sheet columns like "Zip Code" or "Area Code", silently
  // misassigning them to the IPA code field. Only match when "code" is paired with
  // ipa/vendor/provider, stands alone with nothing else, or says "short code"/"abbreviation".
  if(/\b(ipa|vendor|provider)\s*code\b/.test(normalized) || normalized==="code" || /\bshort\s*code\b|\babbreviation\b|\babbr\b/.test(normalized)) return "code";
  if(/\b(ipa|vendor|provider)?\s*name\b/.test(normalized) || normalized==="name") return "name";
  if(/phone|contact\s*(no|number)?|mobile|tel/.test(normalized)) return "phone";
  if(/address|location/.test(normalized)) return "address";
  return null;
}
function docIpaDetectColumnMap(headers){
  const map = {};
  headers.forEach(h=>{
    const f = docIpaMatchField(docIpaNormalizeHeader(h));
    if(f && !Object.values(map).includes(f)) map[h] = f;
  });
  return map;
}

function openIpaUploadModal(){
  const overlay = showModal(`
    <div class="modal-title">Upload IPA / Vendor directory</div>
    <p class="help-note" style="margin:0 0 14px;">Upload a CSV or Excel file with IPA Code, Name, Phone, and Address columns — any header names are fine, you'll confirm the mapping on the next screen.</p>
    <div class="field"><input type="file" id="ipaUploadFileInput" accept=".csv,.xlsx,.xls"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="ipaUploadCancel">Cancel</button>
      <button class="btn btn-accent" id="ipaUploadNext">Next: review mapping</button>
    </div>
  `);
  overlay.querySelector("#ipaUploadCancel").addEventListener("click", closeModal);
  overlay.querySelector("#ipaUploadNext").addEventListener("click", async ()=>{
    const file = document.getElementById("ipaUploadFileInput").files[0];
    if(!file){ showToast("Choose a file first"); return; }
    const btn = document.getElementById("ipaUploadNext");
    btn.textContent = "Reading…"; btn.disabled = true;
    try{
      const sheetRows = await readSheetRows(file);
      const headers = Object.keys(sheetRows[0]||{});
      const colMap = docIpaDetectColumnMap(headers);
      openIpaReviewModal(sheetRows, colMap);
    }catch(err){
      console.error(err);
      showToast("⚠ Could not read that file");
      btn.textContent = "Next: review mapping"; btn.disabled = false;
    }
  });
}

function docIpaBuildPreviewRows(sheetRows, colMap){
  return sheetRows.slice(0,5).map(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([h,f])=>{ rec[f] = row[h]; });
    const name = String(rec.name||"").trim();
    return `<tr>
      <td>${rec.code ? esc(String(rec.code)) : "—"}</td>
      <td>${name ? esc(name) : '<span style="color:var(--red);font-weight:600;">— missing —</span>'}</td>
      <td>${rec.phone ? esc(String(rec.phone)) : "—"}</td>
      <td>${rec.address ? esc(String(rec.address)) : "—"}</td>
    </tr>`;
  }).join("");
}

function openIpaReviewModal(sheetRows, colMap){
  const headers = Object.keys(sheetRows[0]||{});
  const FIELD_OPTIONS = ["", "code", "name", "phone", "address"];
  const FIELD_LABELS = {code:"IPA Code", name:"IPA Name", phone:"Phone", address:"Address"};
  const rowsHtml = headers.map(h=>{
    const current = colMap[h] || "";
    const opts = FIELD_OPTIONS.map(f=>`<option value="${f}" ${f===current?"selected":""}>${f?esc(FIELD_LABELS[f]):"— Ignore this column —"}</option>`).join("");
    return `<tr><td class="mono">${esc(h)}</td><td><select class="cell-select ipa-map-col-sel" data-header="${esc(h)}" style="width:100%;">${opts}</select></td></tr>`;
  }).join("");

  const overlay = showModal(`
    <div class="modal-title">Review column mapping</div>
    <p class="help-note" style="margin:0 0 10px;">Confirm each column landed on the right field. IPA Name is required — rows without one are skipped.</p>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr><th>File column</th><th>Maps to</th></tr></thead><tbody id="ipaColMapBody">${rowsHtml}</tbody></table>
    </div>
    <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Preview — first ${Math.min(5,sheetRows.length)} row(s)</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr><th>Code</th><th>IPA Name</th><th>Phone</th><th>Address</th></tr></thead><tbody id="ipaPreviewBody">${docIpaBuildPreviewRows(sheetRows, colMap)}</tbody></table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="ipaImportBack">Back</button>
      <button class="btn btn-accent" id="ipaImportCommit">✔ Import now</button>
    </div>
  `);

  const refresh = ()=>{
    const liveMap = {};
    overlay.querySelectorAll(".ipa-map-col-sel").forEach(sel=>{ if(sel.value) liveMap[sel.dataset.header] = sel.value; });
    document.getElementById("ipaPreviewBody").innerHTML = docIpaBuildPreviewRows(sheetRows, liveMap);
    return liveMap;
  };
  overlay.querySelectorAll(".ipa-map-col-sel").forEach(sel=> sel.addEventListener("change", refresh));

  overlay.querySelector("#ipaImportBack").addEventListener("click", ()=>{ closeModal(); openIpaUploadModal(); });
  overlay.querySelector("#ipaImportCommit").addEventListener("click", ()=>{
    const liveMap = refresh();
    if(!Object.values(liveMap).includes("name")){ showToast("Map at least one column to IPA Name before importing"); return; }
    const {toInsert, conflicts, skippedNoName} = docIpaPrepareImport(sheetRows, liveMap);
    closeModal();
    if(!conflicts.length){
      const result = docIpaCommitImport(toInsert, [], {});
      showToast(`Imported ${result.imported} IPA(s)${skippedNoName?`, skipped ${skippedNoName} with no name`:""}`);
      render();
    } else {
      openIpaConflictModal(toInsert, conflicts, skippedNoName);
    }
  });
}

// Matches uploaded rows against the existing directory — by code when the uploaded
// row has one (code is the intended primary identifier), falling back to name for
// rows/files that don't have a code column. Same "review before overwriting" pattern
// used for Daily Summary uploads, so re-uploading an updated master list doesn't
// silently clobber anything.
function docIpaPrepareImport(sheetRows, colMap){
  const dir = state.ipaDirectory||[];
  const byCode = new Map(dir.filter(ipa=>(ipa.code||"").trim()).map(ipa=>[ipa.code.trim().toLowerCase(), ipa]));
  const byName = new Map(dir.map(ipa=>[ipa.name.trim().toLowerCase(), ipa]));
  const seenInFile = new Map(); // last occurrence within the file wins over earlier ones in the same file
  let skippedNoName = 0;
  sheetRows.forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([h,f])=>{ rec[f] = row[h]; });
    const name = String(rec.name||"").trim();
    if(!name){ skippedNoName++; return; }
    const code = String(rec.code||"").trim();
    const key = code ? "code:"+code.toLowerCase() : "name:"+name.toLowerCase();
    seenInFile.set(key, { code, name, phone: String(rec.phone||"").trim(), address: String(rec.address||"").trim() });
  });
  const toInsert = [];
  const conflicts = [];
  seenInFile.forEach((item, key)=>{
    const existing = item.code ? byCode.get(item.code.toLowerCase()) : byName.get(item.name.toLowerCase());
    if(existing){
      conflicts.push({
        key, name:item.name,
        newValues: {code:item.code, name:item.name, phone:item.phone, address:item.address},
        oldValues: {code:existing.code||"", name:existing.name, phone:existing.phone||"", address:existing.address||""},
        existingRec: existing
      });
    } else {
      toInsert.push(item);
    }
  });
  return {toInsert, conflicts, skippedNoName};
}

function docIpaCommitImport(toInsert, conflicts, resolutions){
  let imported = 0, updated = 0, skipped = 0;
  if(!state.ipaDirectory) state.ipaDirectory = [];
  toInsert.forEach(item=>{
    state.ipaDirectory.push({id:"ipa"+Date.now()+Math.random().toString(36).slice(2,7), code:item.code, name:item.name, phone:item.phone, address:item.address});
    imported++;
  });
  conflicts.forEach(c=>{
    const action = resolutions[c.key] || "skip";
    if(action==="update"){
      c.existingRec.code = c.newValues.code;
      c.existingRec.name = c.newValues.name;
      c.existingRec.phone = c.newValues.phone;
      c.existingRec.address = c.newValues.address;
      updated++;
    } else {
      skipped++;
    }
  });
  saveState();
  logAudit("ipa_bulk_upload", `Bulk uploaded IPA directory: ${imported} new, ${updated} updated, ${skipped} skipped duplicate(s)`, {after:{imported, updated, skipped}});
  return {imported, updated, skipped};
}

function docIpaConflictRowHtml(c){
  return `
    <div class="ds-conflict-row" data-key="${esc(c.key)}">
      <div class="ds-conflict-head">
        <div class="ds-conflict-date">${esc(c.name)}</div>
        <select class="cell-select ds-conflict-action" data-key="${esc(c.key)}">
          <option value="skip" selected>Skip — keep existing</option>
          <option value="update">Update — use new data</option>
        </select>
      </div>
      <div class="ds-conflict-params">
        <div class="ds-conflict-param ds-conflict-param-header">
          <span class="ds-conflict-param-name"></span>
          <span class="ds-conflict-param-old">Previous</span>
          <span class="ds-conflict-arrow"></span>
          <span class="ds-conflict-param-new">New upload</span>
        </div>
        <div class="ds-conflict-param">
          <span class="ds-conflict-param-name">Code</span>
          <span class="ds-conflict-param-old">${esc(c.oldValues.code||"—")}</span>
          <span class="ds-conflict-arrow">→</span>
          <span class="ds-conflict-param-new">${esc(c.newValues.code||"—")}</span>
        </div>
        <div class="ds-conflict-param">
          <span class="ds-conflict-param-name">Name</span>
          <span class="ds-conflict-param-old">${esc(c.oldValues.name||"—")}</span>
          <span class="ds-conflict-arrow">→</span>
          <span class="ds-conflict-param-new">${esc(c.newValues.name||"—")}</span>
        </div>
        <div class="ds-conflict-param">
          <span class="ds-conflict-param-name">Phone</span>
          <span class="ds-conflict-param-old">${esc(c.oldValues.phone||"—")}</span>
          <span class="ds-conflict-arrow">→</span>
          <span class="ds-conflict-param-new">${esc(c.newValues.phone||"—")}</span>
        </div>
        <div class="ds-conflict-param">
          <span class="ds-conflict-param-name">Address</span>
          <span class="ds-conflict-param-old">${esc(c.oldValues.address||"—")}</span>
          <span class="ds-conflict-arrow">→</span>
          <span class="ds-conflict-param-new">${esc(c.newValues.address||"—")}</span>
        </div>
      </div>
    </div>`;
}

function openIpaConflictModal(toInsert, conflicts, skippedNoName){
  const rowsHtml = conflicts.map(docIpaConflictRowHtml).join("");
  const overlay = showModal(`
    <div class="modal-title">⚠ Duplicate IPAs found</div>
    <p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin:0 0 12px;">
      ${conflicts.length} IPA(s) in this file already exist by name — nothing has been saved yet. Review each and choose to skip or update, then apply.
      ${toInsert.length?` ${toInsert.length} new IPA(s) will also be added once you apply.`:""}
    </p>
    <div class="ds-conflict-bulk-actions">
      <button type="button" class="btn btn-ghost btn-sm" id="ipaConflictSkipAll">Skip all</button>
      <button type="button" class="btn btn-ghost btn-sm" id="ipaConflictUpdateAll">Update all with new data</button>
    </div>
    <div class="ds-conflict-list">${rowsHtml}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="ipaConflictCancel">Cancel import</button>
      <button class="btn btn-accent" id="ipaConflictApply">✔ Apply</button>
    </div>
  `);
  overlay.querySelector(".modal-box").classList.add("modal-box-wide");

  overlay.querySelector("#ipaConflictSkipAll").addEventListener("click", ()=>{
    overlay.querySelectorAll(".ds-conflict-action").forEach(sel=>{ sel.value="skip"; });
  });
  overlay.querySelector("#ipaConflictUpdateAll").addEventListener("click", ()=>{
    overlay.querySelectorAll(".ds-conflict-action").forEach(sel=>{ sel.value="update"; });
  });
  overlay.querySelector("#ipaConflictCancel").addEventListener("click", ()=>{
    closeModal();
    showToast("Import cancelled — no data was changed");
  });
  overlay.querySelector("#ipaConflictApply").addEventListener("click", ()=>{
    const resolutions = {};
    overlay.querySelectorAll(".ds-conflict-action").forEach(sel=>{ resolutions[sel.dataset.key] = sel.value; });
    const result = docIpaCommitImport(toInsert, conflicts, resolutions);
    closeModal();
    showToast(`Imported ${result.imported} new, updated ${result.updated}, skipped ${result.skipped} duplicate IPA(s)${skippedNoName?`, ${skippedNoName} had no name`:""}`);
    render();
  });
}

/* ---------------- Fill & generate modal ---------------- */
function openDocFillModal(entry){
  const rawText = docHtmlToLines(entry.body || "");
  const fields = docExtractFields(rawText);

  const fieldsHtml = fields.map(f=>{
    if(f.name === "additional_notes"){
      return `<div class="field"><label>Additional notes <span style="color:var(--text-dim);font-weight:400;">(optional — anything from the call not covered above)</span></label>
        <textarea class="doc-fill-input" data-field="additional_notes" rows="2" spellcheck="true" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:12.5px;box-sizing:border-box;font-family:inherit;"></textarea></div>`;
    }
    if(f.type === "ipa-select"){
      return `<div class="field"><label>IPA name</label>
        <input type="text" class="doc-fill-input" data-field="${f.name}" list="docIpaDatalist" placeholder="Start typing an IPA name..." spellcheck="true"></div>`;
    }
    if(f.type === "select" && f.options && f.options.length){
      return `<div class="field"><label>${esc(docLabelize(f.name))}</label>
        <select class="doc-fill-input" data-field="${f.name}"><option value="">—</option>${f.options.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select></div>`;
    }
    const inputType = f.type==="date" ? "date" : (f.type==="currency"||f.type==="number" ? "number" : "text");
    return `<div class="field"><label>${esc(docLabelize(f.name))}</label>
      <input type="${inputType}" class="doc-fill-input" data-field="${f.name}" spellcheck="true"></div>`;
  }).join("");

  const dispositions = entry.dispositions || [];
  const dispHtml = dispositions.length ? `
    <div class="doc-disposition-box">
      <div class="doc-disposition-title">📋 Suggested disposition${dispositions.length>1?'s':''}</div>
      ${dispositions.map(d=>`
        <div class="doc-disposition-row">
          <span class="doc-disposition-value">${esc(d.value)}</span>
          <button type="button" class="btn btn-ghost btn-sm doc-copy-disp-btn" data-value="${esc(d.value)}">📋 Copy</button>
        </div>
        ${d.rule ? `<div class="doc-disposition-rule">${esc(d.rule)}</div>` : ""}
      `).join("")}
    </div>` : "";

  const ipaDatalist = `<datalist id="docIpaDatalist">${(state.ipaDirectory||[]).map(i=>`<option value="${esc(i.name)}">`).join("")}</datalist>`;

  const overlay = showModal(`
    <div class="modal-title">${esc(entry.title)} <span style="color:var(--text-dim);font-weight:400;">— ${esc(entry.subtitle)}</span></div>
    ${dispHtml}
    ${fields.length ? `<div style="display:flex;flex-direction:column;gap:10px;margin-top:${dispHtml?'12px':'0'};">${fieldsHtml}</div>`
                     : `<p class="help-note" style="margin-top:${dispHtml?'10px':'0'};">This template has no call-specific fields — the note below is ready as-is.</p>`}
    ${ipaDatalist}
    <div class="field" style="margin-top:14px;">
      <label>Generated note</label>
      <textarea id="docGenOutput" rows="8" spellcheck="true" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:10px;font-size:12.5px;line-height:1.5;box-sizing:border-box;font-family:inherit;"></textarea>
      <div class="help-note">Regenerates automatically as you fill fields above. Edit it directly for any last wording fix — do that last, since changing a field afterward will refresh the whole box again.</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="docFillClose">Close</button>
      <button class="btn btn-accent" id="docFillCopy">📋 Copy note</button>
    </div>
  `);
  overlay.querySelector(".modal-box").classList.add("modal-box-wide");

  function currentValues(){
    const values = docBaseValues();
    overlay.querySelectorAll(".doc-fill-input").forEach(el=>{ values[el.dataset.field] = el.value; });
    return values;
  }
  function regenerate(){
    document.getElementById("docGenOutput").value = docRenderTemplate(rawText, currentValues());
  }
  regenerate();

  overlay.querySelectorAll(".doc-fill-input").forEach(el=>{
    el.addEventListener("input", regenerate);
    if(el.dataset.field === "ipa_name"){
      el.addEventListener("change", ()=>{
        const match = (state.ipaDirectory||[]).find(i => i.name.toLowerCase() === el.value.trim().toLowerCase());
        if(!match) return;
        const phoneEl = overlay.querySelector('.doc-fill-input[data-field="ipa_phone"]');
        const addrEl = overlay.querySelector('.doc-fill-input[data-field="ipa_address"]');
        if(phoneEl && !phoneEl.value) phoneEl.value = match.phone || "";
        if(addrEl && !addrEl.value) addrEl.value = match.address || "";
        regenerate();
      });
    }
  });

  overlay.querySelector("#docFillClose").addEventListener("click", closeModal);
  overlay.querySelector("#docFillCopy").addEventListener("click", ()=>{
    const text = document.getElementById("docGenOutput").value;
    docCopyPlainText(text, overlay.querySelector("#docFillCopy"));
    // Usage is audited by template identity only — never the filled-in field values,
    // which are call-specific/PHI-adjacent and were never persisted in the first place.
    logAudit("doc_template_used", `Used documentation template "${entry.title} — ${entry.subtitle}"`, {after:{lob:entry.lob, title:entry.title, subtitle:entry.subtitle}});
  });
  overlay.querySelectorAll(".doc-copy-disp-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> docCopyPlainText(btn.dataset.value, btn));
  });
}
