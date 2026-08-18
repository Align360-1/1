/* ---------------- Break Reminder System ---------------- */
let __breakReminderTimer = null;
let __shownBreakReminders = new Set(); // "empId__breakStart" to avoid dupes per day
const __originalPageTitle = document.title;
let __titleFlashTimer = null;

function flashPageTitle(msg){
  if(__titleFlashTimer) clearInterval(__titleFlashTimer);
  let toggle = false;
  __titleFlashTimer = setInterval(()=>{
    document.title = toggle ? __originalPageTitle : msg;
    toggle = !toggle;
  }, 1200);
  const stop = ()=>{
    if(__titleFlashTimer){ clearInterval(__titleFlashTimer); __titleFlashTimer = null; }
    document.title = __originalPageTitle;
    window.removeEventListener("focus", stop);
  };
  window.addEventListener("focus", stop);
  setTimeout(stop, 90000); // stop flashing on its own after 90s even if never refocused
}

function playBreakSound(){
  try{
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
    osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3); // G5
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.6);
  }catch(e){}
}

function showBreakReminder(agent, breakName, minsLeft){
  const overlay = document.createElement("div");
  overlay.className = "reminder-overlay";
  overlay.id = "breakReminderOverlay";
  overlay.innerHTML = `
    <div class="reminder-box">
      <div class="bell">🔔</div>
      <h3>Break Reminder</h3>
      <p>Hi <b>${esc(agent.name)}</b>,<br><b>${breakName}</b> starts in <b>${minsLeft} minutes</b>.</p>
      <button class="btn btn-accent" id="dismissBreakReminder" style="width:100%;">Got it</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("dismissBreakReminder").addEventListener("click", ()=>{
    overlay.remove();
  });
  // Auto-dismiss after 60 seconds
  setTimeout(()=>{ if(document.getElementById("breakReminderOverlay")) overlay.remove(); }, 60000);
}

function fireBreakReminder(agent, breakName, minsLeft){
  playBreakSound();

  // System notification — this is what actually shows up when the tab is minimized,
  // in the background, or a different tab is focused. Needs prior permission (see
  // the "Enable notifications" banner) and a secure context (https/localhost); it
  // may not fire on some browsers if this file is opened directly (file://).
  if("Notification" in window && Notification.permission==="granted"){
    try{
      const n = new Notification("🔔 Break Reminder", {
        body: `${breakName} starts in ${minsLeft} minute${minsLeft===1?'':'s'}.`,
        tag: "break-reminder-"+agent.empId, // replaces any earlier notification instead of stacking
        renotify: true
      });
      n.onclick = ()=>{ try{ window.focus(); }catch(e){} n.close(); };
    }catch(e){ /* notification dispatch failed — sound + title flash below still cover it */ }
  }

  // In-page popup — best experience, but only meaningful while the tab is actually visible.
  if(!document.hidden){
    showBreakReminder(agent, breakName, minsLeft);
  }

  // Zero-permission fallback: flash the browser tab's title so it's noticeable even if
  // system notifications are blocked or unsupported in this context.
  flashPageTitle(`🔔 ${breakName} in ${minsLeft} min`);
}
function notifPermissionBannerHtml(){
  if(!("Notification" in window)) return "";
  if(Notification.permission!=="default") return "";
  if(notifWasGrantedLocally()) return ""; // belt-and-braces: some browsers (insecure/file:// contexts) don't reliably reflect a grant back into Notification.permission
  return `<div class="notif-permission-banner" style="display:flex;align-items:center;gap:10px;justify-content:space-between;flex-wrap:wrap;padding:10px 14px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);margin-bottom:14px;">
    <span style="font-size:12.5px;color:var(--text-muted);">🔔 Turn on notifications to get your break/lunch reminder even if this tab is minimized or in the background.</span>
    <button class="btn btn-sm btn-accent" id="enableNotifBtn">Enable notifications</button>
  </div>`;
}
function notifGrantedKey(){
  const key = userViewKey();
  return key ? ("a360_notif_granted_"+key) : null;
}
function notifWasGrantedLocally(){
  const key = notifGrantedKey();
  if(!key) return false;
  try{ return localStorage.getItem(key)==="1"; }catch(e){ return false; }
}
function wireNotifPermissionBanner(){
  const btn = document.getElementById("enableNotifBtn");
  if(!btn) return;
  btn.addEventListener("click", ()=>{
    Notification.requestPermission().then(perm=>{
      if(perm==="granted"){
        showToast("✅ Notifications enabled — you'll get break reminders even if this tab isn't active");
        const key = notifGrantedKey();
        if(key){ try{ localStorage.setItem(key, "1"); }catch(e){} }
        const banner = document.querySelector(".notif-permission-banner");
        if(banner) banner.remove(); // hide immediately, don't wait on a re-render
      } else {
        showToast("Notifications weren't enabled — you'll still get the on-screen popup and sound while this tab is open");
      }
      render();
    });
  });
}
function checkBreakReminders(){
  if(!isAgent() || !currentAgentId()) return;
  const agent = state.roster.find(a=>a.empId===currentAgentId());
  if(!agent) return;

  const now = new Date();
  const breaks = [
    {name: "Break 1 (15 min)", start: agent.break1Start},
    {name: "Break 2 (15 min)", start: agent.break2Start},
    {name: "Lunch (30 min)", start: agent.lunchStart}
  ];

  breaks.forEach(b=>{
    if(!b.start) return;
    const [bh, bm] = b.start.split(":").map(Number);
    const breakDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), bh, bm, 0);
    const diffMin = Math.round((breakDate - now) / 60000);
    if(diffMin >= 0 && diffMin <= 15){
      const key = agent.empId + "__" + b.start + "__" + todayIso();
      if(!__shownBreakReminders.has(key)){
        __shownBreakReminders.add(key);
        fireBreakReminder(agent, b.name, diffMin);
      }
    }
  });
}

function startBreakReminder(){
  if(__breakReminderTimer) clearInterval(__breakReminderTimer);
  __breakReminderTimer = setInterval(checkBreakReminders, 60000); // check every minute
  checkBreakReminders(); // immediate check
}
function stopBreakReminder(){
  if(__breakReminderTimer){ clearInterval(__breakReminderTimer); __breakReminderTimer = null; }
}

function applyTheme(){
  document.documentElement.setAttribute("data-theme", userTheme === "light" ? "light" : "dark");
  const btn = document.getElementById("themeToggleBtn");
  if(btn) btn.textContent = userTheme === "light" ? "🌙  Switch to dark" : "☀️  Switch to light";
}
document.getElementById("themeToggleBtn").addEventListener("click", ()=>{
  userTheme = userTheme === "light" ? "dark" : "light";
  saveThemeForUser();
  applyTheme();
});

/* ---------------- Shift Import ---------------- */
const SHIFT_HEADER_MAP = {
  empId: ["empid","employeeid","id","empcode","code","employeecode"],
  name: ["name","agentname","employeename","fullname"],
  shiftStart: ["shiftstart","shift_start","starttime","start_time","shiftstarttime","shiftintime","shiftin","logintime","login","shift"],
  shiftEnd: ["shiftend","shift_end","endtime","end_time","shiftendtime","shiftouttime","shiftout","logouttime","logout"],
  break1Start: ["break1start","break1_start","b1start","break_1_start","break1intime","break1in","firstbreakstart","firstbreak","break1","break1time"],
  break1End: ["break1end","break1_end","b1end","break_1_end","break1outtime","break1out","firstbreakend"],
  break2Start: ["break2start","break2_start","b2start","break_2_start","break2intime","break2in","secondbreakstart","secondbreak","break2","break2time"],
  break2End: ["break2end","break2_end","b2end","break_2_end","break2outtime","break2out","secondbreakend"],
  lunchStart: ["lunchstart","lunch_start","break3start","break3_start","lunchintime","lunchin","lunchtime","lunch"],
  lunchEnd: ["lunchend","lunch_end","break3end","break3_end","lunchouttime","lunchout"]
};
function matchShiftField(headerNorm){
  for(const [field,candidates] of Object.entries(SHIFT_HEADER_MAP)){
    if(candidates.includes(headerNorm)) return field;
  }
  return null;
}
function detectShiftColumnMap(sheetRows){
  const colMap = {};
  Object.keys(sheetRows[0]||{}).forEach(k=>{
    const f = matchShiftField(normalizeHeader(k));
    if(f && !Object.values(colMap).includes(f)) colMap[k] = f;
  });
  return colMap;
}
// Robust time-value parser: raw cells coming out of SheetJS can be a JS Date
// object (Excel time cells, since we read with cellDates:true), a numeric
// Excel serial (fraction-of-a-day), or a plain string like "5:30 PM"/"17:30".
// The old version only handled strings, so Date objects fell through to
// String(dateObj) — a long, ugly toString() — and got stored as-is.
function parseTimeValue(raw){
  if(raw instanceof Date && !isNaN(raw)){
    return String(raw.getHours()).padStart(2,"0") + ":" + String(raw.getMinutes()).padStart(2,"0");
  }
  if(typeof raw === "number" && isFinite(raw)){
    const fraction = raw - Math.floor(raw);
    const totalMinutes = Math.round(fraction * 24 * 60) % (24*60);
    return String(Math.floor(totalMinutes/60)).padStart(2,"0") + ":" + String(totalMinutes%60).padStart(2,"0");
  }
  const t = String(raw??"").trim();
  if(!t) return "";
  const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if(m){
    let h = parseInt(m[1],10); const min = m[2];
    const ampm = m[3] ? m[3].toUpperCase() : null;
    if(ampm === "PM" && h < 12) h += 12;
    if(ampm === "AM" && h === 12) h = 0;
    return String(h).padStart(2,"0") + ":" + min;
  }
  return ""; // unrecognized format — leave blank rather than store garbage
}
// 12-hour display formatter for read-only time text (native <input type="time">
// already renders in the browser's own locale format, so this is only used
// for plain-text displays like Roster and the agent's own schedule card).
function formatTime12(t){
  if(!t) return "—";
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if(!m) return "—";
  let h = parseInt(m[1],10); const min = m[2];
  const ampm = h>=12 ? "PM" : "AM";
  let h12 = h % 12; if(h12===0) h12 = 12;
  return `${h12}:${min} ${ampm}`;
}
// Guards against pre-existing corrupted values (from the old import bug) ever
// being fed into a native <input type="time">, which silently renders blank
// if the value isn't exactly "HH:MM".
function safeTimeValue(t){
  return /^\d{1,2}:\d{2}$/.test(String(t||"")) ? t : "";
}
function importShiftFile(sheetRows, colMap){
  if(!Object.values(colMap).includes("empId") && !Object.values(colMap).includes("name")){
    throw new Error("Need at least Emp ID or Name column");
  }
  let updated = 0, notFound = 0;
  const timeFields = ["shiftStart","shiftEnd","break1Start","break1End","break2Start","break2End","lunchStart","lunchEnd"];
  const fieldsFound = new Set(Object.values(colMap).filter(f=>timeFields.includes(f)));
  sheetRows.forEach(row=>{
    const rec = {};
    Object.entries(colMap).forEach(([origKey,field])=>{ rec[field] = row[origKey]; });
    let agent = null;
    const empId = String(rec.empId||"").trim();
    const name = String(rec.name||"").trim();
    if(empId) agent = state.roster.find(a=>a.empId===empId);
    if(!agent && name) agent = state.roster.find(a=>normalizeName(a.name)===normalizeName(name));
    if(!agent){ notFound++; return; }

    timeFields.forEach(f=>{
      if(rec[f] !== undefined && rec[f] !== null && rec[f] !== ""){
        const parsed = parseTimeValue(rec[f]);
        if(parsed) agent[f] = parsed;
      }
    });
    // If the file gave a break/lunch start but no usable end time for it, auto-fill the end.
    const BREAK_DURATIONS = {break1Start:{endKey:"break1End", minutes:15}, break2Start:{endKey:"break2End", minutes:15}, lunchStart:{endKey:"lunchEnd", minutes:30}};
    Object.entries(BREAK_DURATIONS).forEach(([startKey,{endKey,minutes}])=>{
      if(agent[startKey] && !fieldsFound.has(endKey)){
        agent[endKey] = computeEndTime(agent[startKey], minutes);
      }
    });
    updated++;
  });
  saveState();
  const notFoundFields = timeFields.filter(f=>!fieldsFound.has(f));
  if(updated>0) logAudit("shift_import", `Bulk shift import — updated ${updated} agent${updated>1?'s':''}${notFound?`, ${notFound} row(s) not matched`:''}`, {});
  return {updated, notFound, fieldsFound:[...fieldsFound], notFoundFields};
}
function openImportShiftsModal(){
  const overlay = showModal(`
    <div class="modal-title">Import Shift Timings</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.6;margin:0 0 14px;">
      Upload a CSV or Excel file with columns: <b>Emp ID</b> or <b>Name</b>, plus any of: Shift Start, Shift End, Break 1 Start/End, Break 2 Start/End, Lunch Start/End. Existing agents will be updated.
    </p>
    <div class="field"><input type="file" id="importShiftsFileInput" accept=".csv,.xlsx,.xls"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="importShiftsCancel">Cancel</button>
      <button class="btn btn-accent" id="importShiftsGo">Import</button>
    </div>
  `);
  overlay.querySelector("#importShiftsCancel").addEventListener("click", closeModal);
  overlay.querySelector("#importShiftsGo").addEventListener("click", async ()=>{
    const file = document.getElementById("importShiftsFileInput").files[0];
    if(!file){ showToast("Choose a file first"); return; }
    const btn = document.getElementById("importShiftsGo");
    btn.textContent = "Importing..."; btn.disabled = true;
    try{
      const sheetRows = await readSheetRows(file);
      const colMap = detectShiftColumnMap(sheetRows);
      if(!Object.values(colMap).length){ showToast("No recognizable columns found"); btn.textContent = "Import"; btn.disabled = false; return; }
      const result = importShiftFile(sheetRows, colMap);
      closeModal(); render();
      const FIELD_LABELS = {shiftStart:"Shift Start",shiftEnd:"Shift End",break1Start:"Break 1 Start",break1End:"Break 1 End",break2Start:"Break 2 Start",break2End:"Break 2 End",lunchStart:"Lunch Start",lunchEnd:"Lunch End"};
      let msg = `✅ Updated ${result.updated} agent(s)${result.notFound ? `, ${result.notFound} not found` : ""}.`;
      if(result.notFoundFields.length){
        msg += ` Columns not found in the file (left unchanged): ${result.notFoundFields.map(f=>FIELD_LABELS[f]).join(", ")}.`;
      }
      showToast(msg);
    }catch(err){
      console.error(err);
      showToast("⚠ Could not read that file");
      btn.textContent = "Import"; btn.disabled = false;
    }
  });
}




// Expose for event listener safety
window.openImportShiftsModal = openImportShiftsModal;
/* ---------------- BREAK SCHEDULE ---------------- */
function renderBreaks(content, topActions){
  if(isAgent()){
    topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Your shift & break schedule</span>`;
  } else {
    topActions.innerHTML = `
      <span style="font-size:12px;color:var(--text-muted);">Team shift & break schedule</span>
      ${isWFM() ? `<button class="btn btn-accent" id="openSwapShiftsBtn">🔁 Swap shifts</button>` : ""}
    `;
    const swapBtn = document.getElementById("openSwapShiftsBtn");
    if(swapBtn) swapBtn.addEventListener("click", openSwapShiftsModal);
  }

  let visibleAgents = scopedRoster().filter(a=>a.status==="Active");
  if(isAgent()) visibleAgents = state.roster.filter(a=>a.status==="Active" && a.empId===currentAgentId());

  // Agent's own schedule card
  if(isAgent() && visibleAgents.length){
    const a = visibleAgents[0];
    content.innerHTML = `
      ${notifPermissionBannerHtml()}
      <div class="break-card">
        <h3>👤 ${esc(a.name)} — ${esc(a.empId)}</h3>
        <div class="break-row">
          <div><div class="label">Shift</div><div class="value">${formatTime12(a.shiftStart)} → ${formatTime12(a.shiftEnd)}</div></div>
          <div><div class="label">Break 1 (15m)</div><div class="value">${formatTime12(a.break1Start)} → ${formatTime12(a.break1End)}</div></div>
          <div><div class="label">Break 2 (15m)</div><div class="value">${formatTime12(a.break2Start)} → ${formatTime12(a.break2End)}</div></div>
          <div><div class="label">Lunch (30m)</div><div class="value">${formatTime12(a.lunchStart)} → ${formatTime12(a.lunchEnd)}</div></div>
          <div><div class="label">TL</div><div class="value">${esc(a.tlName||'—')}</div></div>
          <div><div class="label">LOB</div><div class="value">${esc(a.lob||'—')}</div></div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title"><span class="eyebrow">◷</span>Request Shift Swap</div>
        </div>
        <div class="section-body">
          <div class="form-inline" style="gap:12px;flex-wrap:wrap;">
            <div class="field" style="min-width:160px;">
              <label>Swap with</label>
              <select id="swapRecipient" style="width:100%;">
                <option value="">Select teammate</option>
                ${state.roster.filter(x=>x.status==="Active" && x.empId!==a.empId).map(x=>`<option value="${esc(x.empId)}">${esc(x.name)}</option>`).join("")}
              </select>
            </div>
            <div class="field" style="min-width:140px;">
              <label>Date</label>
              <input type="date" id="swapDate" value="${todayIso()}" style="width:100%;">
            </div>
            <div class="field" style="min-width:120px;">
              <label>&nbsp;</label>
              <button class="btn btn-accent" id="requestSwapBtn" style="width:100%;">Request Swap</button>
            </div>
          </div>
          <div class="help-note">Select a teammate and date to request a shift swap. Your TL will review and approve or reject it.</div>
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title"><span class="eyebrow">◷</span>Your Swap Requests</div>
        </div>
        <div class="section-body">
          ${renderSwapRows(a.empId)}
        </div>
      </div>
    `;
    document.getElementById("requestSwapBtn").addEventListener("click", ()=>{
      const recipient = document.getElementById("swapRecipient").value;
      const date = document.getElementById("swapDate").value;
      if(!recipient || !date){ showToast("Select a teammate and date"); return; }
      state.shiftSwaps.push({
        id: "swap"+Date.now(),
        requesterEmpId: a.empId,
        recipientEmpId: recipient,
        date: date,
        status: "pending",
        requestedAt: new Date().toISOString()
      });
      saveState(); render();
      showToast("✅ Swap request sent");
    });
    content.querySelectorAll(".cancel-swap-btn").forEach(btn=>{
      btn.addEventListener("click", ()=> cancelSwap(btn.dataset.id, btn));
    });
    wireNotifPermissionBanner();
    return;
  }

  // TL view: full schedule table + all swap requests
  // Filters (use outer variables)
  const searchTerm = (breakSearchFilter || "").toLowerCase();
  const shiftFilter = breakShiftFilter || "all";
  const breakFilter = breakBreakFilter || "all";

  let filteredAgents = visibleAgents;
  if(searchTerm){
    filteredAgents = filteredAgents.filter(a=>{
      return (a.name||"").toLowerCase().includes(searchTerm) || 
             (a.empId||"").toLowerCase().includes(searchTerm) ||
             (a.tlName||"").toLowerCase().includes(searchTerm) ||
             (a.lob||"").toLowerCase().includes(searchTerm);
    });
  }
  if(shiftFilter !== "all"){
    filteredAgents = filteredAgents.filter(a=>{
      if(!a.shiftStart) return false;
      return a.shiftStart === shiftFilter;
    });
  }
  if(breakFilter !== "all"){
    filteredAgents = filteredAgents.filter(a=>{
      if(breakFilter === "break1") return !!a.break1Start;
      if(breakFilter === "break2") return !!a.break2Start;
      if(breakFilter === "lunch") return !!a.lunchStart;
      if(breakFilter === "nobreak") return !a.break1Start && !a.break2Start && !a.lunchStart;
      return true;
    });
  }

  const rows = filteredAgents.map(a=>`
    <tr data-id="${esc(a.empId)}">
      <td>${esc(a.name)}</td>
      <td class="mono">${esc(a.empId)}</td>
      <td class="num"><input type="time" class="cell-input shift-start-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.shiftStart)}" style="width:80px;font-size:11px;padding:3px 4px;"></td>
      <td class="num"><input type="time" class="cell-input shift-end-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.shiftEnd)}" style="width:80px;font-size:11px;padding:3px 4px;"></td>
      <td class="num">
        <input type="time" class="cell-input break1-start-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.break1Start)}" style="width:70px;font-size:11px;padding:3px 4px;margin-bottom:2px;margin-left:auto;display:block;">
        <input type="time" class="cell-input break1-end-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.break1End)}" style="width:70px;font-size:11px;padding:3px 4px;margin-left:auto;display:block;">
      </td>
      <td class="num">
        <input type="time" class="cell-input break2-start-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.break2Start)}" style="width:70px;font-size:11px;padding:3px 4px;margin-bottom:2px;margin-left:auto;display:block;">
        <input type="time" class="cell-input break2-end-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.break2End)}" style="width:70px;font-size:11px;padding:3px 4px;margin-left:auto;display:block;">
      </td>
      <td class="num">
        <input type="time" class="cell-input lunch-start-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.lunchStart)}" style="width:70px;font-size:11px;padding:3px 4px;margin-bottom:2px;margin-left:auto;display:block;">
        <input type="time" class="cell-input lunch-end-input" data-id="${esc(a.empId)}" value="${safeTimeValue(a.lunchEnd)}" style="width:70px;font-size:11px;padding:3px 4px;margin-left:auto;display:block;">
      </td>
      <td>${esc(a.tlName||'—')}</td>
      <td>${esc(a.lob||'—')}</td>
    </tr>
  `).join("");

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">◷</span>Team Schedule</div>
        <div class="section-actions">
          <input type="text" id="breakSearchInput" placeholder="Search agent..." value="${esc(searchTerm||'')}" style="width:160px;font-size:12px;">
          <select id="breakShiftFilter" style="width:auto;min-width:140px;font-size:12px;">
            <option value="all" ${shiftFilter==='all'?'selected':''}>All shifts</option>
            <option value="17:30" ${shiftFilter==='17:30'?'selected':''}>Shift 1 (5:30 PM – 3:30 AM)</option>
            <option value="18:30" ${shiftFilter==='18:30'?'selected':''}>Shift 2 (6:30 PM – 4:30 AM)</option>
            <option value="19:30" ${shiftFilter==='19:30'?'selected':''}>Shift 3 (7:30 PM – 5:30 AM)</option>
          </select>
          <select id="breakBreakFilter" style="width:auto;min-width:110px;font-size:12px;">
            <option value="all" ${breakFilter==='all'?'selected':''}>All breaks</option>
            <option value="break1" ${breakFilter==='break1'?'selected':''}>Has Break 1</option>
            <option value="break2" ${breakFilter==='break2'?'selected':''}>Has Break 2</option>
            <option value="lunch" ${breakFilter==='lunch'?'selected':''}>Has Lunch</option>
            <option value="nobreak" ${breakFilter==='nobreak'?'selected':''}>No breaks set</option>
          </select>
          <button class="btn" id="importShiftsBtn">⬆ Import shifts</button>
        </div>
      </div>
      <div class="section-body table-wrap">
        ${filteredAgents.length ? `<table><thead><tr><th>Agent</th><th>Emp ID</th><th class="num">Shift Start</th><th class="num">Shift End</th><th class="num">Break 1</th><th class="num">Break 2</th><th class="num">Lunch</th><th>TL</th><th>LOB</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state"><p>No agents match the current filters.</p></div>`}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><div class="section-title"><span class="eyebrow">◷</span>Shift Swap Requests</div></div>
      <div class="section-body">
        ${renderSwapRows()}
      </div>
    </div>
  `;

  // Shift & break time editing — editing a break/lunch START time auto-computes
  // and fills its END time (Break 1 = 15m, Break 2 = 15m, Lunch = 30m), the same
  // way the Add Agent form already does. Editing an END time directly still
  // works as a manual override.
  const BREAK_DURATIONS = {break1Start:{endKey:"break1End", endSel:".break1-end-input", minutes:15},
                            break2Start:{endKey:"break2End", endSel:".break2-end-input", minutes:15},
                            lunchStart:{endKey:"lunchEnd", endSel:".lunch-end-input", minutes:30}};
  const shiftFields = [
    {sel: ".shift-start-input", key: "shiftStart"},
    {sel: ".shift-end-input", key: "shiftEnd"},
    {sel: ".break1-start-input", key: "break1Start"},
    {sel: ".break1-end-input", key: "break1End"},
    {sel: ".break2-start-input", key: "break2Start"},
    {sel: ".break2-end-input", key: "break2End"},
    {sel: ".lunch-start-input", key: "lunchStart"},
    {sel: ".lunch-end-input", key: "lunchEnd"}
  ];
  shiftFields.forEach(({sel, key})=>{
    content.querySelectorAll(sel).forEach(el=>{
      el.addEventListener("change", ()=>{
        const a = state.roster.find(x=>x.empId===el.dataset.id);
        if(!a) return;
        const beforeVal = a[key] || "";
        a[key] = el.value;
        const label = key.replace(/([A-Z])/g, ' $1').replace(/\d/, ' $&').trim();
        let toastMsg = `✅ Updated ${label} for ${a.name}`;
        const auditAfter = {[key]: el.value};
        const auto = BREAK_DURATIONS[key];
        if(auto && el.value){
          const endVal = computeEndTime(el.value, auto.minutes);
          a[auto.endKey] = endVal;
          const row = el.closest("tr");
          const endInput = row ? row.querySelector(auto.endSel) : null;
          if(endInput) endInput.value = endVal;
          toastMsg = `✅ Updated ${label} for ${a.name} — end time auto-set to ${formatTime12(endVal)} (${auto.minutes}m)`;
          auditAfter[auto.endKey] = endVal;
        }
        if(beforeVal !== el.value){
          logAudit("shift_edit", `Changed ${a.name}'s ${label} from ${beforeVal||"—"} to ${el.value||"—"}`,
            {empId:a.empId, before:{[key]:beforeVal}, after:auditAfter});
        }
        saveState();
        showToast(toastMsg);
      });
    });
  });

  // Search + filters (live focus/cursor is preserved automatically by render())
  const searchEl = document.getElementById("breakSearchInput");
  if(searchEl) searchEl.addEventListener("input", e=>{ breakSearchFilter = e.target.value; render(); });
  const shiftFilterEl = document.getElementById("breakShiftFilter");
  if(shiftFilterEl) shiftFilterEl.addEventListener("change", e=>{ breakShiftFilter = e.target.value; render(); });
  const breakFilterEl = document.getElementById("breakBreakFilter");
  if(breakFilterEl) breakFilterEl.addEventListener("change", e=>{ breakBreakFilter = e.target.value; render(); });

  // Import shifts
  const importBtn = document.getElementById("importShiftsBtn");
  if(importBtn) importBtn.addEventListener("click", openImportShiftsModal);

  // Swap request actions (data-id, wired here instead of inline onclick)
  content.querySelectorAll(".approve-swap-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> approveSwap(btn.dataset.id, btn));
  });
  content.querySelectorAll(".reject-swap-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> rejectSwap(btn.dataset.id, btn));
  });
  content.querySelectorAll(".cancel-swap-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> cancelSwap(btn.dataset.id, btn));
  });
}

function renderSwapRows(filterEmpId){
  let swaps = state.shiftSwaps.slice().reverse();
  if(filterEmpId) swaps = swaps.filter(s=>s.requesterEmpId===filterEmpId || s.recipientEmpId===filterEmpId);
  else if(isTL()){
    const scopedIds = new Set(scopedRoster().map(a=>a.empId));
    swaps = swaps.filter(s=>scopedIds.has(s.requesterEmpId) || scopedIds.has(s.recipientEmpId));
  }
  if(!swaps.length) return `<div class="empty-state" style="padding:20px;"><p>No swap requests yet.</p></div>`;

  return swaps.map(s=>{
    const req = state.roster.find(a=>a.empId===s.requesterEmpId);
    const rec = state.roster.find(a=>a.empId===s.recipientEmpId);
    const isPending = s.status==="pending";
    const canAct = isManager() && isPending;
    return `
      <div class="swap-card">
        <div class="swap-info">
          ${s.byWFM
            ? `<b>${req?esc(req.name):s.requesterEmpId}</b> and <b>${rec?esc(rec.name):s.recipientEmpId}</b> had their shifts swapped directly by WFM on <span class="mono">${fmtDate(s.date)}</span>`
            : `<b>${req?esc(req.name):s.requesterEmpId}</b> wants to swap with <b>${rec?esc(rec.name):s.recipientEmpId}</b> on <span class="mono">${fmtDate(s.date)}</span>`}
          <div style="font-size:11px;color:var(--text-dim);margin-top:3px;">${s.byWFM?'Swapped':'Requested'} ${new Date(s.requestedAt).toLocaleString()}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="swap-status ${s.status}">${s.byWFM?'SWAPPED':s.status.toUpperCase()}</span>
          ${canAct ? `<button class="icon-btn approve-swap-btn" title="Approve" data-id="${esc(s.id)}">✓</button><button class="icon-btn reject-swap-btn" title="Reject" data-id="${esc(s.id)}">✕</button>` : ''}
          ${(isAgent() && s.requesterEmpId===currentAgentId() && isPending) ? `<button class="icon-btn cancel-swap-btn" title="Cancel" data-id="${esc(s.id)}">✕</button>` : ''}
        </div>
      </div>
    `;
  }).join("");
}

const SHIFT_FIELDS = ["shiftStart","shiftEnd","break1Start","break1End","break2Start","break2End","lunchStart","lunchEnd"];
function swapAgentShifts(empIdA, empIdB){
  const a = state.roster.find(x=>x.empId===empIdA);
  const b = state.roster.find(x=>x.empId===empIdB);
  if(!a || !b) return false;
  SHIFT_FIELDS.forEach(f=>{
    const tmp = a[f];
    a[f] = b[f];
    b[f] = tmp;
  });
  return true;
}
// Disables every action btn in the swap's row (approve/reject/cancel), stamping a
// loading label on the one clicked, so a second click can't race the in-flight save.
function __lockSwapRow(btn, label){
  const row = btn.closest(".swap-card");
  const btns = row ? row.querySelectorAll("button") : [btn];
  btns.forEach(b=>{ b.disabled = true; });
  btn.textContent = label;
}
async function approveSwap(id, btn){
  const s = state.shiftSwaps.find(x=>x.id===id);
  if(!s) return;
  if(btn) __lockSwapRow(btn, "Approving…");
  const a = state.roster.find(x=>x.empId===s.requesterEmpId);
  const b = state.roster.find(x=>x.empId===s.recipientEmpId);
  const beforeA = a ? {shiftStart:a.shiftStart, shiftEnd:a.shiftEnd} : null;
  const beforeB = b ? {shiftStart:b.shiftStart, shiftEnd:b.shiftEnd} : null;
  const ok = swapAgentShifts(s.requesterEmpId, s.recipientEmpId);
  if(!ok){ showToast("⚠ Couldn't find one of these agents on the roster — approved, but nothing was swapped"); s.status="approved"; await saveState(); render(); return; }
  s.status="approved";
  if(a) logAudit("swap_approved", `Approved shift swap — changed ${a.name}'s shift`, {empId:a.empId, before:beforeA, after:{shiftStart:a.shiftStart, shiftEnd:a.shiftEnd}});
  if(b) logAudit("swap_approved", `Approved shift swap — changed ${b.name}'s shift`, {empId:b.empId, before:beforeB, after:{shiftStart:b.shiftStart, shiftEnd:b.shiftEnd}});
  await saveState(); render();
  showToast("✅ Swap approved — shift schedules exchanged between both agents");
}
async function rejectSwap(id, btn){
  const s = state.shiftSwaps.find(x=>x.id===id);
  if(s){
    if(btn) __lockSwapRow(btn, "Rejecting…");
    s.status="rejected";
    const a = state.roster.find(x=>x.empId===s.requesterEmpId);
    logAudit("swap_rejected", `Rejected shift swap request${a?' from '+a.name:''}`, {empId:s.requesterEmpId});
    await saveState(); render(); showToast("Swap rejected");
  }
}
async function cancelSwap(id, btn){
  if(btn) __lockSwapRow(btn, "Cancelling…");
  state.shiftSwaps = state.shiftSwaps.filter(x=>x.id!==id);
  await saveState(); render(); showToast("Swap request cancelled");
}
function openSwapShiftsModal(){
  if(!isWFM()) return;
  const roster = scopedRoster().filter(a=>a.status==="Active").slice().sort((x,y)=>x.name.localeCompare(y.name));
  const optsHtml = roster.map(a=>`<option value="${esc(a.empId)}">${esc(a.name)} (${esc(a.empId)})</option>`).join("");
  const overlay = showModal(`
    <div class="modal-title">🔁 Swap shifts between two agents</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 14px;">
      This immediately exchanges shift start/end, both breaks, and lunch between the two agents you pick below — no request or approval needed, since you're doing this directly as WFM. This doesn't touch attendance or performance data, only the schedule.
    </p>
    <div class="field"><label>Agent A</label><select id="swapModalA"><option value="">— Select —</option>${optsHtml}</select></div>
    <div class="field"><label>Agent B</label><select id="swapModalB"><option value="">— Select —</option>${optsHtml}</select></div>
    <div id="swapModalPreview" style="font-size:12px;color:var(--text-muted);margin-top:4px;"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="swapModalCancel">Cancel</button>
      <button class="btn btn-accent" id="swapModalGo">🔁 Swap now</button>
    </div>
  `);
  const selA = document.getElementById("swapModalA"), selB = document.getElementById("swapModalB");
  const preview = document.getElementById("swapModalPreview");
  const updatePreview = ()=>{
    const a = state.roster.find(x=>x.empId===selA.value), b = state.roster.find(x=>x.empId===selB.value);
    if(!a || !b || a.empId===b.empId){ preview.innerHTML = ""; return; }
    preview.innerHTML = `<b>${esc(a.name)}</b> will get: ${formatTime12(b.shiftStart)}–${formatTime12(b.shiftEnd)}<br><b>${esc(b.name)}</b> will get: ${formatTime12(a.shiftStart)}–${formatTime12(a.shiftEnd)}`;
  };
  selA.addEventListener("change", updatePreview);
  selB.addEventListener("change", updatePreview);
  overlay.querySelector("#swapModalCancel").addEventListener("click", closeModal);
  overlay.querySelector("#swapModalGo").addEventListener("click", ()=>{
    const empIdA = selA.value, empIdB = selB.value;
    if(!empIdA || !empIdB){ showToast("Pick both agents"); return; }
    if(empIdA===empIdB){ showToast("Pick two different agents"); return; }
    const ok = swapAgentShifts(empIdA, empIdB);
    if(!ok){ showToast("⚠ Couldn't find one of these agents"); return; }
    state.shiftSwaps.push({
      id: "swap"+Date.now(),
      requesterEmpId: empIdA,
      recipientEmpId: empIdB,
      date: todayIso(),
      status: "approved",
      requestedAt: new Date().toISOString(),
      byWFM: true
    });
    saveState(); closeModal(); render();
    showToast("✅ Shifts swapped");
  });
}
