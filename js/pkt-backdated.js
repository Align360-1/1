/* ---------------- PKT — upload BACKDATED results ----------------
   Until now a PKT could only exist the way it's taken live: Quality builds the questions, agents take it
   in the app, the score lands in Daily Data. That leaves no way to bring in PKTs that were held earlier
   (on paper, in another tool, last month). This adds that: Quality / Admin / Manager upload the RESULTS
   of a past PKT from Excel / CSV.

   One file can hold several PKTs. Columns (header names are matched loosely, order doesn't matter):
     PKT Title*  Test Date*  Emp ID* or Agent Name*  Score (%)* — or Correct + Total Questions —
     Pass Mark (%)  Time Taken (min)  LOB          (* = needed, either in the file or in the defaults box)
   Rows with the same Title + Test Date become ONE PKT; the Title / Test Date / Pass Mark / LOB boxes on the
   screen fill in anything the file leaves blank, so a single-PKT file only needs agent + score.

   Parameters / rules
     - Score: if Correct and Total Questions are both given the score is calculated from them (a different
       Score (%) in the file is only flagged); otherwise Score (%) is used. Must be 0–100.
       (If every score in the file is between 0 and 1 it is read as a fraction — Excel's % cells — and ×100.)
     - Pass / Below is worked out against the pass mark (row → defaults box → the PKT metric's threshold).
     - Test Date cannot be in the future. The agent must be on the roster.
     - One result per agent per PKT. If that agent already has one you choose: skip it, or replace it.
     - Daily Data keeps ONE PKT score per agent per week (existing rule). If the week already has a score
       the result is still saved on the PKT but flagged "Week already scored" — unless you tick
       "Replace the week's score in Daily Data". The preview tells you which agents this affects.

   What gets stored
     - state.pkts:        a closed PKT  {backdated:true, testDate, totalQuestions, questions:[] ...}
     - state.pktAttempts: submitted attempts (backdated:true) — so Results, the agent's "My PKT results",
                          Excel export and the Dashboard PKT field all work with no special-casing.
     - Agents can't "take" a backdated PKT and are not shown it as pending.
     - Undo: a whole upload can be removed from the PKT home screen; scores it wrote into Daily Data are
       taken back out (and a score it replaced is put back). */

let pktBd = null; // {fileName, aoa, rows, groups, defaults, existing:"skip"|"replace", force:bool, dateFmt, done, busy}

const PKT_BD_HEADERS = {
  title:   ["pkttitle","title","pktname","testname","test","assessment","assessmentname"],
  date:    ["testdate","pktdate","date","conducteddate","dateconducted","dateoftest","examdate"],
  empId:   ["empid","employeeid","agentid","eid","id"],
  name:    ["agentname","agent","name","employeename","employee"],
  correct: ["correct","correctanswers","correctans","noofcorrect","marksobtained"],
  total:   ["totalquestions","questions","totalqs","noofquestions","outof","totalmarks","maxmarks"],
  score:   ["score%","score","scorepct","pktscore%","pktscore","pktscorepct","percentage","percent","pct","%"],
  pass:    ["passmark%","passmark","passingscore","passingmark","passpct","passpercentage"],
  time:    ["timetakenmin","timetaken","timetakenminutes","timemin","timeminutes","durationmin"],
  lob:     ["lob","lineofbusiness","process"]
};

function pktBdWeekKey(iso){
  const [y,m,d] = iso.split("-").map(Number);
  const mondayIdx = (new Date(y, m-1, 1).getDay()+6)%7;
  return `${y}-${pad2(m)}-w${Math.ceil((d+mondayIdx)/7)}`;
}
function pktBdNum(v){
  if(v==null || v==="") return null;
  if(typeof v==="number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[%,\s]/g,""));
  return isNaN(n) ? null : n;
}
function pktBdStr(v){ return v==null ? "" : (v instanceof Date ? "" : String(v)).trim(); }
function pktBdNoon(iso){ return new Date(iso + "T12:00:00").toISOString(); } // noon, so the local date can't slip across midnight/UTC

// Make sure each month the upload touches is loaded locally before we look at (or write) Daily Data —
// same safeguard pktSyncToDaily uses, because saving pushes the whole local month for an agent.
async function pktBdEnsureMonths(isos){
  if(!(typeof fbReady!=="undefined" && fbReady && fbDb && typeof __loadedMonthKeys!=="undefined")) return true;
  for(const mk of new Set(isos.map(i=>i.slice(0,7)))){
    if(__loadedMonthKeys.has(mk)) continue;
    try{
      const snap = await fbDb.collection("trackerDaily").where("month","==",mk).get();
      mergeMonthDailyDocs(mk, snap.docs);
    }catch(e){ console.error("PKT upload: couldn't load month", mk, e); return false; }
  }
  return true;
}

/* ---------- template ---------- */
function pktBdDownloadTemplate(){
  if(typeof XLSX==="undefined"){ showToast("⚠ Excel library didn't load — check your connection and try again"); return; }
  const headers = ["PKT Title","Test Date","Emp ID","Agent Name","Correct","Total Questions","Score (%)","Pass Mark (%)","Time Taken (min)","LOB"];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = [{wch:30},{wch:12},{wch:10},{wch:26},{wch:9},{wch:15},{wch:10},{wch:13},{wch:16},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws, "PKT results");
  const guide = [
    ["Column","What to enter"],
    ["PKT Title","Name of the PKT, e.g. \"Week 37 PKT\". Rows with the same title + test date become one PKT. May be left blank if you fill the Title box on screen."],
    ["Test Date","The date the PKT was actually held (today or earlier). This is the date the score is written to in Daily Data. May be left blank if you fill the Test date box."],
    ["Emp ID / Agent Name","Either one is enough. Emp ID is safest. The agent must be on the roster."],
    ["Correct + Total Questions","Optional pair. When both are present the score is calculated from them."],
    ["Score (%)","0–100. Needed only when Correct / Total Questions aren't given."],
    ["Pass Mark (%)","Optional. Default is the box on screen, then the PKT Score target threshold from Settings (" + pktMetric().threshold + "%)."],
    ["Time Taken (min)","Optional."],
    ["LOB","Optional. Leave blank for \"All LOBs\"."]
  ];
  const gs = XLSX.utils.aoa_to_sheet(guide); gs["!cols"] = [{wch:28},{wch:130}];
  XLSX.utils.book_append_sheet(wb, gs, "How to fill");
  const ag = XLSX.utils.aoa_to_sheet([["Emp ID","Agent Name","Team Leader","LOB"], ...(state.roster||[]).map(a=>[a.empId, a.name, a.tlName||"", agentLobText(a, ", ")])]);
  ag["!cols"] = [{wch:10},{wch:30},{wch:24},{wch:24}];
  XLSX.utils.book_append_sheet(wb, ag, "Roster");
  XLSX.writeFile(wb, "Backdated_PKT_Results_Template.xlsx");
}

/* ---------- parse ---------- */
function pktBdColMap(headerRow){
  const map = {};
  (headerRow||[]).forEach((h,i)=>{
    const n = normalizeHeader(pktBdStr(h)); if(!n) return;
    for(const [field, cands] of Object.entries(PKT_BD_HEADERS)){
      if(map[field]===undefined && cands.includes(n)){ map[field] = i; break; }
    }
  });
  return map;
}
async function pktBdParse(){
  const b = pktBd, d = b.defaults;
  const aoa = b.aoa;
  const h = aoa.findIndex(r=> { const m = pktBdColMap(r); return (m.empId!==undefined || m.name!==undefined) && (m.score!==undefined || m.correct!==undefined); });
  if(h < 0) throw new Error("Couldn't find the header row. The file needs an Emp ID or Agent Name column and a Score (%) — or Correct + Total Questions — column. Download the template to see the layout.");
  const col = pktBdColMap(aoa[h]);
  const cell = (r, f) => col[f]===undefined ? "" : r[col[f]];
  const today = todayIso();
  const defDate = d.date ? d.date : "";

  // 1) raw rows
  const rows = [];
  for(let i=h+1; i<aoa.length; i++){
    const r = aoa[i];
    if(!r || r.every(c=> c==="" || c==null)) continue;
    rows.push({rowNo:i+1, r, errors:[], warnings:[]});
  }
  if(!rows.length) throw new Error("No result rows found below the header.");

  // scores that are all 0..1 → fractions from a %-formatted Excel column
  const rawScores = rows.map(x=> pktBdNum(cell(x.r,"score"))).filter(v=>v!==null);
  const scoreIsFraction = rawScores.length>0 && rawScores.some(v=>v>0) && rawScores.every(v=>v<=1);

  rows.forEach(x=>{
    const r = x.r;
    x.title = pktBdStr(cell(r,"title")) || d.title.trim();
    const dateCell = cell(r,"date");
    x.testDate = (dateCell!=="" && dateCell!=null) ? (parseFlexibleDate(dateCell, b.dateFmt) || "") : defDate;
    if(!x.title) x.errors.push("PKT Title is blank (fill the Title box or add a column)");
    if(!x.testDate) x.errors.push((dateCell!=="" && dateCell!=null) ? "Test Date isn't a valid date" : "Test Date is blank (fill the Test date box or add a column)");
    else if(x.testDate > today) x.errors.push(`Test Date ${x.testDate} is in the future`);

    // agent
    const idRaw = pktBdStr(cell(r,"empId")), nameRaw = pktBdStr(cell(r,"name"));
    let agent = null;
    if(idRaw) agent = (state.roster||[]).find(a=> String(a.empId).toLowerCase()===idRaw.toLowerCase());
    if(!agent && nameRaw) agent = (state.roster||[]).find(a=> normalizeName(a.name)===normalizeName(nameRaw));
    x.agent = agent; x.agentLabel = agent ? agent.name : (nameRaw || idRaw);
    if(!idRaw && !nameRaw) x.errors.push("Both Emp ID and Agent Name are blank");
    else if(!agent){
      const sim = nameRaw && typeof findSimilarAgent==="function" ? findSimilarAgent(nameRaw, state.roster||[]) : null;
      x.errors.push(`${idRaw ? "Emp ID "+idRaw : "Agent \""+nameRaw+"\""} isn't on the roster${sim ? ` (did you mean ${sim.name}?)` : ""}`);
    } else if(idRaw && nameRaw && normalizeName(agent.name)!==normalizeName(nameRaw)){
      x.warnings.push(`Emp ID ${agent.empId} is ${agent.name}, not "${nameRaw}" — Emp ID used`);
    }

    // score
    const correct = pktBdNum(cell(r,"correct")), total = pktBdNum(cell(r,"total"));
    let fileScore = pktBdNum(cell(r,"score")); if(fileScore!==null && scoreIsFraction) fileScore = fileScore*100;
    let score = null;
    if(correct!==null && total!==null){
      if(total<=0 || correct<0 || correct>total || !Number.isInteger(correct) || !Number.isInteger(total)) x.errors.push(`Correct (${correct}) / Total Questions (${total}) don't make sense`);
      else {
        score = Math.round(correct/total*1000)/10; x.correct = correct; x.total = total;
        if(fileScore!==null && Math.abs(fileScore-score) > 0.5) x.warnings.push(`Score (%) in file is ${Math.round(fileScore*10)/10} but ${correct}/${total} = ${score} — the calculated score is used`);
      }
    } else if(fileScore!==null){
      if(fileScore<0 || fileScore>100) x.errors.push(`Score ${Math.round(fileScore*10)/10} is outside 0–100`);
      else { score = Math.round(fileScore*10)/10; if(total!==null && total>0){ x.total = total; x.correct = Math.round(score/100*total); } }
    } else x.errors.push("No score — give Score (%) or Correct + Total Questions");
    x.score = score;
    const t = pktBdNum(cell(r,"time")); x.timeMin = t!==null && t>=0 ? t : null;
    x.passMark = pktBdNum(cell(r,"pass"));
    x.lob = pktBdStr(cell(r,"lob")) || d.lob;
  });

  // 2) group into PKTs
  const groups = new Map();
  rows.forEach(x=>{
    if(!x.title || !x.testDate) return;
    const key = x.title.toLowerCase() + "|" + x.testDate;
    if(!groups.has(key)) groups.set(key, {key, title:x.title, testDate:x.testDate, rows:[]});
    groups.get(key).rows.push(x);
  });
  const claims = new Map(); // agent|week -> "title" that already fills it in this file
  const existingNeeds = [];
  Array.from(groups.values()).sort((a,b)=> a.testDate.localeCompare(b.testDate)).forEach(g=>{
    const old = (state.pkts||[]).find(p=> p.backdated && String(p.title||"").toLowerCase()===g.title.toLowerCase() && p.testDate===g.testDate);
    g.existingPkt = old || null;
    g.pktId = old ? old.id : pktNewId("pkt");
    g.passMark = (g.rows.map(x=>x.passMark).find(v=>v!==null && v!==undefined))
      ?? (pktBdNum(d.pass)) ?? Number(pktMetric().threshold) ?? 0;
    g.lob = g.rows.map(x=>x.lob).find(Boolean) || "";
    g.totalQuestions = Math.max(0, ...g.rows.map(x=>x.total||0)) || null;
    const seenAgents = new Set();
    g.rows.forEach(x=>{
      if(!x.agent || x.score===null) return;
      if(seenAgents.has(x.agent.empId)){ x.errors.push(`${x.agent.name} appears twice in "${g.title}" on ${g.testDate}`); return; }
      seenAgents.add(x.agent.empId);
      x.exists = !!pktAttempt(g.pktId, x.agent.empId);
      if(x.exists) x.warnings.push("Already has a result for this PKT");
      if(!activeAgentsForDate(g.testDate).some(a=>a.empId===x.agent.empId)) x.warnings.push(`Wasn't active on ${g.testDate} (joined later / inactive) — the score is kept on the PKT but won't show on that day in Daily Data`);
      existingNeeds.push(g.testDate);
    });
  });
  // 3) Daily Data weekly-lock preview (needs the months loaded)
  await pktBdEnsureMonths(existingNeeds);
  Array.from(groups.values()).sort((a,b)=> a.testDate.localeCompare(b.testDate)).forEach(g=>{
    g.rows.forEach(x=>{
      if(x.errors.length || !x.agent) return;
      const ex = pktFilledDayInWeek(x.agent.empId, g.testDate);
      const prior = pktAttempt(g.pktId, x.agent.empId);
      const own = ex && prior && prior.syncedIso===ex;
      const ck = x.agent.empId + "|" + pktBdWeekKey(g.testDate);
      if(ex && !own){ x.weekHas = {iso:ex, pkt:getDaily(x.agent.empId, ex).pkt}; }
      else if(claims.has(ck) && claims.get(ck)!==g.key){ x.weekHas = {iso:g.testDate, pkt:"(another PKT in this file)"}; }
      if(!x.weekHas || own) claims.set(ck, g.key);
    });
  });
  b.rows = rows; b.groups = Array.from(groups.values());
}
function pktBdRowReady(x){
  if(x.errors.length) return false;
  if(x.exists && pktBd.existing==="skip") return false;
  return true;
}

/* ---------- import ---------- */
async function pktBdImport(){
  const b = pktBd;
  const ready = b.rows.filter(pktBdRowReady);
  if(!ready.length){ showToast("⚠ No rows are ready to import"); return; }
  const nPkt = b.groups.filter(g=> g.rows.some(pktBdRowReady)).length;
  const clash = ready.filter(x=>x.weekHas).length;
  if(!confirm(`Import ${ready.length} result${ready.length===1?"":"s"} into ${nPkt} PKT${nPkt===1?"":"s"}?\n\n` +
    (clash ? (b.force ? `${clash} agent${clash===1?"":"s"} already have a PKT score that week in Daily Data — it will be REPLACED.\n` : `${clash} agent${clash===1?"":"s"} already have a PKT score that week in Daily Data — their result is saved on the PKT but Daily Data is left as is.\n`) : "") +
    "You can undo the whole upload afterwards.")) return;
  b.busy = true; render();
  const dates = ready.map(x=>x.testDate).sort();
  if(!(await pktBdEnsureMonths(dates))){ b.busy = false; showToast("⚠ Couldn't load Daily Data for those months — check your connection and try again"); render(); return; }

  const now = new Date().toISOString(), batchId = "pb_" + Date.now().toString(36);
  state.pkts = state.pkts || []; state.pktAttempts = state.pktAttempts || [];
  let synced = 0, weekKept = 0, failed = 0;
  const order = b.groups.slice().sort((x,y)=> x.testDate.localeCompare(y.testDate));
  for(const g of order){
    const gRows = g.rows.filter(pktBdRowReady); if(!gRows.length) continue;
    let p = g.existingPkt;
    if(!p){
      p = {id:g.pktId, title:g.title, lob:g.lob, status:"closed", backdated:true, testDate:g.testDate, dueDate:g.testDate,
           durationMins:0, passMark:g.passMark, shuffleQuestions:false, shuffleOptions:false, showAnswers:false,
           questions:[], totalQuestions:g.totalQuestions,
           createdBy:currentUser.name, createdByUsername:currentUser.username||"", createdAt:now, publishedAt:now, updatedAt:now,
           uploadBatch:batchId, uploadFile:b.fileName};
      state.pkts.push(p);
    } else {
      // Topping up a PKT uploaded earlier: keep it, widen the question count if the new rows know more.
      if(g.totalQuestions && g.totalQuestions > (p.totalQuestions||0)) p.totalQuestions = g.totalQuestions;
      p.updatedAt = now;
    }
    for(const x of gRows){
      const old = pktAttempt(p.id, x.agent.empId);
      if(old) state.pktAttempts = state.pktAttempts.filter(a=>a.id!==old.id);
      const stamp = pktBdNoon(g.testDate);
      const att = {
        id: pktAttId(p.id, x.agent.empId), pktId:p.id, empId:x.agent.empId, agentName:x.agent.name, tlName:x.agent.tlName||"", lob:x.agent.lob||"",
        status:"submitted", startedAt:stamp, submittedAt:stamp, answers:{}, qOrder:[], oOrder:{},
        correct: x.correct!==undefined ? x.correct : null, total: x.total!==undefined ? x.total : (p.totalQuestions||null),
        score:x.score, passed: x.score >= (Number(p.passMark)||0),
        timeTakenSec: x.timeMin!==null ? Math.round(x.timeMin*60) : 0, autoSubmitted:false,
        syncStatus:"pending", syncedIso: old ? (old.syncedIso||"") : "", updatedAt:now,
        backdated:true, testDate:g.testDate, uploadBatch:batchId
      };
      state.pktAttempts.push(att);
      // Daily Data (one PKT score per agent per week)
      const ex = pktFilledDayInWeek(att.empId, g.testDate);
      const own = ex && ex===att.syncedIso;
      if(b.force && ex && !own) att.replaced = {iso:ex, pkt:getDaily(att.empId, ex).pkt};
      const res = await pktSyncToDaily(att, b.force);
      att.syncStatus = res.ok ? "synced" : (res.reason==="week_has_score" ? "week_has_score" : "failed");
      att.syncedIso = res.ok ? res.iso : (att.syncedIso||"");
      if(res.ok) synced++; else if(res.reason==="week_has_score") weekKept++; else failed++;
    }
  }
  logAudit("pkt_backdated", `Uploaded ${ready.length} backdated PKT result${ready.length===1?"":"s"} across ${nPkt} PKT${nPkt===1?"":"s"} from "${b.fileName}" (${dates[0]} to ${dates[dates.length-1]})${weekKept ? `, ${weekKept} not written to Daily Data (week already scored)` : ""}`, {after:{batch:batchId, imported:ready.length, synced, weekKept, failed}});
  saveState();
  pktBd = {done:{imported:ready.length, pkts:nPkt, synced, weekKept, failed, skipped:b.rows.length-ready.length}, rows:[], groups:[], defaults:b.defaults, existing:"skip", force:false, dateFmt:b.dateFmt};
  showToast(`✅ ${ready.length} backdated PKT result${ready.length===1?"":"s"} uploaded`);
  render();
}
function pktBdBatches(){
  const map = new Map();
  (state.pkts||[]).forEach(p=>{
    if(!p.backdated || !p.uploadBatch) return;
    if(!map.has(p.uploadBatch)) map.set(p.uploadBatch, {id:p.uploadBatch, file:p.uploadFile||"", by:p.createdBy||"", at:p.createdAt||"", pkts:[], n:0, from:p.testDate, to:p.testDate});
    const b = map.get(p.uploadBatch); b.pkts.push(p);
    if(p.testDate<b.from) b.from=p.testDate; if(p.testDate>b.to) b.to=p.testDate;
  });
  map.forEach(b=>{ b.n = (state.pktAttempts||[]).filter(a=>a.uploadBatch===b.id).length; });
  return Array.from(map.values()).sort((x,y)=> String(y.at).localeCompare(String(x.at)));
}
async function pktBdUndo(batchId){
  const atts = (state.pktAttempts||[]).filter(a=>a.uploadBatch===batchId);
  const pkts = (state.pkts||[]).filter(p=>p.uploadBatch===batchId);
  if(!atts.length && !pkts.length) return;
  if(!confirm(`Undo this upload? ${pkts.length} PKT${pkts.length===1?"":"s"} and ${atts.length} result${atts.length===1?"":"s"} are removed, and the PKT scores it wrote into Daily Data are taken back out (a score it replaced is put back). Results added to those PKTs by a later upload are removed too.`)) return;
  if(!(await pktBdEnsureMonths(atts.map(a=>a.syncedIso).filter(Boolean)))){ showToast("⚠ Couldn't load Daily Data — check your connection and try again"); return; }
  let cleared = 0;
  atts.forEach(a=>{
    if(a.syncStatus==="synced" && a.syncedIso && Number(getDaily(a.empId, a.syncedIso).pkt)===Number(a.score)){
      setDaily(a.empId, a.syncedIso, {pkt:""}); cleared++;
      if(a.replaced && a.replaced.iso) setDaily(a.empId, a.replaced.iso, {pkt:a.replaced.pkt});
    }
  });
  const ids = new Set(pkts.map(p=>p.id));
  state.pkts = state.pkts.filter(p=>!ids.has(p.id));
  state.pktAttempts = state.pktAttempts.filter(a=> a.uploadBatch!==batchId && !ids.has(a.pktId));
  if(ids.has(pktResultsId)) pktResultsId = null;
  logAudit("pkt_backdated_undo", `Undid backdated PKT upload ${batchId} — removed ${pkts.length} PKT(s), ${atts.length} result(s); ${cleared} Daily Data score(s) cleared`, {before:{batch:batchId}});
  saveState(); showToast(`Removed ${atts.length} result${atts.length===1?"":"s"}`); render();
}

/* ---------- screen ---------- */
function pktBdOpen(){
  pktBd = {rows:[], groups:[], defaults:{title:"", date:"", lob:"", pass:""}, existing:"skip", force:false, dateFmt:"dmy", onlyIssues:false};
  pktView = "upload"; render();
}
function pktBdRender(content, topActions){
  if(!pktBd) pktBd = {rows:[], groups:[], defaults:{title:"", date:"", lob:"", pass:""}, existing:"skip", force:false, dateFmt:"dmy", onlyIssues:false};
  const b = pktBd, d = b.defaults;
  topActions.innerHTML = `<button class="btn btn-ghost" id="pktBdBack">← Back to PKTs</button>`;
  const batches = pktBdBatches();
  const lobs = (typeof LOB_OPTIONS!=="undefined" ? LOB_OPTIONS : []);
  const prevHtml = `<div style="margin-top:22px;"><div style="font-size:13px;font-weight:600;margin-bottom:8px;">Previous backdated uploads</div>
    ${batches.length ? `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>File</th><th>PKTs</th><th>Uploaded by</th><th>Uploaded</th><th class="num">Results</th><th>Test dates</th><th></th></tr></thead><tbody>${
      batches.map(x=>`<tr><td>${esc(x.file||"—")}</td><td style="white-space:normal;">${x.pkts.map(p=>esc(p.title)).join(", ")}</td><td>${esc(x.by)}</td><td>${pktFmtDateTime(x.at)}</td><td class="num">${x.n}</td><td class="mono">${esc(x.from)}${x.from!==x.to ? " → "+esc(x.to) : ""}</td>
        <td><button class="btn btn-ghost btn-sm" data-undo="${esc(x.id)}">↩ Undo upload</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="help-note">No backdated uploads yet.</div>`}</div>`;
  const intro = `<div class="help-note" style="margin-bottom:12px;">Bring in the <b>results</b> of a PKT that was held earlier. Each PKT is saved as a closed, <b>Backdated</b> PKT dated on the day it was held; scores go to Daily Data → PKT Score (%) on that day (one PKT score per agent per week, as usual) and show on the Dashboard, Month History and exports. Agents are not asked to take it.</div>`;
  const defaults = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:6px;">
      <div class="field"><label>PKT title <span style="color:var(--text-dim);">(if not in the file)</span></label><input type="text" id="pktBdTitle" value="${esc(d.title)}" placeholder="e.g. Week 37 PKT" style="width:100%;"></div>
      <div class="field"><label>Test date <span style="color:var(--text-dim);">(if not in the file)</span></label><input type="date" id="pktBdDate" value="${esc(d.date)}" max="${todayIso()}" style="width:100%;"></div>
      <div class="field"><label>Audience / LOB</label><select id="pktBdLob" style="width:100%;"><option value="">All LOBs</option>${lobs.map(l=>`<option value="${esc(l)}" ${d.lob===l?"selected":""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label>Pass mark (%) <span style="color:var(--text-dim);">(blank = ${esc(String(pktMetric().threshold))})</span></label><input type="number" id="pktBdPass" min="0" max="100" value="${esc(d.pass)}" style="width:100%;"></div>
    </div>`;
  const filePick = `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin:10px 0 14px;">
      <button class="btn btn-ghost btn-sm" id="pktBdTemplate">⬇ Download template</button>
      <div class="field" style="margin:0;"><label>Results file (.xlsx / .csv)</label><input type="file" id="pktBdFile" accept=".xlsx,.xls,.csv"></div>
      <div class="field" style="margin:0;"><label>Dates in the file are</label><select id="pktBdFmt" class="week-select"><option value="dmy" ${b.dateFmt==="dmy"?"selected":""}>Day / Month / Year</option><option value="mdy" ${b.dateFmt==="mdy"?"selected":""}>Month / Day / Year</option></select></div>
    </div>`;
  let preview = "";
  if(b.busy) preview = `<div class="help-note">Importing… please wait.</div>`;
  else if(b.done){
    const x = b.done;
    preview = `<div class="help-note" style="border-left:4px solid var(--green,#3caa5a);padding:10px 12px;margin-bottom:8px;"><b>✅ ${x.imported} result${x.imported===1?"":"s"} uploaded</b> into ${x.pkts} PKT${x.pkts===1?"":"s"}${x.skipped?` · ${x.skipped} row${x.skipped===1?"":"s"} skipped`:""}.<br>
      Daily Data: ${x.synced} score${x.synced===1?"":"s"} written${x.weekKept ? `, ${x.weekKept} left alone because that week already had a PKT score` : ""}${x.failed ? `, <b>${x.failed} failed</b> — use ⇪ Sync on the PKT's Results page` : ""}.
      <div style="margin-top:6px;"><button class="btn btn-ghost btn-sm" id="pktBdGoResults">📊 Open results</button></div></div>`;
  } else if(b.rows.length){
    const ready = b.rows.filter(pktBdRowReady), bad = b.rows.filter(x=>x.errors.length);
    const clash = ready.filter(x=>x.weekHas).length;
    const kpi = (l,v,c,s)=>`<div class="kpi"><div class="kpi-label">${esc(l)}</div><div class="kpi-value" ${c?`style="color:${c}"`:""}>${v}</div>${s?`<div class="kpi-target">${esc(s)}</div>`:""}</div>`;
    const showRows = (b.onlyIssues ? b.rows.filter(x=> !pktBdRowReady(x) || x.warnings.length || x.weekHas) : b.rows).slice(0,400);
    const groupOf = x => b.groups.find(g=>g.rows.includes(x));
    const trs = showRows.map(x=>{
      const g = groupOf(x);
      const st = x.errors.length ? `<span class="badge badge-red">Error</span>` : (x.exists && b.existing==="skip") ? `<span class="badge badge-yellow">Skipped (has result)</span>` : `<span class="badge badge-green">Ready</span>`;
      const pass = x.score!==null && g ? (x.score >= g.passMark ? `<span class="badge badge-green">Pass</span>` : `<span class="badge badge-red">Below</span>`) : "—";
      const dd = x.errors.length || !pktBdRowReady(x) ? "—" : x.weekHas ? (b.force ? `<span class="badge badge-yellow" title="Replaces ${esc(String(x.weekHas.pkt))} on ${esc(x.weekHas.iso)}">Replace</span>` : `<span class="badge badge-yellow" title="Week already has ${esc(String(x.weekHas.pkt))} (${esc(x.weekHas.iso)})">Week already scored</span>`) : `<span class="badge badge-green">Writes to ${esc(x.testDate)}</span>`;
      const notes = x.errors.concat(x.warnings).map(esc).join("<br>");
      return `<tr><td class="num">${x.rowNo}</td><td>${esc(x.title||"—")}</td><td class="mono">${esc(x.testDate||"—")}</td><td>${esc(x.agentLabel||"—")}</td>
        <td class="num">${x.score!==null && x.score!==undefined ? pktScoreBadge(x.score) : "—"}</td><td>${pass}</td><td>${st}</td><td>${dd}</td><td style="white-space:normal;font-size:12px;min-width:240px;">${notes||"—"}</td></tr>`;
    }).join("");
    preview = `
      <div style="font-size:13px;font-weight:600;margin:6px 0 10px;">Preview — ${esc(b.fileName)} · ${b.groups.length} PKT${b.groups.length===1?"":"s"}</div>
      <div class="kpi-grid" style="margin-bottom:14px;">${kpi("Rows read", b.rows.length)}${kpi("Ready to import", ready.length, ready.length?"var(--green)":"")}${kpi("With errors", bad.length, bad.length?"var(--red)":"")}${kpi("Week already scored", clash, clash?"var(--yellow)":"", "in Daily Data")}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px;font-size:13px;">
        <label>Agent already has a result for that PKT: <select id="pktBdExisting" class="week-select"><option value="skip" ${b.existing==="skip"?"selected":""}>Skip it</option><option value="replace" ${b.existing==="replace"?"selected":""}>Replace it</option></select></label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="pktBdForce" ${b.force?"checked":""}> Replace the week's score in Daily Data when one exists</label>
        <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="checkbox" id="pktBdOnly" ${b.onlyIssues?"checked":""}> Show only rows needing attention</label>
      </div>
      <div class="table-wrap" style="max-height:420px;overflow:auto;"><table class="mini-table" style="width:100%;"><thead><tr><th class="num">Row</th><th>PKT</th><th>Test date</th><th>Agent</th><th class="num">Score</th><th>Result</th><th>Status</th><th>Daily Data</th><th>Notes</th></tr></thead><tbody>${trs || `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:16px;">Everything is ready — nothing needs attention.</td></tr>`}</tbody></table></div>
      ${b.rows.length>400 && !b.onlyIssues ? `<div class="help-note" style="margin-top:6px;">Showing the first 400 rows; all ${b.rows.length} are processed on import.</div>` : ""}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <button class="btn btn-accent" id="pktBdImport" ${ready.length?"":"disabled"}>⬆ Import ${ready.length} result${ready.length===1?"":"s"}</button>
        ${bad.length ? `<button class="btn btn-ghost" id="pktBdIssues">⬇ Download issues (${bad.length})</button>` : ""}
        <button class="btn btn-ghost" id="pktBdClear">Clear</button>
      </div>`;
  }
  content.innerHTML = `<div class="section"><div class="section-head"><div class="section-title">📤 Upload past PKT results</div></div>
    <div class="section-body">${intro}${defaults}${filePick}${preview}${prevHtml}</div></div>`;
  pktBdWire(content);
}
function pktBdWire(content){
  const $ = id => content.querySelector("#"+id);
  const on = (id, ev, fn)=>{ const el = $(id); if(el) el.addEventListener(ev, fn); };
  const b = pktBd;
  // The Back button lives in the top bar (topActions), outside `content`, so look it up on the document.
  const backBtn = document.getElementById("pktBdBack");
  if(backBtn) backBtn.onclick = ()=>{ pktBd = null; pktView = "home"; render(); };
  on("pktBdTemplate","click", pktBdDownloadTemplate);
  const readDefaults = ()=>{ b.defaults = {title:$("pktBdTitle").value, date:$("pktBdDate").value, lob:$("pktBdLob").value, pass:$("pktBdPass").value}; };
  ["pktBdTitle","pktBdDate","pktBdLob","pktBdPass"].forEach(id=> on(id, "change", async ()=>{
    readDefaults();
    if(b.aoa){ try{ await pktBdParse(); }catch(e){ showToast("⚠ "+e.message); } render(); }
  }));
  on("pktBdFmt","change", async e=>{ b.dateFmt = e.target.value; if(b.aoa){ try{ await pktBdParse(); }catch(err){ showToast("⚠ "+err.message); } render(); } });
  const file = $("pktBdFile");
  if(file) file.addEventListener("change", async ()=>{
    const f = file.files[0]; if(!f) return;
    readDefaults(); showToast("Reading file…");
    try{
      const ext = f.name.split(".").pop().toLowerCase();
      if(typeof XLSX==="undefined") throw new Error("The Excel library didn't load — check your connection and try again.");
      const wb = ext==="csv" ? XLSX.read(await f.text(), {type:"string", cellDates:true}) : XLSX.read(await f.arrayBuffer(), {type:"array", cellDates:true});
      b.aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, defval:"", raw:true});
      b.fileName = f.name; b.done = null; b.onlyIssues = false;
      await pktBdParse();
      render();
    }catch(err){ console.error(err); b.aoa = null; b.rows = []; showToast("⚠ " + (err && err.message ? err.message : "Could not read that file")); render(); }
  });
  on("pktBdExisting","change", e=>{ b.existing = e.target.value; render(); });
  on("pktBdForce","change", e=>{ b.force = e.target.checked; render(); });
  on("pktBdOnly","change", e=>{ b.onlyIssues = e.target.checked; render(); });
  on("pktBdImport","click", pktBdImport);
  on("pktBdClear","click", ()=>{ const keep = b.defaults, fmt = b.dateFmt; pktBd = {rows:[], groups:[], defaults:keep, existing:"skip", force:false, dateFmt:fmt}; render(); });
  on("pktBdIssues","click", ()=>{
    const bad = b.rows.filter(x=>x.errors.length);
    const ws = XLSX.utils.aoa_to_sheet([["File row","PKT","Test date","Agent","Problem"], ...bad.map(x=>[x.rowNo, x.title, x.testDate, x.agentLabel, x.errors.join("; ")])]);
    ws["!cols"] = [{wch:9},{wch:28},{wch:12},{wch:26},{wch:110}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Issues"); XLSX.writeFile(wb, "Backdated_PKT_Issues.xlsx");
  });
  on("pktBdGoResults","click", ()=>{
    const last = pktAll().find(p=>p.backdated);
    pktBd = null; pktResultsId = last ? last.id : null; pktView = "results"; render();
  });
  content.querySelectorAll("[data-undo]").forEach(btn=> btn.addEventListener("click", ()=> pktBdUndo(btn.dataset.undo)));
}
