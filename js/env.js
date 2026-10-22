/* ---------------- Environments: Production vs Sandbox ----------------
   Production = the live data (Firestore collections named trackerXxx).
   Sandbox    = a completely separate copy of every collection (sbx_trackerXxx), plus its own
                browser-side cache and login session. Nothing done in Sandbox can touch Production
                unless an Admin explicitly uses "Push to production", which copies only the
                sections they tick, after downloading a backup of what it is about to replace.

   How it works: every Firestore call in the app goes through `fbDb.collection(name)`. After sign-in,
   initFirebase() swaps `fbDb` for a thin wrapper that prefixes the collection name in Sandbox, so the
   rest of the code is unaware which environment it is in. `fbRaw` is the un-prefixed handle used only
   by the copy/push helpers below.

   Loaded FIRST (before state.js) because STORAGE_KEY / SESSION_KEY depend on ENV. */

const ENV = (function(){
  try{
    const q = new URLSearchParams(location.search).get("env");
    if(q==="sandbox" || q==="production") localStorage.setItem("a360_env", q);
    return localStorage.getItem("a360_env")==="sandbox" ? "sandbox" : "production";
  }catch(e){ return "production"; }
})();
const IS_SANDBOX = ENV === "sandbox";
const ENV_PREFIX = IS_SANDBOX ? "sbx_" : "";
let fbRaw = null;

function envWrapFirestore(raw){
  fbRaw = raw;
  return {
    collection: name => raw.collection(ENV_PREFIX + name),
    batch: () => raw.batch()
  };
}
function switchEnv(target){
  try{ localStorage.setItem("a360_env", target); }catch(e){}
  const u = new URL(location.href); u.searchParams.delete("env");
  location.href = u.toString();
}

/* What can be copied / pushed. `col` = whole collection, `misc` = one document inside trackerMisc. */
const ENV_SECTIONS = [
  {key:"settings",       label:"Settings, KPIs, LOBs & login accounts", col:"trackerSettings", warn:"includes user accounts and passwords"},
  {key:"roster",         label:"Agent roster",                          col:"trackerRoster"},
  {key:"daily",          label:"Daily entries (all months)",            col:"trackerDaily"},
  {key:"history",        label:"History",                               col:"trackerHistory"},
  {key:"dailySummary",   label:"Daily summary",                         col:"trackerDailySummary"},
  {key:"qa",             label:"Quality audits",                        col:"trackerQualityAudits"},
  {key:"pkt",            label:"PKTs (knowledge checks)",               col:"trackerPkt"},
  {key:"kb",             label:"Knowledge Base articles",                col:"trackerKb"},
  {key:"kbFeedback",     label:"Knowledge Base feedback & requests",    col:"trackerKbFeedback"},
  {key:"pktAttempts",    label:"PKT attempts & scores",                 col:"trackerPktAttempts"},
  {key:"processUpdates", label:"Process updates",                       misc:"processUpdates"},
  {key:"docTemplates",   label:"Documentation templates",               misc:"documentationTemplates"},
  {key:"shiftSwaps",     label:"Shift swaps",                           misc:"shiftSwaps"},
  {key:"ipa",            label:"IPA directory",                         misc:"ipaDirectory"},
  {key:"leoCalls",       label:"LEO calls",                             misc:"leoCalls"}
  // trackerAuditLog is deliberately never copied or pushed — it is a record of what happened in each environment.
];

async function envReadSection(prefix, sec){
  const out = {};
  if(sec.col){
    const snap = await fbRaw.collection(prefix+sec.col).get();
    snap.forEach(d=>{ out[d.id] = d.data(); });
  } else {
    const d = await fbRaw.collection(prefix+"trackerMisc").doc(sec.misc).get();
    if(d.exists) out[sec.misc] = d.data();
  }
  return out;
}
// Make the target section exactly equal `map` (adds, overwrites and removes).
async function envWriteSection(prefix, sec, map){
  if(sec.misc){
    const ref = fbRaw.collection(prefix+"trackerMisc").doc(sec.misc);
    if(map[sec.misc]) await ref.set(map[sec.misc]); else await ref.delete();
    return;
  }
  const colRef = fbRaw.collection(prefix+sec.col);
  const existing = await colRef.get();
  const ops = [];
  existing.forEach(d=>{ if(!(d.id in map)) ops.push({del:d.ref}); });
  Object.keys(map).forEach(id=> ops.push({set:colRef.doc(id), data:map[id]}));
  for(let i=0;i<ops.length;i+=400){
    const b = fbRaw.batch();
    ops.slice(i,i+400).forEach(o=>{ if(o.del) b.delete(o.del); else b.set(o.set, o.data); });
    await b.commit();
  }
}
function envCount(sec, map){
  if(sec.misc){ const d = map[sec.misc]; return d && Array.isArray(d.items) ? d.items.length : (d ? 1 : 0); }
  return Object.keys(map).length;
}
function envStable(v){
  if(Array.isArray(v)) return v.map(envStable);
  if(v && typeof v==="object"){
    if(typeof v.toMillis==="function") return {__ts:v.toMillis()};
    const o = {}; Object.keys(v).sort().forEach(k=>{ o[k] = envStable(v[k]); }); return o;
  }
  return v;
}
function envFingerprint(map){ return JSON.stringify(envStable(map)); }

/* Sandbox first use (nothing there yet): start it as a copy of Production. */
async function sandboxSeedIfEmpty(){
  const s = await fbRaw.collection("sbx_trackerSettings").doc("main").get();
  if(s.exists) return;
  const prodSettings = await fbRaw.collection("trackerSettings").doc("main").get();
  if(!prodSettings.exists) return; // production is empty too — let the normal first-run seeding happen
  showToast("🧪 Setting up your sandbox — copying production data…");
  for(const sec of ENV_SECTIONS) await envWriteSection("sbx_", sec, await envReadSection("", sec));
}

async function sandboxResetFromProduction(){
  if(!IS_SANDBOX || !fbReady) return;
  if(!isFullAdmin()){ showToast("Only an Admin can reset the sandbox"); return; }
  if(!confirm("Reset the sandbox?\n\nEverything currently in the sandbox is replaced with a fresh copy of production. Production is not changed.")) return;
  showToast("⏳ Copying production into the sandbox…");
  try{
    for(const sec of ENV_SECTIONS) await envWriteSection("sbx_", sec, await envReadSection("", sec));
    try{ localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(SESSION_KEY); }catch(e){}
    showToast("✅ Sandbox reset — reloading…");
    setTimeout(()=>location.reload(), 900);
  }catch(e){ console.error(e); showToast("⚠ Reset failed: "+(e.message||e)); }
}

/* ---------- Push to production ---------- */
async function openPushToProductionModal(){
  if(!IS_SANDBOX || !fbReady){ showToast("Open the sandbox (while online) to push changes"); return; }
  if(!isFullAdmin()){ showToast("Only an Admin can push to production"); return; }
  saveState();
  const overlay = showModal(`
    <div class="modal-title">🚀 Push sandbox changes to production</div>
    <div class="env-warn">Pushing <b>replaces</b> the chosen section in production with the sandbox version. Anything entered in production for that section since the sandbox was copied (agents' daily entries, new updates, etc.) is overwritten. Tick only what you really want to go live.</div>
    <div id="pushBody" style="margin:12px 0;font-size:12.5px;color:var(--text-muted);">Comparing sandbox with production…</div>
    <div class="modal-actions"><button class="btn btn-ghost" id="pushCancel">Close</button></div>`);
  overlay.querySelector("#pushCancel").addEventListener("click", closeModal);
  // Give the live listeners a moment to flush the latest sandbox edits to Firestore first.
  await new Promise(r=>setTimeout(r, 1200));
  let rows;
  try{
    rows = [];
    for(const sec of ENV_SECTIONS){
      const [sb, pr] = await Promise.all([envReadSection("sbx_", sec), envReadSection("", sec)]);
      rows.push({sec, sb, pr, same: envFingerprint(sb)===envFingerprint(pr)});
    }
  }catch(e){
    overlay.querySelector("#pushBody").textContent = "⚠ Could not read the data: "+(e.message||e);
    return;
  }
  const body = overlay.querySelector("#pushBody");
  body.style.color = "var(--text)";
  body.innerHTML = `
    <table class="mini-table" style="width:100%;">
      <thead><tr><th></th><th>Section</th><th class="num">Sandbox</th><th class="num">Production</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r,i)=>`<tr>
        <td><input type="checkbox" class="push-chk" data-i="${i}" ${r.same?"disabled":""}></td>
        <td>${esc(r.sec.label)}${r.sec.warn?` <span class="env-note">⚠ ${esc(r.sec.warn)}</span>`:""}</td>
        <td class="num">${envCount(r.sec,r.sb)}</td><td class="num">${envCount(r.sec,r.pr)}</td>
        <td>${r.same?`<span style="color:var(--text-dim);">Identical</span>`:`<span class="badge badge-yellow">Differs</span>`}</td></tr>`).join("")}</tbody>
    </table>
    <div class="help-note" style="margin-top:10px;">"Differs" can also just mean production got newer live data. A backup of the production sections you tick downloads automatically before anything is replaced.</div>
    <div class="field" style="margin-top:12px;"><label>Type <b>PUSH</b> to confirm</label><input type="text" id="pushConfirm" autocomplete="off" style="width:140px;"></div>
    <div id="pushMsg" style="font-size:12px;margin-bottom:6px;"></div>`;
  const actions = overlay.querySelector(".modal-actions");
  actions.insertAdjacentHTML("beforeend", `<button class="btn btn-accent" id="pushGo" disabled>Push selected to production</button>`);
  const go = actions.querySelector("#pushGo"), conf = body.querySelector("#pushConfirm");
  const picked = ()=> Array.from(body.querySelectorAll(".push-chk:checked")).map(c=>rows[+c.dataset.i]);
  const refresh = ()=>{ go.disabled = !(conf.value.trim()==="PUSH" && picked().length); };
  body.addEventListener("change", refresh); conf.addEventListener("input", refresh);
  go.addEventListener("click", async ()=>{
    const sel = picked(); if(!sel.length) return;
    go.disabled = true; conf.disabled = true;
    const msg = body.querySelector("#pushMsg");
    try{
      msg.textContent = "Downloading production backup…";
      const backup = {takenAt:new Date().toISOString(), by:(currentUser&&currentUser.name)||"", note:"Production data that was replaced by a sandbox push", sections:{}};
      sel.forEach(r=>{ backup.sections[r.sec.key] = r.pr; });
      const blob = new Blob([JSON.stringify(backup)], {type:"application/json"});
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "production-backup-before-push-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise(r=>setTimeout(r, 600));
      for(const r of sel){ msg.textContent = "Pushing “"+r.sec.label+"”…"; await envWriteSection("", r.sec, r.sb); }
      try{
        await fbRaw.collection("trackerAuditLog").add({
          id:"aud"+Date.now()+Math.random().toString(36).slice(2,7), at:new Date().toISOString(),
          actorName:(currentUser&&currentUser.name)||"Unknown", actorRole:currentRoleLabel(),
          action:"env_push", summary:"Pushed sandbox to production: "+sel.map(r=>r.sec.label).join(", "),
          empId:"", before:null, after:{sections:sel.map(r=>r.sec.key)},
          serverAt:firebase.firestore.FieldValue.serverTimestamp()
        });
      }catch(e){ console.warn("Push audit entry failed", e); }
      msg.style.color = "var(--green, #3caa5a)";
      msg.textContent = "✅ Pushed "+sel.length+" section"+(sel.length>1?"s":"")+" to production. It is live for everyone now.";
      showToast("✅ Pushed to production");
    }catch(e){
      console.error(e); msg.style.color = "var(--red, #dc3c3c)";
      msg.textContent = "⚠ Push stopped part-way: "+(e.message||e)+". The backup file that downloaded has the original production data.";
    }
  });
}

/* ---------- Banner + switchers ---------- */
function envInitUi(){
  if(IS_SANDBOX){
    document.body.classList.add("env-sandbox");
    document.title = "[SANDBOX] " + document.title;
    const pill = document.createElement("div");
    pill.id = "envPill"; pill.className = "env-pill";
    pill.innerHTML = `<span class="env-pill-tag">🧪 SANDBOX</span><span class="env-pill-txt">Demo data — changes here don't affect production</span>
      <span class="env-pill-admin" style="display:none;">
        <button type="button" class="btn btn-sm" id="envPushBtn">🚀 Push to production</button>
        <button type="button" class="btn btn-ghost btn-sm" id="envResetBtn">↺ Reset from production</button>
      </span>
      <button type="button" class="btn btn-ghost btn-sm" id="envExitBtn">Go to production →</button>`;
    document.body.appendChild(pill);
    pill.querySelector("#envPushBtn").addEventListener("click", openPushToProductionModal);
    pill.querySelector("#envResetBtn").addEventListener("click", sandboxResetFromProduction);
    pill.querySelector("#envExitBtn").addEventListener("click", ()=> switchEnv("production"));
  }
  setInterval(()=>{
    const admin = typeof isFullAdmin==="function" && isFullAdmin();
    const grp = document.querySelector("#envPill .env-pill-admin");
    if(grp) grp.style.display = admin ? "inline-flex" : "none";
    // Sidebar switch: only full admins in production get a way into the sandbox.
    const foot = document.querySelector(".sidebar-foot");
    let b = document.getElementById("envSwitchBtn");
    if(!IS_SANDBOX && admin && foot && !b){
      b = document.createElement("button");
      b.id = "envSwitchBtn"; b.className = "btn btn-ghost btn-sm"; b.type = "button";
      b.style.cssText = "width:100%;justify-content:center;margin-bottom:6px;";
      b.textContent = "🧪 Open Sandbox";
      b.addEventListener("click", ()=> switchEnv("sandbox"));
      foot.insertBefore(b, foot.firstChild);
    } else if(b && (!admin || IS_SANDBOX)) b.remove();
  }, 1500);
}
document.addEventListener("DOMContentLoaded", envInitUi);
