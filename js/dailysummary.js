/* ---------------- DAILY SUMMARY (LOB-wise ops numbers, TL and above) ---------------- */
function dsActiveParams(){ return (state.settings.dailySummary && state.settings.dailySummary.params) || []; }

function dsPeriodOptions(){
  const set = new Set();
  (state.dailySummaryData||[]).forEach(r=>{ if(r.date) set.add(r.date.slice(0,7)); });
  return Array.from(set).sort().reverse();
}
function dsFormatPeriod(ym){
  const [y,m] = ym.split("-").map(Number);
  return `${MONTHS[m-1]} ${y}`;
}
function dsFilteredRows(){
  let rows = (state.dailySummaryData||[]).slice();
  if(dsLOBFilter!=="all") rows = rows.filter(r=>r.lob===dsLOBFilter);
  if(dsPeriodFilter!=="all") rows = rows.filter(r=>r.date && r.date.slice(0,7)===dsPeriodFilter);
  rows.sort((a,b)=> b.date.localeCompare(a.date) || String(a.lob).localeCompare(String(b.lob)));
  return rows;
}

function renderDailySummary(content, topActions){
  const params = dsActiveParams();
  const rows = dsFilteredRows();
  const periodOpts = dsPeriodOptions();

  topActions.innerHTML = isWFM() ? `<button class="btn btn-accent btn-sm" id="dsUploadBtn">⇧ Upload data</button>` : "";

  const lobSelHtml = `<select id="dsLOBSel" style="width:auto;"><option value="all" ${dsLOBFilter==="all"?"selected":""}>All LOBs</option>${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${dsLOBFilter===l?"selected":""}>${esc(l)}</option>`).join("")}</select>`;
  const periodSelHtml = `<select id="dsPeriodSel" style="width:auto;"><option value="all" ${dsPeriodFilter==="all"?"selected":""}>All data</option>${periodOpts.map(p=>`<option value="${p}" ${dsPeriodFilter===p?"selected":""}>${dsFormatPeriod(p)}</option>`).join("")}</select>`;

  const showLOBCol = dsLOBFilter==="all";
  const thead = `<tr><th>Date</th>${showLOBCol?"<th>LOB</th>":""}${params.map(p=>`<th class="num">${esc(p.name)}${p.unit?` (${esc(p.unit)})`:""}</th>`).join("")}${isWFM()?"<th></th>":""}</tr>`;
  const tbody = rows.length ? rows.map(r=>{
    const cells = params.map(p=>{
      const v = r.values ? r.values[p.field] : undefined;
      const hasVal = v!==undefined && v!==null && v!=="";
      const style = hasVal ? cellColorStyle(p, v) : "";
      return `<td class="num" style="${style}">${hasVal ? (Number.isInteger(v)?v:Number(v).toFixed(1)) : "—"}</td>`;
    }).join("");
    return `<tr>
      <td class="mono">${esc(r.date)}</td>
      ${showLOBCol?`<td>${esc(r.lob)}</td>`:""}
      ${cells}
      ${isWFM()?`<td><button class="icon-btn ds-del-btn" data-id="${esc(r.id)}" title="Delete this row">✕</button></td>`:""}
    </tr>`;
  }).join("") : "";

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">◧</span>Daily Summary</div>
        <div class="section-actions">${lobSelHtml}${periodSelHtml}</div>
      </div>
      ${!params.length ? `<div class="empty-state" style="padding:24px;"><p>No parameters configured yet.${isWFM()?' Add some from Settings → Daily Summary parameters.':''}</p></div>` :
      !rows.length ? `<div class="empty-state" style="padding:24px;"><div class="big">▤</div><p>No Daily Summary data ${dsLOBFilter!=="all"||dsPeriodFilter!=="all"?"for this filter":"yet"}.${isWFM()?' Use "Upload data" above to bring in a file.':''}</p></div>` :
      `<div class="section-body table-wrap" style="max-height:66vh;overflow-y:auto;"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`}
    </div>
  `;

  const lobSel = document.getElementById("dsLOBSel");
  if(lobSel) lobSel.addEventListener("change", e=>{ dsLOBFilter = e.target.value; render(); });
  const periodSel = document.getElementById("dsPeriodSel");
  if(periodSel) periodSel.addEventListener("change", e=>{ dsPeriodFilter = e.target.value; render(); });
  const uploadBtn = document.getElementById("dsUploadBtn");
  if(uploadBtn) uploadBtn.addEventListener("click", openDSUploadModal);
  content.querySelectorAll(".ds-del-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      const row = (state.dailySummaryData||[]).find(r=>r.id===id);
      showConfirm(`Delete the Daily Summary row for ${row?esc(row.lob)+" · "+esc(row.date):"this date"}? This can't be undone.`, ()=>{
        state.dailySummaryData = state.dailySummaryData.filter(r=>r.id!==id);
        saveState();
        logAudit("Daily Summary row deleted", `Deleted ${row?row.lob+" "+row.date:id}`);
        render();
      });
    });
  });
}

/* ---------------- Upload + column mapping ---------------- */
function dsNormalizeHeader(h){ return normalizeHeader(h); }
function dsMatchField(headerNorm, params){
  if(["date","summarydate","reportdate"].includes(headerNorm)) return "__date";
  if(["lob","linofbusiness","process","queue"].includes(headerNorm)) return "__lob";
  const p = params.find(p=>{
    const n1 = dsNormalizeHeader(p.name);
    const n2 = dsNormalizeHeader(p.name.replace(/\(.*?\)/g,""));
    const n3 = dsNormalizeHeader(p.field);
    return n1===headerNorm || n2===headerNorm || n3===headerNorm;
  });
  return p ? p.field : "";
}
function dsDetectColumnMap(headers, params){
  const map = {};
  headers.forEach(h=>{
    const f = dsMatchField(dsNormalizeHeader(h), params);
    if(f && !Object.values(map).includes(f)) map[h] = f;
  });
  return map;
}
function dsFieldLabel(field, params){
  if(field==="__date") return "Date";
  if(field==="__lob") return "LOB";
  const p = params.find(pp=>pp.field===field);
  return p ? p.name : field;
}

function openDSUploadModal(){
  const overlay = showModal(`
    <div class="modal-title">Upload Daily Summary data</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.6;margin:0 0 14px;">
      Upload a CSV or Excel file with one row per date. If your file already has separate columns for Date and LOB, they'll be auto-detected. Otherwise, pick which LOB this file belongs to below.
    </p>
    <div class="field" style="margin-bottom:12px;">
      <label>If the file has no LOB column, use this LOB for every row</label>
      <select id="dsUploadLOBSel" style="width:100%;">${LOB_OPTIONS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("")}</select>
    </div>
    <div class="field"><input type="file" id="dsUploadFileInput" accept=".csv,.xlsx,.xls"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="dsUploadCancel">Cancel</button>
      <button class="btn btn-accent" id="dsUploadNext">Next: review mapping</button>
    </div>
  `);
  overlay.querySelector("#dsUploadCancel").addEventListener("click", closeModal);
  overlay.querySelector("#dsUploadNext").addEventListener("click", async ()=>{
    const file = document.getElementById("dsUploadFileInput").files[0];
    if(!file){ showToast("Choose a file first"); return; }
    const fallbackLOB = document.getElementById("dsUploadLOBSel").value;
    const btn = document.getElementById("dsUploadNext");
    btn.textContent = "Reading…"; btn.disabled = true;
    try{
      const sheetRows = await readSheetRows(file);
      const params = dsActiveParams();
      const headers = Object.keys(sheetRows[0]||{});
      const colMap = dsDetectColumnMap(headers, params);
      openDSReviewModal(sheetRows, colMap, params, fallbackLOB);
    }catch(err){
      console.error(err);
      showToast("⚠ Could not read that file");
      btn.textContent = "Next: review mapping"; btn.disabled = false;
    }
  });
}

function dsBuildPreviewRows(sheetRows, colMap, dateFormat, params, fallbackLOB){
  return sheetRows.slice(0,5).map(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    const iso = parseFlexibleDate(rec.__date, dateFormat);
    const lob = String(rec.__lob||"").trim() || fallbackLOB;
    const dateCell = iso ? iso : (rec.__date ? esc(String(rec.__date))+" ⚠" : "—");
    const cells = [`<td class="mono" style="${iso?'':'color:var(--red);font-weight:600;'}">${dateCell}</td>`, `<td>${esc(lob)}</td>`];
    params.forEach(p=> cells.push(`<td class="num">${rec[p.field]!==undefined && rec[p.field]!==""?esc(String(rec[p.field])):"—"}</td>`));
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
}

function openDSReviewModal(sheetRows, colMap, params, fallbackLOB){
  const headers = Object.keys(sheetRows[0]||{});
  const FIELD_OPTIONS = ["", "__date", "__lob", ...params.map(p=>p.field)];
  const rowsHtml = headers.map(h=>{
    const current = colMap[h] || "";
    const opts = FIELD_OPTIONS.map(f=>`<option value="${f}" ${f===current?"selected":""}>${f?esc(dsFieldLabel(f,params)):"— Ignore this column —"}</option>`).join("");
    return `<tr><td class="mono">${esc(h)}</td><td><select class="cell-select ds-map-col-sel" data-header="${esc(h)}" style="width:100%;">${opts}</select></td></tr>`;
  }).join("");
  const previewHead = `<th>Date</th><th>LOB</th>${params.map(p=>`<th class="num">${esc(p.name)}</th>`).join("")}`;

  const overlay = showModal(`
    <div class="modal-title">Review column mapping</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 10px;">Confirm each column landed on the right field, then check the preview before importing. Uploading a date+LOB that already exists overwrites that row.</p>
    <div class="field" style="margin-bottom:12px;">
      <label>Date format in file</label>
      <select id="dsDateFormatSel" style="width:100%;">
        <option value="auto">Auto-detect (recommended)</option>
        <option value="dmy">DD-MM-YYYY</option>
        <option value="mdy">MM-DD-YYYY</option>
        <option value="ymd">YYYY-MM-DD</option>
      </select>
    </div>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr><th>File column</th><th>Maps to</th></tr></thead><tbody id="dsColMapBody">${rowsHtml}</tbody></table>
    </div>
    <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Preview — first ${Math.min(5,sheetRows.length)} row(s)</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr>${previewHead}</tr></thead><tbody id="dsPreviewBody">${dsBuildPreviewRows(sheetRows, colMap, "auto", params, fallbackLOB)}</tbody></table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="dsImportBack">Back</button>
      <button class="btn btn-accent" id="dsImportCommit">✔ Import now</button>
    </div>
  `);

  const refresh = ()=>{
    const format = document.getElementById("dsDateFormatSel").value;
    const liveMap = {};
    overlay.querySelectorAll(".ds-map-col-sel").forEach(sel=>{ if(sel.value) liveMap[sel.dataset.header] = sel.value; });
    document.getElementById("dsPreviewBody").innerHTML = dsBuildPreviewRows(sheetRows, liveMap, format, params, fallbackLOB);
    return {liveMap, format};
  };
  overlay.querySelectorAll(".ds-map-col-sel").forEach(sel=> sel.addEventListener("change", refresh));
  document.getElementById("dsDateFormatSel").addEventListener("change", refresh);

  overlay.querySelector("#dsImportBack").addEventListener("click", ()=>{ closeModal(); openDSUploadModal(); });
  overlay.querySelector("#dsImportCommit").addEventListener("click", ()=>{
    const {liveMap, format} = refresh();
    if(!Object.values(liveMap).includes("__date")){ showToast("Map at least one column to Date before importing"); return; }
    const result = dsImportRows(sheetRows, liveMap, format, params, fallbackLOB);
    closeModal();
    showToast(`Imported ${result.imported} row(s)${result.skipped?`, skipped ${result.skipped} with no valid date`:""}`);
    render();
  });
}

function dsImportRows(sheetRows, colMap, dateFormat, params, fallbackLOB){
  let imported = 0, skipped = 0;
  const byId = new Map((state.dailySummaryData||[]).map(r=>[`${r.date}__${r.lob}`, r]));
  sheetRows.forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    const iso = parseFlexibleDate(rec.__date, dateFormat);
    if(!iso){ skipped++; return; }
    const lob = String(rec.__lob||"").trim() || fallbackLOB;
    const values = {};
    params.forEach(p=>{
      const raw = rec[p.field];
      values[p.field] = (raw!==undefined && raw!==null && raw!=="" && !isNaN(Number(raw))) ? Number(raw) : "";
    });
    const key = `${iso}__${lob}`;
    const existing = byId.get(key);
    if(existing){
      existing.values = values;
      existing.uploadedBy = currentUser ? currentUser.name : "";
      existing.uploadedAt = new Date().toISOString();
    } else {
      const rec2 = {id:"ds"+Date.now()+Math.random().toString(36).slice(2,7), date:iso, lob, values, uploadedBy: currentUser?currentUser.name:"", uploadedAt:new Date().toISOString()};
      state.dailySummaryData.push(rec2);
      byId.set(key, rec2);
    }
    imported++;
  });
  saveState();
  logAudit("Daily Summary data uploaded", `Imported ${imported} row(s)${fallbackLOB?` (LOB: ${fallbackLOB})`:""}`);
  return {imported, skipped};
}
