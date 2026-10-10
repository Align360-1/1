/* =========================================================
   KNOWLEDGE BASE — document → articles engine ("Import from document")
   ---------------------------------------------------------
   Takes the text of an SOP (Word .docx via mammoth → HTML, or .txt/.md) and turns it into ready-to-review
   Knowledge Base articles:
     1. Reads the document structure (headings, lists, tables, images, notes/warnings).
     2. Finds the topics: the heading tree is split into articles; higher headings become the category.
     3. Writes the ⚡ Quick answer for each article (the sentence(s) an agent can act on right away, or a
        short step summary when the section is just a procedure).
     4. Converts the section to the KB's own mini-markdown (steps, callouts, tables, copyable codes, images).
     5. Suggests search words (tags), flags boilerplate (revision history, approvals…) and weak spots.

   This is deliberately a self-contained, rule-based engine: it runs in the browser, needs no server, no API key
   and sends nothing outside the app. Everything it produces lands in a review screen first (kb-import.js).
   Pure functions, no DOM access except DOMParser — so it can be unit-tested outside the app.
   If a hosted language model is ever wired in, replace kbAi.fromHtml / kbAi.fromText only — the UI and the
   output shape (see `article` below) stay the same.

   Output: {docTitle, notes[], articles:[{key,title,category,summary,summaryNote,body,tags[],imgRefs[{idx,caption}],
            include,reason,warnings[],hash,textLen}]}
   ========================================================= */

const kbAi = (function(){
  const STOP = new Set(("a an the and or but if then else of to in on at by for with from as is are was were be been being it its this that these those " +
    "you your we our they their them he she his her not no yes can could should would will shall may might must do does did done have has had having " +
    "into onto out up down over under about than too very also just more most such any each per via etc all other which who whom whose what when where " +
    "why how while during before after between within without across using use used one two new only same both many some there here once make made " +
    "see also please ensure steps step note time found process procedure handle handling call calls need needs get gets").split(" "));
  const ADMIN_RE = /^(revision history|version history|document (control|history|information|approval)|change (log|history)|table of contents|contents|approvals?|sign[- ]?off|distribution( list)?|document owner|references?|related documents?|author(s)?|review (history|schedule))$/i;
  const INTRO_RE = /^(purpose|scope|objectives?|introduction|overview|background|policy statement|applicability|intended audience|audience)$/i;
  const LEAD_TITLE_RE = /^(purpose|summary|overview|objectives?|description|when to use( this)?|scope)$/i;
  const META_RE = /^(this|the following|these)\s+(section|document|procedure|sop|process|article|guide|policy|page)\b/i;
  const GENERIC_CAT_RE = /^(procedures?|process(es)?|instructions?|steps|scenarios?|guidelines?|workflow|work instructions?|main procedure|call handling)$/i;
  const DIRECTIVE_RE = /\b(must|should|always|never|do not|don't|required|requires?|only|within|escalate|verify|confirm|ensure|call|reset|use|check|open|submit|raise|transfer|document)\b/i;

  /* ---------- small helpers ---------- */
  function cleanText(s){
    return String(s||"").replace(/[   ]/g," ").replace(/[​-‍﻿]/g,"")
      .replace(/`/g,"'").replace(/\[\[/g,"[ [").replace(/\]\]/g,"] ]").replace(/[ \t\r\n]+/g," ");
  }
  function plain(md){
    return String(md||"").replace(/!\[\d+\]/g," ").replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\*\*|\*|`/g,"")
      .replace(/^\s*(?:>[!+]?|#{1,3}|[-*]|\d+[.)])\s+/gm,"").replace(/\|/g," ").replace(/\s+/g," ").trim();
  }
  function hashStr(s){ let h = 5381; s = String(s||""); for(let i=0;i<s.length;i++) h = ((h<<5)+h+s.charCodeAt(i))|0; return (h>>>0).toString(36); }
  function normTitle(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim(); }
  function clip(s, n){
    s = String(s||"").trim(); if(s.length <= n) return s;
    const cut = s.slice(0, n-1), sp = cut.lastIndexOf(" ");
    return (sp > n*0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/,"") + "…";
  }
  function cleanTitle(t){
    let s = cleanText(t).trim()
      .replace(/^(section|step)\s+\d+(\.\d+)*\s*[:.\-–]\s*/i,"")
      .replace(/^\d+(\.\d+)*[.)]?\s+/,"")           // "4.2 Password resets" -> "Password resets"
      .replace(/[:\s]+$/,"");
    if(s.length > 3 && s === s.toUpperCase() && /[A-Z]/.test(s))   // SHOUTING HEADINGS -> Title Case (short acronyms stay)
      s = s.toLowerCase().replace(/\b([a-z])([a-z]*)\b/g, (m,a,b)=> m.length<=3 && /^(ad|vpn|ip|id|pc|it|sso|mfa|dns|vm|os|hr|qa|kb|sla|sop|tl|ivr|ehr|cob|edi|npi|icd|cpt)$/.test(m) ? m.toUpperCase() : (/^(and|or|of|the|a|an|to|in|on|for|with|at|by)$/.test(m) ? m : a.toUpperCase()+b));
    return s.slice(0,140);
  }
  function sentences(text){
    let t = " " + String(text||"");
    t = t.replace(/\b(e\.g|i\.e|etc|vs|approx|incl|no|fig|inc|ltd)\./gi, m=> m.slice(0,-1)+"\u0001").replace(/(\w)\.(?=\w)/g,"$1\u0001");
    const out = [], re = /[^.!?]*[.!?]+(?=\s|$)|[^.!?]+$/g; let m;
    while((m = re.exec(t))){ const s = m[0].replace(/\u0001/g,".").trim(); if(s) out.push(s); }
    return out;
  }
  function cap1(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
  function endPunct(s){ s = String(s||"").trim(); return s && !/[.!?…]$/.test(s) ? s + "." : s; }

  /* ---------- HTML (from mammoth) → block list ---------- */
  function wrap(mark, s){
    const t = s.trim(); if(!t || /\*/.test(t)) return s;           // empty, or already formatted inside: don't nest
    return s.match(/^\s*/)[0] + mark + t + mark + s.match(/\s*$/)[0];
  }
  function inline(node, ctx){
    let out = "";
    node.childNodes.forEach(n=>{
      if(n.nodeType === 3){ out += cleanText(n.nodeValue); return; }
      if(n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if(tag === "img"){ const m = /^kbimg:(\d+)$/.exec(n.getAttribute("src")||""); if(m) ctx.imgs.push({idx:Number(m[1]), alt:cleanText(n.getAttribute("alt")||"").trim()}); return; }
      if(tag === "br"){ out += " "; return; }
      if(tag === "ul" || tag === "ol" || tag === "table") return;       // block-level, handled by the block walker
      const inner = inline(n, ctx);
      if(tag === "strong" || tag === "b") out += wrap("**", inner);
      else if(tag === "em" || tag === "i") out += wrap("*", inner);
      else if(tag === "a"){
        const href = (n.getAttribute("href")||"").trim(), label = inner.replace(/[\[\]]/g,"");
        out += (/^(https?:\/\/|mailto:)/i.test(href) && label.trim() && !/[()\s]/.test(href)) ? `[${label}](${href})` : inner;
      }
      else if(tag === "p" || tag === "div") out += inner + " ";
      else out += inner;
    });
    return out;
  }
  function copyables(md){
    if(/\]\(/.test(md) || /`/.test(md)) return md;                       // never touch links / already-marked text
    return md.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, m=>"`"+m+"`")
             .replace(/(?:\+?\d{1,2}[\s.-])?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g, m=>"`"+m.trim()+"`");
  }
  function listOf(el, ctx){
    const items = [];
    Array.from(el.children).forEach(li=>{
      if(li.tagName.toLowerCase() !== "li") return;
      const c = {imgs:[]}, md = copyables(inline(li, c).trim()), kids = [];
      Array.from(li.children).forEach(sub=>{ const t = sub.tagName.toLowerCase(); if(t==="ul"||t==="ol") kids.push({ordered:t==="ol", items:listOf(sub, ctx)}); });
      c.imgs.forEach(i=> ctx.pendingImgs.push(i));
      if(md || kids.length) items.push({md, kids});
    });
    return items;
  }
  function cellMd(cell, ctx){
    const c = {imgs:[]};
    let md = inline(cell, c).trim();
    const li = Array.from(cell.querySelectorAll("li")).map(x=>cleanText(x.textContent).trim()).filter(Boolean);
    if(li.length) md = (md ? md + ": " : "") + li.join("; ");
    c.imgs.forEach(i=> ctx.pendingImgs.push(i));
    return copyables(md.replace(/\|/g,"/"));
  }
  function walk(root, ctx, blocks){
    root.childNodes.forEach(n=>{
      if(n.nodeType === 3){ const t = cleanText(n.nodeValue).trim(); if(t) blocks.push({t:"p", md:t}); return; }
      if(n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if(/^h[1-6]$/.test(tag)){
        const text = cleanText(n.textContent).trim();
        if(text) blocks.push({t:"h", level:Number(tag[1]), text});
        n.querySelectorAll("img").forEach(im=>{ const m = /^kbimg:(\d+)$/.exec(im.getAttribute("src")||""); if(m) blocks.push({t:"img", idx:Number(m[1]), alt:""}); });
      } else if(tag === "p"){
        if(Array.from(n.querySelectorAll("a")).some(a=>/^#_?toc/i.test(a.getAttribute("href")||""))) return;      // Word table-of-contents line
        const c = {imgs:[]}, md = copyables(inline(n, c).trim());
        if(md) blocks.push({t:"p", md});
        c.imgs.forEach(i=> blocks.push({t:"img", idx:i.idx, alt:i.alt}));
      } else if(tag === "ul" || tag === "ol"){
        ctx.pendingImgs = [];
        const items = listOf(n, ctx);
        if(items.length) blocks.push({t:"list", ordered:tag==="ol", items});
        ctx.pendingImgs.forEach(i=> blocks.push({t:"img", idx:i.idx, alt:i.alt})); ctx.pendingImgs = [];
      } else if(tag === "table"){
        ctx.pendingImgs = [];
        const rows = Array.from(n.querySelectorAll("tr")).filter(tr=> tr.closest("table")===n)
          .map(tr=> Array.from(tr.children).filter(x=>/^t[dh]$/i.test(x.tagName)).map(cell=>cellMd(cell, ctx)));
        const clean = rows.filter(r=> r.some(x=>x.trim()));
        if(clean.length) blocks.push({t:"table", rows:clean});
        ctx.pendingImgs.forEach(i=> blocks.push({t:"img", idx:i.idx, alt:i.alt})); ctx.pendingImgs = [];
      } else if(tag === "img"){
        const m = /^kbimg:(\d+)$/.exec(n.getAttribute("src")||""); if(m) blocks.push({t:"img", idx:Number(m[1]), alt:cleanText(n.getAttribute("alt")||"").trim()});
      } else if(tag === "div" || tag === "section" || tag === "blockquote" || tag === "body"){
        walk(n, ctx, blocks);
      } else {
        const c = {imgs:[]}, md = copyables(inline(n, c).trim()); if(md) blocks.push({t:"p", md});
      }
    });
  }
  function htmlToBlocks(html){
    const doc = new DOMParser().parseFromString("<body>"+html+"</body>", "text/html");
    const blocks = []; walk(doc.body, {pendingImgs:[]}, blocks);
    return blocks;
  }

  /* ---------- plain text / markdown → blocks ---------- */
  function textToBlocks(text){
    const lines = String(text||"").replace(/\r/g,"").split("\n"), blocks = [];
    let para = [], list = null;
    const flushPara = ()=>{ if(para.length){ blocks.push({t:"p", md:copyables(cleanText(para.join(" ")).trim())}); para = []; } };
    const flushList = ()=>{ if(list){ blocks.push(list); list = null; } };
    lines.forEach(raw=>{
      const ln = raw.replace(/\s+$/,""); let m;
      if(!ln.trim()){ flushPara(); flushList(); return; }
      if((m = ln.match(/^(#{1,6})\s+(.*)$/))){ flushPara(); flushList(); blocks.push({t:"h", level:m[1].length, text:cleanText(m[2].replace(/[#*_`]+/g,"")).trim()}); return; }
      if(/^\s*(?:\d+(?:\.\d+)*[.)]?\s+)?[A-Z0-9 &\/,()-]{4,70}$/.test(ln) && /[A-Z]{3}/.test(ln)){ flushPara(); flushList(); blocks.push({t:"p", md:cleanText(ln).trim()}); return; }   // CAPS / numbered CAPS line: its own block so heading detection can see it
      if((m = ln.match(/^\s*(?:[-*•▪●◦]|\d+[.)])\s+(.*)$/)) && !(/^\s*\d/.test(ln) && /^[A-Z0-9 &\/,()-]{4,70}$/.test(m[1]) && /[A-Z]{3}/.test(m[1]))){   // "1. PURPOSE" is a heading, not a step
        flushPara(); const ordered = /^\s*\d+[.)]/.test(ln);
        if(list && list.ordered !== ordered) flushList();
        if(!list) list = {t:"list", ordered, items:[]};
        list.items.push({md:copyables(cleanText(m[1]).trim()), kids:[]}); return;
      }
      if(list && /^\s{2,}\S/.test(raw) && list.items.length){ list.items[list.items.length-1].md += " " + cleanText(ln).trim(); return; }   // wrapped list line
      flushList(); para.push(ln.trim());
    });
    flushPara(); flushList();
    return blocks;
  }

  /* ---------- tidy the block list ---------- */
  // Word users often number/bullet by hand ("1. Open…" as separate paragraphs) — turn runs of those into real lists.
  function normalizeBlocks(blocks){
    const out = []; let cur = null;
    blocks.forEach(b=>{
      let m;
      if(b.t === "p" && (m = b.md.match(/^(?:(\d{1,2})[.)]|([-*•▪●◦]))\s+(\S.*)$/)) && b.md.length < 400){
        const ordered = !!m[1];
        if(cur && cur.ordered === ordered) cur.items.push({md:m[3], kids:[]});
        else { cur = {t:"list", ordered, items:[{md:m[3], kids:[]}]}; out.push(cur); }
        return;
      }
      cur = null;
      out.push(b);
    });
    return out;
  }
  // If the document has no real headings, guess them (bold-only line / ALL CAPS line / "1.2 Title" line).
  function inferHeadings(blocks){
    if(blocks.some(b=>b.t==="h")) return {blocks, inferred:false};
    const strategies = [
      b=> { const m = b.t==="p" && b.md.match(/^\*\*([^*]{3,80})\*\*:?$/); return m ? {level:1, text:m[1]} : null; },
      b=> { const s = b.t==="p" ? plain(b.md) : ""; return s && s.length>=4 && s.length<=70 && s===s.toUpperCase() && /[A-Z]{3}/.test(s) && !/[.:;]$/.test(s) ? {level:1, text:s} : null; },
      b=> { const m = b.t==="p" && b.md.match(/^(\d+(?:\.\d+){0,3})[.)]?\s+([A-Z][^.!?:]{2,80})$/); return m ? {level:m[1].split(".").length, text:m[2]} : null; }
    ];
    for(const [si, pick] of strategies.entries()){
      const out = []; let heads = 0, textLen = 0;
      blocks.forEach(b=>{ const h = pick(b); if(h){ out.push({t:"h", level:h.level, text:h.text}); heads++; } else { out.push(b); textLen += b.t==="p" ? b.md.length : 40; } });
      if(heads >= 2 && textLen/heads >= (si===2 ? 120 : 40)) return {blocks:out, inferred:true};
    }
    return {blocks, inferred:false};
  }

  /* ---------- heading tree ---------- */
  function buildTree(blocks){
    const root = {level:0, title:"", content:[], children:[]}, stack = [root];
    blocks.forEach(b=>{
      if(b.t === "h"){
        while(stack.length > 1 && stack[stack.length-1].level >= b.level) stack.pop();
        const node = {level:b.level, title:b.text, content:[], children:[]};
        stack[stack.length-1].children.push(node); stack.push(node);
      } else stack[stack.length-1].content.push(b);
    });
    return root;
  }
  const blockLen = b=> b.t==="p" ? plain(b.md).length : b.t==="list" ? b.items.reduce((n,i)=>n+plain(i.md).length+i.kids.reduce((k,s)=>k+s.items.reduce((q,x)=>q+plain(x.md).length,0),0),0) : b.t==="table" ? b.rows.flat().join(" ").length : 0;
  const nodeLen = n=> n.content.reduce((a,b)=>a+blockLen(b),0) + n.children.reduce((a,c)=>a+nodeLen(c),0);

  /* ---------- callouts ---------- */
  function calloutOf(md){
    let m;
    if((m = md.match(/^\**\s*(note|notes|nb|n\.b\.|fyi|remember)\s*\**\s*[:\-–—]\s*\**\s*(.+)$/i))) return {kind:"note", text:m[2]};
    if((m = md.match(/^\**\s*(tip|pro tip|hint|best practice)\s*\**\s*[:\-–—]\s*\**\s*(.+)$/i))) return {kind:"tip", text:m[2]};
    if((m = md.match(/^\**\s*(warning|important|caution|critical|attention|alert|danger)\s*\**\s*[:\-–—!]\s*\**\s*(.+)$/i))) return {kind:"warn", text:m[2]};
    if(md.length <= 240 && /^(do not|don't|never)\b/i.test(plain(md)) ) return {kind:"warn", text:md};
    return null;
  }

  /* ---------- render blocks → KB markdown ---------- */
  function renderList(list, lines){
    list.items.forEach((it,i)=>{
      lines.push(list.ordered ? `${i+1}. ${it.md}` : `- ${it.md}`);
      it.kids.forEach(k=> k.items.forEach(s=> lines.push(`   - ${!list.ordered ? "↳ " : ""}${s.md}`)));
    });
  }
  function renderTable(rows){
    const w = Math.max.apply(null, rows.map(r=>r.length));
    if(w < 2){ return rows.map(r=>"- "+(r[0]||"")).join("\n"); }
    const pad = r=> r.concat(Array(w-r.length).fill("")), row = r=> "| " + pad(r).map(c=>c||" ").join(" | ") + " |";
    return [row(rows[0]), "|" + Array(w).fill("---").join("|") + "|"].concat(rows.slice(1).map(row)).join("\n");
  }
  function renderBlocks(blocks, ctx){
    const out = [];
    blocks.forEach(b=>{
      if(b.skip) return;
      if(b.t === "p"){
        const co = calloutOf(b.md);
        if(co) out.push((co.kind==="warn" ? ">! " : co.kind==="tip" ? ">+ " : "> ") + co.text);
        else out.push(/^(#{1,3}\s|>|---+\s*$|\||!\[\d+\])/.test(b.md) ? "​"+b.md : b.md);
      } else if(b.t === "list"){ const l = []; renderList(b, l); out.push(l.join("\n")); }
      else if(b.t === "table") out.push(renderTable(b.rows));
      else if(b.t === "img"){
        let n = ctx.imgRefs.findIndex(r=>r.idx===b.idx);
        if(n < 0){ ctx.imgRefs.push({idx:b.idx, caption:(b.alt||"").slice(0,80)}); n = ctx.imgRefs.length-1; }
        out.push(`![${n+1}]`);
      }
    });
    return out;
  }
  function renderNode(node, depth, ctx){
    const out = renderBlocks(node.content, ctx);
    node.children.forEach(ch=>{
      const inner = renderNode(ch, depth+1, ctx);
      out.push("#".repeat(Math.min(depth+1,3)) + " " + cleanTitle(ch.title)); inner.forEach(x=>out.push(x));
    });
    return out;
  }

  /* ---------- quick answer ---------- */
  function scoreSentence(s, i){
    let sc = i===0 ? 3 : i===1 ? 1 : 0;
    if(DIRECTIVE_RE.test(s)) sc += 2;
    if(/\d/.test(s)) sc += 1;
    if(s.length >= 30 && s.length <= 220) sc += 1;
    if(META_RE.test(s)) sc -= 6;
    return sc;
  }
  function pickSentences(text, max){
    const all = sentences(text).map(s=>s.trim()).filter(Boolean);
    const cand = all.map((s,i)=>({s, i, sc:scoreSentence(s,i)})).filter(x=>x.sc > -3);
    if(!cand.length) return {text:"", full:false};
    cand.sort((a,b)=> b.sc-a.sc || a.i-b.i);
    const chosen = []; let len = 0;
    for(const c of cand){
      if(chosen.length >= 2) break;
      if(len + c.s.length + (len?1:0) > max && chosen.length) continue;
      chosen.push(c); len += c.s.length + 1;
    }
    chosen.sort((a,b)=>a.i-b.i);
    const textOut = chosen.map(c=>c.s).join(" ");
    return {text: textOut, full: chosen.length === all.length};
  }
  function stepsQuickAnswer(list){
    const take = list.items.slice(0,3).map(it=>{
      const first = sentences(plain(it.md))[0] || plain(it.md);
      return clip(first.replace(/[.:;]+$/,""), 80);
    }).filter(Boolean);
    if(!take.length) return "";
    return "Short version: " + take.join(list.ordered ? " → " : "; ") + (list.items.length > 3 ? " …" : "");
  }
  function makeQuickAnswer(node){
    // 1) lead paragraph(s) before the first list/table/subheading
    let lead = null;
    for(const b of node.content){
      if(b.t !== "p") break;
      const p = plain(b.md);
      if(calloutOf(b.md)) continue;
      if(p.length >= 40 && !/:$/.test(p)){ lead = b; break; }
    }
    if(lead){
      const r = pickSentences(plain(lead.md), 300);
      if(r.text && !META_RE.test(r.text)) return {text:clip(r.text,320), note:"", dropBlock: (r.full && plain(lead.md).length<=320) ? lead : null};
    }
    // 2) a "Purpose / Summary / Overview" child section
    for(const ch of node.children){
      if(LEAD_TITLE_RE.test(cleanTitle(ch.title))){
        const p = ch.content.find(b=>b.t==="p" && plain(b.md).length>=30);
        if(p){ const r = pickSentences(plain(p.md), 300); if(r.text && !META_RE.test(r.text)) return {text:clip(r.text,320), note:"", dropBlock:null}; }
      }
    }
    // 3) steps / bullets
    const list = node.content.find(b=>b.t==="list") || (node.children.map(c=>c.content.find(b=>b.t==="list")).find(Boolean));
    if(list){ const t = stepsQuickAnswer(list); if(t) return {text:t, note:"Built from the steps — check it reads as a real answer.", dropBlock:null}; }
    // 4) any paragraph (even a "This section describes…" one) / table
    const anyP = node.content.find(b=>b.t==="p" && plain(b.md).length>=20 && !calloutOf(b.md));
    if(anyP){ const r = pickSentences(plain(anyP.md), 300); const t = r.text || sentences(plain(anyP.md))[0]; if(t) return {text:clip(t,320), note:"Taken from the section's first sentence — check it.", dropBlock:null}; }
    return {text:"", note:"No clear summary found — please write the quick answer.", dropBlock:null};
  }

  /* ---------- tags ---------- */
  function makeTags(title, category, md){
    const text = plain(md), tags = [], seen = new Set();
    const add = (t, keepCase)=>{ t = String(t||"").trim(); const k = t.toLowerCase(); if(t.length>=2 && t.length<=32 && !seen.has(k) && !STOP.has(k)){ seen.add(k); tags.push(keepCase ? t : k); } };
    cleanTitle(title).toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3 && !STOP.has(w)).forEach(w=>add(w));
    (text.match(/\b[A-Z]{1,4}-\d{1,4}\b/g)||[]).slice(0,5).forEach(c=>add(c, true));                       // codes: CO-29
    (text.match(/\b[A-Z]{2,6}\b(?![-\w])/g)||[]).filter(a=>!/^(THE|AND|FOR|NOT|YES|PDF|TBD|ID|OK|NA)$/.test(a)).forEach(a=>add(a, true));   // acronyms: AD, VPN, NPI
    (md.match(/\*\*([^*]{3,30})\*\*/g)||[]).slice(0,6).forEach(b=>{ const t = b.replace(/\*/g,"").replace(/[:.]$/,"").trim(); if(t.split(" ").length<=3) add(t.toLowerCase()); });
    const freq = {}; text.toLowerCase().split(/[^a-z0-9]+/).forEach(w=>{ if(w.length>=5 && !STOP.has(w) && !/^\d+$/.test(w)) freq[w] = (freq[w]||0)+1; });
    Object.keys(freq).filter(w=>freq[w]>=3).sort((a,b)=>freq[b]-freq[a]).slice(0,4).forEach(w=>add(w));
    return tags.slice(0,12);
  }

  /* ---------- article assembly ---------- */
  function makeArticle(node, category, opts){
    opts = opts || {};
    const title = cleanTitle(opts.title || node.title) || "Untitled topic";
    const qa = makeQuickAnswer(node);
    if(qa.dropBlock) qa.dropBlock.skip = true;
    const ctx = {imgRefs:[]};
    const body = renderNode(node, 1, ctx).join("\n\n").trim();
    if(qa.dropBlock) qa.dropBlock.skip = false;
    const summary = qa.text;
    const textLen = plain(body).length + summary.length;
    const warnings = [];
    if(!summary) warnings.push(qa.note);
    else if(qa.note) warnings.push(qa.note);
    let include = true, reason = "";
    if(ADMIN_RE.test(title)){ include = false; reason = "Looks like document admin (not something agents look up)."; }
    else if(INTRO_RE.test(title)){ include = false; reason = "General document intro — turn on if you want it as an article."; }
    else if(textLen < 80 && !ctx.imgRefs.length){ include = false; reason = "Very short — probably not a standalone article."; }
    return {key:"", title, category:cleanTitle(category||""), summary, summaryNote:qa.note, body, tags:makeTags(title, category, summary+" "+body), imgRefs:ctx.imgRefs,
      include, reason, warnings, hash:hashStr(summary+"\u0001"+body), textLen};
  }
  function collectArticles(root, docTitle){
    const list = [];
    const substantial = n => n.content.reduce((a,b)=>a+blockLen(b),0) >= 250;
    const rootCat = cleanTitle(String(docTitle||"").replace(/\s*[-–—:|]?\s*(standard operating procedures?|sops?|procedures?|work instructions?)\s*$/i,"")) || cleanTitle(docTitle) || "";
    if(substantial(root)){
      list.push(makeArticle({title:"Overview", content:root.content, children:[]}, rootCat, {title: docTitle ? "Overview — "+cleanTitle(docTitle) : "Overview"}));
    }
    root.children.forEach(top=>{
      const kids = top.children;
      if(kids.length >= 2){
        const cat = GENERIC_CAT_RE.test(cleanTitle(top.title)) ? (rootCat || cleanTitle(top.title)) : cleanTitle(top.title);
        if(substantial(top)) list.push(makeArticle({title:top.title, content:top.content, children:[]}, cat, {title:cat}));
        kids.forEach(k=>{
          if(k.children.length >= 2 && !substantial(k) && k.children.every(g=>g.children.length===0)){   // a 3-level doc: sub-sub-headings become the articles
            const sub = cleanTitle(k.title);
            k.children.forEach(g=> list.push(makeArticle(g, cat + " › " + sub)));
          } else list.push(makeArticle(k, cat));
        });
      } else list.push(makeArticle(top, rootCat));
    });
    return list;
  }
  function finish(articles, notes){
    const seen = {};
    articles.forEach((a,i)=>{
      const n = normTitle(a.title); seen[n] = (seen[n]||0)+1;
      if(seen[n] > 1) a.title = clip(a.title + (a.category ? " ("+a.category+")" : " ("+seen[n]+")"), 140);
      a.key = "s"+i+"_"+hashStr(normTitle(a.title));
    });
    return articles;
  }

  /* ---------- public API ---------- */
  function analyzeBlocks(blocks, meta){
    meta = Object.assign({}, meta || {});
    if(meta.fileTitle) meta.fileTitle = String(meta.fileTitle).replace(/[_-]+/g," ").replace(/\s+(sop|v?\d+(\.\d+)*)$/i,"").trim();
    const notes = [];
    const inf = inferHeadings(blocks); blocks = normalizeBlocks(inf.blocks);
    if(inf.inferred) notes.push("This document has no Word heading styles, so section titles were guessed from bold / CAPS / numbered lines. Check the topics below — for best results format section titles as Heading 1 / Heading 2 in Word.");
    const root = buildTree(blocks);
    let docTitle = meta.title || "", top = root, titleFound = false;
    // a leading, empty title heading ("Password SOP" above "1. Purpose", "2. Scope"…) is the document title, not a topic
    const first = top.children[0];
    if(first && top.content.length===0 && first.content.length===0 && first.children.length===0 && top.children.length>=3){ docTitle = first.title; titleFound = true; top.children.shift(); }
    // a single wrapping heading (Title style → everything else nested under it) is the document title too
    for(let i=0;i<2;i++){
      if(top.children.length===1 && top.children[0].children.length>=1 && top.content.reduce((a,b)=>a+blockLen(b),0) < 250){
        if(!titleFound){ docTitle = top.children[0].title; titleFound = true; }
        top = top.children[0];
      }
    }
    let articles;
    if(!top.children.length){
      articles = [makeArticle({title:cleanTitle(docTitle)||cleanTitle(meta.fileTitle)||"Imported document", content:top.content, children:[]}, "")];
      notes.push("No headings were found, so the whole document became one article. Use Heading 1 / Heading 2 in Word for each topic and re-upload to split it automatically.");
    } else articles = collectArticles(top, docTitle || cleanTitle(meta.fileTitle));
    finish(articles, notes);
    const noQa = articles.filter(a=>a.include && !a.summary).length;
    if(noQa) notes.push(`${noQa} article${noQa===1?"":"s"} had no clear summary sentence — write the quick answer for ${noQa===1?"it":"them"} before publishing.`);
    return {docTitle:cleanTitle(docTitle || meta.fileTitle || ""), notes, articles};
  }
  function fromHtml(html, meta){ return analyzeBlocks(htmlToBlocks(html), meta); }
  function fromText(text, meta){ return analyzeBlocks(textToBlocks(text), meta); }

  return {fromHtml, fromText, sentences, plain, hashStr, normTitle, cleanTitle, clip, calloutOf};
})();
if(typeof globalThis !== "undefined") globalThis.kbAi = kbAi;
