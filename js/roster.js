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
  // Trainer gets read-only visibility into the roster — no add/import/edit/remove.
  const canEditRoster = isManager();
  topActions.innerHTML = canEditRoster ? `
    <button class="btn" id="importAgentsBtn">⬆ Import agents (Excel)</button>
    <button class="btn btn-accent" id="addAgentBtn">+ Add agent</button>
  ` : `<span style="font-size:12px;color:var(--text-muted);">Read-only view</span>`;

  const tls = state.settings.tls || [];
  if(isTL() && !currentUser.viewAll) rosterTLFilter = "all"; // TL is already scoped to their own team
  let visibleRoster = canViewAllTeams() ? (rosterTLFilter==="all" ? state.roster : state.roster.filter(a=>(a.tlName||"")===rosterTLFilter)) : scopedRoster();
  if(rosterLOBFilter!=="all") visibleRoster = visibleRoster.filter(a=> rosterLOBFilter==="" ? !agentLobList(a).length : agentHasLob(a, rosterLOBFilter));
  if(rosterSearch.trim()){
    const st = rosterSearch.trim().toLowerCase();
    visibleRoster = visibleRoster.filter(a=>(a.name||"").toLowerCase().includes(st) || (a.empId||"").toLowerCase().includes(st));
  }

  const tlOptsFor = (a)=> `<option value="">— Unassigned —</option>` + tls.map(tl=>`<option value="${esc(tl)}" ${a.tlName===tl?'selected':''}>${esc(tl)}</option>`).join("");
  const lobOptsFor = (a)=> `<option value="">— Unassigned —</option>` + LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${a.lob===l?'selected':''}>${esc(l)}</option>`).join("");
  // LOB cell: primary LOB + cross-trained LOBs (chips with ✕, and a "＋ Add LOB" picker)
  const lobCellFor = (a)=>{
    const extras = (a.extraLobs||[]).filter(l=>l && l!==a.lob);
    if(!canEditRoster) return esc(a.lob||'—') + extras.map(l=>` <span class="lob-extra-chip" title="Cross-trained">${esc(l)}</span>`).join("");
    const free = LOB_OPTIONS.filter(l=>l!==a.lob && !extras.includes(l));
    return `<select class="cell-select lob-assign-sel" data-id="${esc(a.empId)}" style="width:130px;" title="Primary LOB">${lobOptsFor(a)}</select>` +
      (a.lob ? `<div class="lob-extra-wrap">${extras.map(l=>`<span class="lob-extra-chip" title="Cross-trained on ${esc(l)}">${esc(l)}<button type="button" class="lob-extra-del" data-id="${esc(a.empId)}" data-lob="${esc(l)}" aria-label="Remove ${esc(l)}">✕</button></span>`).join("")}${free.length ? `<select class="cell-select lob-extra-add" data-id="${esc(a.empId)}" title="Cross-trained on another LOB"><option value="">＋ Add LOB</option>${free.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("")}</select>` : ""}</div>` : "");
  };
  const rows = visibleRoster.map(a=>`
    <tr data-id="${esc(a.empId)}">
      <td class="mono">${esc(a.empId)}</td>
      <td>${esc(a.name)}</td>
      <td>${isWFM() ? `<select class="cell-select tl-assign-sel" data-id="${esc(a.empId)}" style="width:150px;">${tlOptsFor(a)}</select>` : esc(a.tlName||'—')}</td>
      <td>${lobCellFor(a)}</td>
      <td class="mono">${formatTime12(a.shiftStart)} – ${formatTime12(a.shiftEnd)}</td>
      <td class="mono" style="font-size:11px;">${formatTime12(a.break1Start)}–${formatTime12(a.break1End)}<br>${formatTime12(a.break2Start)}–${formatTime12(a.break2End)}<br>${formatTime12(a.lunchStart)}–${formatTime12(a.lunchEnd)}</td>
      <td>${canEditRoster ? `<input type="date" class="cell-input join-date-input" data-id="${esc(a.empId)}" value="${a.joiningDate||''}" style="width:130px;">` : (a.joiningDate?fmtDate(a.joiningDate):'—')}</td>
      <td><span class="badge ${a.status==='Active'?'badge-green':'badge-gray'}">${a.status}</span></td>
      <td class="mono">${a.inactiveSince?fmtDate(a.inactiveSince):"—"}</td>
      <td>${esc(a.notes||"")}</td>
      <td>
        ${canEditRoster ? `<button class="icon-btn toggle-status-btn" title="Toggle active/inactive">⇄</button>
        <button class="icon-btn del-agent-btn" title="Remove">✕</button>` : ""}
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
            ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${rosterLOBFilter===l?'selected':''}>${esc(l)} (${state.roster.filter(a=>agentHasLob(a,l)).length})</option>`).join("")}
            <option value="__unassigned__" ${rosterLOBFilter===''?'selected':''}>Unassigned (${state.roster.filter(a=>!agentLobList(a).length).length})</option>
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
  if(canEditRoster){
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
        const before = agentLobText(a);
        a.lob = el.value;
        // the primary can't also be a cross-trained LOB; clearing the primary clears the cross-training too
        a.extraLobs = a.lob ? (a.extraLobs||[]).filter(l=>l!==a.lob) : [];
        logAudit("roster_lob", `Reassigned ${a.name}'s LOB`, {empId:a.empId, before, after:agentLobText(a)});
        saveState(); render();
      });
    });
    content.querySelectorAll(".lob-extra-add").forEach(el=>{
      el.addEventListener("change", ()=>{
        const a = state.roster.find(x=>x.empId===el.dataset.id); if(!a || !el.value) return;
        const before = agentLobText(a);
        a.extraLobs = (a.extraLobs||[]).filter(l=>l!==a.lob);
        if(el.value!==a.lob && !a.extraLobs.includes(el.value)) a.extraLobs.push(el.value);
        logAudit("roster_lob", `Cross-trained ${a.name} on ${el.value}`, {empId:a.empId, before, after:agentLobText(a)});
        saveState(); render();
        showToast(`✅ ${a.name} can now see ${el.value} content too`);
      });
    });
    content.querySelectorAll(".lob-extra-del").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const a = state.roster.find(x=>x.empId===btn.dataset.id); if(!a) return;
        const before = agentLobText(a);
        a.extraLobs = (a.extraLobs||[]).filter(l=>l!==btn.dataset.lob);
        logAudit("roster_lob", `Removed ${btn.dataset.lob} cross-training from ${a.name}`, {empId:a.empId, before, after:agentLobText(a)});
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
    <div class="field"><label>Also cross-trained on (optional)</label>
      <div class="lob-check-row">${LOB_OPTIONS.map(l=>`<label class="lob-check"><input type="checkbox" class="modExtraLob" value="${esc(l)}"> ${esc(l)}</label>`).join("")}</div>
      <div class="help-note" style="margin-top:4px;">These agents see the Knowledge Base, templates, updates and PKTs for every LOB they're trained on.</div>
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
    const extraLobs = lob ? Array.from(document.querySelectorAll(".modExtraLob:checked")).map(x=>x.value).filter(l=>l!==lob) : [];
    if(!empId || !name){ showToast("Enter an Emp ID and name"); return; }
    if(state.roster.some(a=>a.empId===empId)){ showToast("That Emp ID already exists"); return; }
    const exact = state.roster.find(a=>normalizeName(a.name)===normalizeName(name));
    const similar = !exact ? findSimilarAgent(name, state.roster) : null;
    state.roster.push({empId, name, joiningDate: joining, status:"Active", inactiveSince:"", notes, tlName, lob, extraLobs, shiftStart, shiftEnd, break1Start, break1End, break2Start, break2End, lunchStart, lunchEnd});
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
  tlName: ["tl","tlname","teamleader","teamleadername","teamleadname","manager","reportingmanager","reportingmanagername","teamlead","supervisor","supervisorname","reportsto","reportingto"],
  lob: ["lob","lineofbusiness","process","department","vertical"],
  extraLobs: ["additionallobs","additionallob","crosstrainedlobs","crosstrainedlob","crosstrained","crosstraining","secondarylob","secondarylobs","otherlobs","alsotrainedon"],
  status: ["status"],
  notes: ["notes","remarks","comment","comments"],
  // Shift & break times (v28). A start column may also hold a range such as "9:00 AM - 6:00 PM" (see rosterSplitTimeRange).
  shiftStart: ["shiftstart","shiftstarttime","shiftin","shiftintime","starttime","logintime","login","shift","shifttiming","shifttimings","shifttime","shifts"],
  shiftEnd: ["shiftend","shiftendtime","shiftout","shiftouttime","endtime","logouttime","logout"],
  break1Start: ["break1start","b1start","break1in","break1intime","firstbreakstart","firstbreak","break1","break1time","break1timing","break1timings"],
  break1End: ["break1end","b1end","break1out","break1outtime","firstbreakend"],
  break2Start: ["break2start","b2start","break2in","break2intime","secondbreakstart","secondbreak","break2","break2time","break2timing","break2timings"],
  break2End: ["break2end","b2end","break2out","break2outtime","secondbreakend"],
  lunchStart: ["lunchstart","break3start","lunchin","lunchintime","lunch","lunchtime","lunchtiming","lunchtimings","lunchbreak"],
  lunchEnd: ["lunchend","break3end","lunchout","lunchouttime"],
  // ONE column holding all breaks, e.g. "8:00 PM - 8:15 PM, 12:30 AM - 12:45 AM, 1:30 AM - 2:00 AM" -> Break 1, Break 2, Lunch in that order.
  breaksAll: ["break","breaks","breaktiming","breaktimings","breaktime","breaktimes","allbreaks","breakschedule"]
};
const ROSTER_TIME_FIELDS = ["shiftStart","shiftEnd","break1Start","break1End","break2Start","break2End","lunchStart","lunchEnd"];
const ROSTER_DEFAULT_SHIFT_MIN = 600; // 10-hour shift, used only when the file has no shift end
const ROSTER_TIME_PAIRS = {shiftStart:["shiftEnd",0], break1Start:["break1End",15], break2Start:["break2End",15], lunchStart:["lunchEnd",30]};
// Excel time cell / serial / "5:30 PM" / "17:30" / "9 AM" -> "HH:MM" (or "" if unreadable). Date cells are rounded to the nearest
// minute because SheetJS time-only cells can carry a few seconds of drift (pre-1900 timezone offsets).
function rosterParseTime(raw){
  if(raw instanceof Date && !isNaN(raw)) raw = new Date(Math.round(raw.getTime()/60000)*60000);
  if(typeof raw === "string"){
    raw = raw.trim().replace(/^(\d{1,2})\.(\d{2})(?!\d)/, "$1:$2");   // "6.30 PM" (dot instead of colon) -> "6:30 PM"
    const m = raw.match(/^(\d{1,2})\s*(AM|PM)$/i);
    if(m) raw = m[1]+":00 "+m[2];
  }
  return parseTimeValue(raw);
}
// "9:00 AM - 6:00 PM" / "09:00-18:00" / "9 AM to 6 PM" -> ["09:00","18:00"]; anything else -> null.
function rosterSplitTimeRange(raw){
  if(typeof raw !== "string") return null;
  const m = raw.trim().match(/^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i);
  if(!m) return null;
  const a = rosterParseTime(m[1]), b = rosterParseTime(m[2]);
  return a && b ? [a,b] : null;
}
// Reads every mapped shift/break cell of one row into {field:"HH:MM"}; only fields that have a readable value are returned.
// A start cell holding a range fills the matching end too (unless the file has its own end column for it).
// Every "start - end" pair found in one cell, in order. A lone time (no end) counts as a start only.
function rosterSplitAllBreaks(raw){
  if(raw===undefined || raw===null || raw==="") return [];
  if(typeof raw !== "string"){ const t = rosterParseTime(raw); return t ? [[t,""]] : []; }
  const T = "\\d{1,2}(?::\\d{2})?\\s*(?:AM|PM)?";
  const re = new RegExp("("+T+")\\s*(?:-|–|—|\\bto\\b)\\s*("+T+")","gi");
  const pairs = []; let m;
  while((m = re.exec(raw))){
    const a = rosterParseTime(m[1].trim()), b = rosterParseTime(m[2].trim());
    if(a && b) pairs.push([a,b]);
  }
  if(!pairs.length){ const t = rosterParseTime(raw.trim()); if(t) pairs.push([t,""]); }
  return pairs;
}
function rosterReadTimes(rec){
  const out = {};
  if(rec.breaksAll!==undefined && rec.breaksAll!==""){
    [["break1Start","break1End"],["break2Start","break2End"],["lunchStart","lunchEnd"]].forEach((keys,i)=>{
      const p = rosterSplitAllBreaks(rec.breaksAll)[i];
      if(p){ out[keys[0]] = p[0]; if(p[1]) out[keys[1]] = p[1]; }
    });
  }
  ROSTER_TIME_FIELDS.forEach(f=>{
    const raw = rec[f];
    if(raw===undefined || raw===null || raw==="") return;
    // A range is checked first: parseTimeValue only reads the leading time, so "9:00 AM - 6:00 PM" would otherwise lose its end.
    const pair = ROSTER_TIME_PAIRS[f] && rosterSplitTimeRange(raw);
    if(pair){ out[f] = pair[0]; const endKey = ROSTER_TIME_PAIRS[f][0]; if(rec[endKey]===undefined || rec[endKey]==="") out[endKey] = pair[1]; return; }
    const t = rosterParseTime(raw);
    if(t) out[f] = t;
  });
  // File gave a shift start but no shift end: every Align360 shift is 10 hours (5:30 PM–3:30 AM, 6:30 PM–4:30 AM, ...).
  if(out.shiftStart && !out.shiftEnd && (rec.shiftEnd===undefined || rec.shiftEnd==="")) out.shiftEnd = computeEndTime(out.shiftStart, ROSTER_DEFAULT_SHIFT_MIN);
  Object.entries(ROSTER_TIME_PAIRS).forEach(([startKey,[endKey,mins]])=>{
    if(mins && out[startKey] && !out[endKey] && (rec[endKey]===undefined || rec[endKey]==="")) out[endKey] = computeEndTime(out[startKey], mins);
  });
  return out;
}
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
// "Claims, Eligibility" / "claims & elig" / "Claims and UM Intake" / "Providers"  ->  canonical LOB names from LOB_OPTIONS
// (de-duplicated, order kept). Matching: exact (case-insensitive), then the LOB name inside the cell text or vice-versa
// (so "Providers" -> Provider), then the short forms "claim..." / "elig...".
function rosterParseLobs(raw){
  const out = [];
  String(raw||"").split(/[,;\/&+|\n]|\band\b/i).forEach(tok=>{
    const t = tok.trim().toLowerCase(); if(!t) return;
    let lob = LOB_OPTIONS.find(l=>l.toLowerCase()===t) || "";
    if(!lob && t.length>=4) lob = LOB_OPTIONS.find(l=>{ const k=l.toLowerCase(); return t.includes(k) || k.includes(t); }) || "";
    if(!lob){ if(/claim/.test(t)) lob = "Claims"; else if(/elig/.test(t)) lob = "Eligibility"; }
    if(lob && !out.includes(lob)) out.push(lob);
  });
  return out;
}
const AGENT_IMPORT_FIELDS = [
  ["", "— Ignore this column —"],
  ["name", "Name (required)"],
  ["empId", "Emp ID"],
  ["joiningDate", "Joining Date"],
  ["tlName", "TL (Team Leader)"],
  ["lob", "LOB"],
  ["extraLobs", "Additional LOBs"],
  ["status", "Status"],
  ["notes", "Notes"],
  ["shiftStart", "Shift Start (or full range)"],
  ["shiftEnd", "Shift End"],
  ["break1Start", "Break 1 Start (or range)"],
  ["break1End", "Break 1 End"],
  ["break2Start", "Break 2 Start (or range)"],
  ["break2End", "Break 2 End"],
  ["lunchStart", "Lunch Start (or range)"],
  ["lunchEnd", "Lunch End"],
  ["breaksAll", "All breaks in one cell (Break 1, Break 2, Lunch in order)"]
];
// Shared row reader for the import and its preview, so the preview shows exactly what the import will do.
// opts: {defaultTl, defaultLob, fillDownTl}. Returns one entry per agent row in the file (no state changes).
function rosterReadImportRows(sheetRows, colMap, opts){
  opts = opts || {};
  const out = [];
  let lastName = "", lastTl = "";
  sheetRows.forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    let name = String(rec.name||"").trim();
    if(!name) name = lastName; // fill-down for merged-cell style files
    if(!name) return;
    lastName = name;
    let tlFromFile = String(rec.tlName||"").trim();
    if(tlFromFile) lastTl = tlFromFile;
    else if(opts.fillDownTl && lastTl) tlFromFile = lastTl;
    const tlName = tlFromFile || String(opts.defaultTl||"").trim();
    const lobsFound = rosterParseLobs(rec.lob).concat(rosterParseLobs(rec.extraLobs));
    if(!lobsFound.length && opts.defaultLob) lobsFound.push(opts.defaultLob);
    const times = rosterReadTimes(rec);
    out.push({rec, name, tlName, tlFromFile: !!tlFromFile, lobsFound, times, existing: state.roster.some(a=>normalizeName(a.name)===normalizeName(name))});
  });
  return out;
}
function importAgentsFile(sheetRows, colMap, opts){
  if(!Object.values(colMap).includes("name")){
    throw new Error("missing required Name column");
  }
  let added = 0, skippedExisting = 0, noTl = 0, timesUpdated = 0, agentCounter = state.roster.length + 1;
  const dupWarnings = [];
  rosterReadImportRows(sheetRows, colMap, opts).forEach(item=>{
    const {rec, name, tlName, lobsFound} = item;
    if(item.existing){
      // Already on the roster: nothing is overwritten except shift/break times the file actually contains.
      const ex = state.roster.find(a=>normalizeName(a.name)===normalizeName(name));
      if(ex && Object.keys(item.times).length){ Object.assign(ex, item.times); timesUpdated++; }
      else skippedExisting++;
      return;
    }
    const similar = findSimilarAgent(name, state.roster);
    if(similar && !dupWarnings.some(w=>w.imported===name && w.existing===similar.name)){
      dupWarnings.push({imported:name, existing:similar.name});
    }

    let empId = String(rec.empId||"").trim();
    if(!empId || state.roster.some(a=>a.empId===empId)){
      do{ empId = "IMP"+String(agentCounter).padStart(3,"0"); agentCounter++; }while(state.roster.some(a=>a.empId===empId));
    }
    const joiningDate = parseFlexibleDate(rec.joiningDate,"auto") || todayIso();
    if(tlName && !state.settings.tls.includes(tlName)){ state.settings.tls.push(tlName); }
    if(!tlName) noTl++;
    // LOB cell may hold one LOB or several ("Claims, Eligibility" / "Claims & Eligibility"): first = primary, rest = cross-trained.
    // An optional separate "Additional LOBs" column is merged in as well.
    const lob = lobsFound[0] || "";
    const extraLobs = lob ? Array.from(new Set(lobsFound.slice(1))).filter(l=>l!==lob) : [];
    let status = String(rec.status||"").trim();
    status = /inactive/i.test(status) ? "Inactive" : "Active";
    const notes = String(rec.notes||"").trim() || "Added via Excel import";

    state.roster.push({empId, name, joiningDate, status, inactiveSince: status==="Inactive"?todayIso():"", notes, tlName, lob, extraLobs, shiftStart:"", shiftEnd:"", break1Start:"", break1End:"", break2Start:"", break2End:"", lunchStart:"", lunchEnd:"", ...item.times});
    added++;
  });
  saveState();
  return {added, skippedExisting, timesUpdated, noTl, dupWarnings};
}
function openImportAgentsModal(){
  const overlay = showModal(`
    <div class="modal-title">Import agents from Excel</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.6;margin:0 0 14px;">
      Upload a CSV or Excel file with a <b>Name</b> column, plus any of: Emp ID, Joining Date, TL, LOB, Status, Notes. On the next step you'll see how each column was detected — and can fix it, or pick a default TL — before anything is saved. Agents whose name already matches someone on the roster are skipped, not duplicated. New TL names found in the file are added to your TL list automatically. LOB values are matched to the LOB list in Settings (e.g. Claims, Eligibility, UM Intake, Provider).
    </p>
    <div class="field"><input type="file" id="importAgentsFileInput" accept=".csv,.xlsx,.xls"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="importAgentsCancel">Cancel</button>
      <button class="btn btn-accent" id="importAgentsGo">Next: review mapping</button>
    </div>
  `);
  overlay.querySelector("#importAgentsCancel").addEventListener("click", closeModal);
  overlay.querySelector("#importAgentsGo").addEventListener("click", async ()=>{
    const file = document.getElementById("importAgentsFileInput").files[0];
    if(!file){ showToast("Choose a file first"); return; }
    const btn = document.getElementById("importAgentsGo");
    btn.textContent = "Reading…"; btn.disabled = true;
    try{
      const sheetRows = await readSheetRowsSmart(file);
      const colMap = detectAgentColumnMap(sheetRows);
      openImportAgentsReviewModal(sheetRows, colMap);
    }catch(err){
      console.error(err);
      showToast("⚠ Could not read that file — make sure it has a Name column");
      btn.textContent = "Next: review mapping"; btn.disabled = false;
    }
  });
}
function openImportAgentsReviewModal(sheetRows, colMap){
  const headers = Object.keys(sheetRows[0]||{});
  const tls = state.settings.tls || [];
  const rowsHtml = headers.map(h=>{
    const current = colMap[h] || "";
    const opts = AGENT_IMPORT_FIELDS.map(([f,label])=>`<option value="${f}" ${f===current?'selected':''}>${esc(label)}</option>`).join("");
    return `<tr><td class="mono">${esc(h)}</td><td><select class="cell-select agent-map-sel" data-header="${esc(h)}" style="width:100%;">${opts}</select></td></tr>`;
  }).join("");
  const overlay = showModal(`
    <div class="modal-title">Review agent import</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 10px;">Check each column landed on the right field. Nothing is saved until you click Import.</p>
    <div class="table-wrap" style="max-height:180px;overflow-y:auto;margin-bottom:12px;">
      <table class="mini-table"><thead><tr><th>File column</th><th>Maps to</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    </div>
    <div id="agentTlWarn" style="display:none;font-size:12px;line-height:1.5;padding:8px 10px;border-radius:6px;margin-bottom:12px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-bottom:10px;">
      <div class="field" style="margin:0;"><label>Default TL (for rows with no TL)</label>
        <select id="agentDefaultTl" style="width:100%;"><option value="">— Leave unassigned —</option>${tls.map(tl=>`<option value="${esc(tl)}">${esc(tl)}</option>`).join("")}</select></div>
      <div class="field" style="margin:0;"><label>Default LOB (for rows with no LOB)</label>
        <select id="agentDefaultLob" style="width:100%;"><option value="">— Leave blank —</option>${LOB_OPTIONS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("")}</select></div>
    </div>
    <label id="agentFillTlWrap" style="display:none;font-size:12px;margin-bottom:10px;"><input type="checkbox" id="agentFillTl"> Blank TL cells belong to the TL above (merged cells in Excel)</label>
    <div id="agentImportSummary" style="font-size:12px;margin-bottom:6px;"></div>
    <div class="table-wrap" style="max-height:200px;overflow-y:auto;margin-bottom:14px;">
      <table class="mini-table"><thead><tr><th>Name</th><th>Emp ID</th><th>TL</th><th>LOB</th><th>Status</th><th>Shift</th><th>Breaks / Lunch</th></tr></thead><tbody id="agentPreviewBody"></tbody></table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="agentImportBack">Back</button>
      <button class="btn btn-accent" id="agentImportCommit">✔ Import now</button>
    </div>
  `);
  const readState = ()=>{
    const liveMap = {};
    overlay.querySelectorAll(".agent-map-sel").forEach(sel=>{ if(sel.value) liveMap[sel.dataset.header] = sel.value; });
    const dupField = Object.values(liveMap).find((f,i,a)=>a.indexOf(f)!==i);
    const opts = {defaultTl: document.getElementById("agentDefaultTl").value, defaultLob: document.getElementById("agentDefaultLob").value, fillDownTl: document.getElementById("agentFillTl").checked};
    return {liveMap, opts, dupField};
  };
  const refresh = ()=>{
    const {liveMap, opts, dupField} = readState();
    const hasName = Object.values(liveMap).includes("name");
    const hasTlCol = Object.values(liveMap).includes("tlName");
    document.getElementById("agentFillTlWrap").style.display = hasTlCol ? "block" : "none";
    const items = hasName ? rosterReadImportRows(sheetRows, liveMap, opts) : [];
    const fresh = items.filter(i=>!i.existing);
    const noTl = fresh.filter(i=>!i.tlName).length;
    const warn = document.getElementById("agentTlWarn");
    const msgs = [];
    if(!hasName) msgs.push("⚠ No column is mapped to <b>Name</b> — pick one above.");
    if(dupField) msgs.push(`⚠ More than one column is mapped to <b>${esc((AGENT_IMPORT_FIELDS.find(f=>f[0]===dupField)||[])[1]||dupField)}</b> — only the last one will be used.`);
    if(hasName && !hasTlCol) msgs.push(`⚠ No column is mapped to <b>TL</b>. ${opts.defaultTl ? `All rows without a TL will go to <b>${esc(opts.defaultTl)}</b>.` : "Every agent will be imported as <b>Unassigned</b> unless you map a column above or choose a Default TL."}`);
    else if(hasName && hasTlCol && noTl) msgs.push(`⚠ ${noTl} of ${fresh.length} new agent(s) have no TL in the file${opts.defaultTl ? "" : " and will be <b>Unassigned</b>"}. Pick a Default TL${opts.fillDownTl ? "" : " or tick the merged-cells option"} if that isn't what you want.`);
    if(hasName && Object.values(liveMap).includes("shiftStart") && !Object.values(liveMap).includes("shiftEnd")) msgs.push("ℹ No Shift End column — each shift end will be set 10 hours after its start (e.g. 6:30 PM → 4:30 AM) unless the Shift cell already holds a range.");
    const mappedTimeFields = ROSTER_TIME_FIELDS.concat(["breaksAll"]).filter(f=>Object.values(liveMap).includes(f));
    const existingWithTimes = items.filter(i=>i.existing && Object.keys(i.times).length).length;
    if(hasName && mappedTimeFields.length){
      const unreadable = items.filter(i=>mappedTimeFields.some(f=> String(i.rec[f]??"").trim()!=="" && (f==="breaksAll" ? !(i.times.break1Start||i.times.break2Start||i.times.lunchStart) : i.times[f]===undefined))).length;
      if(unreadable) msgs.push(`⚠ ${unreadable} row(s) have a shift/break cell that couldn't be read as a time (use e.g. 9:00 AM, 17:30, or a range like 9:00 AM - 6:00 PM). Those cells will be left blank.`);
    }
    warn.style.display = msgs.length ? "block" : "none"; warn.innerHTML = msgs.join("<br>");
    document.getElementById("agentImportSummary").innerHTML = hasName
      ? `<b>${fresh.length}</b> new agent(s) will be added${items.length-fresh.length ? `, <b>${items.length-fresh.length}</b> already on the roster ${existingWithTimes ? `(<b>${existingWithTimes}</b> will only get their shift/break times updated)` : "will be skipped"}` : ""}. Preview — first ${Math.min(6,items.length)} row(s):`
      : "";
    const t12 = v=> v ? formatTime12(v) : "—";
    const timeCells = i=>{
      const t = i.times;
      const shift = t.shiftStart||t.shiftEnd ? `${t12(t.shiftStart)} – ${t12(t.shiftEnd)}` : "—";
      const brk = t.break1Start||t.break2Start||t.lunchStart ? `${t12(t.break1Start)}, ${t12(t.break2Start)}, L ${t12(t.lunchStart)}` : "—";
      return `<td class="mono" style="font-size:11px;">${shift}</td><td class="mono" style="font-size:11px;">${brk}</td>`;
    };
    document.getElementById("agentPreviewBody").innerHTML = items.slice(0,6).map(i=>{
      const tlCell = i.tlName ? esc(i.tlName) + (i.tlFromFile ? "" : ' <span style="color:var(--text-muted);">(default)</span>') : '<span style="color:#d97706;">— Unassigned —</span>';
      return `<tr style="${i.existing?'opacity:.5;':''}"><td>${esc(i.name)}${i.existing?' <i>(already on roster)</i>':''}</td><td>${esc(String(i.rec.empId||"")||"auto")}</td><td>${tlCell}</td><td>${esc(i.lobsFound.join(", ")||"—")}</td><td>${/inactive/i.test(String(i.rec.status||""))?"Inactive":"Active"}</td>${timeCells(i)}</tr>`;
    }).join("");
  };
  overlay.querySelectorAll(".agent-map-sel").forEach(sel=> sel.addEventListener("change", refresh));
  ["agentDefaultTl","agentDefaultLob","agentFillTl"].forEach(id=> document.getElementById(id).addEventListener("change", refresh));
  refresh();

  overlay.querySelector("#agentImportBack").addEventListener("click", ()=>{ closeModal(); openImportAgentsModal(); });
  overlay.querySelector("#agentImportCommit").addEventListener("click", ()=>{
    const {liveMap, opts} = readState();
    if(!Object.values(liveMap).includes("name")){ showToast("Map one column to Name first"); return; }
    const btn = document.getElementById("agentImportCommit");
    btn.textContent = "Importing…"; btn.disabled = true;
    try{
      const result = importAgentsFile(sheetRows, liveMap, opts);
      try{ logAudit("roster_import", `Roster import — added ${result.added}${result.timesUpdated?`, updated shift/break times for ${result.timesUpdated}`:""}${result.skippedExisting?`, skipped ${result.skippedExisting} existing`:""}`); }catch(e){}
      closeModal(); render();
      showToast(`✅ Added ${result.added} agent(s)${result.timesUpdated ? `, updated shift/break times for ${result.timesUpdated} existing` : ""}${result.skippedExisting ? `, skipped ${result.skippedExisting} already on roster` : ""}${result.noTl ? ` — ⚠ ${result.noTl} have no TL (Unassigned)` : ""}`);
      if(result.dupWarnings && result.dupWarnings.length) showDuplicateWarningModal(result.dupWarnings);
    }catch(err){
      console.error(err);
      showToast("⚠ Import failed — check the mapping");
      btn.textContent = "✔ Import now"; btn.disabled = false;
    }
  });
}

/* ---------------- LEAVE TRACKER (derived, read-only) ---------------- */


/* ---------------- Smart file reader for roster / shift imports ----------------
   Handles files where the header row is not row 1 (title rows above it) or where the data is on a later sheet.
   Picks the sheet + row whose cells best match the known roster/shift column names. Falls back to the plain reader. */
async function readSheetRowsSmart(file){
  const ext = file.name.split(".").pop().toLowerCase();
  if(ext === "csv") return readSheetRows(file);
  const known = new Set(Object.values(AGENT_HEADER_MAP).flat());
  const wb = XLSX.read(await file.arrayBuffer(), {type:"array", cellDates:true});
  let best = null;
  wb.SheetNames.forEach(sn=>{
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header:1, defval:""});
    grid.slice(0,15).forEach((row,ri)=>{
      const norm = row.map(c=>normalizeHeader(c));
      const hits = norm.filter(h=>h && known.has(h)).length;
      const hasId = norm.some(h=>AGENT_HEADER_MAP.name.includes(h) || AGENT_HEADER_MAP.empId.includes(h));
      if(hasId && hits>=2 && (!best || hits>best.hits)) best = {sn, ri, hits, grid};
    });
  });
  if(!best) return readSheetRows(file);
  const head = best.grid[best.ri].map(c=>String(c).trim());
  const seen = {};
  const keys = head.map((h,i)=>{ let k = h || `Column ${i+1}`; if(seen[k]){ seen[k]++; k = `${k} (${seen[k]})`; } else seen[k] = 1; return k; });
  const rows = best.grid.slice(best.ri+1).filter(r=>r.some(c=>String(c).trim()!==""))
    .map(r=>{ const o = {}; keys.forEach((k,i)=>{ o[k] = r[i]===undefined ? "" : r[i]; }); return o; });
  if(!rows.length) return readSheetRows(file);
  return rows;
}
