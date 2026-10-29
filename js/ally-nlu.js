/* =========================================================
   ALLY — language understanding  (js/ally-nlu.js)
   ---------------------------------------------------------
   Turns a typed question into a structured "what is being asked": intent, metric(s), period, who it is about,
   ranking words, filters. Plain rules + word lists, run in the browser. No network, no model, no data of its own.
   It only ever sees the scope object from ally-scope.js (e.g. it can only match names against the people that
   login is allowed to see).
   ========================================================= */
const AllyNLU = (function(){
  "use strict";

  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTH_KEYS = {january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
                      jan:0,feb:1,mar:2,apr:3,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
  const DAY_NAMES = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

  /* ---------- text normalising ---------- */
  function norm(s){
    let t = String(s||"").toLowerCase().replace(/[’‘`]/g,"'");
    t = t.replace(/\b(what|who|where|how|that|there|here|it|let)'s\b/g,"$1 is")
         .replace(/\bcan't\b/g,"can not").replace(/\bwon't\b/g,"will not").replace(/n't\b/g," not")
         .replace(/'m\b/g," am").replace(/'ve\b/g," have").replace(/'re\b/g," are").replace(/'ll\b/g," will").replace(/'d\b/g," would")
         .replace(/'s\b/g,"").replace(/'/g," ");
    t = t.replace(/[^a-z0-9%\-\/: ]+/g," ").replace(/\s+/g," ").trim();
    return t;
  }
  function normName(s){ return String(s||"").toLowerCase().replace(/'/g," ").replace(/[^a-z0-9]+/g," ").trim(); }
  function lev(a,b){
    if(a===b) return 0; const m=a.length, n=b.length; if(!m) return n; if(!n) return m;
    let prev = Array.from({length:n+1},(_,j)=>j);
    for(let i=1;i<=m;i++){
      const cur=[i];
      for(let j=1;j<=n;j++) cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+(a[i-1]===b[j-1]?0:1));
      prev = cur;
    }
    return prev[n];
  }
  function pad(n){ return String(n).padStart(2,"0"); }
  function isoOf(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
  function parseIso(iso){ const [y,m,d]=iso.split("-").map(Number); return new Date(y,m-1,d); }
  function addDays(iso,n){ const d=parseIso(iso); d.setDate(d.getDate()+n); return isoOf(d); }
  function daysIn(mIdx,y){ return new Date(y,mIdx+1,0).getDate(); }
  function fmtDay(iso){ const d=parseIso(iso); return d.getDate()+" "+MONTH_NAMES[d.getMonth()].slice(0,3)+" "+d.getFullYear(); }
  function fmtShort(iso){ const d=parseIso(iso); return d.getDate()+" "+MONTH_NAMES[d.getMonth()].slice(0,3); }

  /* ---------- vocabulary: words that are NOT somebody's name ---------- */
  const STATIC_VOCAB = new Set((
    "a an the and or of for to in on at by with is are was were be been am do does did have has had can could would should will shall may might must " +
    "me my mine myself i you your yours it its this that these those please pls tell show give get got what which who whom whose how many much any some all " +
    "there their they them he she his her about from as if than then so just also now still yet ever again more most less least very too not no yes " +
    "agent agents team teams member members people person everyone everybody anyone someone others other colleague colleagues peers peer " +
    "tl tls leader leaders manager managers supervisor supervisors sme smes trainer trainers client wfm admin quality analyst " +
    "today yesterday tomorrow tonight week weeks month months year years day days last past previous current this next ago since until till " +
    "monday tuesday wednesday thursday friday saturday sunday weekend weekday mtd ytd " +
    "january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec " +
    "aht handle handling time call calls quality score scores average avg total target targets threshold goal pkt knowledge product test tests quiz cq " +
    "performance perform performing kpi kpis metric metrics stats statistics scorecard report card status rank ranking ranked top best worst bottom highest lowest " +
    "risk red yellow green below above under over meeting meet missed missing behind ahead track watch need needs attention coaching " +
    "leave leaves absent absence attendance present holiday half weekoff off sick lwp balance taken take " +
    "shift shifts timing timings break breaks lunch schedule swap swaps swapped pending approved rejected start end login logout hours working work " +
    "roster headcount count size list join joined joining joiner joiners inactive active new status " +
    "audit audits audited qa zero tolerance ztp calibration rubric parameter parameters error errors category fail failed failing pass passed " +
    "sup leo callback escalation escalations escalated queue open closed completed resolved cancelled reason reasons assigned overdue " +
    "update updates process announcement announcements news latest recent kb article articles sop procedure policy guideline steps step how where find search " +
    "template templates documentation document disposition dispositions ipa vendor email script directory " +
    "service level sla abandon abandoned occupancy forecast offered handled fte billable shrinkage summary daily weekly monthly " +
    "lob lobs line business claims eligibility intake um " +
    "open go take navigate page tab section dashboard settings help hello hi hey thanks thank bye good morning afternoon evening " +
    "compare versus vs between difference trend trends improve improved improving decline declined change changed " +
    "per percent percentage number numbers value values data info information details detail overall summary breakdown " +
    "see view check know want like need can cannot why because why does should access allowed allow role permission permissions " +
    "up down high low long short old newest oldest first second third fourth fifth one two three four five six seven eight nine ten " +
    "id name names emp employee employees show me display list give"
  ).split(/\s+/));

  /* ---------- period ---------- */
  function monthPeriod(mIdx,y,explicit){
    return {kind:"month", from:y+"-"+pad(mIdx+1)+"-01", to:y+"-"+pad(mIdx+1)+"-"+pad(daysIn(mIdx,y)), mIdx, year:y,
            label:MONTH_NAMES[mIdx]+" "+y, explicit:!!explicit};
  }
  function parsePeriodCore(raw, todayIso){
    const q = String(raw||"").toLowerCase();
    const t = parseIso(todayIso), ty=t.getFullYear(), tm=t.getMonth();
    let m;
    // exact ISO / dd/mm(/yyyy) / "15 march" / "march 15"
    if((m = q.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/))) return {kind:"day", from:m[0], to:m[0], label:fmtDay(m[0]), explicit:true};
    if((m = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))){
      let y = m[3] ? Number(m[3]) : ty; if(y<100) y+=2000;
      const iso = y+"-"+pad(Number(m[2]))+"-"+pad(Number(m[1]));
      if(Number(m[2])>=1 && Number(m[2])<=12 && Number(m[1])>=1 && Number(m[1])<=31) return {kind:"day", from:iso, to:iso, label:fmtDay(iso), explicit:true};
    }
    const monRe = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
    if((m = q.match(new RegExp("\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?"+monRe+"\\b(?:\\s+(20\\d\\d))?")))){
      const mi=MONTH_KEYS[m[2]], y=m[3]?Number(m[3]):ty; const iso=y+"-"+pad(mi+1)+"-"+pad(Number(m[1]));
      return {kind:"day", from:iso, to:iso, label:fmtDay(iso), explicit:true};
    }
    if((m = q.match(new RegExp("\\b"+monRe+"\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*(?:20\\d\\d))")))){
      const mi=MONTH_KEYS[m[1]], y=ty; const iso=y+"-"+pad(mi+1)+"-"+pad(Number(m[2]));
      if(Number(m[2])>=1 && Number(m[2])<=31) return {kind:"day", from:iso, to:iso, label:fmtDay(iso), explicit:true};
    }
    if(/\bday before yesterday\b/.test(q)){ const d=addDays(todayIso,-2); return {kind:"day", from:d, to:d, label:fmtDay(d), explicit:true}; }
    if(/\btomorrow\b/.test(q)){ const d=addDays(todayIso,1); return {kind:"day", from:d, to:d, label:"tomorrow ("+fmtDay(d)+")", explicit:true}; }
    if((m = q.match(/\b(last|previous|this|on|coming|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))){
      const want = DAY_NAMES.indexOf(m[2]); const today = parseIso(todayIso); const dow = today.getDay();
      let diff = want - dow;                          // within the current Mon-Sun week by default
      if(m[1]==="last"||m[1]==="previous") diff = diff>=0 ? diff-7 : diff;
      else if(m[1]==="next"||m[1]==="coming") diff = diff<=0 ? diff+7 : diff;
      else { const monOff=(dow+6)%7, wantOff=(want+6)%7; diff = wantOff-monOff; }
      const d = addDays(todayIso, diff);
      return {kind:"day", from:d, to:d, label:fmtDay(d), explicit:true};
    }
    if(/\bnext\s+week\b/.test(q)){ const dow=(t.getDay()+6)%7; const from=addDays(todayIso,7-dow), to=addDays(from,6); return {kind:"range", from, to, label:"next week ("+fmtShort(from)+" – "+fmtShort(to)+")", explicit:true}; }
    if(/\bnext\s+month\b/.test(q)){ const d=new Date(ty,tm+1,1); return monthPeriod(d.getMonth(), d.getFullYear(), true); }
    if(/\byesterday\b/.test(q)){ const d=addDays(todayIso,-1); return {kind:"day", from:d, to:d, label:"yesterday ("+fmtDay(d)+")", explicit:true}; }
    if(/\btoday\b|\bright now\b|\bnow\b|\bcurrently\b/.test(q)) return {kind:"day", from:todayIso, to:todayIso, label:"today ("+fmtDay(todayIso)+")", explicit:/\btoday\b/.test(q)};
    if((m = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/))){
      const n=Math.min(92,Math.max(1,Number(m[1]))); const from=addDays(todayIso,-(n-1));
      return {kind:"range", from, to:todayIso, label:"the last "+n+" days", explicit:true};
    }
    if(/\b(this|current)\s+week\b/.test(q) || /\bwtd\b/.test(q)){
      const dow=(t.getDay()+6)%7; const from=addDays(todayIso,-dow);
      return {kind:"range", from, to:todayIso, label:"this week ("+fmtShort(from)+" – "+fmtShort(todayIso)+")", explicit:true};
    }
    if(/\b(last|previous)\s+week\b/.test(q)){
      const dow=(t.getDay()+6)%7; const to=addDays(todayIso,-dow-1), from=addDays(to,-6);
      return {kind:"range", from, to, label:"last week ("+fmtShort(from)+" – "+fmtShort(to)+")", explicit:true};
    }
    if((m = q.match(new RegExp("\\bweek\\s+(\\d)\\b(?:\\s+(?:of\\s+)?"+monRe+")?(?:\\s+(20\\d\\d))?")))){
      const wk=Number(m[1]); const mi = m[2]!==undefined ? MONTH_KEYS[m[2]] : tm; const y = m[3]?Number(m[3]):ty;
      const mondayIdx=(new Date(y,mi,1).getDay()+6)%7; const nd=daysIn(mi,y);
      const sd=Math.max(1, wk*7-mondayIdx-6), ed=Math.min(nd, wk*7-mondayIdx);
      if(sd<=nd && wk>=1){ const from=y+"-"+pad(mi+1)+"-"+pad(sd), to=y+"-"+pad(mi+1)+"-"+pad(ed);
        return {kind:"range", from, to, label:"week "+wk+" of "+MONTH_NAMES[mi]+" ("+fmtShort(from)+" – "+fmtShort(to)+")", explicit:true, weekNo:wk, mIdx:mi, year:y}; }
    }
    if(/\b(last|previous)\s+month\b/.test(q)){ const d=new Date(ty,tm-1,1); return monthPeriod(d.getMonth(), d.getFullYear(), true); }
    if(/\b(this|current)\s+month\b|\bmtd\b|\bmonth to date\b/.test(q)) return monthPeriod(tm, ty, true);
    // a month name, optionally with a year. "may" only counts as a month when it is clearly used like one.
    const re = new RegExp("\\b"+monRe+"\\b(?:\\s+(20\\d\\d))?","g"); let mm;
    while((mm = re.exec(q))){
      if(mm[1]==="may" && !/\b(in|for|during|of|from)\s+may\b/.test(q) && !mm[2]) continue;
      if(mm[1]==="mar" && !/\b(in|for|during|of|from)\s+mar\b/.test(q) && !mm[2]) continue;
      const mi=MONTH_KEYS[mm[1]]; let y=mm[2]?Number(mm[2]):ty;
      if(!mm[2] && mi>tm) y = ty-1;           // "in December" asked in March means last December
      return monthPeriod(mi, y, true);
    }
    return monthPeriod(tm, ty, false);
  }

  function phraseOf(p, todayIso){
    const t = parseIso(todayIso);
    if(p.kind==="day"){
      if(p.from===todayIso) return "today"; if(p.from===addDays(todayIso,-1)) return "yesterday"; if(p.from===addDays(todayIso,1)) return "tomorrow";
      return "on "+fmtShort(p.from)+(p.from.slice(0,4)!==todayIso.slice(0,4) ? " "+p.from.slice(0,4) : "");
    }
    if(p.kind==="month"){
      if(p.mIdx===t.getMonth() && p.year===t.getFullYear()) return "this month";
      const prev = new Date(t.getFullYear(), t.getMonth()-1, 1);
      if(p.mIdx===prev.getMonth() && p.year===prev.getFullYear()) return "last month";
      return "in "+MONTH_NAMES[p.mIdx]+(p.year!==t.getFullYear() ? " "+p.year : "");
    }
    const base = String(p.label).replace(/\s*\(.*\)$/,"");
    return /^the last/.test(base) ? "over "+base : base;
  }
  function parsePeriod(raw, todayIso){ const p = parsePeriodCore(raw, todayIso); p.phrase = phraseOf(p, todayIso); return p; }

  /* ---------- metric aliases (built from the live Settings → metrics list, so custom KPIs work too) ---------- */
  const BUILTIN_ALIASES = {
    aht:["aht","handle time","handling time","average handle time","avg handle time","avg handling time","average handling time"],
    cq:["cq","call quality","call quality score","quality score"],
    pkt:["pkt","pkt score","product knowledge"],
    calls:["calls","call count","call volume","calls handled","calls taken","total calls","number of calls"]
  };
  function esc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }
  function metricAliases(m){
    const out = new Set((BUILTIN_ALIASES[m.field]||[]).map(a=>a.toLowerCase()));
    const base = String(m.name||"").toLowerCase().replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();
    if(base) out.add(base);
    if(m.field) out.add(String(m.field).toLowerCase());
    return Array.from(out).filter(a=>a.length>=2);
  }
  function findMetrics(qn, S, noAuditWords){
    const metrics = S.settings().metrics;
    // "sup calls" / "supervisor calls" are LEO, not the Total Calls KPI
    const text = " "+qn.replace(/\b(sup|supervisor|escalation|escalated)\s+calls?\b/g," ")+" ";
    const hits = [];
    metrics.forEach(m=>{
      let best = -1;
      metricAliases(m).forEach(a=>{
        const i = text.indexOf(" "+a+" "); const j = text.indexOf(" "+a+"s ");
        const idx = i>=0 ? i : j;
        if(idx>=0 && (best<0 || idx<best)) best = idx;
      });
      if(best<0 && noAuditWords && m.field==="cq" && /\bquality\b/.test(text)) best = text.indexOf(" quality ");
      if(best>=0) hits.push({m, at:best});
    });
    return hits.sort((a,b)=>a.at-b.at).map(h=>h.m);
  }

  const FILLER = new Set(['check','checking','checked','also','too','instead','then','again','same','one','ones','kindly','just','now','ok','okay','yes','yeah','sure','and','what','about','how','abt']);
  /* ---------- the parser ---------- */
  function parse(raw, S, mem){
    const text = String(raw||"").slice(0,500);
    // dynamic vocabulary: LOB words, metric words, leave types (TL/agent names are NAMES, not vocabulary)
    const dyn = new Set();
    S.settings().lobs.forEach(l=>normName(l).split(" ").forEach(w=>dyn.add(w)));
    S.settings().metrics.forEach(m=>metricAliases(m).forEach(a=>a.split(" ").forEach(w=>dyn.add(w))));
    S.settings().leaveTypes.forEach(l=>{ dyn.add(String(l.code||"").toLowerCase()); normName(l.name).split(" ").forEach(w=>dyn.add(w)); });
    S.settings().attendanceTypes.forEach(a=>normName(a).split(" ").forEach(w=>dyn.add(w)));
    // words used in the Knowledge Base / templates / updates THIS login can open are real words, never typos
    try{
      const addW = t => normName(String(t||"")).split(" ").forEach(w=>{ if(w.length>=4) dyn.add(w); });
      S.kb().forEach(a=>{ addW(a.title); (a.tags||[]).forEach(addW); addW(a.category); });
      S.docs().forEach(d=>{ addW(d.title); addW(d.subtitle); });
      S.updates().forEach(u=>addW(u.title));
    }catch(e){}
    // spelling / shorthand pass — towards words this login is allowed to see only
    const nameToks = new Set();
    S.people().forEach(p=>normName(p.name).split(" ").forEach(w=>{ if(w.length>=3) nameToks.add(w); }));
    S.settings().tls.forEach(t=>normName(t).split(" ").forEach(w=>{ if(w.length>=3) nameToks.add(w); }));
    const fixed = AllyLang.fix(norm(text), {known:new Set(Array.from(STATIC_VOCAB).concat(Array.from(dyn))), domain:dyn, names:nameToks});
    const qn = fixed.text;
    const tokens = qn.split(" ").filter(Boolean);
    const tokenSet = new Set(tokens);
    const c = {raw:text, norm:qn, tokens, tokenSet, corrections:fixed.corrections};
    const isVocab = w => STATIC_VOCAB.has(w) || dyn.has(w) || /^\d/.test(w);
    c.isVocab = isVocab;
    // A word that is normally vocabulary ("will", "grace", "may") still counts as a NAME when it directly follows
    // "of / for / about / vs / ..." — so "AHT of Will" is never silently answered as if nobody was named.
    const PREP = new Set(["of","for","about","is","does","did","has","have","was","with","vs","versus","and","compare","by","from","between"]);
    const afterPrep = t => tokens.some((x,i)=> x===t && i>0 && PREP.has(tokens[i-1]));
    const nameLike = t => !isVocab(t) || afterPrep(t);

    /* guard words */
    c.creds = /\b(password|passwords|passcode|pin code|security answer|security question|hash|credential|credentials|login details|username list|api key|token|secret)\b/.test(qn);
    c.override = /\b(ignore (all |the |your |previous |prior )*(instructions|rules)|override|bypass|jailbreak|pretend (i am|to be|you are)|act as (an? )?(admin|manager|tl|wfm)|i am (the |an? )?(admin|manager|tl|wfm|client|supervisor)|sudo|developer mode|as admin)\b/.test(qn);

    /* period */
    // typos / shorthand ("septembr", "tomorow", "tdy") are fixed before the date is read
    let ptxt = text.toLowerCase();
    fixed.corrections.forEach(x=>{ ptxt = ptxt.replace(new RegExp("\\b"+x.from.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b"), x.to); });
    c.period = parsePeriod(ptxt, S.today());
    if(!c.period.explicit){ const p2 = parsePeriod(qn, S.today()); if(p2.explicit) c.period = p2; }

    /* who is it about */
    c.selfRef = /\b(my|me|mine|myself|i|i am|am i)\b/.test(qn) || /\bhow (am|have) i\b/.test(qn);
    c.teamRef = /\b(team|teams|everyone|everybody|all agents|all of them|all the agents|agents|overall|whole|entire|department|floor|others|peers|colleagues?|teammates?|people|members?|employees|staff)\b/.test(qn);
    c.allMetrics = /\b(performance|kpis?|scorecard|report card|stats|statistics|metrics|how am i doing|how are we doing|how is \w+ doing|numbers|results|overall status|summary)\b/.test(qn);
    c.rank = null;
    let rm;
    if((rm = qn.match(/\b(top|best|highest|most|strongest)\b(?:\s+(\d{1,2}))?/))) c.rank = {word:rm[1], n:rm[2]?Number(rm[2]):null, dir: /^(top|best|strongest)$/.test(rm[1]) ? "best" : "high"};
    else if((rm = qn.match(/\b(bottom|worst|lowest|least|weakest)\b(?:\s+(\d{1,2}))?/))) c.rank = {word:rm[1], n:rm[2]?Number(rm[2]):null, dir: /^(bottom|worst|weakest)$/.test(rm[1]) ? "worst" : "low"};
    if(c.rank && !c.rank.n){ const nm = qn.match(/\b(?:top|bottom|best|worst|lowest|highest)\s+(\d{1,2})\b|\b(\d{1,2})\s+(?:best|worst|lowest|highest|top|bottom)\b/); if(nm) c.rank.n = Number(nm[1]||nm[2]); }
    c.exceptions = /\b(at risk|risk|below target|off target|missing target|missed target|not meeting|underperform\w*|under perform\w*|struggling|poor|failing|watch list|watchlist|need attention|needs attention|need coaching|needs coaching|red|yellow|amber)\b/.test(qn);
    c.compare = /\b(compare|versus|vs|difference between)\b/.test(qn);
    c.wantsTarget = /\b(target|targets|threshold|thresholds|goal|goals|benchmark)\b/.test(qn) && /\b(what|which|show|list|is|are|for)\b/.test(qn);

    /* metrics */
    const auditWord = /\b(audit|audits|audited|qa|zero tolerance|ztp|auditor|calibration)\b/.test(qn);
    c.metrics = S.canMetrics ? findMetrics(qn, S, !auditWord) : [];

    /* people / LOB / TL filters */
    const people = S.people();
    const qpad = " "+qn+" ";
    const strong=[], medium=[];
    people.forEach(p=>{
      const full = normName(p.name);
      if(full && qpad.includes(" "+full+" ")){ strong.push(p); return; }
      if(p.empId && qpad.includes(" "+String(p.empId).toLowerCase()+" ")){ strong.push(p); return; }
      const toks = full.split(" ").filter(t=>t.length>=3);
      if(toks.some(t=>tokenSet.has(t) && nameLike(t))) medium.push(p);
    });
    let matched = strong.length ? strong : medium;
    // light typo tolerance, only on words that are not vocabulary
    if(!matched.length){
      const unk = tokens.filter(t=>t.length>=4 && !isVocab(t));
      const fuzzy = [];
      people.forEach(p=>{
        const toks = normName(p.name).split(" ").filter(t=>t.length>=4);
        if(unk.some(u=>toks.some(t=>{ const d=lev(u,t); return d>0 && d <= (t.length>=9?2:1); }))) fuzzy.push(p);
      });
      matched = fuzzy;
    }
    // ambiguity: one typed first name that fits several people (and no full-name match)
    c.ambiguous = null;
    if(!strong.length && matched.length>1){
      const byTok = {};
      matched.forEach(p=>normName(p.name).split(" ").forEach(t=>{ if(tokenSet.has(t)) (byTok[t]=byTok[t]||[]).push(p); }));
      const hit = Object.values(byTok).find(list=>list.length>1);
      if(hit && !c.compare) c.ambiguous = hit.slice(0,6);
    }
    c.people = c.ambiguous ? [] : matched.slice(0,8);

    const qLob = " "+qn+" ";
    c.lob = (S.settings().lobs.find(l=>qLob.includes(" "+normName(l)+" ")) || "");
    c.tl = "";
    const tlHit = S.settings().tls.find(t=>qLob.includes(" "+normName(t)+" "));
    if(tlHit && (!c.people.length || /\b(team|tl|team leader|under|reporting|reportees)\b/.test(qn))){ c.tl = tlHit; c.people = c.people.filter(p=>normName(p.name)!==normName(tlHit)); }

    /* names that look like a person but match nobody this login can see */
    c.unknownPerson = "";
    if(!c.people.length && !c.ambiguous && !c.tl){
      const rawToks = text.split(/\s+/);
      const capital = [];
      rawToks.forEach((w,i)=>{ const cw=w.replace(/[^A-Za-z'\-]/g,""); if(i>0 && /^[A-Z][a-z]{2,}/.test(cw) && !isVocab(cw.toLowerCase())) capital.push(cw.toLowerCase()); });
      const prep = qn.match(/\b(?:of|for|about|from|by|is|does|did|has|have|was|with|against|vs|versus|and)\s+([a-z][a-z\-]{1,})(?:\s+([a-z][a-z\-]{2,}))?/g) || [];
      let cand = capital[0] || "";
      if(!cand){
        for(const hit of prep){
          const words = hit.split(" ").slice(1);
          if(words[0] && !isVocab(words[0])){ cand = words.filter(w=>!isVocab(w)).join(" "); break; }
        }
      }
      c.unknownPerson = cand;
    }
    /* for an Agent: does the question point at somebody else? (boolean probe — never reveals who) */
    c.otherPersonRef = S.refersToOthers(tokens.filter(nameLike)) || (S.reach==="self" && !!c.unknownPerson);

    c.pronoun = /\b(he|she|him|her|his|hers|they|them|their|theirs|that person|same person|same one|that agent)\b/.test(qn);
    c.pronounOther = c.pronoun && !c.selfRef;
    if(S.reach==="self" && c.pronounOther) c.otherPersonRef = true;
    const matchedToks = new Set(); c.people.forEach(p=>normName(p.name).split(" ").forEach(w=>matchedToks.add(w)));
    c.leftover = tokens.filter(t=>!isVocab(t) && !AllyLang.COMMON.has(t) && !FILLER.has(t) && !matchedToks.has(t) && !nameToks.has(t) && !(c.tl && normName(c.tl).split(" ").includes(t)));
    c.nameToks = nameToks;
    c.intent = classify(c, S);
    return c;
  }

  /* ---------- intent ---------- */
  function classify(c, S){
    const q = c.norm, n = c.tokens.length;
    const has = re => re.test(q);
    if(!n) return "empty";
    if(c.override) return "override";
    if(c.creds) return "creds";
    if(n<=6 && has(/\b(thanks|thank you|thx|ty|cheers|great|awesome|perfect)\b/)) return "thanks";
    if(n<=5 && has(/^(hi|hello|hey|hii|hiya|yo|good (morning|afternoon|evening)|namaste)\b/)) return "greet";
    if(n<=4 && has(/\b(bye|goodbye|see you|cya)\b/)) return "bye";
    if(has(/\b(what can you do|what can i ask|how can you help|capabilities|what do you do|help me|^help$|commands|what all can you)\b/) || q==="help" || q==="?") return "help";
    if(has(/\b(who am i|my role|my access|what can i see|what do i have access|what data (can|do)|which data|my permissions?|access level|why can not i see|why cannot i see)\b/)) return "whoami";
    if(has(/\b(audit log|activity log|change log|changelog|who changed|recent changes|admin actions)\b/)) return "auditlog";
    if((has(/^(go to|goto|take me to|navigate to|where is|where can i find|where do i find)\b/) || has(/^(open|show me|show) (the |my )?[a-z ]{2,30} (page|tab|section)$/) || has(/^open (the |my )?(dashboard|settings|roster|leave tracker|break schedule|daily data|daily summary|month history|knowledge base|process update|documentation|audit log)$/)) && navTarget(q, S)) return "nav";
    if(has(/\b(sup call|sup calls|supervisor call|supervisor calls|leo|callbacks?|call back|escalat\w*|sup queue)\b/)) return "leo";
    if(has(/\b(audit|audits|audited|qa|zero tolerance|ztp|calibration|rubric|auditor|coaching|missed parameters?|most missed)\b/)) return "audit";
    if(has(/\b(pkt|knowledge test|product knowledge|quiz)\b/) && has(/\b(pending|due|open|live|available|attempt\w*|taken|submit\w*|passed|pass rate|failed|result|results|not taken|yet to|have not|haven t|completed|take)\b/)) return "pkt";
    if(S.can.dailySummary && has(/\b(service level|sla|abandon\w*|occupancy|forecast|offered|fte|shrinkage|billable|daily summary)\b/)) return "dailysummary";
    if(has(/\b(process updates?|announcements?|what is new|whats new|latest updates?|recent updates?|news|circular|notices?)\b/) || q==="updates") return "updates";
    if(has(/\b(ipa|vendors?|disposition|dispositions|templates?|documentation|email template|copy paste)\b/)) return "docs";
    if(has(/\b(swap|swaps|swapped)\b/)) return "shift";
    if(has(/\b(shift|shifts|timing|timings|break|breaks|lunch|schedule|login time|logout time|working hours|start time|end time|what time)\b/)) return "shift";
    if(has(/\b(leave|leaves|absent|absence|attendance|holiday|half day|weekoff|week off|lwp|on leave|day off|days off|present days|sick|off today)\b/) || (has(/\bpresent\b/) && !has(/\bpresent score\b/))) return "leave";
    if(c.metrics.length || c.allMetrics || c.exceptions || c.rank || c.wantsTarget || c.compare || has(/\b(average|avg|status|doing|top performers?|best performers?)\b/)) return "metric";
    if(has(/\b(headcount|head count|team size|how many (agents|people|members|employees)|list (of )?(agents|team|members)|team members|my team|who is (my|the) (tl|team leader|manager|supervisor)|tl of|inactive|new joiners?|joined|joining date|roster)\b/)) return "roster";
    if(has(/\b(kb|knowledge base|article|articles|sop|procedure|policy|guideline|steps to|how do i|how to|how can i|what is the process|process for|what do i do)\b/)) return "kb";
    // nothing but names / a period / a LOB: a follow-up ("August?", "and Rahul?", "his leave") or just a name
    if(!c.leftover.length && n<=8 && (c.people.length || c.ambiguous || c.period.explicit || c.lob || c.tl || c.pronoun || c.corrections.length)) return "bare";
    return "search";
  }

  const NAV_TARGETS = [
    ["dashboard",/\b(dashboard|home)\b/],["processupdate",/\b(process update|process updates|updates|announcements?)\b/],["kb",/\b(knowledge base|kb)\b/],
    ["leo",/\b(leo|sup calls?|supervisor calls?)\b/],["qualityaudit",/\b(quality audit|audits?|qa)\b/],["pkt",/\bpkt\b/],
    ["engagementzone",/\b(engagement|engagement zone)\b/],["daily",/\b(daily data)\b/],["dailysummary",/\b(daily summary)\b/],
    ["breaks",/\b(break schedule|breaks?|shifts?)\b/],["roster",/\b(roster|team roster)\b/],["leave",/\b(leave tracker|leave)\b/],
    ["history",/\b(month history|history)\b/],["auditlog",/\b(audit log)\b/],["documentation",/\b(documentation|templates?)\b/],["settings",/\bsettings\b/],["ews",/\bews\b/]
  ];
  function navTarget(q, S){
    for(const [tab,re] of NAV_TARGETS){ if(re.test(q)) return tab; }
    return null;
  }

  return {parse, norm, normName, lev, parsePeriod, monthPeriod, phraseOf, navTarget, NAV_TARGETS, MONTH_NAMES, fmtDay, fmtShort, addDays, parseIso, isoOf, daysIn, pad};
})();
