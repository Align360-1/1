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
let __fbDailyMonthKey = null;
let __fbLastSavedRoster = {};   // empId -> JSON string, for diffing what actually needs writing
let __fbLastSavedDaily = {};    // empId -> JSON string (that agent's records for the currently-synced month)
let __fbLastSavedSettingsJson = null;
let __fbLastSavedSwapsJson = null;
let __fbLastSavedUpdatesJson = null;
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
    fbDb = firebase.firestore();
    await withTimeout(firebase.auth().signInAnonymously(), 8000, "Firebase sign-in");
    fbReady = true;
  }catch(e){
    console.error("Firebase init failed — falling back to local-only mode.", e);
    fbReady = false;
  }
}

async function loadFromFirestoreOnce(){
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

  const [miscSwapsDoc, miscUpdatesDoc, historySnap, dailySummarySnap] = await Promise.all([
    fbDb.collection("trackerMisc").doc("shiftSwaps").get(),
    fbDb.collection("trackerMisc").doc("processUpdates").get(),
    fbDb.collection("trackerHistory").get(),
    fbDb.collection("trackerDailySummary").get()
  ]);
  state.shiftSwaps = miscSwapsDoc.exists ? (miscSwapsDoc.data().items||[]) : [];
  state.processUpdates = miscUpdatesDoc.exists ? (miscUpdatesDoc.data().items||[]) : [];
  __fbLastSavedSwapsJson = JSON.stringify(state.shiftSwaps);
  __fbLastSavedUpdatesJson = JSON.stringify(state.processUpdates);

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
  const unsubHistory = fbDb.collection("trackerHistory").onSnapshot(snap=>{
    if(snap.metadata.hasPendingWrites) return;
    const history = [];
    snap.forEach(doc=>{ const h=doc.data(); history.push(h); __fbLastSavedHistory[h.id]=JSON.stringify(h); });
    state.history = history;
    render();
  }, err=>console.error("history listener error", err));
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
  __fbUnsubMisc = ()=>{ unsubSwaps(); unsubUpdates(); unsubHistory(); unsubDailySummary(); unsubAudit(); };

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

async function pushToFirestore(){
  if(!fbReady) return false;
  try{
    const batch = fbDb.batch();
    let opCount = 0;

    const settingsJson = JSON.stringify(state.settings);
    if(settingsJson !== __fbLastSavedSettingsJson){
      batch.set(fbDb.collection("trackerSettings").doc("main"), state.settings);
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
  state.dailySummaryData = [];
  __fbLastSavedRoster = {};
  __fbLastSavedDaily = {};
  __fbLastSavedHistory = {};
  __fbLastSavedSwapsJson = "";
  __fbLastSavedUpdatesJson = "";
  __fbLastSavedDailySummary = {};

  if(fbReady){
    await wipeFirestoreCollection("trackerRoster");
    await wipeFirestoreCollection("trackerDaily");
    await wipeFirestoreCollection("trackerHistory");
    await wipeFirestoreCollection("trackerDailySummary");
    await fbDb.collection("trackerMisc").doc("shiftSwaps").set({items:[]});
    await fbDb.collection("trackerMisc").doc("processUpdates").set({items:[]});
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
