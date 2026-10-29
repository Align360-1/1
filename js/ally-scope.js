/* =========================================================
   ALLY — permission layer  (js/ally-scope.js)
   ---------------------------------------------------------
   Ally is the in-app assistant (bottom-right chat bubble). It answers ONLY from Align360's own data —
   nothing is sent to the internet and no AI service is called.

   THIS FILE IS THE ONLY PLACE ALLY TOUCHES APP DATA.
   ally-nlu.js / ally-engine.js / ally-ui.js never read `state` or `currentUser` directly; they receive a
   frozen "scope" object from AllyScope.build() and can only see what it hands them. That makes the data
   rules reviewable in one file, and tests/ally-test.js checks the other files really do keep their hands off.

   THE RULE: Ally can never know more than the logged-in person's own tabs show them.
   It is built on the app's existing gates instead of re-listing roles, so the two cannot drift apart:
     - which pages a role has            -> computeVisibleTabs()            (app.js)
     - which people a role may see       -> scopedRoster()                  (auth.js: Agent=self, TL/SME=own team)
     - LEO calls                         -> scopedLeoCalls()                (leo.js)
     - quality audits                    -> qaVisibleAudits()               (qualityaudit.js)
     - KB articles / docs / updates      -> kbVisible(), agentVisibleDocEntries(), agentVisibleProcessUpdates()
   Where the app is looser than its own stated intent (see README-ally.md, "Things I found"), Ally takes the
   stricter reading.

   Never exposed, for anyone, whatever role: passwords / hashes / security answers / the user-account list,
   PKT questions and answer keys, roster "notes", silent QA corrections.
   ========================================================= */
const AllyScope = (function(){
  "use strict";

  const TEXT_CAP = 4000;

  /* ---------- small pure helpers ---------- */
  function plainText(md){
    return String(md||"")
      .replace(/!\[[^\]]*\]\([^)]*\)/g," ")          // images
      .replace(/<[^>]+>/g," ")                         // stray html
      .replace(/\[([^\]]+)\]\([^)]*\)/g,"$1")         // links -> label
      .replace(/^\s{0,3}#{1,6}\s*/gm,"")              // headings
      .replace(/^\s*>\s?/gm,"")                        // quotes
      .replace(/[*_`~]+/g,"")                          // emphasis / code
      .replace(/\s+/g," ").trim().slice(0,TEXT_CAP);
  }
  function nameTokens(a){ return String(a && a.name || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
  function pad(n){ return String(n).padStart(2,"0"); }
  function isoOf(d){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }

  /* ---------- how far into other people's data this login reaches ----------
     self : an Agent — only their own record
     team : TL (without Full data access) and SME — their own team
     org  : everyone-in-the-org, read at the same depth the Dashboard allows (WFM, Admin, Manager,
            full-access TL, Trainer, Client)
     none : Quality — their dashboard is their own audits; no agent KPIs/roster at all                     */
  function reachOf(){
    if(isAgent()) return "self";
    if(isQuality()) return "none";
    if(isSME()) return "team";
    if(isTL()) return currentUser.viewAll ? "org" : "team";
    return "org";
  }

  /* ---------- safe projections (whitelists — a new field in the app is NOT exposed until added here) ---------- */
  function projPerson(a, detail){
    const p = {empId:a.empId, name:a.name||a.empId, tlName:a.tlName||"", lob:a.lob||"", lobs:agentLobList(a), status:a.status||"Active"};
    if(detail){
      p.joiningDate = a.joiningDate||""; p.inactiveSince = a.inactiveSince||"";
      p.shift = {start:a.shiftStart||"", end:a.shiftEnd||""};
      p.break1 = {start:a.break1Start||"", end:a.break1End||""};
      p.break2 = {start:a.break2Start||"", end:a.break2End||""};
      p.lunch  = {start:a.lunchStart||"",  end:a.lunchEnd||""};
    }
    return p;
  }
  function projAudit(a){
    const params = {};
    Object.keys(a.params||{}).forEach(n=>{ const x=a.params[n]||{}; params[n] = {tag:x.tag||"", error:x.error||""}; });
    return {id:a.id, agentEmpId:a.agentEmpId, agentName:a.agentName||"", supervisor:a.supervisor||"", callId:a.callId||"",
      callReason:a.callReason||"", auditDate:a.auditDate||"", auditorName:a.auditorName||"", ztp:a.ztp||"",
      ztpError:a.ztpError||"", score:Number(a.score)||0, totalPoints:a.totalPoints, achievedPoints:a.achievedPoints,
      lob:a.lob||"", params};
  }
  function projLeo(c){
    return {id:c.id, reason:c.reason||"", refNumber:c.refNumber||"", claimNumber:c.claimNumber||"", callbackAt:c.callbackAt||"",
      lob:c.lob||"", status:c.status||"open", supStatus:c.supStatus||"new", createdByName:c.createdByName||"",
      createdByEmpId:c.createdByEmpId||"", createdAt:c.createdAt||"", assignedTo:c.assignedTo||"",
      assignedToUsername:c.assignedToUsername||"", resolvedAt:c.resolvedAt||"", action:c.action||""};
  }
  function projKb(a){
    return {id:a.id, title:a.title||"", lob:a.lob||"", category:a.category||"", summary:plainText(a.summary).slice(0,600),
      body:plainText(a.body), tags:(a.tags||[]).map(String), updatedAt:a.updatedAt||a.createdAt||"", reviewedAt:a.reviewedAt||""};
  }
  function projDoc(e){
    return {id:e.id, title:e.title||"", subtitle:e.subtitle||"", lob:e.lob||"", isEmail:!!e.isEmail,
      bodyText:plainText(e.bodyText||e.body).slice(0,1500), postedAt:e.postedAt||""};
  }
  function projUpdate(u){
    return {id:u.id, title:u.title||"", message:plainText(u.message), lob:u.lob||"", postedBy:u.postedBy||"",
      postedAt:u.postedAt||"", pinned:!!u.pinned};
  }

  /* ---------- the scope object ---------- */
  function build(){
    if(typeof currentUser === "undefined" || !currentUser) return null;
    const u = currentUser;
    const reach = reachOf();
    const tabs = new Set(computeVisibleTabs().map(t=>t.id));
    const me = isAgent() ? (state.roster.find(a=>a.empId===u.empId) || null) : null;

    /* people this login may see at all (KPI level) */
    function rawPeople(){
      if(reach==="none") return [];
      if(reach==="self") return me ? [me] : [];
      return scopedRoster();                       // team (TL/SME), or everyone
    }
    // Roster-level detail (shifts, breaks, join dates): the Roster/Breaks tabs, plus an agent's own record.
    const detailAllowed = reach==="self" || tabs.has("roster") || tabs.has("breaks");
    const peopleList = rawPeople().map(a=>projPerson(a, detailAllowed));
    const peopleIds = new Set(peopleList.map(p=>p.empId));
    const peopleNames = new Set(peopleList.map(p=>p.name));

    const canMetrics = reach!=="none" && tabs.has("dashboard");

    /* settings the person can already see on their own pages (targets are on every KPI card) */
    function settingsView(){
      const s = state.settings || {};
      const tlSet = new Set();
      if(reach==="org") { (s.tls||[]).forEach(t=>t&&tlSet.add(t)); state.roster.forEach(a=>a.tlName&&tlSet.add(a.tlName)); }
      else peopleList.forEach(p=>p.tlName&&tlSet.add(p.tlName));
      return {
        teamName: s.teamName||"",
        metrics: (s.metrics||[]).map(m=>({name:m.name, field:m.field, unit:m.unit||"", target:m.target, threshold:m.threshold,
                   direction:m.direction, inputType:m.inputType||"number"})),
        leaveTypes: (s.leaveTypes||[]).map(l=>({code:l.code, name:l.name})),
        attendanceTypes: (s.attendanceTypes||[]).map(a=>a.label),
        lobs: ((s.dailySummary&&s.dailySummary.lobs)||LOB_OPTIONS||[]).slice(),
        tls: Array.from(tlSet),
        dsParams: ((s.dailySummary&&s.dailySummary.params)||[]).map(p=>({id:p.id, name:p.name, field:p.field, unit:p.unit||"",
                   direction:p.direction, target:p.target, threshold:p.threshold})),
        leoReasons: (s.leoReasons||[]).slice()
      };
    }

    /* make sure daily data for every month in a range is in memory (Firestore mode loads months lazily) */
    async function ensureMonths(fromIso, toIso){
      if(typeof fbReady==="undefined" || !fbReady || typeof fbDb==="undefined" || !fbDb) return;
      let [y,m] = fromIso.split("-").map(Number); const [ty,tm] = toIso.split("-").map(Number);
      for(let guard=0; (y<ty || (y===ty && m<=tm)) && guard<24; guard++){
        const key = fbMonthKey(y, m-1);
        if(!__loadedMonthKeys.has(key)){
          try{ const snap = await fbDb.collection("trackerDaily").where("month","==",key).get(); mergeMonthDailyDocs(key, snap.docs); }
          catch(e){ /* offline / blocked: answer from whatever is cached */ }
        }
        m++; if(m>12){ m=1; y++; }
      }
    }
    /* daily rows for the people in scope between two ISO dates (inclusive) — same rows the Dashboard is built from */
    async function rows(fromIso, toIso){
      if(!canMetrics) return [];
      await ensureMonths(fromIso, toIso);
      const out = [];
      let [y,m] = fromIso.split("-").map(Number); const [ty,tm] = toIso.split("-").map(Number);
      for(let guard=0; (y<ty || (y===ty && m<=tm)) && guard<24; guard++){
        monthDailyRows(m-1, y, "all").forEach(r=>{
          if(r.iso>=fromIso && r.iso<=toIso && peopleIds.has(r.empId)) out.push(r);
        });
        m++; if(m>12){ m=1; y++; }
      }
      return out;
    }

    /* month-history snapshots, restricted to the people in scope (stricter than the History tab for TLs) */
    function history(){
      if(!tabs.has("history")) return [];
      return (state.history||[]).map(h=>({month:h.month, year:h.year, savedAt:h.savedAt,
        metrics:(h.metricsSnapshot||[]).map(m=>({name:m.name, field:m.field, unit:m.unit||""})),
        rows:(h.rows||[]).filter(r=>peopleNames.has(r.agent)).map(r=>Object.assign({}, r))}));
    }

    function audits(){
      if(!canViewQualityAudit()) return [];
      return qaVisibleAudits().map(projAudit);
    }
    function qaParams(){
      if(!canViewQualityAudit() || typeof QA_PARAMS==="undefined") return [];
      return QA_PARAMS.map(p=>({n:p.n, cat:p.cat, name:p.name, pts:p.pts}));
    }

    /* PKT: titles / status / scores only — never questions or answer keys */
    function pkts(){
      if(!canViewPKT()) return {list:[], attempts:[]};
      const mineLobs = me ? agentLobList(me) : [];
      let list = (state.pkts||[]).filter(p=>{
        if(reach==="self") return (p.status==="live"||p.status==="closed") && (!p.lob || mineLobs.includes(p.lob));
        return p.status!=="draft" || canAuthorPKT();
      });
      const ids = new Set(list.map(p=>p.id));
      const audienceIds = isQuality() ? new Set(state.roster.map(a=>a.empId)) : peopleIds;
      const attempts = (state.pktAttempts||[]).filter(a=> ids.has(a.pktId) && audienceIds.has(a.empId));
      const audience = (isQuality() ? state.roster : rawPeople()).filter(a=>a.status==="Active").map(a=>projPerson(a,false));
      return {
        list: list.map(p=>({id:p.id, title:p.title||"", lob:p.lob||"", status:p.status, dueDate:p.dueDate||"", passMark:p.passMark,
                durationMins:p.durationMins, open:pktIsOpen(p), publishedAt:p.publishedAt||p.createdAt||"", questionCount:(p.questions||[]).length})),
        attempts: attempts.map(a=>({pktId:a.pktId, empId:a.empId, agentName:a.agentName||"", tlName:a.tlName||"", lob:a.lob||"",
                status:a.status, score:a.score, correct:a.correct, total:a.total, passed:a.passed, submittedAt:a.submittedAt||"", timeTakenSec:a.timeTakenSec})),
        audience
      };
    }

    function leoCalls(){
      if(!canViewLEO()) return [];
      return scopedLeoCalls(state.leoCalls||[]).map(projLeo);
    }
    function kb(){
      if(!canViewKB()) return [];
      return (state.kbArticles||[]).filter(kbVisible).map(projKb);
    }
    function docs(){
      if(!canViewDocumentation()) return [];
      const list = isAgent() ? agentVisibleDocEntries() : (state.documentationTemplates||[]).filter(e=>!e.archived);
      return list.map(projDoc);
    }
    function updates(){
      if(!canViewProcessUpdates()) return [];
      return agentVisibleProcessUpdates((state.processUpdates||[]).filter(x=>!x.archived)).map(projUpdate);
    }
    function ipaDirectory(){          // lives under Documentation → Settings: only whoever can manage documentation
      if(!canManageDocumentation()) return [];
      return (state.ipaDirectory||[]).map(i=>({name:i.name||"", code:i.code||"", phone:i.phone||"", address:i.address||""}));
    }
    function dailySummary(){
      if(!tabs.has("dailysummary")) return [];
      return (state.dailySummaryData||[]).map(r=>({date:r.date, lob:r.lob, values:Object.assign({}, r.values||{})}));
    }
    function swaps(){
      if(!tabs.has("breaks")) return [];
      let list = (state.shiftSwaps||[]).slice();
      if(reach==="self") list = list.filter(s=>s.requesterEmpId===u.empId || s.recipientEmpId===u.empId);
      else if(reach==="team") list = list.filter(s=>peopleIds.has(s.requesterEmpId) || peopleIds.has(s.recipientEmpId));
      const nm = id => { const a = state.roster.find(x=>x.empId===id); return a ? a.name : id; };
      return list.map(s=>({id:s.id, requester:nm(s.requesterEmpId), recipient:nm(s.recipientEmpId), date:s.date, status:s.status, byWFM:!!s.byWFM}));
    }
    function auditLog(){
      if(!isFullAdmin()) return [];
      return (state.auditLog||[]).map(e=>({at:e.at, actorName:e.actorName||"", actorRole:e.actorRole||"", action:e.action||"", summary:e.summary||""}));
    }

    /* Boolean-only probe, used so an Agent asking about a colleague gets the same refusal whether or not that colleague
       exists. Returns whether any token is another person's name / ID — never WHICH person. */
    function refersToOthers(tokens){
      if(reach!=="self") return false;
      const mine = new Set(me ? nameTokens(me) : []);
      const others = new Set();
      state.roster.forEach(a=>{
        if(me && a.empId===me.empId) return;
        nameTokens(a).forEach(t=>{ if(t.length>=3 && !mine.has(t)) others.add(t); });
        if(a.empId) others.add(String(a.empId).toLowerCase());
      });
      return tokens.some(t=>others.has(t));
    }

    /* The only actions Ally may perform in the app: navigate to a page this login already has, or open a KB article it can see. */
    const actions = {
      nav(tab){
        if(!tabs.has(tab)) return false;
        currentTab = tab; render(); return true;
      },
      openArticle(id){
        if(!canViewKB()) return false;
        const a = (state.kbArticles||[]).find(x=>x.id===id);
        if(!a || !kbVisible(a)) return false;
        kbOpenId = id; kbView = "list"; kbSubTab = "browse"; currentTab = "kb"; render(); return true;
      }
    };

    const roleLabel = currentRoleLabel();
    const scopeLabel =
      reach==="self" ? "Your own data only" :
      reach==="none" ? "Your own audits" :
      reach==="team" ? ((u.tlName ? u.tlName+"'s team" : "Your team")) :
      isClient() ? "Client view" :
      isTrainer() ? "All teams · read-only" : "All teams";

    return Object.freeze({
      role:u.role, roleLabel, scopeLabel, reach, userName:u.name||"", username:u.username||"", empId:u.empId||"", tlName:u.tlName||"",
      identityKey: u.role+"|"+(u.empId||u.username||u.name||""),
      tabs, canMetrics,
      isAgent:isAgent(), isTL:isTL(), isSME:isSME(), isClient:isClient(), isTrainer:isTrainer(), isQuality:isQuality(), isAdmin:isAdmin(), isFullAdmin:isFullAdmin(), isWFM:isWFM(),
      can: Object.freeze({
        viewOthers: (reach==="team"||reach==="org") && canMetrics,
        roster: tabs.has("roster"), shifts: tabs.has("breaks"), leave: tabs.has("leave") || tabs.has("dashboard"),
        dailySummary: tabs.has("dailysummary"), history: tabs.has("history"), auditLog: isFullAdmin(),
        leo: canViewLEO(), kb: canViewKB(), docs: canViewDocumentation(), updates: canViewProcessUpdates(),
        qa: canViewQualityAudit(), pkt: canViewPKT(), manageDocs: canManageDocumentation()
      }),
      today: ()=>isoOf(new Date()),
      people: ()=>peopleList.slice(),
      me: ()=> me ? projPerson(me, true) : null,
      settings: settingsView, rows, history, audits, qaParams, pkts, leoCalls, kb, docs, updates, ipaDirectory, dailySummary, swaps, auditLog,
      refersToOthers, actions
    });
  }

  /* cheap probe for the widget: who is logged in right now (no scope is built) */
  function identity(){
    if(typeof currentUser === "undefined" || !currentUser) return null;
    return currentUser.role+"|"+(currentUser.empId||currentUser.username||currentUser.name||"");
  }

  return {build, identity};
})();
