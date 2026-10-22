const {boot}=require('./harness'),fixture=require('./fixture');
const flat=r=>r.blocks.map(b=>b.t==='table'?b.rows.map(x=>x.map(c=>c&&c.text!==undefined?c.text:c).join('|')).join('\n'):b.t==='cards'?b.items.map(i=>i.title+' '+(i.text||'')).join('\n'):b.t==='stat'?b.label+' '+b.value:b.t==='list'?b.items.join('\n'):b.text).join('\n')+'\n'+(r.chips||[]).map(c=>c.label).join('|');
const U={
 agent:{role:'agent',empId:'E001',name:'Priya Sharma'},
 tl:{role:'tl',username:'anita',name:'Anita',tlName:'Anita',viewAll:false},
 sme:{role:'sme',username:'sam',name:'Sam SME',tlName:'Anita'},
 tlAll:{role:'tl',username:'anita',name:'Anita',tlName:'Anita',viewAll:true},
 quality:{role:'quality',username:'quinn',name:'Quinn Quality'}};
const OTHERS_FOR_AGENT=['Rahul','Verma','Neha','Singh','Nair','Amit','Joshi','Sana','Khan','Vikram','Divya','Iyer','E002','E003','E005','Meera','Anita'.replace('Anita','ZZZ')];
const OUT_OF_TEAM=['Amit','Joshi','Sana','Khan','Vikram','Rao','Divya','Iyer','E005','E006','E007','E008','Meera'];
const agentQs=["what's Rahul's AHT","rahul aht","aht of rahul verma","show E002 performance","compare me with Rahul","everyone's aht","who is the best agent","am I better than others","my teammates leave","AHT of zzzz","show all agents","how many leave did Neha take","shift of E005","ranking by aht","how is my team","audit score of Neha","who has the lowest cq","list my colleagues","compare priya nair and me","pkt score of amit joshi","sup calls of Amit","what is divya's lunch time","who is on leave","how many agents are in claims","tell me about vikram","is sana on leave today","team cq this month","top performers","aht for rahul last month","who works with me","and rahul?","what about neha"];
const tlQs=["aht of Amit Joshi","Sana Khan shift","E005 performance","Meera's team AHT","all teams AHT","list all agents","audit score of Divya","sup calls of Amit","who is in Meera team","how many agents in um intake","top 10 by aht","who is at risk","lowest audit scores","who hasn't taken the pkt","open sup calls","pending swaps","eligibility team performance","show vikram rao"];
(async()=>{
 const w=await boot(); w.eval("window.AllyEngine=AllyEngine");
 w.eval('state=Object.assign(state,('+JSON.stringify(fixture(w))+'))');
 let bad=0;
 async function run(u,qs,forbid,label){ w.eval('currentUser='+JSON.stringify(u)); let mem=null;
  for(const q of qs){ const r=await w.AllyEngine.ask(q,mem); mem=r.mem; const t=flat(r);
   forbid.forEach(f=>{ if(!new RegExp('\\b'+f+'\\b','i').test(q) && new RegExp('\\b'+f+'\\b','i').test(t)){bad++;console.log('LEAK['+label+'] "'+q+'" shows '+f+'\n   '+t.split('\n').slice(0,4).join('\n   '));} }); } }
 await run(U.agent,agentQs,OTHERS_FOR_AGENT,'agent');
 await run(U.tl,tlQs,OUT_OF_TEAM,'tl');
 await run(U.sme,tlQs,OUT_OF_TEAM,'sme');
 // team-reach LEO scoping
 for(const k of ['tl','sme']){ w.eval('currentUser='+JSON.stringify(U[k])); const t=flat(await w.AllyEngine.ask('open sup calls',null)); console.log(k,'LEO ->',t.split('\n').slice(0,4).join(' / ')); if(/R2|Amit/.test(t)){bad++;console.log('LEAK LEO',k);} }
 // agent sees only own LEO
 w.eval('currentUser='+JSON.stringify(U.agent)); console.log('agent LEO ->',flat(await w.AllyEngine.ask('my sup calls',null)).split('\n').slice(0,4).join(' / '));
 // quality sees no agent KPI / roster
 w.eval('currentUser='+JSON.stringify(U.quality)); for(const q of['aht of rahul','list agents','shift of priya']){const t=flat(await w.AllyEngine.ask(q,null)); if(/Rahul|Priya Sharma/.test(t)&&!/couldn/.test(t)){bad++;console.log('LEAK quality',q,t);} }
 // KB scoping: agent E001 (Claims) must not get Eligibility articles; never drafts
 w.eval('currentUser='+JSON.stringify(U.agent)); for(const q of['eligibility check steps coverage','draft denial secret','coverage template','portal downtime']){const t=flat(await w.AllyEngine.ask(q,null)); console.log('agent kb',q,'->',t.split('\n')[0].slice(0,90)); if(/Eligibility check|DRAFT|Coverage template|Portal downtime/i.test(t.split(q).join('').replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),''))){bad++;console.log('LEAK LOB scope',q);} }
 console.log('\nBAD:',bad,'net:',w.fetchCalls); process.exit(0);
})();
