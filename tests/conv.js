const {boot}=require('./harness'),fixture=require('./fixture');
const flat=r=>r.blocks.map(b=>b.t==='table'?b.head.join('|')+'\n'+b.rows.map(x=>x.map(c=>c&&c.text!==undefined?c.text:c).join('|')).join('\n'):b.t==='cards'?b.items.map(i=>i.title+' '+(i.text||'')).join('\n'):b.t==='stat'?b.label+' '+b.value+b.unit+' '+b.sub:b.t==='list'?b.items.join('\n'):b.text).join('\n');
const users={agent:{role:'agent',empId:'E001',name:'Priya Sharma'},tl:{role:'tl',username:'anita',name:'Anita',tlName:'Anita',viewAll:false},wfm:{role:'wfm',username:'wfm',name:'Wanda WFM'}};
const [,,who,...convs]=process.argv; // convs: JSON array of strings
(async()=>{
 const w=await boot(); w.eval("window.AllyEngine=AllyEngine");
 w.eval('state=Object.assign(state,('+JSON.stringify(fixture(w))+'))');
 w.eval('currentUser='+JSON.stringify(users[who])); w.eval('currentTab="dashboard"');
 let mem=null;
 for(const q of JSON.parse(convs[0])){ const r=await w.AllyEngine.ask(q,mem); mem=r.mem; console.log('> '+q+'\n'+flat(r).split('\n').slice(0,14).map(x=>'   '+x).join('\n')+(r.chips&&r.chips.length?'\n   [chips] '+r.chips.map(c=>c.label).join(' | '):'')); }
 process.exit(0);
})();
