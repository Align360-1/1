/* ---------------- Leave detection (derived from Daily Data) ---------------- */
function isNextCalendarDay(isoA,isoB){
  const [ay,am,ad] = isoA.split("-").map(Number);
  return isoFromJSDate(new Date(ay,am-1,ad+1)) === isoB;
}
function computeLeaveRanges(filterEmpId){
  const byAgent = {};
  const scopedIds = isTL() ? new Set(scopedRoster().map(a=>a.empId)) : null;
  const monthKey = fbMonthKey(viewYear(), viewMonthIdx());
  Object.keys(state.daily).forEach(key=>{
    const sep = key.indexOf("__");
    const empId = key.slice(0,sep), iso = key.slice(sep+2);
    if(!iso.startsWith(monthKey)) return;
    const rec = state.daily[key];
    if(!rec.attendance || rec.attendance==="Present" || rec.attendance==="WeekOff") return;
    if(filterEmpId && filterEmpId!=="all" && empId!==filterEmpId) return;
    if(scopedIds && !scopedIds.has(empId)) return;
    if(!byAgent[empId]) byAgent[empId] = [];
    byAgent[empId].push({iso, attendance:rec.attendance, leaveType:rec.leaveType||""});
  });
  const ranges = [];
  Object.entries(byAgent).forEach(([empId,list])=>{
    list.sort((a,b)=>a.iso.localeCompare(b.iso));
    let cur = null;
    list.forEach(item=>{
      if(cur && cur.attendance===item.attendance && cur.leaveType===item.leaveType && isNextCalendarDay(cur.end,item.iso)){
        cur.end = item.iso;
        cur.days += (item.attendance==="Half day" ? 0.5 : 1);
      } else {
        if(cur) ranges.push(cur);
        cur = {empId, attendance:item.attendance, leaveType:item.leaveType, start:item.iso, end:item.iso, days:(item.attendance==="Half day"?0.5:1)};
      }
    });
    if(cur) ranges.push(cur);
  });
  return ranges.sort((a,b)=> b.start.localeCompare(a.start));
}


function renderLeave(content, topActions){
  if(isAgent()){
    leaveAgentFilter = currentAgentId();
    topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Showing your leave record</span>`;
  } else {
    topActions.innerHTML = `
      <select class="week-select" id="leaveAgentSel">
        <option value="all">All agents</option>
        ${scopedRoster().map(a=>`<option value="${esc(a.empId)}" ${a.empId===leaveAgentFilter?'selected':''}>${esc(a.name)}</option>`).join("")}
      </select>
    `;
    document.getElementById("leaveAgentSel").addEventListener("change", e=>{ leaveAgentFilter = e.target.value; render(); });
  }

  const ranges = computeLeaveRanges(leaveAgentFilter);
  const typeBadge = a => a==="Leave" ? "red" : a==="Half day" ? "yellow" : "gray";
  const rows = ranges.map(r=>{
    const agent = state.roster.find(a=>a.empId===r.empId);
    return `<tr>
      <td>${agent?esc(agent.name):esc(r.empId)}</td>
      <td><span class="badge badge-${typeBadge(r.attendance)}">${r.attendance}</span></td>
      <td class="mono">${r.leaveType||"—"}</td>
      <td class="mono">${fmtDate(r.start)}</td>
      <td class="mono">${fmtDate(r.end)}</td>
      <td class="num">${r.days}</td>
    </tr>`;
  }).join("");

  content.innerHTML = `
    <div class="section">
      <div class="section-body">
        <div class="help-note">This view is generated automatically from Daily Data attendance — consecutive days marked Leave, Half day, or Client holiday for the same agent and type are grouped into a single block, with the day count shown. It's read-only; change attendance in Daily Data to update it.</div>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><div class="section-title"><span class="eyebrow">▥</span>Continuous leave / absence blocks — ${esc(viewPeriod.month)} ${viewPeriod.year}</div></div>
      <div class="section-body table-wrap">
        ${ranges.length ? `<table><thead><tr><th>Agent</th><th>Type</th><th>Leave Code</th><th>Start</th><th>End</th><th class="num">Days</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<div class="empty-state"><div class="big">◔</div><p>No leave, half-day, or client-holiday entries recorded yet. Mark attendance in Daily Data to see them grouped here.</p></div>`}
      </div>
    </div>
  `;
}
