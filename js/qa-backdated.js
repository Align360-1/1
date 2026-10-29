/* ---------------- Quality Audit — upload BACKDATED audits ----------------
   Lets Admin / Manager / Quality load audits that were done in the past (e.g. from the old
   "AHC Calibration Form" workbook's DUMP tab, or last month's Excel) so the audit history, the
   agent's view, the Quality dashboard and the Excel download all carry them.

   File layout: the SAME columns as "Download Excel" on the Audits tab (the workbook's DUMP layout,
   read by column POSITION because the parameter headers repeat three times):
     A..M   Agent's Name, Supervisor, Call ID, Auditor, Call Reason, Call Start, Call End, Audit Date,
            ZTP, ZTP ERROR, Total Points, Achieved Points, Score
     N..AF  19 × tag (Yes / No / N/A)      AG..AY  19 × error category      AZ..BR  19 × notes
     BS..BU Call Summary, Exact Error, Cause of the Error      BV,BW  Start/End time (ignored — derived)
     BX     Coaching Summary (optional)
   So an exported file can be edited and re-uploaded, and the old DUMP rows can be pasted in as-is.

   Rules (same as a live audit, so a backdated audit can never be "more lenient" than a live one):
     - the agent must already be on the roster (matched by name, or Emp ID typed in the name cell)
     - Audit Date is required and cannot be in the future
     - all 19 parameters tagged; N/A only where the rubric allows it; "No" needs an error category
     - ZTP "Not Met" needs the violated policy
     - the score is ALWAYS recalculated from the tags (the Score / Points columns in the file are only
       compared, never trusted) — a mismatch is shown as a warning
   Nothing is saved until the preview is confirmed; rows with problems are skipped and can be
   downloaded as an issues file, fixed and uploaded again.

   What a backdated audit looks like afterwards:
     - stored like any audit (state.qaAudits) with  backdated:true, uploadBatch, uploadedBy, uploadedAt
     - shows a "Backdated" badge in the Audits list and a banner on its detail page
     - sorted by its AUDIT date (not the upload time), so it lands in the right month
     - agents are NOT pinged by default (no sidebar badge / "New" tag) — tick "Notify agents" to override
     - a whole upload can be undone in one click from this tab (Admin, or the person who uploaded it) */

let qaUp = null; // {fileName, rows:[...], dup:"skip"|"import", notify:bool, dateFmt, onlyIssues, done}

function qaCanUpload(){ return !!currentUser && (isAdmin() || isQuality()); }
// Backdated audits don't ping the agent unless the uploader asked for it.
function qaNotifiable(a){ return !a.backdated || !!a.notifyAgent || !!a.notifyCorrectedAt; }

/* ---------- column positions (derived from the rubric, so a rubric change can't desync them) ---------- */
const QA_UP_N = QA_PARAMS.length;
const QA_UP_COL = {
  agent:0, supervisor:1, callId:2, auditor:3, reason:4, start:5, end:6, date:7, ztp:8, ztpErr:9, total:10, achieved:11, score:12,
  tag0:13, err0:13+QA_UP_N, note0:13+2*QA_UP_N, summary:13+3*QA_UP_N, exact:14+3*QA_UP_N, cause:15+3*QA_UP_N,
  coaching:18+3*QA_UP_N
};

/* ---------- small parsers ---------- */
function qaUpStr(v){ return v==null ? "" : (v instanceof Date ? "" : String(v)).trim(); }
function qaUpDT(v, fmt){
  if(v==null || v==="") return "";
  const fromDate = d=>{
    if(isNaN(d)) return "";
    const t = new Date(d.getTime() + 30000); // round to the nearest minute (Excel stores fractions of a day)
    return `${t.getFullYear()}-${pad2(t.getMonth()+1)}-${pad2(t.getDate())}T${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  };
  if(v instanceof Date) return fromDate(v);
  if(typeof v==="number") return v>0 ? fromDate(new Date(Math.round((v-25569)*86400000) + new Date().getTimezoneOffset()*60000)) : "";
  const s = String(v).trim(); if(!s) return "";
  const iso = parseFlexibleDate(s, fmt); if(!iso) return "";
  const tm = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/.exec(s.replace(/^\d{4}-\d{1,2}-\d{1,2}/,""));
  let hh = 0, mm = 0;
  if(tm){
    hh = +tm[1]; mm = +tm[2];
    if(tm[3]){ const pm = /p/i.test(tm[3]); if(pm && hh<12) hh += 12; if(!pm && hh===12) hh = 0; }
  }
  return `${iso}T${pad2(hh)}:${pad2(mm)}`;
}
function qaUpTag(v, p){
  const s = qaUpStr(v).toLowerCase().replace(/[\s.]/g,"");
  if(!s) return "";
  if(s==="yes"||s==="y") return "Yes";
  if(s==="no"||s==="n") return "No";
  if(s==="n/a"||s==="na"||s==="notapplicable") return "N/A";
  return "?" + qaUpStr(v);
}
function qaUpZtp(v){
  const s = qaUpStr(v).toLowerCase().replace(/\s+/g,"");
  if(!s || s==="met") return "Met";
  if(s==="notmet") return "Not Met";
  return "?" + qaUpStr(v);
}
// Closest match to one of the allowed options (case-insensitive) — keeps the stored text canonical.
function qaUpCanon(v, list){ const s = qaUpStr(v).toLowerCase(); return list.find(x=>x.toLowerCase()===s) || qaUpStr(v); }

/* ---------- file → rows ---------- */
async function qaUpReadAoa(file){
  if(typeof XLSX === "undefined") throw new Error("The Excel library didn't load — check your connection and try again.");
  const ext = file.name.split(".").pop().toLowerCase();
  const wb = ext==="csv" ? XLSX.read(await file.text(), {type:"string", cellDates:true}) : XLSX.read(await file.arrayBuffer(), {type:"array", cellDates:true});
  const name = wb.SheetNames.find(n=>/dump/i.test(n)) || wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, defval:"", raw:true});
}
function qaUpParse(aoa, dateFmt){
  let h = aoa.findIndex(r=> /agent/i.test(qaUpStr(r[0])));
  if(h < 0) throw new Error("Couldn't find the header row — the first column must be \"Agent's Name\". Download the template to see the layout.");
  if((aoa[h]||[]).length < QA_UP_COL.note0) throw new Error("This file has fewer columns than the audit layout. Download the template and copy your data into it.");
  const existingCalls = new Set((state.qaAudits||[]).map(a=>String(a.callId||"").toLowerCase()));
  const seenInFile = new Map();
  const today = todayIso();
  const out = [];
  for(let i=h+1; i<aoa.length; i++){
    const r = aoa[i];
    if(!r || r.every(c=> c==="" || c==null)) continue;
    const row = {rowNo:i+1, errors:[], warnings:[], dup:false, audit:null};
    const nameRaw = qaUpStr(r[QA_UP_COL.agent]);
    const callId = qaUpStr(r[QA_UP_COL.callId]);
    row.agentName = nameRaw; row.callId = callId;

    // Agent
    const norm = normalizeName(nameRaw);
    const agent = nameRaw ? ((state.roster||[]).find(a=> normalizeName(a.name)===norm) || (state.roster||[]).find(a=> String(a.empId).toLowerCase()===nameRaw.toLowerCase())) : null;
    if(!nameRaw) row.errors.push("Agent name is blank");
    else if(!agent){
      const sim = typeof findSimilarAgent==="function" ? findSimilarAgent(nameRaw, state.roster||[]) : null;
      row.errors.push(`Agent "${nameRaw}" isn't on the roster${sim ? ` (did you mean ${sim.name}?)` : ""}`);
    } else row.agentName = agent.name;

    // Dates
    const auditDate = parseFlexibleDate(r[QA_UP_COL.date], dateFmt);
    row.auditDate = auditDate || "";
    if(!auditDate) row.errors.push("Audit Date is missing or not a valid date");
    else if(auditDate > today) row.errors.push(`Audit Date ${auditDate} is in the future`);
    const callStart = qaUpDT(r[QA_UP_COL.start], dateFmt), callEnd = qaUpDT(r[QA_UP_COL.end], dateFmt);
    if(callStart && callEnd && callEnd < callStart) row.warnings.push("Call End is before Call Start");

    // Call ID + duplicates
    if(!callId) row.errors.push("Call ID is blank");
    else {
      const k = callId.toLowerCase();
      if(existingCalls.has(k)){ row.dup = true; row.warnings.push("Call ID was already audited in the app"); }
      if(seenInFile.has(k)){ row.dup = true; row.warnings.push(`Same Call ID as row ${seenInFile.get(k)} in this file`); }
      else seenInFile.set(k, i+1);
    }

    // Parameters
    const params = {};
    const bad = [];
    QA_PARAMS.forEach((p, j)=>{
      let tag = qaUpTag(r[QA_UP_COL.tag0+j], p);
      const error = qaUpStr(r[QA_UP_COL.err0+j]);
      const notes = qaUpStr(r[QA_UP_COL.note0+j]);
      if(tag.startsWith("?")){ bad.push(`${p.n} ("${tag.slice(1)}")`); tag = ""; }
      else if(!tag) bad.push(`${p.n} (blank)`);
      else if(tag==="N/A" && !p.na) bad.push(`${p.n} (N/A isn't allowed)`);
      else if(tag==="No" && !error) row.errors.push(`Parameter ${p.n} "${p.name}" is tagged No but has no error category`);
      params[p.n] = {tag, error: tag==="No" ? qaUpCanon(error, qaErrorOptions(p)) : "", notes};
    });
    if(bad.length) row.errors.push("Fix the tag for parameter " + bad.slice(0,6).join(", ") + (bad.length>6 ? ` and ${bad.length-6} more` : "") + " — must be Yes, No or N/A");

    // Zero tolerance
    let ztp = qaUpZtp(r[QA_UP_COL.ztp]), ztpError = qaUpStr(r[QA_UP_COL.ztpErr]);
    if(ztp.startsWith("?")){ row.errors.push(`ZTP "${ztp.slice(1)}" must be Met or Not Met`); ztp = "Met"; }
    if(ztp==="Not Met"){ if(!ztpError) row.errors.push("ZTP is Not Met but no ZTP error (violated policy) is given"); else ztpError = qaUpCanon(ztpError, QA_ZT_ERRORS); }
    else ztpError = "";

    // Reason (lenient: history may use older wording — keep the text, just flag it)
    const reasonRaw = qaUpStr(r[QA_UP_COL.reason]);
    const reason = qaUpCanon(reasonRaw, QA_CALL_REASONS);
    if(!reasonRaw) row.warnings.push("Call Reason is blank");
    else if(!QA_CALL_REASONS.includes(reason)) row.warnings.push(`Call Reason "${reasonRaw}" isn't one of the standard reasons (kept as written)`);

    // Score is recalculated; the file's own number is only a cross-check
    const calc = qaCompute(n=> (params[n]||{}).tag, ztp);
    row.score = calc.score;
    const fileScoreRaw = r[QA_UP_COL.score];
    if(fileScoreRaw!=="" && fileScoreRaw!=null && !isNaN(Number(fileScoreRaw))){
      let fs = Number(fileScoreRaw); if(fs > 1) fs = fs/100;
      if(Math.abs(fs - calc.score) > 0.005) row.warnings.push(`File says ${qaPct(fs)} but the tags give ${qaPct(calc.score)} — the recalculated score is used`);
    }

    // Auditor → a real login when the name matches (so it shows on that person's Quality dashboard)
    const auditorRaw = qaUpStr(r[QA_UP_COL.auditor]);
    const user = auditorRaw ? (state.settings.users||[]).find(u=> u.name && normalizeName(u.name)===normalizeName(auditorRaw)) : null;
    if(!auditorRaw) row.warnings.push("Auditor is blank — will be recorded as you");
    row.auditor = auditorRaw;

    if(!row.errors.length && agent){
      row.audit = {
        agentEmpId: agent.empId, agentName: agent.name, supervisor: qaUpStr(r[QA_UP_COL.supervisor]) || agent.tlName || "",
        lob: agent.lob || "", callId, callReason: reason, callStart, callEnd,
        auditorName: auditorRaw || currentUser.name,
        auditorUsername: (user && user.username) || currentUser.username || "",
        auditDate, ztp, ztpError,
        totalPoints: calc.total, achievedPoints: calc.achieved, score: calc.score, params,
        summary: qaUpStr(r[QA_UP_COL.summary]), exactError: qaUpStr(r[QA_UP_COL.exact]), cause: qaUpStr(r[QA_UP_COL.cause]),
        coaching: qaUpStr(r[QA_UP_COL.coaching])
      };
    }
    out.push(row);
  }
  if(!out.length) throw new Error("No audit rows found below the header.");
  return out;
}
function qaUpReady(r){ return !!r.audit && !(r.dup && qaUp.dup==="skip"); }

/* ---------- template ---------- */
function qaUpDownloadTemplate(){
  if(typeof XLSX === "undefined"){ showToast("⚠ Excel library didn't load — check your connection and try again"); return; }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([QA_DUMP_HEADERS.slice(0, QA_UP_COL.coaching+1)]);
  ws["!cols"] = QA_DUMP_HEADERS.slice(0, QA_UP_COL.coaching+1).map((h,i)=>({wch: i<13 ? 16 : i>=QA_UP_COL.note0 ? 30 : 22}));
  ws["!freeze"] = {xSplit:0, ySplit:1};
  XLSX.utils.book_append_sheet(wb, ws, "DUMP");
  const guide = [
    ["Column(s)", "What to enter"],
    ["Agent's Name", "Exactly as on the roster (or the Emp ID). Agents not on the roster are rejected — add them in Team Roster first."],
    ["Call ID", "Required. A Call ID that was already audited is skipped unless you choose \"Import anyway\"."],
    ["Auditor", "Who did the audit. If the name matches an app login it shows on that person's Quality dashboard; otherwise it's recorded under you."],
    ["Call Reason", "Benefits / Eligibility / Claims Status / Others (Non Supported)"],
    ["Call Start / Call End", "Optional date-time, e.g. 2026-09-14 10:32"],
    ["Audit Date", "Required, today or earlier. The date the audit was DONE — it decides which month the audit appears in."],
    ["ZTP / ZTP ERROR", "Met or Not Met. If Not Met, ZTP ERROR must be: " + QA_ZT_ERRORS.join(" / ")],
    ["Total Points / Achieved Points / Score", "Optional. Always recalculated from the tags — your numbers are only compared."],
    [`${QA_UP_COL.tag0+1}–${QA_UP_COL.err0} (first block of ${QA_UP_N})`, "Tag for each parameter: Yes / No / N/A (N/A only where the rubric allows it). All " + QA_UP_N + " are required."],
    ["Second block of " + QA_UP_N, "Error category — required for every parameter tagged No."],
    ["Third block of " + QA_UP_N, "Notes (optional)."],
    ["Call Summary / Exact Error / Cause of the Error / Coaching Summary", "Optional text. Don't put member names, DOBs, member IDs or claim numbers."],
    ["", ""],
    ["Parameters", QA_PARAMS.map(p=> `${p.n}. ${p.name} (${p.pts} pt${p.pts===1?"":"s"}${p.na?", N/A allowed":""})`).join("   |   ")]
  ];
  const gs = XLSX.utils.aoa_to_sheet(guide); gs["!cols"] = [{wch:44},{wch:120}];
  XLSX.utils.book_append_sheet(wb, gs, "How to fill");
  const ag = XLSX.utils.aoa_to_sheet([["Agent's Name","Emp ID","Team Leader","LOB"], ...(state.roster||[]).map(a=>[a.name, a.empId, a.tlName||"", a.lob||""])]);
  ag["!cols"] = [{wch:30},{wch:12},{wch:24},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ag, "Roster names");
  XLSX.writeFile(wb, "Backdated_Quality_Audits_Template.xlsx");
}
function qaUpDownloadIssues(){
  const bad = qaUp.rows.filter(r=> !qaUpReady(r));
  if(!bad.length){ showToast("Nothing to report — every row is ready"); return; }
  const aoa = [["File row","Agent","Call ID","Audit date","Problem"], ...bad.map(r=>[
    r.rowNo, r.agentName, r.callId, r.auditDate,
    r.errors.length ? r.errors.join("; ") : "Skipped — duplicate Call ID"
  ])];
  const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{wch:9},{wch:28},{wch:18},{wch:12},{wch:110}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Issues");
  XLSX.writeFile(wb, "Backdated_Quality_Audits_Issues.xlsx");
}

/* ---------- import / undo ---------- */
function qaUpImport(){
  const ready = qaUp.rows.filter(qaUpReady);
  if(!ready.length){ showToast("⚠ No rows are ready to import"); return; }
  const dates = ready.map(r=>r.audit.auditDate).sort();
  const msg = `Import ${ready.length} backdated audit${ready.length===1?"":"s"} (${fmtDate(dates[0])}${dates[0]!==dates[dates.length-1] ? " – " + fmtDate(dates[dates.length-1]) : ""})?\n\n${qaUp.notify ? "Agents WILL be notified." : "Agents will not be notified."}\nYou can undo the whole upload afterwards.`;
  if(!confirm(msg)) return;
  const now = new Date().toISOString();
  const batchId = "qb_" + Date.now().toString(36);
  state.qaAudits = state.qaAudits || [];
  ready.forEach(r=>{
    state.qaAudits.push(Object.assign({}, r.audit, {
      id: qaId(), createdAt: now,
      backdated: true, uploadBatch: batchId, uploadFile: qaUp.fileName,
      uploadedBy: currentUser.name, uploadedByUsername: currentUser.username || "", uploadedAt: now,
      notifyAgent: !!qaUp.notify
    }));
  });
  const skipped = qaUp.rows.length - ready.length;
  logAudit("qa_audit_backdated", `Uploaded ${ready.length} backdated quality audit${ready.length===1?"":"s"} from "${qaUp.fileName}" (${dates[0]} to ${dates[dates.length-1]})${skipped ? `, ${skipped} row${skipped===1?"":"s"} skipped` : ""}`, {after:{batch:batchId, imported:ready.length, skipped}});
  saveState();
  qaUp = {done:{imported:ready.length, skipped, batchId, from:dates[0], to:dates[dates.length-1]}, rows:[], dup:"skip", notify:false, dateFmt:"dmy"};
  showToast(`✅ ${ready.length} backdated audit${ready.length===1?"":"s"} uploaded`);
  render();
}
function qaUpBatches(){
  const map = new Map();
  (state.qaAudits||[]).forEach(a=>{
    if(!a.backdated || !a.uploadBatch) return;
    if(!isAdmin() && a.uploadedByUsername !== (currentUser.username||"__none__")) return;
    if(!map.has(a.uploadBatch)) map.set(a.uploadBatch, {id:a.uploadBatch, file:a.uploadFile||"", by:a.uploadedBy||"", at:a.uploadedAt||"", n:0, from:a.auditDate, to:a.auditDate, notified:!!a.notifyAgent});
    const b = map.get(a.uploadBatch); b.n++;
    if(a.auditDate < b.from) b.from = a.auditDate; if(a.auditDate > b.to) b.to = a.auditDate;
  });
  return Array.from(map.values()).sort((x,y)=> String(y.at).localeCompare(String(x.at)));
}
function qaUpUndo(batchId){
  const list = (state.qaAudits||[]).filter(a=> a.uploadBatch===batchId);
  if(!list.length) return;
  if(!confirm(`Remove all ${list.length} audit${list.length===1?"":"s"} from this upload? Audits that were corrected after upload are removed too. This can't be undone.`)) return;
  state.qaAudits = state.qaAudits.filter(a=> a.uploadBatch!==batchId);
  logAudit("qa_audit_backdated_undo", `Undid backdated audit upload ${batchId} — removed ${list.length} audit${list.length===1?"":"s"}`, {before:{batch:batchId, removed:list.length}});
  saveState(); showToast(`Removed ${list.length} audit${list.length===1?"":"s"}`); render();
}

/* ---------- tab ---------- */
function qaUploadHtml(){
  if(!qaUp) qaUp = {rows:[], dup:"skip", notify:false, dateFmt:"dmy", onlyIssues:false};
  const u = qaUp;
  const batches = qaUpBatches();
  const batchRows = batches.map(b=>`<tr><td>${esc(b.file||"—")}</td><td>${esc(b.by)}</td><td class="mono">${esc(qaDateTimeLabel((b.at||"").slice(0,16)))}</td>
      <td class="num">${b.n}</td><td class="mono">${esc(b.from)}${b.from!==b.to ? " → "+esc(b.to) : ""}</td><td>${b.notified ? "Yes" : "No"}</td>
      <td><button class="btn btn-ghost btn-sm qa-up-undo" data-batch="${esc(b.id)}">↩ Undo upload</button></td></tr>`).join("");
  const recent = `<div style="margin-top:22px;"><div style="font-size:13px;font-weight:600;margin-bottom:8px;">Previous backdated uploads</div>
    ${batches.length ? `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>File</th><th>Uploaded by</th><th>Uploaded</th><th class="num">Audits</th><th>Audit dates</th><th>Agents notified</th><th></th></tr></thead><tbody>${batchRows}</tbody></table></div>`
      : `<div class="help-note">No backdated uploads yet.</div>`}</div>`;
  const intro = `<div class="help-note" style="margin-bottom:12px;">Use this to load audits that were done earlier (for example from the old workbook's DUMP tab). They are stored with their <b>original audit date</b>, marked <b>Backdated</b> for everyone who views them, and counted in the right month. The score is recalculated from the tags using the current rubric. Agents are <b>not</b> notified unless you tick the box below.</div>`;
  const step1 = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px;">
      <button class="btn btn-ghost btn-sm" id="qaUpTemplateBtn">⬇ Download template</button>
      <div class="field" style="margin:0;"><label>File (.xlsx / .csv)</label><input type="file" id="qaUpFile" accept=".xlsx,.xls,.csv"></div>
      <div class="field" style="margin:0;"><label>Dates in the file are</label>
        <select id="qaUpDateFmt" class="week-select"><option value="dmy" ${u.dateFmt==="dmy"?"selected":""}>Day / Month / Year</option><option value="mdy" ${u.dateFmt==="mdy"?"selected":""}>Month / Day / Year</option></select></div>
    </div>`;
  let preview = "";
  if(u.done){
    preview = `<div class="help-note" style="border-left:4px solid var(--green,#3caa5a);padding:10px 12px;margin-bottom:8px;"><b>✅ Uploaded ${u.done.imported} backdated audit${u.done.imported===1?"":"s"}</b> (audit dates ${esc(u.done.from)}${u.done.from!==u.done.to ? " → "+esc(u.done.to) : ""})${u.done.skipped ? ` · ${u.done.skipped} row${u.done.skipped===1?"":"s"} skipped` : ""}. Find them under <b>Audits</b> with the <b>Backdated</b> badge, or filter by <i>Backdated only</i>.</div>`;
  } else if(u.rows.length){
    const ready = u.rows.filter(qaUpReady), bad = u.rows.filter(r=>r.errors.length), dups = u.rows.filter(r=>r.audit && r.dup && u.dup==="skip");
    const kpi = (l,v,c)=>`<div class="kpi"><div class="kpi-label">${esc(l)}</div><div class="kpi-value" ${c?`style="color:${c}"`:""}>${v}</div></div>`;
    const shown = (u.onlyIssues ? u.rows.filter(r=> !qaUpReady(r) || r.warnings.length) : u.rows).slice(0, 400);
    const trs = shown.map(r=>{
      const st = r.errors.length ? `<span class="badge badge-red">Error</span>` : (r.dup && u.dup==="skip") ? `<span class="badge badge-yellow">Skipped (duplicate)</span>` : r.warnings.length ? `<span class="badge badge-yellow">Ready · check</span>` : `<span class="badge badge-green">Ready</span>`;
      const notes = r.errors.concat(r.warnings).map(esc).join("<br>");
      return `<tr><td class="num">${r.rowNo}</td><td>${esc(r.agentName||"—")}</td><td class="mono">${esc(r.callId||"—")}</td><td class="mono">${esc(r.auditDate||"—")}</td>
        <td class="num">${r.errors.length ? "—" : `<span class="badge ${qaScoreClass(r.score)}">${qaPct(r.score)}</span>`}</td><td>${st}</td><td style="white-space:normal;font-size:12px;min-width:260px;">${notes||"—"}</td></tr>`;
    }).join("");
    preview = `
      <div style="font-size:13px;font-weight:600;margin:6px 0 10px;">Preview — ${esc(u.fileName)}</div>
      <div class="kpi-grid" style="margin-bottom:14px;">${kpi("Rows read", u.rows.length)}${kpi("Ready to import", ready.length, ready.length?"var(--green)":"")}${kpi("With errors", bad.length, bad.length?"var(--red)":"")}${kpi("Duplicate Call IDs", u.rows.filter(r=>r.dup).length)}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:13px;">
        <label>If a Call ID was already audited: <select id="qaUpDup" class="week-select"><option value="skip" ${u.dup==="skip"?"selected":""}>Skip it</option><option value="import" ${u.dup==="import"?"selected":""}>Import anyway</option></select></label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="qaUpNotify" ${u.notify?"checked":""}> Notify agents (sidebar badge + “New” tag)</label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="qaUpOnlyIssues" ${u.onlyIssues?"checked":""}> Show only rows needing attention</label>
      </div>
      <div class="table-wrap" style="max-height:420px;overflow:auto;"><table class="mini-table" style="width:100%;"><thead><tr><th class="num">Row</th><th>Agent</th><th>Call ID</th><th>Audit date</th><th class="num">Score</th><th>Status</th><th>Notes</th></tr></thead><tbody>${trs || `<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:16px;">Everything is ready — nothing needs attention.</td></tr>`}</tbody></table></div>
      ${u.rows.length>400 && !u.onlyIssues ? `<div class="help-note" style="margin-top:6px;">Showing the first 400 rows; all ${u.rows.length} are processed on import.</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <button class="btn btn-accent" id="qaUpImportBtn" ${ready.length?"":"disabled"}>⬆ Import ${ready.length} audit${ready.length===1?"":"s"}</button>
        ${(bad.length || dups.length) ? `<button class="btn btn-ghost" id="qaUpIssuesBtn">⬇ Download issues (${bad.length+dups.length})</button>` : ""}
        <button class="btn btn-ghost" id="qaUpClearBtn">Clear</button>
      </div>`;
  }
  return `<div class="section-body">${intro}${step1}${preview}${recent}</div>`;
}
function qaWireUpload(content){
  const $ = id => content.querySelector("#"+id);
  const tpl = $("qaUpTemplateBtn"); if(tpl) tpl.addEventListener("click", qaUpDownloadTemplate);
  const fmt = $("qaUpDateFmt"); if(fmt) fmt.addEventListener("change", ()=>{ qaUp.dateFmt = fmt.value; if(qaUp.aoa){ try{ qaUp.rows = qaUpParse(qaUp.aoa, qaUp.dateFmt); }catch(e){} render(); } });
  const file = $("qaUpFile");
  if(file) file.addEventListener("change", async ()=>{
    const f = file.files[0]; if(!f) return;
    showToast("Reading file…");
    try{
      const aoa = await qaUpReadAoa(f);
      const rows = qaUpParse(aoa, qaUp.dateFmt);
      qaUp = Object.assign(qaUp, {done:null, aoa, rows, fileName:f.name, onlyIssues:false});
      render();
    }catch(err){ console.error(err); showToast("⚠ " + (err && err.message ? err.message : "Could not read that file")); }
  });
  const dup = $("qaUpDup"); if(dup) dup.addEventListener("change", ()=>{ qaUp.dup = dup.value; render(); });
  const nt = $("qaUpNotify"); if(nt) nt.addEventListener("change", ()=>{ qaUp.notify = nt.checked; });
  const oi = $("qaUpOnlyIssues"); if(oi) oi.addEventListener("change", ()=>{ qaUp.onlyIssues = oi.checked; render(); });
  const imp = $("qaUpImportBtn"); if(imp) imp.addEventListener("click", qaUpImport);
  const iss = $("qaUpIssuesBtn"); if(iss) iss.addEventListener("click", qaUpDownloadIssues);
  const clr = $("qaUpClearBtn"); if(clr) clr.addEventListener("click", ()=>{ qaUp = null; render(); });
  content.querySelectorAll(".qa-up-undo").forEach(b=> b.addEventListener("click", ()=> qaUpUndo(b.dataset.batch)));
}
