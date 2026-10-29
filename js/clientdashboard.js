/* ---------------- Client dashboard ----------------
   What a Client login sees on the Dashboard tab instead of the team dashboard. A client gets a
   high-level overview only — no team/agent/roster data at all (no TL dropdown, no agent search,
   no per-agent tables, no team comparison). Layout:
     1. "Welcome to Align360" hero (same full-screen banner as everyone else, tagline removed)
     2. Daily Summary at a glance — latest day's numbers + trend charts
     3. LEO overview — this month's sup-call numbers + charts
     4. Process updates posted this week
   Data sources are the same ones the Daily Summary / LEO / Process Update tabs use
   (state.dailySummaryData, state.leoCalls, state.processUpdates), so nothing is calculated twice
   in a different way. The one remaining filter is LOB (top bar), which narrows all three sections.
   Everything here is read-only. */

let cdCharts = []; // live Chart.js instances, destroyed on every re-render

function cdDestroyCharts(){
  cdCharts.forEach(c=>{ try{ c.destroy(); }catch(e){} });
  cdCharts = [];
}

function cdFmt(v){
  if(v===null || v===undefined || v==="" || isNaN(v)) return "—";
  v = Number(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// Month/year being viewed (top-bar period picker); falls back to the current month if unset.
function cdPeriod(){
  const now = new Date();
  const m = viewMonthIdx();
  const y = viewYear();
  return {m: m>=0 ? m : now.getMonth(), y: y || now.getFullYear()};
}

function cdSection(icon, title, bodyHtml, actionsHtml){
  return `<div class="section" style="margin-bottom:16px;">
    <div class="section-head">
      <div class="section-title"><span class="eyebrow">${icon}</span>${esc(title)}</div>
      ${actionsHtml ? `<div class="section-actions">${actionsHtml}</div>` : ""}
    </div>
    <div class="section-body">${bodyHtml}</div>
  </div>`;
}
function cdEmpty(msg){
  return `<div class="empty-state" style="padding:20px;text-align:center;color:var(--text-dim);"><p>${esc(msg)}</p></div>`;
}
function cdKpi(label, valueHtml, subHtml, color){
  const colorVar = color==="green"?"var(--green)":color==="yellow"?"var(--yellow)":color==="red"?"var(--red)":"";
  return `<div class="kpi">
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-value" style="${colorVar?`color:${colorVar}`:""}">${valueHtml}</div>
    ${subHtml ? `<div class="kpi-target">${subHtml}</div>` : ""}
  </div>`;
}
function cdChartPalette(){
  return [getCssVar("--accent"), getCssVar("--green"), getCssVar("--yellow"), getCssVar("--red"), getCssVar("--text-dim"), getCssVar("--accent-daily")];
}
function cdAxisOpts(){
  return {
    x:{ticks:{color:getCssVar("--text-muted")}, grid:{display:false}},
    y:{beginAtZero:true, ticks:{color:getCssVar("--text-muted")}, grid:{color:getCssVar("--border")}}
  };
}

/* ---------- 1. Daily Summary at a glance ---------- */

// One entry per date (ascending). Across LOBs on the same date: "%" parameters are averaged,
// everything else (calls, FTE…) is summed. With a single LOB selected there is only one row per
// date, so this is just that row.
function cdDailyByDate(rows, params){
  const byDate = new Map();
  rows.forEach(r=>{ if(r.date){ if(!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); } });
  return Array.from(byDate.keys()).sort().map(date=>{
    const values = {};
    params.forEach(p=>{
      const nums = byDate.get(date)
        .map(r=> r.values ? r.values[p.field] : undefined)
        .filter(v=> v!==undefined && v!==null && v!=="" && !isNaN(Number(v)))
        .map(Number);
      if(!nums.length){ values[p.field] = null; return; }
      const sum = nums.reduce((a,b)=>a+b,0);
      values[p.field] = p.unit==="%" ? sum/nums.length : sum;
    });
    return {date, values};
  });
}

function cdDailySummaryHtml(days, params){
  if(!params.length) return cdEmpty("Daily Summary isn't configured yet.");
  if(!days.length) return cdEmpty("No Daily Summary data yet.");
  const latest = days[days.length-1];
  const prev = days.length>1 ? days[days.length-2] : null;

  const kpis = params.map(p=>{
    const v = latest.values[p.field];
    const color = (v!==null && (p.direction==="higher"||p.direction==="lower")) ? metricColor(p, v) : null;
    let sub = "";
    if(p.direction==="higher"||p.direction==="lower"){
      sub = `Target ${p.target}${p.unit==="%"?"%":""}`;
    } else if(prev && prev.values[p.field]!==null && v!==null){
      const d = v - prev.values[p.field];
      if(Math.abs(d) > 0.0001) sub = `${d>0?"▲":"▼"} ${cdFmt(Math.abs(d))}${p.unit==="%"?"%":""} vs previous day`;
    }
    return cdKpi(p.name, `${cdFmt(v)}${v!==null && p.unit ? `<span class="kpi-unit">${esc(p.unit)}</span>` : ""}`, sub, color);
  }).join("");

  return `
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Latest data: <b style="color:var(--text);">${esc(fmtDate(latest.date))}</b> (${esc(weekDayFromIso(latest.date))})</div>
    <div class="kpi-grid">${kpis}</div>
    <div class="chart-row" style="margin-top:16px;">
      <div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Call volume — last ${Math.min(14,days.length)} days</div><canvas id="cdVolumeChart" height="140"></canvas></div>
      <div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Service metrics (%) — last ${Math.min(14,days.length)} days</div><canvas id="cdPctChart" height="140"></canvas></div>
    </div>`;
}

function cdDailySummaryCharts(days, params){
  if(typeof Chart==="undefined" || !days.length) return;
  const recent = days.slice(-14);
  const labels = recent.map(d=> d.date.slice(8)+"/"+d.date.slice(5,7)); // DD/MM
  const palette = cdChartPalette();

  // Volume chart: prefer Forecast / Offered / Handled; otherwise the first three non-% parameters.
  const nonPct = params.filter(p=>p.unit!=="%");
  let volume = ["forecast","offered","handled"].map(f=>nonPct.find(p=>p.field===f)).filter(Boolean);
  if(!volume.length) volume = nonPct.slice(0,3);
  const volCanvas = document.getElementById("cdVolumeChart");
  if(volCanvas && volume.length){
    cdCharts.push(new Chart(volCanvas, {
      type:"line",
      data:{labels, datasets: volume.map((p,i)=>({
        label:p.name, data: recent.map(d=>d.values[p.field]),
        borderColor:palette[i%palette.length], backgroundColor:"transparent",
        spanGaps:true, tension:0.3, pointRadius:3, pointBackgroundColor:palette[i%palette.length]
      }))},
      options:{responsive:true, plugins:{legend:{labels:{color:getCssVar("--text-muted")}}, tooltip:{mode:"index", intersect:false}}, scales:cdAxisOpts()}
    }));
  }

  const pctParams = params.filter(p=>p.unit==="%").slice(0,4);
  const pctCanvas = document.getElementById("cdPctChart");
  if(pctCanvas && pctParams.length){
    cdCharts.push(new Chart(pctCanvas, {
      type:"line",
      data:{labels, datasets: pctParams.map((p,i)=>({
        label:p.name, data: recent.map(d=>d.values[p.field]),
        borderColor:palette[i%palette.length], backgroundColor:"transparent",
        spanGaps:true, tension:0.3, pointRadius:3, pointBackgroundColor:palette[i%palette.length]
      }))},
      options:{responsive:true, plugins:{legend:{labels:{color:getCssVar("--text-muted")}}, tooltip:{mode:"index", intersect:false}}, scales:cdAxisOpts()}
    }));
  }
}

/* ---------- 2. LEO overview ---------- */

function cdLeoData(){
  let calls = typeof scopedLeoCalls==="function" ? scopedLeoCalls(state.leoCalls||[]) : (state.leoCalls||[]);
  if(dashboardLOBFilter!=="all") calls = calls.filter(c=>(c.lob||"")===dashboardLOBFilter);
  const per = cdPeriod();
  const key = `${per.y}-${pad2(per.m+1)}`;
  const rep = leoReportCompute(calls, key); // excludes cancelled; items = [{c, week, d}]
  const items = rep.items;
  const resolved = items.filter(x=>x.c.status==="completed").length;
  const open = items.filter(x=>x.c.status==="open").length;
  const overdue = items.filter(x=>leoIsOverdue(x.c)).length;
  const loggedByWeek = rep.totalByWeek.slice();
  const resolvedByWeek = [0,0,0,0];
  items.forEach(x=>{ if(x.c.status==="completed") resolvedByWeek[x.week-1]++; });
  // Top reasons (max 5) with everything else rolled into "Other".
  const reasons = rep.types.filter(t=>t.total>0).sort((a,b)=>b.total-a.total);
  const top = reasons.slice(0,5).map(t=>({name:t.name, total:t.total}));
  const otherTotal = reasons.slice(5).reduce((s,t)=>s+t.total,0);
  if(otherTotal) top.push({name:"Other", total:otherTotal});
  return {key, total:rep.total, resolved, open, overdue, loggedByWeek, resolvedByWeek, reasons:top, ranges:leoReportWeekRanges(key)};
}

function cdLeoHtml(d){
  const rate = d.total ? Math.round((d.resolved/d.total)*100) : null;
  const kpis = [
    cdKpi("Total calls", cdFmt(d.total), `Logged in ${esc(leoReportMonthLabel(d.key))}`),
    cdKpi("Resolved", cdFmt(d.resolved), ""),
    cdKpi("Open", cdFmt(d.open), "Still being worked"),
    cdKpi("Overdue", cdFmt(d.overdue), "Past callback time", d.overdue>0 ? "red" : null),
    cdKpi("Resolution rate", rate===null ? "—" : `${rate}<span class="kpi-unit">%</span>`, "Resolved ÷ total")
  ].join("");
  if(!d.total){
    return `<div class="kpi-grid">${kpis}</div>${cdEmpty("No LEO calls logged for "+leoReportMonthLabel(d.key)+".")}`;
  }
  return `
    <div class="kpi-grid">${kpis}</div>
    <div class="chart-row" style="margin-top:16px;">
      <div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Calls by week</div><canvas id="cdLeoWeekChart" height="140"></canvas></div>
      <div><div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Calls by reason</div><canvas id="cdLeoReasonChart" height="140"></canvas></div>
    </div>`;
}

function cdLeoCharts(d){
  if(typeof Chart==="undefined" || !d.total) return;
  const palette = cdChartPalette();
  const weekCanvas = document.getElementById("cdLeoWeekChart");
  if(weekCanvas){
    cdCharts.push(new Chart(weekCanvas, {
      type:"bar",
      data:{
        labels: d.ranges.map((r,i)=>`Week ${i+1} (${r})`),
        datasets:[
          {label:"Logged", data:d.loggedByWeek, backgroundColor:palette[0], borderRadius:4},
          {label:"Resolved", data:d.resolvedByWeek, backgroundColor:palette[1], borderRadius:4}
        ]
      },
      options:{responsive:true, plugins:{legend:{labels:{color:getCssVar("--text-muted")}}}, scales:Object.assign(cdAxisOpts(), {y:{beginAtZero:true, ticks:{color:getCssVar("--text-muted"), precision:0}, grid:{color:getCssVar("--border")}}})}
    }));
  }
  const reasonCanvas = document.getElementById("cdLeoReasonChart");
  if(reasonCanvas && d.reasons.length){
    cdCharts.push(new Chart(reasonCanvas, {
      type:"doughnut",
      data:{labels:d.reasons.map(r=>r.name), datasets:[{data:d.reasons.map(r=>r.total), backgroundColor:d.reasons.map((r,i)=>palette[i%palette.length]), borderColor:getCssVar("--surface"), borderWidth:2}]},
      options:{responsive:true, plugins:{legend:{position:"right", labels:{color:getCssVar("--text-muted")}}}}
    }));
  }
}

/* ---------- 3. Process updates posted this week ---------- */

// Monday 00:00 of the current week (local time).
function cdWeekStart(){
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay()+6) % 7));
  return d;
}

function cdProcessUpdatesHtml(){
  const start = cdWeekStart().getTime();
  let updates = (state.processUpdates||[]).filter(u=> !u.archived && u.postedAt && new Date(u.postedAt).getTime() >= start);
  if(dashboardLOBFilter!=="all") updates = updates.filter(u=> !u.lob || u.lob===dashboardLOBFilter);
  updates = typeof sortProcessUpdates==="function" ? sortProcessUpdates(updates) : updates;
  if(!updates.length) return cdEmpty("No process updates have been posted this week.");
  return `<div style="display:flex;flex-direction:column;gap:10px;">
    ${updates.map(u=>`<div class="update-card${u.pinned?" pinned":""}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
        ${u.pinned ? `<span class="badge badge-yellow">📌 Pinned</span>` : ""}
        <span class="badge badge-gray">${esc(u.lob||"All LOBs")}</span>
        <b style="font-size:13px;">${esc(u.title)}</b>
      </div>
      <div style="font-size:12.5px;color:var(--text-muted);white-space:pre-wrap;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;">${updateBodyHtml(u)}</div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">${esc(new Date(u.postedAt).toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"short"}))}</div>
    </div>`).join("")}
  </div>`;
}

/* ---------- Page ---------- */

function renderClientDashboard(content, topActions){
  cdDestroyCharts();

  // Top bar: LOB filter only. No TL dropdown, no agent search, no export.
  topActions.innerHTML = `
    <select class="week-select" id="dashLOBSel">
      <option value="all" ${dashboardLOBFilter==="all"?"selected":""}>Complete data (all LOBs)</option>
      ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${dashboardLOBFilter===l?"selected":""}>${esc(l)}</option>`).join("")}
    </select>`;
  document.getElementById("dashLOBSel").addEventListener("change", e=>{ dashboardLOBFilter = e.target.value; render(); });

  // Daily summary rows for the chosen LOB.
  const params = (typeof dsActiveParams==="function" ? dsActiveParams() : []);
  let dsRows = (state.dailySummaryData||[]).slice();
  if(dashboardLOBFilter!=="all") dsRows = dsRows.filter(r=>r.lob===dashboardLOBFilter);
  const days = cdDailyByDate(dsRows, params);

  const leo = cdLeoData();

  const heroHtml = `<div class="dashboard-hero">
    <h1>Welcome to <span class="accent">Align360</span></h1>
    <div class="hero-arrow">↓</div>
  </div>`;

  const goBtn = (tab, label)=>`<button class="btn btn-ghost btn-sm cd-go" data-tab="${tab}">${label} →</button>`;

  content.innerHTML = `
    ${heroHtml}
    <div class="dash-context">
      <h1>Overview <span class="accent">·</span> ${esc(MONTHS[cdPeriod().m])} ${cdPeriod().y}</h1>
    </div>
    ${cdSection("◧", "Daily Summary", cdDailySummaryHtml(days, params), goBtn("dailysummary","Full daily summary"))}
    ${cdSection("☎", "LEO Overview", cdLeoHtml(leo), goBtn("leo","Open LEO"))}
    ${cdSection("📢", "Process Updates · This Week", cdProcessUpdatesHtml(), goBtn("processupdate","All updates"))}
  `;

  content.querySelectorAll(".cd-go").forEach(btn=>{
    btn.addEventListener("click", ()=>{ currentTab = btn.dataset.tab; render(); });
  });

  cdDailySummaryCharts(days, params);
  cdLeoCharts(leo);
}
