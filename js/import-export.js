/* ---------------- Raw data import (CSV / XLSX) ---------------- */
const HEADER_MAP = {
  date: ["date"],
  agent: ["agentname","agent","name","employee","employeename"],
  aht: ["ahtsec","aht","avghandletime","avghandletimesec"],
  cq: ["callqualitypct","callquality","cq","cqpct","cq%"],
  pkt: ["pktscorepct","pktscore","pkt","pktpct","pkt%"],
  calls: ["totalcalls","calls","callshandled"],
  attendance: ["attendance","status"],
  leaveType: ["leavetype","leavecode","leave"]
};
function normalizeHeader(h){ return String(h).toLowerCase().replace(/[^a-z0-9%]/g,""); }
function esc(s){
  return String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function normalizeName(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
function levenshtein(a,b){
  const m=a.length,n=b.length;
  if(!m) return n; if(!n) return m;
  const dp = Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);
  for(let j=0;j<=n;j++) dp[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++){
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j-1],dp[i-1][j],dp[i][j-1]);
  }
  return dp[m][n];
}
function findSimilarAgent(nameRaw, roster){
  const norm = normalizeName(nameRaw);
  let best = null, bestDist = Infinity;
  roster.forEach(a=>{
    const aNorm = normalizeName(a.name);
    if(aNorm===norm) return; // handled as exact match elsewhere
    const dist = levenshtein(norm, aNorm);
    const closeEnough = norm.length>=5 && dist<=2;
    if(closeEnough && dist<bestDist){ best=a; bestDist=dist; }
  });
  return best;
}
function matchField(headerNorm){
  for(const [field,cands] of Object.entries(HEADER_MAP)){
    if(cands.includes(headerNorm)) return field;
  }
  const m = state.settings.metrics.find(m=>{
    const n1 = normalizeHeader(m.name);
    const n2 = normalizeHeader(m.name.replace(/\(.*?\)/g,""));
    return n1===headerNorm || n2===headerNorm;
  });
  return m ? m.field : null;
}
function excelSerialToDate(serial){
  const utcDays = Math.floor(serial - 25569);
  return new Date(utcDays*86400*1000);
}
function parseFlexibleDate(v, format){
  format = format || "auto";
  if(v instanceof Date && !isNaN(v)) return isoFromJSDate(v);
  if(typeof v === "number") return isoFromJSDate(excelSerialToDate(v));
  if(typeof v !== "string") return null;
  const s = v.trim();
  if(!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3,}|\d{1,2})[-\/\s](\d{2,4})/);
  if(m){
    const p1 = +m[1];
    const yearPart = m[3].length===2 ? 2000+ +m[3] : +m[3];
    let day, monIdx;
    if(/^[A-Za-z]+$/.test(m[2])){
      day = p1;
      monIdx = MONTHS.findIndex(mo=>mo.toLowerCase().startsWith(m[2].toLowerCase().slice(0,3)));
    } else {
      const p2 = +m[2];
      if(format==="mdy"){ monIdx = p1-1; day = p2; }
      else if(format==="dmy"){ day = p1; monIdx = p2-1; }
      else if(format==="ymd"){ day = p2; monIdx = p1-1; } // rarely hit here (ISO already caught above)
      else {
        // auto: use whichever component can only be a day (>12) to disambiguate; default to DMY if both are ambiguous (<=12)
        if(p1>12 && p2<=12){ day=p1; monIdx=p2-1; }
        else if(p2>12 && p1<=12){ day=p2; monIdx=p1-1; }
        else { day=p1; monIdx=p2-1; }
      }
    }
    if(monIdx>=0 && monIdx<=11 && day>=1 && day<=31) return `${yearPart}-${pad2(monIdx+1)}-${pad2(day)}`;
  }
  const d = new Date(s);
  if(!isNaN(d)) return isoFromJSDate(d);
  return null;
}
async function readSheetRows(file){
  const ext = file.name.split(".").pop().toLowerCase();
  let sheetRows;
  if(ext === "csv"){
    const text = await file.text();
    const wb = XLSX.read(text, {type:"string"});
    sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""});
  } else {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, {type:"array", cellDates:true});
    sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:""});
  }
  if(!sheetRows.length) throw new Error("empty file");
  return sheetRows;
}
function detectColumnMap(sheetRows){
  const colMap = {};
  Object.keys(sheetRows[0]||{}).forEach(k=>{
    const f = matchField(normalizeHeader(k));
    if(f && !Object.values(colMap).includes(f)) colMap[k] = f;
  });
  return colMap;
}
function importDataFile(sheetRows, colMap, dateFormat){
  if(!Object.values(colMap).includes("date") || !Object.values(colMap).includes("agent")){
    throw new Error("missing required columns (need at least Date and Agent Name)");
  }

  const metrics = coreMetrics().filter(m=>(m.inputType||"number")!=="dropdown" && (m.inputType||"number")!=="radio");
  let importedCount = 0, newAgents = 0, skippedPkt = 0, skippedDate = 0, overwrittenCount = 0, agentCounter = state.roster.length + 1;
  const dupWarnings = [];
  const seenKeysThisImport = new Map(); // `${agent}__${iso}` -> row number, to catch the file mapping two rows to the same agent+date
  let lastIso = null, lastNameRaw = null;
  sheetRows.forEach((row,rowIdx)=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    let iso = parseFlexibleDate(rec.date, dateFormat);
    let nameRaw = String(rec.agent||"").trim();
    // Fill-down: many Excel exports only show the Date/Agent value on the first row of a
    // group and leave the cell blank below it (a merged cell). Treat a blank as "same as above"
    // rather than silently dropping the row or leaving it unmapped.
    if(!iso && !String(rec.date||"").trim() && lastIso) iso = lastIso;
    if(!nameRaw && lastNameRaw) nameRaw = lastNameRaw;
    if(!nameRaw) return;
    if(!iso){ skippedDate++; return; }
    lastIso = iso; lastNameRaw = nameRaw;

    let agent = state.roster.find(a=>normalizeName(a.name)===normalizeName(nameRaw));
    if(!agent){
      const similar = findSimilarAgent(nameRaw, state.roster);
      if(similar && !dupWarnings.some(w=>w.imported===nameRaw && w.existing===similar.name)){
        dupWarnings.push({imported:nameRaw, existing:similar.name});
      }
      let empId;
      do{ empId = "IMP"+String(agentCounter).padStart(3,"0"); agentCounter++; }while(state.roster.some(a=>a.empId===empId));
      agent = {empId, name:nameRaw, joiningDate:iso, status:"Active", inactiveSince:"", notes:"Added via import"};
      state.roster.push(agent);
      newAgents++;
    } else if(iso < agent.joiningDate){
      agent.joiningDate = iso;
    }

    const rowKey = `${agent.empId}__${iso}`;
    if(seenKeysThisImport.has(rowKey)) overwrittenCount++;
    seenKeysThisImport.set(rowKey, rowIdx);

    let attendance = String(rec.attendance||"").trim();
    const attMatch = ATTENDANCE_OPTIONS.find(o=>o.toLowerCase()===attendance.toLowerCase());
    attendance = attMatch || "";
    let leaveType = String(rec.leaveType||"").trim().toUpperCase();
    if(!state.settings.leaveTypes.some(lt=>lt.code===leaveType)) leaveType = "";

    const dailyRec = {attendance, leaveType};
    const pktAlreadyLocked = pktLockedForDate(agent.empId, iso);
    let anyMetricVal = false;
    metrics.forEach(m=>{
      if(m.field==="pkt" && pktAlreadyLocked){
        if(rec[m.field]!==undefined && rec[m.field]!==null && rec[m.field]!=="") skippedPkt++;
        dailyRec[m.field] = ""; return;
      }
      const raw = rec[m.field];
      const num = (raw!==undefined && raw!==null && raw!=="" && !isNaN(Number(raw))) ? Number(raw) : "";
      dailyRec[m.field] = num;
      if(num!=="") anyMetricVal = true;
    });
    if(!attendance && anyMetricVal) dailyRec.attendance = "Present";

    state.daily[dKey(agent.empId, iso)] = dailyRec;
    importedCount++;
  });

  saveState();
  return {rows:importedCount, newAgents, skippedPkt, skippedDate, overwrittenCount, dupWarnings};
}
function showDuplicateWarningModal(warnings){
  const rows = warnings.map(w=>`<tr><td>${esc(w.imported)}</td><td>${esc(w.existing)}</td></tr>`).join("");
  const overlay = showModal(`
    <div class="modal-title">⚠ Possible duplicate agents</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 12px;">
      These imported names were close but not identical to an existing roster name, so they were added as new, separate agents instead of being merged. If these are actually the same person, go to Team Roster to rename or remove the duplicate — otherwise their data will stay split across two agents.
    </p>
    <div class="table-wrap" style="max-height:240px;overflow-y:auto;">
      <table class="mini-table"><thead><tr><th>Newly added as</th><th>Close to existing</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-accent" id="dupWarnOk">Got it</button>
    </div>
  `);
  overlay.querySelector("#dupWarnOk").addEventListener("click", closeModal);
}
function fieldLabel(field){
  const m = coreMetrics().find(mm=>mm.field===field);
  if(m) return m.name;
  return {date:"Date", agent:"Agent Name", attendance:"Attendance", leaveType:"Leave Type"}[field] || field;
}
function openImportModal(){
  const overlay = showModal(`
    <div class="modal-title">Import raw data</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.6;margin:0 0 14px;">
      Upload a CSV or Excel file. On the next step you'll see exactly how each column was detected — and can fix anything — before any data is saved.
    </p>
    <div class="field"><input type="file" id="importFileInput" accept=".csv,.xlsx,.xls"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="importCancel">Cancel</button>
      <button class="btn btn-accent" id="importNext">Next: review mapping</button>
    </div>
  `);
  overlay.querySelector("#importCancel").addEventListener("click", closeModal);
  overlay.querySelector("#importNext").addEventListener("click", async ()=>{
    const file = document.getElementById("importFileInput").files[0];
    if(!file){ showToast("Choose a file first"); return; }
    const btn = document.getElementById("importNext");
    btn.textContent = "Reading…"; btn.disabled = true;
    try{
      const sheetRows = await readSheetRows(file);
      const colMap = detectColumnMap(sheetRows);
      openImportReviewModal(sheetRows, colMap);
    }catch(err){
      console.error(err);
      showToast("⚠ Could not read that file");
      btn.textContent = "Next: review mapping"; btn.disabled = false;
    }
  });
}
function buildPreviewRows(sheetRows, colMap, dateFormat, metrics){
  let lastIso = null, lastAgent = null;
  const html = [];
  sheetRows.slice(0,5).forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    let iso = parseFlexibleDate(rec.date, dateFormat);
    let agentDisplay = String(rec.agent||"").trim();
    const filledDate = !iso && !String(rec.date||"").trim() && lastIso;
    const filledAgent = !agentDisplay && lastAgent;
    if(filledDate) iso = lastIso;
    if(filledAgent) agentDisplay = lastAgent;
    if(iso) lastIso = iso;
    if(agentDisplay) lastAgent = agentDisplay;
    const dateCell = iso ? `${iso}${filledDate?' <span style="color:var(--text-dim);">(filled down)</span>':''}` : (rec.date ? esc(String(rec.date))+" ⚠" : "—");
    const cells = [`<td class="mono" style="${iso?'':'color:var(--red);font-weight:600;'}">${dateCell}</td>`,
      `<td>${agentDisplay?esc(agentDisplay)+(filledAgent?' <span style="color:var(--text-dim);">(filled down)</span>':''):"—"}</td>`];
    metrics.forEach(m=> cells.push(`<td class="num">${rec[m.field]!==undefined && rec[m.field]!=="" ? esc(String(rec[m.field])) : "—"}</td>`));
    cells.push(`<td>${esc(String(rec.attendance||"—"))}</td>`, `<td>${esc(String(rec.leaveType||"—"))}</td>`);
    html.push(`<tr>${cells.join("")}</tr>`);
  });
  return html.join("");
}
function openImportReviewModal(sheetRows, colMap){
  const headers = Object.keys(sheetRows[0]||{});
  const metrics = coreMetrics().filter(m=>(m.inputType||"number")!=="dropdown" && (m.inputType||"number")!=="radio");
  const FIELD_OPTIONS = ["", "date", "agent", ...metrics.map(m=>m.field), "attendance", "leaveType"];
  const rowsHtml = headers.map(h=>{
    const current = colMap[h] || "";
    const opts = FIELD_OPTIONS.map(f=>`<option value="${f}" ${f===current?'selected':''}>${f?esc(fieldLabel(f)):"— Ignore this column —"}</option>`).join("");
    return `<tr><td class="mono">${esc(h)}</td><td><select class="cell-select map-col-sel" data-header="${esc(h)}" style="width:100%;">${opts}</select></td></tr>`;
  }).join("");
  const previewHead = `<th>Date</th><th>Agent</th>${metrics.map(m=>`<th class="num">${esc(m.name)}</th>`).join("")}<th>Attendance</th><th>Leave Type</th>`;

  const overlay = showModal(`
    <div class="modal-title">Review column mapping</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 10px;">Check each column landed on the right field, and confirm how dates should be read — then check the live preview below before importing. Blank Date/Agent cells (common with merged cells in Excel) are filled down from the row above — watch for "(filled down)" in the preview.</p>
    <div class="field" style="margin-bottom:12px;">
      <label>Date format in file</label>
      <select id="dateFormatSel" style="width:100%;">
        <option value="auto">Auto-detect (recommended)</option>
        <option value="dmy">DD-MM-YYYY (e.g. 21-07-2026)</option>
        <option value="mdy">MM-DD-YYYY (e.g. 07-21-2026)</option>
        <option value="ymd">YYYY-MM-DD</option>
      </select>
    </div>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr><th>File column</th><th>Maps to</th></tr></thead><tbody id="colMapBody">${rowsHtml}</tbody></table>
    </div>
    <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Preview — first ${Math.min(5,sheetRows.length)} row(s)</div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr>${previewHead}</tr></thead><tbody id="importPreviewBody">${buildPreviewRows(sheetRows, colMap, "auto", metrics)}</tbody></table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="importBack">Back</button>
      <button class="btn btn-accent" id="importCommit">✔ Import now</button>
    </div>
  `);

  const refreshPreview = ()=>{
    const format = document.getElementById("dateFormatSel").value;
    const liveMap = {};
    overlay.querySelectorAll(".map-col-sel").forEach(sel=>{
      if(sel.value) liveMap[sel.dataset.header] = sel.value;
    });
    document.getElementById("importPreviewBody").innerHTML = buildPreviewRows(sheetRows, liveMap, format, metrics);
    return {liveMap, format};
  };
  overlay.querySelectorAll(".map-col-sel").forEach(sel=> sel.addEventListener("change", refreshPreview));
  document.getElementById("dateFormatSel").addEventListener("change", refreshPreview);

  overlay.querySelector("#importBack").addEventListener("click", ()=>{ closeModal(); openImportModal(); });
  overlay.querySelector("#importCommit").addEventListener("click", ()=>{
    const {liveMap, format} = refreshPreview();
    if(!Object.values(liveMap).includes("date") || !Object.values(liveMap).includes("agent")){
      showToast("Map at least one column to Date and one to Agent Name"); return;
    }
    const btn = document.getElementById("importCommit");
    btn.textContent = "Importing…"; btn.disabled = true;
    try{
      const result = importDataFile(sheetRows, liveMap, format);
      closeModal(); render();
      const skipNote = result.skippedDate ? ` — ${result.skippedDate} row(s) skipped, date couldn't be read` : "";
      const overwriteNote = result.overwrittenCount ? ` ⚠ ${result.overwrittenCount} row(s) mapped to the same agent+date more than once — later rows overwrote earlier ones, check your file layout` : "";
      showToast(`✅ Imported ${result.rows} row(s)${result.newAgents ? `, added ${result.newAgents} new agent(s)` : ""}${result.skippedPkt ? `. Skipped ${result.skippedPkt} extra PKT value(s) — only one entry per week is kept` : ""}${skipNote}${overwriteNote}`);
      if(result.dupWarnings && result.dupWarnings.length) showDuplicateWarningModal(result.dupWarnings);
    }catch(err){
      console.error(err);
      showToast("⚠ Import failed — check the mapping");
      btn.textContent = "✔ Import now"; btn.disabled = false;
    }
  });
}


/* ---------------- Export to Excel ---------------- */
function openExportModal(){
  const overlay = showModal(`
    <div class="modal-title">Export to Excel</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 14px;">Choose which views to include as sheets in the exported workbook, for ${viewPeriod.month} ${viewPeriod.year}.</p>
    <label class="check-row"><input type="checkbox" id="expDaily" checked> Daily Data</label>
    <div id="expDailyScopeWrap" style="margin:2px 0 10px 24px;display:flex;flex-direction:column;gap:4px;">
      <label class="check-row" style="font-size:12px;"><input type="radio" name="expDailyScope" value="day" checked> Selected day only (${fmtDate(dashSelectedDate)})</label>
      <label class="check-row" style="font-size:12px;"><input type="radio" name="expDailyScope" value="month"> Entire month</label>
    </div>
    <label class="check-row"><input type="checkbox" id="expWeekly" checked> Weekly Summary (all weeks)</label>
    <label class="check-row"><input type="checkbox" id="expMonthly" checked> Monthly Summary</label>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="expCancel">Cancel</button>
      <button class="btn btn-accent" id="expGo">⬇ Export</button>
    </div>
  `);
  overlay.querySelector("#expCancel").addEventListener("click", closeModal);
  const dailyChk = document.getElementById("expDaily"), scopeWrap = document.getElementById("expDailyScopeWrap");
  dailyChk.addEventListener("change", ()=>{ scopeWrap.style.display = dailyChk.checked ? "flex" : "none"; });
  overlay.querySelector("#expGo").addEventListener("click", (e)=>{
    const wantDaily = document.getElementById("expDaily").checked;
    const wantWeekly = document.getElementById("expWeekly").checked;
    const wantMonthly = document.getElementById("expMonthly").checked;
    const dailyScope = overlay.querySelector('input[name="expDailyScope"]:checked')?.value || "day";
    if(!wantDaily && !wantWeekly && !wantMonthly){ showToast("Select at least one option"); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = "Exporting…";
    // rAF lets the "Exporting…" label paint before the sync XLSX build blocks the thread.
    requestAnimationFrame(()=>{
      try{
        exportExcel({wantDaily,wantWeekly,wantMonthly,dailyScope,dailyDate:dashSelectedDate});
        closeModal();
        showToast("✅ Export ready — check your downloads");
      }catch(e){
        console.error(e); showToast("⚠ Export failed");
        btn.disabled = false; btn.textContent = "⬇ Export";
      }
    });
  });
}
function exportExcel({wantDaily,wantWeekly,wantMonthly,dailyScope,dailyDate}){
  const mIdx = currentMonthIdx(), y = viewYear();
  const metrics = coreMetrics();
  const wb = XLSX.utils.book_new();
  const monthRows = monthDailyRows(mIdx,y,"all");

  if(wantDaily){
    let rows = monthRows;
    if(dailyScope==="day" && dailyDate) rows = rows.filter(r=>r.iso===dailyDate);
    rows = rows.slice().sort((a,b)=> a.iso===b.iso ? (rosterRank(a.empId)-rosterRank(b.empId) || a.name.localeCompare(b.name)) : a.iso.localeCompare(b.iso));
    const data = rows.map(r=>{
      const row = {Date:r.iso, Day:weekDayLabel(y,mIdx,r.d), Agent:r.name};
      metrics.forEach(m=> row[m.name] = (r[m.field]!==""&&r[m.field]!=null) ? r[m.field] : "");
      row.Attendance = r.attendance || "";
      row["Leave Type"] = r.leaveType || "";
      return row;
    });
    const sheetName = dailyScope==="day" && dailyDate ? `Daily ${dailyDate}` : "Daily Data";
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length?data:[{Note:"No data"}]), sheetName.slice(0,31));
  }
  if(wantWeekly){
    const weeksInMonth = weekOfDay(y, mIdx, daysInMonth(mIdx,y));
    for(let w=1; w<=weeksInMonth; w++){
      const agg = sortByRoster(agentAggregate(filterRowsByWeek(monthRows, w)));
      const data = agg.map(a=>{
        const row = {Agent:a.name};
        metrics.forEach(m=> row[m.name] = a.values[m.field]!=null ? Number(a.values[m.field].toFixed(m.field==="calls"?0:2)) : "");
        row["Leave Days"] = a.leaveDays; row.Status = a.status || "";
        return row;
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length?data:[{Note:"No data"}]), `Week ${w}`);
    }
  }
  if(wantMonthly){
    const agg = sortByRoster(agentAggregate(monthRows));
    const data = agg.map(a=>{
      const row = {Agent:a.name};
      metrics.forEach(m=> row[m.name] = a.values[m.field]!=null ? Number(a.values[m.field].toFixed(m.field==="calls"?0:2)) : "");
      row["Leave Days"] = a.leaveDays; row.Status = a.status || "";
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length?data:[{Note:"No data"}]), "Monthly Summary");
  }
  const safeTeam = (state.settings.teamName||"Team").replace(/[^a-z0-9]+/gi,"_");
  XLSX.writeFile(wb, `${safeTeam}_${viewPeriod.month}_${viewPeriod.year}.xlsx`);
}
