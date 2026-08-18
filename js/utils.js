/* ---------------- Date / week helpers ---------------- */
function pad2(n){ return String(n).padStart(2,"0"); }
function dateKey(y,mIdx,d){ return `${y}-${pad2(mIdx+1)}-${pad2(d)}`; }
function daysInMonth(mIdx,y){ return new Date(y, mIdx+1, 0).getDate(); }
function isWeekend(y,mIdx,d){ const day = new Date(y,mIdx,d).getDay(); return day===0||day===6; }
function weekOfDay(y,mIdx,d){
  const firstWeekday = new Date(y,mIdx,1).getDay(); // 0=Sun..6=Sat
  const mondayIdx = (firstWeekday+6)%7; // Monday=0
  return Math.ceil((d+mondayIdx)/7);
}
function weekDayLabel(y,mIdx,d){
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(y,mIdx,d).getDay()];
}
function isMonday(y,mIdx,d){ return new Date(y,mIdx,d).getDay()===1; }
function pktLockedForDate(empId, iso){
  const [yy,mm,dd] = iso.split("-").map(Number);
  const mIdx = mm-1;
  const firstWeekday = new Date(yy,mIdx,1).getDay();
  const mondayIdx = (firstWeekday+6)%7;
  const wk = Math.ceil((dd+mondayIdx)/7);
  const nd = daysInMonth(mIdx,yy);
  const startD = Math.max(1, wk*7-mondayIdx-6);
  const endD = Math.min(nd, wk*7-mondayIdx);
  for(let d=startD; d<=endD; d++){
    const otherIso = dateKey(yy,mIdx,d);
    if(otherIso===iso) continue;
    const rec = getDaily(empId, otherIso);
    if(rec.pkt!==""&&rec.pkt!=null) return true;
  }
  return false;
}
function pktFilledDayInWeek(empId, iso){
  const [yy,mm,dd] = iso.split("-").map(Number);
  const mIdx = mm-1;
  const firstWeekday = new Date(yy,mIdx,1).getDay();
  const mondayIdx = (firstWeekday+6)%7;
  const wk = Math.ceil((dd+mondayIdx)/7);
  const nd = daysInMonth(mIdx,yy);
  const startD = Math.max(1, wk*7-mondayIdx-6);
  const endD = Math.min(nd, wk*7-mondayIdx);
  for(let d=startD; d<=endD; d++){
    const otherIso = dateKey(yy,mIdx,d);
    const rec = getDaily(empId, otherIso);
    if(rec.pkt!==""&&rec.pkt!=null) return otherIso;
  }
  return null;
}
function buildPktWeekMap(mIdx, y, agents){
  // One pass over (agent × day) instead of a fresh (agent × day × whole-month-scan) for every PKT cell.
  const map = new Map(); // `${empId}_${week}` -> filled iso
  const nd = daysInMonth(mIdx,y);
  const firstWeekday = new Date(y,mIdx,1).getDay();
  const mondayIdx = (firstWeekday+6)%7;
  agents.forEach(a=>{
    for(let d=1; d<=nd; d++){
      const iso = dateKey(y,mIdx,d);
      const rec = getDaily(a.empId, iso);
      if(rec.pkt!==""&&rec.pkt!=null){
        const wk = Math.ceil((d+mondayIdx)/7);
        const key = a.empId+"_"+wk;
        if(!map.has(key)) map.set(key, iso);
      }
    }
  });
  return map;
}
function fmtDate(iso){
  if(!iso) return "—";
  const [y,m,d] = iso.split("-");
  return `${d}-${MONTHS[+m-1].slice(0,3)}-${y}`;
}
function isoFromJSDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function todayIso(){ return isoFromJSDate(new Date()); }
function shiftDate(iso, delta){
  const [yy,mm,dd] = iso.split("-").map(Number);
  return isoFromJSDate(new Date(yy, mm-1, dd+delta));
}
function currentMonthIdx(){ return viewMonthIdx(); }


/* ---------------- Metric status logic ---------------- */
function metricColor(metric,value){
  if(value===""||value===null||value===undefined||isNaN(value)) return null;
  value = Number(value);
  if(metric.direction === "higher"){
    if(value >= metric.target) return "green";
    if(value < metric.threshold) return "red";
    return "yellow";
  } else {
    if(value <= metric.target) return "green";
    if(value > metric.threshold) return "red";
    return "yellow";
  }
}
// Catches a config mistake that wouldn't crash anything but would silently
// mislabel every value: threshold set on the wrong side of target for the
// chosen direction (e.g. "higher is better" with threshold above target).
function warnIfMetricMisconfigured(m){
  const t = m.inputType || "number";
  if(t!=="number" && t!=="checkbox") return;
  if(m.direction==="higher" && m.threshold > m.target){
    showToast(`⚠ "${m.name}": threshold (${m.threshold}) is above target (${m.target}) for a "higher is better" metric — check these, or the Red/Yellow/Green colors will be misleading.`);
  } else if(m.direction==="lower" && m.threshold < m.target){
    showToast(`⚠ "${m.name}": threshold (${m.threshold}) is below target (${m.target}) for a "lower is better" metric — check these, or the Red/Yellow/Green colors will be misleading.`);
  }
}
// Same green/yellow/red logic as metricColor, but respects direction:"none"
// (used by Daily Summary params that are just shown, not targeted — e.g. Forecast, FTE counts).
function dsColor(param, value){
  if(!param || param.direction!=="higher" && param.direction!=="lower") return null;
  return metricColor(param, value);
}
function worstColor(colors){
  const c = colors.filter(Boolean);
  if(!c.length) return null;
  if(c.includes("red")) return "red";
  if(c.includes("yellow")) return "yellow";
  return "green";
}
function coreMetrics(){
  return state.settings.metrics;
}
const COLOR_VAR = {green:"var(--green)", yellow:"var(--yellow)", red:"var(--red)"};
function cellColorStyle(metric,value){
  if(!metric || value===""||value===null||value===undefined) return "";
  const c = metricColor(metric,value);
  return c ? `color:${COLOR_VAR[c]};font-weight:600;` : "";
}
function attendanceBadge(a){
  if(!a) return `<span class="badge badge-gray">—</span>`;
  const map = {"Present":"green","Half day":"yellow","Leave":"red","Client holiday":"gray","WeekOff":"gray"};
  return `<span class="badge badge-${map[a]||"gray"}">${a}</span>`;
}
function slugField(name){
  let base = "m_" + name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
  if(!base || base==="m_") base = "m_metric";
  base = base.slice(0,24);
  let field = base, i=1;
  const existing = state.settings.metrics.map(m=>m.field);
  while(existing.includes(field)){ field = `${base}_${i}`; i++; }
  return field;
}
