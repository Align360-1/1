/* =========================================================
   PKT — weekly Product Knowledge Test (knowledge check)
   ---------------------------------------------------------
   Who does what
   - Quality (and Admin/Manager) CREATE and publish PKTs, watch results live, and can reset /
     finalize / re-sync an agent's attempt.  See js/pkt-editor.js (Kahoot-style creator).
   - Agents TAKE a published PKT (Kahoot-style, one question at a time, one timer for the
     whole PKT — no per-question limit).  See js/pkt-play.js.
   - TL / SME / Trainer can watch results (TL + SME only for their own team).

   Data (both synced in real time, one Firestore doc each — same pattern as qaAudits):
     state.pkts          -> trackerPkt           {id,title,lob,status:"draft"|"live"|"closed",durationMins,
                                                  passMark,dueDate,shuffleQuestions,shuffleOptions,
                                                  showAnswers,questions:[{id,text,image,options:[{id,text}],correctId}],
                                                  createdBy,createdByUsername,createdAt,publishedAt,updatedAt}
     state.pktAttempts   -> trackerPktAttempts{id:`${pktId}__${empId}`,pktId,empId,agentName,tlName,lob,
                                                  status:"in_progress"|"submitted",startedAt,submittedAt,
                                                  answers:{[qid]:optId},qOrder,oOrder,correct,total,score,
                                                  passed,timeTakenSec,autoSubmitted,syncStatus,syncedIso,updatedAt}

   "Linked with the agent and the dashboard": when an attempt is submitted, the score is written
   into that agent's Daily Data "PKT Score (%)" field (state.daily[..].pkt) — the same field the
   Dashboard, Month History and Excel exports already read. The Dashboard also gets a live PKT card.
   Daily Data allows ONE PKT score per agent per week (see pktLockedForDate); if the agent already
   has one that week the attempt is kept, flagged "week already scored", and Quality can override.
   ========================================================= */

const PKT_COLORS = [
  {c:"#E21B3C", s:"▲", n:"Red"},
  {c:"#1368CE", s:"◆", n:"Blue"},
  {c:"#D89E00", s:"●", n:"Gold"},
  {c:"#26890C", s:"■", n:"Green"},
  {c:"#864CBF", s:"★", n:"Purple"},
  {c:"#0A8F8F", s:"⬢", n:"Teal"}
];
const PKT_MAX_OPTIONS = 6, PKT_MIN_OPTIONS = 2;
const PKT_DOC_LIMIT = 900 * 1024; // Firestore caps a doc at 1 MiB — images are inlined, so keep a safety margin

let pktView = "home";                 // "home" | "results" | "editor" | "quiz" | "result"
let pktResultsId = null;              // PKT open in the Results view
let pktResFilter = {tl:"all", lob:"all", status:"all", q:""};
let pktResultAttId = null;            // attempt shown on the agent's result screen

/* ---------------- Small helpers ---------------- */
function pktNewId(prefix){ return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function pktAll(){ return (state.pkts||[]).slice().sort((a,b)=> String(b.createdAt||"").localeCompare(String(a.createdAt||""))); }
function pktById(id){ return (state.pkts||[]).find(p=>p.id===id); }
function pktAttId(pktId, empId){ return pktId + "__" + empId; }
function pktAttempt(pktId, empId){ return (state.pktAttempts||[]).find(a=>a.id===pktAttId(pktId, empId)); }
function pktAttemptsOf(pktId){ return (state.pktAttempts||[]).filter(a=>a.pktId===pktId); }
function pktIsDue(p){ return !!p.dueDate && todayIso() > p.dueDate; }
function pktIsOpen(p){ return p.status==="live" && !pktIsDue(p); }
function pktPct(x){ return (Math.round(Number(x)*10)/10).toFixed(1).replace(/\.0$/,"") + "%"; }
function pktFmtSec(s){ s = Math.max(0, Math.round(s)); return pad2(Math.floor(s/60)) + ":" + pad2(s%60); }
function pktFmtDateTime(iso){
  if(!iso) return "—";
  const d = new Date(iso); if(isNaN(d)) return "—";
  return fmtDate(isoFromJSDate(d)) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
function pktSafeImg(src){ return (typeof src==="string" && /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(src)) ? src : ""; }
function pktMetric(){ return (state.settings.metrics||[]).find(m=>m.field==="pkt") || {direction:"higher", target:90, threshold:80}; }
function pktScoreBadge(score){
  if(score===null || score===undefined || score==="") return `<span style="color:var(--text-dim);">—</span>`;
  const c = metricColor(pktMetric(), score) || "gray";
  return `<span class="badge badge-${c}">${pktPct(score)}</span>`;
}
function pktShuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1; i>0; i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}
function pktMyAgent(){ return isAgent() ? state.roster.find(a=>a.empId===currentUser.empId) : null; }
function pktLobMatches(p, agent){ return !p.lob || p.lob === (agent && agent.lob || ""); }
// Agents the viewer is allowed to see for this PKT (TL/SME -> own team; Quality/Admin/Trainer -> everyone).
function pktAudience(p){
  return scopedRoster().filter(a=> a.status==="Active" && pktLobMatches(p, a));
}
function pktRemainingMs(att, p){
  return (p.durationMins||0)*60000 - (Date.now() - Date.parse(att.startedAt));
}
// Unsubmitted PKTs an agent can still take (drives the sidebar badge).
function pktPendingCount(){
  const me = pktMyAgent(); if(!me) return 0;
  return (state.pkts||[]).filter(p=> pktIsOpen(p) && pktLobMatches(p, me) && !((pktAttempt(p.id, me.empId)||{}).status==="submitted")).length;
}

/* Newer-wins merge used by the realtime listeners (firebase.js). A snapshot can arrive while this
   browser still has a not-yet-pushed edit (an answer just clicked, a draft just autosaved); without
   this, the snapshot would overwrite that edit and the debounced save would then see "no diff" and
   silently lose it. Anything local with a newer updatedAt than the server copy is kept. */
function pktMergeNewer(localArr, serverRows){
  const local = new Map((localArr||[]).map(x=>[x.id, x]));
  return serverRows.map(s=>{
    const l = local.get(s.id);
    return (l && String(l.updatedAt||"") > String(s.updatedAt||"")) ? l : s;
  });
}

/* ---------------- Scoring ---------------- */
function pktScoreOf(p, answers){
  const qs = p.questions || [];
  let correct = 0;
  qs.forEach(q=>{ if(answers && answers[q.id] && answers[q.id]===q.correctId) correct++; });
  return {correct, total: qs.length, pct: qs.length ? Math.round(correct/qs.length*1000)/10 : 0};
}

/* ---------------- Link to Daily Data (→ Dashboard) ---------------- */
// Writes the score into the agent's Daily Data "PKT Score (%)" cell for the day the PKT was taken.
// Returns {ok:true, iso} or {ok:false, reason}. force=true (staff only) replaces a score already
// recorded for that week.
async function pktSyncToDaily(att, force){
  const iso = isoFromJSDate(new Date(att.startedAt || att.submittedAt || Date.now()));
  const mk = iso.slice(0,7);
  // The month must be loaded locally first: saving pushes the whole local month for this agent, so
  // writing into a month that was never fetched would overwrite that agent's real data for it.
  if(typeof fbReady!=="undefined" && fbReady && fbDb && typeof __loadedMonthKeys!=="undefined" && !__loadedMonthKeys.has(mk)){
    try{
      const snap = await fbDb.collection("trackerDaily").where("month","==",mk).get();
      mergeMonthDailyDocs(mk, snap.docs);
    }catch(e){ console.error("PKT sync: couldn't load month", mk, e); return {ok:false, reason:"load_failed"}; }
  }
  const existingIso = pktFilledDayInWeek(att.empId, iso);
  const ownValue = existingIso && existingIso === att.syncedIso;
  if(existingIso && !ownValue && !force) return {ok:false, reason:"week_has_score", existingIso};
  if(existingIso && !ownValue && force && existingIso !== iso){
    const old = getDaily(att.empId, existingIso).pkt;
    setDaily(att.empId, existingIso, {pkt:""});
    logAudit("pkt_sync", `Moved ${att.agentName||att.empId}'s weekly PKT score off ${fmtDate(existingIso)} (was ${old}) to make room for PKT result`, {empId:att.empId, before:{pkt:old}, after:{pkt:""}});
  }
  const target = ownValue ? existingIso : iso;
  const before = getDaily(att.empId, target).pkt;
  setDaily(att.empId, target, {pkt: att.score});
  if(force) logAudit("pkt_sync", `Synced ${att.agentName||att.empId}'s PKT result (${pktPct(att.score)}) to Daily Data for ${fmtDate(target)}`, {empId:att.empId, before:{pkt:before===""?"—":before}, after:{pkt:att.score}});
  return {ok:true, iso:target};
}
async function pktApplySync(att, force){
  const res = await pktSyncToDaily(att, force);
  att.syncStatus = res.ok ? "synced" : (res.reason==="week_has_score" ? "week_has_score" : "failed");
  att.syncedIso = res.ok ? res.iso : (att.syncedIso || "");
  att.updatedAt = new Date().toISOString();
  saveState();
  render();
  return res;
}

/* ---------------- Submitting / finalizing an attempt ---------------- */
function pktSubmitAttempt(att, auto){
  const p = (pktRun && pktRun.preview && pktRun.att===att) ? pktRun.pkt : pktById(att.pktId);
  if(!p || att.status==="submitted") return;
  const r = pktScoreOf(p, att.answers);
  const now = new Date();
  const limitMs = (p.durationMins||0)*60000;
  const rawMs = now - Date.parse(att.startedAt);
  att.status = "submitted";
  att.submittedAt = now.toISOString();
  att.correct = r.correct; att.total = r.total; att.score = r.pct;
  att.passed = r.pct >= (Number(p.passMark)||0);
  att.timeTakenSec = Math.round((limitMs ? Math.min(rawMs, limitMs) : rawMs)/1000);
  att.autoSubmitted = !!auto;
  att.syncStatus = "pending";
  att.updatedAt = now.toISOString();
  if(pktRun && pktRun.preview && pktRun.att===att) return; // previews are never saved or synced
  saveState();
  pktApplySync(att, false);
}
// Scores any attempt whose time has run out but was never submitted (agent closed the tab).
// An agent finalizes their own immediately; Quality/Admin finalize anyone's after a 1-minute grace.
function pktFinalizeExpired(){
  (state.pktAttempts||[]).forEach(att=>{
    if(att.status!=="in_progress") return;
    const p = pktById(att.pktId); if(!p) return;
    const mine = isAgent() && att.empId===currentUser.empId;
    if(!mine && !canAuthorPKT()) return;
    if(pktRemainingMs(att, p) > (mine ? 0 : -60000)) return;
    pktSubmitAttempt(att, true);
  });
}

/* ---------------- Entry point ---------------- */
function renderPkt(content, topActions){
  topActions.innerHTML = "";
  if(!canViewPKT()){ content.innerHTML = ""; return; }
  pktFinalizeExpired();
  if(pktView==="quiz" && typeof pktRun!=="undefined" && pktRun){ pktRenderQuiz(content, topActions); return; }
  if(pktView==="result" && pktResultAttId){ pktRenderResult(content, topActions); return; }
  if(pktView==="editor" && canAuthorPKT() && typeof pktDraft!=="undefined" && pktDraft){ pktRenderEditor(content, topActions); return; }
  if(pktView==="results" && !isAgent()){ pktRenderResults(content, topActions); return; }
  pktView = "home";
  if(isAgent()) pktRenderAgentHome(content, topActions);
  else pktRenderStaffHome(content, topActions);
}
function pktSubTabs(active){
  const tab = (id,label)=>`<button class="dash-tab ${active===id?"active":""}" data-pkttab="${id}">${label}</button>`;
  return `<div class="dash-tabs" style="margin:0;">${tab("home", canAuthorPKT() ? "🧠 PKTs" : "🧠 All PKTs")}${tab("results","📊 Live results")}</div>`;
}
function pktWireSubTabs(content){
  content.querySelectorAll("[data-pkttab]").forEach(b=> b.addEventListener("click", ()=>{
    pktView = b.dataset.pkttab;
    if(pktView==="results" && !pktResultsId){ const first = pktDefaultResultsPkt(); pktResultsId = first ? first.id : null; }
    render();
  }));
}
function pktDefaultResultsPkt(){
  const all = pktAll().filter(p=>p.status!=="draft");
  return all.find(p=>p.status==="live") || all[0] || null;
}

/* ---------------- Stats shared by lists, results and dashboard ---------------- */
function pktStats(p){
  const agents = pktAudience(p);
  const ids = new Set(agents.map(a=>a.empId));
  const atts = pktAttemptsOf(p.id).filter(a=>ids.has(a.empId));
  const submitted = atts.filter(a=>a.status==="submitted");
  const inProg = atts.filter(a=>a.status==="in_progress");
  const avg = submitted.length ? submitted.reduce((s,a)=>s+Number(a.score||0),0)/submitted.length : null;
  const passCount = submitted.filter(a=>a.passed).length;
  return {agents, atts, submitted, inProg, avg, passCount, notStarted: agents.length - atts.length};
}

/* ---------------- Staff home (list of PKTs) ---------------- */
function pktStatusBadge(p){
  if(p.status==="draft") return `<span class="badge badge-gray">Draft</span>`;
  if(p.status==="closed") return `<span class="badge badge-gray">Closed</span>`;
  if(pktIsDue(p)) return `<span class="badge badge-yellow">Past due date</span>`;
  return `<span class="badge badge-green">Live</span>`;
}
function pktRenderStaffHome(content, topActions){
  const author = canAuthorPKT();
  if(author) topActions.innerHTML = `<button class="btn btn-accent" id="pktCreateBtn">＋ Create PKT</button>`;
  const list = pktAll().filter(p=> author || p.status!=="draft");
  const rows = list.map(p=>{
    const st = pktStats(p);
    const canEdit = author && (isAdmin() || p.createdByUsername===currentUser.username || isQuality());
    return `<tr data-id="${esc(p.id)}">
      <td><b>${esc(p.title||"(untitled)")}</b><div class="help-note">${esc(p.createdBy||"")} · ${pktFmtDateTime(p.createdAt)}</div></td>
      <td>${esc(p.lob||"All LOBs")}</td>
      <td class="num">${(p.questions||[]).length}</td>
      <td class="num">${p.durationMins||0} min</td>
      <td>${p.dueDate ? fmtDate(p.dueDate) : "—"}</td>
      <td>${pktStatusBadge(p)}</td>
      <td class="num">${p.status==="draft" ? "—" : `${st.submitted.length}/${st.agents.length}`}</td>
      <td class="num">${st.avg===null ? "—" : pktScoreBadge(st.avg)}</td>
      <td style="white-space:nowrap;">
        ${p.status!=="draft" ? `<button class="btn btn-ghost btn-sm" data-act="results">📊 Results</button>` : ""}
        ${canEdit ? `<button class="btn btn-ghost btn-sm" data-act="edit">✏️ Edit</button>` : ""}
        ${canEdit && p.status==="live" ? `<button class="btn btn-ghost btn-sm" data-act="close">⏹ Close</button>` : ""}
        ${canEdit && p.status==="closed" ? `<button class="btn btn-ghost btn-sm" data-act="reopen">▶ Reopen</button>` : ""}
        ${canEdit && p.status==="draft" ? `<button class="btn btn-accent btn-sm" data-act="publish">🚀 Publish</button>` : ""}
        ${author ? `<button class="btn btn-ghost btn-sm" data-act="dup" title="Duplicate">⧉</button>` : ""}
        ${canEdit ? `<button class="btn btn-ghost btn-sm" data-act="del" title="Delete">🗑</button>` : ""}
      </td></tr>`;
  }).join("");
  content.innerHTML = `
    <div class="section">
      <div class="section-head" style="flex-wrap:wrap;gap:8px;">${pktSubTabs("home")}</div>
      <div class="section-body">
        ${list.length ? `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr>
            <th>PKT</th><th>Audience</th><th class="num">Questions</th><th class="num">Duration</th><th>Due</th><th>Status</th><th class="num">Submitted</th><th class="num">Avg score</th><th></th>
          </tr></thead><tbody>${rows}</tbody></table></div>
          <div class="help-note" style="margin-top:8px;">Weekly knowledge check. Agents see a PKT as soon as it's <b>Live</b>; their score lands in Daily Data → PKT Score (%) and on the Dashboard the moment they submit.</div>`
        : `<div class="empty-state" style="padding:36px 16px;text-align:center;">
            <div class="big">🧠</div>
            <div class="disp" style="font-size:15px;font-weight:600;">${author ? "No PKT yet" : "No PKT has been published yet"}</div>
            <p>${author ? "Create this week's knowledge check — add questions (with images if you like), choose how many minutes agents get, then publish." : "When Quality publishes a PKT it will show up here with live results."}</p>
            ${author ? `<button class="btn btn-accent" id="pktCreateBtn2" style="margin-top:14px;">＋ Create PKT</button>` : ""}
          </div>`}
      </div>
    </div>`;
  pktWireSubTabs(content);
  const create = ()=> pktOpenEditor(null);
  const b1 = document.getElementById("pktCreateBtn"); if(b1) b1.addEventListener("click", create);
  const b2 = document.getElementById("pktCreateBtn2"); if(b2) b2.addEventListener("click", create);
  content.querySelectorAll("tr[data-id] [data-act]").forEach(btn=> btn.addEventListener("click", ()=>{
    const id = btn.closest("tr").dataset.id, p = pktById(id); if(!p) return;
    const act = btn.dataset.act;
    if(act==="results"){ pktResultsId = id; pktView = "results"; render(); }
    else if(act==="edit"){ pktOpenEditor(id); }
    else if(act==="publish"){ pktOpenEditor(id, true); }
    else if(act==="close"){ showConfirm(`Close "${esc(p.title)}"? Agents who haven't started can no longer take it. Attempts already in progress can still be finished.`, ()=>{ pktSetStatus(p, "closed"); }, "Close PKT"); }
    else if(act==="reopen"){ pktSetStatus(p, "live"); }
    else if(act==="dup"){ pktDuplicate(p); }
    else if(act==="del"){ pktDelete(p); }
  }));
}
function pktSetStatus(p, status){
  p.status = status; p.updatedAt = new Date().toISOString();
  if(status==="live" && !p.publishedAt) p.publishedAt = p.updatedAt;
  logAudit("pkt_"+(status==="live"?"publish":"close"), `${status==="live"?"Published":"Closed"} PKT "${p.title}"`, {});
  saveState(); render();
  showToast(status==="live" ? "✅ PKT is live — agents can see it now" : "PKT closed");
}
function pktDuplicate(p){
  const copy = JSON.parse(JSON.stringify(p));
  const idMap = {};
  copy.id = pktNewId("pkt"); copy.title = (p.title||"PKT") + " (copy)"; copy.status = "draft";
  copy.createdBy = currentUser.name; copy.createdByUsername = currentUser.username||"";
  copy.createdAt = new Date().toISOString(); copy.updatedAt = copy.createdAt; delete copy.publishedAt; copy.dueDate = "";
  copy.questions.forEach(q=>{
    const oldQ = q.id; q.id = pktNewId("q");
    const optMap = {};
    q.options.forEach(o=>{ const old = o.id; o.id = pktNewId("o"); optMap[old] = o.id; });
    q.correctId = optMap[q.correctId] || "";
    idMap[oldQ] = q.id;
  });
  state.pkts.push(copy); saveState(); render();
  showToast("Duplicated as a draft — open it to edit");
}
function pktDelete(p){
  const n = pktAttemptsOf(p.id).length;
  showConfirm(`Delete "${esc(p.title||"(untitled)")}"?${n ? ` This also deletes ${n} agent attempt${n===1?"":"s"}. Scores already synced to Daily Data are NOT removed.` : ""} This can't be undone.`, ()=>{
    state.pkts = state.pkts.filter(x=>x.id!==p.id);
    state.pktAttempts = (state.pktAttempts||[]).filter(a=>a.pktId!==p.id);
    if(pktResultsId===p.id) pktResultsId = null;
    logAudit("pkt_delete", `Deleted PKT "${p.title}"${n ? ` and ${n} attempt(s)` : ""}`, {});
    saveState(); render();
  }, "Delete");
}

/* ---------------- Agent home ---------------- */
function pktRenderAgentHome(content, topActions){
  const me = pktMyAgent();
  if(!me){ content.innerHTML = `<div class="section"><div class="empty-state"><p>Your agent record wasn't found.</p></div></div>`; return; }
  const visible = pktAll().filter(p=> p.status!=="draft" && pktLobMatches(p, me));
  const open = visible.filter(p=> pktIsOpen(p) && (pktAttempt(p.id, me.empId)||{}).status!=="submitted");
  const mine = (state.pktAttempts||[]).filter(a=>a.empId===me.empId && a.status==="submitted")
    .sort((a,b)=> String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const cards = open.map(p=>{
    const att = pktAttempt(p.id, me.empId);
    const resume = att && att.status==="in_progress";
    return `<div class="pkt-avail" data-id="${esc(p.id)}">
      <div class="pkt-avail-ic">🧠</div>
      <div class="pkt-avail-main">
        <div class="pkt-avail-title">${esc(p.title||"PKT")}</div>
        <div class="pkt-avail-meta">${(p.questions||[]).length} questions · ⏱ ${p.durationMins} min for the whole PKT · no per-question timer${p.dueDate ? ` · due ${fmtDate(p.dueDate)}` : ""}</div>
      </div>
      <button class="btn btn-accent" data-start="${esc(p.id)}">${resume ? "▶ Resume" : "▶ Start PKT"}</button>
    </div>`;
  }).join("");
  const rows = mine.map(a=>{
    const p = pktById(a.pktId);
    return `<tr><td><b>${esc(p ? p.title : "(deleted PKT)")}</b></td><td>${pktFmtDateTime(a.submittedAt)}</td>
      <td class="num">${a.correct}/${a.total}</td><td class="num">${pktScoreBadge(a.score)}</td>
      <td>${a.passed ? `<span class="badge badge-green">Pass</span>` : `<span class="badge badge-red">Below pass mark</span>`}</td>
      <td class="num">${pktFmtSec(a.timeTakenSec||0)}</td>
      <td>${p && p.showAnswers ? `<button class="btn btn-ghost btn-sm" data-review="${esc(a.id)}">Review</button>` : ""}</td></tr>`;
  }).join("");
  content.innerHTML = `
    <div class="section">
      <div class="section-head"><div class="section-title">Available PKTs</div></div>
      <div class="section-body">
        ${open.length ? cards : `<div class="empty-state" style="padding:26px 16px;text-align:center;"><div class="big">🎉</div><div class="disp" style="font-size:14px;font-weight:600;">You're all caught up</div><p>No PKT is waiting for you right now. You'll see a badge on this tab when a new one goes live.</p></div>`}
      </div>
    </div>
    <div class="section" style="margin-top:16px;">
      <div class="section-head"><div class="section-title">My PKT results</div></div>
      <div class="section-body">
        ${mine.length ? `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>PKT</th><th>Submitted</th><th class="num">Correct</th><th class="num">Score</th><th>Result</th><th class="num">Time</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
        : `<div class="help-note" style="padding:6px 2px;">Your PKT scores will appear here as soon as you submit one.</div>`}
      </div>
    </div>`;
  content.querySelectorAll("[data-start]").forEach(b=> b.addEventListener("click", ()=> pktStartFlow(b.dataset.start)));
  content.querySelectorAll("[data-review]").forEach(b=> b.addEventListener("click", ()=>{ pktResultAttId = b.dataset.review; pktView = "result"; render(); }));
}

/* ---------------- Live results (Quality / Admin / TL / SME / Trainer) ---------------- */
function pktAttemptState(att, p){
  if(!att) return "not_started";
  if(att.status==="submitted") return "submitted";
  return pktRemainingMs(att, p) <= 0 ? "timed_out" : "in_progress";
}
function pktStateBadge(s){
  return s==="submitted" ? `<span class="badge badge-green">Submitted</span>`
    : s==="in_progress" ? `<span class="badge badge-yellow">In progress</span>`
    : s==="timed_out" ? `<span class="badge badge-red">Time's up</span>`
    : `<span class="badge badge-gray">Not started</span>`;
}
function pktSyncBadge(att){
  if(!att || att.status!=="submitted") return `<span style="color:var(--text-dim);">—</span>`;
  if(att.syncStatus==="synced") return `<span class="badge badge-green" title="Written to Daily Data on ${esc(att.syncedIso||"")}">In Daily Data</span>`;
  if(att.syncStatus==="week_has_score") return `<span class="badge badge-yellow" title="Daily Data already has a PKT score for this week">Week already scored</span>`;
  if(att.syncStatus==="failed") return `<span class="badge badge-red">Sync failed</span>`;
  return `<span class="badge badge-gray">Syncing…</span>`;
}
function pktResultsRows(p){
  const agents = pktAudience(p);
  return agents.map(a=>{
    const att = pktAttempt(p.id, a.empId);
    return {agent:a, att, st:pktAttemptState(att, p)};
  });
}
function pktFilteredResultsRows(p){
  const f = pktResFilter, q = f.q.trim().toLowerCase();
  return pktResultsRows(p).filter(r=>{
    if(f.tl!=="all" && (r.agent.tlName||"")!==f.tl) return false;
    if(f.lob!=="all" && (r.agent.lob||"")!==f.lob) return false;
    if(f.status!=="all" && r.st!==f.status) return false;
    if(q && !(`${r.agent.name} ${r.agent.empId}`.toLowerCase().includes(q))) return false;
    return true;
  });
}
function pktRenderResults(content, topActions){
  const list = pktAll().filter(p=>p.status!=="draft");
  if(!pktResultsId || !pktById(pktResultsId) || pktById(pktResultsId).status==="draft"){
    const d = pktDefaultResultsPkt(); pktResultsId = d ? d.id : null;
  }
  const p = pktById(pktResultsId);
  if(!p){
    content.innerHTML = `<div class="section"><div class="section-head" style="flex-wrap:wrap;gap:8px;">${pktSubTabs("results")}</div>
      <div class="section-body"><div class="empty-state" style="padding:30px 16px;text-align:center;"><div class="big">📊</div><p>Results show up here once a PKT is published.</p></div></div></div>`;
    pktWireSubTabs(content); return;
  }
  const st = pktStats(p);
  const rows = pktFilteredResultsRows(p);
  const tls = Array.from(new Set(pktAudience(p).map(a=>a.tlName||"").filter(Boolean))).sort();
  const lobs = Array.from(new Set(pktAudience(p).map(a=>a.lob||"").filter(Boolean))).sort();
  const timedOut = pktResultsRows(p).filter(r=>r.st==="timed_out").length;
  const fmtSel = (id, label, opts, val)=>`<select class="week-select" id="${id}"><option value="all">${label}</option>${opts.map(o=>`<option value="${esc(o.v)}" ${val===o.v?"selected":""}>${esc(o.t)}</option>`).join("")}</select>`;
  const body = rows.map(r=>{
    const a = r.agent, att = r.att;
    const total = (p.questions||[]).length;
    const answered = att ? Object.keys(att.answers||{}).length : 0;
    const prog = att ? `<div style="display:flex;align-items:center;gap:6px;min-width:110px;"><div style="flex:1;height:7px;background:var(--surface-3);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${total?Math.round(answered/total*100):0}%;background:var(--accent);"></div></div><span style="font-size:11px;color:var(--text-muted);">${answered}/${total}</span></div>` : `<span style="color:var(--text-dim);">—</span>`;
    return `<tr data-emp="${esc(a.empId)}">
      <td><b>${esc(a.name)}</b><div class="help-note">${esc(a.empId)}</div></td>
      <td>${esc(a.tlName||"—")}</td><td>${esc(a.lob||"—")}</td>
      <td>${pktStateBadge(r.st)}</td><td>${prog}</td>
      <td class="num">${att && att.status==="submitted" ? pktScoreBadge(att.score) : "—"}</td>
      <td>${att && att.status==="submitted" ? (att.passed ? `<span class="badge badge-green">Pass</span>` : `<span class="badge badge-red">Below</span>`) : "—"}</td>
      <td class="num">${att && att.status==="submitted" ? pktFmtSec(att.timeTakenSec||0) + (att.autoSubmitted ? ` <span title="Auto-submitted when time ran out">⏱</span>` : "") : "—"}</td>
      <td>${att && att.submittedAt ? pktFmtDateTime(att.submittedAt) : "—"}</td>
      <td>${pktSyncBadge(att)}</td>
      <td style="white-space:nowrap;">
        ${att && att.status==="submitted" ? `<button class="btn btn-ghost btn-sm" data-act="detail">🔍 Answers</button>` : ""}
        ${canAuthorPKT() && att && att.status==="submitted" && att.syncStatus!=="synced" ? `<button class="btn btn-ghost btn-sm" data-act="sync" title="Write this score into Daily Data">⇪ Sync</button>` : ""}
        ${canAuthorPKT() && att && att.status==="in_progress" && r.st==="timed_out" ? `<button class="btn btn-ghost btn-sm" data-act="finalize">Score now</button>` : ""}
        ${canAuthorPKT() && att ? `<button class="btn btn-ghost btn-sm" data-act="reset" title="Delete this attempt so the agent can retake">↺ Reset</button>` : ""}
      </td></tr>`;
  }).join("");
  topActions.innerHTML = `<button class="btn btn-accent" id="pktExportBtn">⬇ Export to Excel</button>`;
  content.innerHTML = `
    <div class="section" style="margin-bottom:16px;">
      <div class="section-head" style="flex-wrap:wrap;gap:8px;">
        ${pktSubTabs("results")}
        <div class="section-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span class="pkt-live"><i></i> Live</span>
          <select class="week-select" id="pktResPkt" style="max-width:260px;">${list.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?"selected":""}>${esc(x.title||"(untitled)")}${x.status==="closed"?" — closed":""}</option>`).join("")}</select>
        </div>
      </div>
      <div class="section-body">
        <div class="kpi-grid">
          <div class="kpi"><div class="kpi-label">Agents</div><div class="kpi-value">${st.agents.length}</div><div class="kpi-target">${esc(p.lob||"All LOBs")} · ${(p.questions||[]).length} questions · ${p.durationMins} min</div></div>
          <div class="kpi"><div class="kpi-label">Submitted</div><div class="kpi-value">${st.submitted.length}<span class="kpi-unit">/ ${st.agents.length}</span></div><div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${st.agents.length?Math.round(st.submitted.length/st.agents.length*100):0}%;background:var(--green);"></div></div></div>
          <div class="kpi"><div class="kpi-label">In progress</div><div class="kpi-value">${st.inProg.length}</div><div class="kpi-target">${timedOut ? `${timedOut} timed out, not scored` : "taking it right now"}</div></div>
          <div class="kpi"><div class="kpi-label">Not started</div><div class="kpi-value">${st.notStarted}</div></div>
          <div class="kpi"><div class="kpi-label">Average score</div><div class="kpi-value">${st.avg===null ? "—" : pktPct(st.avg)}</div><div class="kpi-target">Pass mark ${pktPct(p.passMark||0)}</div></div>
          <div class="kpi"><div class="kpi-label">Passed</div><div class="kpi-value">${st.passCount}<span class="kpi-unit">/ ${st.submitted.length}</span></div></div>
        </div>
      </div>
    </div>
    <div class="section" style="margin-bottom:16px;">
      <div class="section-head" style="flex-wrap:wrap;gap:8px;">
        <div class="section-title">Agents</div>
        <div class="section-actions" style="display:flex;gap:8px;flex-wrap:wrap;">
          ${tls.length>1 ? fmtSel("pktFTl","All TLs",tls.map(t=>({v:t,t})),pktResFilter.tl) : ""}
          ${lobs.length>1 ? fmtSel("pktFLob","All LOBs",lobs.map(t=>({v:t,t})),pktResFilter.lob) : ""}
          ${fmtSel("pktFStatus","All statuses",[{v:"submitted",t:"Submitted"},{v:"in_progress",t:"In progress"},{v:"timed_out",t:"Time's up"},{v:"not_started",t:"Not started"}],pktResFilter.status)}
          <input type="text" class="week-select" id="pktFSearch" placeholder="🔍 Search agent…" value="${esc(pktResFilter.q)}" style="width:150px;">
        </div>
      </div>
      <div class="section-body">
        ${rows.length ? `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Agent</th><th>TL</th><th>LOB</th><th>Status</th><th>Progress</th><th class="num">Score</th><th>Result</th><th class="num">Time</th><th>Submitted</th><th>Daily Data</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
          : `<div class="help-note" style="padding:10px 2px;">No agents match these filters.</div>`}
      </div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title">Question analysis</div></div>
      <div class="section-body">${pktQuestionAnalysisHtml(p, st)}</div>
    </div>`;
  pktWireSubTabs(content);
  const sel = document.getElementById("pktResPkt");
  if(sel) sel.addEventListener("change", e=>{ pktResultsId = e.target.value; pktResFilter = {tl:"all", lob:"all", status:"all", q:""}; render(); });
  [["pktFTl","tl"],["pktFLob","lob"],["pktFStatus","status"]].forEach(([id,k])=>{
    const el = document.getElementById(id); if(el) el.addEventListener("change", e=>{ pktResFilter[k] = e.target.value; render(); });
  });
  const search = document.getElementById("pktFSearch");
  if(search) search.addEventListener("input", e=>{ pktResFilter.q = e.target.value; render(); });
  const exp = document.getElementById("pktExportBtn"); if(exp) exp.addEventListener("click", ()=> pktExportExcel(p));
  content.querySelectorAll("tr[data-emp] [data-act]").forEach(btn=> btn.addEventListener("click", ()=>{
    const empId = btn.closest("tr").dataset.emp, att = pktAttempt(p.id, empId); if(!att) return;
    const act = btn.dataset.act;
    if(act==="detail") pktShowAttemptDetail(p, att);
    else if(act==="finalize"){ pktSubmitAttempt(att, true); }
    else if(act==="sync") pktSyncManual(att);
    else if(act==="reset") showConfirm(`Reset ${esc(att.agentName||empId)}'s attempt? It's deleted and they can take "${esc(p.title)}" again. Any score already written to Daily Data stays there.`, ()=>{
      state.pktAttempts = state.pktAttempts.filter(x=>x.id!==att.id);
      logAudit("pkt_reset", `Reset ${att.agentName||empId}'s attempt on PKT "${p.title}"`, {empId});
      saveState(); render();
    }, "Reset attempt");
  }));
}
async function pktSyncManual(att){
  const res = await pktApplySync(att, false);
  if(res.ok){ showToast("✅ Score written to Daily Data"); return; }
  if(res.reason==="week_has_score"){
    showConfirm(`${esc(att.agentName||att.empId)} already has a PKT score in Daily Data for that week (${esc(fmtDate(res.existingIso))}). Replace it with ${pktPct(att.score)} from this PKT?`, async ()=>{
      const r2 = await pktApplySync(att, true);
      showToast(r2.ok ? "✅ Daily Data updated" : "Couldn't update Daily Data");
    }, "Replace score");
  } else showToast("Couldn't write to Daily Data — check your connection and try again");
}
function pktQuestionAnalysisHtml(p, st){
  const subs = st.submitted;
  if(!subs.length) return `<div class="help-note" style="padding:6px 2px;">Question-level results appear after the first submission.</div>`;
  const rows = (p.questions||[]).map((q,i)=>{
    const right = subs.filter(a=>(a.answers||{})[q.id]===q.correctId).length;
    const wrongCount = {};
    subs.forEach(a=>{ const ans=(a.answers||{})[q.id]; if(ans && ans!==q.correctId) wrongCount[ans]=(wrongCount[ans]||0)+1; });
    const topWrongId = Object.keys(wrongCount).sort((x,y)=>wrongCount[y]-wrongCount[x])[0];
    const topWrong = topWrongId ? q.options.find(o=>o.id===topWrongId) : null;
    const frac = right/subs.length;
    const correctOpt = q.options.find(o=>o.id===q.correctId);
    return `<tr><td class="num">${i+1}</td><td style="max-width:360px;">${esc((q.text||"").slice(0,120))}${(q.text||"").length>120?"…":""}</td>
      <td style="min-width:130px;"><div style="display:flex;align-items:center;gap:6px;"><div style="flex:1;height:8px;background:var(--surface-3);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${Math.round(frac*100)}%;background:${frac>=0.8?"var(--green)":frac>=0.5?"var(--yellow)":"var(--red)"};"></div></div><b style="font-size:12px;">${Math.round(frac*100)}%</b></div></td>
      <td class="num">${right}/${subs.length}</td>
      <td>${esc(correctOpt ? correctOpt.text : "—")}</td>
      <td>${topWrong ? `${esc(topWrong.text)} <span class="help-note">(${wrongCount[topWrongId]})</span>` : "—"}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th class="num">#</th><th>Question</th><th>% correct</th><th class="num">Correct</th><th>Right answer</th><th>Most common wrong answer</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="help-note" style="margin-top:6px;">Low "% correct" = a topic worth a refresher. Based on submitted attempts of the agents you can see.</div>`;
}
function pktShowAttemptDetail(p, att){
  const qs = pktOrderedQuestions(p, att);
  const items = qs.map((q,i)=>{
    const ans = (att.answers||{})[q.id];
    const ao = q.options.find(o=>o.id===ans), co = q.options.find(o=>o.id===q.correctId);
    const ok = ans && ans===q.correctId;
    return `<div style="padding:9px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:12.5px;font-weight:600;">${i+1}. ${esc(q.text)}</div>
      <div style="font-size:12px;margin-top:4px;">Answer: <b style="color:${ok?"var(--green)":"var(--red)"};">${ao ? esc(ao.text) : "— not answered"}</b> ${ok ? "✓" : "✗"}</div>
      ${ok ? "" : `<div style="font-size:12px;color:var(--text-muted);">Correct: ${co ? esc(co.text) : "—"}</div>`}
    </div>`;
  }).join("");
  const ov = showModal(`
    <div class="modal-title">${esc(att.agentName||att.empId)} — ${pktScoreBadge(att.score)}</div>
    <div class="help-note" style="margin-bottom:6px;">${esc(p.title)} · ${att.correct}/${att.total} correct · ${pktFmtSec(att.timeTakenSec||0)}</div>
    <div style="max-height:56vh;overflow:auto;">${items}</div>
    <div class="modal-actions"><button class="btn btn-ghost" id="pktDetClose">Close</button></div>`);
  ov.querySelector("#pktDetClose").addEventListener("click", closeModal);
}
function pktExportExcel(p){
  if(typeof XLSX==="undefined"){ showToast("Excel library didn't load — check your connection"); return; }
  const rows = pktResultsRows(p).map(r=>{
    const a = r.agent, att = r.att;
    return {
      "Emp ID": a.empId, "Agent": a.name, "Team Leader": a.tlName||"", "LOB": a.lob||"",
      "Status": r.st==="submitted"?"Submitted":r.st==="in_progress"?"In progress":r.st==="timed_out"?"Time's up (not scored)":"Not started",
      "Answered": att ? Object.keys(att.answers||{}).length : 0, "Questions": (p.questions||[]).length,
      "Correct": att && att.status==="submitted" ? att.correct : "",
      "Score (%)": att && att.status==="submitted" ? att.score : "",
      "Result": att && att.status==="submitted" ? (att.passed?"Pass":"Below pass mark") : "",
      "Time taken (mm:ss)": att && att.status==="submitted" ? pktFmtSec(att.timeTakenSec||0) : "",
      "Submitted at": att && att.submittedAt ? pktFmtDateTime(att.submittedAt) : "",
      "In Daily Data": att && att.status==="submitted" ? (att.syncStatus==="synced" ? "Yes ("+att.syncedIso+")" : "No") : ""
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "PKT results");
  XLSX.writeFile(wb, `PKT_${(p.title||"results").replace(/[^a-z0-9]+/gi,"_")}_${todayIso()}.xlsx`);
}

/* ---------------- Dashboard card (live) ---------------- */
// Called from app.js right after the Dashboard renders. Because every PKT snapshot re-renders the
// current tab, this card updates in real time with no extra wiring.
function pktInjectDashboard(content){
  if(!canViewPKT()) return;
  let html = "";
  if(isAgent()){
    const me = pktMyAgent(); if(!me) return;
    const pending = pktAll().filter(p=> pktIsOpen(p) && pktLobMatches(p, me) && (pktAttempt(p.id, me.empId)||{}).status!=="submitted");
    const last = (state.pktAttempts||[]).filter(a=>a.empId===me.empId && a.status==="submitted").sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
    if(!pending.length && !last) return;
    html = `<div class="pkt-dash">
      <div class="pkt-dash-ic">🧠</div>
      <div class="pkt-dash-main">
        <div class="pkt-dash-title">PKT</div>
        <div class="pkt-dash-sub">${pending.length ? `<b>${pending.length}</b> PKT${pending.length===1?"":"s"} waiting for you` : "You're up to date"}${last ? ` · Last score ${pktScoreBadge(last.score)}` : ""}</div>
      </div>
      <button class="btn ${pending.length?"btn-accent":""} btn-sm" id="pktDashGo">${pending.length ? "Take PKT" : "View"}</button></div>`;
  } else {
    const p = pktAll().find(x=>x.status==="live") || pktAll().find(x=>x.status==="closed");
    if(!p) return;
    const st = pktStats(p);
    html = `<div class="pkt-dash">
      <div class="pkt-dash-ic">🧠</div>
      <div class="pkt-dash-main">
        <div class="pkt-dash-title">PKT — ${esc(p.title||"")} <span class="pkt-live"><i></i> ${p.status==="live"?"Live":"Closed"}</span></div>
        <div class="pkt-dash-sub"><b>${st.submitted.length}</b>/${st.agents.length} submitted · ${st.inProg.length} in progress · Avg ${st.avg===null?"—":pktScoreBadge(st.avg)}</div>
      </div>
      <button class="btn btn-sm" id="pktDashGo">Open results</button></div>`;
  }
  content.insertAdjacentHTML("afterbegin", html);
  const go = document.getElementById("pktDashGo");
  if(go) go.addEventListener("click", ()=>{
    currentTab = "pkt";
    if(!isAgent()){ const d = pktAll().find(x=>x.status==="live") || pktDefaultResultsPkt(); pktResultsId = d ? d.id : null; pktView = "results"; }
    else pktView = "home";
    render();
  });
}
