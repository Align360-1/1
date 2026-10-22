/* ---------------- Quality analyst dashboard ----------------
   What a Quality login sees on the Dashboard tab instead of the team dashboard. Same look and
   rhythm as the team dashboard (context header, KPI cards, section cards with tables), but every
   number is about THEIR OWN audit work, for the month picked in the top-bar period picker:
     - how many calls they audited (month, today, average per audit day)
     - how they split by LOB (Claims / Eligibility / UM Intake — the audited agent's roster LOB)
       and by call reason
     - the scores they've been giving (average, bands, Zero Tolerance flags)
     - which rubric parameters they flag most, and the agents they've covered
   Source of truth is qaVisibleAudits() (js/qualityaudit.js), which for a Quality login is exactly
   the audits that login submitted — so this page can never show anyone else's work. */

let qdLOB = "all"; // "all" | a LOB name | "Unassigned"

function qdMonthKey(){ return `${viewYear()}-${pad2(viewMonthIdx()+1)}`; }
function qdAvg(list){ return list.length ? list.reduce((s,a)=>s+a.score,0)/list.length : null; }
function qdPctOrDash(x){ return x===null ? "—" : qaPct(x); }
function qdScoreBadge(x){ return x===null ? `<span style="color:var(--text-dim);">—</span>` : `<span class="badge ${qaScoreClass(x)}">${qaPct(x)}</span>`; }
function qdCard(title, bodyHtml, actionsHtml){
  return `<div class="section" style="margin-bottom:16px;">
    <div class="section-head"><div class="section-title">${title}</div>${actionsHtml ? `<div class="section-actions">${actionsHtml}</div>` : ""}</div>
    <div class="section-body">${bodyHtml}</div></div>`;
}
function qdEmpty(msg){ return `<div class="empty-state" style="padding:18px;text-align:center;color:var(--text-dim);"><p>${esc(msg)}</p></div>`; }
// A thin horizontal share bar (0–100%).
function qdBar(frac){
  const w = Math.max(0, Math.min(100, Math.round(frac*100)));
  return `<div style="height:8px;min-width:90px;background:var(--surface-2);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${w}%;background:var(--accent);"></div></div>`;
}

// Rows grouped by key → [{key, list}] sorted by count desc (then name).
function qdGroup(list, keyFn){
  const m = new Map();
  list.forEach(a=>{ const k = keyFn(a) || "—"; if(!m.has(k)) m.set(k, []); m.get(k).push(a); });
  return Array.from(m.entries()).map(([key,l])=>({key, list:l})).sort((x,y)=> y.list.length - x.list.length || String(x.key).localeCompare(String(y.key)));
}

function qdLobTable(list){
  const groups = qdGroup(list, qaAuditLob);
  const byKey = new Map(groups.map(g=>[g.key, g.list]));
  // Always show every configured LOB (even at 0) so a coverage gap is visible, then any other LOB seen.
  const keys = LOB_OPTIONS.slice();
  groups.forEach(g=>{ if(!keys.includes(g.key)) keys.push(g.key); });
  const total = list.length;
  const rows = keys.map(k=>{
    const l = byKey.get(k) || [];
    const zt = l.filter(a=>a.ztp==="Not Met").length, low = l.filter(a=>a.score < 0.8).length;
    return `<tr style="${l.length ? "" : "opacity:.55;"}"><td><b>${esc(k)}</b></td><td class="num">${l.length}</td>
      <td style="min-width:110px;">${qdBar(total ? l.length/total : 0)}</td>
      <td class="num">${qdScoreBadge(qdAvg(l))}</td><td class="num">${zt}</td><td class="num">${low}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>LOB</th><th class="num">Audits</th><th>Share</th><th class="num">Avg score</th><th class="num">Zero Tol.</th><th class="num">Below 80%</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function qdReasonTable(list){
  const groups = qdGroup(list, a=>a.callReason), total = list.length;
  const rows = groups.map(g=>{
    const zt = g.list.filter(a=>a.ztp==="Not Met").length;
    return `<tr><td><b>${esc(g.key)}</b></td><td class="num">${g.list.length}</td><td style="min-width:110px;">${qdBar(total ? g.list.length/total : 0)}</td><td class="num">${qdScoreBadge(qdAvg(g.list))}</td><td class="num">${zt}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Call reason</th><th class="num">Audits</th><th>Share</th><th class="num">Avg score</th><th class="num">Zero Tol.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Audits per calendar day of the viewed month, as plain CSS bars (no chart library needed).
function qdDailyBars(list){
  const mIdx = viewMonthIdx(), y = viewYear(), n = daysInMonth(mIdx, y), today = todayIso();
  const counts = Array.from({length:n}, ()=>0);
  list.forEach(a=>{ const d = Number(String(a.auditDate).slice(8,10)); if(d>=1 && d<=n) counts[d-1]++; });
  const max = Math.max(1, ...counts);
  const bars = counts.map((c,i)=>{
    const d = i+1, iso = dateKey(y, mIdx, d), wknd = isWeekend(y, mIdx, d);
    const h = c ? Math.max(6, Math.round((c/max)*96)) : 2;
    return `<div title="${esc(iso)} — ${c} audit${c===1?"":"s"}" style="flex:1 0 18px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;${wknd ? "opacity:.5;" : ""}">
      <div style="font-size:10px;color:var(--text-muted);height:12px;">${c || ""}</div>
      <div style="width:100%;max-width:22px;height:${h}px;border-radius:3px 3px 0 0;background:${c ? "var(--accent)" : "var(--border)"};"></div>
      <div style="font-size:10px;${iso===today ? "color:var(--accent);font-weight:700;" : "color:var(--text-dim);"}">${d}</div></div>`;
  }).join("");
  return `<div style="overflow-x:auto;"><div style="display:flex;align-items:flex-end;gap:3px;min-width:${n*22}px;height:140px;">${bars}</div></div>
    <div class="help-note" style="margin-top:8px;">Audits submitted per day. Weekends are dimmed.</div>`;
}

function qdWeeklyTable(list){
  const n = daysInMonth(viewMonthIdx(), viewYear());
  const weeks = [];
  for(let s=1; s<=n; s+=7) weeks.push({from:s, to:Math.min(s+6, n), list:[]});
  list.forEach(a=>{ const d = Number(String(a.auditDate).slice(8,10)); const w = weeks.find(x=> d>=x.from && d<=x.to); if(w) w.list.push(a); });
  const rows = weeks.map((w,i)=>`<tr><td>Week ${i+1} <span style="color:var(--text-dim);font-size:11px;">(${w.from}–${w.to})</span></td><td class="num">${w.list.length}</td><td class="num">${qdScoreBadge(qdAvg(w.list))}</td><td class="num">${w.list.filter(a=>a.ztp==="Not Met").length}</td></tr>`).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Week</th><th class="num">Audits</th><th class="num">Avg score</th><th class="num">Zero Tol.</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// Which rubric parameters this analyst tags "No" most, with the error category they pick most for each.
function qdFlaggedTable(list){
  const stats = QA_PARAMS.map(p=>{
    let flagged = 0; const errs = new Map();
    list.forEach(a=>{
      const v = a.params && a.params[p.n];
      if(v && v.tag === "No"){ flagged++; const e = v.error || "—"; errs.set(e, (errs.get(e)||0)+1); }
    });
    const top = Array.from(errs.entries()).sort((x,y)=> y[1]-x[1])[0];
    return {p, flagged, top};
  }).filter(s=>s.flagged).sort((x,y)=> y.flagged - x.flagged || y.p.pts - x.p.pts).slice(0, 8);
  if(!stats.length) return qdEmpty("No parameters tagged “No” in this period.");
  const rows = stats.map(s=>`<tr><td><b>${s.p.n}.</b> ${esc(s.p.name)}<div style="font-size:11px;color:var(--text-dim);">${esc(s.p.cat)} · ${s.p.pts} pts</div></td>
    <td class="num">${s.flagged}</td><td class="num">${qaPct(s.flagged/list.length)}</td><td>${esc(s.top[0])} <span style="color:var(--text-dim);">×${s.top[1]}</span></td></tr>`).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Parameter</th><th class="num">Flagged</th><th class="num">% of audits</th><th>Most-used error category</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function qdAgentsTable(list){
  const groups = qdGroup(list, a=>a.agentEmpId);
  const rows = groups.slice(0, 20).map(g=>{
    const first = g.list[0], lowest = Math.min(...g.list.map(a=>a.score));
    const latest = g.list.map(a=>a.auditDate).sort().slice(-1)[0];
    return `<tr><td>${esc(first.agentName)}</td><td>${esc(qaAuditLob(first))}</td><td class="num">${g.list.length}</td><td class="num">${qdScoreBadge(qdAvg(g.list))}</td><td class="num">${qdScoreBadge(lowest)}</td><td class="mono">${esc(latest)}</td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Agent</th><th>LOB</th><th class="num">Audits</th><th class="num">Avg score</th><th class="num">Lowest</th><th>Last audit</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${groups.length > 20 ? `<div class="help-note" style="margin-top:8px;">Showing the 20 most-audited of ${groups.length} agents.</div>` : ""}`;
}

function qdRecentTable(list){
  const rows = list.slice().sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||"")).slice(0, 8).map(a=>`<tr>
    <td class="mono">${esc(a.auditDate)}</td><td>${esc(a.agentName)}</td><td>${esc(qaAuditLob(a))}</td><td class="mono">${esc(a.callId)}</td>
    <td class="num"><span class="badge ${qaScoreClass(a.score)}">${qaPct(a.score)}</span></td>
    <td>${a.ztp==="Not Met" ? `<span class="badge badge-red" title="${esc(a.ztpError)}">Not Met</span>` : `<span style="color:var(--text-dim);">Met</span>`}</td>
    <td><button class="btn btn-ghost btn-sm qd-view-btn" data-id="${esc(a.id)}">View</button></td></tr>`).join("");
  return `<div class="table-wrap"><table class="mini-table" style="width:100%;"><thead><tr><th>Date</th><th>Agent</th><th>LOB</th><th>Call ID</th><th class="num">Score</th><th>Zero Tol.</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderQualityDashboard(content, topActions){
  const mine = qaVisibleAudits();                                   // this login's own audits, all time
  const lobOptions = LOB_OPTIONS.concat(mine.some(a=>qaAuditLob(a)==="Unassigned") ? ["Unassigned"] : []);
  if(qdLOB !== "all" && !lobOptions.includes(qdLOB)) qdLOB = "all";
  const scoped = qdLOB === "all" ? mine : mine.filter(a=> qaAuditLob(a) === qdLOB);
  const key = qdMonthKey();
  const list = scoped.filter(a=> qaMonthKey(a) === key);

  topActions.innerHTML = `
    <select class="week-select" id="qdLobSel">
      <option value="all" ${qdLOB==="all"?"selected":""}>All LOBs</option>
      ${lobOptions.map(l=>`<option value="${esc(l)}" ${qdLOB===l?"selected":""}>${esc(l)}</option>`).join("")}
    </select>
    <button class="btn btn-accent" id="qdNewAuditBtn">📝 New audit</button>`;

  const total = list.length;
  const today = todayIso();
  const todayCount = scoped.filter(a=> a.auditDate === today).length;
  const auditDays = new Set(list.map(a=>a.auditDate)).size;
  const zt = list.filter(a=>a.ztp==="Not Met").length;
  const bands = {hi: list.filter(a=>a.score >= 0.9).length, mid: list.filter(a=>a.score >= 0.8 && a.score < 0.9).length, low: list.filter(a=>a.score < 0.8).length};
  const kpi = (l,v,sub)=>`<div class="kpi"><div class="kpi-label">${esc(l)}</div><div class="kpi-value">${v}</div>${sub ? `<div style="font-size:11px;color:var(--text-dim);margin-top:2px;">${sub}</div>` : ""}</div>`;

  const kpiHtml = `<div class="kpi-grid" style="margin-bottom:16px;">
    ${kpi("Calls audited", total, esc(MONTHS[viewMonthIdx()]) + " " + viewYear())}
    ${kpi("Audited today", todayCount)}
    ${kpi("Avg per audit day", auditDays ? (Math.round(total/auditDays*10)/10) : "—", auditDays ? `${auditDays} day${auditDays===1?"":"s"} with audits` : "")}
    ${kpi("Avg score given", qdPctOrDash(qdAvg(list)))}
    ${kpi("Agents audited", new Set(list.map(a=>a.agentEmpId)).size)}
    ${kpi("Zero Tolerance not met", zt)}
  </div>`;

  const contextHtml = `<div class="dash-context">
    <h1>Your quality dashboard <span class="accent">·</span> ${esc(MONTHS[viewMonthIdx()])} ${viewYear()}</h1>
    <p>${esc(currentUser.name)} · ${qdLOB==="all" ? "All LOBs" : esc(qdLOB)}</p></div>`;

  let body;
  if(!mine.length){
    body = qdCard("Get started", qdEmpty("You haven't submitted any audits yet. Use “New audit” to log your first one — your numbers will appear here."));
  } else if(!total){
    body = qdCard("No audits in this period", qdEmpty(`You haven't submitted any audits${qdLOB==="all" ? "" : " for " + qdLOB} in ${MONTHS[viewMonthIdx()]} ${viewYear()}. Pick another month in the top bar${qdLOB==="all" ? "" : " or switch the LOB filter"}.`));
  } else {
    body = `
    <div class="chart-row">
      ${qdCard("Audits by LOB", qdLobTable(list))}
      ${qdCard("Audits by call reason", qdReasonTable(list))}
    </div>
    <div class="chart-row">
      ${qdCard("Audits per day", qdDailyBars(list))}
      ${qdCard("Weekly", qdWeeklyTable(list))}
    </div>
    ${qdCard("Scores you gave", `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
        ${[["90% and above", bands.hi, "badge-green"],["80% – 89.9%", bands.mid, "badge-yellow"],["Below 80%", bands.low, "badge-red"]].map(([l,c,cls])=>`<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--surface-2);"><span class="badge ${cls}">${l}</span><div style="font-size:22px;font-weight:600;margin-top:6px;">${c}</div><div style="font-size:11px;color:var(--text-dim);">${qaPct(total ? c/total : 0)} of your audits</div></div>`).join("")}</div>`)}
    ${qdCard("Parameters you flag most", qdFlaggedTable(list))}
    ${qdCard("Agents you audited", qdAgentsTable(list))}
    ${qdCard("Recent audits", qdRecentTable(list), `<button class="btn btn-ghost btn-sm" id="qdAllAuditsBtn">All my audits →</button>`)}`;
  }

  content.innerHTML = `${contextHtml}${kpiHtml}${body}`;

  const lobSel = document.getElementById("qdLobSel");
  if(lobSel) lobSel.addEventListener("change", e=>{ qdLOB = e.target.value; render(); });
  const goQa = (sub, id)=>{ currentTab = "qualityaudit"; qaSubTab = sub; qaViewId = id || null; render(); };
  const nb = document.getElementById("qdNewAuditBtn"); if(nb) nb.addEventListener("click", ()=> goQa("new"));
  const ab = document.getElementById("qdAllAuditsBtn"); if(ab) ab.addEventListener("click", ()=> goQa("audits"));
  content.querySelectorAll(".qd-view-btn").forEach(b=> b.addEventListener("click", ()=> goQa("audits", b.dataset.id)));
}
