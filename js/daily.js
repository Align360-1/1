/* ---------------- Daily data access ---------------- */
function dKey(empId,iso){ return `${empId}__${iso}`; }
function emptyDailyRecord(){
  const rec = {attendance:"", leaveType:""};
  coreMetrics().forEach(m=>{ rec[m.field] = ""; });
  return rec;
}
function getDaily(empId,iso){
  const stored = state.daily[dKey(empId,iso)];
  const base = emptyDailyRecord();
  return stored ? Object.assign(base, stored) : base;
}
function setDaily(empId,iso,patch){
  const key = dKey(empId,iso);
  const cur = state.daily[key] || emptyDailyRecord();
  state.daily[key] = Object.assign({}, cur, patch);
  saveState();
}

/* ---------------- Aggregation ---------------- */
function monthDailyRows(mIdx,y, weekFilter){
  const rows = [];
  const nd = daysInMonth(mIdx,y);
  for(let d=1; d<=nd; d++){
    const iso = dateKey(y,mIdx,d);
    const wk = weekOfDay(y,mIdx,d);
    if(weekFilter && weekFilter!=="all" && wk!==Number(weekFilter)) continue;
    const wknd = isWeekend(y,mIdx,d);
    const agents = activeAgentsForDate(iso);
    agents.forEach(a=>{
      const rec = getDaily(a.empId,iso);
      const attendance = rec.attendance || (wknd ? "WeekOff" : "");
      rows.push(Object.assign({empId:a.empId, name:a.name, iso, d, week:wk, attendance}, rec, {attendance}));
    });
  }
  return rows;
}
// Cheap in-memory slice of an already-computed "all" row set — avoids rescanning
// the whole month (and re-walking the roster) once per week, which matters once
// a team has many agents and many months of history.
function filterRowsByWeek(rows, week){
  if(!week || week==="all") return rows;
  const w = Number(week);
  return rows.filter(r=>r.week===w);
}
function leaveDaysValue(attendance){
  if(attendance==="Leave") return 1;
  if(attendance==="Half day") return 0.5;
  return 0;
}
function agentAggregate(rows){
  const metrics = coreMetrics();
  const byAgent = {};
  rows.forEach(r=>{
    if(!byAgent[r.empId]) byAgent[r.empId] = {name:r.name, empId:r.empId, sums:{}, counts:{}, leaveDays:0, presentDays:0};
    const g = byAgent[r.empId];
    metrics.forEach(m=>{
      const v = r[m.field];
      if(v!==""&&v!=null&&!isNaN(v)){
        g.sums[m.field] = (g.sums[m.field]||0) + Number(v);
        g.counts[m.field] = (g.counts[m.field]||0) + 1;
      }
    });
    g.leaveDays += leaveDaysValue(r.attendance);
    if(r.attendance === "Present") g.presentDays++;
  });
  return Object.values(byAgent).map(g=>{
    const values = {};
    const colors = [];
    metrics.forEach(m=>{
      let val = null;
      if(g.counts[m.field]){
        if(m.field==="calls") val = g.sums[m.field];
        else if((m.inputType||"number")==="checkbox") val = (g.sums[m.field]/g.counts[m.field])*100;
        else val = g.sums[m.field]/g.counts[m.field];
      }
      values[m.field] = val;
      if(val!==null) colors.push(metricColor(m,val));
    });
    return {
      empId:g.empId, name:g.name, values,
      avgAht: values.aht ?? null, avgCq: values.cq ?? null, avgPkt: values.pkt ?? null, totalCalls: values.calls ?? 0,
      leaveDays: g.leaveDays, presentDays: g.presentDays,
      status: colors.length ? worstColor(colors) : null
    };
  });
}


function dailyVisibleAgentsForDate(iso){
  let agents = activeAgentsForDate(iso);
  if(dailyTLFilter!=="all") agents = agents.filter(a=>(a.tlName||"")===dailyTLFilter);
  if(dailyLOBFilter!=="all") agents = agents.filter(a=>(a.lob||"")===dailyLOBFilter);
  if(dailyAgentFilter!=="all") agents = agents.filter(a=>a.empId===dailyAgentFilter);
  return agents;
}
function buildDailyRowHtml(agent, iso, d, isFirst, groupSize, metrics, today, y, mIdx, wkndArg, pktWeekMap){
  const wknd = wkndArg!==undefined ? wkndArg : isWeekend(y,mIdx,d);
  const groupClass = d%2===0 ? "date-group-a" : "date-group-b";
  const rec = getDaily(agent.empId, iso);
  const attendance = rec.attendance || (wknd ? "WeekOff" : "");
  const isPast = iso < today;
  const blocked = !isPast && BLOCKED_ATTENDANCE.includes(attendance);
  const metricCells = metrics.map(m=>{
    const inputType = m.inputType || "number";
    let pktLocked = false, filledIso = null;
    if(m.field==="pkt"){
      if(pktWeekMap){
        const firstWeekday = new Date(y,mIdx,1).getDay();
        const mondayIdx = (firstWeekday+6)%7;
        const wk = Math.ceil((d+mondayIdx)/7);
        filledIso = pktWeekMap.get(agent.empId+"_"+wk) || null;
        pktLocked = !!filledIso && filledIso!==iso;
      } else {
        pktLocked = pktLockedForDate(agent.empId, iso);
        if(pktLocked) filledIso = pktFilledDayInWeek(agent.empId, iso);
      }
    }
    const locked = blocked || pktLocked;
    const filledDay = pktLocked && filledIso ? weekDayLabel(y,mIdx,Number(filledIso.split("-")[2])) : null;
    const title = pktLocked ? `title="PKT already entered for this week on ${filledDay} — only one PKT entry allowed per week"` : (m.field==="pkt" ? 'title="PKT Score can be entered on any one day of the week"' : '');
    if(inputType==="checkbox"){
      const checked = rec[m.field]===1 || rec[m.field]==="1";
      return `<td class="num"><input type="checkbox" class="cell-input" data-field="${m.field}" ${checked?'checked':''} ${locked?'disabled':''} ${title} style="width:16px;height:16px;"></td>`;
    }
    if(inputType==="radio"){
      const groupName = `radio_${esc(agent.empId)}_${iso}_${m.field}`;
      const opts = (m.options||[]).map(o=>`<label style="display:inline-flex;align-items:center;gap:2px;margin-right:6px;font-size:11px;white-space:nowrap;"><input type="radio" name="${groupName}" data-field="${m.field}" value="${esc(o)}" ${rec[m.field]===o?'checked':''} ${locked?'disabled':''}> ${esc(o)}</label>`).join("");
      return `<td>${opts||'<span style="color:var(--text-dim);">no options set</span>'}</td>`;
    }
    if(inputType==="dropdown"){
      const opts = (m.options||[]).map(o=>`<option value="${esc(o)}" ${rec[m.field]===o?'selected':''}>${esc(o)}</option>`).join("");
      return `<td><select class="cell-select" data-field="${m.field}" ${locked?'disabled':''} ${title}><option value="">—</option>${opts}</select></td>`;
    }
    const step = (m.field==="cq"||m.field==="pkt") ? "0.1" : "1";
    return `<td class="num"><input class="cell-input" type="number" step="${step}" data-field="${m.field}" value="${rec[m.field]??''}" style="${cellColorStyle(m,rec[m.field])}${pktLocked?';opacity:.45':''}" ${locked?'disabled':''} ${title} placeholder="${pktLocked?'Locked':'—'}"></td>`;
  }).join("");
  return `<tr class="${groupClass} ${wknd?'weekend-row':''} ${isFirst?'date-first-row':''}" data-emp="${esc(agent.empId)}" data-iso="${iso}">
    ${isFirst?`<td class="mono" rowspan="${groupSize}" style="vertical-align:top;font-weight:600;">${fmtDate(iso)}</td><td class="mono" rowspan="${groupSize}" style="vertical-align:top;">${weekDayLabel(y,mIdx,d)}</td>`:''}
    <td>${esc(agent.name)}</td>
    ${metricCells}
    <td><select class="cell-select" data-field="attendance">
          <option value="">—</option>
          ${ATTENDANCE_OPTIONS.map(o=>`<option value="${o}" ${o===attendance?'selected':''}>${o}</option>`).join("")}
        </select></td>
    <td><select class="cell-select" data-field="leaveType" ${attendance!=="Leave" && attendance!=="Half day" ? 'disabled':''}>
          <option value="">—</option>
          ${state.settings.leaveTypes.map(lt=>`<option value="${esc(lt.code)}" ${rec.leaveType===lt.code?'selected':''}>${esc(lt.code)}</option>`).join("")}
        </select></td>
  </tr>`;
}
function attachDailyRowHandlers(tr, metrics, today, mIdx, y){
  const empId = tr.dataset.emp, iso = tr.dataset.iso;
  tr.querySelectorAll("input,select").forEach(el=>{
    el.addEventListener("change", ()=>{
      const field = el.dataset.field;
      let val = el.type==="checkbox" ? (el.checked ? 1 : "") : el.value;
      const isPast = iso < today;
      const before = getDaily(empId, iso);
      const agent = state.roster.find(a=>a.empId===empId);
      const agentLabel = agent ? agent.name : empId;
      if(field==="attendance"){
        const beforeAttendance = before.attendance || "";
        const patch = {attendance:val};
        if(!isPast && BLOCKED_ATTENDANCE.includes(val)){
          metrics.forEach(m=> patch[m.field] = "");
        }
        if(val!=="Leave" && val!=="Half day") patch.leaveType="";
        setDaily(empId, iso, patch);
        if(beforeAttendance !== val){
          logAudit("daily_attendance", `Changed ${agentLabel}'s attendance for ${fmtDate(iso)} from ${beforeAttendance||"—"} to ${val||"—"}`,
            {empId, before:{attendance:beforeAttendance}, after:{attendance:val}});
        }
      } else {
        if(field==="pkt" && pktLockedForDate(empId, iso)) return;
        const beforeVal = before[field] ?? "";
        setDaily(empId, iso, {[field]: val});
        if(String(beforeVal) !== String(val)){
          const metricDef = metrics.find(m=>m.field===field);
          const metricLabel = metricDef ? metricDef.name : field;
          logAudit("daily_metric", `Changed ${agentLabel}'s ${metricLabel} for ${fmtDate(iso)} from ${beforeVal===""?"—":beforeVal} to ${val===""?"—":val}`,
            {empId, before:{[field]:beforeVal}, after:{[field]:val}});
        }
      }
      refreshDailyRows(field, empId, iso, metrics, today, mIdx, y);
    });
  });
}
function refreshDailyRows(field, empId, iso, metrics, today, mIdx, y){
  const tbody = document.querySelector("#content tbody");
  if(!tbody){ render(); return; }
  const targets = new Set([iso]);
  if(field==="pkt"){
    const [yy,mm,dd] = iso.split("-").map(Number);
    const wk = weekOfDay(yy,mm-1,dd);
    const nd = daysInMonth(mm-1,yy);
    for(let d=1; d<=nd; d++){
      if(weekOfDay(yy,mm-1,d)===wk) targets.add(dateKey(yy,mm-1,d));
    }
  }
  let ok = true;
  __rendering = true;
  try{
    targets.forEach(targetIso=>{
      if(!ok) return;
      try{
        const tr = tbody.querySelector(`tr[data-emp="${__cssEsc(empId)}"][data-iso="${__cssEsc(targetIso)}"]`);
        if(!tr) return; // not currently visible (different week/filter) — nothing to update
        const d = Number(targetIso.split("-")[2]);
        const dayAgents = dailyVisibleAgentsForDate(targetIso);
        const idxInGroup = dayAgents.findIndex(a=>a.empId===empId);
        if(idxInGroup===-1) return;
        const html = buildDailyRowHtml(dayAgents[idxInGroup], targetIso, d, idxInGroup===0, dayAgents.length, metrics, today, y, mIdx);
        const wrap = document.createElement("tbody");
        wrap.innerHTML = html.trim();
        const newTr = wrap.firstElementChild;
        tr.replaceWith(newTr);
        attachDailyRowHandlers(newTr, metrics, today, mIdx, y);
      }catch(e){ console.error(e); ok = false; }
    });
  } finally {
    __rendering = false;
  }
  if(!ok){ render(); return; }
  restoreTrackedFocus();
}
function renderDaily(content, topActions){
  const mIdx = currentMonthIdx(), y = viewYear();
  const nd = daysInMonth(mIdx,y);
  const weeksInMonth = weekOfDay(y, mIdx, nd);
  const today = todayIso();
  const metrics = coreMetrics();

  // With a large roster, "All weeks" means building a table with thousands of rows —
  // genuinely heavy for the browser to lay out, no matter how fast the JS behind it is.
  // Default to the current week the first time this loads so the common case (today's
  // entry) stays fast; "All weeks" is still one click away for anyone who wants the full month.
  if(!__dailyWeekFilterInitialized){
    __dailyWeekFilterInitialized = true;
    if(state.roster.length > 25 && dailyWeekFilter==="all"){
      const [ty,tm,td] = today.split("-").map(Number);
      if(ty===y && tm-1===mIdx){
        dailyWeekFilter = String(weekOfDay(y, mIdx, td));
      }
    }
  }

  if(isAgent()){
    dailyAgentFilter = currentAgentId();
    topActions.innerHTML = `
      <select class="week-select" id="dailyWeekSel">
        <option value="all" ${dailyWeekFilter==='all'?'selected':''}>All weeks</option>
        ${Array.from({length:weeksInMonth},(_,i)=>i+1).map(w=>`<option value="${w}" ${String(w)===dailyWeekFilter?'selected':''}>Week ${w}</option>`).join("")}
      </select>
      <span style="font-size:12px;color:var(--text-muted);margin-left:auto;">Logged in as <b>${esc(currentUser.name)}</b></span>
    `;
    document.getElementById("dailyWeekSel").addEventListener("change", e=>{ dailyWeekFilter = e.target.value; render(); });
  } else {
    if(isTL() && !currentUser.viewAll) dailyTLFilter = "all"; // TL is already scoped to their own team below
    topActions.innerHTML = `
      ${canViewAllTeams() ? `<select class="week-select" id="dailyTLSel">
        <option value="all" ${dailyTLFilter==='all'?'selected':''}>All TLs</option>
        ${(state.settings.tls||[]).map(tl=>`<option value="${esc(tl)}" ${dailyTLFilter===tl?'selected':''}>${esc(tl)}</option>`).join("")}
      </select>` : ""}
      <select class="week-select" id="dailyLOBSel">
        <option value="all" ${dailyLOBFilter==='all'?'selected':''}>All LOBs</option>
        ${LOB_OPTIONS.map(l=>`<option value="${esc(l)}" ${dailyLOBFilter===l?'selected':''}>${esc(l)}</option>`).join("")}
      </select>
      <select class="week-select" id="dailyAgentSel">
        <option value="all">All agents</option>
        ${scopedRoster().filter(a=>(dailyTLFilter==="all"||(a.tlName||"")===dailyTLFilter) && (dailyLOBFilter==="all"||(a.lob||"")===dailyLOBFilter)).map(a=>`<option value="${esc(a.empId)}" ${a.empId===dailyAgentFilter?'selected':''}>${esc(a.name)}</option>`).join("")}
      </select>
      <select class="week-select" id="dailyWeekSel">
        <option value="all" ${dailyWeekFilter==='all'?'selected':''}>All weeks</option>
        ${Array.from({length:weeksInMonth},(_,i)=>i+1).map(w=>`<option value="${w}" ${String(w)===dailyWeekFilter?'selected':''}>Week ${w}</option>`).join("")}
      </select>
      <button class="btn" id="importBtn">⬆ Import data</button>
      <button class="btn" id="applyWeekOffsBtn">🗓 Apply week-offs</button>
      <button class="btn btn-danger" id="clearDailyBtn">🗑 Clear data</button>
    `;
    document.getElementById("importBtn").addEventListener("click", openImportModal);
    const dailyTLSel = document.getElementById("dailyTLSel");
    if(dailyTLSel) dailyTLSel.addEventListener("change", e=>{ dailyTLFilter = e.target.value; dailyAgentFilter = "all"; render(); });
    document.getElementById("dailyLOBSel").addEventListener("change", e=>{ dailyLOBFilter = e.target.value; dailyAgentFilter = "all"; render(); });
    document.getElementById("dailyAgentSel").addEventListener("change", e=>{ dailyAgentFilter = e.target.value; render(); });
    document.getElementById("dailyWeekSel").addEventListener("change", e=>{ dailyWeekFilter = e.target.value; render(); });
  }

  if(!state.roster.length){
    content.innerHTML = `<div class="section"><div class="empty-state"><div class="big">◍</div><div class="disp" style="font-size:15px;font-weight:600;">No team members yet</div><p>Add agents in the Team Roster tab, or use "Import data" above to create them automatically from a file.</p></div></div>`;
    return;
  }

  const rows = [];
  const rosterInView = new Map();
  for(let d=1; d<=nd; d++){
    if(dailyWeekFilter!=="all" && weekOfDay(y,mIdx,d)!==Number(dailyWeekFilter)) continue;
    const iso = dateKey(y,mIdx,d);
    dailyVisibleAgentsForDate(iso).forEach(a=>{ rows.push({iso,d,agent:a}); rosterInView.set(a.empId,a); });
  }
  const pktWeekMap = metrics.some(m=>m.field==="pkt") ? buildPktWeekMap(mIdx, y, Array.from(rosterInView.values())) : null;

  let rowsHtml = "";
  if(!rows.length){
    rowsHtml = `<tr><td colspan="${metrics.length+5}"><div class="empty-state"><p>No days match this filter.</p></div></td></tr>`;
  } else {
    let idx = 0;
    while(idx < rows.length){
      const iso = rows[idx].iso;
      let j = idx;
      while(j<rows.length && rows[j].iso===iso) j++;
      const groupRows = rows.slice(idx,j);
      const d = groupRows[0].d;
      const wknd = isWeekend(y,mIdx,d);
      groupRows.forEach((r,k)=>{
        rowsHtml += buildDailyRowHtml(r.agent, r.iso, d, k===0, groupRows.length, metrics, today, y, mIdx, wknd, pktWeekMap);
      });
      idx = j;
    }
  }

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">◈</span>Daily entry — ${viewPeriod.month} ${viewPeriod.year}</div>
        <div class="help-note">Leave / Client holiday / WeekOff auto-clears and locks performance fields for today and future dates only. Backdated rows stay fully editable so you can add or correct history. PKT Score can be entered on <b>any one day</b> of the week — once you enter it for a week, the other days that week lock automatically so the Total PKT % stays accurate. Clear that day's value to unlock the week again.</div>
      </div>
      <div class="section-body table-wrap" style="max-height:66vh;overflow-y:auto;">
        <table><thead><tr>
          <th>Date</th><th>Day</th><th>Agent</th>${metrics.map(m=>`<th class="num">${esc(m.name)}</th>`).join("")}<th>Attendance</th><th>Leave Type</th>
        </tr></thead><tbody>${rowsHtml}</tbody></table>
      </div>
    </div>
  `;

  document.getElementById("applyWeekOffsBtn").addEventListener("click", ()=>{
    let changed = 0;
    for(let d=1; d<=nd; d++){
      if(!isWeekend(y,mIdx,d)) continue;
      const iso = dateKey(y,mIdx,d);
      activeAgentsForDate(iso).forEach(a=>{
        const rec = getDaily(a.empId, iso);
        if(rec.attendance !== "WeekOff"){
          const patch = {attendance:"WeekOff"};
          metrics.forEach(m=> patch[m.field] = "");
          setDaily(a.empId, iso, patch);
          changed++;
        }
      });
    }
    showToast(changed ? `🗓 Applied WeekOff to ${changed} entries` : "Nothing to change — weekends already marked");
    render();
  });

  document.getElementById("clearDailyBtn").addEventListener("click", ()=>{
    if(!rows.length){ showToast("Nothing in the current view to clear"); return; }
    const agentLabel = dailyAgentFilter==="all" ? "all agents" : `"${state.roster.find(a=>a.empId===dailyAgentFilter)?.name || "selected agent"}"`;
    const weekLabel = dailyWeekFilter==="all" ? "all weeks" : `Week ${dailyWeekFilter}`;
    showConfirm(`Clear entered values (metrics, attendance, leave type) for ${agentLabel}, ${weekLabel} of ${viewPeriod.month} ${viewPeriod.year}? This affects ${rows.length} row(s) currently shown below. Roster and Settings aren't touched. This can't be undone.`, ()=>{
      rows.forEach(r=>{ delete state.daily[dKey(r.agent.empId, r.iso)]; });
      saveState(); render();
      showToast(`🗑 Cleared ${rows.length} row(s)`);
    }, "Clear data");
  });

  content.querySelectorAll("tbody tr[data-emp]").forEach(tr=>{
    attachDailyRowHandlers(tr, metrics, today, mIdx, y);
  });
}
