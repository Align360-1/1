function renderDashboard(content, topActions){
  const mIdx = currentMonthIdx(), y = viewYear();
  const metrics = coreMetrics();
  const chartableMetrics = metrics.filter(m=>{ const t=m.inputType||"number"; return t!=="radio" && t!=="dropdown"; });

  let trendRoster = scopedRoster();
  if(isAgent()){
    trendRoster = state.roster.filter(a=>a.empId===currentAgentId());
  } else {
    if(canViewAllTeams() && dashboardTLFilter!=="all") trendRoster = trendRoster.filter(a=>(a.tlName||"")===dashboardTLFilter);
    if(dashboardLOBFilter!=="all") trendRoster = trendRoster.filter(a=>(a.lob||"")===dashboardLOBFilter);
  }

  const monthFirst = dateKey(y,mIdx,1), monthLast = dateKey(y,mIdx,daysInMonth(mIdx,y));
  if(!dashSelectedDate || dashSelectedDate < monthFirst || dashSelectedDate > monthLast) dashSelectedDate = monthFirst;

  if(isAgent()){
    topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Logged in as <b>${esc(currentUser.name)}</b></span>`;
    trendAgentId = currentAgentId();
  } else {
    topActions.innerHTML = `
      ${canViewAllTeams() ? `<select class="week-select" id="dashTLSel">
        <option value="all" ${dashboardTLFilter==='all'?'selected':''}>Complete data (all TLs)</option>
        ${(state.settings.tls||[]).map(tl=>`<option value="${esc(tl)}" ${dashboardTLFilter===tl?'selected':''}>${esc(tl)}'s team</option>`).join("")}
      </select>` : `<span style="font-size:12px;color:var(--text-muted);">${esc(currentUser.tlName || currentUser.name)}'s team</span>`}
      <select class="week-select" id="dashLOBSel">
        <option value="all" ${dashboardLOBFilter==='all'?'selected':''}>Complete data (all LOBs)</option>
        ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${dashboardLOBFilter===l?'selected':''}>${esc(l)}</option>`).join("")}
      </select>
      <input type="text" class="week-select" id="dashSearchInput" placeholder="🔍 Search agent…" value="${esc(dashSearch)}" style="width:150px;">
      <button class="btn btn-accent" id="exportBtn">⬇ Export to Excel</button>
    `;
    document.getElementById("exportBtn").addEventListener("click", openExportModal);
    const dashTLSel = document.getElementById("dashTLSel");
    if(dashTLSel) dashTLSel.addEventListener("change", e=>{ dashboardTLFilter = e.target.value; render(); });
    document.getElementById("dashLOBSel").addEventListener("change", e=>{ dashboardLOBFilter = e.target.value; render(); });
    document.getElementById("dashSearchInput").addEventListener("input", e=>{ dashSearch = e.target.value; render(); });
  }

  let allRows = monthDailyRows(mIdx, y, "all");
  if(isAgent()){
    allRows = allRows.filter(r=>r.empId===currentAgentId());
  } else {
    if(canViewAllTeams() && dashboardTLFilter!=="all") allRows = allRows.filter(r=>agentTL(r.empId)===dashboardTLFilter);
    if(dashboardLOBFilter!=="all") allRows = allRows.filter(r=>agentLOB(r.empId)===dashboardLOBFilter);
  }
  const presentDays = allRows.filter(r=>r.attendance==="Present").length;
  const leaveDays = allRows.reduce((s,r)=>s+leaveDaysValue(r.attendance),0);
  const agg = agentAggregate(allRows);

  function gauge(label, value, unit, metric, extra){
    const hasVal = value!==null && value!==undefined && !isNaN(value);
    const color = hasVal && metric ? metricColor(metric, value) : null;
    const colorVar = color==="green"?"var(--green)":color==="yellow"?"var(--yellow)":color==="red"?"var(--red)":"var(--text-dim)";
    let pct = 0;
    if(hasVal && metric){
      const lo = Math.min(metric.target, metric.threshold), hi = Math.max(metric.target, metric.threshold);
      const span = hi-lo || 1;
      pct = Math.max(0, Math.min(100, ((value-lo)/span)*100));
    }
    return `<div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" style="${color?`color:${colorVar}`:''}">${hasVal? (Number.isInteger(value)?value:value.toFixed(1)) : "—"}<span class="kpi-unit">${unit||""}</span></div>
      ${metric ? `<div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${pct}%;background:${colorVar}"></div></div><div class="kpi-target">Target ${metric.target}${metric.unit==='%'?'%':''} · Threshold ${metric.threshold}</div>` : (extra?`<div class="kpi-target">${extra}</div>`:'')}
    </div>`;
  }

  const metricGauges = metrics.map(m=>{
    const arr = allRows.filter(r=>r[m.field]!==""&&r[m.field]!=null&&!isNaN(r[m.field])).map(r=>Number(r[m.field]));
    let val = null;
    if(arr.length){
      if(m.field==="calls") val = arr.reduce((a,b)=>a+b,0);
      else if((m.inputType||"number")==="checkbox") val = (arr.reduce((a,b)=>a+b,0)/arr.length)*100;
      else val = arr.reduce((a,b)=>a+b,0)/arr.length;
    }
    return gauge(m.name, val, m.unit, m);
  }).join("");

  const bestGauges = metrics.filter(m=>m.direction==="higher").map(m=>{
    const best = agg.filter(a=>a.values[m.field]!=null).sort((a,b)=>b.values[m.field]-a.values[m.field])[0];
    return gauge(`Best ${esc(m.name)}`, best?best.values[m.field]:null, m.unit, null, best?esc(best.name):"no data yet");
  }).join("");

  const kpiHtml = `<div class="kpi-grid">
    ${metricGauges}
    ${gauge("Present Days", presentDays, "", null, isAgent() ? "your total" : "sum across team")}
    ${gauge("Leave Days", leaveDays, "", null, isAgent() ? "your total" : "sum across team")}
  </div>`;
  // "Best" gauges are nice-to-know, not top-of-page material — surfaced lower, near the detail tables.
  const bestGaugesHtml = (!isAgent() && bestGauges) ? `<div class="kpi-grid kpi-grid-secondary">${bestGauges}</div>` : "";

  const weeksInMonth = weekOfDay(y, mIdx, daysInMonth(mIdx,y));
  const weekRows = filterRowsByWeek(allRows, dashWeek);
  let weekAgg = sortByRoster(agentAggregate(weekRows));
  const weekOptionsHtml = Array.from({length:weeksInMonth},(_,i)=>i+1).map(w=>`<option value="${w}" ${w===dashWeek?'selected':''}>Week ${w}</option>`).join("");
  let monthAgg = sortByRoster(agg);
  if(!isAgent() && dashSearch.trim()){
    const st = dashSearch.trim().toLowerCase();
    weekAgg = weekAgg.filter(a=>(a.name||"").toLowerCase().includes(st));
    monthAgg = monthAgg.filter(a=>(a.name||"").toLowerCase().includes(st));
  }

  // Exceptions: agents whose month-to-date status isn't green. Reuses the exact
  // same status/color logic already computed in agentAggregate() — nothing new
  // to calculate, just a filtered, priority-sorted view of it.
  const exceptionsAgg = monthAgg
    .filter(a => a.status === "red" || a.status === "yellow")
    .sort((a,b) => (a.status==="red"?0:1) - (b.status==="red"?0:1));
  const redCount = exceptionsAgg.filter(a=>a.status==="red").length;
  const yellowCount = exceptionsAgg.filter(a=>a.status==="yellow").length;

  // Operational alerts — things that need action, not just below-target metrics.
  // Only meaningful when viewing the current month (a past/future month has no
  // "missing attendance today", nothing "pending" retroactively, etc).
  const today = todayIso();
  const isCurrentMonthView = today >= monthFirst && today <= monthLast;
  let opsAlerts = [];
  if(!isAgent()){
    const inScope = a => {
      if(canViewAllTeams() && dashboardTLFilter!=="all" && (a.tlName||"")!==dashboardTLFilter) return false;
      if(dashboardLOBFilter!=="all" && (a.lob||"")!==dashboardLOBFilter) return false;
      return true;
    };
    const scoped = scopedRoster().filter(inScope);
    const scopedIds = new Set(scoped.map(a=>a.empId));

    if(isCurrentMonthView){
      const missingToday = activeAgentsForDate(today).filter(a=>scopedIds.has(a.empId) && !getDaily(a.empId, today).attendance);
      if(missingToday.length) opsAlerts.push({label:`${missingToday.length} missing today's attendance`, tab:"daily", onClick:()=>{ dailyAgentFilter="all"; }});
    }

    const pendingSwaps = (state.shiftSwaps||[]).filter(s=>s.status==="pending" && (scopedIds.has(s.requesterEmpId) || scopedIds.has(s.recipientEmpId)));
    if(pendingSwaps.length) opsAlerts.push({label:`${pendingSwaps.length} pending shift swap${pendingSwaps.length>1?'s':''}`, tab:"breaks"});

    const recentlyInactive = scoped.filter(a=>a.status==="Inactive" && a.inactiveSince && a.inactiveSince>=monthFirst && a.inactiveSince<=monthLast);
    if(recentlyInactive.length) opsAlerts.push({label:`${recentlyInactive.length} agent${recentlyInactive.length>1?'s':''} went inactive this month`, tab:"roster"});
  }
  const opsAlertsHtml = opsAlerts.length ? `<div class="ops-alerts">
    ${opsAlerts.map((o,i)=>`<button class="ops-alert-row" data-ops-idx="${i}">
      <span>${esc(o.label)}</span><span class="ops-alert-arrow">→</span>
    </button>`).join("")}
  </div>` : "";

  function statusBadge(s){
    if(!s) return `<span class="badge badge-gray">No data</span>`;
    const map = {green:"On track", yellow:"Watch", red:"At risk"};
    return `<span class="badge badge-${s}">${map[s]}</span>`;
  }
  function metricTableHead(){ return metrics.map(m=>`<th class="num">${esc(m.name)}</th>`).join(""); }
  function aggTableRows(list){
    if(!list.length) return `<tr><td colspan="${metrics.length+3}"><div class="empty-state" style="padding:20px;"><p>No entries for this period yet — add rows in Daily Data.</p></div></td></tr>`;
    return list.map(a=>{
      const cells = metrics.map(m=>{
        const val = a.values[m.field];
        const shown = val!=null ? (m.field==="calls"?Math.round(val):val.toFixed(1)) : "—";
        return `<td class="num" style="${cellColorStyle(m,val)}">${shown}</td>`;
      }).join("");
      const nameCell = isManager() ? `<span class="agent-name-link" data-empid="${esc(a.empId)}">${esc(a.name)}</span>` : esc(a.name);
      return `<tr><td>${nameCell}</td>${cells}<td class="num">${a.leaveDays}</td><td>${statusBadge(a.status)}</td></tr>`;
    }).join("");
  }

  const activeTab = ["weekly","monthly","daily"].includes(dashTablesTab) ? dashTablesTab : "weekly";

  let dateAgents = activeAgentsForDate(dashSelectedDate);
  if(isAgent()) dateAgents = dateAgents.filter(a=>a.empId===currentAgentId());
  if(canViewAllTeams() && dashboardTLFilter!=="all") dateAgents = dateAgents.filter(a=>(a.tlName||"")===dashboardTLFilter);
  if(dashboardLOBFilter!=="all") dateAgents = dateAgents.filter(a=>(a.lob||"")===dashboardLOBFilter);
  if(!isAgent() && dashSearch.trim()) dateAgents = dateAgents.filter(a=>(a.name||"").toLowerCase().includes(dashSearch.trim().toLowerCase()));
  const [dsy,dsm,dsd] = dashSelectedDate.split("-").map(Number);
  if(activeTab==="daily" && dashStatusFilter!=="all"){
    dateAgents = dateAgents.filter(a=>{
      const rec = getDaily(a.empId, dashSelectedDate);
      const att = rec.attendance || (isWeekend(dsy,dsm-1,dsd) ? "WeekOff" : "");
      return dashStatusFilter==="__blank" ? !att : att===dashStatusFilter;
    });
  }
  const dateRowsHtml = dateAgents.length ? dateAgents.map(a=>{
    const rec = getDaily(a.empId, dashSelectedDate);
    const attendance = rec.attendance || (isWeekend(dsy,dsm-1,dsd) ? "WeekOff" : "");
    const cells = metrics.map(m=>{
      const inputType = m.inputType || "number";
      const v = rec[m.field];
      if(inputType==="checkbox") return `<td class="num">${v===1||v==="1" ? "✓" : (v===0||v==="0" ? "—" : "—")}</td>`;
      if(inputType==="radio" || inputType==="dropdown") return `<td>${v!==""&&v!=null?esc(String(v)):"—"}</td>`;
      return `<td class="num" style="${cellColorStyle(m,v)}">${v!==""&&v!=null?v:"—"}</td>`;
    }).join("");
    const nameCell = isManager() ? `<span class="agent-name-link" data-empid="${esc(a.empId)}">${esc(a.name)}</span>` : esc(a.name);
    return `<tr><td>${nameCell}</td>${cells}<td>${attendanceBadge(attendance)}</td></tr>`;
  }).join("") : `<tr><td colspan="${metrics.length+2}"><div class="empty-state" style="padding:20px;"><p>No team members active on this date.</p></div></td></tr>`;

  const heroHtml = `<div class="dashboard-hero">
    <h1>Welcome to <span class="accent">Align360</span></h1>
    <p>Your personal performance dashboard — scroll down to see your metrics, weekly trends, and daily breakdown.</p>
    <div class="hero-arrow">↓</div>
  </div>`;

  const contextHtml = `<div class="dash-context">
    <h1>${isAgent() ? `Your dashboard` : `Team dashboard`} <span class="accent">·</span> ${esc(MONTHS[mIdx])} ${y}</h1>
    <p>${isAgent() ? esc(currentUser.name) : (canViewAllTeams() && dashboardTLFilter==="all" ? "All teams" : esc(currentUser.tlName || dashboardTLFilter))}</p>
  </div>`;

  const exceptionsHtml = isAgent() ? "" : `
    <div class="section section-exceptions ${(exceptionsAgg.length || opsAlerts.length) ? '' : 'no-exceptions'}">
      <div class="section-head">
        <div class="section-title">Attention Required</div>
        <span class="exceptions-count">${(exceptionsAgg.length || opsAlerts.length) ? `${redCount} at risk · ${yellowCount} watch · ${opsAlerts.length} operational` : 'All clear'}</span>
      </div>
      ${opsAlertsHtml ? `<div class="section-body" style="padding-bottom:0;">${opsAlertsHtml}</div>` : ""}
      <div class="section-body table-wrap">
        ${exceptionsAgg.length
          ? `<table><thead><tr><th>Agent</th>${metricTableHead()}<th class="num">Leave</th><th>Status</th></tr></thead><tbody>${aggTableRows(exceptionsAgg)}</tbody></table>`
          : (opsAlerts.length ? "" : `<div class="empty-state"><p>No agents at risk or on watch this month 🎉</p></div>`)}
      </div>
    </div>`;

  const tabLabels = {
    weekly: isAgent() ? 'Your Weekly Performance' : 'Weekly',
    monthly: isAgent() ? 'Your Monthly Summary' : 'Monthly',
    daily: 'Daily Data'
  };
  // Status filter for the weekly/monthly tables only affects the table shown here — the
  // KPI gauges, exceptions list, "best" gauges, and charts above stay computed from the
  // unfiltered weekAgg/monthAgg so the filter doesn't silently distort the rest of the page.
  let weekAggShown = weekAgg, monthAggShown = monthAgg;
  if(dashStatusFilter!=="all"){
    if(activeTab==="weekly") weekAggShown = weekAgg.filter(a=>(a.status||"none")===dashStatusFilter);
    else if(activeTab==="monthly") monthAggShown = monthAgg.filter(a=>(a.status||"none")===dashStatusFilter);
  }

  const tabTableHtml = activeTab === "weekly"
    ? `<table><thead><tr><th>Agent</th>${metricTableHead()}<th class="num">Leave</th><th>Status</th></tr></thead><tbody>${aggTableRows(weekAggShown)}</tbody></table>`
    : activeTab === "monthly"
    ? `<table><thead><tr><th>Agent</th>${metricTableHead()}<th class="num">Leave</th><th>Status</th></tr></thead><tbody>${aggTableRows(monthAggShown)}</tbody></table>`
    : `<table><thead><tr><th>Agent</th>${metricTableHead()}<th>Attendance</th></tr></thead><tbody>${dateRowsHtml}</tbody></table>`;

  content.innerHTML = `
    ${isAgent() ? notifPermissionBannerHtml() : ""}
    ${heroHtml}
    ${contextHtml}
    ${kpiHtml}
    ${exceptionsHtml}
    <div class="chart-row">
      <div class="section">
        <div class="section-head">
          <div class="section-title">Agent Trend</div>
          <div class="section-actions">
            ${!isAgent() && trendRoster.length ? `<select class="week-select" id="trendAgentSel">${trendRoster.map(a=>`<option value="${esc(a.empId)}" ${a.empId===trendAgentId?'selected':''}>${esc(a.name)}</option>`).join("")}</select>` : ""}
            ${chartableMetrics.length ? `<select class="week-select" id="trendMetricSel">${chartableMetrics.map(m=>`<option value="${m.field}" ${m.field===trendMetricField?'selected':''}>${esc(m.name)}</option>`).join("")}</select>` : ""}
          </div>
        </div>
        <div class="section-body">
          ${trendRoster.length && chartableMetrics.length ? `<canvas id="trendChart" height="140"></canvas>` : `<div class="empty-state"><p>Add team members and metrics to see trend charts.</p></div>`}
        </div>
      </div>
      ${isAgent() ? '' : `
      <div class="section">
        <div class="section-head">
          <div class="section-title">Team Comparison</div>
          <div class="section-actions">
            ${chartableMetrics.length ? `<select class="week-select" id="compareMetricSel">${chartableMetrics.map(m=>`<option value="${m.field}" ${m.field===compareMetricField?'selected':''}>${esc(m.name)}</option>`).join("")}</select>` : ""}
          </div>
        </div>
        <div class="section-body">
          ${monthAgg.length && chartableMetrics.length ? `<canvas id="compareChart" height="140"></canvas>` : `<div class="empty-state"><p>No data yet to compare.</p></div>`}
        </div>
      </div>
      `}
    </div>
    ${bestGaugesHtml}
    <div class="section">
      <div class="section-head">
        <div class="dash-tabs">
          <button class="dash-tab ${activeTab==='weekly'?'active':''}" data-tab="weekly">${esc(tabLabels.weekly)}</button>
          <button class="dash-tab ${activeTab==='monthly'?'active':''}" data-tab="monthly">${esc(tabLabels.monthly)}</button>
          <button class="dash-tab ${activeTab==='daily'?'active':''}" data-tab="daily">${esc(tabLabels.daily)}</button>
        </div>
        <div class="section-actions">
          ${activeTab==='weekly' ? `<select class="week-select" id="dashWeekSel">${weekOptionsHtml}</select>` : ''}
          ${activeTab==='daily' ? `
            <button class="icon-btn" id="dashPrevDay" ${dashSelectedDate<=monthFirst?'disabled':''}>‹</button>
            <input type="date" id="dashDateInput" value="${dashSelectedDate}" min="${monthFirst}" max="${monthLast}">
            <button class="icon-btn" id="dashNextDay" ${dashSelectedDate>=monthLast?'disabled':''}>›</button>
          ` : ''}
          ${activeTab==='weekly' || activeTab==='monthly' ? `
            <select class="week-select" id="dashStatusSel">
              <option value="all" ${dashStatusFilter==='all'?'selected':''}>All statuses</option>
              <option value="green" ${dashStatusFilter==='green'?'selected':''}>On track</option>
              <option value="yellow" ${dashStatusFilter==='yellow'?'selected':''}>Watch</option>
              <option value="red" ${dashStatusFilter==='red'?'selected':''}>At risk</option>
              <option value="none" ${dashStatusFilter==='none'?'selected':''}>No data</option>
            </select>
          ` : `
            <select class="week-select" id="dashStatusSel">
              <option value="all" ${dashStatusFilter==='all'?'selected':''}>All attendance</option>
              ${ATTENDANCE_OPTIONS.map(o=>`<option value="${esc(o)}" ${dashStatusFilter===o?'selected':''}>${esc(o)}</option>`).join("")}
              <option value="__blank" ${dashStatusFilter==='__blank'?'selected':''}>Not marked</option>
            </select>
          `}
        </div>
      </div>
      <div class="section-body table-wrap">
        ${tabTableHtml}
      </div>
    </div>
  `;

  content.querySelectorAll(".dash-tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{ dashTablesTab = btn.dataset.tab; dashStatusFilter = "all"; render(); });
  });
  content.querySelectorAll(".ops-alert-row").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const o = opsAlerts[Number(btn.dataset.opsIdx)];
      if(!o) return;
      if(o.onClick) o.onClick();
      currentTab = o.tab;
      render();
    });
  });

  if(isManager()){
    content.querySelectorAll(".agent-name-link").forEach(el=>{
      el.addEventListener("click", ()=>openAgentReportCard(el.dataset.empid));
    });
  }

  // Weekly/Daily controls only exist in the DOM when that tab is active.
  const dashWeekSel = document.getElementById("dashWeekSel");
  if(dashWeekSel) dashWeekSel.addEventListener("change", e=>{ dashWeek = Number(e.target.value); render(); });
  const dashDateInput = document.getElementById("dashDateInput");
  if(dashDateInput) dashDateInput.addEventListener("change", e=>{ dashSelectedDate = e.target.value; render(); });
  const dashStatusSel = document.getElementById("dashStatusSel");
  if(dashStatusSel) dashStatusSel.addEventListener("change", e=>{ dashStatusFilter = e.target.value; render(); });
  const prevBtn = document.getElementById("dashPrevDay"), nextBtn = document.getElementById("dashNextDay");
  if(prevBtn) prevBtn.addEventListener("click", ()=>{ dashSelectedDate = shiftDate(dashSelectedDate,-1); render(); });
  if(nextBtn) nextBtn.addEventListener("click", ()=>{ dashSelectedDate = shiftDate(dashSelectedDate,1); render(); });

  const trendSel = document.getElementById("trendAgentSel"), trendMetSel = document.getElementById("trendMetricSel");
  if(trendSel) trendSel.addEventListener("change", e=>{ trendAgentId = e.target.value; render(); });
  if(trendMetSel) trendMetSel.addEventListener("change", e=>{ trendMetricField = e.target.value; render(); });
  const compSel = document.getElementById("compareMetricSel");
  if(compSel) compSel.addEventListener("change", e=>{ compareMetricField = e.target.value; render(); });

  renderCharts(mIdx,y,chartableMetrics,monthAgg,trendRoster);
  wireNotifPermissionBanner();
}

/* ---------------- Agent Report Card (TL and above) ---------------- */
function closeReportCard(){
  document.querySelectorAll(".rc-overlay").forEach(o=>o.remove());
  document.removeEventListener("keydown", rcEscHandler);
}
function rcEscHandler(e){ if(e.key==="Escape") closeReportCard(); }

function openAgentReportCard(empId){
  if(!isManager()) return;
  const a = state.roster.find(x=>x.empId===empId);
  if(!a) return;
  const rcf = state.settings.reportCardFields || {};
  const on = (id)=> rcf[id]!==false; // default on unless explicitly turned off

  const mIdx = currentMonthIdx(), y = viewYear();
  const metrics = coreMetrics();
  const monthRows = monthDailyRows(mIdx,y,"all").filter(r=>r.empId===empId);
  const agg = agentAggregate(monthRows)[0] || null;

  function rcBadge(s){
    if(!s) return `<span class="badge badge-gray">No data</span>`;
    const map = {green:"On track", yellow:"Watch", red:"At risk"};
    return `<span class="badge badge-${s}">${map[s]}</span>`;
  }

  const infoItems = [];
  if(on("empId")) infoItems.push(`<div class="rc-item"><div class="label">Emp ID</div><div class="value mono">${esc(a.empId)}</div></div>`);
  if(on("tlName")) infoItems.push(`<div class="rc-item"><div class="label">Team Leader</div><div class="value">${esc(a.tlName||'—')}</div></div>`);
  if(on("lob")) infoItems.push(`<div class="rc-item"><div class="label">LOB</div><div class="value">${esc(a.lob||'—')}</div></div>`);
  if(on("status")) infoItems.push(`<div class="rc-item"><div class="label">Status</div><div class="value"><span class="badge ${a.status==='Active'?'badge-green':'badge-gray'}">${esc(a.status)}</span></div></div>`);
  if(on("shift")) infoItems.push(`<div class="rc-item"><div class="label">Shift</div><div class="value mono">${formatTime12(a.shiftStart)} – ${formatTime12(a.shiftEnd)}</div></div>`);
  if(on("joiningDate")) infoItems.push(`<div class="rc-item"><div class="label">Joining Date</div><div class="value">${a.joiningDate?fmtDate(a.joiningDate):'—'}</div></div>`);
  if(on("breaks")) infoItems.push(`<div class="rc-item"><div class="label">Breaks</div><div class="value mono" style="font-size:11px;">${formatTime12(a.break1Start)}–${formatTime12(a.break1End)}, ${formatTime12(a.break2Start)}–${formatTime12(a.break2End)}, Lunch ${formatTime12(a.lunchStart)}–${formatTime12(a.lunchEnd)}</div></div>`);
  if(on("inactiveSince")) infoItems.push(`<div class="rc-item"><div class="label">Inactive Since</div><div class="value">${a.inactiveSince?fmtDate(a.inactiveSince):'—'}</div></div>`);

  const summaryItems = [];
  if(on("presentDays")) summaryItems.push(`<div class="rc-item"><div class="label">Present Days</div><div class="value">${agg ? agg.presentDays : 0}</div></div>`);
  if(on("leaveDays")) summaryItems.push(`<div class="rc-item"><div class="label">Leave Days</div><div class="value">${agg ? agg.leaveDays : 0}</div></div>`);
  if(on("overallStatus")) summaryItems.push(`<div class="rc-item"><div class="label">Overall Status</div><div class="value">${rcBadge(agg ? agg.status : null)}</div></div>`);

  const metricRows = metrics.map(m=>{
    const val = agg ? agg.values[m.field] : null;
    const shown = val!=null ? (m.field==="calls"?Math.round(val):val.toFixed(1)) : "—";
    return `<tr><td>${esc(m.name)}</td><td class="num" style="${cellColorStyle(m,val)}">${shown}${val!=null && m.unit ? esc(m.unit) : ""}</td></tr>`;
  }).join("");

  const overlay = document.createElement("div");
  overlay.className = "rc-overlay";
  overlay.innerHTML = `
    <div class="rc-header">
      <div>
        <div class="rc-heading">${esc(a.name)}</div>
        <div class="rc-subheading">Report card · ${esc(MONTHS[mIdx])} ${y}</div>
      </div>
      <button class="btn btn-ghost" id="rcCloseBtn">✕ Close</button>
    </div>
    <div class="rc-body">
      ${infoItems.length ? `<div class="rc-section">
        <div class="rc-section-title">Profile</div>
        <div class="report-card-grid">${infoItems.join("")}</div>
        ${on("notes") && a.notes ? `<div class="rc-item" style="margin-top:6px;"><div class="label">Notes</div><div class="value">${esc(a.notes)}</div></div>` : ''}
      </div>` : ''}
      ${on("metrics") ? `<div class="rc-section">
        <div class="rc-section-title">This month's metrics</div>
        <div class="table-wrap">
          <table><thead><tr><th>Metric</th><th class="num">Value</th></tr></thead>
          <tbody>${metricRows || `<tr><td colspan="2" style="color:var(--text-dim);">No metrics configured</td></tr>`}</tbody></table>
        </div>
      </div>` : ''}
      ${summaryItems.length ? `<div class="rc-section">
        <div class="rc-section-title">Summary</div>
        <div class="report-card-grid">${summaryItems.join("")}</div>
      </div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  document.addEventListener("keydown", rcEscHandler);
  document.getElementById("rcCloseBtn").addEventListener("click", closeReportCard);
}

/* ---------------- DAILY DATA ---------------- */
