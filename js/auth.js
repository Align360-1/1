/* ---------------- Login / RBAC ---------------- */
let currentUser = null; // {role:'admin'|'manager'|'wfm'|'tl'|'sme'|'agent'|'trainer'|'client', id, name, username, tlName, empId, viewAll}

/* ---------------- Session persistence ----------------
   Keeps currentUser in localStorage so a page refresh doesn't force re-login.
   Re-validated against live data on restore (account may've been disabled/removed
   since last login), never trusted blindly. */
const SESSION_KEY = "a360_session" + (typeof ENV_PREFIX!=="undefined" ? ENV_PREFIX : "");
function saveSession(user){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify(user)); }catch(e){}
}
function clearSession(){
  try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
}
function restoreSession(){
  let saved;
  try{ saved = JSON.parse(localStorage.getItem(SESSION_KEY)); }catch(e){ saved = null; }
  if(!saved) return false;
  if(saved.role === "agent"){
    const agent = state.roster.find(a=>a.empId===saved.empId);
    if(!agent) { clearSession(); return false; }
    currentUser = {role:"agent", empId: agent.empId, name: agent.name};
  } else {
    const user = findUserByUsername(saved.username);
    if(!user || user.enabled===false) { clearSession(); return false; }
    currentUser = {role:user.role, id:user.id, name:user.name, username:user.username, tlName:user.tlName||"", viewAll:!!user.viewAll};
  }
  loadViewPeriodForUser();
  loadThemeForUser();
  ensureViewMonthLoaded();
  return true;
}

/* ---------------- Per-login period view ----------------
   Which month/year this browser's current login is looking at. Defaults to the real
   current month, but each login can browse other months/years without affecting
   anyone else — it's kept in this device's localStorage, keyed to the logged-in
   account, and never written to the shared Firestore settings doc. */
let viewPeriod = {month:null, year:null};
function defaultViewPeriod(){ const d=new Date(); return {month: MONTHS[d.getMonth()], year: d.getFullYear()}; }

/* ---------------- Per-login theme ----------------
   Light/dark is a per-login display preference, same idea as viewPeriod above.
   Kept in this device's localStorage, keyed to the logged-in account, and never
   written to the shared settings — so one login's toggle can't flip it for anyone else. */
let userTheme = "dark";
function loadThemeForUser(){
  const key = userViewKey();
  let t = null;
  if(key){
    try{
      const raw = localStorage.getItem("a360_theme_"+key);
      if(raw === "light" || raw === "dark") t = raw;
    }catch(e){ /* ignore, fall back to default below */ }
  }
  userTheme = t || (state.settings.theme === "light" ? "light" : "dark");
}
function saveThemeForUser(){
  const key = userViewKey();
  if(!key) return;
  try{ localStorage.setItem("a360_theme_"+key, userTheme); }catch(e){}
}
function userViewKey(){
  if(!currentUser) return null;
  return currentUser.role==="agent" ? ("agent_"+currentUser.empId) : ("user_"+(currentUser.username||currentUser.id||currentUser.name));
}
function loadViewPeriodForUser(){
  const key = userViewKey();
  let vp = null;
  if(key){
    try{
      const raw = localStorage.getItem("a360_view_"+key);
      if(raw){
        const parsed = JSON.parse(raw);
        if(parsed && MONTHS.includes(parsed.month) && Number.isFinite(parsed.year)) vp = parsed;
      }
    }catch(e){ /* ignore, fall back to default below */ }
  }
  viewPeriod = vp || defaultViewPeriod();
}
function saveViewPeriodForUser(){
  const key = userViewKey();
  if(!key) return;
  try{ localStorage.setItem("a360_view_"+key, JSON.stringify(viewPeriod)); }catch(e){}
}
function viewMonthIdx(){ return MONTHS.indexOf(viewPeriod.month); }
function viewYear(){ return viewPeriod.year; }
function isCustomViewPeriod(){
  const d = defaultViewPeriod();
  return viewPeriod.month!==d.month || viewPeriod.year!==d.year;
}
// Renders the Month/Year picker shown in the topbar on every page. Changing it only
// updates this browser's own viewPeriod (saved to localStorage under this login) —
// it never writes to state.settings, so nobody else's view is affected.
function renderPeriodPicker(){
  const wrap = document.getElementById("periodPickerWrap");
  if(!wrap || !currentUser) return;
  const years = Array.from({length:7},(_,i)=>2024+i);
  wrap.innerHTML = `
    <select class="week-select" id="viewMonthSel" style="font-size:12px;padding:4px 8px;">
      ${MONTHS.map(m=>`<option value="${m}" ${m===viewPeriod.month?'selected':''}>${m}</option>`).join("")}
    </select>
    <select class="week-select" id="viewYearSel" style="font-size:12px;padding:4px 8px;">
      ${years.map(yy=>`<option value="${yy}" ${yy===viewPeriod.year?'selected':''}>${yy}</option>`).join("")}
    </select>
    ${isCustomViewPeriod() ? `<button class="btn btn-ghost btn-sm" id="resetViewPeriodBtn" title="Back to the current month">↺ Current month</button>` : ""}
    <span style="font-size:11px;color:var(--text-dim);">— your view only</span>
  `;
  document.getElementById("viewMonthSel").addEventListener("change", e=>{
    viewPeriod = {month: e.target.value, year: viewPeriod.year};
    saveViewPeriodForUser();
    render();
    ensureViewMonthLoaded();
  });
  document.getElementById("viewYearSel").addEventListener("change", e=>{
    viewPeriod = {month: viewPeriod.month, year: Number(e.target.value)};
    saveViewPeriodForUser();
    render();
    ensureViewMonthLoaded();
  });
  const resetBtn = document.getElementById("resetViewPeriodBtn");
  if(resetBtn) resetBtn.addEventListener("click", ()=>{
    viewPeriod = defaultViewPeriod();
    saveViewPeriodForUser();
    render();
    ensureViewMonthLoaded();
  });
}

// Admin (and Manager) is a superset of WFM: every place that already checks isWFM() automatically
// also grants access to Admin and Manager. Admin-only features (Branding, User accounts/logins,
// resetting other users' passwords, Clear/Reset data, Audit Log) are gated with isFullAdmin().
// Role ladder: Admin > Manager > WFM. Manager is "just below Admin": it gets everything Admin
// gets EXCEPT four things, which are gated with isFullAdmin() (true Admin only):
//   - Settings → Branding (team name, app name, logo)
//   - Settings → User accounts (login) — view/add/remove/reset password/enable/disable
//   - Settings → Data (Clear demo/test data, Reset settings, Reset all data)
//   - the Audit Log tab
// So: isWFM() and isAdmin() both include Manager (all existing "Admin-level" checks keep
// working unchanged for Manager), while isFullAdmin() is the strict, Admin-only check.
// NOTE: isManager() further below is an unrelated, older helper meaning "WFM or TL"
// (a staff login as opposed to an Agent) — it is NOT the Manager role. Use isManagerRole().
function isWFM(){ return currentUser && (currentUser.role === 'wfm' || currentUser.role === 'admin' || currentUser.role === 'manager'); }
function isAdmin(){ return currentUser && (currentUser.role === 'admin' || currentUser.role === 'manager'); }
function isFullAdmin(){ return currentUser && currentUser.role === 'admin'; }
function isManagerRole(){ return currentUser && currentUser.role === 'manager'; }
// Display label for a role string / the logged-in user, shared by the sidebar, audit log and LEO.
function currentRoleLabel(){
  return !currentUser ? "Unknown" : isFullAdmin() ? "Admin" : isManagerRole() ? "Manager" : isWFM() ? "WFM Admin" : isTL() ? "Team Leader" : isSME() ? "SME" : isQuality() ? "Quality" : isTrainer() ? "Trainer" : isClient() ? "Client" : "Agent";
}
function isTL(){ return currentUser && currentUser.role === 'tl'; }
function isAgent(){ return currentUser && currentUser.role === 'agent'; }
function isTrainer(){ return currentUser && currentUser.role === 'trainer'; }
function isClient(){ return currentUser && currentUser.role === 'client'; }
// SME sits under a TL and is always scoped to that one TL's team (currentUser.tlName) —
// unlike TL, an SME never gets a "Full data access"/viewAll toggle. See scopedRoster()
// below, and the SME-specific branches sprinkled through dashboard/daily/breaks/roster/
// leave/history/documentation/settings for exactly what an SME can see and do.
function isSME(){ return currentUser && currentUser.role === 'sme'; }
// Quality analyst: a standalone role (not tied to a team) whose whole job is auditing calls.
// Sees only Dashboard (their own audit dashboard — js/qualitydashboard.js), Process Update
// (view only), Quality Audit (can submit; sees only the audits THEY submitted), Employee
// Engagement Zone, Documentation template (view only), and a restricted Settings page (own
// password + the Quality Audit error-category lists). Everything else — roster, breaks, leave,
// LEO, daily data, history — is closed. Because `isManager()`/`isWFM()` don't include this
// role, every existing "staff" gate already excludes it; the places that DON'T (open-ended
// "everyone except X" checks such as canViewLEO and the LEO supervisor lists) are handled explicitly.
function isQuality(){ return currentUser && currentUser.role === 'quality'; }
// True only for the plain WFM role — NOT Admin. Admin is a superset of WFM everywhere
// else, but Process Update / Documentation template are the one place WFM is deliberately
// cut out while Admin keeps full access, so this distinguishes the two.
function isPlainWFM(){ return currentUser && currentUser.role === 'wfm'; }
function isManager(){ return isWFM() || isTL(); } // either kind of staff login, as opposed to an Agent
// True for WFM, or for a TL account whose "Full data access" option is turned on.
function canViewAllTeams(){ return isWFM() || (isTL() && !!currentUser.viewAll); }

// ---- Process Update / Documentation template permissions ----
// These two sections have their own access rules, separate from isManager():
//  - Trainer gets full read/write access to both, but none of the broader manager
//    powers (editing roster, shifts, approving swaps, etc).
//  - Client gets read-only access to both (and to Dashboard / Daily Summary — see
//    the Client-specific tab list in app.js). Client never gets create/edit/delete
//    anywhere, and never sees Roster, Breaks, Leave, or anything else.
//  - WFM is deliberately excluded from both — can't view, let alone manage, either one.
//  - TL and Admin keep the access they always had.
//  - Agent keeps read-only visibility into Process Update (unchanged), and — for
//    Documentation template specifically — read + copy access, scoped to their own
//    roster LOB (see agentVisibleDocEntries() in js/documentation.js). An agent whose
//    roster record has no LOB set sees nothing until WFM/TL assigns one.
function canViewProcessUpdates(){ return currentUser && currentUser.role !== 'wfm'; }
function canManageProcessUpdates(){ return isTrainer() || isTL() || isAdmin(); }
// SME can't post, reorder, or archive updates — but, unlike a plain view-only role,
// they CAN pin/unpin any update to the top. See the pin-button gating in history.js.
function canPinProcessUpdate(){ return canManageProcessUpdates() || isSME(); }
function canViewDocumentation(){ return isTrainer() || isTL() || isAdmin() || isClient() || isAgent() || isSME() || isQuality(); }
// Can reach the Post/create flow at all. Agent and Client are read+copy/read-only
// respectively and never get here (checked separately in the UI). SME gets full
// management access here (post/edit/delete any entry — see canEditDocEntry below),
// same as Admin, per the "complete access" grant for Documentation template.
function canManageDocumentation(){ return isTrainer() || isTL() || isAdmin() || isSME(); }

// ---- LEO (supervisor-call escalation) permissions ----
// Visible to everyone except plain WFM (same shape as canViewProcessUpdates — Admin,
// being role 'admin' not 'wfm', is NOT excluded here even though isWFM() covers Admin
// too). Creating a sup call is open to Agent/TL/Trainer/Admin — Client is view-only,
// same as it is for Process Update and Documentation template. Managing the queue
// (marking a call completed/cancelled, or deleting someone else's) is TL/Trainer/Admin;
// an Agent may only cancel their own still-open call (mistake correction), handled
// per-entry in js/leo.js rather than here.
function canViewLEO(){ return currentUser && currentUser.role !== 'wfm' && currentUser.role !== 'quality'; }

// ---- Quality Audit / Employee Engagement Zone (work-in-progress placeholder tabs) ----
// Visible to everyone except Client and plain WFM — unlike canViewLEO() above, Client
// is deliberately excluded here too (Admin still gets in, since it's role 'admin' not 'wfm').
function canViewQualityAudit(){ return currentUser && currentUser.role !== 'wfm' && currentUser.role !== 'client'; }
// Who can SUBMIT quality audits (see js/qualityaudit.js). Agents can open the tab but only see
// audits about themselves; Client/plain WFM can't open it at all (canViewQualityAudit above).
function canAuditQuality(){ return currentUser && (isAdmin() || isTL() || isTrainer() || isSME() || isQuality()); }
// ---- PKT (weekly Product Knowledge Test) ----
// Visible to everyone except Client and plain WFM (same audience as Quality Audit). Quality + Admin/Manager
// CREATE, publish and manage PKTs; agents TAKE them; TL/SME/Trainer watch results (TL/SME only for their
// own team — see pktAudience() in js/pkt.js).
function canViewPKT(){ return currentUser && currentUser.role !== 'wfm' && currentUser.role !== 'client'; }
function canAuthorPKT(){ return isQuality() || isAdmin(); }
// ---- Knowledge Base ----
// Everyone except Client and plain WFM can read (agents see only their own LOB + General articles — see
// kbVisible() in js/kb.js). Trainer, TL, SME, Quality and Admin/Manager can write; editing an existing
// article is open to Admin/Trainer/SME and to whoever created it.
function canViewKB(){ return currentUser && currentUser.role !== 'wfm' && currentUser.role !== 'client'; }
function canManageKB(){ return isTrainer() || isTL() || isSME() || isQuality() || isAdmin(); }
function canEditKB(a){
  if(!canManageKB() || !a) return false;
  if(isAdmin() || isTrainer() || isSME()) return true;
  return !!a.createdByUsername && a.createdByUsername === currentUser.username;
}
function canViewEngagementZone(){ return currentUser && currentUser.role !== 'wfm' && currentUser.role !== 'client'; }
function canCreateLEO(){ return isAgent() || isTL() || isTrainer() || isAdmin() || isSME(); }
function canManageLEO(){ return isTL() || isTrainer() || isAdmin() || isSME(); }
// Per-entry edit/delete: Trainer/TL only get RWCD on their *own* posts; Admin gets
// full CRUD on every entry regardless of author.
function canEditDocEntry(entry){
  if(!entry) return false;
  if(isAdmin() || isSME()) return true; // SME has full CRUD on every entry, not just their own
  if(!(isTrainer() || isTL())) return false;
  return entry.postedByUsername && currentUser.username && entry.postedByUsername === currentUser.username;
}
// True when the viewer should see an unscoped, whole-organization view (no "just my
// team" filtering) even though they aren't WFM/Admin or a full-access TL — currently
// Trainer and Client, both of whom read across every team by design.
function seesAllTeamsView(){ return canViewAllTeams() || isTrainer() || isClient(); }
function currentAgentId(){ return isAgent() ? currentUser.empId : null; }
// Restricts the roster to a TL's own team; WFM (and a full-access TL) sees everyone.
// An SME is always pinned to their assigned TL's team (currentUser.tlName) — they
// never get a "Full data access" toggle like a TL can.
function scopedRoster(){
  if(isSME()) return state.roster.filter(a=>(a.tlName||"")===currentUser.tlName);
  if(isTL() && !currentUser.viewAll) return state.roster.filter(a=>(a.tlName||"")===currentUser.tlName);
  return state.roster;
}
function findUserByUsername(uname){
  return (state.settings.users||[]).find(u=>u.username && u.username.toLowerCase()===String(uname||"").trim().toLowerCase());
}
/* ---- Credential hashing ----
   Passwords and security answers are never stored or synced in plain text. Each is kept as
   a salted SHA-256 hash (passwordHash/passwordSalt, securityAHash/securityASalt). This means
   the settings document — which every browser reads on load, before anyone logs in — never
   contains anything usable to log in directly, even if someone inspects it in DevTools or
   Firestore. This is a meaningful hardening step, not a full server-side auth system: since
   this app has no backend, the hash comparison still happens in the browser. A determined
   attacker with the hash+salt could still attempt an offline brute-force guess, so this
   should be treated as "credentials are no longer handed out in the clear," not "this is now
   as secure as a real login server." */
function randomSalt(){
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function hashSecret(secret, salt){
  const input = `${salt}::${secret}`;
  if(window.crypto && window.crypto.subtle){
    try{
      const bytes = new TextEncoder().encode(input);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return "sha256:" + Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
    }catch(e){ /* fall through to the fallback below — some browsers block SubtleCrypto on file:// pages */ }
  }
  // Fallback for contexts without SubtleCrypto. Still avoids storing the plaintext outright,
  // but this is NOT a cryptographically strong hash — treat it as better-than-nothing, not
  // equivalent to the SHA-256 path above.
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i=0;i<input.length;i++){
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return "fnv:" + (h1>>>0).toString(16).padStart(8,"0") + (h2>>>0).toString(16).padStart(8,"0");
}
async function setUserPassword(user, plainPassword){
  user.passwordSalt = randomSalt();
  user.passwordHash = await hashSecret(plainPassword, user.passwordSalt);
  delete user.password; // never keep the plaintext once it's hashed
}
async function setUserSecurityAnswer(user, plainAnswer){
  user.securityASalt = randomSalt();
  user.securityAHash = await hashSecret(String(plainAnswer||"").trim().toLowerCase(), user.securityASalt);
  delete user.securityA;
}
async function verifyUserPassword(user, plainPassword){
  if(!user.passwordHash){
    // Legacy/unmigrated account (shouldn't normally happen — migrateUserCredentials() runs
    // on every load) — fall back to a direct compare once, then upgrade it to a hash.
    if(user.password !== undefined && user.password === plainPassword){ await setUserPassword(user, plainPassword); return true; }
    return false;
  }
  return (await hashSecret(plainPassword, user.passwordSalt)) === user.passwordHash;
}
async function verifyUserSecurityAnswer(user, plainAnswer){
  const normalized = String(plainAnswer||"").trim().toLowerCase();
  if(!user.securityAHash){
    if(user.securityA !== undefined && String(user.securityA).trim().toLowerCase() === normalized){ await setUserSecurityAnswer(user, plainAnswer); return true; }
    return false;
  }
  return (await hashSecret(normalized, user.securityASalt)) === user.securityAHash;
}
// Hashes any plaintext password/securityA still sitting on an account (freshly-seeded
// defaults, or accounts created before hashing existed) and removes the plaintext. Runs
// after every load/restore/reset, right after ensureDefaultUsers().
async function migrateUserCredentials(){
  const users = state.settings.users || [];
  let changed = false;
  for(const u of users){
    if(u.password !== undefined){ await setUserPassword(u, u.password); changed = true; }
    if(u.securityA !== undefined){ await setUserSecurityAnswer(u, u.securityA); changed = true; }
  }
  if(changed) saveState();
}
// Guarantees there's always at least one WFM account and at least one Admin account to
// log in with — runs after every load/restore/reset. Builds fresh objects rather than
// pointing at DEFAULT_STATE's, so a freshly-seeded account can never accidentally mutate
// the shared default template.
function ensureDefaultUsers(){
  if(!state.settings.users || !Array.isArray(state.settings.users)) state.settings.users = [];
  if(!state.settings.users.length){
    state.settings.users = [{
      id: "u_wfm_default", role: "wfm", name: "WFM Admin", username: "wfm", password: "admin",
      tlName: "", viewAll: false, securityQ: "What is your favorite color?", securityA: "blue"
    }];
  }
  // Older/existing setups won't have an Admin account yet (Admin is a new top-level role
  // that now owns Branding, User accounts, and resetting other users' passwords) — seed
  // one automatically so Settings → User accounts is always reachable by someone.
  if(!state.settings.users.some(u=>u.role==="admin")){
    let uname = "admin", n = 1;
    while(state.settings.users.some(u=>u.username===uname)){ n++; uname = "admin"+n; }
    state.settings.users.push({
      id: "u_admin_"+Date.now(), role: "admin", name: "Admin", username: uname, password: "admin123",
      tlName: "", viewAll: false, securityQ: "What is your favorite color?", securityA: "blue"
    });
  }
}
