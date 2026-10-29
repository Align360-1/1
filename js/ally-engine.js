/* =========================================================
   ALLY — answers  (js/ally-engine.js)
   ---------------------------------------------------------
   One handler per kind of question. Every handler works ONLY from the scope object (ally-scope.js) and the parsed
   question (ally-nlu.js) — this file never reads the app's `state` or `currentUser`.  Numbers use the same rules as
   the Dashboard (agentAggregate / metricColor), so Ally and the page never disagree.

   Refusals are deliberately uniform: asking about a colleague who does not exist and one who does produce the same
   reply, so Ally cannot be used to probe who is on the roster.
   ========================================================= */
const AllyEngine = (function(){
  "use strict";
  const N = AllyNLU;
  const lobsOf = p=> (p && p.lobs && p.lobs.length) ? p.lobs : (p && p.lob ? [p.lob] : []);   // an agent can be cross-trained on several LOBs
  const lobTxt = p=> lobsOf(p).join(" + ");

  /* ---------- reply builders ---------- */
  const P = text => ({t:"p", text});
  const NOTE = text => ({t:"note", text});
  const STAT = o => Object.assign({t:"stat"}, o);
  const TABLE = (head, rows, o) => Object.assign({t:"table", head, rows}, o||{});
  const LIST = items => ({t:"list", items});
  const CARDS = items => ({t:"cards", items});
  const chip = (label, q) => ({label, q});
  const navChip = (label, tab) => ({label, nav:tab});
  function reply(blocks, o){
    o = o||{};
    const bl = blocks.filter(Boolean);
    if(o.offer) bl.push(P(o.offer.text));      // a yes/no question Ally asks; "yes" then re-runs offer.q
    return {blocks:bl, chips:o.chips||[], source:o.source||"", mem:null, offer:o.offer||null, choice:o.choice||null};
  }
  let turn = 0;
  const vary = arr => arr[(turn++) % arr.length];
  const lc = s => s.charAt(0).toLowerCase()+s.slice(1);

  /* ---------- formatting ---------- */
  function fmt(m, v){ if(v==null || isNaN(v)) return "—"; if(m.field==="calls") return String(Math.round(v)); return String(Number(Number(v).toFixed(1))); }
  function unitOf(m){ const u = m.unit||""; if(!u) return ""; return u==="%" ? "%" : " "+u.toLowerCase(); }
  function statusLabel(s){ return s==="green" ? "On target" : s==="yellow" ? "Watch" : s==="red" ? "At risk" : "No data"; }
  function cellVal(m, v){ return {text: v==null ? "—" : fmt(m,v)+unitOf(m), status: v==null ? null : metricColor(m,v), mono:true}; }
  function badgeCell(s){ return {text:statusLabel(s), badge:s||"gray"}; }
  function targetText(m){ const u = m.unit==="%" ? "%" : ""; return m.direction==="lower" ? "≤ "+m.target+u+"  (at risk above "+m.threshold+u+")" : "≥ "+m.target+u+"  (at risk below "+m.threshold+u+")"; }
  function plural(n, one, many){ return n+" "+(n===1 ? one : (many||one+"s")); }
  function t12(t){ return (t && typeof formatTime12==="function") ? formatTime12(t) : (t||"—"); }
  function rng(o){ return (o && (o.start||o.end)) ? t12(o.start)+" – "+t12(o.end) : "—"; }
  function cap(s, n){ s = String(s||""); return s.length>n ? s.slice(0, n-1).trimEnd()+"…" : s; }
  function dayName(iso){ return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][N.parseIso(iso).getDay()]; }
  function onDay(label){ return /^(today|yesterday|tomorrow)/.test(label) ? label : "on "+label; }
  function inP(period){ return period.kind==="day" ? onDay(period.label) : "in "+period.label; }
  function ago(iso){
    const t = Date.parse(iso); if(isNaN(t)) return null;
    return Math.floor((Date.now()-t)/864e5);
  }

  /* ---------- starter chips, per login ---------- */
  function starterChips(S){
    const q = [];
    if(S.isAgent){
      q.push("How am I doing this month?", "When is my lunch break?");
      if(S.can.qa) q.push("My latest audit");
      if(S.can.pkt) q.push("Do I have a pending PKT?");
      if(S.can.updates) q.push("Latest process updates");
      if(S.can.leo) q.push("My open sup calls");
    } else if(S.isQuality){
      q.push("My audits this month", "Most missed parameters");
      if(S.can.pkt) q.push("Who hasn't taken the PKT?");
      if(S.can.updates) q.push("Latest process updates");
    } else if(S.isClient){
      q.push("Team performance this month");
      if(S.can.dailySummary) q.push("Service level yesterday");
      if(S.can.updates) q.push("Latest process updates");
      if(S.can.leo) q.push("Open sup calls");
    } else {
      if(S.canMetrics) q.push(S.reach==="team" ? "How is my team doing this month?" : "How are we doing this month?", "Who is at risk?");
      if(S.canMetrics) q.push("Who is on leave today?");
      if(S.can.leo) q.push("Open sup calls");
      if(S.can.qa) q.push("Lowest audit scores");
      if(S.can.pkt) q.push("Who hasn't taken the PKT?");
      if(S.can.dailySummary) q.push("Service level yesterday");
      if(S.can.updates && q.length<6) q.push("Latest process updates");
    }
    return q.slice(0,6).map(x=>chip(x,x));
  }

  /* ---------- refusals ---------- */
  function denySelfOnly(S){
    return reply([
      P("I can only share **your own** data with an Agent login — other people's numbers and team-level figures aren't available to you, so I can't look those up."),
      NOTE("Try asking about yourself, e.g. “my AHT this month”, or about shared content like the Knowledge Base and process updates.")
    ], {chips:starterChips(S)});
  }
  function denyPage(S, what){
    return reply([P("That's outside what a **"+S.roleLabel+"** login can see in Align360, so I can't share "+what+".")], {chips:starterChips(S)});
  }
  function notFoundPerson(S, name){
    const where = S.reach==="team" ? "your team" : "the people you have access to";
    return reply([
      P("I don't see anyone called **“"+cap(name,40)+"”** in "+where+"."),
      NOTE("Could be a spelling difference — try the first and last name together, or the employee ID.")
    ], {chips:starterChips(S)});
  }

  /* ---------- who is the question about ---------- */
  function subjectOf(S, c){
    if(S.reach==="none") return {kind:"denied"};
    if(S.reach==="self"){
      if(c.otherPersonRef) return {kind:"denied-others"};
      if(c.teamRef) return {kind:"denied-others"};
      if(/\bwho\b/.test(c.norm) && !c.selfRef) return {kind:"denied-others"};
      return {kind:"self", people:[S.me()].filter(Boolean)};
    }
    if(c.ambiguous) return {kind:"ambiguous", list:c.ambiguous};
    if(c.people.length) return {kind:"people", people:c.people};
    if(c.unknownPerson && !c.lob && !c.tl) return {kind:"unknown", name:c.unknownPerson};
    let ppl = S.people();
    if(c.lob) ppl = ppl.filter(p=>lobsOf(p).includes(c.lob));
    if(c.tl) ppl = ppl.filter(p=>p.tlName===c.tl);
    const label = c.tl ? c.tl+"'s team" : c.lob ? c.lob+" LOB" : (S.reach==="team" ? "your team" : "all teams");
    return {kind:"group", people:ppl, label, mine:S.reach==="team" && !c.tl && !c.lob};
  }
  function ambiguousReply(S, subj){
    return reply([P("A few people fit that — which one did you mean? Tap a name, or say “the first one”."),
      LIST(subj.list.map(p=>p.name+" · "+p.empId+(p.tlName ? " · "+p.tlName : "")))],
      {chips:subj.list.slice(0,4).map(p=>chip(p.name, p.name)), choice:{names:subj.list.map(p=>p.name)}});
  }
  /* returns a ready reply when the subject can't be served, else null */
  function subjectBlock(S, c, subj){
    if(subj.kind==="denied") return denyPage(S, "that");
    if(subj.kind==="denied-others") return denySelfOnly(S);
    if(subj.kind==="unknown") return notFoundPerson(S, subj.name);
    if(subj.kind==="ambiguous") return ambiguousReply(S, subj);
    if(subj.kind==="group" && !subj.people.length) return reply([P("I don't see anyone in **"+subj.label+"** that I can show you.")], {chips:starterChips(S)});
    return null;
  }
  function whoLabel(subj){
    if(subj.kind==="self") return "You";
    if(subj.kind==="people") return subj.people.length===1 ? subj.people[0].name : subj.people.map(p=>p.name.split(" ")[0]).join(", ");
    return subj.label;
  }
  async function rowsFor(S, people, period){
    const ids = new Set(people.map(p=>p.empId));
    return (await S.rows(period.from, period.to)).filter(r=>ids.has(r.empId));
  }
  function groupKpi(rows, m){
    const arr = rows.map(r=>r[m.field]).filter(v=>v!=="" && v!=null && !isNaN(v)).map(Number);
    if(!arr.length) return null;
    if(m.field==="calls") return arr.reduce((a,b)=>a+b,0);
    const mean = arr.reduce((a,b)=>a+b,0)/arr.length;
    return (m.inputType||"number")==="checkbox" ? mean*100 : mean;
  }
  function metricChips(S, c, subj){
    const ms = S.settings().metrics.filter(m=>(m.inputType||"number")==="number").slice(0,3);
    const out = [];
    if(subj.kind==="group" && S.can.viewOthers){ out.push(chip("Who is at risk?", "Who is at risk this month?")); if(ms[0]) out.push(chip("Top 5 by "+ms[0].name.replace(/\s*\(.*\)/,""), "Top 5 by "+ms[0].name.replace(/\s*\(.*\)/,""))); }
    out.push(chip("Last month", "Last month"));
    return out;
  }

  /* narrative helpers: how far from target, and how it moved since the previous month */
  function gapText(m, v){
    if(v==null) return "";
    const lower = m.direction==="lower", t = Number(m.target);
    const diff = lower ? t - v : v - t;                 // positive = better than target
    const amt = Math.abs(diff); const a = String(Number(amt.toFixed(1)))+(m.unit==="%" ? " pts" : unitOf(m));
    if(Math.abs(diff) < 0.05) return "right on the target";
    return diff>0 ? a+" better than the target" : a+" short of the target";
  }
  async function prevValue(S, people, m, period){
    if(period.kind!=="month") return null;
    const pm = N.monthPeriod(period.mIdx===0 ? 11 : period.mIdx-1, period.mIdx===0 ? period.year-1 : period.year, true);
    const ids = new Set(people.map(p=>p.empId));
    const rows = (await S.rows(pm.from, pm.to)).filter(r=>ids.has(r.empId));
    if(!rows.length) return null;
    const v = groupKpi(rows, m);
    return v==null ? null : {v, label:N.MONTH_NAMES[pm.mIdx]};
  }
  function trendText(m, v, prev){
    if(!prev || v==null) return "";
    const d = v - prev.v; if(Math.abs(d) <= Math.abs(prev.v)*0.01) return "is about level with "+prev.label;
    const good = m.direction==="lower" ? d<0 : d>0;
    return "has "+(good ? "improved" : "slipped")+" by "+String(Number(Math.abs(d).toFixed(1)))+(m.unit==="%" ? " pts" : unitOf(m))+" since "+prev.label+" ("+fmt(m,prev.v)+unitOf(m)+")";
  }

  /* =====================================================================  METRICS  */
  async function hMetric(S, c){
    if(!S.canMetrics) return denyPage(S, "performance numbers");
    const defs = S.settings().metrics;
    const named = c.metrics.length ? c.metrics : null;
    const shown = named || defs;

    // "what is the AHT target?" — definitions are on every KPI card, so any login with a Dashboard may see them
    if(c.wantsTarget && !c.people.length && !c.unknownPerson){
      return reply([P(named ? "Here "+(named.length===1?"is the target":"are the targets")+":" : "These are the KPI targets set in Align360:"),
        TABLE(["Metric","Target","Direction"], shown.map(m=>[m.name, {text:targetText(m), mono:true}, m.direction==="lower" ? "Lower is better" : "Higher is better"]))],
        {source:"Settings · Metrics", chips:[chip("How am I doing this month?","How am I doing this month?")].filter(()=>S.isAgent)});
    }

    const subj = subjectOf(S, c);
    // Agents: "who is the best / who is at risk" are questions about others
    if(S.reach==="self" && (c.rank||c.exceptions) && !c.selfRef) return denySelfOnly(S);
    const blocked = subjectBlock(S, c, subj); if(blocked) return blocked;

    const period = c.period;
    const rows = await rowsFor(S, subj.people, period);
    const agg = agentAggregate(rows);
    const hasAny = rows.some(r=>defs.some(m=>r[m.field]!=="" && r[m.field]!=null && !isNaN(r[m.field])));
    const src = "Dashboard · "+period.label+" · "+(subj.kind==="self" ? "your data" : subj.kind==="people" ? "selected agents" : subj.label);

    if(!hasAny){
      // past month that was archived? (Month History) — only when the History page is one this login has
      const hist = period.kind==="month" ? S.history().find(h=>h.month===N.MONTH_NAMES[period.mIdx] && Number(h.year)===period.year) : null;
      if(hist && hist.rows.length){
        const keep = subj.kind==="group" ? hist.rows : hist.rows.filter(r=>subj.people.some(p=>p.name===r.agent));
        if(keep.length){
          const ms = named ? hist.metrics.filter(h=>named.some(n=>n.field===h.field)) : hist.metrics;
          return reply([P("The daily entries for **"+period.label+"** aren't loaded, but the archived month report has these:"),
            TABLE(["Agent"].concat(ms.map(m=>m.name)), keep.slice(0,25).map(r=>[r.agent].concat(ms.map(m=>({text:r[m.field]==null?"—":String(r[m.field]), mono:true}))))),
            keep.length>25 ? NOTE("Showing 25 of "+keep.length+" rows.") : null], {source:"Month History · "+period.label});
        }
      }
      return reply([P("There's no KPI data entered for **"+whoLabel(subj).toLowerCase()+"** in "+period.label+" yet.")],
        {chips:[chip("Last month","Last month")], source:src});
    }

    /* ---- ranking ---- */
    if(c.rank && subj.kind==="group"){
      const m = named && named[0];
      if(!m) return reply([P("Which metric should I rank by?")], {chips:defs.filter(d=>(d.inputType||"number")==="number").slice(0,4).map(d=>chip(d.name, (c.rank.dir==="worst"||c.rank.dir==="low" ? "Bottom 5 by " : "Top 5 by ")+d.name.replace(/\s*\(.*\)/,"")))});
      const list = agg.filter(a=>a.values[m.field]!=null);
      if(!list.length) return reply([P("Nobody has **"+m.name+"** recorded for "+period.label+" yet.")], {source:src});
      const lowerBetter = m.direction==="lower";
      let asc;                                   // true = ascending numeric order
      if(c.rank.dir==="best") asc = lowerBetter; else if(c.rank.dir==="worst") asc = !lowerBetter;
      else if(c.rank.dir==="high") asc = false; else asc = true;
      list.sort((a,b)=> asc ? a.values[m.field]-b.values[m.field] : b.values[m.field]-a.values[m.field]);
      const n = Math.min(20, Math.max(1, c.rank.n||5));
      const top = list.slice(0,n);
      const heading = (c.rank.dir==="best"||c.rank.dir==="high" ? "Top " : "Bottom ")+top.length+" by **"+m.name+"** · "+whoLabel(subj)+" · "+period.label;
      return reply([P(heading), TABLE(["#","Agent",m.name,"Status"], top.map((a,i)=>[String(i+1), a.name, cellVal(m,a.values[m.field]), badgeCell(metricColor(m,a.values[m.field]))])),
        list.length>n ? NOTE("Based on "+list.length+" agents with data.") : null], {source:src, chips:metricChips(S,c,subj)});
    }

    /* ---- exceptions: who is off target ---- */
    if(c.exceptions && subj.kind==="group"){
      const target = named || defs;
      const flagged = agg.map(a=>{
        const off = target.map(m=>({m, v:a.values[m.field], s:a.values[m.field]==null?null:metricColor(m,a.values[m.field])})).filter(x=>x.s==="red"||x.s==="yellow");
        const worst = off.some(x=>x.s==="red") ? "red" : off.length ? "yellow" : null;
        return {a, off, worst};
      }).filter(x=>x.worst).sort((x,y)=> (x.worst==="red"?0:1)-(y.worst==="red"?0:1) || y.off.length-x.off.length);
      const only = /\b(red|at risk)\b/.test(c.norm) && !/\b(watch|yellow|amber)\b/.test(c.norm);
      const list = only ? flagged.filter(x=>x.worst==="red") : flagged;
      if(!list.length && only && flagged.length){
        return reply([P("Nobody in **"+subj.label+"** is **At risk** (red) in "+period.label+", but **"+plural(flagged.length,"agent")+"** "+(flagged.length===1?"is":"are")+" on Watch:"),
          TABLE(["Agent","Status","Off target"], flagged.slice(0,25).map(x=>[x.a.name, badgeCell(x.worst), x.off.map(o=>o.m.name.replace(/\s*\(.*\)/,"")+" "+fmt(o.m,o.v)+unitOf(o.m)).join(" · ")]))], {source:src});
      }
      if(!list.length) return reply([P("Good news — nobody in **"+subj.label+"** is off target"+(named?" on "+named.map(m=>m.name).join(" / "):"")+" for "+period.label+".")], {source:src});
      const shownList = list.slice(0,25);
      return reply([P("**"+plural(list.length,"agent")+"** in "+subj.label+" "+(list.length===1?"is":"are")+" off target in "+period.label+":"),
        TABLE(["Agent","Status","Off target"], shownList.map(x=>[x.a.name, badgeCell(x.worst), x.off.map(o=>o.m.name.replace(/\s*\(.*\)/,"")+" "+fmt(o.m,o.v)+unitOf(o.m)).join(" · ")])),
        list.length>25 ? NOTE("Showing 25 of "+list.length+".") : null],
        {source:src, chips:[chip("Last month","Last month"), chip("Show only at risk", "Who is at risk (red) this month?")]});
    }

    /* ---- compare two or more people ---- */
    if(c.compare && subj.kind==="people" && subj.people.length>=2){
      const cols = subj.people.slice(0,4).map(p=>({p, a:agg.find(x=>x.empId===p.empId)}));
      return reply([P("Comparison for **"+period.label+"**:"),
        TABLE(["Metric"].concat(cols.map(x=>x.p.name)), shown.map(m=>[m.name].concat(cols.map(x=>cellVal(m, x.a ? x.a.values[m.field] : null)))))], {source:src});
    }

    /* ---- one person (or self) ---- */
    if(subj.kind==="self" || (subj.kind==="people" && subj.people.length===1)){
      const person = subj.people[0];
      const a = agg.find(x=>x.empId===person.empId);
      const who = subj.kind==="self" ? "Your" : person.name+"'s";
      if(!a) return reply([P("No KPI data for **"+(subj.kind==="self"?"you":person.name)+"** in "+period.label+" yet.")], {source:src});
      const blocks = [];
      if(shown.length===1){
        const m = shown[0], v = a.values[m.field];
        const s = v==null ? null : metricColor(m,v);
        blocks.push(STAT({label:who+" "+m.name+" · "+period.label, value:v==null?"—":fmt(m,v), unit:unitOf(m).trim(), status:s, sub:statusLabel(s)+" · target "+targetText(m)}));
        if(v!=null){
          const pv = await prevValue(S, [person], m, period);
          const tr = trendText(m, v, pv);
          const subjWord = subj.kind==="self" ? "You're" : person.name.split(" ")[0]+" is";
          const lead = s==="red" ? subjWord+" "+gapText(m,v)+" — this one needs attention"+(tr?", and it "+tr.replace(/^is /,"is "):".") : subjWord+" "+gapText(m,v)+(tr?", and "+(subj.kind==="self"?"it ":"it ")+tr:".");
          blocks.push(P(lead.replace(/\.?$/,"")+"."));
        }
        // week-by-week, only when it adds something (a month or longer view of one metric)
        if(period.kind==="month" && v!=null){
          const wks = [];
          const nW = weekOfDay(period.year, period.mIdx, N.daysIn(period.mIdx, period.year));
          for(let w=1; w<=nW; w++){
            const wa = agentAggregate(filterRowsByWeek(rows.filter(r=>r.empId===person.empId), w))[0];
            const wv = wa ? wa.values[m.field] : null;
            if(wv!=null) wks.push(["Week "+w, cellVal(m,wv), badgeCell(metricColor(m,wv))]);
          }
          if(wks.length>1) blocks.push(TABLE(["Week", m.name, "Status"], wks));
        }
      } else {
        const stat = shown.map(m=>({m, v:a.values[m.field]})).filter(x=>x.v!=null).map(x=>Object.assign(x,{s:metricColor(x.m,x.v)}));
        const offT = stat.filter(x=>x.s==="red"||x.s==="yellow");
        const base = who+" numbers "+period.phrase;
        const head = !stat.length ? base+":" : offT.length ? base+": "+(stat.length-offT.length)+" of "+stat.length+" metrics on target — **"+offT.map(x=>x.m.name.replace(/\s*\(.*\)/,"")).join(", ")+"** "+(offT.length===1?"needs":"need")+" a look."
                     : base+": all "+stat.length+" metrics are on target.";
        blocks.push(P(head));
        blocks.push(TABLE(["Metric","Value","Target","Status"], shown.map(m=>[m.name, cellVal(m,a.values[m.field]), {text:targetText(m), mono:true}, badgeCell(a.values[m.field]==null?null:metricColor(m,a.values[m.field]))])));
        blocks.push(NOTE("Present days: "+a.presentDays+" · Leave days: "+a.leaveDays));
      }
      return reply(blocks, {source:src, chips:metricChips(S,c,subj), offer: shown.length===1 ? {q:(subj.kind==="self" ? "how am i doing "+period.phrase : person.name+" performance "+period.phrase), text:"Want to see "+(subj.kind==="self" ? "all your metrics" : "all of "+person.name.split(" ")[0]+"'s metrics")+" together?"} : null});
    }

    /* ---- several named people ---- */
    if(subj.kind==="people"){
      return reply([P("Numbers for **"+period.label+"**:"),
        TABLE(["Agent"].concat(shown.map(m=>m.name)), subj.people.slice(0,12).map(p=>{ const a=agg.find(x=>x.empId===p.empId); return [p.name].concat(shown.map(m=>cellVal(m, a?a.values[m.field]:null))); }))], {source:src});
    }

    /* ---- a group (team / LOB / everyone in scope) ---- */
    const withData = new Set(rows.map(r=>r.empId)).size;
    const gStat = shown.map(m=>({m, v:groupKpi(rows,m)})).filter(x=>x.v!=null).map(x=>Object.assign(x,{s:metricColor(x.m,x.v)}));
    const gOff = gStat.filter(x=>x.s!=="green");
    const gLead = !gStat.length ? "" : gOff.length ? " "+(gStat.length-gOff.length)+" of "+gStat.length+" metrics are on target; **"+gOff.map(x=>x.m.name.replace(/\s*\(.*\)/,"")).join(", ")+"** "+(gOff.length===1?"is":"are")+" off." : " All "+gStat.length+" metrics are on target.";
    const blocks = [P("Here's how **"+lc(subj.label)+"** looks "+period.phrase+"."+gLead),
      TABLE(["Metric", shown.some(m=>m.field==="calls")?"Value":"Average","Target","Status"], shown.map(m=>{ const v=groupKpi(rows,m); return [m.name, cellVal(m,v), {text:targetText(m), mono:true}, badgeCell(v==null?null:metricColor(m,v))]; })),
      NOTE(agg.length+" agents with entries · Total Calls is a sum, the other metrics are averages (same as the Dashboard).")];
    return reply(blocks, {source:src, chips:metricChips(S,c,subj)});
  }

  /* =====================================================================  LEAVE / ATTENDANCE  */
  function leaveTypeName(S, code){ const t = S.settings().leaveTypes.find(l=>l.code===code); return t ? t.name : (code||""); }
  function toRanges(entries){
    const out = []; let cur = null;
    entries.forEach(e=>{
      const days = e.attendance==="Half day" ? 0.5 : 1;
      if(cur && cur.attendance===e.attendance && cur.leaveType===e.leaveType && N.addDays(cur.end,1)===e.iso){ cur.end = e.iso; cur.days += days; }
      else { if(cur) out.push(cur); cur = {attendance:e.attendance, leaveType:e.leaveType||"", start:e.iso, end:e.iso, days}; }
    });
    if(cur) out.push(cur);
    return out;
  }
  async function hLeave(S, c){
    if(!S.canMetrics) return denyPage(S, "attendance or leave data");
    if(/\b(balance|remaining|quota|entitle\w*|how many leaves? (do i|are) (have|left))\b/.test(c.norm))
      return reply([P("Align360 tracks leave **taken** (from Daily Data attendance), not leave balances or entitlements — so I can't tell you what's left.")], {chips:starterChips(S)});
    const subj = subjectOf(S, c);
    const blocked = subjectBlock(S, c, subj); if(blocked) return blocked;
    const period = c.period;
    const people = subj.people;
    const rows = await rowsFor(S, people, period);
    const src = "Attendance (Daily Data) · "+period.label;

    /* a single person (or self) */
    if(subj.kind==="self" || (subj.kind==="people" && people.length===1)){
      const person = people[0], mine = rows.filter(r=>r.empId===person.empId);
      const a = agentAggregate(mine)[0];
      const leaveRows = mine.filter(r=>r.attendance==="Leave"||r.attendance==="Half day").sort((x,y)=>x.iso.localeCompare(y.iso));
      const ranges = toRanges(leaveRows);
      const who = subj.kind==="self" ? "You" : person.name;
      if(!ranges.length) return reply([P("**"+who+(subj.kind==="self"?" have":" has")+" no leave or half days** recorded "+inP(period)+(a && a.presentDays ? " ("+a.presentDays+" present days)." : "."))], {source:src});
      return reply([P("**"+who+(subj.kind==="self"?" have":" has")+" taken "+(a?a.leaveDays:0)+" leave day"+((a&&a.leaveDays===1)?"":"s")+"** "+inP(period)+(a && a.presentDays ? " · "+a.presentDays+" present days":"")+":"),
        TABLE(["From","To","Type","Days"], ranges.map(r=>[N.fmtDay(r.start), r.start===r.end?"—":N.fmtDay(r.end), (r.attendance==="Half day"?"Half day":(leaveTypeName(S,r.leaveType)||"Leave")), {text:String(r.days), mono:true}]))],
        {source:src, chips:[chip("Last month","Last month")]});
    }

    /* many people: who is on leave / missing attendance / attendance split */
    if(/\b(missing|not marked|unmarked|not updated|not filled|pending attendance|blank)\b/.test(c.norm)){
      const day = period.kind==="day" || period.kind==="range" ? period.to : S.today();
      const d = rows.filter(r=>r.iso===day && !r.attendance);
      return reply([d.length ? P("**"+plural(d.length,"person","people")+"** "+(d.length===1?"has":"have")+" no attendance marked for "+N.fmtDay(day)+":") : P("Everyone in **"+subj.label+"** has attendance marked for "+N.fmtDay(day)+"."),
        d.length ? LIST(d.slice(0,30).map(r=>r.name)) : null], {source:src});
    }
    const wantLeaveList = c.forceList || /\b(on leave|absent|who is off|who s off|leave today|leave tomorrow|taking leave|half day|sick|leaves)\b/.test(c.norm) || /\bwho\b/.test(c.norm);
    const on = rows.filter(r=>r.attendance==="Leave"||r.attendance==="Half day");
    if(wantLeaveList || period.kind==="day"){
      const marked = rows.filter(r=>r.attendance).length;
      const whenTxt = period.kind==="day" ? onDay(period.label) : "in "+period.label;
      const team = subj.mine ? "your team" : subj.label;
      if(!on.length && !marked){
        const future = period.from > S.today();
        return reply([P(future ? "Attendance for **"+period.label+"** isn't filled in yet, so I can't see any leave for "+team+" — it only shows up once it's entered in Daily Data."
                                : "I can't see any attendance entered for "+team+" "+whenTxt+" yet, so I can't say who's off."),
          NOTE("Nothing has been marked either way, so this isn't the same as “nobody is on leave”.")],
          {source:src, chips:[chip("This month","Who is on leave this month?"), chip("Last month","Who was on leave last month?")]});
      }
      if(!on.length) return reply([P(vary(["Good news — ","All clear: ","Looks like "])+"nobody in **"+team+"** is on leave "+whenTxt+". "+(marked===rows.length?"Everyone's attendance is marked.":marked+" of "+rows.length+" attendance entries are filled in so far."))],
        {source:src, chips:[chip("Tomorrow","Who is on leave tomorrow?")], offer: period.kind==="day" ? {q:"Who is on leave this month?", text:"Want me to check the whole month instead?"} : null});
      const byAgent = {};
      on.forEach(r=>{ (byAgent[r.empId]=byAgent[r.empId]||{name:r.name, items:[]}).items.push(r); });
      const lines = Object.values(byAgent).sort((x,y)=>x.name.localeCompare(y.name));
      const dayMode = period.kind==="day";
      return reply([P((lines.length===1 ? "Just **one person**" : "**"+lines.length+" people**")+" from "+team+" "+(lines.length===1?"is":"are")+" on leave "+whenTxt+":"),
        TABLE(dayMode ? ["Agent","Type"] : ["Agent","Days","Dates"], lines.slice(0,30).map(l=>{
          if(dayMode){ const r=l.items[0]; return [l.name, r.attendance==="Half day" ? "Half day" : (leaveTypeName(S,r.leaveType)||"Leave")]; }
          const ranges = toRanges(l.items.sort((x,y)=>x.iso.localeCompare(y.iso)));
          return [l.name, {text:String(ranges.reduce((s,r)=>s+r.days,0)), mono:true}, ranges.map(r=>r.start===r.end?N.fmtShort(r.start):N.fmtShort(r.start)+"–"+N.fmtShort(r.end)).join(", ")];
        })), lines.length>30 ? NOTE("Showing 30 of "+lines.length+".") : null], {source:src, chips:[chip("Missing attendance today","Who has missing attendance today?")]});
    }
    // otherwise: attendance split
    const counts = {};
    rows.forEach(r=>{ const k = r.attendance || "Not marked"; counts[k]=(counts[k]||0)+1; });
    return reply([P("Attendance for **"+subj.label+"** · "+period.label+":"), TABLE(["Attendance","Entries"], Object.keys(counts).sort().map(k=>[k,{text:String(counts[k]),mono:true}]))], {source:src});
  }

  /* =====================================================================  SHIFTS / BREAKS / SWAPS  */
  async function hShift(S, c){
    if(!S.tabs.has("breaks")) return denyPage(S, "shift or break schedules");
    const subj = subjectOf(S, c);
    if(/\bswaps?\b/.test(c.norm)){
      if(subj.kind==="denied-others" && !c.selfRef) return denySelfOnly(S);
      const all = S.swaps();
      const list = /\bpending\b/.test(c.norm) ? all.filter(s=>s.status==="pending") : all;
      if(!list.length) return reply([P(/\bpending\b/.test(c.norm) ? "No pending shift-swap requests." : "No shift-swap requests found.")], {source:"Break Schedule · Shift swaps"});
      return reply([P("**"+plural(list.length,"shift-swap request")+"**"+(/\bpending\b/.test(c.norm)?" pending":"")+":"),
        TABLE(["Date","Requested by","Swap with","Status"], list.slice(-15).reverse().map(s=>{
          const ok = s.byWFM || s.status==="approved";
          return [N.fmtDay(s.date), s.requester, s.recipient, {text:s.byWFM ? "Swapped by WFM" : s.status.charAt(0).toUpperCase()+s.status.slice(1), badge: ok ? "green" : (s.status==="rejected" ? "red" : "yellow")}];
        }))],
        {source:"Break Schedule · Shift swaps"});
    }
    const blocked = subjectBlock(S, c, subj); if(blocked) return blocked;
    if(subj.kind==="self" || (subj.kind==="people" && subj.people.length<=3)){
      const blocks = [];
      subj.people.forEach(p=>{
        const who = subj.kind==="self" ? "Your schedule" : p.name+"'s schedule";
        blocks.push(P("**"+who+"**"+(lobsOf(p).length?" · "+lobTxt(p):"")+":"));
        blocks.push(TABLE(["","Time"], [["Shift", {text:rng(p.shift), mono:true}], ["Break 1", {text:rng(p.break1), mono:true}], ["Lunch", {text:rng(p.lunch), mono:true}], ["Break 2", {text:rng(p.break2), mono:true}]]));
      });
      blocks.push(NOTE("Times are the ones set in the Break Schedule."));
      return reply(blocks, {source:"Break Schedule", chips:S.isAgent ? [chip("Any shift swap requests?","Any pending shift swap requests?")] : []});
    }
    const act = subj.people.filter(p=>p.status==="Active");
    return reply([P("**Shifts · "+subj.label+"** ("+act.length+" active):"),
      TABLE(["Agent","Shift","Lunch"], act.slice(0,30).map(p=>[p.name,{text:rng(p.shift),mono:true},{text:rng(p.lunch),mono:true}])),
      act.length>30 ? NOTE("Showing 30 of "+act.length+" — ask about a specific person for break times.") : null], {source:"Break Schedule"});
  }

  /* =====================================================================  ROSTER  */
  async function hRoster(S, c){
    if(S.isAgent){
      const me = S.me();
      if(!me) return reply([P("I couldn't find your roster record.")]);
      if(c.teamRef && !c.selfRef || c.otherPersonRef) return denySelfOnly(S);
      return reply([P("Here's your profile:"), TABLE(["",""], [["Name",me.name],["Employee ID",{text:me.empId,mono:true}],["Team leader",me.tlName||"—"],["LOB",lobTxt(me)||"—"],["Status",me.status],["Joined",me.joiningDate?N.fmtDay(me.joiningDate):"—"]])],
        {source:"Your roster record"});
    }
    if(!S.can.roster) return denyPage(S, "roster details");
    const subj = subjectOf(S, c);
    const blocked = subjectBlock(S, c, subj); if(blocked) return blocked;
    if(subj.kind==="people" && subj.people.length===1){
      const p = subj.people[0];
      return reply([P("**"+p.name+"**"), TABLE(["",""], [["Employee ID",{text:p.empId,mono:true}],["Team leader",p.tlName||"—"],["LOB",lobTxt(p)||"—"],["Status",p.status+(p.inactiveSince?" since "+N.fmtDay(p.inactiveSince):"")],["Joined",p.joiningDate?N.fmtDay(p.joiningDate):"—"],["Shift",{text:rng(p.shift),mono:true}]])],
        {source:"Team Roster", chips:[chip("Their performance", p.name+" performance this month")]});
    }
    const ppl = subj.people;
    const active = ppl.filter(p=>p.status==="Active"), inactive = ppl.filter(p=>p.status!=="Active");
    if(/\binactive\b/.test(c.norm)) return reply([inactive.length ? P("**"+plural(inactive.length,"inactive agent")+"** in "+subj.label+":") : P("No inactive agents in **"+subj.label+"**."),
      inactive.length ? TABLE(["Agent","TL","Since"], inactive.slice(0,30).map(p=>[p.name,p.tlName||"—",p.inactiveSince?N.fmtDay(p.inactiveSince):"—"])) : null], {source:"Team Roster"});
    if(/\b(new joiners?|joined|joining)\b/.test(c.norm)){
      const per = c.period;
      const joined = ppl.filter(p=>p.joiningDate && p.joiningDate>=per.from && p.joiningDate<=per.to);
      return reply([joined.length ? P("**"+plural(joined.length,"person","people")+"** joined "+subj.label+" in "+per.label+":") : P("Nobody joined **"+subj.label+"** in "+per.label+"."),
        joined.length ? TABLE(["Agent","Joined","TL"], joined.map(p=>[p.name,N.fmtDay(p.joiningDate),p.tlName||"—"])) : null], {source:"Team Roster"});
    }
    if(/\b(list|who is in|team members|members|names)\b/.test(c.norm) && !/\bhow many\b/.test(c.norm)){
      return reply([P("**"+subj.label.charAt(0).toUpperCase()+subj.label.slice(1)+"** — "+active.length+" active:"),
        TABLE(["Agent","ID","TL","LOB"], active.slice(0,40).map(p=>[p.name,{text:p.empId,mono:true},p.tlName||"—",lobTxt(p)||"—"])), active.length>40?NOTE("Showing 40 of "+active.length+"."):null], {source:"Team Roster"});
    }
    const byLob = {}, byTl = {};
    active.forEach(p=>{ (lobsOf(p).length?lobsOf(p):["Unassigned"]).forEach(k=>{ byLob[k]=(byLob[k]||0)+1; }); byTl[p.tlName||"Unassigned"]=(byTl[p.tlName||"Unassigned"]||0)+1; });
    const blocks = [P("**"+subj.label.charAt(0).toUpperCase()+subj.label.slice(1)+"**: "+active.length+" active"+(inactive.length?" · "+inactive.length+" inactive":"")+".")];
    if(Object.keys(byLob).length>1) blocks.push(TABLE(["LOB","Active agents"], Object.keys(byLob).sort().map(k=>[k,{text:String(byLob[k]),mono:true}])));
    if(S.reach==="org" && Object.keys(byTl).length>1 && !c.tl) blocks.push(TABLE(["Team leader","Active agents"], Object.keys(byTl).sort().map(k=>[k,{text:String(byTl[k]),mono:true}])));
    return reply(blocks, {source:"Team Roster", chips:[chip("Who is on leave today?","Who is on leave today?")]});
  }

  /* =====================================================================  QUALITY AUDITS  */
  const scoreClass = x => x>=0.9 ? "green" : x>=0.8 ? "yellow" : "red";
  const pct = x => (Math.round(x*1000)/10).toFixed(1).replace(/\.0$/,"")+"%";
  async function hAudit(S, c){
    if(!S.can.qa) return denyPage(S, "Quality Audit results");
    const subj = (S.isQuality) ? {kind:"auditor"} : subjectOf(S, c);
    if(!S.isQuality){
      if(S.reach==="self" && (c.rank || c.exceptions) && !c.selfRef) return denySelfOnly(S);
      const b = subjectBlock(S, c, subj); if(b) return b;
    }
    let audits = S.audits();
    const ids = subj.kind==="self" || subj.kind==="auditor" ? null : new Set(subj.people.map(p=>p.empId));
    if(ids) audits = audits.filter(a=>ids.has(a.agentEmpId));
    if(c.lob && !S.isAgent) audits = audits.filter(a=>a.lob===c.lob);
    const per = c.period;
    if(per.explicit) audits = audits.filter(a=>a.auditDate>=per.from && a.auditDate<=per.to);
    const scope = S.isQuality ? "audits you submitted" : subj.kind==="self" ? "your audits" : subj.kind==="people" ? "audits for the selected agents" : subj.label;
    const when = per.explicit ? per.label : "all audits on record";
    const src = "Quality Audit · "+when;
    if(!audits.length) return reply([P("No audits found for **"+scope+"** ("+when+").")], {source:src});

    const avg = audits.reduce((s,a)=>s+a.score,0)/audits.length;
    const ztpFails = audits.filter(a=>a.ztp==="Not Met");
    const blocks = [];

    // staff asking "lowest audit scores / who failed zero tolerance"
    const groupView = !S.isQuality && subj.kind==="group";
    if(groupView && /\b(zero tolerance|ztp)\b/.test(c.norm)){
      const by = {}; ztpFails.forEach(a=>{ (by[a.agentName]=by[a.agentName]||[]).push(a); });
      const names = Object.keys(by).sort();
      return reply([names.length ? P("**"+plural(ztpFails.length,"audit")+"** failed Zero Tolerance ("+when+") across "+plural(names.length,"agent")+":") : P("No Zero Tolerance failures in **"+scope+"** ("+when+")."),
        names.length ? TABLE(["Agent","Failed audits","Latest"], names.map(n=>[n,{text:String(by[n].length),mono:true},N.fmtDay(by[n].map(a=>a.auditDate).sort().pop())])) : null], {source:src});
    }
    if(groupView && (c.rank || /\b(lowest|highest|best|worst|scores?)\b/.test(c.norm)) ){
      const per2 = {};
      audits.forEach(a=>{ const x = per2[a.agentEmpId] = per2[a.agentEmpId] || {name:a.agentName, n:0, sum:0}; x.n++; x.sum+=a.score; });
      const list = Object.values(per2).map(x=>({name:x.name, n:x.n, avg:x.sum/x.n}));
      const best = c.rank && (c.rank.dir==="best"||c.rank.dir==="high");
      list.sort((a,b)=> best ? b.avg-a.avg : a.avg-b.avg);
      const n = Math.min(15, c.rank && c.rank.n ? c.rank.n : 5);
      return reply([P("**"+(best?"Highest":"Lowest")+" average audit scores** · "+scope+" · "+when+":"),
        TABLE(["#","Agent","Average","Audits"], list.slice(0,n).map((x,i)=>[String(i+1),x.name,{text:pct(x.avg),badge:scoreClass(x.avg)},{text:String(x.n),mono:true}])),
        NOTE("Team average: "+pct(avg)+" across "+plural(audits.length,"audit")+".")], {source:src});
    }

    blocks.push(STAT({label:(S.isQuality?"Average score of audits you submitted":subj.kind==="self"?"Your average audit score":"Average audit score")+" · "+when, value:pct(avg).replace("%",""), unit:"%", status:scoreClass(avg),
      sub:plural(audits.length,"audit")+(ztpFails.length?" · "+plural(ztpFails.length,"Zero Tolerance failure"):" · no Zero Tolerance failures")}));
    const latest = audits.slice().sort((a,b)=>String(b.auditDate).localeCompare(String(a.auditDate))).slice(0,5);
    const showAgent = subj.kind!=="self";
    blocks.push(TABLE(["Date"].concat(showAgent?["Agent"]:[]).concat(["Call ID","Score","Zero tol."]), latest.map(a=>[N.fmtDay(a.auditDate)].concat(showAgent?[a.agentName]:[]).concat([{text:a.callId||"—",mono:true},{text:pct(a.score),badge:scoreClass(a.score)}, a.ztp==="Not Met"?{text:"Not met",badge:"red"}:"Met"]))));
    // what is being missed most
    const params = S.qaParams();
    const miss = {};
    audits.forEach(a=>Object.keys(a.params).forEach(n=>{ if(a.params[n].tag==="No"){ const m = miss[n] = miss[n] || {n:Number(n), count:0, errs:{}}; m.count++; const e=a.params[n].error; if(e) m.errs[e]=(m.errs[e]||0)+1; } }));
    const top = Object.values(miss).sort((a,b)=>b.count-a.count).slice(0,5);
    const wantMissed = /\b(missed|miss|fail\w*|error|errors|parameters?|weak|improve|coaching|common)\b/.test(c.norm);
    if(top.length && (wantMissed || audits.length>=1)){
      blocks.push(P(wantMissed ? "**Most missed parameters:**" : "**Where points were lost most:**"));
      blocks.push(TABLE(["Parameter","Category","Missed","Most common error"], top.map(m=>{ const def = params.find(p=>p.n===m.n)||{}; const err = Object.keys(m.errs).sort((a,b)=>m.errs[b]-m.errs[a])[0]||"—"; return [m.n+". "+(def.name||"Parameter"), def.cat||"—", {text:m.count+"×",mono:true}, cap(err,50)]; })));
    }
    return reply(blocks, {source:src, chips:S.isQuality ? [chip("Most missed parameters","Most missed parameters"), chip("Last month","My audits last month")] : [chip("Last month","Audit score last month")]});
  }

  /* =====================================================================  PKT  */
  async function hPkt(S, c){
    if(!S.can.pkt) return denyPage(S, "PKT information");
    const data = S.pkts();
    if(!data.list.length) return reply([P("There are no published PKTs to show right now.")], {source:"PKT"});
    const open = data.list.filter(p=>p.open);
    const attOf = (pid,eid)=>data.attempts.find(a=>a.pktId===pid && a.empId===eid);

    if(S.isAgent){
      if(c.otherPersonRef || (c.teamRef && !c.selfRef)) return denySelfOnly(S);
      const me = S.me();
      const rows = data.list.slice().sort((a,b)=>String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0,6).map(p=>{
        const a = me && attOf(p.id, me.empId);
        const st = a && a.status==="submitted" ? {text:"Submitted · "+pct(a.score/100), badge:a.passed?"green":"red"} : a ? {text:"In progress",badge:"yellow"} : (p.open ? {text:"Not started",badge:"red"} : {text:"Closed · not taken",badge:"gray"});
        return [p.title+(p.lob?" ("+p.lob+")":""), p.dueDate?N.fmtDay(p.dueDate):"—", st];
      });
      const pending = open.filter(p=>!(me && attOf(p.id, me.empId) && attOf(p.id, me.empId).status==="submitted"));
      return reply([pending.length ? P("You have **"+plural(pending.length,"PKT")+" still to submit.**") : P("You're all caught up — no PKT waiting for you."),
        TABLE(["PKT","Due","Your status"], rows)], {source:"PKT · your attempts", chips:pending.length?[navChip("Open PKT","pkt")]:[]});
    }

    // staff: pick the PKT asked about, else the newest live one, else the newest
    const qn = c.norm;
    let pkt = data.list.find(p=>p.title && qn.includes(N.normName(p.title)));
    if(!pkt) pkt = open.slice().sort((a,b)=>String(b.publishedAt).localeCompare(String(a.publishedAt)))[0] || data.list.slice().sort((a,b)=>String(b.publishedAt).localeCompare(String(a.publishedAt)))[0];
    const subj = S.isQuality ? {kind:"group", label:"all agents", people:data.audience} : subjectOf(S, c);
    const b = subjectBlock(S, c, subj); if(b) return b;
    let audience = (S.isQuality ? data.audience : subj.people).filter(p=>p.status==="Active" && (!pkt.lob || lobsOf(p).includes(pkt.lob)));
    if(c.lob) audience = audience.filter(p=>lobsOf(p).includes(c.lob));
    const ids = new Set(audience.map(p=>p.empId));
    const atts = data.attempts.filter(a=>a.pktId===pkt.id && ids.has(a.empId));
    const submitted = atts.filter(a=>a.status==="submitted");
    const submittedIds = new Set(submitted.map(a=>a.empId));
    const pending = audience.filter(p=>!submittedIds.has(p.empId));
    const avg = submitted.length ? submitted.reduce((s,a)=>s+Number(a.score||0),0)/submitted.length : null;
    const passed = submitted.filter(a=>a.passed).length;
    const head = "**"+pkt.title+"**"+(pkt.lob?" · "+pkt.lob:"")+" · "+(pkt.status==="live"?(pkt.open?"live":"past due"):pkt.status)+(pkt.dueDate?" · due "+N.fmtDay(pkt.dueDate):"");
    if(/\b(not taken|have not|haven t|havent|hasnt|hasn t|yet to|pending|who has not|who hasn t|who did not|didn t|didnt|missing|not submitted|not attempted)\b/.test(qn)){
      return reply([P(head), pending.length ? P("**"+plural(pending.length,"agent")+"** still to submit ("+submitted.length+" of "+audience.length+" done):") : P("Everyone in **"+subj.label+"** has submitted ("+submitted.length+" of "+audience.length+")."),
        pending.length ? LIST(pending.slice(0,30).map(p=>p.name+(p.tlName?" · "+p.tlName:""))) : null], {source:"PKT · "+subj.label});
    }
    const lowest = submitted.slice().sort((a,b)=>a.score-b.score).slice(0,5);
    return reply([P(head), STAT({label:"Average PKT score · "+subj.label, value:avg==null?"—":String(Number(avg.toFixed(1))), unit:avg==null?"":"%", status:avg==null?null:(avg>=(pkt.passMark||80)?"green":"red"), sub:submitted.length+" of "+audience.length+" submitted · "+passed+" passed (pass mark "+(pkt.passMark||"—")+"%)"}),
      lowest.length ? TABLE(["Lowest scores","Score","Result"], lowest.map(a=>[a.agentName,{text:String(Number(Number(a.score).toFixed(1)))+"%",mono:true},a.passed?{text:"Passed",badge:"green"}:{text:"Below pass mark",badge:"red"}])) : null],
      {source:"PKT · "+subj.label, chips:pending.length?[chip("Who hasn't taken it?","Who hasn't taken the PKT?")]:[]});
  }

  /* =====================================================================  LEO (supervisor calls)  */
  async function hLeo(S, c){
    if(!S.can.leo) return denyPage(S, "supervisor-call (LEO) information");
    let calls = S.leoCalls();
    const qn = c.norm;
    const subj = (S.isAgent || S.isClient) ? null : subjectOf(S, c);
    if(S.isAgent && (c.otherPersonRef || (c.teamRef && !c.selfRef))) return denySelfOnly(S);
    if(subj && subj.kind==="people"){ const ids = new Set(subj.people.map(p=>p.empId)); calls = calls.filter(x=>ids.has(x.createdByEmpId)); }
    else if(subj && (subj.kind==="unknown")) return notFoundPerson(S, subj.name);
    else if(subj && subj.kind==="ambiguous") return ambiguousReply(S, subj);
    if(/\b(assigned to me|my queue|mine|assigned)\b/.test(qn) && !S.isAgent) calls = calls.filter(x=>x.assignedToUsername && x.assignedToUsername===S.username);
    if(c.lob) calls = calls.filter(x=>x.lob===c.lob);
    if(c.period.explicit) calls = calls.filter(x=>String(x.createdAt||"").slice(0,10)>=c.period.from && String(x.createdAt||"").slice(0,10)<=c.period.to);
    const now = Date.now();
    const isOpen = x=>x.status==="open";
    const overdue = x=>isOpen(x) && x.callbackAt && Date.parse(x.callbackAt) < now;
    const scopeNote = S.isAgent ? "your sup calls" : S.role==="sme" ? "calls assigned to you" : S.reach==="team" ? "your team's calls (plus any assigned to you)" : "all sup calls";
    const src = "LEO · "+scopeNote+(c.period.explicit?" · "+c.period.label:"");
    if(!calls.length) return reply([P("No sup calls found for **"+scopeNote+"**"+(c.period.explicit?" in "+c.period.label:"")+".")], {source:src});

    if(/\b(reason|reasons|by reason|breakdown|why)\b/.test(qn)){
      const by = {}; calls.forEach(x=>{ const k=x.reason||"No reason"; by[k]=(by[k]||0)+1; });
      return reply([P("**Sup calls by reason** · "+scopeNote+":"), TABLE(["Reason","Calls"], Object.keys(by).sort((a,b)=>by[b]-by[a]).map(k=>[k,{text:String(by[k]),mono:true}]))], {source:src});
    }
    let list = calls, label = "";
    if(/\boverdue\b|\bmissed callbacks?\b|\blate\b/.test(qn)){ list = calls.filter(overdue); label = "overdue"; }
    else if(/\b(set aside)\b/.test(qn)){ list = calls.filter(x=>isOpen(x)&&x.supStatus==="setAside"); label = "set aside"; }
    else if(/\b(resolved|completed|closed|done)\b/.test(qn)){ list = calls.filter(x=>x.status==="completed"); label = "completed"; }
    else if(/\b(cancelled|canceled)\b/.test(qn)){ list = calls.filter(x=>x.status==="cancelled"); label = "cancelled"; }
    else if(/\b(open|pending|new|queue|waiting|outstanding|active)\b/.test(qn)){ list = calls.filter(isOpen); label = "open"; }
    else list = calls.filter(isOpen), label = "open";
    const counts = {open:calls.filter(isOpen).length, overdue:calls.filter(overdue).length, completed:calls.filter(x=>x.status==="completed").length, cancelled:calls.filter(x=>x.status==="cancelled").length};
    list = list.slice().sort((a,b)=> label==="completed"||label==="cancelled" ? String(b.resolvedAt||b.createdAt).localeCompare(String(a.resolvedAt||a.createdAt)) : String(a.callbackAt||"~").localeCompare(String(b.callbackAt||"~")));
    const head = P("**"+plural(list.length,label+" sup call")+"** · "+scopeNote+(counts.overdue&&label!=="overdue"?" — "+counts.overdue+" overdue":"")+":");
    if(!list.length) return reply([P("No **"+label+"** sup calls in "+scopeNote+". (Open: "+counts.open+" · Completed: "+counts.completed+" · Cancelled: "+counts.cancelled+")")], {source:src});
    const showAgent = !S.isAgent;
    return reply([head, TABLE(["Callback","Reason","Ref #"].concat(showAgent?["Logged by"]:[]).concat(["Assigned to"]), list.slice(0,12).map(x=>[
        {text:x.callbackAt?x.callbackAt.replace("T"," ").slice(0,16):"—", mono:true, badge:overdue(x)?"red":null}, x.reason||"—", {text:x.refNumber||"—",mono:true}].concat(showAgent?[x.createdByName||"—"]:[]).concat([x.assignedTo||"—"]))),
      list.length>12 ? NOTE("Showing 12 of "+list.length+".") : null],
      {source:src, chips:[chip("Overdue callbacks","Which sup calls are overdue?"), chip("Calls by reason","Sup calls by reason"), navChip("Open LEO","leo")]});
  }

  /* =====================================================================  KNOWLEDGE BASE / DOCS / UPDATES  */
  const GENERIC = new Set("the and for with how what when where who why can could should would does did have has not you your this that from into about please need want tell show give find get are was were been any there their them they its out our let know using use want search look looking help".split(" "));
  const TRIGGERS = new Set("kb knowledge base article articles sop procedure policy guideline steps step process template templates documentation disposition dispositions update updates latest recent new announcement announcements news".split(" "));
  function stem(w){ return w.length>4 ? w.replace(/(ing|ed|es|s)$/,"") : w; }
  function terms(c, dropTriggers){
    const out = [];
    c.tokens.forEach(t=>{ if(t.length>=3 && !GENERIC.has(t) && !(dropTriggers && TRIGGERS.has(t)) && !/^\d+$/.test(t)){ const s=stem(t); if(!out.includes(s)) out.push(s); } });
    return out;
  }
  function scoreItem(ts, fields){
    let score = 0, matched = 0;
    ts.forEach(t=>{
      let hit = false;
      fields.forEach(f=>{
        const txt = String(f.text||"").toLowerCase(); if(!txt) return;
        let i = txt.indexOf(t), n = 0;
        while(i>=0 && n<3){ n++; i = txt.indexOf(t, i+t.length); }
        if(n){ score += f.w*Math.min(n, f.cap||1); hit = true; }
      });
      if(hit) matched++;
    });
    return {score, matched};
  }
  function best(items, ts, fieldsOf){
    if(!ts.length) return [];
    const need = ts.length===1 ? 1 : Math.ceil(ts.length/2);
    return items.map(it=>Object.assign({it}, scoreItem(ts, fieldsOf(it)))).filter(x=>x.matched>=need && x.score>0).sort((a,b)=>b.matched-a.matched || b.score-a.score);
  }
  function snippet(text, ts, n){
    const sents = (String(text||"").match(/[^.!?]+[.!?]*/g) || []).map(x=>x.trim()).filter(Boolean);
    if(!sents.length) return "";
    let bestS = sents[0], bestN = -1;
    sents.forEach(s=>{ const l=s.toLowerCase(); const k=ts.filter(t=>l.includes(t)).length; if(k>bestN){ bestN=k; bestS=s; } });
    return cap(bestS, n||240);
  }
  const kbFields = a => [{text:a.title,w:6},{text:a.tags.join(" "),w:5},{text:a.category,w:3},{text:a.summary,w:3},{text:a.body,w:1,cap:3}];
  const docFields = d => [{text:d.title,w:6},{text:d.subtitle,w:4},{text:d.bodyText,w:1,cap:3}];
  const updFields = u => [{text:u.title,w:6},{text:u.message,w:2,cap:3}];

  function kbCard(a, ts){
    const d = ago(a.reviewedAt || a.updatedAt);
    const stale = d!=null && d>120;
    return {title:a.title, meta:Array.from(new Set([a.lob||"General", a.category].filter(Boolean))).join(" · "), text:(a.summary ? "⚡ "+cap(a.summary,260) : snippet(a.body, ts)), warn:stale ? "Last reviewed "+d+" days ago — may be outdated." : "", actions:[{label:"Open article", kb:a.id}]};
  }
  async function hSearch(S, c, mode){
    const ts = terms(c, true);
    const kb = S.kb(), docs = S.docs(), ups = S.updates();
    if(!kb.length && !docs.length && !ups.length) return denyPage(S, "Knowledge Base or documentation content");
    if(!ts.length) return reply([P("What would you like to look up? For example “how do I handle a claim denial call?” or “appeal template”.")], {chips:starterChips(S)});
    const blocks = []; let found = 0;
    const kbHits = (mode==="docs"||mode==="updates") ? [] : best(kb, ts, kbFields).slice(0,3);
    const docHits = (mode==="updates") ? [] : best(docs, ts, docFields).slice(0,mode==="docs"?4:2);
    const upHits = (mode==="docs"||mode==="kb") ? [] : best(ups, ts, updFields).slice(0,2);
    if(kbHits.length){ found+=kbHits.length; blocks.push(P("From the **Knowledge Base**:")); blocks.push(CARDS(kbHits.map(h=>kbCard(h.it, ts)))); }
    if(docHits.length){ found+=docHits.length; blocks.push(P("**Documentation templates**:")); blocks.push(CARDS(docHits.map(h=>({title:h.it.title+(h.it.subtitle?" — "+h.it.subtitle:""), meta:(h.it.lob||"All LOBs")+(h.it.isEmail?" · Email":""), text:cap(h.it.bodyText,260), actions:[{label:"Open Documentation", nav:"documentation"}]})))); }
    if(upHits.length){ found+=upHits.length; blocks.push(P("**Process updates**:")); blocks.push(CARDS(upHits.map(h=>({title:h.it.title, meta:[h.it.lob||"All LOBs", h.it.postedAt?N.fmtDay(String(h.it.postedAt).slice(0,10)):""].filter(Boolean).join(" · "), text:snippet(h.it.message, ts), actions:[{label:"Open Process Update", nav:"processupdate"}]})))); }
    // IPA / vendor directory (only for people who manage documentation)
    if(mode==="docs" || /\b(ipa|vendor)\b/.test(c.norm)){
      const ipa = best(S.ipaDirectory(), ts, i=>[{text:i.name,w:6},{text:i.code,w:5},{text:i.address,w:1}]).slice(0,3);
      if(ipa.length){ found+=ipa.length; blocks.push(P("**IPA / vendor directory**:")); blocks.push(TABLE(["Name","Phone","Address"], ipa.map(h=>[h.it.name,{text:h.it.phone||"—",mono:true},cap(h.it.address,60)||"—"]))); }
    }
    if(!found){
      return reply([P("I couldn't find anything about **“"+cap(c.raw,60)+"”** in the Knowledge Base, documentation or process updates you have access to."),
        NOTE(S.can.kb ? "Tip: the Knowledge Base page has a “can't find it? ask for it” option, so the team can add it." : "The Knowledge Base isn't available to your login, so I searched documentation and updates only.")],
        {chips:(S.can.kb?[navChip("Open Knowledge Base","kb")]:[]).concat(starterChips(S).slice(0,3))});
    }
    return reply(blocks, {source:"Align360 Knowledge Base, templates & updates", chips:S.can.kb?[navChip("Browse Knowledge Base","kb")]:[]});
  }
  async function hUpdates(S, c){
    if(!S.can.updates) return denyPage(S, "process updates");
    const ts = terms(c, true);
    let ups = S.updates().slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || String(b.postedAt).localeCompare(String(a.postedAt)));
    if(ts.length) { const hits = best(ups, ts, updFields); if(hits.length) ups = hits.map(h=>h.it); }
    if(c.lob) ups = ups.filter(u=>!u.lob || u.lob===c.lob);
    if(!ups.length) return reply([P("There are no process updates to show.")], {source:"Process Update"});
    return reply([P(ts.length ? "Process updates matching your question:" : "**Latest process updates:**"),
      CARDS(ups.slice(0,4).map(u=>({title:(u.pinned?"📌 ":"")+u.title, meta:[u.lob||"All LOBs", u.postedBy, u.postedAt?N.fmtDay(String(u.postedAt).slice(0,10)):""].filter(Boolean).join(" · "), text:cap(u.message,260), actions:[{label:"Open Process Update", nav:"processupdate"}]}))),
      ups.length>4?NOTE("Showing 4 of "+ups.length+" — the Process Update page has the rest."):null], {source:"Process Update", chips:[navChip("Open Process Update","processupdate")]});
  }
  async function hDocs(S, c){
    if(!S.can.docs) return denyPage(S, "documentation templates");
    const ts = terms(c, true);
    if(ts.length) return hSearch(S, c, "docs");
    const docs = S.docs();
    if(!docs.length) return reply([P("There are no documentation templates available for you yet.")], {source:"Documentation template"});
    const titles = Array.from(new Set(docs.map(d=>d.title))).slice(0,15);
    return reply([P("**"+plural(new Set(docs.map(d=>d.title)).size,"documentation template")+"** available to you:"), LIST(titles), NOTE("Ask for one by name to see its text, e.g. “claim denial template”.")], {source:"Documentation template", chips:[navChip("Open Documentation","documentation")]});
  }

  /* =====================================================================  DAILY SUMMARY (service level etc.)  */
  async function hDailySummary(S, c){
    if(!S.can.dailySummary) return denyPage(S, "Daily Summary numbers");
    const data = S.dailySummary(), params = S.settings().dsParams;
    if(!data.length) return reply([P("No Daily Summary data has been uploaded yet.")], {source:"Daily Summary"});
    const qn = c.norm;
    const synonyms = {serviceLevel:/\b(service level|sla)\b/, abandoned:/\babandon\w*\b/, occupancy:/\boccupancy\b/, forecast:/\bforecast\b/, offered:/\boffered\b/, handled:/\bhandled\b/, billableFTE:/\b(billable|fte)\b/, actualFTE:/\b(actual|fte)\b/, shrinkage:/\bshrinkage\b/};
    let chosen = params.filter(p=>(synonyms[p.id]&&synonyms[p.id].test(qn)) || qn.includes(N.normName(p.name)));
    if(!chosen.length) chosen = params;
    let lobs = c.lob ? [c.lob] : S.settings().lobs;
    let from, to, label;
    if(c.period.explicit){ from=c.period.from; to=c.period.to; label=c.period.label; }
    else { const latest = data.filter(r=>!c.lob || r.lob===c.lob).map(r=>r.date).sort().pop(); if(!latest) return reply([P("No Daily Summary data for **"+c.lob+"** yet.")], {source:"Daily Summary"}); from=to=latest; label="latest data ("+N.fmtDay(latest)+")"; }
    const inRange = data.filter(r=>r.date>=from && r.date<=to);
    const sumIds = new Set(["forecast","offered","handled"]);
    const val = (lob,p)=>{ const arr = inRange.filter(r=>r.lob===lob).map(r=>r.values[p.field]).filter(v=>v!=="" && v!=null && !isNaN(v)).map(Number); if(!arr.length) return null; return sumIds.has(p.id) ? arr.reduce((a,b)=>a+b,0) : arr.reduce((a,b)=>a+b,0)/arr.length; };
    lobs = lobs.filter(l=>inRange.some(r=>r.lob===l));
    if(!lobs.length) return reply([P("No Daily Summary data for "+label+(c.lob?" ("+c.lob+")":"")+".")], {source:"Daily Summary"});
    const f = (p,v)=> v==null ? {text:"—"} : {text:String(Number(Number(v).toFixed(1)))+(p.unit==="%"?"%":""), mono:true, status:dsColor(p,v)};
    return reply([P("**Daily Summary · "+label+"**"+(from!==to?" (counts are summed, rates are averaged)":"")+":"),
      TABLE(["Metric"].concat(lobs).concat(lobs.length>1?[]:["Target"]), chosen.map(p=>[p.name].concat(lobs.map(l=>f(p,val(l,p)))).concat(lobs.length>1?[]:[p.direction==="none"?"—":{text:(p.direction==="lower"?"≤ ":"≥ ")+p.target+(p.unit==="%"?"%":""),mono:true}])))],
      {source:"Daily Summary · "+label, chips:[chip("Last week","Service level last week")]});
  }

  /* =====================================================================  AUDIT LOG (full Admin only)  */
  async function hAuditLog(S, c){
    if(!S.can.auditLog) return denyPage(S, "the Audit Log (Admin only)");
    let log = S.auditLog();
    if(c.period.explicit) log = log.filter(e=>String(e.at).slice(0,10)>=c.period.from && String(e.at).slice(0,10)<=c.period.to);
    const ts = terms(c, true).filter(t=>!["audit","log","change","changes","recent","action","actions","who"].includes(t));
    if(ts.length){ const hits = best(log, ts, e=>[{text:e.actorName,w:4},{text:e.action,w:3},{text:e.summary,w:2}]); log = hits.map(h=>h.it); }
    if(!log.length) return reply([P("No matching Audit Log entries.")], {source:"Audit Log"});
    return reply([P("**Latest "+Math.min(10,log.length)+" Audit Log entries**"+(c.period.explicit?" · "+c.period.label:"")+":"),
      TABLE(["When","Who","Action","Details"], log.slice(0,10).map(e=>[{text:String(e.at).replace("T"," ").slice(0,16),mono:true},e.actorName+(e.actorRole?" ("+e.actorRole+")":""),e.action,cap(e.summary,70)]))], {source:"Audit Log", chips:[navChip("Open Audit Log","auditlog")]});
  }

  /* =====================================================================  NAVIGATION / ABOUT  */
  function tabLabel(id){ const t = (typeof TABS!=="undefined" ? TABS : []).find(x=>x.id===id); return t ? t.label : id; }
  async function hNav(S, c){
    const tab = N.navTarget(c.norm, S);
    if(!tab) return hSearch(S, c, "all");
    if(!S.tabs.has(tab)) return reply([P("Your **"+S.roleLabel+"** login doesn't have the **"+tabLabel(tab)+"** page.")], {chips:starterChips(S)});
    if(/^(open|go to|goto|take me to|navigate to|show)\b/.test(c.norm)){
      S.actions.nav(tab);
      return reply([P("Opened **"+tabLabel(tab)+"**.")], {chips:starterChips(S).slice(0,3)});
    }
    return reply([P("**"+tabLabel(tab)+"** is in the menu"+(S.tabs.size?" on the left (or under “More” on mobile)":"")+".")], {chips:[navChip("Open "+tabLabel(tab), tab)]});
  }
  async function hWhoami(S){
    const pages = Array.from(S.tabs).map(tabLabel);
    const reachTxt = S.reach==="self" ? "your own performance, attendance, schedule, audits, PKT results and sup calls — plus shared content (Knowledge Base, process updates, templates for your LOB)."
      : S.reach==="team" ? "your team's data ("+(S.tlName||"your team")+"), plus shared content."
      : S.reach==="none" ? "the quality audits you submitted, PKT results, and shared content."
      : S.isClient ? "dashboard-level numbers, Daily Summary, process updates and documentation."
      : "all teams, within the pages your role has.";
    return reply([P("You're signed in as **"+S.userName+"** — **"+S.roleLabel+"**."), P("I can answer from: "+reachTxt),
      NOTE("Pages you have: "+pages.join(", ")+"."), NOTE("What I can see always matches your login — I can't be asked to show more than your pages do.")], {chips:starterChips(S)});
  }
  async function hHelp(S){
    const items = [];
    if(S.canMetrics) items.push(S.isAgent ? "Your KPIs — “my AHT this month”, “how am I doing”, “what is the CQ target?”" : "Team or agent KPIs — “AHT of Priya”, “team CQ last month”, “top 5 by PKT”, “who is at risk?”");
    if(S.canMetrics) items.push(S.isAgent ? "Your attendance & leave — “how many leaves did I take?”" : "Attendance — “who is on leave today?”, “missing attendance”");
    if(S.tabs.has("breaks")) items.push(S.isAgent ? "Your shift and breaks — “when is my lunch?”, “my pending shift swaps”" : "Shifts and swaps — “shift of Priya”, “pending swaps”");
    if(S.can.roster) items.push("Roster — “how many agents in Claims?”, “inactive agents”, “new joiners this month”");
    if(S.can.qa) items.push(S.isAgent ? "Your audits — “my latest audit”, “what do I miss most?”" : "Audits — “lowest audit scores”, “zero tolerance failures”, “most missed parameters”");
    if(S.can.pkt) items.push(S.isAgent ? "PKT — “do I have a pending PKT?”" : "PKT — “who hasn't taken the PKT?”, “PKT average”");
    if(S.can.leo) items.push("Sup calls (LEO) — “open sup calls”, “overdue callbacks”, “calls by reason”");
    if(S.can.dailySummary) items.push("Daily Summary — “service level yesterday”, “Claims occupancy last week”");
    if(S.can.kb) items.push("Knowledge Base & templates — “how do I handle a claim denial?”, “appeal template”");
    if(S.can.updates) items.push("Process updates — “latest process updates”");
    if(S.can.auditLog) items.push("Audit Log — “recent changes”");
    return reply([P("I'm **Ally**. I answer from Align360's own data only — nothing from the internet — and only what your **"+S.roleLabel+"** login can see. You can ask me things like:"), LIST(items)], {chips:starterChips(S)});
  }

  /* =====================================================================  ROUTER  */
  async function route(S, c){
    switch(c.intent){
      case "empty": return reply([P("Ask me something about your Align360 data.")], {chips:starterChips(S)});
      case "greet": return reply([P("Hi "+(S.userName.split(" ")[0]||"there")+"! I'm **Ally**. What would you like to know?")], {chips:starterChips(S)});
      case "thanks": return reply([P("Happy to help! Ask me anything else about Align360.")], {chips:starterChips(S).slice(0,3)});
      case "bye": return reply([P("See you! I'm here whenever you need me.")]);
      case "help": return hHelp(S);
      case "whoami": return hWhoami(S);
      case "creds": return reply([P("I never share passwords, security answers or account/login details — for anyone, including Admins. Account management lives in **Settings** (Admin only).")], {chips:starterChips(S)});
      case "override": return reply([P("What I can show is decided by the account you're signed in with — **"+S.roleLabel+"** — and that can't be changed from chat. If you need wider access, ask your Admin.")], {chips:starterChips(S)});
      case "auditlog": return hAuditLog(S, c);
      case "nav": return hNav(S, c);
      case "leo": return hLeo(S, c);
      case "audit": return hAudit(S, c);
      case "pkt": return hPkt(S, c);
      case "dailysummary": return hDailySummary(S, c);
      case "updates": return hUpdates(S, c);
      case "docs": return hDocs(S, c);
      case "shift": return hShift(S, c);
      case "leave": return hLeave(S, c);
      case "metric": return hMetric(S, c);
      case "roster": return hRoster(S, c);
      case "kb": return hSearch(S, c, "kb");
      default:
        // a short question that points at another person is a people-lookup, not a Knowledge Base search
        if(S.reach==="self" && c.otherPersonRef && c.tokens.length<=7) return denySelfOnly(S);
        if(S.reach!=="self" && c.unknownPerson && c.tokens.length<=5 && S.reach!=="none") return notFoundPerson(S, c.unknownPerson);
        return hSearch(S, c, "all");
    }
  }

  /* =====================================================================  CONVERSATION  */
  const CARRY = new Set(["metric","leave","shift","audit","pkt","leo","dailysummary"]);
  const STARTS_FOLLOW = /^(and|also|what about|how about|then|same|what if|now|ok and|okay and|check|try|show)\b/;
  const ORD = {first:0,"1st":0,"1":0,one:0,second:1,"2nd":1,"2":1,two:1,third:2,"3rd":2,"3":2,three:2,fourth:3,"4th":3,"4":3,four:3};

  /* the question is a follow-up to the previous one: borrow whatever it leaves out */
  function followUp(c, S, mem){
    if(!mem || !CARRY.has(mem.intent)) return;
    const short = c.tokens.length<=8;
    const newSig = c.period.explicit || c.metrics.length || c.people.length || c.lob || c.tl || c.rank || c.pronoun;
    const opener = STARTS_FOLLOW.test(c.norm);
    if(c.intent==="bare" || (c.intent==="search" && short && newSig)){ c.intent = mem.intent; c.followUp = true; }
    else if(c.intent===mem.intent && short && opener) c.followUp = true;
    const noSubject0 = !c.people.length && !c.lob && !c.tl && !c.unknownPerson && !c.ambiguous;
    // "his leave" / "what about her audits" — the person carries over even when the topic changes
    if(c.pronoun && noSubject0 && mem.people && mem.people.length && short && !c.selfRef){
      const known0 = S.people(); c.people = mem.people.map(id=>known0.find(p=>p.empId===id)).filter(Boolean);
      c.followUp = true;
    }
    if(c.intent!==mem.intent) return;
    const groupAsk = c.rank || c.exceptions || c.teamRef || c.selfRef || /\bwho\b/.test(c.norm);
    // metrics
    if(!c.metrics.length && c.intent==="metric" && mem.metrics && mem.metrics.length && !c.allMetrics && !groupAsk && (c.followUp||short)){
      const defs = S.settings().metrics; c.metrics = mem.metrics.map(f=>defs.find(m=>m.field===f)).filter(Boolean);
    }
    // people ("and Rahul?" names them; "his leave" / "same for her" points back at them)
    const noSubject = !c.people.length && !c.lob && !c.tl && !c.unknownPerson && !c.ambiguous;
    if(short && !groupAsk && noSubject && mem.people && mem.people.length && (c.followUp || c.pronoun || mem.scope==="people")){
      const known = S.people(); c.people = mem.people.map(id=>known.find(p=>p.empId===id)).filter(Boolean);
      if(c.people.length){ c.otherPersonRef = S.reach==="self" ? c.otherPersonRef : false; }
    }
    // a previous "who …?" question stays a "who …?" question when only the period changes
    if(c.followUp && noSubject && !c.people.length && !c.selfRef && mem.scope==="group"){
      c.teamRef = true; c.forceList = true;
      if(mem.lob && !c.lob) c.lob = mem.lob; if(mem.tl && !c.tl) c.tl = mem.tl;
    }
    if(c.followUp && noSubject && !c.people.length && mem.scope==="self") c.selfRef = true;
    // period
    if(!c.period.explicit && mem.period && c.followUp && !c.pronoun){ c.period = mem.period; }
    c.period = c.period || mem.period;
  }
  function memOf(S, c, prev, out){
    const groupish = !!(c.teamRef || c.rank || c.exceptions || c.lob || c.tl || /\bwho\b/.test(c.norm) || c.forceList);
    const scope = c.people.length ? "people" : c.selfRef ? "self" : groupish ? "group" : (prev && prev.scope) || "default";
    const keep = CARRY.has(c.intent) || c.intent==="bare";
    return {
      intent: CARRY.has(c.intent) ? c.intent : (prev && prev.intent),
      metrics: c.metrics.length ? c.metrics.map(m=>m.field) : (keep && prev && prev.intent===c.intent && !c.allMetrics && scope!=="group" ? (prev.metrics||[]) : []),
      people: c.people.length ? c.people.map(p=>p.empId) : (keep && prev && c.followUp && scope!=="group" ? (prev.people||[]) : []),
      period: c.period && c.period.explicit ? c.period : (prev && c.followUp ? prev.period : null),
      lob: c.lob || "", tl: c.tl || "", scope,
      raw: c.raw, offer: out && out.offer || null, choice: out && out.choice ? Object.assign({raw:prev && prev.raw && c.intent==="bare" ? prev.raw : c.raw}, out.choice) : null
    };
  }

  /* chit-chat, feelings and "that's wrong" — answered like a person would, without touching any data */
  function smallTalk(S, c, mem){
    const q = c.norm, n = c.tokens.length;
    const first = (S.userName||"").split(" ")[0] || "there";
    if(n<=6 && /^(how are you|how are u|how do you do|how is it going|how is your day|what is up|whats up)\b/.test(q))
      return reply([P(vary(["Doing well, thanks for asking! ","All good here. ","Running smoothly — "])+"What can I look up for you, "+first+"?")], {chips:starterChips(S).slice(0,4)});
    if(/\b(who are you|what are you|your name|are you (an? )?(ai|bot|human|robot|real)|who made you|who built you)\b/.test(q))
      return reply([P("I'm **Ally**, Align360's built-in assistant. I read the same Align360 data your login can open — nothing from the internet — and put it into plain answers."), NOTE("I don't keep anything you type once you sign out.")], {chips:starterChips(S).slice(0,4)});
    if(n<=3 && /^(ok|okay|k|cool|nice|fine|alright|got it|i see|hmm+|oh|oh ok|okk+|hm)$/.test(q))
      return reply([P(vary(["Anything else you'd like me to check?","Sure — ask me whenever you're ready.","Got it. What next?"]))], {chips:starterChips(S).slice(0,3)});
    if(n<=4 && /^(no|nope|nah|not now|no thanks|no thank you|nothing|that is all|thats all|that is it)$/.test(q))
      return reply([P("Alright — I'll be here if you need anything.")]);
    if(n<=4 && /^(yes|yeah|yep|yup|sure|please do|go ahead|do it|y|ya|yess+)$/.test(q))
      return reply([P("Happy to — what should I look at?"+(mem && mem.raw ? " (My last answer was about “"+cap(mem.raw,50)+"”.)" : ""))], {chips:starterChips(S).slice(0,4)});
    if(/\b(wrong|not what i asked|that is not what|thats not what|incorrect|useless|not helpful|did not understand|do not understand|dont understand|you misunderstood|try again|not right|bad answer)\b/.test(q)){
      const was = mem && mem.raw ? " I took your last question — “"+cap(mem.raw,70)+"” — to be about "+(mem.intent ? "**"+({metric:"performance numbers",leave:"attendance & leave",shift:"shifts & breaks",audit:"audits",pkt:"PKT",leo:"sup calls",dailysummary:"the Daily Summary"}[mem.intent]||"the Knowledge Base")+"**" : "something else")+"." : "";
      return reply([P("Sorry, I may have misread that."+was+" Could you say it again with the person, month or metric you mean? For example “leave in August” or “Rahul's AHT last month”.")], {chips:starterChips(S).slice(0,4)});
    }
    if(n<=8 && /\b(joke|weather|cricket|football|movie|song|recipe|stock price|bitcoin|news today|president|capital of)\b/.test(q) && !c.metrics.length)
      return reply([P("That one's outside what I know — I only work with what's inside Align360. I can help with performance, attendance, schedules, audits, PKT, sup calls and the Knowledge Base.")], {chips:starterChips(S).slice(0,4)});
    return null;
  }

  async function ask(raw, mem){
    const S = AllyScope.build();
    if(!S) return reply([P("Please sign in first — I only answer for a logged-in account.")]);
    let c, out;
    try{
      let text = String(raw||"");
      const t = text.trim().toLowerCase().replace(/[.!?]+$/,"");
      // "yes" to something Ally offered
      if(mem && mem.offer && /^(yes|yeah|yep|yup|sure|ok|okay|please|please do|go ahead|do it|y|ya|haan|yes please|sure thing)$/.test(t)) text = mem.offer.q;
      else if(mem && mem.offer && /^(no|nope|nah|not now|no thanks|nahi)$/.test(t)){
        out = reply([P("No problem. What else can I check?")], {chips:starterChips(S).slice(0,3)});
        out.mem = Object.assign({}, mem, {offer:null, choice:null}); out.identityKey = S.identityKey; return out;
      }
      // "the first one" after Ally asked which person
      else if(mem && mem.choice && mem.choice.names){
        const m = t.match(/^(?:the |number |no |#)?(first|second|third|fourth|1st|2nd|3rd|4th|\d)(?: one)?$/) || (t==="last"||t==="the last one" ? ["", "last"] : null);
        if(m){ const i = m[1]==="last" ? mem.choice.names.length-1 : ORD[m[1]]; if(mem.choice.names[i]!==undefined) text = mem.choice.raw+" "+mem.choice.names[i]; }
      }
      c = AllyNLU.parse(text, S, mem);
      const talk = smallTalk(S, c, mem);
      if(talk){ out = talk; out.mem = Object.assign({}, mem||{}, {offer:null, choice:null}); out.identityKey = S.identityKey; return out; }
      followUp(c, S, mem);
      out = await route(S, c);
      if(c.corrections && c.corrections.length && out.blocks.length){
        const fx = c.corrections.slice(0,3).map(x=>"“"+x.from+"” as “"+x.to+"”").join(", ");
        out.blocks.push(NOTE("I read "+fx+"."));
      }
    }catch(e){
      console.error("Ally: could not answer that question", e && e.message);
      out = reply([P("Something went wrong while I was looking that up — nothing was changed. Try rephrasing, or open the page directly.")], {chips:starterChips(S)});
    }
    if(c) out.mem = memOf(S, c, mem, out);
    out.identityKey = S.identityKey;
    return out;
  }

  return {ask, starterChips:(S)=>starterChips(S)};
})();
