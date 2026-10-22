/* ---------------- LEO — supervisor-call escalation queue ----------------
   An agent (or TL/Trainer/Admin) logs a "sup call" whenever a provider asks
   for a supervisor or a callback, capturing what a supervisor needs to work
   it: Reason, Ref number, and Callback Date/Time. TL/Trainer/Admin then work
   the queue, marking each entry Completed or Cancelled.
   Visibility: everyone except plain WFM (see canViewLEO() in js/auth.js).
   Creation: Agent, TL, Trainer, Admin (see canCreateLEO()) — Client is view-only.
   Scope: Agent sees only their own calls; SME sees ONLY calls assigned to
   them personally (never their team's queue, never merely calls they
   created); a TL without "Full data access" sees their own team's calls,
   PLUS any call assigned to them personally (by username) regardless of
   team; Trainer/Admin/Client/full-access-TL see everything. See
   scopedLeoCalls().
   Assignment: every new call is handed to the next account in the
   Admin-managed "Manage supervisors" rotation, round-robin — see
   assignNextLeoSupervisor(). The rotation list holds real login usernames
   (any account except Client/WFM — i.e. TL/Trainer/SME/Admin, matching
   canManageLEO()'s roles), not free-text names, specifically so a call's
   assignment can be matched against currentUser.username for the visibility
   scoping above — otherwise a call could be "assigned" to someone who
   structurally could never see it in their own queue. Roster agents have no
   login username in this system (they sign in by Employee ID), so they can't
   be added here.
   Auto-escalation: a call that is still open, still "New", and has no action or
   resolution note within N hours (default 5, Admin-editable) of being assigned
   is handed to the NEXT supervisor in the rotation list, and the clock restarts
   for them. See planLeoEscalations() and the watcher below.
*/
let leoStatusFilter = "open"; // agent: "open" | "completed" | "all"
                               // TL/Trainer/Admin: "new" | "setAside" | "completed" | "all" | "report" (monthly report, js/leoreport.js)
                               // (no "cancelled" tab for anyone — cancelled calls still show under "All")
let leoSearch = "";
let leoReasonsPanelOpen = false; // Admin-only "Manage reasons" panel toggle
let leoSupervisorsPanelOpen = false; // Admin-only "Manage supervisors" panel toggle
let leoOpenCallId = null; // set when a TL/Trainer/Admin has clicked into a call's full-page work view

// Supervisor "status" dropdown on the work view. Distinct from the queue-level
// c.status (open/completed/cancelled) — supStatus drives the work-view fields,
// and is mapped back onto c.status so the existing Open/Completed filter tabs
// keep working: new & setAside both read as "open", resolved reads as
// "completed". c.status still goes to "cancelled" separately (agent- or
// supervisor-initiated cancel), which isn't one of these three, and — since
// there's no Cancelled tab — only shows up under "All".
const LEO_SUP_STATUS = [
  {value:"new", label:"New"},
  {value:"resolved", label:"Resolved"},
  {value:"setAside", label:"Set aside"}
];
const LEO_ACTION_OPTIONS = [
  "Escalated to claims team",
  "Escalated to AP team",
  "Escalated to appeals team",
  "Escalated to email room",
  "Escalated to recoupment team",
  "Voicemail left",
  "Closed to backend",
  "Resolution shared"
];
// The monthly Report tab (js/leoreport.js) builds its resolution rows straight from this list.
function leoSupStatusLabel(v){ return (LEO_SUP_STATUS.find(s=>s.value===v)||{}).label || "New"; }

// The accounts eligible for the LEO rotation: every enabled login account
// except Client (view-only) and WFM — i.e. TL/Trainer/SME/Admin, matching
// canManageLEO()'s roles, the people who actually work this queue.
// state.settings.leoSupervisors holds an ordered list of *usernames* into
// this set — resolved fresh each time rather than trusted as-is, since an
// account can be disabled, deleted, or have its role changed after being
// added to the rotation. Roster agents aren't part of state.settings.users
// (they log in by Employee ID, not a username) so they're never in this set.
function eligibleLeoSupervisorAccounts(){
  return (state.settings.users || []).filter(u=>
    u.enabled!==false && u.role!=="client" && u.role!=="wfm" && u.role!=="quality");
}

// Display label for an eligible account's role badge, used both in the
// current rotation list and the add-supervisor search results.
function leoSupervisorRoleLabel(role){
  return role==="admin" ? "Admin" : role==="manager" ? "Manager" : role==="trainer" ? "Trainer" : role==="sme" ? "SME" : "Team Leader";
}

// Round-robin assignment: hands each new sup call to the next username in
// state.settings.leoSupervisors, wrapping back to the start once the
// (filtered, still-eligible) list is exhausted. Returns {username, name} for
// the assigned account, or null if Admin hasn't added any supervisors yet —
// or everyone they added has since been removed/disabled/reassigned a role.
function assignNextLeoSupervisor(){
  const eligibleByUsername = new Map(eligibleLeoSupervisorAccounts().map(u=>[u.username, u]));
  const sups = (state.settings.leoSupervisors || []).filter(un=> eligibleByUsername.has(un));
  if(!sups.length) return null;
  if(state.settings.leoNextSupervisorIndex==null) state.settings.leoNextSupervisorIndex = 0;
  const idx = state.settings.leoNextSupervisorIndex % sups.length;
  state.settings.leoNextSupervisorIndex = (idx + 1) % sups.length;
  const username = sups[idx];
  return {username, name: eligibleByUsername.get(username).name};
}

// ---- Auto-escalation ---------------------------------------------------
// Rule: if a sup call hasn't been worked within `hours` of being assigned
// (default 5), reassign it to the next supervisor in the rotation list and
// restart the clock. "Worked" = the supervisor moved it off "New" (Set aside /
// Resolved), picked an Action, or typed a Resolution note — merely opening it
// doesn't count. Set-aside calls are deliberately left alone: someone has taken
// ownership and scheduled follow-ups. Each pass moves a call ONE step, so a
// browser that was closed for a day can't cascade a call through everyone.
// Calls logged before this feature have no assignedAt; they get stamped "now"
// the first time they're seen, so deploying doesn't instantly escalate the backlog.
function leoEscalationHoursValue(h){
  const n = Number(h);
  return n > 0 ? n : 5;
}
function leoCallWorked(c){
  return (c.supStatus||"new") !== "new" || !!c.action || !!(c.supResolutionNote||"").trim();
}
// Pure function — shared by the online transaction (js/firebase.js) and the
// offline path so they can never disagree. Never mutates its input.
// cfg: {users, supervisors, pointer, enabled, hours}
// Returns {items, oldPointer, newPointer, escalated:[{id,from,to,toUsername}], changed} or null if disabled.
function planLeoEscalations(calls, cfg, nowMs){
  if(!cfg || cfg.enabled === false) return null;
  const hoursMs = leoEscalationHoursValue(cfg.hours) * 3600000;
  const eligible = new Map((cfg.users||[])
    .filter(u=> u.enabled!==false && u.role!=="client" && u.role!=="wfm" && u.role!=="quality")
    .map(u=>[u.username, u]));
  const sups = (cfg.supervisors||[]).filter(un=> eligible.has(un));
  const oldPointer = cfg.pointer == null ? 0 : cfg.pointer;
  let pointer = oldPointer;
  let changed = false;
  const escalated = [];
  const nowIso = new Date(nowMs).toISOString();
  const items = (calls||[]).map(c=>{
    if(c.status !== "open" || !c.assignedToUsername || leoCallWorked(c)) return c;
    if(!c.assignedAt){ changed = true; return {...c, assignedAt: nowIso}; } // start the clock
    const since = Date.parse(c.assignedAt);
    if(isNaN(since) || nowMs - since < hoursMs) return c;
    if(sups.length < 2) return c; // nobody else to hand it to
    let idx = sups.indexOf(c.assignedToUsername);
    if(idx >= 0) idx = (idx + 1) % sups.length;
    else { idx = pointer % sups.length; pointer = (idx + 1) % sups.length; } // previous assignee left the rotation
    const toUsername = sups[idx];
    const to = eligible.get(toUsername).name;
    changed = true;
    escalated.push({id: c.id, from: c.assignedTo || c.assignedToUsername, to, toUsername});
    return {...c,
      assignedTo: to, assignedToUsername: toUsername, assignedAt: nowIso,
      escalationCount: (c.escalationCount||0) + 1,
      escalationHistory: (c.escalationHistory||[]).concat([{
        at: nowIso, from: c.assignedTo || c.assignedToUsername, fromUsername: c.assignedToUsername,
        to, toUsername, auto: true
      }])
    };
  });
  return {items, oldPointer, newPointer: pointer, escalated, changed};
}

// Epoch ms when a call will next auto-escalate, or null if it won't (disabled,
// already worked, closed, or fewer than two supervisors to rotate between).
function leoEscalationDueAt(c){
  if(state.settings.leoEscalationEnabled === false) return null;
  if(c.status !== "open" || !c.assignedToUsername || !c.assignedAt || leoCallWorked(c)) return null;
  const sups = (state.settings.leoSupervisors||[]).filter(un=> eligibleLeoSupervisorAccounts().some(u=>u.username===un));
  if(sups.length < 2) return null;
  const t = Date.parse(c.assignedAt);
  return isNaN(t) ? null : t + leoEscalationHoursValue(state.settings.leoEscalationHours) * 3600000;
}

let __leoEscalationTimer = null;
let __leoEscalationRunning = false;
async function runLeoEscalationCheck(){
  if(__leoEscalationRunning || !currentUser || !canManageLEO()) return;
  const cfg = {
    users: state.settings.users || [],
    supervisors: state.settings.leoSupervisors || [],
    pointer: state.settings.leoNextSupervisorIndex,
    enabled: state.settings.leoEscalationEnabled !== false,
    hours: state.settings.leoEscalationHours
  };
  // Cheap local dry-run first so we only open a Firestore transaction when
  // something looks due.
  const dry = planLeoEscalations(state.leoCalls||[], cfg, Date.now());
  if(!dry || !dry.changed) return;
  __leoEscalationRunning = true;
  try{
    let plan;
    if(fbReady){
      plan = await escalateOverdueLeoCallsTransactional();
    } else {
      plan = planLeoEscalations(state.leoCalls||[], cfg, Date.now());
      if(plan && plan.changed){
        state.leoCalls = plan.items;
        state.settings.leoNextSupervisorIndex = plan.newPointer;
        await saveState();
      }
    }
    if(plan && plan.escalated.length){
      plan.escalated.forEach(e=>{
        const call = plan.items.find(x=>x.id===e.id) || {};
        logAudit("leo_auto_escalate",
          `Auto-escalated sup call ${call.refNumber?`(ref ${call.refNumber}) `:""}from ${e.from} to ${e.to} — not worked within ${leoEscalationHoursValue(state.settings.leoEscalationHours)}h`,
          {after:{callId:e.id, from:e.from, to:e.to}});
      });
      if(plan.escalated.some(e=> e.toUsername === currentUser.username)) showToast("📞 A sup call was escalated to you");
    }
    if(plan && plan.changed){
      if(typeof refreshNavBadges==="function") refreshNavBadges();
      if(currentTab==="leo" && !document.querySelector(".modal-overlay")) render();
    }
  }catch(e){
    console.error("LEO auto-escalation failed", e);
  }finally{
    __leoEscalationRunning = false;
  }
}
function startLeoEscalationWatcher(){
  if(__leoEscalationTimer) return; // idempotent — render() calls this every time
  __leoEscalationTimer = setInterval(runLeoEscalationCheck, 60000); // check every minute
  runLeoEscalationCheck();
}
function stopLeoEscalationWatcher(){
  if(__leoEscalationTimer){ clearInterval(__leoEscalationTimer); __leoEscalationTimer = null; }
}

// ---- "New" badge read-state for the LEO nav tab (per logged-in user, kept
// in this browser's localStorage) — same pattern as readUpdatesKey/
// loadReadUpdateIds/markUpdateRead in js/history.js for Process Update.
// Opening a call's full-page work view marks it read; the badge counts
// scoped, still-open, supStatus:"new" calls a TL/Trainer/Admin hasn't opened
// yet (agents don't get this badge — they aren't the ones working the queue).
function readLeoCallsKey(){
  const key = userViewKey();
  return key ? ("a360_read_leo_calls_"+key) : null;
}
function loadReadLeoCallIds(){
  const key = readLeoCallsKey();
  if(!key) return new Set();
  try{
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  }catch(e){ return new Set(); }
}
function markLeoCallRead(id){
  const key = readLeoCallsKey();
  if(!key) return;
  const ids = loadReadLeoCallIds();
  if(ids.has(id)) return;
  ids.add(id);
  try{ localStorage.setItem(key, JSON.stringify(Array.from(ids))); }catch(e){}
}
function unreadLeoCallCount(){
  if(!canManageLEO()) return 0;
  const readIds = loadReadLeoCallIds();
  const calls = scopedLeoCalls(state.leoCalls||[]);
  return calls.filter(c=> c.status==="open" && (c.supStatus||"new")==="new" && !readIds.has(c.id)).length;
}

// Entries a given viewer is allowed to see, per the scope rules above.
function scopedLeoCalls(calls){
  if(isAgent()) return calls.filter(c=> c.createdByEmpId === currentAgentId());
  // SME is deliberately its own branch, not lumped with team-scoped TL: an SME
  // sees ONLY calls assigned to them personally, never their team's whole
  // queue and never merely-created-by-them calls that round-robined to
  // someone else. If canCreateLEO() lets an SME log a call that then gets
  // assigned to a different supervisor in rotation, that SME will not see it
  // again here — intentional per spec, but flagging since it differs from
  // every other creator role below.
  if(isSME()) return calls.filter(c=> c.assignedToUsername && c.assignedToUsername === currentUser.username);
  if(isTL() && !currentUser.viewAll){
    const scopedIds = new Set(scopedRoster().map(a=>a.empId));
    return calls.filter(c=>
      (c.createdByEmpId && scopedIds.has(c.createdByEmpId)) ||
      c.createdByUsername === currentUser.username ||
      // Whoever a call is assigned to can always see & work it, even outside
      // their own team — this is what assignedToUsername exists for (see the
      // file header). Older calls logged before this field existed just won't
      // match here, same as before.
      (c.assignedToUsername && c.assignedToUsername === currentUser.username));
  }
  return calls; // Trainer, Admin, Client, WFM(n/a — gated out earlier), full-access TL
}

// Open calls sort soonest-callback-first (most urgent on top); everything else
// (completed/cancelled) sorts most-recently-resolved first. Open entries always
// float above resolved ones within a mixed ("all") view.
function sortLeoCalls(calls){
  return calls.slice().sort((a,b)=>{
    const aOpen = a.status==="open", bOpen = b.status==="open";
    if(aOpen !== bOpen) return aOpen ? -1 : 1;
    if(aOpen) return new Date(a.callbackAt||0) - new Date(b.callbackAt||0);
    return new Date(b.resolvedAt||b.createdAt||0) - new Date(a.resolvedAt||a.createdAt||0);
  });
}

function leoIsOverdue(c){
  return c.status==="open" && c.callbackAt && new Date(c.callbackAt).getTime() < Date.now();
}

function fmtLeoDateTime(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return "—";
  return d.toLocaleString(undefined, {year:"numeric", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
}

function leoStatusBadgeHtml(c){
  if(c.status==="completed") return `<span class="leo-status completed">Resolved</span>`;
  if(c.status==="cancelled") return `<span class="leo-status cancelled">Cancelled</span>`;
  if(c.supStatus==="setAside") return `<span class="leo-status setaside">Set aside</span>`;
  return `<span class="leo-status ${leoIsOverdue(c)?'overdue':'open'}">${leoIsOverdue(c) ? "Overdue" : "New"}</span>`;
}

function leoSectionHtml(){
  if(leoOpenCallId){
    const openCall = scopedLeoCalls(state.leoCalls||[]).find(c=>c.id===leoOpenCallId);
    if(openCall) return leoDetailHtml(openCall);
    leoOpenCallId = null; // stale id (deleted / out of scope) — fall through to the list
  }
  const manageView = canManageLEO(); // TL/Trainer/Admin get New/Set aside split tabs; Agent gets a single Open tab
  if(leoStatusFilter==="cancelled") leoStatusFilter = manageView ? "new" : "open"; // no Cancelled tab for anyone — cancelled calls still show under "All"
  if(isAgent() && (leoStatusFilter==="new" || leoStatusFilter==="setAside")) leoStatusFilter = "open";
  if(manageView && leoStatusFilter==="open") leoStatusFilter = "new"; // managers don't get a plain Open tab
  if(leoStatusFilter==="report" && !manageView) leoStatusFilter = isAgent() ? "open" : "all"; // report is for people who work the queue
  const isReport = leoStatusFilter==="report";
  const q = leoSearch.trim().toLowerCase();
  let calls = scopedLeoCalls(state.leoCalls||[]);
  const scopedAll = calls; // unfiltered, in-scope calls — what the Report tab counts
  const openCount = calls.filter(c=>c.status==="open").length;
  const newCount = calls.filter(c=>c.status==="open" && (c.supStatus||"new")==="new").length;
  const setAsideCount = calls.filter(c=>c.status==="open" && c.supStatus==="setAside").length;
  if(leoStatusFilter==="new") calls = calls.filter(c=>c.status==="open" && (c.supStatus||"new")==="new");
  else if(leoStatusFilter==="setAside") calls = calls.filter(c=>c.status==="open" && c.supStatus==="setAside");
  else if(leoStatusFilter!=="all" && !isReport) calls = calls.filter(c=>c.status===leoStatusFilter);
  if(q){
    calls = calls.filter(c=> ((c.reason||"")+" "+(c.refNumber||"")+" "+(c.claimNumber||"")+" "+(c.createdByName||"")+" "+(c.lob||"")+" "+(c.assignedTo||"")).toLowerCase().indexOf(q)!==-1);
  }
  calls = sortLeoCalls(calls);

  const filterTabsHtml = `<div class="dash-tabs" style="flex-wrap:wrap;">
    ${manageView ? `
      <button class="dash-tab ${leoStatusFilter==='new'?'active':''}" data-leotab="new">New${newCount?` (${newCount})`:""}</button>
      <button class="dash-tab ${leoStatusFilter==='setAside'?'active':''}" data-leotab="setAside">Set aside${setAsideCount?` (${setAsideCount})`:""}</button>
    ` : `<button class="dash-tab ${leoStatusFilter==='open'?'active':''}" data-leotab="open">Open${openCount?` (${openCount})`:""}</button>`}
    <button class="dash-tab ${leoStatusFilter==='completed'?'active':''}" data-leotab="completed">Completed</button>
    <button class="dash-tab ${leoStatusFilter==='all'?'active':''}" data-leotab="all">All</button>
    ${manageView ? `<button class="dash-tab ${isReport?'active':''}" data-leotab="report">📊 Report</button>` : ""}
  </div>`;

  const rowsHtml = calls.length ? calls.map(c=>{
    const canWork = canManageLEO(); // opens the full-page work view (left: agent request, right: supervisor work)
    const canOwnerCancel = isAgent() && c.status==="open" && c.createdByEmpId===currentAgentId();
    const canDelete = isAdmin();
    return `<div class="leo-card${leoIsOverdue(c)?' overdue':''}${canWork?' clickable':''}" data-id="${esc(c.id)}" ${canWork?'data-leo-open="1" tabindex="0" role="button"':''}>
      <div class="leo-info">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
          ${leoStatusBadgeHtml(c)}
          <span class="badge badge-gray">${esc(c.lob||"—")}</span>
          ${(isFullAdmin() && c.escalationCount) ? `<span class="badge badge-gray" title="Auto-escalated after not being worked in time">↑ Escalated ×${c.escalationCount}</span>` : ""}
          <b style="font-size:13px;">${esc(c.reason||"—")}</b>
        </div>
        <div style="font-size:12.5px;color:var(--text-muted);display:flex;gap:14px;flex-wrap:wrap;">
          <span>Ref #: <span class="mono">${esc(c.refNumber||"—")}</span></span>
          <span>Claim #: <span class="mono">${esc(c.claimNumber||"—")}</span></span>
          <span>Callback: <span class="mono">${fmtLeoDateTime(c.callbackAt)}</span></span>
          ${manageView ? `<span>Assigned to: <span class="mono">${esc(c.assignedTo||"— unassigned —")}</span></span>` : ""}
          ${manageView && leoEscalationDueAt(c) ? `<span>Auto-escalates: <span class="mono">${fmtLeoDateTime(new Date(leoEscalationDueAt(c)).toISOString())}</span></span>` : ""}
        </div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Logged by ${esc(c.createdByName||"—")}${c.createdByRole?` (${esc(c.createdByRole)})`:""} · ${c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</div>
        ${c.status!=="open" ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${c.status==="completed"?"Resolved":"Cancelled"} by ${esc(c.resolvedBy||"—")}${c.resolvedAt?` · ${new Date(c.resolvedAt).toLocaleString()}`:""}${(c.supResolutionNote||c.resolutionNote)?` — ${esc(c.supResolutionNote||c.resolutionNote)}`:""}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
        ${canWork ? `<button class="btn btn-sm btn-accent leo-open-btn" data-id="${esc(c.id)}">${c.status==="open"?"Work this call":"View"} →</button>` : ""}
        ${canOwnerCancel ? `<button class="icon-btn leo-cancel-btn" data-id="${esc(c.id)}" title="Cancel your request">✕</button>` : ""}
        ${canDelete ? `<button class="icon-btn leo-delete-btn" data-id="${esc(c.id)}" title="Delete permanently">🗑</button>` : ""}
      </div>
    </div>`;
  }).join("") : `<div class="empty-state" style="padding:20px;"><p>${q ? "No sup calls match your search." : ((leoStatusFilter==="open"||leoStatusFilter==="new") ? `No ${leoStatusFilter==="new"?"new":"open"} sup calls right now.${canCreateLEO() ? " Escalate one and it lands here for a supervisor to work." : ""}` : "Nothing here yet.")}</p></div>`;

  const reasonsPanelHtml = (isAdmin() && leoReasonsPanelOpen) ? leoReasonsPanelHtml() : "";
  const supervisorsPanelHtml = (isAdmin() && leoSupervisorsPanelOpen) ? leoSupervisorsPanelHtml() : "";

  return `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">📞</span>LEO — Supervisor Call Escalation</div>
        <div class="section-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          ${isAdmin() ? `<button class="btn btn-ghost btn-sm" id="leoReasonsToggleBtn">⚙ ${leoReasonsPanelOpen ? "Hide" : "Manage"} reasons</button>` : ""}
          ${isAdmin() ? `<button class="btn btn-ghost btn-sm" id="leoSupervisorsToggleBtn">⚙ ${leoSupervisorsPanelOpen ? "Hide" : "Manage"} supervisors</button>` : ""}
          ${canCreateLEO() ? `<button class="btn btn-accent btn-sm" id="leoCreateBtn">+ Escalate / New sup call</button>` : ""}
        </div>
      </div>
      <div class="section-body" style="padding-bottom:0;">
        <div class="help-note" style="margin:2px 0 10px;">${isAgent() ? "Whenever a provider requests a supervisor or a callback, log the details here — a supervisor will work it off this queue." : "Queue of supervisor-callback requests escalated by agents. Mark each one completed once the callback has been made."}</div>
        ${filterTabsHtml}
      </div>
      ${reasonsPanelHtml}
      ${supervisorsPanelHtml}
      ${!isReport && (calls.length || q) ? `<div class="section-body" style="padding-bottom:0;padding-top:10px;">
        <input type="text" id="leoSearchInput" class="history-search" placeholder="🔍 Search by reason, ref/claim number, or agent..." value="${esc(leoSearch)}" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 12px;font-size:12.5px;box-sizing:border-box;font-family:inherit;">
      </div>` : ""}
      ${isReport ? leoReportHtml(scopedAll) : `<div class="section-body" style="display:flex;flex-direction:column;gap:10px;">
        ${rowsHtml}
      </div>`}
    </div>`;
}

function leoReasonsPanelHtml(){
  const reasons = state.settings.leoReasons || [];
  const rows = reasons.map((r,i)=>`
    <tr data-i="${i}"><td>${esc(r)}</td><td><button class="icon-btn del-leo-reason-btn" data-i="${i}">✕</button></td></tr>`).join("");
  return `<div class="section" style="margin-top:0;">
    <div class="section-head"><div class="section-title"><span class="eyebrow">⚙</span>Reason master list</div></div>
    <div class="section-body">
      <div class="help-note" style="margin:2px 0 10px;">These are the Reason options offered when logging a sup call. Add or remove as needed — existing sup calls keep whatever reason they were logged with.</div>
      <div class="table-wrap"><table class="mini-table"><thead><tr><th>Reason</th><th></th></tr></thead><tbody id="leoReasonBody">${rows || '<tr><td colspan="2" style="color:var(--text-dim);">None added yet</td></tr>'}</tbody></table></div>
      <div class="form-inline" style="margin-top:10px;">
        <div class="field"><label>New reason</label><input type="text" id="newLeoReasonInput" placeholder="e.g. Provider dissatisfaction"></div>
        <button class="btn btn-sm btn-accent" id="addLeoReasonBtn">+ Add</button>
      </div>
    </div>
  </div>`;
}

// Admin-only "Manage supervisors" panel: the ordered list that
// assignNextLeoSupervisor() rotates through when a new sup call is created.
// Order matters here (it's the queue order), so new accounts are appended to
// the end rather than inserted alphabetically.
// Entries are real login accounts — any role except Client/WFM (picked via
// the search box at the top, not typed free text) so a call's assignment can
// be matched back to that person's own login for visibility (see
// scopedLeoCalls()).
function leoSupervisorsPanelHtml(){
  const sups = state.settings.leoSupervisors || [];
  const rows = sups.map((username,i)=>{
    const u = (state.settings.users||[]).find(x=>x.username===username);
    // Account may have since been deleted, disabled, or moved off a
    // canManageLEO() role — still shown (with its raw username) so Admin can
    // see and clear out the stale entry; assignNextLeoSupervisor() already
    // skips it when actually assigning.
    const label = u ? `${esc(u.name)} <span class="badge badge-gray" style="margin-left:4px;">${leoSupervisorRoleLabel(u.role)}${u.tlName?` · ${esc(u.tlName)}`:''}</span>` : `<span class="mono" style="color:var(--text-dim);">${esc(username)}</span> <span class="badge badge-gray">account not found</span>`;
    return `<tr data-i="${i}"><td>${label}</td><td><button class="icon-btn del-leo-supervisor-btn" data-i="${i}">✕</button></td></tr>`;
  }).join("");
  const hasEligible = eligibleLeoSupervisorAccounts().some(u=> !sups.includes(u.username));
  return `<div class="section" style="margin-top:0;">
    <div class="section-head"><div class="section-title"><span class="eyebrow">⚙</span>Supervisor rotation list</div></div>
    <div class="section-body">
      <div class="field" id="leoSupervisorSearchWrap" style="position:relative;max-width:360px;">
        <label>Add supervisor</label>
        <input type="text" id="leoSupervisorSearchInput" class="global-search-input" style="padding-left:12px;" placeholder="${hasEligible ? 'Type a name to add…' : 'No eligible accounts — create a TL/Trainer/SME/Admin login first'}" autocomplete="off" ${hasEligible ? "" : "disabled"}>
        <div id="leoSupervisorSearchResults" class="global-search-results" style="display:none;"></div>
      </div>
      <div class="help-note" style="margin:10px 0;">Only accounts listed here receive sup calls. Each new call goes to the next one in this order, round-robin — after the last it wraps back to the first. Picked from existing Team Leader/Trainer/SME/Admin logins (Settings → User accounts) — Client and WFM logins aren't eligible — so whoever it's assigned to can always see and work it, even outside their own team.</div>
      <div class="field" style="margin:0 0 12px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12.5px;">
          <input type="checkbox" id="leoEscEnabled" ${state.settings.leoEscalationEnabled!==false?"checked":""}>
          Auto-escalate a sup call to the next supervisor if it isn't worked within
          <input type="number" id="leoEscHours" min="1" max="72" step="1" value="${leoEscalationHoursValue(state.settings.leoEscalationHours)}" style="width:64px;"> hours
        </label>
        <div class="help-note" style="margin:6px 0 0;">"Not worked" means still New with no action or resolution note. Set-aside and resolved calls are never escalated. Checked every minute while a TL/Trainer/SME/Admin is signed in, so a call may move a little after the deadline if nobody is online. Needs at least two supervisors in the list.</div>
      </div>
      <div class="table-wrap"><table class="mini-table"><thead><tr><th>Supervisor</th><th></th></tr></thead><tbody id="leoSupervisorBody">${rows || '<tr><td colspan="2" style="color:var(--text-dim);">None added yet — sup calls will show as unassigned until you add one</td></tr>'}</tbody></table></div>
    </div>
  </div>`;
}

// Full-page work view for a single sup call: left = the agent's original
// request (read-only), right = the supervisor's work (status, action,
// follow-up dates, close date, resolution note). canEdit gates the right
// panel's controls — Client/other view-only roles that reach here (they
// shouldn't, since the card isn't clickable for them) still see it read-only.
function leoDetailHtml(c){
  const canEdit = canManageLEO() && c.status!=="cancelled";
  const supStatus = c.supStatus || "new";
  const isSetAside = supStatus==="setAside";
  const isResolved = supStatus==="resolved";
  const fu1On = canEdit && (isSetAside || isResolved);
  const fu2On = canEdit && (isSetAside || isResolved);
  const fu3On = canEdit && isSetAside; // "If the status is resolved, follow-up 3 remains grayed out"
  const showCloseDate = isResolved || !!c.followUp3 || !!c.closeDate;
  const dateInput = (id, val, enabled)=> `<input type="date" id="${id}" value="${esc(val||"")}" ${enabled?"":"disabled"} style="width:100%;">`;

  return `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">📞</span>Sup call — ${esc(c.reason||"—")}</div>
        <div class="section-actions">
          <button class="btn btn-ghost btn-sm" id="leoBackBtn">← Back to queue</button>
        </div>
      </div>
      <div class="section-body">
        <div class="leo-detail-grid">
          <div class="leo-panel">
            <div class="leo-panel-head"><span class="eyebrow">1</span>Agent's request</div>
            <div class="leo-kv"><span class="leo-kv-label">Status</span><span class="leo-kv-value">${leoStatusBadgeHtml(c)}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">LOB</span><span class="leo-kv-value">${esc(c.lob||"—")}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">Reason</span><span class="leo-kv-value">${esc(c.reason||"—")}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">Ref number</span><span class="leo-kv-value mono">${esc(c.refNumber||"—")}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">Claim number</span><span class="leo-kv-value mono">${esc(c.claimNumber||"—")}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">Assigned to</span><span class="leo-kv-value">${esc(c.assignedTo||"— unassigned —")}</span></div>
            ${leoEscalationDueAt(c) ? `<div class="leo-kv"><span class="leo-kv-label">Auto-escalates</span><span class="leo-kv-value mono">${fmtLeoDateTime(new Date(leoEscalationDueAt(c)).toISOString())}</span></div>` : ""}
            ${(isFullAdmin() && (c.escalationHistory||[]).length) ? `<div class="leo-kv" style="align-items:flex-start;"><span class="leo-kv-label">Escalation history</span><span class="leo-kv-value" style="font-size:12px;">${c.escalationHistory.map(h=>`${esc(h.from)} → ${esc(h.to)} <span style="color:var(--text-dim);">(${fmtLeoDateTime(h.at)}${h.auto?", auto":""})</span>`).join("<br>")}</span></div>` : ""}
            <div class="leo-kv"><span class="leo-kv-label">Callback date/time</span><span class="leo-kv-value mono">${fmtLeoDateTime(c.callbackAt)}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">Logged by</span><span class="leo-kv-value">${esc(c.createdByName||"—")}${c.createdByRole?` (${esc(c.createdByRole)})`:""}</span></div>
            <div class="leo-kv"><span class="leo-kv-label">Logged at</span><span class="leo-kv-value">${c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}</span></div>
            <div style="margin-top:10px;">
              <div class="leo-kv-label" style="font-size:12.5px;margin-bottom:4px;">Agent's notes</div>
              <div style="font-size:12.5px;color:var(--text);background:var(--surface-3);border-radius:6px;padding:8px 10px;white-space:pre-wrap;">${esc((c.agentNotes!=null ? c.agentNotes : c.resolutionNote) || "— none —")}</div>
            </div>
          </div>

          <div class="leo-panel">
            <div class="leo-panel-head"><span class="eyebrow">2</span>Supervisor's work</div>
            <div class="field">
              <label>Status</label>
              <select id="leoDetailStatus" style="width:100%;" ${canEdit?"":"disabled"}>
                ${LEO_SUP_STATUS.map(s=>`<option value="${s.value}" ${supStatus===s.value?"selected":""}>${s.label}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Action</label>
              <select id="leoDetailAction" style="width:100%;" ${canEdit?"":"disabled"}>
                <option value="">— Select action —</option>
                ${LEO_ACTION_OPTIONS.map(a=>`<option value="${esc(a)}" ${c.action===a?"selected":""}>${esc(a)}</option>`).join("")}
              </select>
            </div>
            <div class="field">
              <label>Follow-up dates</label>
              <div class="leo-followups">
                ${dateInput("leoFollowUp1", c.followUp1, fu1On)}
                ${dateInput("leoFollowUp2", c.followUp2, fu2On)}
                ${dateInput("leoFollowUp3", c.followUp3, fu3On)}
              </div>
              <div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Follow-up 1 / 2 / 3 — enabled once status is set to "Set aside".</div>
            </div>
            <div class="field" id="leoCloseDateField" style="${showCloseDate?"":"display:none;"}">
              <label>Date closed</label>
              ${dateInput("leoCloseDate", c.closeDate || (showCloseDate ? isoFromJSDate(new Date()) : ""), canEdit)}
            </div>
            <div class="field">
              <label>Resolution note</label>
              <textarea id="leoResolutionNote" rows="4" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:8px 9px;font-size:12.5px;box-sizing:border-box;" placeholder="What was done on this sup call..." ${canEdit?"":"disabled"}>${esc(c.supResolutionNote || "")}</textarea>
            </div>
            ${!canEdit ? `<div class="help-note">${c.status==="cancelled" ? "This call was cancelled — no further work needed." : "View only."}</div>` : ""}
          </div>
        </div>
      </div>
    </div>`;
}

function openCreateLeoCallModal(){
  const reasons = state.settings.leoReasons || [];
  const showLOBSelect = !isAgent();
  const myLOB = isAgent() ? (agentLOB(currentUser.empId) || "") : "";
  const now = new Date();
  const todayIso = isoFromJSDate(now);
  const nowTime = String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  const overlay = showModal(`
    <div class="modal-title">Escalate — New sup call</div>
    ${showLOBSelect ? `<div class="field"><label>LOB</label>
      <select id="leoLOB" style="width:100%;">
        ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}">${esc(l)}</option>`).join("")}
      </select>
    </div>` : `<div class="field"><label>LOB</label><div style="font-size:12.5px;padding:8px 0;">${esc(myLOB||"— none assigned on your roster record —")}</div></div>`}
    <div class="field"><label>Reason</label>
      <select id="leoReason" style="width:100%;">
        ${reasons.length ? reasons.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("") : `<option value="">— No reasons set up yet, ask Admin —</option>`}
      </select>
    </div>
    <div class="form-inline">
      <div class="field"><label>Ref number</label><input type="text" id="leoRefNumber" placeholder="Claim / reference number" style="width:100%;"></div>
      <div class="field"><label>Claim number</label><input type="text" id="leoClaimNumber" placeholder="Claim number" style="width:100%;"></div>
    </div>
    <div class="form-inline">
      <div class="field"><label>Callback date</label><input type="date" id="leoCallbackDate" value="${todayIso}" style="width:100%;"></div>
      <div class="field"><label>Callback time</label><input type="time" id="leoCallbackTime" value="${nowTime}" style="width:100%;"></div>
    </div>
    <div class="field"><label>Additional notes</label><textarea id="leoNotes" rows="2" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--text);border-radius:5px;padding:8px 9px;font-size:12.5px;" placeholder="Anything else the supervisor should know..."></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="leoCancelModalBtn">Cancel</button>
      <button class="btn btn-accent" id="leoSaveBtn">Create sup call</button>
    </div>
  `);
  overlay.querySelector(".modal-box").classList.add("modal-box-wide");
  overlay.querySelector("#leoCancelModalBtn").addEventListener("click", closeModal);
  overlay.querySelector("#leoSaveBtn").addEventListener("click", async ()=>{
    const lob = showLOBSelect ? document.getElementById("leoLOB").value : myLOB;
    const reason = document.getElementById("leoReason").value;
    const refNumber = document.getElementById("leoRefNumber").value.trim();
    const claimNumber = document.getElementById("leoClaimNumber").value.trim();
    const cbDate = document.getElementById("leoCallbackDate").value;
    const cbTime = document.getElementById("leoCallbackTime").value;
    const notes = document.getElementById("leoNotes").value.trim();
    if(!reason){ showToast("Select a reason"); return; }
    if(!refNumber){ showToast("Enter a ref number"); return; }
    if(!cbDate || !cbTime){ showToast("Enter a callback date and time"); return; }
    if(!isAgent() && !lob){ showToast("Select a LOB"); return; }
    const callbackAt = new Date(`${cbDate}T${cbTime}`).toISOString();
    if(!state.leoCalls) state.leoCalls = [];
    // Everything about the call except assignedTo/assignedToUsername —
    // assignment itself happens below, either transactionally (online) or via
    // the simple local pointer (offline, where there's only ever one writer
    // so no race is possible).
    const callFields = {
      id: "leo"+Date.now(),
      reason, refNumber, claimNumber, callbackAt, lob,
      status: "open",
      supStatus: "new", // drives the supervisor work view — New / Set aside / Resolved
      action: "",
      followUp1: "", followUp2: "", followUp3: "", closeDate: "",
      supResolutionNote: "",
      createdByEmpId: isAgent() ? currentAgentId() : "",
      createdByName: (currentUser && currentUser.name) || "",
      createdByRole: isFullAdmin()?"Admin":isManagerRole()?"Manager":isTL()?"Team Leader":isSME()?"SME":isTrainer()?"Trainer":isAgent()?"Agent":"",
      createdByUsername: (currentUser && currentUser.username) || "",
      createdAt: new Date().toISOString(),
      agentNotes: notes||""
    };
    const saveBtn = overlay.querySelector("#leoSaveBtn");
    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = "Saving...";
    try{
      if(fbReady){
        // Atomic assign-and-append — see createLeoCallTransactional() in
        // js/firebase.js. Fixes the round-robin race: two sessions creating a
        // sup call at nearly the same moment can no longer be handed the same
        // supervisor or overwrite each other's new call.
        await createLeoCallTransactional(callFields);
      } else {
        // Local-only/offline mode: single browser tab writing to its own
        // storage, so the plain local pointer is safe here.
        const assigned = assignNextLeoSupervisor(); // advances the local rotation pointer
        state.leoCalls.push({...callFields, assignedTo: assigned ? assigned.name : "", assignedToUsername: assigned ? assigned.username : ""});
        await saveState();
      }
      closeModal(); render();
      showToast("✅ Sup call logged — a supervisor will work the callback");
    }catch(e){
      console.error("Failed to create sup call", e);
      showToast("⚠ Couldn't log the sup call — check your connection and try again");
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
    }
  });
}

function wireLeoDetailListeners(content){
  const c = (state.leoCalls||[]).find(x=>x.id===leoOpenCallId);
  const backBtn = document.getElementById("leoBackBtn");
  if(backBtn) backBtn.addEventListener("click", ()=>{ leoOpenCallId = null; render(); });
  if(!c) return;
  const canEdit = canManageLEO() && c.status!=="cancelled";
  if(!canEdit) return;

  const statusSel = document.getElementById("leoDetailStatus");
  if(statusSel) statusSel.addEventListener("change", ()=>{
    const v = statusSel.value;
    c.supStatus = v;
    if(v==="resolved"){
      c.status = "completed";
      c.resolvedBy = (currentUser && currentUser.name) || "";
      c.resolvedAt = new Date().toISOString();
      if(!c.closeDate) c.closeDate = isoFromJSDate(new Date()); // "once we select resolved it will auto-show today's date"
    } else {
      c.status = "open";
      c.resolvedBy = ""; c.resolvedAt = "";
      if(v==="new"){ c.followUp1=""; c.followUp2=""; c.followUp3=""; c.closeDate=""; }
    }
    saveState(); render();
  });

  const actionSel = document.getElementById("leoDetailAction");
  if(actionSel) actionSel.addEventListener("change", ()=>{
    c.action = actionSel.value;
    saveState();
  });

  const fu1 = document.getElementById("leoFollowUp1");
  if(fu1) fu1.addEventListener("change", ()=>{ c.followUp1 = fu1.value; saveState(); });
  const fu2 = document.getElementById("leoFollowUp2");
  if(fu2) fu2.addEventListener("change", ()=>{ c.followUp2 = fu2.value; saveState(); });
  const fu3 = document.getElementById("leoFollowUp3");
  if(fu3) fu3.addEventListener("change", ()=>{
    c.followUp3 = fu3.value;
    if(fu3.value && !c.closeDate) c.closeDate = isoFromJSDate(new Date()); // "after selecting follow-up 3 it will auto-show date closed"
    saveState(); render();
  });

  const closeDateInput = document.getElementById("leoCloseDate");
  if(closeDateInput) closeDateInput.addEventListener("change", ()=>{ c.closeDate = closeDateInput.value; saveState(); });

  const noteArea = document.getElementById("leoResolutionNote");
  if(noteArea) noteArea.addEventListener("input", ()=>{ c.supResolutionNote = noteArea.value; saveState(); });
}

// Changes the LEO reason master list. With the cloud connected this is an atomic
// read-modify-write on the server copy (see updateLeoReasonsTransactional in
// js/firebase.js); in local-only mode it just edits this browser's list.
async function leoMutateReasons(mutate){
  if(typeof fbReady!=="undefined" && fbReady && typeof updateLeoReasonsTransactional==="function"){
    return await updateLeoReasonsTransactional(mutate);
  }
  const next = mutate((state.settings.leoReasons||[]).slice());
  state.settings.leoReasons = next;
  saveState();
  return next;
}

function wireLeoListeners(content){
  if(leoOpenCallId){ wireLeoDetailListeners(content); return; }
  const createBtn = document.getElementById("leoCreateBtn");
  if(createBtn) createBtn.addEventListener("click", openCreateLeoCallModal);

  const reasonsToggleBtn = document.getElementById("leoReasonsToggleBtn");
  if(reasonsToggleBtn) reasonsToggleBtn.addEventListener("click", ()=>{
    leoReasonsPanelOpen = !leoReasonsPanelOpen;
    render();
  });

  content.querySelectorAll(".del-leo-reason-btn").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const removed = (state.settings.leoReasons||[])[+btn.dataset.i];
      if(removed==null) return;
      btn.disabled = true;
      try{
        // Removes by NAME against the server's current list, not by position in this
        // browser's copy, so it can never delete the wrong reason after the list changed.
        await leoMutateReasons(list=> list.filter(r=> r!==removed));
        logAudit("leo_reason_delete", `Removed LEO reason "${removed}"`, {before:{value:removed}});
        render();
      }catch(e){
        console.error("LEO reason delete failed", e);
        showToast("⚠ Couldn't remove that reason — check your connection and try again");
        btn.disabled = false;
      }
    });
  });
  const addReasonBtn = document.getElementById("addLeoReasonBtn");
  if(addReasonBtn) addReasonBtn.addEventListener("click", async ()=>{
    const input = document.getElementById("newLeoReasonInput");
    const val = input.value.trim();
    if(!val){ showToast("Enter a reason"); return; }
    if(addReasonBtn.disabled) return;
    addReasonBtn.disabled = true;
    let duplicate = false;
    try{
      // Appends to the SERVER's current list inside a transaction, so two people adding
      // reasons at the same time (or a stale browser) can't overwrite each other's.
      await leoMutateReasons(list=>{
        if(list.some(r=> String(r).toLowerCase()===val.toLowerCase())){ duplicate = true; return list; }
        return list.concat([val]);
      });
    }catch(e){
      console.error("LEO reason add failed", e);
      showToast("⚠ Couldn't save that reason — check your connection and try again");
      addReasonBtn.disabled = false;
      return;
    }
    if(duplicate){ showToast("That reason already exists"); render(); return; }
    logAudit("leo_reason_add", `Added LEO reason "${val}"`, {after:{value:val}});
    render();
  });

  const escEnabled = document.getElementById("leoEscEnabled");
  const escHours = document.getElementById("leoEscHours");
  if(escEnabled) escEnabled.addEventListener("change", ()=>{
    state.settings.leoEscalationEnabled = escEnabled.checked;
    logAudit("leo_escalation_toggle", `LEO auto-escalation ${escEnabled.checked?"enabled":"disabled"}`, {after:{value:escEnabled.checked}});
    saveState(); render();
    if(escEnabled.checked) runLeoEscalationCheck();
  });
  if(escHours) escHours.addEventListener("change", ()=>{
    const n = Math.round(Number(escHours.value));
    if(!(n >= 1 && n <= 72)){ showToast("Enter a whole number of hours between 1 and 72"); escHours.value = leoEscalationHoursValue(state.settings.leoEscalationHours); return; }
    const before = state.settings.leoEscalationHours;
    state.settings.leoEscalationHours = n;
    logAudit("leo_escalation_hours", `LEO auto-escalation window changed to ${n}h`, {before:{value:before}, after:{value:n}});
    saveState(); render();
  });

  const supervisorsToggleBtn = document.getElementById("leoSupervisorsToggleBtn");
  if(supervisorsToggleBtn) supervisorsToggleBtn.addEventListener("click", ()=>{
    leoSupervisorsPanelOpen = !leoSupervisorsPanelOpen;
    render();
  });

  content.querySelectorAll(".del-leo-supervisor-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = +btn.dataset.i;
      const removedUsername = state.settings.leoSupervisors[i];
      const removedUser = (state.settings.users||[]).find(u=>u.username===removedUsername);
      state.settings.leoSupervisors.splice(i,1);
      // Rotation pointer is just an index into this list — clamp it back in
      // range so it doesn't point past the end after a removal.
      if(state.settings.leoSupervisors.length===0) state.settings.leoNextSupervisorIndex = 0;
      else state.settings.leoNextSupervisorIndex = state.settings.leoNextSupervisorIndex % state.settings.leoSupervisors.length;
      logAudit("leo_supervisor_delete", `Removed LEO supervisor "${removedUser?removedUser.name:removedUsername}"`, {before:{value:removedUsername}});
      saveState(); render();
    });
  });
  // Add-supervisor search box: type-to-filter, click a result to add
  // directly — no dropdown, no separate "Add" button. Results are rendered
  // straight into the DOM on input (not via a full render()) so the box
  // keeps focus and caret position while typing; a full render() only
  // happens once an account is actually added.
  const supSearchInput = document.getElementById("leoSupervisorSearchInput");
  const supSearchResults = document.getElementById("leoSupervisorSearchResults");
  if(supSearchInput && supSearchResults){
    const addSupervisor = (username)=>{
      if((state.settings.leoSupervisors||[]).includes(username)){ showToast("That supervisor is already on the list"); return; }
      if(!state.settings.leoSupervisors) state.settings.leoSupervisors = [];
      state.settings.leoSupervisors.push(username);
      const addedUser = (state.settings.users||[]).find(u=>u.username===username);
      logAudit("leo_supervisor_add", `Added LEO supervisor "${addedUser?addedUser.name:username}"`, {after:{value:username}});
      saveState(); render();
    };
    const renderSupResults = ()=>{
      const q = supSearchInput.value.trim().toLowerCase();
      const sups = state.settings.leoSupervisors||[];
      const matches = eligibleLeoSupervisorAccounts()
        .filter(u=> !sups.includes(u.username))
        .filter(u=> !q || u.name.toLowerCase().includes(q) || (u.username||"").toLowerCase().includes(q))
        .slice(0,20);
      if(!matches.length){
        supSearchResults.innerHTML = `<div class="global-search-empty">${q ? "No matching accounts" : "No eligible accounts left to add"}</div>`;
        supSearchResults.style.display = "block";
        return;
      }
      supSearchResults.innerHTML = matches.map(u=>
        `<div class="global-search-item" data-username="${esc(u.username)}">
          <div class="global-search-item-title">${esc(u.name)}</div>
          <div class="global-search-item-sub">${leoSupervisorRoleLabel(u.role)}${u.tlName?` · ${esc(u.tlName)}`:""}</div>
        </div>`).join("");
      supSearchResults.style.display = "block";
      // mousedown (not click) + preventDefault so the input never blurs when
      // a result is picked — avoids racing against the blur-hide below.
      supSearchResults.querySelectorAll(".global-search-item").forEach(el=>{
        el.addEventListener("mousedown", (e)=>{
          e.preventDefault();
          addSupervisor(el.dataset.username);
        });
      });
    };
    supSearchInput.addEventListener("input", renderSupResults);
    supSearchInput.addEventListener("focus", renderSupResults);
    supSearchInput.addEventListener("blur", ()=>{
      setTimeout(()=>{ supSearchResults.style.display = "none"; }, 120);
    });
    supSearchInput.addEventListener("keydown", (e)=>{
      if(e.key==="Escape"){ supSearchInput.blur(); supSearchResults.style.display = "none"; }
      else if(e.key==="Enter"){
        e.preventDefault();
        const first = supSearchResults.querySelector(".global-search-item");
        if(first) addSupervisor(first.dataset.username);
      }
    });
  }

  if(typeof wireLeoReportListeners==="function") wireLeoReportListeners(content);
  content.querySelectorAll("[data-leotab]").forEach(btn=>{
    btn.addEventListener("click", ()=>{ leoStatusFilter = btn.dataset.leotab; render(); });
  });

  const searchInput = document.getElementById("leoSearchInput");
  if(searchInput){
    searchInput.addEventListener("input", ()=>{
      leoSearch = searchInput.value;
      const pos = searchInput.selectionStart;
      renderLEO(content, window.__topActionsEl || content.parentElement.querySelector(".top-actions"));
      const freshInput = document.getElementById("leoSearchInput");
      if(freshInput){ freshInput.focus(); freshInput.setSelectionRange(pos,pos); }
    });
  }

  // Opens the full-page work view for a call (TL/Trainer/Admin only — see canWork above).
  content.querySelectorAll(".leo-open-btn").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.stopPropagation();
      leoOpenCallId = btn.dataset.id;
      markLeoCallRead(btn.dataset.id);
      if(typeof refreshNavBadges==="function") refreshNavBadges();
      render();
    });
  });
  content.querySelectorAll('[data-leo-open="1"]').forEach(card=>{
    card.addEventListener("click", (e)=>{
      if(e.target.closest("button")) return; // let the icon/open buttons handle their own click
      leoOpenCallId = card.dataset.id;
      markLeoCallRead(card.dataset.id);
      if(typeof refreshNavBadges==="function") refreshNavBadges();
      render();
    });
    card.addEventListener("keydown", (e)=>{
      if(e.key==="Enter" || e.key===" "){ e.preventDefault(); leoOpenCallId = card.dataset.id; markLeoCallRead(card.dataset.id); if(typeof refreshNavBadges==="function") refreshNavBadges(); render(); }
    });
  });

  content.querySelectorAll(".leo-cancel-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      showConfirm("Cancel this sup call? It stays visible under the Cancelled filter, but drops off the Open queue.", ()=>{
        const c = (state.leoCalls||[]).find(x=>x.id===id);
        if(!c) return;
        c.status = "cancelled";
        c.resolvedBy = (currentUser && currentUser.name) || "";
        c.resolvedAt = new Date().toISOString();
        saveState(); render();
      }, "Cancel call");
    });
  });
  content.querySelectorAll(".leo-delete-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      showConfirm("Permanently delete this sup call? This can't be undone.", ()=>{
        state.leoCalls = (state.leoCalls||[]).filter(x=>x.id!==id);
        saveState(); render();
      }, "Delete");
    });
  });
}

function renderLEO(content, topActions){
  if(topActions){ topActions.innerHTML = ""; window.__topActionsEl = topActions; }
  content.innerHTML = leoSectionHtml();
  wireLeoListeners(content);
}
