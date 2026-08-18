/* ---------------- Roster helpers ---------------- */
function activeAgentsForDate(iso){
  return scopedRoster().filter(a=>{
    if(a.joiningDate && iso < a.joiningDate) return false;
    if(a.status === "Inactive"){
      if(a.inactiveSince && iso <= a.inactiveSince) return true;
      return false;
    }
    return true;
  });
}
function rosterRank(empId){
  const i = state.roster.findIndex(a=>a.empId===empId);
  return i===-1 ? 9999 : i;
}
function agentTL(empId){
  const a = state.roster.find(x=>x.empId===empId);
  return (a && a.tlName) || "";
}
function agentLOB(empId){
  const a = state.roster.find(x=>x.empId===empId);
  return (a && a.lob) || "";
}
function sortByRoster(list){
  return list.slice().sort((a,b)=> rosterRank(a.empId)-rosterRank(b.empId) || a.name.localeCompare(b.name));
}


/* ---------------- ROSTER ---------------- */
function renderRoster(content, topActions){
  topActions.innerHTML = `
    <button class="btn" id="importAgentsBtn">⬆ Import agents (Excel)</button>
    <button class="btn btn-accent" id="addAgentBtn">+ Add agent</button>
  `;

  const tls = state.settings.tls || [];
  if(isTL() && !currentUser.viewAll) rosterTLFilter = "all"; // TL is already scoped to their own team
  let visibleRoster = canViewAllTeams() ? (rosterTLFilter==="all" ? state.roster : state.roster.filter(a=>(a.tlName||"")===rosterTLFilter)) : scopedRoster();
  if(rosterLOBFilter!=="all") visibleRoster = visibleRoster.filter(a=>(a.lob||"")===rosterLOBFilter);
  if(rosterSearch.trim()){
    const st = rosterSearch.trim().toLowerCase();
    visibleRoster = visibleRoster.filter(a=>(a.name||"").toLowerCase().includes(st) || (a.empId||"").toLowerCase().includes(st));
  }

  const tlOptsFor = (a)=> `<option value="">— Unassigned —</option>` + tls.map(tl=>`<option value="${esc(tl)}" ${a.tlName===tl?'selected':''}>${esc(tl)}</option>`).join("");
  const lobOptsFor = (a)=> `<option value="">— Unassigned —</option>` + LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${a.lob===l?'selected':''}>${esc(l)}</option>`).join("");
  const rows = visibleRoster.map(a=>`
    <tr data-id="${esc(a.empId)}">
      <td class="mono">${esc(a.empId)}</td>
      <td>${esc(a.name)}</td>
      <td>${isWFM() ? `<select class="cell-select tl-assign-sel" data-id="${esc(a.empId)}" style="width:150px;">${tlOptsFor(a)}</select>` : esc(a.tlName||'—')}</td>
      <td><select class="cell-select lob-assign-sel" data-id="${esc(a.empId)}" style="width:130px;">${lobOptsFor(a)}</select></td>
      <td class="mono">${formatTime12(a.shiftStart)} – ${formatTime12(a.shiftEnd)}</td>
      <td class="mono" style="font-size:11px;">${formatTime12(a.break1Start)}–${formatTime12(a.break1End)}<br>${formatTime12(a.break2Start)}–${formatTime12(a.break2End)}<br>${formatTime12(a.lunchStart)}–${formatTime12(a.lunchEnd)}</td>
      <td><input type="date" class="cell-input join-date-input" data-id="${esc(a.empId)}" value="${a.joiningDate||''}" style="width:130px;"></td>
      <td><span class="badge ${a.status==='Active'?'badge-green':'badge-gray'}">${a.status}</span></td>
      <td class="mono">${a.inactiveSince?fmtDate(a.inactiveSince):"—"}</td>
      <td>${esc(a.notes||"")}</td>
      <td>
        <button class="icon-btn toggle-status-btn" title="Toggle active/inactive">⇄</button>
        <button class="icon-btn del-agent-btn" title="Remove">✕</button>
      </td>
    </tr>`).join("");

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">◍</span>Team members</div>
        <div class="section-actions">
          ${canViewAllTeams() ? `<select class="week-select" id="rosterTLSel">
            <option value="all" ${rosterTLFilter==='all'?'selected':''}>All TLs (${state.roster.length})</option>
            ${tls.map(tl=>`<option value="${esc(tl)}" ${rosterTLFilter===tl?'selected':''}>${esc(tl)} (${state.roster.filter(a=>a.tlName===tl).length})</option>`).join("")}
            <option value="__unassigned__" ${rosterTLFilter===''?'selected':''}>Unassigned (${state.roster.filter(a=>!a.tlName).length})</option>
          </select>` : ""}
          <select class="week-select" id="rosterLOBSel">
            <option value="all" ${rosterLOBFilter==='all'?'selected':''}>All LOBs</option>
            ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${rosterLOBFilter===l?'selected':''}>${esc(l)} (${state.roster.filter(a=>a.lob===l).length})</option>`).join("")}
            <option value="__unassigned__" ${rosterLOBFilter===''?'selected':''}>Unassigned (${state.roster.filter(a=>!a.lob).length})</option>
          </select>
          <input type="text" class="week-select" id="rosterSearchInput" placeholder="🔍 Search agent…" value="${esc(rosterSearch)}" style="width:150px;">
        </div>
      </div>
      <div class="section-body table-wrap" style="max-height:66vh;overflow-y:auto;">
        ${visibleRoster.length ? `<table><thead><tr><th>Emp ID</th><th>Name</th><th>TL</th><th>LOB</th><th>Shift</th><th>Break</th><th>Joining Date</th><th>Status</th><th>Inactive Since</th><th>Notes</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : (state.roster.length ? `<div class="empty-state"><p>No agents for this filter.</p></div>` : `<div class="empty-state"><div class="big">◍</div><div class="disp" style="font-size:15px;font-weight:600;">Your roster is empty</div><p>Add your first team member to start logging daily performance.</p></div>`)}
      </div>
    </div>
  `;

  const rosterTLSel = document.getElementById("rosterTLSel");
  if(rosterTLSel) rosterTLSel.addEventListener("change", e=>{
    rosterTLFilter = e.target.value==="__unassigned__" ? "" : e.target.value;
    render();
  });
  document.getElementById("rosterLOBSel").addEventListener("change", e=>{
    rosterLOBFilter = e.target.value==="__unassigned__" ? "" : e.target.value;
    render();
  });
  document.getElementById("rosterSearchInput").addEventListener("input", e=>{ rosterSearch = e.target.value; render(); });
  document.getElementById("addAgentBtn").addEventListener("click", ()=>openAgentModal());
  document.getElementById("importAgentsBtn").addEventListener("click", ()=>openImportAgentsModal());
  content.querySelectorAll(".tl-assign-sel").forEach(el=>{
    el.addEventListener("change", ()=>{
      const a = state.roster.find(x=>x.empId===el.dataset.id);
      const before = a.tlName || "";
      a.tlName = el.value;
      logAudit("roster_tl", `Reassigned ${a.name}'s Team Leader`, {empId:a.empId, before, after:a.tlName||""});
      saveState(); render();
    });
  });
  content.querySelectorAll(".lob-assign-sel").forEach(el=>{
    el.addEventListener("change", ()=>{
      const a = state.roster.find(x=>x.empId===el.dataset.id);
      const before = a.lob || "";
      a.lob = el.value;
      logAudit("roster_lob", `Reassigned ${a.name}'s LOB`, {empId:a.empId, before, after:a.lob||""});
      saveState(); render();
    });
  });
  content.querySelectorAll(".join-date-input").forEach(el=>{
    el.addEventListener("change", ()=>{
      const a = state.roster.find(x=>x.empId===el.dataset.id);
      if(!el.value){ showToast("Joining date can't be empty"); el.value = a.joiningDate; return; }
      a.joiningDate = el.value;
      saveState(); render();
      showToast(`✅ Updated joining date for ${a.name}`);
    });
  });
  // Shift & break times are edited on the Break Schedule tab, not here — Roster shows them read-only.
  content.querySelectorAll(".toggle-status-btn").forEach(btn=>{
    btn.addEventListener("click", e=>{
      const id = e.target.closest("tr").dataset.id;
      const a = state.roster.find(x=>x.empId===id);
      const before = a.status;
      if(a.status==="Active"){ a.status="Inactive"; a.inactiveSince = todayIso(); }
      else { a.status="Active"; a.inactiveSince=""; }
      logAudit("roster_status", `Changed ${a.name}'s status to ${a.status}`, {empId:a.empId, before, after:a.status});
      saveState(); render();
    });
  });
  content.querySelectorAll(".del-agent-btn").forEach(btn=>{
    btn.addEventListener("click", e=>{
      const id = e.target.closest("tr").dataset.id;
      showConfirm("Remove this team member? Their historical daily entries will be kept but hidden.", ()=>{
        const a = state.roster.find(x=>x.empId===id);
        state.roster = state.roster.filter(x=>x.empId!==id);
        logAudit("roster_remove", `Removed ${a ? a.name : id} from the roster`, {empId:id});
        saveState(); render();
      }, "Remove");
    });
  });
}
function openAgentModal(){
  const overlay = showModal(`
    <div class="modal-title">Add team member</div>
    <div class="field"><label>Employee ID</label><input type="text" id="modEmpId" placeholder="EMP004"></div>
    <div class="field"><label>Full name</label><input type="text" id="modName" placeholder="Jane Doe"></div>
    <div class="field"><label>Joining date</label><input type="date" id="modJoin" value="${todayIso()}"></div>
    <div class="field-row">
      <div class="field"><label>Shift Start</label><input type="time" id="modShiftStart" value="09:00"></div>
      <div class="field"><label>Shift End</label><input type="time" id="modShiftEnd" value="18:00"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:8px 0 4px;font-weight:500;">Break 1 (15 min)</div>
    <div class="field-row">
      <div class="field"><label>Start</label><input type="time" id="modBreak1Start" value="11:00"></div>
      <div class="field"><label>End</label><input type="time" id="modBreak1End" value="11:15"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:8px 0 4px;font-weight:500;">Break 2 (15 min)</div>
    <div class="field-row">
      <div class="field"><label>Start</label><input type="time" id="modBreak2Start" value="13:30"></div>
      <div class="field"><label>End</label><input type="time" id="modBreak2End" value="13:45"></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:8px 0 4px;font-weight:500;">Lunch (30 min)</div>
    <div class="field-row">
      <div class="field"><label>Start</label><input type="time" id="modLunchStart" value="16:00"></div>
      <div class="field"><label>End</label><input type="time" id="modLunchEnd" value="16:30"></div>
    </div>
    <div class="field"><label>Notes (optional)</label><input type="text" id="modNotes" placeholder=""></div>
    <div class="field"><label>Team Leader ${isTL() ? '' : '(optional)'}</label>
      <select id="modTl" ${isTL() ? 'disabled' : ''}>
        ${isTL() ? `<option value="${esc(currentUser.tlName)}" selected>${esc(currentUser.tlName)}</option>` : `
        <option value="">— Unassigned —</option>
        ${(state.settings.tls||[]).map(tl=>`<option value="${esc(tl)}">${esc(tl)}</option>`).join("")}`}
      </select>
    </div>
    <div class="field"><label>LOB (optional)</label>
      <select id="modLob">
        <option value="">— Unassigned —</option>
        ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("")}
      </select>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modCancel">Cancel</button>
      <button class="btn btn-accent" id="modSave">+ Add agent</button>
    </div>
  `);
  const empIdEl = document.getElementById("modEmpId");
  overlay.querySelector("#modCancel").addEventListener("click", closeModal);
  function submit(){
    const empId = empIdEl.value.trim();
    const name = document.getElementById("modName").value.trim();
    const joining = document.getElementById("modJoin").value || todayIso();
    const shiftStart = document.getElementById("modShiftStart").value || "";
    const shiftEnd = document.getElementById("modShiftEnd").value || "";
    const break1Start = document.getElementById("modBreak1Start").value || "";
    const break1End = document.getElementById("modBreak1End").value || "";
    const break2Start = document.getElementById("modBreak2Start").value || "";
    const break2End = document.getElementById("modBreak2End").value || "";
    const lunchStart = document.getElementById("modLunchStart").value || "";
    const lunchEnd = document.getElementById("modLunchEnd").value || "";
    const notes = document.getElementById("modNotes").value.trim();
    const tlName = document.getElementById("modTl").value;
    const lob = document.getElementById("modLob").value;
    if(!empId || !name){ showToast("Enter an Emp ID and name"); return; }
    if(state.roster.some(a=>a.empId===empId)){ showToast("That Emp ID already exists"); return; }
    const exact = state.roster.find(a=>normalizeName(a.name)===normalizeName(name));
    const similar = !exact ? findSimilarAgent(name, state.roster) : null;
    state.roster.push({empId, name, joiningDate: joining, status:"Active", inactiveSince:"", notes, tlName, lob, shiftStart, shiftEnd, break1Start, break1End, break2Start, break2End, lunchStart, lunchEnd});
    saveState(); closeModal(); render();
    if(exact) showToast(`✅ Added ${name} — note: same name already exists on the roster`);
    else if(similar) showToast(`✅ Added ${name} — note: close to existing agent "${similar.name}", check it's not a duplicate`);
    else showToast(`✅ Added ${name}`);
  }
  overlay.querySelector("#modSave").addEventListener("click", submit);
  overlay.querySelectorAll("input").forEach(el=>el.addEventListener("keydown", e=>{ if(e.key==="Enter") submit(); }));
  // Auto-calculate break end times
  const b1s = document.getElementById("modBreak1Start");
  const b2s = document.getElementById("modBreak2Start");
  const ls = document.getElementById("modLunchStart");
  if(b1s) b1s.addEventListener("input", ()=>autoBreakEnd('modBreak1Start','modBreak1End',15));
  if(b2s) b2s.addEventListener("input", ()=>autoBreakEnd('modBreak2Start','modBreak2End',15));
  if(ls) ls.addEventListener("input", ()=>autoBreakEnd('modLunchStart','modLunchEnd',30));
  empIdEl.focus();
}

const AGENT_HEADER_MAP = {
  empId: ["empid","employeeid","id","empcode","code","employeecode"],
  name: ["name","agentname","employeename","fullname"],
  joiningDate: ["joiningdate","dateofjoining","doj","joindate","dateofjoin"],
  tlName: ["tl","tlname","teamleader","manager","reportingmanager","teamlead"],
  lob: ["lob","lineofbusiness","process","department","vertical"],
  status: ["status"],
  notes: ["notes","remarks","comment","comments"]
};
function matchAgentField(headerNorm){
  for(const [field,candidates] of Object.entries(AGENT_HEADER_MAP)){
    if(candidates.includes(headerNorm)) return field;
  }
  return null;
}
function detectAgentColumnMap(sheetRows){
  const colMap = {};
  Object.keys(sheetRows[0]||{}).forEach(k=>{
    const f = matchAgentField(normalizeHeader(k));
    if(f && !Object.values(colMap).includes(f)) colMap[k] = f;
  });
  return colMap;
}
function importAgentsFile(sheetRows, colMap){
  if(!Object.values(colMap).includes("name")){
    throw new Error("missing required Name column");
  }
  let added = 0, skippedExisting = 0, agentCounter = state.roster.length + 1;
  const dupWarnings = [];
  let lastName = "";
  sheetRows.forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    let name = String(rec.name||"").trim();
    if(!name) name = lastName; // fill-down for merged-cell style files
    if(!name) return;
    lastName = name;

    if(state.roster.some(a=>normalizeName(a.name)===normalizeName(name))){ skippedExisting++; return; }
    const similar = findSimilarAgent(name, state.roster);
    if(similar && !dupWarnings.some(w=>w.imported===name && w.existing===similar.name)){
      dupWarnings.push({imported:name, existing:similar.name});
    }

    let empId = String(rec.empId||"").trim();
    if(!empId || state.roster.some(a=>a.empId===empId)){
      do{ empId = "IMP"+String(agentCounter).padStart(3,"0"); agentCounter++; }while(state.roster.some(a=>a.empId===empId));
    }
    const joiningDate = parseFlexibleDate(rec.joiningDate,"auto") || todayIso();
    let tlName = String(rec.tlName||"").trim();
    if(tlName && !state.settings.tls.includes(tlName)){ state.settings.tls.push(tlName); }
    let lobRaw = String(rec.lob||"").trim().toLowerCase();
    let lob = "";
    if(/claim/.test(lobRaw)) lob = "Claims";
    else if(/elig/.test(lobRaw)) lob = "Eligibility";
    else if(LOB_OPTIONS.some(l=>l.toLowerCase()===lobRaw)) lob = LOB_OPTIONS.find(l=>l.toLowerCase()===lobRaw);
    let status = String(rec.status||"").trim();
    status = /inactive/i.test(status) ? "Inactive" : "Active";
    const notes = String(rec.notes||"").trim() || "Added via Excel import";

    state.roster.push({empId, name, joiningDate, status, inactiveSince: status==="Inactive"?todayIso():"", notes, tlName, lob, shiftStart:"", shiftEnd:"", break1Start:"", break1End:"", break2Start:"", break2End:"", lunchStart:"", lunchEnd:""});
    added++;
  });
  saveState();
  return {added, skippedExisting, dupWarnings};
}
function openImportAgentsModal(){
  const overlay = showModal(`
    <div class="modal-title">Import agents from Excel</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.6;margin:0 0 14px;">
      Upload a CSV or Excel file with a <b>Name</b> column, plus any of: Emp ID, Joining Date, TL, LOB, Status, Notes. Extra columns are ignored. Agents whose name already matches someone on the roster are skipped, not duplicated. New TL names found in the file are added to your TL list automatically. LOB values are matched to Claims or Eligibility.
    </p>
    <div class="field"><input type="file" id="importAgentsFileInput" accept=".csv,.xlsx,.xls"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="importAgentsCancel">Cancel</button>
      <button class="btn btn-accent" id="importAgentsGo">Import</button>
    </div>
  `);
  overlay.querySelector("#importAgentsCancel").addEventListener("click", closeModal);
  overlay.querySelector("#importAgentsGo").addEventListener("click", async ()=>{
    const file = document.getElementById("importAgentsFileInput").files[0];
    if(!file){ showToast("Choose a file first"); return; }
    const btn = document.getElementById("importAgentsGo");
    btn.textContent = "Importing…"; btn.disabled = true;
    try{
      const sheetRows = await readSheetRows(file);
      const colMap = detectAgentColumnMap(sheetRows);
      const result = importAgentsFile(sheetRows, colMap);
      closeModal(); render();
      showToast(`✅ Added ${result.added} agent(s)${result.skippedExisting ? `, skipped ${result.skippedExisting} already on roster` : ""}`);
      if(result.dupWarnings && result.dupWarnings.length) showDuplicateWarningModal(result.dupWarnings);
    }catch(err){
      console.error(err);
      showToast("⚠ Could not read that file — make sure it has a Name column");
      btn.textContent = "Import"; btn.disabled = false;
    }
  });
}

/* ---------------- LEAVE TRACKER (derived, read-only) ---------------- */
