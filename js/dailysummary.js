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
  if(dsLOBFilter.length) rows = rows.filter(r=>dsLOBFilter.includes(r.lob));
  if(dsPeriodFilter!=="all") rows = rows.filter(r=>r.date && r.date.slice(0,7)===dsPeriodFilter);
  rows.sort((a,b)=> a.date.localeCompare(b.date) || String(a.lob).localeCompare(String(b.lob)));
  return rows;
}

/* ---------------- Totals (bottom of the table) ----------------
   How each column is combined over the selected LOBs + month:
   - counts (Forecast, Offered, Handled, custom numbers)  -> SUM
   - FTE columns                                          -> daily AVERAGE (LOBs added together per date, then averaged over the dates)
   - % columns                                            -> WEIGHTED average: Service Level & Abandoned by Offered,
                                                             Occupancy & Shrinkage by Actual FTE (falls back to a plain
                                                             average when the weight column is missing/empty)
   A parameter can override this with p.agg = "sum" | "avg" | "none". */
const DS_AVG_FIELDS = ["billableFTE","actualFTE"];
const DS_WEIGHT_BY = {serviceLevel:"offered", abandoned:"offered", occupancy:"actualFTE", shrinkage:"actualFTE"};
function dsNum(v){ if(v===undefined||v===null||v==="") return null; const n = Number(v); return isFinite(n) ? n : null; }
function dsAggKind(p){
  if(p.agg==="sum"||p.agg==="avg"||p.agg==="none") return p.agg;
  if(DS_AVG_FIELDS.includes(p.field)) return "avg";
  if(p.unit==="%") return DS_WEIGHT_BY[p.field] ? "wavg" : "avg";
  return "sum";
}
function dsTotalsFor(rows, params){
  const out = {days:new Set(rows.map(r=>r.date)).size, cells:{}};
  params.forEach(p=>{
    const kind = dsAggKind(p);
    const vals = rows.map(r=>({v:dsNum(r.values&&r.values[p.field]), r})).filter(x=>x.v!==null);
    if(kind==="none" || !vals.length){ out.cells[p.field] = {v:null, kind}; return; }
    if(kind==="sum"){ out.cells[p.field] = {v:vals.reduce((a,x)=>a+x.v,0), kind}; return; }
    if(kind==="wavg" && DS_WEIGHT_BY[p.field]){
      const wf = DS_WEIGHT_BY[p.field];
      let sw = 0, swv = 0;
      vals.forEach(x=>{ const w = dsNum(x.r.values && x.r.values[wf]); if(w!==null && w>0){ sw += w; swv += w*x.v; } });
      if(sw>0){ out.cells[p.field] = {v:swv/sw, kind:"wavg"}; return; }
    }
    if(p.unit!=="%"){   // FTE-style: add the LOBs together for each date, then average over the dates
      const perDate = {};
      vals.forEach(x=>{ perDate[x.r.date] = (perDate[x.r.date]||0) + x.v; });
      const ds = Object.values(perDate);
      out.cells[p.field] = {v:ds.reduce((a,b)=>a+b,0)/ds.length, kind:"avg"};
      return;
    }
    out.cells[p.field] = {v:vals.reduce((a,x)=>a+x.v,0)/vals.length, kind:"avg"};
  });
  return out;
}
function dsFmtTotal(v){
  if(v===null) return "—";
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US",{minimumFractionDigits:1, maximumFractionDigits:1});
}
function dsKindLabel(kind){ return kind==="sum" ? "Sum of all days" : kind==="wavg" ? "Weighted average" : kind==="avg" ? "Daily average" : ""; }

function dsTotalsFooter(rows, params, showLOBCol, selLOBs){
  // One row per LOB (only when 2+ LOBs are in view) plus a combined row.
  const groups = [];
  if(showLOBCol){
    const lobsInRows = Array.from(new Set(rows.map(r=>r.lob))).sort();
    lobsInRows.forEach(l=> groups.push({label:l, sub:true, rows:rows.filter(r=>r.lob===l)}));
  }
  const combinedLabel = showLOBCol ? (selLOBs.length ? selLOBs.join(" + ") : "All LOBs") + " — combined" : (rows[0] ? rows[0].lob : "") + " — total";
  groups.push({label:combinedLabel, sub:false, rows});
  const n = groups.length, ROW_H = 36;
  const trs = groups.map((g,i)=>{
    const t = dsTotalsFor(g.rows, params);
    const bottom = (n-1-i)*ROW_H;
    const cells = params.map(p=>{
      const c = t.cells[p.field];
      const style = (c.v!==null && !g.sub && p.direction && p.direction!=="none") ? cellColorStyle(p, c.v) : "";
      const tip = c.v!==null ? dsKindLabel(c.kind) : "";
      return `<td class="num" style="${style}" title="${esc(tip)}">${dsFmtTotal(c.v)}${c.v!==null && p.unit==="%" ? "%" : ""}</td>`;
    }).join("");
    return `<tr class="ds-foot-row${g.sub?" ds-foot-sub":" ds-foot-main"}" style="--ds-bottom:${bottom}px;height:${ROW_H}px;">
      <td colspan="${showLOBCol?3:2}">${g.sub ? "" : "Σ "}${esc(g.label)} <span class="ds-foot-days">· ${t.days} day${t.days===1?"":"s"}</span></td>
      ${cells}
      ${isWFM()?"<td></td>":""}
    </tr>`;
  }).join("");
  return `<tfoot>${trs}</tfoot>`;
}

function renderDailySummary(content, topActions){
  const params = dsActiveParams();
  const rows = dsFilteredRows();
  const periodOpts = dsPeriodOptions();

  topActions.innerHTML = `<button class="btn btn-ghost btn-sm" id="dsExportBtn" ${rows.length && params.length ? "" : "disabled"} title="Download the rows shown (selected LOBs + period) as Excel">⬇ Export data</button>`
    + (isWFM() ? ` <button class="btn btn-accent btn-sm" id="dsUploadBtn">⇧ Upload data</button>` : "");

  const lobChipsHtml = `<div class="ds-chips" id="dsLOBChips" role="group" aria-label="Filter by LOB">
    <button type="button" class="ds-chip ${!dsLOBFilter.length?"on":""}" data-lob="__all">All LOBs</button>${LOB_OPTIONS.map(l=>`<button type="button" class="ds-chip ${dsLOBFilter.includes(l)?"on":""}" data-lob="${esc(l)}">${esc(l)}</button>`).join("")}</div>`;
  const periodSelHtml = `<select id="dsPeriodSel" style="width:auto;"><option value="all" ${dsPeriodFilter==="all"?"selected":""}>All data</option>${periodOpts.map(p=>`<option value="${p}" ${dsPeriodFilter===p?"selected":""}>${dsFormatPeriod(p)}</option>`).join("")}</select>`;

  const showLOBCol = dsLOBFilter.length!==1;
  const thead = `<tr><th>Date</th><th>Day</th>${showLOBCol?"<th>LOB</th>":""}${params.map(p=>`<th class="num">${esc(p.name)}${p.unit?` (${esc(p.unit)})`:""}</th>`).join("")}${isWFM()?"<th></th>":""}</tr>`;
  const tbody = rows.length ? rows.map(r=>{
    const cells = params.map(p=>{
      const v = r.values ? r.values[p.field] : undefined;
      const hasVal = v!==undefined && v!==null && v!=="";
      const style = hasVal ? cellColorStyle(p, v) : "";
      return `<td class="num" style="${style}">${hasVal ? (Number.isInteger(v)?v:Number(v).toFixed(1)) : "—"}</td>`;
    }).join("");
    return `<tr>
      <td class="mono">${esc(r.date)}</td>
      <td class="mono">${esc(weekDayFromIso(r.date))}</td>
      ${showLOBCol?`<td>${esc(r.lob)}</td>`:""}
      ${cells}
      ${isWFM()?`<td><button class="icon-btn ds-del-btn" data-id="${esc(r.id)}" title="Delete this row">✕</button></td>`:""}
    </tr>`;
  }).join("") : "";

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">◧</span>Daily Summary</div>
        <div class="section-actions">${lobChipsHtml}${periodSelHtml}</div>
      </div>
      ${!params.length ? `<div class="empty-state" style="padding:24px;"><p>No parameters configured yet.${isWFM()?' Add some from Settings → Daily Summary parameters.':''}</p></div>` :
      !rows.length ? `<div class="empty-state" style="padding:24px;"><div class="big">▤</div><p>No Daily Summary data ${dsLOBFilter.length||dsPeriodFilter!=="all"?"for this filter":"yet"}.${isWFM()?' Use "Upload data" above to bring in a file.':''}</p></div>` :
      `<div class="section-body table-wrap" style="max-height:66vh;overflow-y:auto;"><table class="ds-table"><thead>${thead}</thead><tbody>${tbody}</tbody>${dsTotalsFooter(rows, params, showLOBCol, dsLOBFilter)}</table></div>
      <div class="help-note ds-foot-note">Totals cover exactly the rows shown above (selected LOBs + period). Counts are summed · % columns are weighted averages (Service Level &amp; Abandoned by Offered, Occupancy &amp; Shrinkage by Actual FTE) · FTE columns are daily averages. Hover a total to see how it was worked out.</div>`}
    </div>
  `;

  content.querySelectorAll("#dsLOBChips .ds-chip").forEach(b=> b.addEventListener("click", ()=>{
    const l = b.dataset.lob;
    if(l==="__all") dsLOBFilter = [];
    else{
      dsLOBFilter = dsLOBFilter.includes(l) ? dsLOBFilter.filter(x=>x!==l) : dsLOBFilter.concat(l);
      if(dsLOBFilter.length===LOB_OPTIONS.length) dsLOBFilter = [];   // every LOB ticked = All
    }
    render();
  }));
  const periodSel = document.getElementById("dsPeriodSel");
  if(periodSel) periodSel.addEventListener("change", e=>{ dsPeriodFilter = e.target.value; render(); });
  const uploadBtn = document.getElementById("dsUploadBtn");
  if(uploadBtn) uploadBtn.addEventListener("click", openDSUploadModal);
  const exportBtn = document.getElementById("dsExportBtn");
  if(exportBtn) exportBtn.addEventListener("click", dsExportData);
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

/* ---------------- Export (exactly what is on screen: selected LOBs + period) ---------------- */
function dsExportData(){
  const params = dsActiveParams(), rows = dsFilteredRows();
  if(!rows.length || !params.length){ showToast("Nothing to export for this filter"); return; }
  if(typeof XLSX==="undefined"){ showToast("⚠ The Excel library didn't load — check your connection and try again"); return; }
  const head = ["Date","Day","LOB"].concat(params.map(p=>p.name + (p.unit ? ` (${p.unit})` : "")));
  const aoa = [head];
  rows.forEach(r=>{
    aoa.push([r.date, weekDayFromIso(r.date), r.lob].concat(params.map(p=>{
      const v = r.values ? r.values[p.field] : undefined;
      if(v===undefined || v===null || v==="") return "";
      const n = Number(v); return isFinite(n) ? n : v;
    })));
  });
  // Totals use the same rules as the on-screen footer.
  const lobs = Array.from(new Set(rows.map(r=>r.lob))).sort();
  const totalRow = (label, rs)=>{
    const t = dsTotalsFor(rs, params);
    return ["Σ "+label+` · ${t.days} day${t.days===1?"":"s"}`, "", ""].concat(params.map(p=>{ const c = t.cells[p.field]; return c.v===null ? "" : Math.round(c.v*100)/100; }));
  };
  aoa.push([]);
  if(lobs.length>1) lobs.forEach(l=> aoa.push(totalRow(l, rows.filter(r=>r.lob===l))));
  aoa.push(totalRow(lobs.length>1 ? (dsLOBFilter.length ? dsLOBFilter.join(" + ") : "All LOBs")+" — combined" : lobs[0]+" — total", rows));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = head.map((h,i)=>({wch: i===0 ? 30 : Math.max(10, Math.min(24, h.length+2))}));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Daily Summary");
  const per = dsPeriodFilter==="all" ? "All_data" : dsFormatPeriod(dsPeriodFilter).replace(/\s+/g,"_");
  const lobTag = dsLOBFilter.length ? "_"+dsLOBFilter.join("-").replace(/[^a-z0-9-]+/gi,"") : "";
  XLSX.writeFile(wb, `Daily_Summary_${per}${lobTag}.xlsx`);
  try{ logAudit("Daily Summary exported", `${rows.length} row(s) · ${per}`); }catch(e){}
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
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 10px;">Confirm each column landed on the right field, then check the preview before importing. If a date+LOB already exists, you'll be asked to skip or update it before anything is saved.</p>
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
    const {toInsert, conflicts, skippedNoDate} = dsPrepareImport(sheetRows, liveMap, format, params, fallbackLOB);
    closeModal();
    if(!conflicts.length){
      const result = dsCommitImport(toInsert, [], {});
      showToast(`Imported ${result.imported} row(s)${skippedNoDate?`, skipped ${skippedNoDate} with no valid date`:""}`);
      render();
    } else {
      openDSConflictModal(toInsert, conflicts, skippedNoDate, params);
    }
  });
}

/* ---------------- Daily Summary import: duplicate detection & resolution ---------------- */
function dsPrepareImport(sheetRows, colMap, dateFormat, params, fallbackLOB){
  const byId = new Map((state.dailySummaryData||[]).map(r=>[`${r.date}__${r.lob}`, r]));
  const seenInFile = new Map(); // last occurrence of a date+LOB within the file wins over earlier ones in the same file
  let skippedNoDate = 0;
  sheetRows.forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    const iso = parseFlexibleDate(rec.__date, dateFormat);
    if(!iso){ skippedNoDate++; return; }
    const lob = String(rec.__lob||"").trim() || fallbackLOB;
    const values = {};
    params.forEach(p=>{
      const raw = rec[p.field];
      values[p.field] = (raw!==undefined && raw!==null && raw!=="" && !isNaN(Number(raw))) ? Number(raw) : "";
    });
    seenInFile.set(`${iso}__${lob}`, {iso, lob, values});
  });
  const toInsert = [];
  const conflicts = [];
  seenInFile.forEach(item=>{
    const key = `${item.iso}__${item.lob}`;
    const existing = byId.get(key);
    if(existing){
      conflicts.push({key, iso:item.iso, lob:item.lob, newValues:item.values, oldValues: existing.values||{}, existingRec: existing});
    } else {
      toInsert.push(item);
    }
  });
  return {toInsert, conflicts, skippedNoDate};
}

function dsCommitImport(toInsert, conflicts, resolutions){
  let imported = 0, updated = 0, skipped = 0;
  toInsert.forEach(item=>{
    const rec2 = {id:"ds"+Date.now()+Math.random().toString(36).slice(2,7), date:item.iso, lob:item.lob, values:item.values, uploadedBy: currentUser?currentUser.name:"", uploadedAt:new Date().toISOString()};
    state.dailySummaryData.push(rec2);
    imported++;
  });
  conflicts.forEach(c=>{
    const action = resolutions[c.key] || "skip";
    if(action==="update"){
      c.existingRec.values = c.newValues;
      c.existingRec.uploadedBy = currentUser ? currentUser.name : "";
      c.existingRec.uploadedAt = new Date().toISOString();
      updated++;
    } else {
      skipped++;
    }
  });
  saveState();
  logAudit("Daily Summary data uploaded", `Imported ${imported} new, updated ${updated}, skipped ${skipped} duplicate row(s)`);
  return {imported, updated, skipped};
}

function dsConflictParamRowHtml(p, oldV, newV){
  const fmtVal = v => (v!==undefined && v!==null && v!=="") ? (Number.isInteger(v)?v:Number(v).toFixed(1)) : "—";
  const oldDisp = fmtVal(oldV), newDisp = fmtVal(newV);
  const changed = String(oldV??"") !== String(newV??"");
  return `<div class="ds-conflict-param">
    <span class="ds-conflict-param-name">${esc(p.name)}</span>
    <span class="ds-conflict-param-old">${esc(String(oldDisp))}</span>
    <span class="ds-conflict-arrow">→</span>
    <span class="ds-conflict-param-new" style="${changed?'color:var(--yellow);font-weight:600;':''}">${esc(String(newDisp))}</span>
  </div>`;
}

function dsConflictRowHtml(c, params){
  const day = weekDayFromIso(c.iso);
  const [y,m] = c.iso.split("-").map(Number);
  const month = MONTHS[m-1];
  const paramsHtml = params.map(p=> dsConflictParamRowHtml(p, c.oldValues[p.field], c.newValues[p.field])).join("");
  return `
    <div class="ds-conflict-row" data-key="${esc(c.key)}">
      <div class="ds-conflict-head">
        <div>
          <div class="ds-conflict-date">${esc(fmtDate(c.iso))} <span class="ds-conflict-day">(${esc(day)})</span></div>
          <div class="ds-conflict-month">${esc(month)} ${y} · ${esc(c.lob)}</div>
        </div>
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
        ${paramsHtml}
      </div>
    </div>`;
}

function openDSConflictModal(toInsert, conflicts, skippedNoDate, params){
  const rowsHtml = conflicts.map(c=>dsConflictRowHtml(c, params)).join("");
  const overlay = showModal(`
    <div class="modal-title">⚠ Duplicate data found</div>
    <p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin:0 0 12px;">
      ${conflicts.length} row(s) in this file already exist for the same date and LOB — nothing has been saved yet. Review each and choose to skip or update, then apply.
      ${toInsert.length?` ${toInsert.length} new, non-conflicting row(s) will also be added once you apply.`:""}
    </p>
    <div class="ds-conflict-bulk-actions">
      <button type="button" class="btn btn-ghost btn-sm" id="dsConflictSkipAll">Skip all</button>
      <button type="button" class="btn btn-ghost btn-sm" id="dsConflictUpdateAll">Update all with new data</button>
    </div>
    <div class="ds-conflict-list">${rowsHtml}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="dsConflictCancel">Cancel import</button>
      <button class="btn btn-accent" id="dsConflictApply">✔ Apply</button>
    </div>
  `);
  overlay.querySelector(".modal-box").classList.add("modal-box-wide");

  overlay.querySelector("#dsConflictSkipAll").addEventListener("click", ()=>{
    overlay.querySelectorAll(".ds-conflict-action").forEach(sel=>{ sel.value="skip"; });
  });
  overlay.querySelector("#dsConflictUpdateAll").addEventListener("click", ()=>{
    overlay.querySelectorAll(".ds-conflict-action").forEach(sel=>{ sel.value="update"; });
  });
  overlay.querySelector("#dsConflictCancel").addEventListener("click", ()=>{
    closeModal();
    showToast("Import cancelled — no data was changed");
  });
  overlay.querySelector("#dsConflictApply").addEventListener("click", ()=>{
    const resolutions = {};
    overlay.querySelectorAll(".ds-conflict-action").forEach(sel=>{ resolutions[sel.dataset.key] = sel.value; });
    const result = dsCommitImport(toInsert, conflicts, resolutions);
    closeModal();
    showToast(`Imported ${result.imported} new, updated ${result.updated}, skipped ${result.skipped} duplicate row(s)${skippedNoDate?`, ${skippedNoDate} had no valid date`:""}`);
    render();
  });
}
