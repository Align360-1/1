/* =========================================================
   SHIFT SEASONS — US daylight-saving changes (v29)
   The team works US hours from India (no DST), so when the US clocks change every shift and break
   moves by one hour: +60 min when US DST ends (early Nov), -60 min when it starts (mid Mar).

   Data: state.settings.shiftSeasons = { entries: [ {id, date, deltaMin, label, auto, status, ...} ] }
     status: "pending" | "applied" | "done" (times were already updated by hand) | "reverted"
   - It is an ATOMIC settings field (see LEO_ATOMIC_SETTINGS_FIELDS): an entry is "claimed" inside a
     Firestore transaction, so two admins opening the app at once can never shift the roster twice.
   - There is no server clock in this app. A due entry is applied the first time an Admin/WFM user
     opens the app on/after its date. Everyone else only gets the notice pop-up.
   - Shifts are shifted from what is stored (+/- delta), never recomputed from a base, so the claim
     above is the only protection against double-shifting. Entries flagged auto:false ask first.
   ========================================================= */

const SHIFT_SEASON_TIME_FIELDS = ["shiftStart","shiftEnd","break1Start","break1End","break2Start","break2End","lunchStart","lunchEnd"];
const SHIFT_SEASON_NOTICE_DAYS_BEFORE = 7;
const SHIFT_SEASON_NOTICE_DAYS_AFTER = 7;
const __shiftSeasonShown = new Set(); // per page-load: "<kind>:<entryId>:<user>" so a pop-up never repeats within a session

/* ---------- pure helpers (unit-tested in Node) ---------- */
function shiftSeasonShiftTime(t, deltaMin){
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t||""));
  if(!m) return t;
  const total = (((parseInt(m[1],10)*60 + parseInt(m[2],10) + deltaMin) % 1440) + 1440) % 1440;
  return String(Math.floor(total/60)).padStart(2,"0") + ":" + String(total%60).padStart(2,"0");
}
// Shifts every shift/break/lunch time of every roster agent by deltaMin. Returns how many agents had at least one time.
function shiftSeasonShiftRoster(roster, deltaMin){
  let agents = 0;
  roster.forEach(a=>{
    let touched = false;
    SHIFT_SEASON_TIME_FIELDS.forEach(f=>{
      if(a[f] && /^\d{1,2}:\d{2}$/.test(a[f])){ a[f] = shiftSeasonShiftTime(a[f], deltaMin); touched = true; }
    });
    if(touched) agents++;
  });
  return agents;
}
// US rule: DST starts 2nd Sunday of March, ends 1st Sunday of November. The shift change takes effect the Monday after.
function shiftSeasonUsDates(year){
  const nthSunday = (month, n)=>{
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();          // 0 = Sunday
    return 1 + ((7 - first) % 7) + (n-1)*7;
  };
  const iso = (month, day)=> `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  const marDay = nthSunday(2,2), novDay = nthSunday(10,1);
  const plusOne = (month, day)=>{ const d = new Date(Date.UTC(year, month, day+1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`; };
  return {dstStarts: iso(2,marDay), dstEnds: iso(10,novDay), shiftsEarlierFrom: plusOne(2,marDay), shiftsLaterFrom: plusOne(10,novDay)};
}
function shiftSeasonMakeEntry(date, deltaMin, auto){
  return {
    id: "ss" + date,
    date,
    deltaMin,
    auto: !!auto,
    label: deltaMin > 0 ? "US daylight saving ends (clocks go back) — shifts move 1 hour later"
                        : "US daylight saving starts (clocks go forward) — shifts move 1 hour earlier",
    status: "pending"
  };
}
// The next US-rule change strictly after afterIso.
function shiftSeasonNextUsEntry(afterIso){
  const y = parseInt(String(afterIso).slice(0,4),10);
  const cands = [];
  [y, y+1].forEach(yr=>{
    const d = shiftSeasonUsDates(yr);
    cands.push({date:d.shiftsEarlierFrom, delta:-60}, {date:d.shiftsLaterFrom, delta:60});
  });
  cands.sort((a,b)=>a.date.localeCompare(b.date));
  const c = cands.find(x=>x.date > afterIso);
  return shiftSeasonMakeEntry(c.date, c.delta, true);
}
function shiftSeasonDefaults(){
  // Nov 2 2026 is the change the team already went through; it asks before touching the roster (the times may already be updated).
  const first = shiftSeasonMakeEntry("2026-11-02", 60, false);
  const second = shiftSeasonNextUsEntry("2026-11-02");
  return {entries: [first, second]};
}
// Keeps one future pending entry on the list so the schedule never runs dry. Mutates and returns cfg.
function shiftSeasonEnsureFuture(cfg){
  if(!cfg.entries) cfg.entries = [];
  const pending = cfg.entries.filter(e=>e.status==="pending");
  if(!pending.length){
    const last = cfg.entries.map(e=>e.date).sort().pop() || todayIso();
    const next = shiftSeasonNextUsEntry(last);
    if(!cfg.entries.some(e=>e.id===next.id)) cfg.entries.push(next);
  }
  return cfg;
}
// Groups the roster by (shift start, shift end) and returns what each group becomes. dir=+1 → "now → after delta", dir=-1 → "before delta → now".
function shiftSeasonShiftTable(roster, deltaMin, alreadyApplied){
  const groups = new Map();
  roster.forEach(a=>{
    if(!a.shiftStart && !a.shiftEnd) return;
    const key = (a.shiftStart||"")+"|"+(a.shiftEnd||"");
    groups.set(key, (groups.get(key)||0) + 1);
  });
  const rows = [];
  groups.forEach((count,key)=>{
    const [s,e] = key.split("|");
    const cur = {s, e};
    const moved = {s: shiftSeasonShiftTime(s, alreadyApplied ? -deltaMin : deltaMin), e: shiftSeasonShiftTime(e, alreadyApplied ? -deltaMin : deltaMin)};
    rows.push(alreadyApplied ? {from: moved, to: cur, count} : {from: cur, to: moved, count});
  });
  rows.sort((a,b)=>(a.from.s||"").localeCompare(b.from.s||""));
  return rows;
}

/* ---------- state access ---------- */
function shiftSeasonCfg(){ return (state.settings && state.settings.shiftSeasons) || null; }
function shiftSeasonFmtDate(iso){
  try{ return new Date(iso+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short",year:"numeric"}); }catch(e){ return iso; }
}
function shiftSeasonDeltaText(d){ return (d>0?"+":"−") + Math.abs(d/60) + " hr"; }
function shiftSeasonCanManage(){ return typeof isWFM==="function" && isWFM(); }

// Atomically changes the schedule. mutate(cfg) edits it in place and returns a result; the whole thing runs on the SERVER copy in a
// transaction when cloud sync is on. Returns the mutate result.
async function shiftSeasonMutate(mutate){
  if(typeof fbReady!=="undefined" && fbReady){
    let out;
    await updateSettingsFieldTransactional("shiftSeasons", cur=>{
      if(!cur || !Array.isArray(cur.entries)) cur = shiftSeasonDefaults();
      out = mutate(cur);
      return cur;
    });
    return out;
  }
  if(!state.settings.shiftSeasons || !Array.isArray(state.settings.shiftSeasons.entries)) state.settings.shiftSeasons = shiftSeasonDefaults();
  const out = mutate(state.settings.shiftSeasons);
  await saveState();
  return out;
}

/* ---------- applying / reverting ---------- */
// Claims the entry (so nobody else can) and shifts the roster. mode "apply" (pending→applied) or "revert" (applied→reverted).
async function shiftSeasonRun(entryId, mode){
  const wantFrom = mode==="apply" ? ["pending"] : ["applied"];
  const to = mode==="apply" ? "applied" : "reverted";
  let claimed = null;
  await shiftSeasonMutate(cfg=>{
    const e = cfg.entries.find(x=>x.id===entryId);
    if(!e || !wantFrom.includes(e.status)) return;
    e.status = to;
    e[mode==="apply" ? "appliedAt" : "revertedAt"] = new Date().toISOString();
    e[mode==="apply" ? "appliedBy" : "revertedBy"] = (currentUser && currentUser.name) || "Unknown";
    claimed = JSON.parse(JSON.stringify(e));
    if(mode==="apply") shiftSeasonEnsureFuture(cfg);
  });
  if(!claimed) return {ok:false, reason:"already handled"};
  const delta = mode==="apply" ? claimed.deltaMin : -claimed.deltaMin;
  const before = shiftSeasonShiftTable(state.roster, claimed.deltaMin, mode==="revert");
  const agents = shiftSeasonShiftRoster(state.roster, delta);
  await saveState();
  try{
    logAudit("shift_season", `${mode==="apply" ? "Applied" : "Reverted"} shift change ${shiftSeasonDeltaText(claimed.deltaMin)} (effective ${claimed.date}) — ${agents} agent(s) updated`, {before:null, after:{entry:claimed.id, deltaMin:delta, agents}});
  }catch(e){}
  return {ok:true, entry:claimed, agents, table: before};
}
async function shiftSeasonMarkDone(entryId){
  let ok = false;
  await shiftSeasonMutate(cfg=>{
    const e = cfg.entries.find(x=>x.id===entryId);
    if(!e || e.status!=="pending") return;
    e.status = "done"; e.appliedAt = new Date().toISOString(); e.appliedBy = (currentUser && currentUser.name) || "Unknown";
    shiftSeasonEnsureFuture(cfg); ok = true;
  });
  if(ok){ try{ logAudit("shift_season", `Marked shift change effective ${entryId.slice(2)} as already updated (no times changed)`, {}); }catch(e){} }
  return ok;
}

/* ---------- pop-ups ---------- */
function shiftSeasonTableHtml(rows, showCounts){
  if(!rows.length) return "";
  return `<div class="table-wrap" style="margin:10px 0;"><table class="mini-table"><thead><tr><th>Shift now</th><th></th><th>New shift</th>${showCounts?"<th>Agents</th>":""}</tr></thead><tbody>` +
    rows.map(r=>`<tr><td class="mono">${formatTime12(r.from.s)} – ${formatTime12(r.from.e)}</td><td>→</td><td class="mono"><b>${formatTime12(r.to.s)} – ${formatTime12(r.to.e)}</b></td>${showCounts?`<td class="num">${r.count}</td>`:""}</tr>`).join("") +
    `</tbody></table></div>`;
}
function shiftSeasonUserKey(){
  return currentUser ? (currentUser.empId || currentUser.username || currentUser.id || currentUser.name || "u") : "";
}
function shiftSeasonSeen(entryId){
  try{ return localStorage.getItem(`a360-ss-seen-${entryId}-${shiftSeasonUserKey()}`) === "1"; }catch(e){ return false; }
}
function shiftSeasonMarkSeen(entryId){
  try{ localStorage.setItem(`a360-ss-seen-${entryId}-${shiftSeasonUserKey()}`, "1"); }catch(e){}
}
function shiftSeasonShowNotice(entry, opts){
  opts = opts || {};
  const applied = entry.status==="applied" || entry.status==="done";
  const later = entry.deltaMin > 0;
  let body = "";
  if(typeof isAgent==="function" && isAgent()){
    const me = state.roster.find(a=>a.empId===currentUser.empId);
    if(me && (me.shiftStart || me.shiftEnd)){
      const cur = {s:me.shiftStart, e:me.shiftEnd};
      const other = {s:shiftSeasonShiftTime(me.shiftStart, applied ? -entry.deltaMin : entry.deltaMin), e:shiftSeasonShiftTime(me.shiftEnd, applied ? -entry.deltaMin : entry.deltaMin)};
      body = shiftSeasonTableHtml([applied ? {from:other, to:cur, count:1} : {from:cur, to:other, count:1}], false) +
        `<div style="font-size:12px;color:var(--text-muted);">Your breaks and lunch move by the same ${Math.abs(entry.deltaMin/60)} hour. Check the Break Schedule tab for your exact timings.</div>`;
    }
  } else {
    const rows = shiftSeasonShiftTable(state.roster, entry.deltaMin, applied);
    body = shiftSeasonTableHtml(rows, shiftSeasonCanManage()) +
      `<div style="font-size:12px;color:var(--text-muted);">All break and lunch timings move by the same ${Math.abs(entry.deltaMin/60)} hour.</div>`;
  }
  const overlay = showModal(`
    <div class="modal-title">🕐 Shift timings ${applied ? "have changed" : "are changing"}</div>
    <p style="font-size:13px;line-height:1.6;margin:0 0 6px;">${esc(entry.label)}.</p>
    <p style="font-size:13px;line-height:1.6;margin:0 0 6px;"><b>${applied ? "Effective since" : "Effective from"} ${esc(shiftSeasonFmtDate(entry.date))}</b> — every shift and break is ${later ? "1 hour later" : "1 hour earlier"} in IST${opts.autoApplied ? " (applied automatically just now)" : ""}.</p>
    ${body}
    <div class="modal-actions"><button class="btn btn-accent" id="ssNoticeOk">Got it</button></div>
  `);
  overlay.querySelector("#ssNoticeOk").addEventListener("click", ()=>{ shiftSeasonMarkSeen(entry.id); closeModal(); });
}
function shiftSeasonShowConfirm(entry){
  const rows = shiftSeasonShiftTable(state.roster, entry.deltaMin, false);
  const agents = state.roster.filter(a=>SHIFT_SEASON_TIME_FIELDS.some(f=>a[f])).length;
  const overlay = showModal(`
    <div class="modal-title">🕐 Daylight-saving shift change is due</div>
    <p style="font-size:13px;line-height:1.6;margin:0 0 6px;">${esc(entry.label)}.<br><b>Effective ${esc(shiftSeasonFmtDate(entry.date))}.</b></p>
    <p style="font-size:13px;line-height:1.6;margin:0 0 6px;">If you apply it, every shift, break and lunch time on the roster moves <b>${shiftSeasonDeltaText(entry.deltaMin)}</b> (${agents} agent(s)). It would change:</p>
    ${shiftSeasonTableHtml(rows, true)}
    <div style="font-size:12px;line-height:1.5;padding:8px 10px;border-radius:6px;margin-bottom:12px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);">
      ⚠ If you have <b>already</b> updated the roster (for example by importing the new timings), do <b>not</b> apply — that would move everyone a second time. Choose "Already updated" instead.
    </div>
    <div class="modal-actions" style="flex-wrap:wrap;">
      <button class="btn btn-ghost" id="ssLater">Not now</button>
      <button class="btn" id="ssDone">Already updated — just mark done</button>
      <button class="btn btn-accent" id="ssApply">Apply ${shiftSeasonDeltaText(entry.deltaMin)} to the roster</button>
    </div>
  `);
  overlay.querySelector("#ssLater").addEventListener("click", closeModal);
  overlay.querySelector("#ssDone").addEventListener("click", async ()=>{
    if(await shiftSeasonMarkDone(entry.id)){ showToast("✅ Marked done — roster left as it is"); }
    else showToast("Someone already handled this change");
    closeModal(); render();
  });
  overlay.querySelector("#ssApply").addEventListener("click", async ()=>{
    const btn = overlay.querySelector("#ssApply"); btn.disabled = true; btn.textContent = "Applying…";
    const res = await shiftSeasonRun(entry.id, "apply");
    closeModal();
    if(res.ok){ showToast(`✅ Shifts moved ${shiftSeasonDeltaText(entry.deltaMin)} for ${res.agents} agent(s)`); }
    else showToast("Someone already handled this change — nothing was changed");
    render();
  });
}

/* ---------- the tick: runs after every render, cheap when nothing is due ---------- */
let __shiftSeasonBusy = false;
async function shiftSeasonTick(){
  if(__shiftSeasonBusy || !currentUser) return;
  if(typeof isClient==="function" && isClient()) return;          // Client role never sees roster/shift data
  if(document.querySelector(".modal-overlay")) return;            // never stack on another dialog; the next render retries
  __shiftSeasonBusy = true;
  try{
    const today = todayIso();
    const canManage = shiftSeasonCanManage();
    let cfg = shiftSeasonCfg();
    if(!cfg || !Array.isArray(cfg.entries)){
      if(!canManage) return;                                       // only people who can write seed the schedule
      await shiftSeasonMutate(()=>{});
      cfg = shiftSeasonCfg();
      if(!cfg) return;
    }
    const uk = shiftSeasonUserKey();
    // 1) A change that is due — Admin/WFM only. Oldest first; a later one waits until the earlier one is settled.
    if(canManage){
      const due = cfg.entries.filter(e=>e.status==="pending" && e.date <= today).sort((a,b)=>a.date.localeCompare(b.date))[0];
      if(due){
        if(due.auto){
          const res = await shiftSeasonRun(due.id, "apply");
          if(res.ok){ render(); shiftSeasonShowNotice(Object.assign({}, due, {status:"applied"}), {autoApplied:true}); return; }
        } else if(!__shiftSeasonShown.has("confirm:"+due.id+":"+uk)){
          __shiftSeasonShown.add("confirm:"+due.id+":"+uk);
          shiftSeasonShowConfirm(due); return;
        }
      }
    }
    // 2) Notice for everyone: from N days before until N days after the effective date, once per person.
    const inWindow = e=>{
      if(e.status==="reverted") return false;
      const from = shiftDate(e.date, -SHIFT_SEASON_NOTICE_DAYS_BEFORE), to = shiftDate(e.date, SHIFT_SEASON_NOTICE_DAYS_AFTER);
      return today >= from && today <= to;
    };
    const next = cfg.entries.filter(inWindow).sort((a,b)=>a.date.localeCompare(b.date))
      .find(e=> !shiftSeasonSeen(e.id) && !__shiftSeasonShown.has("notice:"+e.id+":"+uk)
             && !(e.status==="pending" && e.date <= today && canManage));  // a due-but-unresolved change is handled by the confirm above
    if(next){
      // A due change nobody has applied yet: tell non-admins nothing misleading — they see the notice once the roster has actually moved.
      if(next.status==="pending" && next.date <= today) return;
      __shiftSeasonShown.add("notice:"+next.id+":"+uk);
      shiftSeasonShowNotice(next);
    }
  }catch(e){
    console.error("Shift season check failed", e);
  }finally{
    __shiftSeasonBusy = false;
  }
}

/* ---------- Settings section (Admin/WFM) ---------- */
const SHIFT_SEASON_STATUS_LABEL = {pending:"Waiting", applied:"Applied", done:"Marked done (already updated)", reverted:"Reverted"};
function shiftSeasonSettingsHtml(){
  const cfg = shiftSeasonCfg();
  const entries = (cfg && cfg.entries ? cfg.entries.slice() : []).sort((a,b)=>a.date.localeCompare(b.date));
  const rows = entries.map(e=>`
    <tr data-id="${esc(e.id)}">
      <td>${e.status==="pending" ? `<input type="date" class="cell-input ss-date" value="${esc(e.date)}">` : esc(shiftSeasonFmtDate(e.date))}</td>
      <td class="num"><b>${shiftSeasonDeltaText(e.deltaMin)}</b></td>
      <td style="font-size:12px;">${esc(e.label)}</td>
      <td>${e.status==="pending" ? `<label class="check-row"><input type="checkbox" class="ss-auto" ${e.auto?"checked":""}> auto</label>` : "—"}</td>
      <td style="font-size:12px;">${esc(SHIFT_SEASON_STATUS_LABEL[e.status]||e.status)}${e.appliedBy?`<br><span style="color:var(--text-muted);">by ${esc(e.appliedBy)}</span>`:""}</td>
      <td style="white-space:nowrap;">
        ${e.status==="pending" ? `<button class="btn btn-sm ss-apply">Apply now</button> <button class="btn btn-sm btn-ghost ss-done">Mark done</button> <button class="btn btn-sm btn-ghost ss-del">✕</button>` : ""}
        ${e.status==="applied" ? `<button class="btn btn-sm btn-ghost ss-revert" title="Moves everyone back by the same amount">Revert</button>` : ""}
      </td>
    </tr>`).join("");
  const y = new Date().getFullYear();
  return `
  <div class="section">
    <div class="section-head"><div class="section-title"><span class="eyebrow">🕐</span>Shift seasons (US daylight saving)</div></div>
    <div class="section-body">
      <div class="help-note" style="margin-top:-2px;margin-bottom:12px;">When the US clocks change, every shift, break and lunch time moves by the amount below on its date. It is applied the first time an Admin/WFM user opens the app on or after that date (the app has no server clock). With "auto" off it asks first. Everyone gets a pop-up from ${SHIFT_SEASON_NOTICE_DAYS_BEFORE} days before. Each change is applied once only; "Revert" moves everyone back.</div>
      <div class="table-wrap"><table class="mini-table"><thead><tr><th>Effective date</th><th>Shift</th><th>What</th><th>Auto</th><th>Status</th><th></th></tr></thead><tbody id="ssBody">${rows || `<tr><td colspan="6" style="color:var(--text-muted);">No changes scheduled yet — they are created the first time an Admin/WFM user opens the app, or add one below.</td></tr>`}</tbody></table></div>
      <div class="form-inline" style="margin-top:12px;">
        <div class="field"><label>Add US changes for year</label><input type="number" id="ssYear" value="${y+1}" min="2024" max="2099" style="width:90px;"></div>
        <button class="btn btn-sm btn-accent" id="ssAddYear">+ Add both</button>
        <div class="field"><label>Custom date</label><input type="date" id="ssCustomDate"></div>
        <div class="field"><label>Move by</label><select id="ssCustomDelta"><option value="60">+1 hour later</option><option value="-60">−1 hour earlier</option></select></div>
        <button class="btn btn-sm" id="ssAddCustom">+ Add</button>
      </div>
    </div>
  </div>`;
}
function shiftSeasonBindSettings(){
  const body = document.getElementById("ssBody");
  if(!body) return;
  const redo = ()=>{ render(); };
  body.querySelectorAll("tr[data-id]").forEach(tr=>{
    const id = tr.dataset.id;
    const edit = fn=> async ()=>{ await shiftSeasonMutate(cfg=>{ const e = cfg.entries.find(x=>x.id===id); if(e && e.status==="pending") fn(e, cfg); }); redo(); };
    const dateEl = tr.querySelector(".ss-date");
    if(dateEl) dateEl.addEventListener("change", edit((e)=>{ if(dateEl.value){ e.date = dateEl.value; e.id = "ss"+dateEl.value; } }));
    const autoEl = tr.querySelector(".ss-auto");
    if(autoEl) autoEl.addEventListener("change", edit(e=>{ e.auto = autoEl.checked; }));
    const del = tr.querySelector(".ss-del");
    if(del) del.addEventListener("click", edit((e,cfg)=>{ cfg.entries = cfg.entries.filter(x=>x.id!==id); }));
    const ap = tr.querySelector(".ss-apply");
    if(ap) ap.addEventListener("click", ()=>{
      const e = shiftSeasonCfg().entries.find(x=>x.id===id); if(e) shiftSeasonShowConfirm(e);
    });
    const dn = tr.querySelector(".ss-done");
    if(dn) dn.addEventListener("click", async ()=>{ await shiftSeasonMarkDone(id); redo(); });
    const rv = tr.querySelector(".ss-revert");
    if(rv) rv.addEventListener("click", async ()=>{
      if(!confirm("Move every shift, break and lunch time back by this change? Use this only if it was applied by mistake.")) return;
      const res = await shiftSeasonRun(id, "revert");
      showToast(res.ok ? `↩ Reverted for ${res.agents} agent(s)` : "Nothing to revert"); redo();
    });
  });
  const addEntries = async list=>{
    await shiftSeasonMutate(cfg=>{ list.forEach(n=>{ if(!cfg.entries.some(e=>e.id===n.id)) cfg.entries.push(n); }); });
    redo();
  };
  document.getElementById("ssAddYear").addEventListener("click", ()=>{
    const yr = parseInt(document.getElementById("ssYear").value,10);
    if(!(yr>=2024 && yr<=2099)){ showToast("Enter a year between 2024 and 2099"); return; }
    const d = shiftSeasonUsDates(yr);
    addEntries([shiftSeasonMakeEntry(d.shiftsEarlierFrom, -60, true), shiftSeasonMakeEntry(d.shiftsLaterFrom, 60, true)]);
  });
  document.getElementById("ssAddCustom").addEventListener("click", ()=>{
    const date = document.getElementById("ssCustomDate").value;
    if(!date){ showToast("Pick a date first"); return; }
    const n = shiftSeasonMakeEntry(date, parseInt(document.getElementById("ssCustomDelta").value,10), false);
    n.label = "Custom shift change";
    addEntries([n]);
  });
}
