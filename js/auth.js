/* ---------------- Login / RBAC ---------------- */
let currentUser = null; // {role:'admin'|'wfm'|'tl'|'agent', id, name, username, tlName, empId, viewAll}

/* ---------------- Session persistence ----------------
   Keeps currentUser in localStorage so a page refresh doesn't force re-login.
   Re-validated against live data on restore (account may've been disabled/removed
   since last login), never trusted blindly. */
const SESSION_KEY = "a360_session";
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

// Admin is a superset of WFM: every place that already checks isWFM() automatically
// also grants access to Admin. Admin-only features (Branding, User accounts/logins,
// resetting other users' passwords) are gated separately with isAdmin().
function isWFM(){ return currentUser && (currentUser.role === 'wfm' || currentUser.role === 'admin'); }
function isAdmin(){ return currentUser && currentUser.role === 'admin'; }
function isTL(){ return currentUser && currentUser.role === 'tl'; }
function isAgent(){ return currentUser && currentUser.role === 'agent'; }
function isManager(){ return isWFM() || isTL(); } // either kind of staff login, as opposed to an Agent
// True for WFM, or for a TL account whose "Full data access" option is turned on.
function canViewAllTeams(){ return isWFM() || (isTL() && !!currentUser.viewAll); }
function currentAgentId(){ return isAgent() ? currentUser.empId : null; }
// Restricts the roster to a TL's own team; WFM (and a full-access TL) sees everyone.
function scopedRoster(){
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
