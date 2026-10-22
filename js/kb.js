/* =========================================================
   KNOWLEDGE BASE — "I have a doubt on a call, where's the answer?"
   ---------------------------------------------------------
   Design principles (agents are mid-call, so speed beats everything):
     1. Search first. One big box, ranked results, typo-tolerant, keywords/aliases (tags) count.
     2. Answer first. Every article opens with a short "Quick answer", then the full detail.
     3. Scoped to the agent's LOB (+ "General" articles for all LOBs) — no wading through other LOBs.
     4. Trust cues: who updated it, when it was last reviewed, "may be outdated" warning.
     5. Closed loop: 👍/👎 on every article, and "can't find it? ask for it" — Trainers/TLs/Quality get a
        queue of what's missing or unclear, so the KB gets better from real doubts.
   Who: agents/TL/SME/Trainer/Quality/Admin read. Trainer, TL, SME, Quality, Admin write.
   Client and plain WFM don't see the tab.

   Data (real time, one Firestore doc each, newer-wins merge like PKT):
     state.kbArticles -> trackerKb         {id,title,lob("" = General/all LOBs),category,summary,body,tags[],
                                            images[{id,data,caption}],status:"draft"|"published"|"archived",pinned,
                                            createdBy,createdByUsername,createdAt,updatedAt,updatedBy,version,
                                            changeNote,reviewedAt,
                                            source?:{file,importedAt,hash}  <- only on articles made by "Import from document" (js/kb-ai.js, kb-import.js)}
     state.kbFeedback -> trackerKbFeedback {id,type:"vote"|"request",articleId,articleTitle,value(1|-1),comment,text,
                                            userKey,name,role,lob,status:"open"|"done",resolvedArticleId,createdAt,updatedAt}
     state.kbDocs (see js/kb-docs.js)   -> SAME collection trackerKb, told apart by `kind`:
                                          {kind:"document", id,title,lob,file,status,parts,version,…}  the complete uploaded SOP
                                          {kind:"docpart",  id,docId,idx,body,images[],updatedAt}      its text + screenshots, split so each Firestore doc stays < 1 MB
   Per-person favourites / recently viewed live in this browser's localStorage (never shared).
   ========================================================= */

const KB_DOC_LIMIT = 900 * 1024;
const KB_STALE_DAYS = 120;      // agents see a "may be outdated" cue past this
const KB_REVIEW_DAYS = 90;      // staff see "review due" past this

let kbSubTab = "browse";        // "browse" | "manage" | "feedback"  (staff)
let kbView = "list";            // "list" | "editor" | "import"
let kbQuery = "";
let kbCat = null;               // category being browsed
let kbLobFilter = "all";        // staff browse filter: "all" | "" (General) | LOB
let kbOpenId = null;            // article open in the reader
let kbOpenDocId = null;         // full document open in the document reader (js/kb-docs.js)
let kbJump = {anchor:"", find:""};   // where to land after opening an article / document: a heading key, or text to highlight

/* ---------------- helpers ---------------- */
function kbNewId(p){ return p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function kbUserKey(){ return (typeof userViewKey==="function" && userViewKey()) || "anon"; }
function kbMyAgent(){ return isAgent() ? state.roster.find(a=>a.empId===currentUser.empId) : null; }
function kbById(id){ return (state.kbArticles||[]).find(a=>a.id===id); }
function kbDaysSince(d){ if(!d) return null; const t = Date.parse(d); return isNaN(t) ? null : Math.floor((Date.now()-t)/864e5); }
function kbVisible(a){
  if(a.status!=="published") return false;
  if(isAgent()){ const me = kbMyAgent(); return !a.lob || a.lob === ((me && me.lob) || ""); }
  return true;
}
function kbScopeList(){
  let list = (state.kbArticles||[]).filter(kbVisible);
  if(!isAgent() && kbLobFilter!=="all") list = list.filter(a=>(a.lob||"")===kbLobFilter);
  return list;
}
function kbLobBadge(a){ return a.lob ? `<span class="badge badge-gray">${esc(a.lob)}</span>` : `<span class="badge badge-gray">General</span>`; }
function kbLoadList(kind){ try{ const v = JSON.parse(localStorage.getItem("a360_kb_"+kind+"_"+kbUserKey())||"[]"); return Array.isArray(v) ? v : []; }catch(e){ return []; } }
function kbSaveList(kind, arr){ try{ localStorage.setItem("a360_kb_"+kind+"_"+kbUserKey(), JSON.stringify(arr)); }catch(e){} }
function kbIsFav(id){ return kbLoadList("fav").includes(id); }
function kbToggleFav(id){ const l = kbLoadList("fav"); const i = l.indexOf(id); if(i>=0) l.splice(i,1); else l.unshift(id); kbSaveList("fav", l); }
function kbPushRecent(id){ kbSaveList("recent", [id].concat(kbLoadList("recent").filter(x=>x!==id)).slice(0,8)); }
function kbOpenCount(){ // staff badge: open feedback waiting for a decision (searches with no result count once per question)
  const open = (state.kbFeedback||[]).filter(f=>f.status==="open");
  return open.filter(f=>f.type==="request" || (f.type==="vote" && f.value<0)).length + new Set(open.filter(f=>f.type==="miss").map(f=>f.norm)).size;
}

/* ---------------- tiny markdown ----------------
   Supported: # ## ### headings · - bullets · 1. numbers · > note · >! warning · >+ tip · --- rule ·
   | tables | · ![1] attached image · **bold** *italic* · `copyable code` · [text](https://…) ·
   [[Other article title]] internal link. Everything is HTML-escaped first, so nothing typed can inject markup. */
function kbInline(escaped, byTitle){
  const stash = [];
  let s = escaped.replace(/`([^`]+)`/g, (m,c)=>{ stash.push(`<code class="kb-copy" data-copy="${c}" title="Click to copy">${c}</code>`); return "\u0000"+(stash.length-1)+"\u0000"; });
  s = s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
       .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
       .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
       .replace(/\[\[(.+?)\]\]/g, (m,t)=>{ const a = byTitle[t.trim().toLowerCase()]; return a ? `<a href="#" class="kb-ilink" data-kbopen="${esc(a.id)}">${t}</a>` : `<span class="kb-broken" title="No article with this title">${t}</span>`; });
  return s.replace(/\u0000(\d+)\u0000/g, (m,i)=>stash[Number(i)]);
}
function kbMd(src, art){
  const byTitle = {};
  (state.kbArticles||[]).forEach(a=>{ byTitle[esc(a.title||"").toLowerCase()] = a; });
  const inl = t => kbInline(esc(t), byTitle);
  const lines = String(src||"").replace(/\r/g,"").split("\n");
  const out = []; let i = 0, m;
  const isBlock = l => /^(#{1,3})\s/.test(l) || /^---+\s*$/.test(l) || /^>/.test(l) || /^\s*[-*]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l) || /^\s*\|/.test(l) || /^!\[\d+\]/.test(l);
  while(i < lines.length){
    const ln = lines[i];
    if(!ln.trim()){ i++; continue; }
    if((m = ln.match(/^(#{1,3})\s+(.*)$/))){ const n = m[1].length+2; out.push(`<h${n} class="kb-h" data-kbh="${esc(kbHKey(m[2]))}">${inl(m[2])}</h${n}>`); i++; continue; }
    if(/^---+\s*$/.test(ln)){ out.push("<hr>"); i++; continue; }
    if((m = ln.match(/^>([!+]?)\s?(.*)$/))){
      const kind = m[1]==="!" ? "warn" : m[1]==="+" ? "tip" : "note", rows = [];
      while(i<lines.length && (m = lines[i].match(/^>([!+]?)\s?(.*)$/)) && (m[1]==="!"?"warn":m[1]==="+"?"tip":"note")===kind){ rows.push(inl(m[2])); i++; }
      out.push(`<div class="kb-callout ${kind}"><span class="kb-callout-ic">${kind==="warn"?"⚠️":kind==="tip"?"💡":"ℹ️"}</span><div>${rows.join("<br>")}</div></div>`); continue;
    }
    if(/^\s*[-*]\s+/.test(ln)){ const it = []; while(i<lines.length && /^\s*[-*]\s+/.test(lines[i])){ it.push(`<li>${inl(lines[i].replace(/^\s*[-*]\s+/,""))}</li>`); i++; } out.push(`<ul class="kb-list">${it.join("")}</ul>`); continue; }
    if(/^\s*\d+[.)]\s+/.test(ln)){ const it = [], start = parseInt(ln.match(/^\s*(\d+)/)[1], 10); while(i<lines.length && /^\s*\d+[.)]\s+/.test(lines[i])){ it.push(`<li>${inl(lines[i].replace(/^\s*\d+[.)]\s+/,""))}</li>`); i++; } out.push(`<ol class="kb-list"${start>1 && start<1000 ? ` start="${start}"` : ""}>${it.join("")}</ol>`); continue; }   // start="n": a list resumed after a note/sub-bullets keeps its numbering
    if(/^\s*\|/.test(ln)){
      const rows = []; while(i<lines.length && /^\s*\|/.test(lines[i])){ rows.push(lines[i].trim().replace(/^\||\|$/g,"").split("|").map(c=>c.trim())); i++; }
      const hasHead = rows.length>1 && rows[1].every(c=>/^:?-{2,}:?$/.test(c));
      const body = rows.filter((r,ix)=> !(hasHead && ix===1));
      out.push(`<div class="table-wrap"><table class="kb-table">${body.map((r,ix)=>`<tr>${r.map(c=> (hasHead && ix===0) ? `<th>${inl(c)}</th>` : `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</table></div>`); continue;
    }
    if((m = ln.match(/^!\[(\d+)\]\s*(.*)$/))){
      const im = art && (art.images||[])[Number(m[1])-1], src2 = im && pktSafeImg(im.data);
      if(src2) out.push(`<figure class="kb-fig"><img src="${src2}" alt="${esc(im.caption||"")}" data-kbimg="${src2.length}" class="kb-img"><figcaption>${esc(m[2]||im.caption||"")}</figcaption></figure>`);
      i++; continue;
    }
    const para = []; while(i<lines.length && lines[i].trim() && !isBlock(lines[i])){ para.push(inl(lines[i])); i++; }
    if(!para.length){ para.push(inl(lines[i])); i++; }
    out.push(`<p>${para.join("<br>")}</p>`);
  }
  return out.join("");
}

/* ---------------- search ----------------
   What makes it find things on a live call:
     · whole-word / word-START matching (typing "print" finds "printer"; "ad" no longer matches "load")
     · light stemming ("resetting", "resets" → "reset") and a short synonym list (KB_SYNONYMS below — edit it for your own jargon)
     · filler words ignored ("how do I reset a password" = "reset password")
     · title / search-words / section headings / quick answer / body weighted in that order, exact phrase bonus
     · typo tolerance only when a word matches nothing at all
     · results point to the best SECTION inside an article, and also search inside the full uploaded documents */
const KB_STOP = new Set(("a an the and or of to in on at by for with from is are was were be been it its this that these those i me my we you your do does did " +
  "how what when where why which who can could should would will not no please need needs want get gets got about into over").split(" "));
const KB_SYNONYMS = [               // each row = words that mean the same thing to an agent (lower case, stemmed forms are added automatically)
  ["password","pwd","passcode","passwd"],
  ["login","logon","signin","sign-in","log-in","signon"],
  ["unlock","lockout","locked"],
  ["email","mail","outlook"],
  ["mfa","2fa","otp","authenticator"],
  ["ticket","incident","case"],
  ["escalate","escalation"],
  ["laptop","notebook"]
];
const KB_SYN_MAP = (function(){ const m = {}; KB_SYNONYMS.forEach(g=> g.forEach(w=>{ (m[w] = m[w] || new Set()); g.forEach(x=>{ if(x!==w) m[w].add(x); }); })); return m; })();

function kbPlain(s){ return String(s||"").replace(/[#>*`|!\[\]_]|---+|\(https?:[^)]*\)/g," ").replace(/\s+/g," ").trim(); }
function kbStem(w){
  if(w.length <= 3 || /\d/.test(w)) return w;
  let r = w;
  if(/ies$/.test(r) && r.length > 4) r = r.slice(0,-3) + "y";
  else if(/(ss|us|is)$/.test(r)) return r;
  else if(/ing$/.test(r) && r.length > 5) r = r.slice(0,-3);
  else if(/ed$/.test(r) && r.length > 4) r = r.slice(0,-2);
  else if(/(s|x|z|ch|sh)es$/.test(r)) r = r.slice(0,-2);
  else if(/s$/.test(r)) r = r.slice(0,-1);
  if(r !== w && /([^aeiou])\1$/.test(r) && r.length > 3) r = r.slice(0,-1);     // "resett" → "reset"
  return r;
}
function kbTerms(q){                   // raw words the person typed (filler words dropped unless nothing else is left)
  const all = (String(q||"").toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []).filter(t=>t.length>=2 || /\d/.test(t));
  const keep = all.filter(t=>!KB_STOP.has(t));
  return keep.length ? keep : all;
}
function kbAlts(t){                    // every form of one typed word that should count as a hit
  const set = new Set([t]), st = kbStem(t); set.add(st);
  [t, st].forEach(x=>{ if(KB_SYN_MAP[x]) KB_SYN_MAP[x].forEach(y=>{ set.add(y); set.add(kbStem(y)); }); });
  return Array.from(set).filter(x=>x.length >= 2);
}
function kbWordAt(low, w){             // 2 = whole word, 1 = start of a longer word, 0 = absent
  let i = low.indexOf(w), best = 0;
  while(i >= 0){
    if(i === 0 || !/[a-z0-9]/.test(low[i-1])){
      if(!/[a-z0-9]/.test(low[i+w.length] || " ")) return 2;
      best = 1;
    }
    i = low.indexOf(w, i+1);
  }
  return best;
}
function kbBestHit(low, alts){ let b = 0; for(const w of alts){ const h = kbWordAt(low, w); if(h > b) b = h; if(b === 2) break; } return b; }
function kbCountWords(low, alts, cap){ let n = 0; for(const w of alts){ let i = low.indexOf(w); while(i >= 0 && n < cap){ if(i===0 || !/[a-z0-9]/.test(low[i-1])) n++; i = low.indexOf(w, i+1); } } return n; }
function kbHKey(t){ const s = String(t||"").replace(/[*`]/g,""); return (typeof kbAi!=="undefined" && kbAi.cleanTitle) ? kbAi.normTitle(kbAi.cleanTitle(s)) : s.toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }

function kbSections(md){               // an article / document split at its headings: [{title,key,level,text,low}]
  const secs = []; let cur = {title:"", key:"", level:0, lines:[]};
  String(md||"").replace(/\r/g,"").split("\n").forEach(l=>{
    const m = l.match(/^(#{1,3})\s+(.*)$/);
    if(m){ secs.push(cur); cur = {title:m[2].replace(/[*`]/g,"").trim(), key:kbHKey(m[2]), level:m[1].length, lines:[]}; } else cur.lines.push(l);
  });
  secs.push(cur);
  return secs.map(x=>{ const text = kbPlain(x.lines.join("\n")); return {title:x.title, key:x.key, level:x.level, text, low:text.toLowerCase(), tlow:x.title.toLowerCase()}; })
             .filter(x=>x.title || x.text);
}
function kbFields(a){
  const sig = (a.updatedAt||"")+"|"+(a.version||0);
  if(a.__f && a.__f.u === sig) return a.__f;
  const f = {u:sig, title:(a.title||"").toLowerCase(), summary:kbPlain(a.summary).toLowerCase(), cat:(a.category||"").toLowerCase(),
    tags:(a.tags||[]).map(t=>String(t).toLowerCase()).join(" \n "), body:kbPlain(a.body).toLowerCase(), secs:kbSections(a.body)};
  f.heads = f.secs.map(x=>x.tlow).filter(Boolean).join(" \n ");
  f.vocab = Array.from(new Set((f.title+" "+f.tags+" "+f.heads).split(/[^a-z0-9]+/).filter(w=>w.length>=4)));
  Object.defineProperty(a, "__f", {value:f, enumerable:false, configurable:true}); // cached, never saved to Firestore
  return f;
}
const KB_W = {title:10, tags:8, heads:5, summary:5, cat:3, body:1.5};
function kbTermScore(f, alts){
  let s = 0;
  const add = (field, w)=>{ const h = kbBestHit(f[field], alts); if(h) s += w * (h===2 ? 1 : 0.75) + (field==="title" && f.title.startsWith(alts[0]) ? 3 : 0); return h; };
  add("title", KB_W.title); add("tags", KB_W.tags); add("heads", KB_W.heads); add("summary", KB_W.summary); add("cat", KB_W.cat);
  if(kbBestHit(f.body, alts)) s += KB_W.body + Math.min(5, kbCountWords(f.body, alts, 6)) * 0.25;
  if(!s && alts[0].length >= 3 && /[^a-z0-9]/.test(alts[0]) && f.body.includes(alts[0])) s += 1;      // codes like "co-29" inside longer text
  return s;
}
function kbFuzzyScore(f, t){
  if(t.length < 4 || typeof levenshtein !== "function") return 0;
  const tol = t.length > 7 ? 2 : 1;
  return f.vocab.some(w=> Math.abs(w.length-t.length) <= tol && levenshtein(w, t) <= tol) ? 4 : 0;
}
function kbVoteMap(){ const m = {}; (state.kbFeedback||[]).forEach(f=>{ if(f.type==="vote"){ const x = (m[f.articleId] = m[f.articleId] || {up:0, down:0}); if(f.value>0) x.up++; else x.down++; } }); return m; }
// All words must match (AND). If nothing does, fall back to "any word" and flag the results as closest matches.
function kbSearch(list, q){
  const terms = kbTerms(q); if(!terms.length) return {hits:[], loose:false, terms};
  const altsOf = terms.map(kbAlts), votes = kbVoteMap(), phrase = terms.join(" ");
  const fs = list.map(a=>kbFields(a));
  const per = list.map((a,ai)=> altsOf.map(al=>kbTermScore(fs[ai], al)));
  const lost = terms.map((t,ti)=> per.every(r=>!r[ti]));            // a word that matches no article at all → try typos
  lost.forEach((isLost, ti)=>{ if(isLost) list.forEach((a,ai)=>{ per[ai][ti] = kbFuzzyScore(fs[ai], terms[ti]); }); });
  const run = (all)=> list.map((a,ai)=>{
    const f = fs[ai], row = per[ai]; let total = 0, matched = 0;
    for(const sc of row){ if(sc){ total += sc; matched++; } else if(all) return null; }
    if(!matched) return null;
    if(terms.length > 1){ if(f.title.includes(phrase)) total += 8; if(f.summary.includes(phrase)) total += 5; else if(f.body.includes(phrase)) total += 3; if(matched === terms.length && terms.every((t,ti)=>kbBestHit(f.title, altsOf[ti]))) total += 4; }
    const v = votes[a.id]; if(v) total += Math.max(-3, Math.min(3, (v.up - v.down) * 0.5));
    return {a, score: total + (a.pinned?2:0), sec: kbBestSection(f, altsOf)};
  }).filter(Boolean).sort((x,y)=> y.score-x.score || String(y.a.updatedAt).localeCompare(String(x.a.updatedAt)));
  const hits = run(true);
  if(hits.length) return {hits, loose:false, terms};
  return {hits: run(false).slice(0,8), loose:true, terms};
}
function kbBestSection(f, altsOf){      // the heading inside the article that answers the question best (null = the intro / whole article)
  let best = null, bs = 0;
  f.secs.forEach(sec=>{
    if(!sec.title) return;
    let sc = 0, n = 0;
    altsOf.forEach(al=>{ const th = kbBestHit(sec.tlow, al), bh = kbBestHit(sec.low, al); if(th || bh){ n++; sc += th*4 + bh; } });
    if(n && n >= Math.ceil(altsOf.length/2) && sc > bs){ bs = sc + n*2; best = sec; }
  });
  return best;
}
function kbHiTerms(q){ const set = new Set(); kbTerms(q).forEach(t=>{ set.add(t); set.add(kbStem(t)); }); return Array.from(set).filter(t=>t.length>=2).sort((a,b)=>b.length-a.length); }
function kbHiRegex(terms, flags){
  if(!terms.length) return null;
  const alt = terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|");
  try{ return new RegExp("(?<![A-Za-z0-9])("+alt+")", flags); }catch(e){ return new RegExp("("+alt+")", flags); }   // old browsers without look-behind
}
function kbHighlight(text, terms){
  const s = esc(text), re = kbHiRegex(terms.map(t=>esc(t)), "ig");
  return re ? s.replace(re, "<mark>$1</mark>") : s;
}
function kbSnippet(a, terms, sec){
  const plain = sec && sec.text ? sec.text : kbPlain(a.body), low = plain.toLowerCase();
  let pos = -1; for(const t of terms){ pos = low.indexOf(t); if(pos>=0) break; }
  if(pos<0) return "";
  const from = Math.max(0, pos-60), to = Math.min(plain.length, pos+130);
  return (from>0?"…":"") + plain.slice(from,to) + (to<plain.length?"…":"");
}

/* "I searched and found nothing" is the most valuable signal the KB gets: it is logged (once per person per question)
   so Trainers/Quality see exactly what agents are looking for and can't find. Staff searching don't count. */
let kbMissTimer = null;
function kbLogMiss(q){
  clearTimeout(kbMissTimer);
  const norm = kbTerms(q).join(" ");
  if(!norm || norm.length < 4 || canManageKB()) return;
  kbMissTimer = setTimeout(()=>{
    if(kbTerms(kbQuery).join(" ") !== norm) return;            // they kept typing — not the final question
    if(!state.kbFeedback) state.kbFeedback = [];
    const id = "miss__"+kbUserKey()+"__"+kbAi.hashStr(norm), now = new Date().toISOString(), old = state.kbFeedback.find(f=>f.id===id);
    if(old){ if(old.loggedDay === now.slice(0,10)) return; old.count = (old.count||1) + 1; old.loggedDay = now.slice(0,10); old.updatedAt = now; if(old.status==="done") old.status = "open"; }
    else state.kbFeedback.push(Object.assign(kbBaseFeedback(), {id, type:"miss", text:String(q).trim().slice(0,160), norm, count:1, loggedDay:now.slice(0,10), status:"open"}));
    saveState();
  }, 1800);
}

/* ---------------- feedback ---------------- */
function kbMyVote(articleId){ return (state.kbFeedback||[]).find(f=>f.id===articleId+"__"+kbUserKey()); }
function kbVoteStats(articleId){
  const v = (state.kbFeedback||[]).filter(f=>f.type==="vote" && f.articleId===articleId);
  return {up:v.filter(x=>x.value>0).length, down:v.filter(x=>x.value<0).length};
}
function kbBaseFeedback(){
  const me = kbMyAgent();
  return {userKey:kbUserKey(), name:currentUser.name, role:currentRoleLabel(), lob: me ? (me.lob||"") : "", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()};
}
function kbVote(a, value, comment){
  if(!state.kbFeedback) state.kbFeedback = [];
  const id = a.id+"__"+kbUserKey(), old = kbMyVote(a.id);
  const f = Object.assign(kbBaseFeedback(), {id, type:"vote", articleId:a.id, articleTitle:a.title, value, comment:comment||"", status: value<0 ? "open" : "done"});
  if(old) f.createdAt = old.createdAt;
  if(old) state.kbFeedback[state.kbFeedback.indexOf(old)] = f; else state.kbFeedback.push(f);
  saveState(); render();
}
function kbOpenRequestModal(prefill){
  const me = kbMyAgent();
  const ov = showModal(`
    <div class="modal-title">Can't find it? Ask for it</div>
    <p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin:0 0 10px;">Tell the Trainers/Quality what you needed to know. They'll add or fix an article.</p>
    <div class="field"><label>What do you need help with?</label><textarea id="kbReqText" rows="4" placeholder="e.g. How do I handle a provider asking for the timely filing limit on a Medicare claim?">${esc(prefill||"")}</textarea><div class="field-error" id="kbReqErr"></div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="kbReqNo">Cancel</button><button class="btn btn-accent" id="kbReqYes">Send request</button></div>`);
  ov.querySelector("#kbReqNo").addEventListener("click", closeModal);
  ov.querySelector("#kbReqYes").addEventListener("click", ()=>{
    const text = ov.querySelector("#kbReqText").value.trim();
    if(text.length < 5){ const e = ov.querySelector("#kbReqErr"); e.textContent = "Please describe what you need (a few words at least)."; e.classList.add("show"); return; }
    if(!state.kbFeedback) state.kbFeedback = [];
    state.kbFeedback.push(Object.assign(kbBaseFeedback(), {id:kbNewId("kbf"), type:"request", text, status:"open", lob: me ? (me.lob||"") : (kbLobFilter!=="all" ? kbLobFilter : "")}));
    saveState(); closeModal(); showToast("✅ Sent — the team will add or update an article"); render();
  });
}

/* ---------------- entry ---------------- */
function renderKB(content, topActions){
  topActions.innerHTML = "";
  if(!canViewKB()){ content.innerHTML = ""; return; }
  if(!canManageKB()){ kbSubTab = "browse"; kbView = "list"; }
  if(kbView==="import" && canManageKB() && typeof kbImp!=="undefined" && kbImp){ kbImportRender(content, topActions); return; }
  if(kbView==="editor" && canManageKB() && typeof kbDraft!=="undefined" && kbDraft){ kbRenderEditor(content, topActions); return; }
  kbView = "list";
  if(canManageKB()) topActions.innerHTML = `<button class="btn btn-ghost" id="kbImportBtn" title="Upload an SOP — topics, quick answers and articles are created for you">📄 Import from document</button> <button class="btn btn-accent" id="kbNewBtn">＋ New article</button>`;
  const tabs = canManageKB() ? `<div class="dash-tabs" style="margin:0 0 14px;">
      <button class="dash-tab ${kbSubTab==="browse"?"active":""}" data-kbtab="browse">📚 Browse</button>
      <button class="dash-tab ${kbSubTab==="manage"?"active":""}" data-kbtab="manage">🛠 Manage articles</button>
      <button class="dash-tab ${kbSubTab==="feedback"?"active":""}" data-kbtab="feedback">💬 Feedback &amp; requests${kbOpenCount()?` <span class="nav-count-badge" style="position:static;margin-left:4px;">${kbOpenCount()}</span>`:""}</button></div>` : "";
  let body;
  if(kbSubTab==="manage") body = kbManageHtml();
  else if(kbSubTab==="feedback") body = kbFeedbackHtml();
  else if(kbOpenDocId && kbDocById(kbOpenDocId) && (kbDocVisible(kbDocById(kbOpenDocId)) || canManageKB())) body = kbDocViewHtml(kbDocById(kbOpenDocId));
  else { kbOpenDocId = null; body = kbOpenId && kbById(kbOpenId) && (kbVisible(kbById(kbOpenId)) || canManageKB()) ? kbArticleHtml(kbById(kbOpenId)) : kbBrowseShell(); }
  content.innerHTML = tabs + body;
  content.querySelectorAll("[data-kbtab]").forEach(b=> b.addEventListener("click", ()=>{ kbSubTab = b.dataset.kbtab; kbOpenId = null; kbOpenDocId = null; render(); }));
  const nb = document.getElementById("kbNewBtn"); if(nb) nb.addEventListener("click", ()=> kbOpenEditor(null));
  const ib = document.getElementById("kbImportBtn"); if(ib) ib.addEventListener("click", ()=> kbOpenImport());
  if(kbSubTab==="manage") kbWireManage(content);
  else if(kbSubTab==="feedback") kbWireFeedback(content);
  else if(document.getElementById("kbDocView")) kbWireDoc(content);
  else if(kbOpenId && document.getElementById("kbArticle")) kbWireArticle(content);
  else kbWireBrowse(content);
}

/* ---------------- browse ---------------- */
function kbBrowseShell(){
  const me = kbMyAgent();
  const lobs = LOB_OPTIONS;
  const scope = isAgent()
    ? `Showing articles for <b>${esc((me && me.lob) || "General")}</b>${me && me.lob ? " + General (all LOBs)" : ""}`
    : `<div class="kb-chips">${[["all","All"],["","General"]].concat(lobs.map(l=>[l,l])).map(([v,t])=>`<button class="kb-chip ${kbLobFilter===v?"on":""}" data-kblob="${esc(v)}">${esc(t)}</button>`).join("")}</div>`;
  return `<div class="kb-hero">
      <div class="kb-search"><span class="kb-search-ic">🔍</span>
        <input type="text" id="kbSearch" placeholder="What do you need to know? e.g. “timely filing”, “claim denial”, “transfer”" value="${esc(kbQuery)}" autocomplete="off" spellcheck="false">
        <button type="button" id="kbSearchClear" class="kb-search-x" style="display:${kbQuery?"flex":"none"};" title="Clear (Esc)">✕</button></div>
      <div class="kb-scope">${scope}<span class="kb-hint">Press <kbd>/</kbd> to search</span></div>
    </div>
    <div id="kbBody">${kbBodyHtml()}</div>`;
}
function kbCard(a, opts){
  opts = opts || {};
  const terms = kbHiTerms(kbQuery), fav = kbIsFav(a.id), sec = opts.sec || null;
  const snip = opts.snippet ? kbSnippet(a, terms, sec) : "";
  const stale = isAgent() && (kbDaysSince(a.reviewedAt||a.updatedAt) > KB_STALE_DAYS);
  return `<div class="kb-card" data-kbopen="${esc(a.id)}" ${sec ? `data-kbanchor="${esc(sec.key)}"` : ""} tabindex="0">
    <div class="kb-card-top"><div class="kb-card-title">${a.pinned?"📌 ":""}${kbHighlight(a.title||"(untitled)", terms)}</div>
      <button class="kb-star ${fav?"on":""}" data-kbfav="${esc(a.id)}" title="${fav?"Remove from favourites":"Save to favourites"}">${fav?"★":"☆"}</button></div>
    ${a.summary ? `<div class="kb-card-sum">${kbHighlight(kbPlain(a.summary).slice(0,200), terms)}</div>` : ""}
    ${sec ? `<div class="kb-card-sec">↳ In section: <b>${kbHighlight(sec.title, terms)}</b></div>` : ""}
    ${snip ? `<div class="kb-card-snip">${kbHighlight(snip, terms)}</div>` : ""}
    <div class="kb-card-meta">${kbLobBadge(a)}${a.category?`<span class="kb-cat-tag">${esc(a.category)}</span>`:""}<span>Updated ${esc(fmtDate((a.updatedAt||"").slice(0,10)))}</span>${stale?`<span style="color:var(--yellow);">⚠ may be outdated</span>`:""}</div>
  </div>`;
}
function kbBodyHtml(){
  const list = kbScopeList(), q = kbQuery.trim();
  const canAsk = isAgent() || canManageKB() || true;
  if(q){
    const {hits, loose} = kbSearch(list, q), docHits = kbDocSearch(q, hits.map(h=>h.a));
    if(!hits.length && !docHits.length){
      kbLogMiss(q);
      return `<div class="empty-state" style="padding:30px 16px;text-align:center;"><div class="big">🤔</div>
      <div class="disp" style="font-size:15px;font-weight:600;">Nothing found for “${esc(q)}”</div>
      <p>Try fewer or different words (e.g. a code, a system name, or a short phrase). Still stuck? Ask for it — your question is also noted so the team can add it.</p>
      <button class="btn btn-accent" data-kbask="1" style="margin-top:12px;">✍️ Ask for this topic</button></div>`;
    }
    const total = hits.length + docHits.length;
    return `<div class="kb-count">${loose && !docHits.length ? `No exact match — <b>closest matches</b> (${hits.length})` : `<b>${total}</b> result${total===1?"":"s"}${docHits.length ? ` · ${hits.length} article${hits.length===1?"":"s"}, ${docHits.length} in full documents` : ""}`}</div>
      ${hits.length ? `<div class="kb-results">${hits.map(h=>kbCard(h.a,{snippet:true, sec:h.sec})).join("")}</div>` : ""}
      ${docHits.length ? `<div class="kb-sec-title" style="margin:16px 0 8px;">📄 Found in the full documents</div><div class="kb-results">${docHits.map(kbDocHitCard).join("")}</div>` : ""}
      <div class="kb-ask-foot">Not what you were looking for? <button class="btn btn-ghost btn-sm" data-kbask="1">✍️ Ask for this topic</button></div>`;
  }
  if(kbCat !== null){
    const items = list.filter(a=>(a.category||"General")===kbCat).sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || String(a.title).localeCompare(String(b.title)));
    return `<div class="kb-crumb"><button class="btn btn-ghost btn-sm" data-kbcat="">← All topics</button><b>${esc(kbCat)}</b><span class="help-note">${items.length} article${items.length===1?"":"s"}</span></div>
      <div class="kb-results">${items.map(a=>kbCard(a)).join("") || `<div class="help-note">No articles in this topic.</div>`}</div>`;
  }
  const docs = kbDocScope();
  if(!list.length && !docs.length) return `<div class="empty-state" style="padding:40px 16px;text-align:center;"><div class="big">📚</div>
    <div class="disp" style="font-size:15px;font-weight:600;">${canManageKB() ? "No articles yet" : "The knowledge base is being built"}</div>
    <p>${canManageKB() ? "Create the first article — start with the questions agents ask you most often." : "Articles for your LOB will appear here. Meanwhile, ask your TL or Trainer."}</p>
    ${canManageKB() ? `<button class="btn btn-accent" id="kbImportBtn2" style="margin-top:12px;">📄 Import from an SOP</button> <button class="btn btn-ghost" id="kbNewBtn2" style="margin-top:12px;">＋ New article</button>` : `<button class="btn btn-accent" data-kbask="1" style="margin-top:12px;">✍️ Ask for a topic</button>`}</div>`;
  const pinned = list.filter(a=>a.pinned).slice(0,6);
  const cats = {}; list.forEach(a=>{ const c = a.category||"General"; cats[c] = (cats[c]||0)+1; });
  const favs = kbLoadList("fav").map(kbById).filter(a=>a && list.includes(a)).slice(0,6);
  const recent = kbLoadList("recent").map(kbById).filter(a=>a && list.includes(a)).slice(0,5);
  const updated = list.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,5);
  const mine = (state.kbFeedback||[]).filter(f=>f.type==="request" && f.userKey===kbUserKey()).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,4);
  const sec = (t, inner)=> inner ? `<div class="kb-sec"><div class="kb-sec-title">${t}</div>${inner}</div>` : "";
  return `
    ${sec("📌 Quick answers", pinned.length ? `<div class="kb-grid">${pinned.map(a=>kbCard(a)).join("")}</div>` : "")}
    ${sec("📄 Full documents (SOPs)", docs.length ? `<div class="kb-grid">${docs.map(kbDocCard).join("")}</div>` : "")}
    ${sec("🗂 Browse by topic", !list.length ? "" : `<div class="kb-topics">${Object.keys(cats).sort().map(c=>`<button class="kb-topic" data-kbcat="${esc(c)}"><span>📁 ${esc(c)}</span><b>${cats[c]}</b></button>`).join("")}</div>`)}
    ${sec("⭐ My favourites", favs.length ? `<div class="kb-grid">${favs.map(a=>kbCard(a)).join("")}</div>` : "")}
    ${sec("🕘 Recently viewed", recent.length ? `<div class="kb-grid">${recent.map(a=>kbCard(a)).join("")}</div>` : "")}
    ${sec("🆕 Recently updated", `<div class="kb-grid">${updated.map(a=>kbCard(a)).join("")}</div>`)}
    ${sec("💬 My requests", mine.length ? `<div class="kb-reqs">${mine.map(f=>{ const ra = f.resolvedArticleId && kbById(f.resolvedArticleId); return `<div class="kb-req"><span>${esc(f.text.slice(0,110))}</span>${f.status==="done" ? (ra && kbVisible(ra) ? `<a href="#" class="kb-ilink" data-kbopen="${esc(ra.id)}">✅ Answered — open</a>` : `<span class="badge badge-green">Resolved</span>`) : `<span class="badge badge-yellow">Waiting</span>`}</div>`; }).join("")}</div>` : "")}
    <div class="kb-ask-foot">Can't find what you need? <button class="btn btn-ghost btn-sm" data-kbask="1">✍️ Ask for a topic</button></div>`;
}
function kbWireBody(root){
  root.querySelectorAll("[data-kbopen]").forEach(el=> el.addEventListener("click", e=>{
    if(e.target.closest("[data-kbfav]")) return;
    e.preventDefault(); kbOpenArticle(el.dataset.kbopen, {anchor:el.dataset.kbanchor||""});
  }));
  root.querySelectorAll("[data-kbdoc]").forEach(el=> el.addEventListener("click", e=>{ e.preventDefault(); kbOpenDoc(el.dataset.kbdoc, {anchor:el.dataset.kbanchor||"", find:kbQuery}); }));
  root.querySelectorAll(".kb-card").forEach(el=> el.addEventListener("keydown", e=>{ if(e.key==="Enter"){ if(el.dataset.kbdoc) kbOpenDoc(el.dataset.kbdoc, {anchor:el.dataset.kbanchor||"", find:kbQuery}); else kbOpenArticle(el.dataset.kbopen, {anchor:el.dataset.kbanchor||""}); } }));
  root.querySelectorAll("[data-kbfav]").forEach(b=> b.addEventListener("click", e=>{ e.stopPropagation(); kbToggleFav(b.dataset.kbfav); const body = document.getElementById("kbBody"); body.innerHTML = kbBodyHtml(); kbWireBody(body); }));
  root.querySelectorAll("[data-kbcat]").forEach(b=> b.addEventListener("click", ()=>{ kbCat = b.dataset.kbcat==="" ? null : b.dataset.kbcat; kbQuery = ""; render(); }));
  root.querySelectorAll("[data-kbask]").forEach(b=> b.addEventListener("click", ()=> kbOpenRequestModal(kbQuery)));
  const nb2 = root.querySelector("#kbNewBtn2"); if(nb2) nb2.addEventListener("click", ()=> kbOpenEditor(null));
  const ib2 = root.querySelector("#kbImportBtn2"); if(ib2) ib2.addEventListener("click", ()=> kbOpenImport());
}
function kbWireBrowse(content){
  const inp = document.getElementById("kbSearch"), clr = document.getElementById("kbSearchClear");
  const refresh = ()=>{ const body = document.getElementById("kbBody"); body.innerHTML = kbBodyHtml(); kbWireBody(body); clr.style.display = kbQuery ? "flex" : "none"; };
  inp.addEventListener("input", ()=>{ kbQuery = inp.value; if(kbQuery) kbCat = null; refresh(); });
  inp.addEventListener("keydown", e=>{ if(e.key==="Escape"){ kbQuery = ""; inp.value = ""; refresh(); } if(e.key==="Enter"){ const first = document.querySelector("#kbBody .kb-card"); if(first){ if(first.dataset.kbdoc) kbOpenDoc(first.dataset.kbdoc, {anchor:first.dataset.kbanchor||"", find:kbQuery}); else kbOpenArticle(first.dataset.kbopen, {anchor:first.dataset.kbanchor||""}); } } });
  clr.addEventListener("click", ()=>{ kbQuery = ""; inp.value = ""; refresh(); inp.focus(); });
  content.querySelectorAll("[data-kblob]").forEach(b=> b.addEventListener("click", ()=>{ kbLobFilter = b.dataset.kblob; kbCat = null; render(); }));
  kbWireBody(content);
  if(!kbQuery && !("ontouchstart" in window)) inp.focus({preventScroll:true});
}
document.addEventListener("keydown", e=>{            // "/" jumps to search from anywhere in the KB
  if(e.key!=="/" || currentTab!=="kb" || kbView!=="list" || kbOpenId) return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target||{}).tagName||"")) return;
  const s = document.getElementById("kbSearch"); if(s){ e.preventDefault(); s.focus(); s.select(); }
});
function kbOpenArticle(id, opts){
  const a = kbById(id); if(!a) return;
  kbJump = {anchor:(opts && opts.anchor) || "", find:""};
  kbOpenId = id; kbOpenDocId = null; kbSubTab = "browse"; kbPushRecent(id);
  if(currentTab!=="kb") currentTab = "kb";
  render(); const m = document.getElementById("main"); if(m) m.scrollTop = 0;
}

/* ---------------- article reader ---------------- */
function kbArticleHtml(a){
  const days = kbDaysSince(a.reviewedAt||a.updatedAt), stale = days!==null && days > KB_STALE_DAYS;
  const my = kbMyVote(a.id), st = kbVoteStats(a.id), fav = kbIsFav(a.id);
  const canEdit = canEditKB(a);
  return `<div class="kb-article" id="kbArticle">
    <div class="kb-art-bar"><button class="btn btn-ghost btn-sm" id="kbBack">← Back${kbQuery?` to results`:""}</button>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" id="kbFindBtn">🔎 Find</button>
        <button class="btn btn-ghost btn-sm" id="kbFavBtn">${fav?"★ Saved":"☆ Save"}</button>
        ${canEdit ? `<button class="btn btn-ghost btn-sm" id="kbEditBtn">✏️ Edit</button>` : ""}</div></div>
    <div class="kb-art-head">
      <div class="kb-card-meta" style="margin:0 0 8px;">${kbLobBadge(a)}${a.category?`<span class="kb-cat-tag">${esc(a.category)}</span>`:""}${a.status!=="published"?`<span class="badge badge-yellow">${esc(a.status)}</span>`:""}</div>
      <h2 class="kb-art-title">${esc(a.title)}</h2>
      <div class="help-note">Updated ${esc(fmtDate((a.updatedAt||"").slice(0,10)))}${a.updatedBy?` by ${esc(a.updatedBy)}`:""}${a.reviewedAt?` · Reviewed ${esc(fmtDate(a.reviewedAt.slice(0,10)))}`:""}${a.version>1?` · v${a.version}`:""}</div>
      ${stale ? `<div class="pkt-banner" style="margin:10px 0 0;border-color:var(--yellow);background:var(--yellow-dim);">⚠ Last reviewed ${days} days ago — this may be out of date. If something doesn't match what you see, check with your TL and use “Not helpful” below so it gets fixed.</div>` : ""}
      ${a.changeNote && days!==null && days<=14 ? `<div class="help-note" style="margin-top:8px;">🆕 What changed: ${esc(a.changeNote)}</div>` : ""}
    </div>
    ${a.summary ? `<div class="kb-quick"><div class="kb-quick-h">⚡ Quick answer <button class="btn btn-ghost btn-sm" id="kbCopySum" style="margin-left:auto;">Copy</button></div><div class="kb-quick-b">${kbMd(a.summary, a).replace(/^<p>|<\/p>$/g,"")}</div></div>` : ""}
    <div class="kb-find-bar" id="kbFindBar" style="display:none;"><input type="text" id="kbFind" placeholder="Find in this article…" autocomplete="off"><span class="help-note" id="kbFindCnt"></span><button class="btn btn-ghost btn-sm" id="kbFindPrev" title="Previous">↑</button><button class="btn btn-ghost btn-sm" id="kbFindNext" title="Next">↓</button></div>
    <div class="kb-body" id="kbBodyText">${kbMd(a.body, a)}</div>
    ${kbSourceBox(a)}
    ${kbRelatedHtml(a)}
    ${(a.tags||[]).length ? `<div class="kb-tags">${a.tags.map(t=>`<button class="kb-tag" data-kbtag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
    ${kbFeedbackBlock(a, my, st)}
  </div>`;
}
function kbFeedbackBlock(a, my, st){
  const staffStats = canManageKB() ? `<span class="help-note" style="margin-left:auto;">👍 ${st.up} · 👎 ${st.down}</span>` : "";
  return `<div class="kb-fb" id="kbFb">
    <b>Did this answer your question?</b>
    <button class="btn btn-sm ${my&&my.value>0?"btn-accent":""}" id="kbUp">👍 Yes${my&&my.value>0?" ✓":""}</button>
    <button class="btn btn-sm ${my&&my.value<0?"btn-danger":""}" id="kbDown">👎 Not really${my&&my.value<0?" ✓":""}</button>
    ${staffStats}
    ${my && my.value<0 && my.comment ? `<div class="help-note" style="flex-basis:100%;">Your note: “${esc(my.comment)}” — thanks, the team will review it.</div>` : ""}
  </div>`;
}
function kbWireArticle(content){
  const a = kbById(kbOpenId), $ = id => document.getElementById(id);
  $("kbBack").addEventListener("click", ()=>{ kbOpenId = null; render(); });
  kbSetupReader(content, {toc:true});
  content.querySelectorAll("[data-kbdoc]").forEach(el=> el.addEventListener("click", e=>{ e.preventDefault(); kbOpenDoc(el.dataset.kbdoc, {anchor:el.dataset.kbanchor||"", find:""}); }));
  $("kbFavBtn").addEventListener("click", ()=>{ kbToggleFav(a.id); render(); });
  if($("kbEditBtn")) $("kbEditBtn").addEventListener("click", ()=> kbOpenEditor(a.id));
  if($("kbCopySum")) $("kbCopySum").addEventListener("click", ()=> kbCopy(kbPlain(a.summary)));
  $("kbUp").addEventListener("click", ()=> kbVote(a, 1, ""));
  $("kbDown").addEventListener("click", ()=>{
    const ov = showModal(`<div class="modal-title">What was missing or wrong?</div>
      <div class="field"><textarea id="kbDownTxt" rows="4" placeholder="e.g. Doesn't cover Medicare Advantage; step 3 is different on my screen"></textarea></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="kbDownNo">Cancel</button><button class="btn btn-accent" id="kbDownYes">Send</button></div>`);
    ov.querySelector("#kbDownNo").addEventListener("click", closeModal);
    ov.querySelector("#kbDownYes").addEventListener("click", ()=>{ const t = ov.querySelector("#kbDownTxt").value.trim(); closeModal(); kbVote(a, -1, t); showToast("Thanks — the team will take a look"); });
  });
  content.querySelectorAll("[data-kbopen]").forEach(el=> el.addEventListener("click", e=>{ e.preventDefault(); kbOpenArticle(el.dataset.kbopen); }));
  content.querySelectorAll("[data-kbtag]").forEach(b=> b.addEventListener("click", ()=>{ kbQuery = b.dataset.kbtag; kbOpenId = null; kbCat = null; render(); }));
  content.querySelectorAll(".kb-copy").forEach(c=> c.addEventListener("click", ()=> kbCopy(c.dataset.copy)));
  content.querySelectorAll(".kb-img").forEach(im=> im.addEventListener("click", ()=> openImageLightbox(im.src, im.alt)));
}
function kbCopy(text){
  const done = ()=> showToast("📋 Copied");
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, ()=> showToast("Couldn't copy"));
  else { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); done(); }catch(e){ showToast("Couldn't copy"); } t.remove(); }
}

/* ---------------- global search hook (topbar search) ---------------- */
function kbGlobalSearchItems(){
  if(!canViewKB()) return [];
  return (state.kbArticles||[]).filter(kbVisible).map(a=>({
    group:"Knowledge Base", id:"kb-"+a.id, title:a.title||"(untitled)",
    sub:[a.lob||"General", a.category].filter(Boolean).join(" · "),
    haystack:[a.title, a.summary, (a.tags||[]).join(" "), a.category, kbPlain(a.body)].filter(Boolean).join(" ").toLowerCase(),
    onSelect:()=>{ kbQuery = ""; kbCat = null; kbOpenArticle(a.id); }
  })).concat(kbDocs().filter(kbDocVisible).map(d=>({
    group:"Knowledge Base", id:"kbd-"+d.id, title:"📄 "+(d.title||"(document)"),
    sub:[d.lob||"General", "Full document"].join(" · "),
    haystack:[d.title, d.file].filter(Boolean).join(" ").toLowerCase(),
    onSelect:()=>{ kbQuery = ""; kbCat = null; kbOpenDoc(d.id, {}); }
  })));
}
