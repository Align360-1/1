/* ---------------- LEO — monthly Report tab ----------------
   Replaces the manual month-end tally. For the chosen month it shows:
     1. Total escalated cases per week (Week 1-4)
     2. Type of escalation (the call's Reason) per week
     3. Resolution per week — Resolved, Voicemail left, Closed to backend,
        Escalated to recoupment team
   ...and downloads the same numbers (plus a raw "Calls" sheet to check them
   against) as an Excel file. The Excel file is laid out like the team's manual
   summary: Month/Week | Escalation Type | Resolution Disposition side by side
   (see "Styled Excel export" at the bottom of this file).

   Rules the numbers follow:
   - A call belongs to the month/week it was LOGGED (createdAt), local time.
   - Weeks are fixed day ranges: W1 = 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-end of
     month (so days 29-31 land in Week 4).
   - Cancelled calls (an agent withdrawing their own mistake) are left out of
     every count and reported separately as a footnote.
   - "Resolved" comes from the call's status. Every other row is an Action from
     the dropdown (LEO_ACTION_OPTIONS), so each call counts in exactly one of
     those rows (or "No action yet"). A call can be both Resolved and
     have an Action, so Resolved overlaps the action rows; the action rows
     together add up to the total.
   - Scope is the same as the queue: scopedLeoCalls() decides which calls the
     viewer's report covers.
*/
let leoReportMonthKey = ""; // "YYYY-MM"; "" means the current month

// Resolution rows are built live from the Action dropdown (LEO_ACTION_OPTIONS in js/leo.js),
// so adding/removing/renaming an action there changes this report with no other edits:
//   "Resolved" (the call's status), then one row per action in dropdown order, then any
//   action found on a call that is no longer in the dropdown, then "No action yet".
function leoReportResolutionRows(inMonth){
  const actions = LEO_ACTION_OPTIONS.slice();
  inMonth.forEach(x=>{
    const a = (x.c.action||"").trim();
    if(a && !actions.includes(a)) actions.push(a);
  });
  return [
    {id:"resolved", label:"Resolved", test: c => c.status === "completed"},
    ...actions.map(a=>({id:"action:"+a, label:a, test: c => (c.action||"").trim() === a})),
    {id:"noaction", label:LEO_REPORT_NO_ACTION, test: c => !(c.action||"").trim()}
  ];
}

function leoReportKeyOf(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function leoReportWeekOf(day){ return day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4; }
function leoReportLoggedDate(c){
  const d = c && c.createdAt ? new Date(c.createdAt) : null;
  return d && !isNaN(d) ? d : null;
}
function leoReportParseKey(key){
  const m = /^(\d{4})-(\d{2})$/.exec(key||"");
  if(m) return {year:Number(m[1]), month:Number(m[2])-1};
  const now = new Date();
  return {year:now.getFullYear(), month:now.getMonth()};
}
function leoReportMonthLabel(key){
  const p = leoReportParseKey(key);
  return `${MONTHS[p.month]} ${p.year}`;
}
function leoReportWeekRanges(key){
  const p = leoReportParseKey(key);
  const last = new Date(p.year, p.month+1, 0).getDate();
  return [`1–7`,`8–14`,`15–21`,`22–${last}`];
}
// Every month that has at least one call, plus the current month, newest first.
function leoReportMonthOptions(calls){
  const keys = new Set([leoReportKeyOf(new Date())]);
  calls.forEach(c=>{ const d = leoReportLoggedDate(c); if(d) keys.add(leoReportKeyOf(d)); });
  return Array.from(keys).sort().reverse();
}

function leoReportCompute(calls, key){
  const inMonth = [];
  let cancelled = 0;
  calls.forEach(c=>{
    const d = leoReportLoggedDate(c);
    if(!d || leoReportKeyOf(d) !== key) return;
    if(c.status === "cancelled"){ cancelled++; return; }
    inMonth.push({c, week: leoReportWeekOf(d.getDate()), d});
  });
  const zeros = ()=> [0,0,0,0];
  const sum = a => a.reduce((x,y)=>x+y,0);

  const totalByWeek = zeros();
  inMonth.forEach(x=> totalByWeek[x.week-1]++);

  // Types: master list first (so the table keeps a stable shape even for a quiet month),
  // then any reason found in the data that is no longer on the list, then "(No reason)".
  const names = (state.settings.leoReasons||[]).slice();
  inMonth.forEach(x=>{
    const r = (x.c.reason||"").trim();
    if(r && !names.includes(r)) names.push(r);
  });
  if(inMonth.some(x=>!(x.c.reason||"").trim())) names.push("(No reason)");
  const types = names.map(name=>{
    const perWeek = zeros();
    inMonth.forEach(x=>{
      const r = (x.c.reason||"").trim() || "(No reason)";
      if(r === name) perWeek[x.week-1]++;
    });
    return {name, perWeek, total: sum(perWeek)};
  });

  const resolution = leoReportResolutionRows(inMonth).map(row=>{
    const perWeek = zeros();
    inMonth.forEach(x=>{ if(row.test(x.c)) perWeek[x.week-1]++; });
    return {id:row.id, label:row.label, perWeek, total: sum(perWeek)};
  });

  return {key, items: inMonth, cancelled, totalByWeek, total: sum(totalByWeek), types, resolution};
}

function leoReportTableHtml(firstHeader, rows, ranges, totalRow){
  const head = `<tr><th>${esc(firstHeader)}</th>${ranges.map((r,i)=>`<th class="num">Week ${i+1}<div style="font-weight:400;font-size:10px;color:var(--text-dim);">${esc(r)}</div></th>`).join("")}<th class="num">Total</th></tr>`;
  const body = rows.map(r=>`<tr><td>${esc(r.label||r.name)}</td>${r.perWeek.map(n=>`<td class="num mono">${n}</td>`).join("")}<td class="num mono"><b>${r.total}</b></td></tr>`).join("");
  const foot = totalRow ? `<tr style="border-top:2px solid var(--border);"><td><b>${esc(totalRow.label)}</b></td>${totalRow.perWeek.map(n=>`<td class="num mono"><b>${n}</b></td>`).join("")}<td class="num mono"><b>${totalRow.total}</b></td></tr>` : "";
  return `<div class="table-wrap"><table class="mini-table"><thead>${head}</thead><tbody>${body}${foot}</tbody></table></div>`;
}

function leoReportHtml(scopedCalls){
  const options = leoReportMonthOptions(scopedCalls);
  if(!leoReportMonthKey || !options.includes(leoReportMonthKey)) leoReportMonthKey = leoReportKeyOf(new Date());
  const key = leoReportMonthKey;
  const rep = leoReportCompute(scopedCalls, key);
  const ranges = leoReportWeekRanges(key);
  const kpi = (label, val) => `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${val}</div></div>`;

  return `
    <div class="section-body" style="padding-top:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
        <div>
          <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;">Escalation report</div>
          <div style="font-size:22px;font-weight:600;">${esc(leoReportMonthLabel(key))}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <label for="leoReportMonthSel" style="font-size:12px;color:var(--text-muted);">Month</label>
          <select id="leoReportMonthSel" class="week-select">
            ${options.map(k=>`<option value="${k}" ${k===key?"selected":""}>${esc(leoReportMonthLabel(k))}</option>`).join("")}
          </select>
          <button class="btn btn-accent btn-sm" id="leoReportDownloadBtn">⬇ Download Excel</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:22px;">
        ${kpi("Total escalated", rep.total)}
        ${rep.resolution.map(r=> kpi(r.label, r.total)).join("")}
      </div>

      <div class="section-title" style="margin:6px 0 8px;font-size:13px;">1 · Escalations by week</div>
      ${leoReportTableHtml("", [{label:"Total escalated cases", perWeek:rep.totalByWeek, total:rep.total}], ranges)}

      <div class="section-title" style="margin:20px 0 8px;font-size:13px;">2 · Type of escalation</div>
      ${leoReportTableHtml("Reason", rep.types, ranges, {label:"All types", perWeek:rep.totalByWeek, total:rep.total})}

      <div class="section-title" style="margin:20px 0 8px;font-size:13px;">3 · Resolution</div>
      ${leoReportTableHtml("Outcome", rep.resolution, ranges)}

      <div class="help-note" style="margin-top:14px;">
        Counted by the date each call was logged. Week 4 runs from the 22nd to the end of the month. Cancelled calls are excluded${rep.cancelled ? ` (${rep.cancelled} this month)` : ""}.
        <b>Resolved</b> is the call's status; every other row is an option from the call's Action dropdown (the list updates automatically if the dropdown changes), plus <b>${esc(LEO_REPORT_NO_ACTION)}</b> for calls where no Action has been picked. A call can be Resolved and also have an Action, so Resolved overlaps the action rows — the action rows together add up to the total.
        The Reason rows follow the reason master list — add or rename reasons under Manage reasons to match the types you track.
        ${isAgent() ? "" : "This report covers the calls you can see in the queue."}
      </div>
    </div>`;
}

// Plain (unstyled) export — only used as a fallback if the styled-Excel library (ExcelJS)
// didn't load, e.g. the CDN was blocked.
function leoReportDownloadExcelPlain(){
  if(typeof XLSX === "undefined"){ showToast("⚠ Excel library didn't load — check your connection and try again"); return; }
  const scoped = scopedLeoCalls(state.leoCalls||[]);
  const key = leoReportMonthKey || leoReportKeyOf(new Date());
  const rep = leoReportCompute(scoped, key);
  const ranges = leoReportWeekRanges(key);
  const label = leoReportMonthLabel(key);
  const header = ["", ...ranges.map((r,i)=>`Week ${i+1} (${r})`), "Total"];
  const line = (name, r) => [name, ...r.perWeek, r.total];

  const aoa = [
    [`LEO Escalation Report — ${label}`],
    [state.settings.teamName ? `Team: ${state.settings.teamName}` : ""],
    [`Generated ${new Date().toLocaleString()} by ${(currentUser && currentUser.name) || ""}`],
    [],
    ["1. Escalations by week"],
    header,
    ["Total escalated cases", ...rep.totalByWeek, rep.total],
    [],
    ["2. Type of escalation"],
    ["Reason", ...header.slice(1)],
    ...rep.types.map(t=> line(t.name, t)),
    ["All types", ...rep.totalByWeek, rep.total],
    [],
    ["3. Resolution"],
    ["Outcome", ...header.slice(1)],
    ...rep.resolution.map(r=> line(r.label, r)),
    [],
    [`Notes: counted by the date each call was logged; Week 4 = 22nd to month end; ${rep.cancelled} cancelled call(s) excluded. Resolved = call status; the other three rows = the Action chosen on the call.`]
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{wch:34},{wch:16},{wch:16},{wch:16},{wch:16},{wch:10}];

  const callRows = rep.items
    .slice().sort((a,b)=> a.d - b.d)
    .map(x=>({
      "Logged date": isoFromJSDate(x.d),
      "Week": `Week ${x.week}`,
      "LOB": x.c.lob || "",
      "Reason": x.c.reason || "",
      "Ref #": x.c.refNumber || "",
      "Claim #": x.c.claimNumber || "",
      "Status": x.c.status === "completed" ? "Resolved" : x.c.supStatus === "setAside" ? "Set aside" : "New",
      "Action": x.c.action || "",
      "Assigned to": x.c.assignedTo || "",
      "Logged by": x.c.createdByName || "",
      "Date closed": x.c.closeDate || "",
      "Resolution note": x.c.supResolutionNote || ""
    }));
  const wsCalls = XLSX.utils.json_to_sheet(callRows.length ? callRows : [{Note:"No calls logged this month"}]);
  wsCalls["!cols"] = [{wch:12},{wch:8},{wch:14},{wch:22},{wch:16},{wch:16},{wch:10},{wch:28},{wch:20},{wch:20},{wch:12},{wch:40}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Summary");
  XLSX.utils.book_append_sheet(wb, wsCalls, "Calls");
  const p = leoReportParseKey(key);
  XLSX.writeFile(wb, `LEO_Report_${MONTHS[p.month]}_${p.year}.xlsx`);
  showToast(`✅ Downloaded LEO report for ${label}`);
}

function wireLeoReportListeners(content){
  const sel = content.querySelector("#leoReportMonthSel");
  if(sel) sel.addEventListener("change", ()=>{ leoReportMonthKey = sel.value; render(); });
  const btn = content.querySelector("#leoReportDownloadBtn");
  if(btn) btn.addEventListener("click", ()=>{ leoReportDownloadExcel(); });
}


/* ---------------- Styled Excel export ----------------
   Three tables side by side, matching the team's manual summary sheet:
     A:B  Month/Week   — one row per month, with that month's week-ending rows under the
                         month picked on screen, then a Grand Total
     D:F  Escalation Type        — case count + contribution %, biggest first
     H:J  Resolution Disposition — case count + contribution %, biggest first
   Sheets: "All months" (every month with data, weeks expanded for the picked month),
   a sheet for the picked month alone, and "Calls" (the rows behind the numbers).

   Rules (same spirit as the on-screen report):
   - A call belongs to the month it was LOGGED; cancelled calls are left out.
   - Weeks are "week ending" Fridays (WE 04'Sep) — a Saturday/Sunday call goes in the week
     ending the following Friday. Change LEO_REPORT_WEEK_END_DAY (0=Sun … 6=Sat) to move it.
     A week that straddles two months shows under both, with only that month's cases.
   - Escalation Type = the call's Reason. Resolution Disposition = the Action the supervisor
     chose; calls with no Action yet are grouped as "No action yet". Every call is in exactly
     one row, so each table adds up to the Grand Total.
   - Totals and percentages are live Excel formulas. */
const LEO_REPORT_WEEK_END_DAY = 5; // Friday
const LEO_REPORT_NO_ACTION = "No action yet";
const LEO_REPORT_NO_REASON = "(No reason)";
const LEO_XL = {
  head: "FF1F4E96", headText: "FFFFFFFF",
  month: "FFD9D9D9", week: "FFEDEDED", total: "FFC9C9C9", border: "FFA6A6A6"
};

function leoReportWeekEnding(d){
  const add = (LEO_REPORT_WEEK_END_DAY - d.getDay() + 7) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + add);
}
function leoReportShortMonth(key){ const p = leoReportParseKey(key); return `${MONTHS[p.month].slice(0,3)}'${String(p.year).slice(2)}`; }
function leoReportWeekLabel(d){ return `WE ${String(d.getDate()).padStart(2,"0")}'${MONTHS[d.getMonth()].slice(0,3)}`; }

// onlyKey: restrict to one month ("YYYY-MM"), or null for every month. expandKey: month whose weeks are listed.
function leoReportExcelModel(calls, expandKey, onlyKey){
  const items = [];
  calls.forEach(c=>{
    const d = leoReportLoggedDate(c);
    if(!d || c.status === "cancelled") return;
    const mk = leoReportKeyOf(d);
    if(onlyKey && mk !== onlyKey) return;
    items.push({c, d, mk, we: leoReportWeekEnding(d)});
  });
  const byMonth = new Map();
  items.forEach(x=>{
    if(!byMonth.has(x.mk)) byMonth.set(x.mk, {key:x.mk, label:leoReportShortMonth(x.mk), count:0, weeks:new Map()});
    const m = byMonth.get(x.mk);
    m.count++;
    if(x.mk === expandKey){
      const wk = x.we.getTime();
      if(!m.weeks.has(wk)) m.weeks.set(wk, {label:leoReportWeekLabel(x.we), count:0, at:wk});
      m.weeks.get(wk).count++;
    }
  });
  const months = Array.from(byMonth.values()).sort((a,b)=> a.key < b.key ? -1 : 1)
    .map(m=>({key:m.key, label:m.label, count:m.count, weeks:Array.from(m.weeks.values()).sort((a,b)=>a.at-b.at)}));
  const tally = fn=>{
    const map = new Map();
    items.forEach(x=>{ const k = fn(x.c); map.set(k, (map.get(k)||0)+1); });
    return Array.from(map.entries()).map(([label,count])=>({label,count}))
      .sort((a,b)=> b.count - a.count || a.label.localeCompare(b.label));
  };
  return {
    items, months, total: items.length,
    types: tally(c=> (c.reason||"").trim() || LEO_REPORT_NO_REASON),
    dispositions: tally(c=> (c.action||"").trim() || LEO_REPORT_NO_ACTION)
  };
}

function leoXlBorder(){
  const side = {style:"thin", color:{argb:LEO_XL.border}};
  return {top:side, left:side, bottom:side, right:side};
}
function leoXlStyle(cell, o){
  o = o || {};
  cell.border = leoXlBorder();
  cell.font = {name:"Calibri", size:11, bold:!!o.bold, italic:!!o.italic, color:{argb:o.color||"FF000000"}};
  if(o.fill) cell.fill = {type:"pattern", pattern:"solid", fgColor:{argb:o.fill}};
  cell.alignment = {vertical:"middle", horizontal:o.align||"left", indent:o.indent||0};
  if(o.numFmt) cell.numFmt = o.numFmt;
}
function leoXlHeader(ws, row, col, text, align){
  const cell = ws.getCell(row, col);
  cell.value = text;
  leoXlStyle(cell, {bold:true, fill:LEO_XL.head, color:LEO_XL.headText, align:align||"left"});
}

// Writes a "label | Case_Count | Contribution%" table; returns nothing. startCol is 1-based.
function leoXlCountTable(ws, startRow, startCol, title, rows, total, centerLabels){
  leoXlHeader(ws, startRow, startCol, title, centerLabels ? "center" : "left");
  leoXlHeader(ws, startRow, startCol+1, "Case_Count", "center");
  leoXlHeader(ws, startRow, startCol+2, "Contribution%", "center");
  const list = rows.length ? rows : [{label:"No cases logged", count:0}];
  const first = startRow + 1, last = startRow + list.length, totalRow = last + 1;
  const totAddr = `${ws.getCell(totalRow, startCol+1).address.replace(/\d+$/,"")}$${totalRow}`;
  list.forEach((r,i)=>{
    const row = first + i;
    const a = ws.getCell(row, startCol), b = ws.getCell(row, startCol+1), c = ws.getCell(row, startCol+2);
    a.value = r.label; leoXlStyle(a, {align: centerLabels ? "center" : "left"});
    b.value = r.count; leoXlStyle(b, {align:"right"});
    const colLetter = b.address.replace(/\d+$/,"");
    c.value = {formula:`IF(${totAddr}=0,0,${colLetter}${row}/${totAddr})`, result: total ? r.count/total : 0};
    leoXlStyle(c, {align:"right", numFmt:"0%"});
  });
  const ta = ws.getCell(totalRow, startCol), tb = ws.getCell(totalRow, startCol+1), tc = ws.getCell(totalRow, startCol+2);
  const colLetter = tb.address.replace(/\d+$/,"");
  ta.value = "Grand Total"; leoXlStyle(ta, {bold:true, fill:LEO_XL.total, align: centerLabels ? "center" : "left"});
  tb.value = {formula:`SUM(${colLetter}${first}:${colLetter}${last})`, result: total}; leoXlStyle(tb, {bold:true, fill:LEO_XL.total, align:"right"});
  tc.value = {formula:`IF(${totAddr}=0,0,SUM(${ws.getCell(first,startCol+2).address}:${ws.getCell(last,startCol+2).address}))`, result: total ? 1 : 0};
  leoXlStyle(tc, {bold:true, fill:LEO_XL.total, align:"right", numFmt:"0%"});
}

function leoXlMonthWeekTable(ws, startRow, startCol, months, total){
  leoXlHeader(ws, startRow, startCol, "Month/Week");
  leoXlHeader(ws, startRow, startCol+1, "Case_Count", "center");
  let row = startRow + 1;
  const monthCells = [];
  if(!months.length){
    const a = ws.getCell(row, startCol), b = ws.getCell(row, startCol+1);
    a.value = "No cases logged"; leoXlStyle(a, {}); b.value = 0; leoXlStyle(b, {align:"right"});
    row++;
  }
  months.forEach(m=>{
    const a = ws.getCell(row, startCol), b = ws.getCell(row, startCol+1);
    a.value = m.label; leoXlStyle(a, {bold:true, fill:LEO_XL.month});
    b.value = m.count; leoXlStyle(b, {bold:true, fill:LEO_XL.month, align:"right"});
    monthCells.push(b.address);
    row++;
    m.weeks.forEach(w=>{
      const wa = ws.getCell(row, startCol), wb = ws.getCell(row, startCol+1);
      wa.value = w.label; leoXlStyle(wa, {fill:LEO_XL.week, italic:true, indent:2, align:"right"});
      wb.value = w.count; leoXlStyle(wb, {fill:LEO_XL.week, italic:true, align:"right"});
      row++;
    });
  });
  const ta = ws.getCell(row, startCol), tb = ws.getCell(row, startCol+1);
  ta.value = "Grand Total"; leoXlStyle(ta, {bold:true, fill:LEO_XL.total});
  tb.value = monthCells.length ? {formula: monthCells.join("+"), result: total} : 0;
  leoXlStyle(tb, {bold:true, fill:LEO_XL.total, align:"right"});
}

function leoXlSummarySheet(wb, name, title, subtitle, model, expandKey){
  const ws = wb.addWorksheet(name, {views:[{showGridLines:false}]});
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = {name:"Calibri", size:16, bold:true, color:{argb:"FF1F4E96"}};
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = {name:"Calibri", size:10, italic:true, color:{argb:"FF7F7F7F"}};
  const top = 4;
  leoXlMonthWeekTable(ws, top, 1, model.months, model.total);                       // A:B
  leoXlCountTable(ws, top, 4, "Escalation Type", model.types, model.total, false);  // D:F
  leoXlCountTable(ws, top, 8, "Resolution Disposition", model.dispositions, model.total, true); // H:J
  [16,13,3,26,13,16,3,48,13,16].forEach((w,i)=>{ ws.getColumn(i+1).width = w; });
  ws.getRow(top).height = 20;
  ws.pageSetup = {orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0}; // prints on one page wide
  return ws;
}

function leoXlCallsSheet(wb, model){
  const ws = wb.addWorksheet("Calls");
  const cols = [
    ["Logged date",12],["Month",9],["Week ending",12],["LOB",14],["Reason",24],["Ref #",16],["Claim #",16],
    ["Status",11],["Action",30],["Assigned to",20],["Logged by",20],["Date closed",12],["Resolution note",44]
  ];
  ws.columns = cols.map(([h,w])=>({header:h, width:w}));
  ws.getRow(1).eachCell(cell=> leoXlStyle(cell, {bold:true, fill:LEO_XL.head, color:LEO_XL.headText}));
  model.items.slice().sort((a,b)=> a.d - b.d).forEach(x=>{
    const c = x.c;
    ws.addRow([
      isoFromJSDate(x.d), leoReportShortMonth(x.mk), leoReportWeekLabel(x.we), c.lob||"", c.reason||"",
      c.refNumber||"", c.claimNumber||"",
      c.status==="completed" ? "Resolved" : c.supStatus==="setAside" ? "Set aside" : "New",
      c.action||"", c.assignedTo||"", c.createdByName||"", c.closeDate||"", c.supResolutionNote||""
    ]);
  });
  ws.views = [{state:"frozen", ySplit:1}];
  ws.autoFilter = {from:"A1", to:"M1"};
  ws.pageSetup = {orientation:"landscape", fitToPage:true, fitToWidth:1, fitToHeight:0};
  return ws;
}

async function leoReportBuildWorkbook(scoped, key){
  const wb = new ExcelJS.Workbook();
  wb.creator = (currentUser && currentUser.name) || "Align360";
  wb.created = new Date();
  const team = state.settings.teamName ? `${state.settings.teamName} · ` : "";
  const stamp = `${team}Generated ${new Date().toLocaleString()}${currentUser ? " by "+currentUser.name : ""} · cancelled calls excluded · weeks end on Friday`;

  const all = leoReportExcelModel(scoped, key, null);
  const first = all.months[0], last = all.months[all.months.length-1];
  const range = all.months.length > 1 ? `${first.label} – ${last.label}` : (first ? first.label : leoReportShortMonth(key));
  leoXlSummarySheet(wb, "All months", `LEO Escalation Report — ${range}`, stamp, all, key);

  const one = leoReportExcelModel(scoped, key, key);
  leoXlSummarySheet(wb, leoReportMonthLabel(key), `LEO Escalation Report — ${leoReportMonthLabel(key)}`, stamp, one, key);

  leoXlCallsSheet(wb, all);
  return wb;
}

async function leoReportDownloadExcel(){
  if(typeof ExcelJS === "undefined"){
    showToast("ℹ Styled Excel library didn't load — downloading a plain version instead");
    return leoReportDownloadExcelPlain();
  }
  try{
    const scoped = scopedLeoCalls(state.leoCalls||[]);
    const key = leoReportMonthKey || leoReportKeyOf(new Date());
    const wb = await leoReportBuildWorkbook(scoped, key);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    const p = leoReportParseKey(key);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `LEO_Report_${MONTHS[p.month]}_${p.year}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
    showToast(`✅ Downloaded LEO report for ${leoReportMonthLabel(key)}`);
  }catch(e){
    console.error("LEO report Excel failed", e);
    showToast("⚠ Couldn't build the styled Excel — downloading a plain version instead");
    leoReportDownloadExcelPlain();
  }
}
