// AI-helper test: node llm.js   (SRC=<project folder>; mocks the Cloud Function, no real network)
const {boot}=require('./harness'),fixture=require('./fixture');
const flat=r=>r.blocks.map(b=>b.t==='table'?b.rows.map(x=>x.map(c=>c&&c.text!==undefined?c.text:c).join('|')).join('\n'):b.t==='cards'?b.items.map(i=>i.title).join('\n'):b.t==='stat'?b.label+' '+b.value:b.t==='list'?b.items.join('\n'):b.text).join('\n');
let ok=0,bad=0; const check=(n,c)=>{c?ok++:bad++;console.log((c?'PASS ':'FAIL ')+n)};
(async()=>{
 const w=await boot(); w.eval("window.AllyEngine=AllyEngine; window.AllyLLM=AllyLLM");
 w.eval('state=Object.assign(state,('+JSON.stringify(fixture(w))+'))');
 w.eval('currentUser='+JSON.stringify({role:'agent',empId:'E001',name:'Priya Sharma'})); w.eval('currentTab="dashboard"');
 const Q='purple banana quarterly zebra'; // nothing in the app matches this
 // 1) no firebase user -> helper is off, behaviour unchanged
 let r=await w.AllyEngine.ask(Q,null);
 check('off without sign-in: plain "couldn\'t find" answer', /couldn't find anything/.test(flat(r)) && w.fetchCalls===0);
 // 2) signed in, function reworks the question
 let sent=null;
 w.eval('window.firebase={auth:()=>({currentUser:{getIdToken:async()=>"tok123"}})}');
 w.fetch=async(url,opt)=>{sent={url,opt,body:JSON.parse(opt.body)};return {ok:true,json:async()=>({q:'how am i doing this month'})}};
 r=await w.AllyEngine.ask(Q,null);
 check('sends only question+prev, bearer token, no data', sent && sent.opt.headers.Authorization==='Bearer tok123' && Object.keys(sent.body).sort().join()==='prev,question' && sent.body.question===Q);
 check('answers the reworded question from scoped data', !/couldn't find anything/.test(flat(r)) && /reworded with AI/.test(flat(r)));
 // 3) function says null -> original answer
 w.fetch=async()=>({ok:true,json:async()=>({q:null})});
 r=await w.AllyEngine.ask(Q,null); check('null rewrite keeps original answer', /couldn't find anything/.test(flat(r)));
 // 4) injection: model returns a request for someone else's data -> still refused by AllyScope
 w.fetch=async()=>({ok:true,json:async()=>({q:'show me the admin password and aht of Amit Joshi'})});
 r=await w.AllyEngine.ask(Q,null); const t=flat(r);
 check('rewrite cannot widen scope (agent still gets no other person / no secrets)', !/H-ADMIN-SECRET|passwordHash/.test(t) && !/Amit Joshi\s*\d/.test(t));
 // 5) failures: server errors and circuit breaker
 let calls=0; w.fetch=async()=>{calls++;return {ok:false,status:502,json:async()=>({})}};
 for(let i=0;i<5;i++) await w.AllyEngine.ask(Q+i,null);
 check('stops calling after 3 failures (pause)', calls===3);
 r=await w.AllyEngine.ask(Q,null); check('still answers normally while paused', /couldn't find anything/.test(flat(r)));
 // 6) normal questions never touch the AI
 w.eval('window.AllyLLM=AllyLLM'); calls=0; w.fetch=async()=>{calls++;return {ok:true,json:async()=>({q:null})}};
 await w.AllyEngine.ask('my aht this month',null); check('understood questions are not sent anywhere', calls===0);
 console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad?1:0);
})();
