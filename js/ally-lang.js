/* =========================================================
   ALLY — everyday-language layer  (js/ally-lang.js)
   ---------------------------------------------------------
   People type fast: "who is on lave today", "wat is my aht", "pndng pkt", "augst". This file cleans a question up BEFORE
   Ally tries to understand it:
     - chat shorthand  (u, ur, pls, wat, tdy, tmrw, lv, abt, ...)           -> normal words
     - number words    ("top five")                                          -> digits
     - spelling        a word Ally does not know is matched to the closest word it DOES know
   The "words it knows" are Align360 vocabulary + the names/LOBs/leave types that THIS login is allowed to see (supplied by the
   caller from the scope object). So a typo can only ever be corrected towards something the person may already see — an Agent's
   typo is never "fixed" into a colleague's name.
   Every correction is returned so Ally can say "I read that as …" instead of silently guessing.
   ========================================================= */
const AllyLang = (function(){
  "use strict";

  /* ordinary English that must never be "corrected" into a domain word */
  const COMMON = new Set((
    "a about above across actually after again against all almost also always am an and another any anyone anything are around as ask asked at away back be because been before being below best better between big both but by call called came can cannot could day did do does doing done down during each either else end enough even ever every everyone everything few find first for found from get gets getting give given go goes going gone good got great had has have having he help her here hers him his how however i if in into is it its just keep kind know known last later least less let like little long look looking lot made make makes many may maybe me might more most much must my myself need needed never new next no none nor not nothing now of off often oh ok okay on once one only onto or other others our ours out over own part past people per please put quite rather really right said same say see seems set she should show shown since so some someone something soon still such sure take taken tell than thank thanks that the their theirs them then there these they thing things think this those though three through till time to today together too took toward try two under until up upon us use used using usually very want wanted was way we well went were what whatever when where whether which while who whole whom whose why will with within without would yes yet you your yours " +
    "again agent agents already answer anyway apply area asking available aware away based basic bit boss business button buy case change changes check chat choose clear close come comes company complete completed continue correct course current currently daily date deal decide detail details different directly display does doesnt dont double else email enter entire exactly example fast fine fix follow following form forward full further gave general giving goal hard hello hey hi high hold hope hour hours idea important include information instead issue item items kindly later lead left let level line list little live located lost main manage mean meant member members message might mind minute minutes missing month months name names near nearly nice night note notice number numbers offer office open option order original page pass pay place plan plus point possible pretty previous probably problem process provide question questions quick quickly read ready reason receive recent record regarding remember repeat report request require rest result results return review roll room run saw second seconds section seen send sent separate series service several share short side simple simply single small sort sound space speak special specific start started state stay step stop story strong study stuff sub subject sum support tab talk team teams tomorrow top total touch track tried true turn type understand unless update upon useful usual value various version view wait walk week weeks whats whos wonder word words work worked working works worth wrong year years yesterday young"
  ).split(/\s+/));

  /* words worth correcting TO (Align360 vocabulary) */
  const DOMAIN = new Set((
    "leave leaves attendance absent absence present holiday weekoff shift shifts timing timings break breaks lunch schedule swap swaps roster headcount inactive active joined joining " +
    "audit audits audited quality score scores average target targets threshold performance metrics metric status pending overdue supervisor supervisors escalation escalated callback callbacks " +
    "knowledge article articles template templates documentation disposition dispositions process updates update latest recent announcement announcements service level abandoned occupancy forecast shrinkage handled offered billable " +
    "yesterday today tomorrow week month months weekly monthly daily compare comparison ranking top bottom best worst highest lowest risk below above team agent agents manager trainer client dashboard settings " +
    "january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday " +
    "aht pkt call calls handle handling quality tolerance zero parameter parameters error errors category reason reasons assigned completed resolved cancelled " +
    "calendar sick half days " +
    "who whom which what when where how many much show tell list give open check find search summary details breakdown trend " +
    "performing performer performers coaching result results submitted attempt attempts passed failed percentage"
  ).split(/\s+/));

  /* chat shorthand -> words (applied to whole tokens) */
  const SLANG = {
    u:"you", ur:"your", r:"are", pls:"please", plz:"please", plss:"please", thx:"thanks", ty:"thanks", wat:"what", wht:"what", wats:"what is", whats:"what is", whos:"who is",
    hw:"how", abt:"about", tdy:"today", tday:"today", todya:"today", tmrw:"tomorrow", tmr:"tomorrow", tomorow:"tomorrow", yday:"yesterday", yest:"yesterday", ystrday:"yesterday",
    lv:"leave", lvs:"leaves", lve:"leave", mnth:"month", mth:"month", wk:"week", wks:"weeks", avg:"average", agt:"agent", agnt:"agent", agnts:"agents", qlty:"quality",
    perf:"performance", perfomance:"performance", preformance:"performance", prefomance:"performance", ops:"operations", wrt:"about", info:"information", msg:"message",
    nd:"and", n:"and", "&":"and", tl:"tl", dis:"this", dat:"that", wen:"when", whn:"when", hv:"have", hav:"have", cn:"can", cud:"could", shud:"should", wud:"would",
    nxt:"next", prev:"previous", lst:"last", ths:"this", thsi:"this", mnths:"months", hrs:"hours", mins:"minutes", sec:"seconds", pkts:"pkt", sups:"sup", dept:"department",
    brk:"break", brks:"breaks", shw:"show", sho:"show", tel:"tell", lnch:"lunch", shft:"shift", shfts:"shifts", attn:"attendance", lst:"last", lemme:"let me", gimme:"give me", wanna:"want to", gonna:"going to", kindly:"please", plzz:"please", abhi:"now", haan:"yes", han:"yes", nahi:"no", nahin:"no"
  };

  const NUMBER_WORDS = {two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twelve:12,fifteen:15,twenty:20};

  /* Damerau–Levenshtein (adjacent swaps count as one slip: "lvae" -> "leave" is close) */
  function dist(a, b, max){
    if(a===b) return 0;
    const m=a.length, n=b.length;
    if(Math.abs(m-n)>max) return max+1;
    let prev2=null, prev=Array.from({length:n+1},(_,j)=>j);
    for(let i=1;i<=m;i++){
      const cur=[i]; let rowMin=cur[0];
      for(let j=1;j<=n;j++){
        const cost = a[i-1]===b[j-1] ? 0 : 1;
        let v = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost);
        if(prev2 && i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) v = Math.min(v, prev2[j-2]+1);
        cur[j]=v; if(v<rowMin) rowMin=v;
      }
      if(rowMin>max) return max+1;
      prev2=prev; prev=cur;
    }
    return prev[n];
  }

  /* best known word for an unknown token, or null. `pool` is an array of words it may be corrected to. */
  function nearest(tok, pool){
    const len = tok.length;
    const max = len<=3 ? 0 : len<=6 ? 1 : 2;
    if(!max) return null;
    let best=null, bestD=99, tie=false;
    for(const w of pool){
      if(Math.abs(w.length-len)>max) continue;
      const d = dist(tok, w, max);
      if(d>max) continue;
      // typos rarely change the first letter: allow it only for a single slip
      if(w[0]!==tok[0] && d>1) continue;
      if(d<bestD){ best=w; bestD=d; tie=false; }
      else if(d===bestD && w!==best){ tie = true; if(w[0]===tok[0] && best[0]!==tok[0]) { best=w; tie=false; } }
    }
    return (best && !tie) ? best : null;
  }
  const skel = w => w.replace(/[aeiouy]/g,"").replace(/(.)\1+/g,"$1");
  /* vowel-dropped typing ("pndng", "attndnce"): accept only when exactly one known word has that consonant skeleton */
  function bySkeleton(tok, pool){
    if(tok.length<4) return null;
    const k = skel(tok); if(k.length<3) return null;
    const hits = pool.filter(w=>w.length>=5 && skel(w)===k);
    return hits.length===1 ? hits[0] : null;
  }
  /* up to n close candidates (for "did you mean …?") — looser than nearest() */
  function suggestions(tok, pool, n){
    const max = Math.max(1, Math.min(3, Math.floor(tok.length/3)));
    const out = [];
    pool.forEach(w=>{
      const d = dist(tok, w, max);
      const pre = tok.length>=3 && (w.startsWith(tok) || tok.startsWith(w.slice(0,Math.min(4,w.length))));
      if(d<=max || pre) out.push({w, d: pre?Math.min(d,1):d});
    });
    out.sort((a,b)=>a.d-b.d);
    return Array.from(new Set(out.map(x=>x.w))).slice(0, n||3);
  }

  /*  fix(text, ctx)   text: already lower-cased & punctuation-stripped (AllyNLU.norm)
      ctx = {known:Set(words that are fine as they are), domain:Set|Array(words to correct towards), names:Set|Array(person/TL name tokens)}  */
  function fix(text, ctx){
    ctx = ctx || {};
    const known = ctx.known || new Set();
    const names = Array.from(ctx.names || []);
    const pool = Array.from(new Set(Array.from(DOMAIN).concat(Array.from(ctx.domain||[]))));
    const nameSet = new Set(names);
    const namePool = names.filter(n=>n.length>=4);
    const corrections = [];
    const out = [];
    text.split(" ").filter(Boolean).forEach((tok, i, arr)=>{
      if(SLANG[tok]!==undefined){ out.push(SLANG[tok]); return; }
      if(NUMBER_WORDS[tok]!==undefined && /^(top|bottom|best|worst|lowest|highest|last|past|previous|next)$/.test(arr[i-1]||"") ){ out.push(String(NUMBER_WORDS[tok])); return; }
      if(/[0-9%\/:\-]/.test(tok) || tok.length<4){ out.push(tok); return; }
      if(COMMON.has(tok) || DOMAIN.has(tok) || known.has(tok) || nameSet.has(tok)){ out.push(tok); return; }
      // after "of / for / about / vs" an unknown word is most likely a NAME: try names first
      const afterPrep = /^(of|for|about|vs|versus|and|with|from|by|is|does|did|has|have|compare)$/.test(arr[i-1]||"");
      let hit = afterPrep ? nearest(tok, namePool) : null;
      if(!hit) hit = nearest(tok, pool);
      if(!hit && !afterPrep) hit = nearest(tok, namePool);
      if(!hit) hit = bySkeleton(tok, pool);
      if(hit){ corrections.push({from:tok, to:hit}); out.push(hit); } else out.push(tok);
    });
    return {text: out.join(" "), corrections};
  }

  return {fix, nearest, suggestions, dist, COMMON, DOMAIN};
})();
