const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path');
const SRC=process.env.SRC||'/tmp/claude-0/-home-claude/a7653f9c-6bf5-56cd-8969-42219c620dfb/scratchpad/src/align360-quality-audit-v9';
async function boot(){
  let html=fs.readFileSync(path.join(SRC,'index.html'),'utf8');
  const scripts=[...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m=>m[1].replace(/\?.*$/,''));
  html=html.replace(/<script[^>]*><\/script>/g,'').replace(/<link[^>]*>/g,'');
  const dom=new JSDOM(html,{runScripts:'dangerously',url:'http://localhost/',pretendToBeVisual:true});
  const w=dom.window; w.fetchCalls=0; w.fetch=()=>{w.fetchCalls++;return Promise.reject(new Error('net'))};
  w.XMLHttpRequest=function(){w.fetchCalls++;throw new Error('net')};
  w.matchMedia=w.matchMedia||(()=>({matches:false,addEventListener(){}}));
  w.HTMLElement.prototype.scrollIntoView=function(){};
  w.console.error=()=>{};
  for(const s of scripts){ if(s.includes('vendor'))continue; const e=w.document.createElement('script'); e.textContent=fs.readFileSync(path.join(SRC,s),'utf8'); w.document.body.appendChild(e); }
  await new Promise(r=>setTimeout(r,600));
  return w;
}
module.exports={boot};
