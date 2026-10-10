/* ---------------- Storage: Firestore (shared, real-time) ---------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDvyxH_Vmv80bV1vhdDiwjTCC9p-YfU7xI",
  authDomain: "align360-6fa04.firebaseapp.com",
  projectId: "align360-6fa04",
  storageBucket: "align360-6fa04.firebasestorage.app",
  messagingSenderId: "383372754480",
  appId: "1:383372754480:web:a4f1a7f6ecb4dc61b877f5"
};
let fbDb = null, fbReady = false;
let __fbUnsubRoster = null, __fbUnsubSettings = null, __fbUnsubDaily = null, __fbUnsubMisc = null;
let __fbLastSavedDocsJson = "";
let __fbLastSavedIpaJson = "";
let __fbDailyMonthKey = null;
let __fbLastSavedRoster = {};   // empId -> JSON string, for diffing what actually needs writing
let __fbLastSavedDaily = {};    // empId -> JSON string (that agent's records for the currently-synced month)
let __fbLastSavedSettingsJson = null;
let __fbLastSavedSwapsJson = null;
let __fbLastSavedUpdatesJson = null;
let __fbLastSavedLeoCallsJson = null;
let __fbLastSavedKb = {};        // KB article id -> JSON string, for diffing
let __fbLastSavedKbFb = {};      // KB feedback id -> JSON string, for diffing
let __fbLastSavedPkt = {};       // PKT id -> JSON string, for diffing
let __fbLastSavedPktAtt = {};    // PKT attempt id -> JSON string, for diffing
let __fbLastSavedQa = {};        // quality audit id -> JSON string, for diffing
let __fbLastSavedHistory = {};   // history entry id -> JSON string, for diffing
let __fbLastSavedDailySummary = {}; // daily summary row id -> JSON string, for diffing

function fbMonthKey(y, mIdx){ return `${y}-${pad2(mIdx+1)}`; }
function dailyDocId(empId, monthKey){ return `${empId}__${monthKey}`; }
function setSyncStatus(state_, label){
  const dot = document.getElementById("syncDot");
  const txt = document.getElementById("syncStatusText");
  if(!dot || !txt) return;
  dot.className = "sync-dot" + (state_==="online" ? " sync-online" : state_==="offline" ? " sync-offline" : "");
  txt.textContent = label;
}

// Races any promise against a timeout so a stalled network call (common on flaky/
// captive-portal mobile connections, where a request neither resolves nor rejects)
// can't hang the app forever — it just falls through to local-only mode instead.
function withTimeout(promise, ms, label){
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=> reject(new Error((label||"operation")+" timed out after "+ms+"ms")), ms);
    promise.then(v=>{ clearTimeout(t); resolve(v); }, e=>{ clearTimeout(t); reject(e); });
  });
}

async function initFirebase(){
  try{
    if(typeof firebase === "undefined") throw new Error("Firebase SDK didn't load (no internet, or CDN blocked)");
    firebase.initializeApp(firebaseConfig);
    fbDb = envWrapFirestore(firebase.firestore());
    await withTimeout(firebase.auth().signInAnonymously(), 8000, "Firebase sign-in");
    fbReady = true;
  }catch(e){
    console.error("Firebase init failed — falling back to local-only mode.", e);
    fbReady = false;
  }
}

async function loadFromFirestoreOnce(){
  if(IS_SANDBOX) await sandboxSeedIfEmpty(); // first visit: start the sandbox as a copy of production
  const settingsDoc = await fbDb.collection("trackerSettings").doc("main").get();
  const rosterSnap = await fbDb.collection("trackerRoster").get();

  if(!settingsDoc.exists && rosterSnap.empty){
    // Firestore looks uninitialized (brand new project) — seed it from whatever's
    // in this browser's local storage, since that's likely real pre-existing data.
    await loadFromLocalOnly();
    showToast("☁️ Connecting to the cloud — sending your existing data up now…");
    await pushToFirestore();
    await pushAllMonthsToFirestore();
    state.roster.forEach(a=> __fbLastSavedRoster[a.empId] = JSON.stringify(a));
    showToast("✅ Cloud database ready — this data is now shared with everyone");
    return;
  }

  state.settings = settingsDoc.exists ? Object.assign({}, DEFAULT_STATE.settings, settingsDoc.data()) : JSON.parse(JSON.stringify(DEFAULT_STATE.settings));
  if(!state.settings.metrics || !state.settings.metrics.length) state.settings.metrics = DEFAULT_STATE.settings.metrics;
  if(!state.settings.tls) state.settings.tls = [];
  if(!state.settings.dailySummary || !state.settings.dailySummary.params || !state.settings.dailySummary.params.length){
    state.settings.dailySummary = JSON.parse(JSON.stringify(DEFAULT_STATE.settings.dailySummary));
  }
  if(!state.settings.dailySummary.lobs || !state.settings.dailySummary.lobs.length){
    state.settings.dailySummary.lobs = JSON.parse(JSON.stringify(DEFAULT_STATE.settings.dailySummary.lobs));
  }
  LOB_OPTIONS.splice(0, LOB_OPTIONS.length, ...state.settings.dailySummary.lobs);
  if(!state.settings.attendanceTypes || !state.settings.attendanceTypes.length) state.settings.attendanceTypes = JSON.parse(JSON.stringify(DEFAULT_STATE.settings.attendanceTypes));
  ATTENDANCE_OPTIONS.splice(0, ATTENDANCE_OPTIONS.length, ...state.settings.attendanceTypes.map(t=>t.label));
  ensureDefaultUsers();
  await migrateUserCredentials();

  state.roster = [];
  rosterSnap.forEach(doc=>{
    const a = doc.data();
    if(a.tlName===undefined) a.tlName = "";
    if(a.lob===undefined) a.lob = "";
    state.roster.push(a);
    __fbLastSavedRoster[a.empId] = JSON.stringify(a);
  });

  const [miscSwapsDoc, miscUpdatesDoc, miscDocsDoc, miscIpaDoc, miscLeoDoc, historySnap, dailySummarySnap, qaSnap, pktSnap, pktAttSnap, kbSnap, kbFbSnap] = await Promise.all([
    fbDb.collection("trackerMisc").doc("shiftSwaps").get(),
    fbDb.collection("trackerMisc").doc("processUpdates").get(),
    fbDb.collection("trackerMisc").doc("documentationTemplates").get(),
    fbDb.collection("trackerMisc").doc("ipaDirectory").get(),
    fbDb.collection("trackerMisc").doc("leoCalls").get(),
    fbDb.collection("trackerHistory").get(),
    fbDb.collection("trackerDailySummary").get(),
    fbDb.collection("trackerQualityAudits").get(),
    fbDb.collection("trackerPkt").get(),
    fbDb.collection("trackerPktAttempts").get(),
    fbDb.collection("trackerKb").get(),
    fbDb.collection("trackerKbFeedback").get()
  ]);
  state.kbArticles = [];
  kbSnap.forEach(doc=>{ const a = doc.data(); state.kbArticles.push(a); __fbLastSavedKb[a.id] = JSON.stringify(a); });
  state.kbFeedback = [];
  kbFbSnap.forEach(doc=>{ const f = doc.data(); state.kbFeedback.push(f); __fbLastSavedKbFb[f.id] = JSON.stringify(f); });
  state.pkts = [];
  pktSnap.forEach(doc=>{ const p = doc.data(); state.pkts.push(p); __fbLastSavedPkt[p.id] = JSON.stringify(p); });
  state.pktAttempts = [];
  pktAttSnap.forEach(doc=>{ const a = doc.data(); state.pktAttempts.push(a); __fbLastSavedPktAtt[a.id] = JSON.stringify(a); });
  state.qaAudits = [];
  qaSnap.forEach(doc=>{ const q = doc.data(); state.qaAudits.push(q); __fbLastSavedQa[q.id] = JSON.stringify(q); });
  state.shiftSwaps = miscSwapsDoc.exists ? (miscSwapsDoc.data().items||[]) : [];
  state.processUpdates = miscUpdatesDoc.exists ? (miscUpdatesDoc.data().items||[]) : [];
  state.documentationTemplates = miscDocsDoc.exists ? (miscDocsDoc.data().items||[]) : [];
  state.ipaDirectory = miscIpaDoc.exists ? (miscIpaDoc.data().items||[]) : [];
  state.leoCalls = miscLeoDoc.exists ? (miscLeoDoc.data().items||[]) : [];
  __fbLastSavedSwapsJson = JSON.stringify(state.shiftSwaps);
  __fbLastSavedUpdatesJson = JSON.stringify(state.processUpdates);
  __fbLastSavedDocsJson = JSON.stringify(state.documentationTemplates);
  __fbLastSavedIpaJson = JSON.stringify(state.ipaDirectory);
  __fbLastSavedLeoCallsJson = JSON.stringify(state.leoCalls);

  // Audit log: read-only fetch, most recent first. Deliberately NOT part of the
  // diff-and-batch cycle below (__fbLastSaved* / pushToFirestore) — entries are
  // written individually via logAudit()'s direct .add() call, so there's nothing
  // here for pushToFirestore to diff or delete.
  try{
    const auditSnap = await fbDb.collection("trackerAuditLog").orderBy("at","desc").limit(300).get();
    state.auditLog = auditSnap.docs.map(d=>d.data());
  }catch(e){ console.error("Audit log fetch failed", e); }

  state.history = [];
  historySnap.forEach(doc=>{
    const h = doc.data();
    state.history.push(h);
    __fbLastSavedHistory[h.id] = JSON.stringify(h);
  });

  state.dailySummaryData = [];
  dailySummarySnap.forEach(doc=>{
    const r = doc.data();
    state.dailySummaryData.push(r);
    __fbLastSavedDailySummary[r.id] = JSON.stringify(r);
  });

  state.daily = {};
  __fbLastSavedSettingsJson = JSON.stringify(state.settings);
  await loadDailyForCurrentMonth();
}

// Merges a batch of trackerDaily docs for one month into local state, without touching
// any other month already cached locally (each login may have several months loaded at
// once — its own default month plus whichever ones it has browsed to via the period picker).
function mergeMonthDailyDocs(monthKey, docs){
  Object.keys(state.daily).forEach(k=>{ if(k.split("__")[1].startsWith(monthKey)) delete state.daily[k]; });
  docs.forEach(doc=>{
    const d = doc.data();
    Object.entries(d.records||{}).forEach(([iso,rec])=> state.daily[dKey(d.empId, iso)] = rec);
    __fbLastSavedDaily[d.empId+"__"+monthKey] = JSON.stringify(d.records||{});
  });
  __loadedMonthKeys.add(monthKey);
}
async function loadDailyForCurrentMonth(){
  const monthKey = fbMonthKey(state.settings.year, MONTHS.indexOf(state.settings.month));
  __fbDailyMonthKey = monthKey;
  const dailySnap = await fbDb.collection("trackerDaily").where("month","==",monthKey).get();
  mergeMonthDailyDocs(monthKey, dailySnap.docs);
}
// Fetches (once) whichever month/year this login's period picker is currently pointed at,
// if it isn't already cached locally. Purely a read for this browser — it never touches the
// shared trackerSettings doc, so it has no effect on any other login.
let __loadedMonthKeys = new Set();
let __loadingViewMonthKey = null;
async function ensureViewMonthLoaded(){
  const monthKey = fbMonthKey(viewYear(), viewMonthIdx());
  if(!fbReady || !fbDb) return; // local-only mode already holds every month in state.daily
  if(__loadedMonthKeys.has(monthKey)) return;
  if(__loadingViewMonthKey===monthKey) return;
  __loadingViewMonthKey = monthKey;
  try{
    const snap = await fbDb.collection("trackerDaily").where("month","==",monthKey).get();
    mergeMonthDailyDocs(monthKey, snap.docs);
    render();
  }catch(e){
    console.error("Failed to load daily data for "+monthKey, e);
  } finally {
    if(__loadingViewMonthKey===monthKey) __loadingViewMonthKey = null;
  }
}

function subscribeRealtime(){
  if(__fbUnsubRoster) __fbUnsubRoster();
  __fbUnsubRoster = fbDb.collection("trackerRoster").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return; // this is the echo of our own write — already applied locally
    const roster = [];
    snap.forEach(doc=>{ const a=doc.data(); roster.push(a); __fbLastSavedRoster[a.empId]=JSON.stringify(a); });
    state.roster = roster;
    setSyncStatus("online","☁️ Live — synced with everyone");
    render();
  }, err=>{ console.error("roster listener error", err); setSyncStatus("offline","⚠ Offline — saved in this browser, will sync when reconnected"); });

  if(__fbUnsubSettings) __fbUnsubSettings();
  __fbUnsubSettings = fbDb.collection("trackerSettings").doc("main").onSnapshot(async doc=>{
    if(doc.metadata.hasPendingWrites) return;
    if(!doc.exists) return;
    state.settings = Object.assign({}, DEFAULT_STATE.settings, doc.data());
    if(!state.settings.metrics || !state.settings.metrics.length) state.settings.metrics = DEFAULT_STATE.settings.metrics;
    if(!state.settings.tls) state.settings.tls = [];
    if(!state.settings.dailySummary || !state.settings.dailySummary.params || !state.settings.dailySummary.params.length){
      state.settings.dailySummary = JSON.parse(JSON.stringify(DEFAULT_STATE.settings.dailySummary));
    }
    if(!state.settings.dailySummary.lobs || !state.settings.dailySummary.lobs.length){
      state.settings.dailySummary.lobs = JSON.parse(JSON.stringify(DEFAULT_STATE.settings.dailySummary.lobs));
    }
    LOB_OPTIONS.splice(0, LOB_OPTIONS.length, ...state.settings.dailySummary.lobs);
    if(!state.settings.attendanceTypes || !state.settings.attendanceTypes.length) state.settings.attendanceTypes = JSON.parse(JSON.stringify(DEFAULT_STATE.settings.attendanceTypes));
    ATTENDANCE_OPTIONS.splice(0, ATTENDANCE_OPTIONS.length, ...state.settings.attendanceTypes.map(t=>t.label));
    ensureDefaultUsers();
    await migrateUserCredentials();
    __fbLastSavedSettingsJson = JSON.stringify(state.settings);
    const newMonthKey = fbMonthKey(state.settings.year, MONTHS.indexOf(state.settings.month));
    if(newMonthKey !== __fbDailyMonthKey){ await loadDailyForCurrentMonth(); subscribeDailyForCurrentMonth(); }
    setSyncStatus("online","☁️ Live — synced with everyone");
    render();
  }, err=>{ console.error("settings listener error", err); setSyncStatus("offline","⚠ Offline — saved in this browser, will sync when reconnected"); });

  if(__fbUnsubMisc) __fbUnsubMisc();
  const unsubSwaps = fbDb.collection("trackerMisc").doc("shiftSwaps").onSnapshot(doc=>{
    if(doc.metadata.hasPendingWrites || !doc.exists) return;
    state.shiftSwaps = doc.data().items||[];
    __fbLastSavedSwapsJson = JSON.stringify(state.shiftSwaps);
    render();
  }, err=>console.error("shiftSwaps listener error", err));
  const unsubUpdates = fbDb.collection("trackerMisc").doc("processUpdates").onSnapshot(doc=>{
    if(doc.metadata.hasPendingWrites || !doc.exists) return;
    state.processUpdates = doc.data().items||[];
    __fbLastSavedUpdatesJson = JSON.stringify(state.processUpdates);
    render();
  }, err=>console.error("processUpdates listener error", err));
  const unsubDocs = fbDb.collection("trackerMisc").doc("documentationTemplates").onSnapshot(doc=>{
    if(doc.metadata.hasPendingWrites || !doc.exists) return;
    state.documentationTemplates = doc.data().items||[];
    __fbLastSavedDocsJson = JSON.stringify(state.documentationTemplates);
    render();
  }, err=>console.error("documentationTemplates listener error", err));
  const unsubIpa = fbDb.collection("trackerMisc").doc("ipaDirectory").onSnapshot(doc=>{
    if(doc.metadata.hasPendingWrites || !doc.exists) return;
    state.ipaDirectory = doc.data().items||[];
    __fbLastSavedIpaJson = JSON.stringify(state.ipaDirectory);
    render();
  }, err=>console.error("ipaDirectory listener error", err));
  const unsubLeoCalls = fbDb.collection("trackerMisc").doc("leoCalls").onSnapshot(doc=>{
    if(doc.metadata.hasPendingWrites || !doc.exists) return;
    state.leoCalls = doc.data().items||[];
    __fbLastSavedLeoCallsJson = JSON.stringify(state.leoCalls);
    render();
  }, err=>console.error("leoCalls listener error", err));
  const unsubHistory = fbDb.collection("trackerHistory").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const history = [];
    snap.forEach(doc=>{ const h=doc.data(); history.push(h); __fbLastSavedHistory[h.id]=JSON.stringify(h); });
    state.history = history;
    render();
  }, err=>console.error("history listener error", err));
  const unsubQa = fbDb.collection("trackerQualityAudits").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const rows = [];
    snap.forEach(doc=>{ const q=doc.data(); rows.push(q); __fbLastSavedQa[q.id]=JSON.stringify(q); });
    state.qaAudits = rows;
    render();
  }, err=>console.error("qualityAudits listener error", err));
  // PKT: definitions + attempts. Real time — Quality sees agents' progress as they click, and agents see a
  // PKT the moment it's published. pktMergeNewer keeps a not-yet-pushed local edit (a just-clicked answer,
  // a draft autosave) instead of letting an older server copy overwrite it.
  const unsubPkt = fbDb.collection("trackerPkt").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const rows = [];
    snap.forEach(doc=>{ rows.push(doc.data()); });
    state.pkts = pktMergeNewer(state.pkts, rows);
    state.pkts.forEach(p=>{ if(rows.includes(p)) __fbLastSavedPkt[p.id] = JSON.stringify(p); });
    render();
  }, err=>console.error("pkt listener error", err));
  const unsubPktAtt = fbDb.collection("trackerPktAttempts").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const rows = [];
    snap.forEach(doc=>{ rows.push(doc.data()); });
    state.pktAttempts = pktMergeNewer(state.pktAttempts, rows);
    state.pktAttempts.forEach(a=>{ if(rows.includes(a)) __fbLastSavedPktAtt[a.id] = JSON.stringify(a); });
    // an attempt deleted elsewhere (Quality reset) is gone from rows -> forget its diff cache too
    Object.keys(__fbLastSavedPktAtt).forEach(id=>{ if(!state.pktAttempts.some(a=>a.id===id)) delete __fbLastSavedPktAtt[id]; });
    render();
  }, err=>console.error("pktAttempts listener error", err));
  // Knowledge Base: articles + feedback, real time (same newer-wins merge as PKT).
  const unsubKb = fbDb.collection("trackerKb").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const rows = []; snap.forEach(doc=>{ rows.push(doc.data()); });
    state.kbArticles = pktMergeNewer(state.kbArticles, rows);
    state.kbArticles.forEach(a=>{ if(rows.includes(a)) __fbLastSavedKb[a.id] = JSON.stringify(a); });
    render();
  }, err=>console.error("kb listener error", err));
  const unsubKbFb = fbDb.collection("trackerKbFeedback").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const rows = []; snap.forEach(doc=>{ rows.push(doc.data()); });
    state.kbFeedback = pktMergeNewer(state.kbFeedback, rows);
    state.kbFeedback.forEach(f=>{ if(rows.includes(f)) __fbLastSavedKbFb[f.id] = JSON.stringify(f); });
    Object.keys(__fbLastSavedKbFb).forEach(id=>{ if(!state.kbFeedback.some(f=>f.id===id)) delete __fbLastSavedKbFb[id]; });
    render();
  }, err=>console.error("kbFeedback listener error", err));
  const unsubDailySummary = fbDb.collection("trackerDailySummary").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const rows = [];
    snap.forEach(doc=>{ const r=doc.data(); rows.push(r); __fbLastSavedDailySummary[r.id]=JSON.stringify(r); });
    state.dailySummaryData = rows;
    render();
  }, err=>console.error("dailySummary listener error", err));
  // Read-only live view of the audit trail — never written back through this app's
  // normal save cycle (see logAudit()), so this listener only ever adds to local state.
  const unsubAudit = fbDb.collection("trackerAuditLog").orderBy("at","desc").limit(300).onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    state.auditLog = snap.docs.map(d=>d.data());
    render();
  }, err=>console.error("auditLog listener error", err));
  __fbUnsubMisc = ()=>{ unsubSwaps(); unsubUpdates(); unsubDocs(); unsubIpa(); unsubLeoCalls(); unsubHistory(); unsubQa(); unsubPkt(); unsubPktAtt(); unsubKb(); unsubKbFb(); unsubDailySummary(); unsubAudit(); };

  subscribeDailyForCurrentMonth();
}
function subscribeDailyForCurrentMonth(){
  const monthKey = fbMonthKey(state.settings.year, MONTHS.indexOf(state.settings.month));
  __fbDailyMonthKey = monthKey;
  if(__fbUnsubDaily) __fbUnsubDaily();
  __fbUnsubDaily = fbDb.collection("trackerDaily").where("month","==",monthKey).onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    mergeMonthDailyDocs(monthKey, snap.docs);
    setSyncStatus("online","☁️ Live — synced with everyone");
    render();
  }, err=>{ console.error("daily listener error", err); setSyncStatus("offline","⚠ Offline — saved in this browser, will sync when reconnected"); });
}
// Called by the Settings month/year selectors so the daily listener follows whichever month is being viewed.
async function resyncDailyForMonthChange(){
  if(!fbReady) return;
  await loadDailyForCurrentMonth();
  subscribeDailyForCurrentMonth();
  render();
}

// Settings fields that are changed ONLY through their own server-side transaction (never
// through the whole-settings push above), so concurrent edits from different people merge
// instead of overwriting each other.
const LEO_ATOMIC_SETTINGS_FIELDS = ["leoReasons", "qaErrorCategories"];

// Atomic read-modify-write of ONE settings field. mutate(currentValue) receives the SERVER's
// current value (not this browser's possibly-stale copy) and returns the new value. The field is
// written with mergeFields so it is replaced wholesale — keys removed inside a map really go away.
async function updateSettingsFieldTransactional(field, mutate){
  const ref = fbDb.collection("trackerSettings").doc("main");
  let result = null;
  await fbDb.runTransaction(async t=>{
    const snap = await t.get(ref);
    const data = snap.exists ? (snap.data()||{}) : {};
    let current = data[field];
    const empty = current == null || (Array.isArray(current) && !current.length);
    if(empty) current = state.settings[field]; // doc has none yet — start from what this browser shows
    result = mutate(JSON.parse(JSON.stringify(current == null ? (Array.isArray(state.settings[field]) ? [] : {}) : current)));
    t.set(ref, {[field]: result}, {mergeFields:[field]});
  });
  state.settings[field] = JSON.parse(JSON.stringify(result));
  return result;
}

// Atomic read-modify-write of the LEO reason master list (see leoMutateReasons in js/leo.js).
async function updateLeoReasonsTransactional(mutate){
  return updateSettingsFieldTransactional("leoReasons", mutate);
}

// For deliberate whole-settings replacements (Reset settings, Restore backup): the normal save
// no longer writes the atomic fields above, so these push their local values to the server explicitly.
async function overwriteAtomicSettingsOnServer(){
  if(!fbReady) return;
  try{
    const payload = {};
    LEO_ATOMIC_SETTINGS_FIELDS.forEach(k=>{ if(state.settings[k] !== undefined) payload[k] = JSON.parse(JSON.stringify(state.settings[k])); });
    await fbDb.collection("trackerSettings").doc("main").set(payload, {mergeFields: Object.keys(payload)});
  }catch(e){ console.error("Couldn't push atomic settings to the server", e); }
}

async function pushToFirestore(){
  if(!fbReady) return false;
  try{
    const batch = fbDb.batch();
    let opCount = 0;

    const settingsJson = JSON.stringify(state.settings);
    if(settingsJson !== __fbLastSavedSettingsJson){
      // Write every settings field EXCEPT the ones that have their own atomic update path.
      // A plain set() of the whole object let one browser's stale copy of leoReasons
      // overwrite reasons another admin/manager had just added (last write wins). mergeFields
      // replaces exactly the listed fields and leaves the rest of the server doc untouched.
      batch.set(fbDb.collection("trackerSettings").doc("main"), state.settings,
        {mergeFields: Object.keys(state.settings).filter(k=> !LEO_ATOMIC_SETTINGS_FIELDS.includes(k))});
      __fbLastSavedSettingsJson = settingsJson;
      opCount++;
    }

    const seenRosterIds = new Set();
    state.roster.forEach(a=>{
      seenRosterIds.add(a.empId);
      const json = JSON.stringify(a);
      if(__fbLastSavedRoster[a.empId] !== json){
        batch.set(fbDb.collection("trackerRoster").doc(a.empId), a);
        __fbLastSavedRoster[a.empId] = json;
        opCount++;
      }
    });
    Object.keys(__fbLastSavedRoster).forEach(empId=>{
      if(!seenRosterIds.has(empId)){
        batch.delete(fbDb.collection("trackerRoster").doc(empId));
        delete __fbLastSavedRoster[empId];
        opCount++;
      }
    });

    // Pushes every month currently held in local state.daily — not just the shared
    // "official" month — since a login may have edited a month it browsed to via its
    // own period picker. Grouped straight from the keys actually present locally,
    // so it stays correct regardless of which month(s) any given login is viewing.
    const dailyGroups = {}; // "empId|monthKey" -> {empId, monthKey, records}
    Object.keys(state.daily).forEach(k=>{
      const [empId, iso] = k.split("__");
      const monthKey = iso.slice(0,7);
      const groupKey = empId+"|"+monthKey;
      if(!dailyGroups[groupKey]) dailyGroups[groupKey] = {empId, monthKey, records:{}};
      dailyGroups[groupKey].records[iso] = state.daily[k];
    });
    Object.values(dailyGroups).forEach(g=>{
      const cacheKey = g.empId+"__"+g.monthKey;
      const json = JSON.stringify(g.records);
      if(Object.keys(g.records).length && __fbLastSavedDaily[cacheKey] !== json){
        batch.set(fbDb.collection("trackerDaily").doc(dailyDocId(g.empId, g.monthKey)), {empId:g.empId, month:g.monthKey, records:g.records});
        __fbLastSavedDaily[cacheKey] = json;
        opCount++;
      }
    });

    const swapsJson = JSON.stringify(state.shiftSwaps||[]);
    if(swapsJson !== __fbLastSavedSwapsJson){
      batch.set(fbDb.collection("trackerMisc").doc("shiftSwaps"), {items: state.shiftSwaps||[]});
      __fbLastSavedSwapsJson = swapsJson;
      opCount++;
    }
    const updatesJson = JSON.stringify(state.processUpdates||[]);
    if(updatesJson !== __fbLastSavedUpdatesJson){
      batch.set(fbDb.collection("trackerMisc").doc("processUpdates"), {items: state.processUpdates||[]});
      __fbLastSavedUpdatesJson = updatesJson;
      opCount++;
    }
    const docsJson = JSON.stringify(state.documentationTemplates||[]);
    if(docsJson !== __fbLastSavedDocsJson){
      batch.set(fbDb.collection("trackerMisc").doc("documentationTemplates"), {items: state.documentationTemplates||[]});
      __fbLastSavedDocsJson = docsJson;
      opCount++;
    }
    const ipaJson = JSON.stringify(state.ipaDirectory||[]);
    if(ipaJson !== __fbLastSavedIpaJson){
      batch.set(fbDb.collection("trackerMisc").doc("ipaDirectory"), {items: state.ipaDirectory||[]});
      __fbLastSavedIpaJson = ipaJson;
      opCount++;
    }
    const leoCallsJson = JSON.stringify(state.leoCalls||[]);
    if(leoCallsJson !== __fbLastSavedLeoCallsJson){
      batch.set(fbDb.collection("trackerMisc").doc("leoCalls"), {items: state.leoCalls||[]});
      __fbLastSavedLeoCallsJson = leoCallsJson;
      opCount++;
    }

    const seenHistoryIds = new Set();
    (state.history||[]).forEach(h=>{
      seenHistoryIds.add(h.id);
      const json = JSON.stringify(h);
      if(__fbLastSavedHistory[h.id] !== json){
        batch.set(fbDb.collection("trackerHistory").doc(h.id), h);
        __fbLastSavedHistory[h.id] = json;
        opCount++;
      }
    });
    Object.keys(__fbLastSavedHistory).forEach(id=>{
      if(!seenHistoryIds.has(id)){
        batch.delete(fbDb.collection("trackerHistory").doc(id));
        delete __fbLastSavedHistory[id];
        opCount++;
      }
    });

    const seenQaIds = new Set();
    (state.qaAudits||[]).forEach(q=>{
      seenQaIds.add(q.id);
      const json = JSON.stringify(q);
      if(__fbLastSavedQa[q.id] !== json){
        batch.set(fbDb.collection("trackerQualityAudits").doc(q.id), q);
        __fbLastSavedQa[q.id] = json;
        opCount++;
      }
    });
    Object.keys(__fbLastSavedQa).forEach(id=>{
      if(!seenQaIds.has(id)){
        batch.delete(fbDb.collection("trackerQualityAudits").doc(id));
        delete __fbLastSavedQa[id];
        opCount++;
      }
    });

    const seenKbIds = new Set();
    (state.kbArticles||[]).forEach(a=>{
      seenKbIds.add(a.id);
      const json = JSON.stringify(a);
      if(__fbLastSavedKb[a.id] !== json){ batch.set(fbDb.collection("trackerKb").doc(a.id), a); __fbLastSavedKb[a.id] = json; opCount++; }
    });
    Object.keys(__fbLastSavedKb).forEach(id=>{
      if(!seenKbIds.has(id)){ batch.delete(fbDb.collection("trackerKb").doc(id)); delete __fbLastSavedKb[id]; opCount++; }
    });
    const seenKbFbIds = new Set();
    (state.kbFeedback||[]).forEach(f=>{
      seenKbFbIds.add(f.id);
      const json = JSON.stringify(f);
      if(__fbLastSavedKbFb[f.id] !== json){ batch.set(fbDb.collection("trackerKbFeedback").doc(f.id), f); __fbLastSavedKbFb[f.id] = json; opCount++; }
    });
    Object.keys(__fbLastSavedKbFb).forEach(id=>{
      if(!seenKbFbIds.has(id)){ batch.delete(fbDb.collection("trackerKbFeedback").doc(id)); delete __fbLastSavedKbFb[id]; opCount++; }
    });

    const seenPktIds = new Set();
    (state.pkts||[]).forEach(p=>{
      seenPktIds.add(p.id);
      const json = JSON.stringify(p);
      if(__fbLastSavedPkt[p.id] !== json){ batch.set(fbDb.collection("trackerPkt").doc(p.id), p); __fbLastSavedPkt[p.id] = json; opCount++; }
    });
    Object.keys(__fbLastSavedPkt).forEach(id=>{
      if(!seenPktIds.has(id)){ batch.delete(fbDb.collection("trackerPkt").doc(id)); delete __fbLastSavedPkt[id]; opCount++; }
    });
    const seenPktAttIds = new Set();
    (state.pktAttempts||[]).forEach(a=>{
      seenPktAttIds.add(a.id);
      const json = JSON.stringify(a);
      if(__fbLastSavedPktAtt[a.id] !== json){ batch.set(fbDb.collection("trackerPktAttempts").doc(a.id), a); __fbLastSavedPktAtt[a.id] = json; opCount++; }
    });
    Object.keys(__fbLastSavedPktAtt).forEach(id=>{
      if(!seenPktAttIds.has(id)){ batch.delete(fbDb.collection("trackerPktAttempts").doc(id)); delete __fbLastSavedPktAtt[id]; opCount++; }
    });

    const seenDailySummaryIds = new Set();
    (state.dailySummaryData||[]).forEach(r=>{
      seenDailySummaryIds.add(r.id);
      const json = JSON.stringify(r);
      if(__fbLastSavedDailySummary[r.id] !== json){
        batch.set(fbDb.collection("trackerDailySummary").doc(r.id), r);
        __fbLastSavedDailySummary[r.id] = json;
        opCount++;
      }
    });
    Object.keys(__fbLastSavedDailySummary).forEach(id=>{
      if(!seenDailySummaryIds.has(id)){
        batch.delete(fbDb.collection("trackerDailySummary").doc(id));
        delete __fbLastSavedDailySummary[id];
        opCount++;
      }
    });

    if(opCount>0) await batch.commit();
    setSyncStatus("online","☁️ Live — synced with everyone");
    return true;
  }catch(e){
    console.error("Firestore save failed", e);
    setSyncStatus("offline","⚠ Offline — saved in this browser, will sync when reconnected");
    return false;
  }
}
// ---- LEO auto-escalation: atomic reassignment of untouched sup calls ----
// Same reasoning as createLeoCallTransactional() below: several supervisors'
// browsers run the escalation check, so the read-plan-write must be a single
// transaction, otherwise two of them could escalate the same call twice (it
// would skip a supervisor) or overwrite each other's edits to trackerMisc/leoCalls.
// The actual decision logic lives in planLeoEscalations() (js/leo.js) so the
// online and offline paths can never disagree. Resolves with the plan
// ({items, newPointer, escalated, changed}) or null when nothing was due.
async function escalateOverdueLeoCallsTransactional(){
  const settingsRef = fbDb.collection("trackerSettings").doc("main");
  const leoCallsRef = fbDb.collection("trackerMisc").doc("leoCalls");
  const plan = await fbDb.runTransaction(async (t)=>{
    const [settingsSnap, callsSnap] = await Promise.all([t.get(settingsRef), t.get(leoCallsRef)]);
    const s = settingsSnap.exists ? (settingsSnap.data()||{}) : {};
    const items = (callsSnap.exists && Array.isArray(callsSnap.data().items)) ? callsSnap.data().items : [];
    const p = planLeoEscalations(items, {
      users: s.users || [],
      supervisors: s.leoSupervisors || [],
      pointer: s.leoNextSupervisorIndex,
      enabled: s.leoEscalationEnabled !== false,
      hours: s.leoEscalationHours
    }, Date.now());
    if(!p || !p.changed) return null;
    t.set(leoCallsRef, {items: p.items}, {merge:true});
    if(p.newPointer !== p.oldPointer) t.set(settingsRef, {leoNextSupervisorIndex: p.newPointer}, {merge:true});
    return p;
  });
  if(!plan) return null;
  state.leoCalls = plan.items;
  state.settings.leoNextSupervisorIndex = plan.newPointer;
  __fbLastSavedLeoCallsJson = JSON.stringify(state.leoCalls);
  __fbLastSavedSettingsJson = JSON.stringify(state.settings);
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
  return plan;
}

// ---- LEO sup-call creation: atomic round-robin assignment ----
// The regular saveState()/pushToFirestore() path (above) is a plain "diff the
// local copy, overwrite the doc" sync — fine for most screens, but wrong for
// something like the LEO round-robin pointer, where two people can create a
// sup call within the same debounce/network window. Both would read the same
// leoNextSupervisorIndex from their own local state, assign the same
// supervisor, and whichever push lands last would win — silently dropping the
// loser's new call and/or breaking the rotation (same supervisor gets two
// calls in a row while the next one in line gets skipped).
//
// This function fixes that by doing the read-assign-append-write as a single
// Firestore transaction across both trackerSettings/main (the supervisor list
// + pointer) and trackerMisc/leoCalls (the calls array). Firestore re-runs the
// whole transaction automatically if either document changed since it was
// read, so two concurrent callers can never compute the same assignment or
// clobber each other's new call — one simply gets retried against the
// other's already-committed result.
//
// callFields is the new call's data MINUS assignedTo/assignedToUsername (this fills those in).
// Resolves with the finished call object; throws if it can't be committed
// (e.g. connection drops mid-transaction) — callers should surface that as a
// failure rather than quietly falling back to a local-only assignment, since
// that fallback is exactly the race this replaces.
async function createLeoCallTransactional(callFields){
  const settingsRef = fbDb.collection("trackerSettings").doc("main");
  const leoCallsRef = fbDb.collection("trackerMisc").doc("leoCalls");
  const result = await fbDb.runTransaction(async (t)=>{
    const [settingsSnap, callsSnap] = await Promise.all([t.get(settingsRef), t.get(leoCallsRef)]);
    const settingsData = settingsSnap.exists ? (settingsSnap.data()||{}) : {};
    // leoSupervisors holds usernames, not free text — resolve against the
    // *transactionally-read* users list (same trackerSettings/main doc) so an
    // account disabled, deleted, or moved off a canManageLEO() role a
    // moment ago is never assigned a call. See eligibleLeoSupervisorAccounts()
    // in js/leo.js for the equivalent offline-mode check — this filter MUST
    // stay in lockstep with it, so it's written the same way (exclude
    // client/wfm) rather than as a whitelist of allowed roles. A whitelist
    // silently drops any newly-added role (this is exactly how SME ended up
    // never being assigned while still appearing in the rotation UI).
    const eligibleByUsername = new Map((settingsData.users||[])
      .filter(u=> u.enabled!==false && u.role!=="client" && u.role!=="wfm" && u.role!=="quality")
      .map(u=>[u.username, u]));
    const sups = (settingsData.leoSupervisors || []).filter(un=> eligibleByUsername.has(un));
    let pointer = settingsData.leoNextSupervisorIndex;
    if(pointer==null) pointer = 0;
    let assignedTo = "", assignedToUsername = "";
    let newPointer = pointer;
    if(sups.length){
      const idx = pointer % sups.length;
      assignedToUsername = sups[idx];
      assignedTo = eligibleByUsername.get(assignedToUsername).name;
      newPointer = (idx + 1) % sups.length;
    }
    const items = (callsSnap.exists && Array.isArray(callsSnap.data().items)) ? callsSnap.data().items.slice() : [];
    const newCall = {...callFields, assignedTo, assignedToUsername, assignedAt: callFields.createdAt}; // assignedAt starts the auto-escalation clock
    items.push(newCall);
    // merge:true on the settings doc so this only ever touches the pointer
    // field, never clobbering leoSupervisors/leoReasons/etc. an Admin might be
    // editing concurrently on another screen.
    t.set(settingsRef, {leoNextSupervisorIndex: newPointer}, {merge:true});
    t.set(leoCallsRef, {items}, {merge:true});
    return {newCall, newPointer};
  });
  // Mirror the authoritative result into local state right away rather than
  // waiting for the onSnapshot listeners to round-trip back, and refresh the
  // "last pushed" diff caches so the next unrelated debounced saveState() call
  // sees no diff here and doesn't re-push a stale local copy over what the
  // transaction just committed.
  if(!state.leoCalls) state.leoCalls = [];
  state.leoCalls.push(result.newCall);
  state.settings.leoNextSupervisorIndex = result.newPointer;
  __fbLastSavedLeoCallsJson = JSON.stringify(state.leoCalls);
  __fbLastSavedSettingsJson = JSON.stringify(state.settings);
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
  return result.newCall;
}

// One-time migration path only: pushes EVERY month found in local state.daily, not just the
// currently-viewed one (ongoing saves stay scoped to the current month for write-quota efficiency).
async function pushAllMonthsToFirestore(){
  const byAgentMonth = {};
  Object.keys(state.daily).forEach(k=>{
    const [empId, iso] = k.split("__");
    const monthKey = iso.slice(0,7);
    const groupKey = empId+"|"+monthKey;
    if(!byAgentMonth[groupKey]) byAgentMonth[groupKey] = {empId, month:monthKey, records:{}};
    byAgentMonth[groupKey].records[iso] = state.daily[k];
  });
  const entries = Object.values(byAgentMonth);
  for(let i=0; i<entries.length; i+=450){
    const chunk = entries.slice(i, i+450);
    const batch = fbDb.batch();
    chunk.forEach(e=> batch.set(fbDb.collection("trackerDaily").doc(dailyDocId(e.empId, e.month)), e));
    await batch.commit();
  }
}

// Deletes every document in a Firestore collection, chunked to stay under the
// 500-operation batch limit. Used for a full wipe (e.g. clearing demo data),
// where the normal diff-based pushToFirestore() isn't enough — it only knows
// about documents it has seen this session (and for trackerDaily, only the
// currently-viewed month), so stale data from other months/sessions would
// otherwise be left behind on the server.
async function wipeFirestoreCollection(collectionName){
  if(!fbReady) return;
  const snap = await fbDb.collection(collectionName).get();
  const docs = snap.docs;
  for(let i=0; i<docs.length; i+=450){
    const batch = fbDb.batch();
    docs.slice(i, i+450).forEach(d=> batch.delete(d.ref));
    await batch.commit();
  }
}
// Clears agents, daily entries, history, process updates, and shift swaps —
// both locally and (if connected) in the shared Firestore database — while
// leaving settings (branding, KPI metrics, leave types, accounts) untouched.
// Deliberately does NOT touch trackerAuditLog/state.auditLog: a "clear demo
// data" convenience button being able to wipe the audit trail would defeat
// the point of having one.
async function clearDemoDataEverywhere(){
  state.roster = [];
  state.daily = {};
  state.history = [];
  state.shiftSwaps = [];
  state.processUpdates = [];
  state.documentationTemplates = [];
  state.dailySummaryData = [];
  state.leoCalls = [];
  __fbLastSavedRoster = {};
  __fbLastSavedDaily = {};
  __fbLastSavedHistory = {};
  __fbLastSavedSwapsJson = "";
  __fbLastSavedUpdatesJson = "";
  __fbLastSavedDocsJson = "";
  __fbLastSavedLeoCallsJson = "";
  __fbLastSavedDailySummary = {};

  if(fbReady){
    await wipeFirestoreCollection("trackerRoster");
    await wipeFirestoreCollection("trackerDaily");
    await wipeFirestoreCollection("trackerHistory");
    await wipeFirestoreCollection("trackerDailySummary");
    await fbDb.collection("trackerMisc").doc("shiftSwaps").set({items:[]});
    await fbDb.collection("trackerMisc").doc("processUpdates").set({items:[]});
    await fbDb.collection("trackerMisc").doc("documentationTemplates").set({items:[]});
    await fbDb.collection("trackerMisc").doc("leoCalls").set({items:[]});
  }
  saveState();
}

async function loadState(){
  setSyncStatus("connecting","☁️ Connecting...");
  await initFirebase();
  if(fbReady){
    try{
      await withTimeout(loadFromFirestoreOnce(), 12000, "Firestore load");
      subscribeRealtime();
      setSyncStatus("online","☁️ Live — synced with everyone");
    }catch(e){
      console.error("Firestore load failed, falling back to local-only mode.", e);
      if(IS_SANDBOX && e && e.code==="permission-denied") showToast("⚠ Sandbox blocked by Firestore rules — add the rule from firestore.rules.sandbox-snippet.txt");
      fbReady = false;
      await loadFromLocalOnly();
      setSyncStatus("offline","⚠ Offline — saved in this browser, will sync when reconnected");
    }
  } else {
    await loadFromLocalOnly();
    setSyncStatus("offline","⚠ Offline — saved in this browser, will sync when reconnected");
  }
  ensureDefaultUsers();
  await migrateUserCredentials();
  restoreSession();
  dashSelectedDate = todayIso();
  applyTheme();
  render();
  if(!currentUser) showLoginModal();
  document.body.classList.remove("app-loading");
}
let __saveStateResolvers = []; // queued resolvers — same debounce batch resolves together
function saveState(){
  return new Promise(resolve=>{
    __saveStateResolvers.push(resolve);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async ()=>{
      saveTimer = null;
      const resolvers = __saveStateResolvers; __saveStateResolvers = [];
      // Always keep a local copy too, regardless of cloud status — cheap insurance.
      try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
      if(fbReady){
        const ok = await pushToFirestore();
        if(!ok) showToast("⚠ Cloud save failed — saved locally only. Check your connection; this device's edits will sync once it's back.");
      } else {
        const ok = await persistSave(JSON.stringify(state));
        if(!ok) showToast("⚠ Save failed — use Settings → Download backup so you don't lose today's entries");
      }
      resolvers.forEach(r=>r());
    }, 250);
  });
}
// If the page/tab closes while a debounced save is still pending, flush it
// immediately (best-effort) instead of losing the last edit to the 250ms window.
window.addEventListener("beforeunload", ()=>{
  if(!saveTimer) return;
  clearTimeout(saveTimer);
  const json = JSON.stringify(state);
  try{ localStorage.setItem(STORAGE_KEY, json); }catch(e){}
  if(hasWindowStorage){ try{ window.storage.set(STORAGE_KEY, json, false); }catch(e){} }
  if(fbReady){ try{ pushToFirestore(); }catch(e){} }
});
function showToast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._tm);
  const duration = Math.min(7000, Math.max(2600, msg.length * 45));
  showToast._tm = setTimeout(()=>t.classList.remove("show"), duration);
}
function pwFieldHtml(id, placeholder, opts){
  opts = opts || {};
  const auto = opts.autocomplete ? ` autocomplete="${opts.autocomplete}"` : "";
  const inputStyle = opts.inputStyle || "";
  return `<div class="pw-field-wrap" style="${opts.wrapStyle||''}">
    <input type="password" id="${id}" placeholder="${esc(placeholder||'')}"${auto} style="${inputStyle}">
    <button type="button" class="pw-toggle-btn" data-target="${id}" title="Show password">👁</button>
  </div>`;
}
document.addEventListener("click", e=>{
  const btn = e.target.closest(".pw-toggle-btn");
  if(!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if(!input) return;
  if(input.type === "password"){ input.type = "text"; btn.textContent = "🙈"; btn.title = "Hide password"; }
  else { input.type = "password"; btn.textContent = "👁"; btn.title = "Show password"; }
});
