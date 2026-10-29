// builds a realistic state, relative to today
module.exports=function(w){
 const d=new Date(),pad=n=>String(n).padStart(2,'0');
 const iso=x=>x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate());
 const roster=[
  ['E001','Priya Sharma','Anita','Claims'],['E002','Rahul Verma','Anita','Claims'],['E003','Neha Singh','Anita','Eligibility'],['E004','Priya Nair','Anita','Claims'],
  ['E005','Amit Joshi','Meera','Claims'],['E006','Sana Khan','Meera','UM Intake'],['E007','Vikram Rao','Meera','Eligibility'],['E008','Divya Iyer','Meera','Claims']
 ].map(([empId,name,tlName,lob])=>({empId,name,tlName,lob,status:'Active',joiningDate:'2025-01-10',shiftStart:'09:00',shiftEnd:'18:00',break1Start:'11:00',break1End:'11:15',break2Start:'15:30',break2End:'15:45',lunchStart:'13:00',lunchEnd:'13:30',notes:'SECRET-NOTE-'+empId}));
 const daily={};
 roster.forEach((a,i)=>{
  for(let k=0;k<45;k++){ const x=new Date(d); x.setDate(d.getDate()-k); const wd=x.getDay(); const key=a.empId+'__'+iso(x);
   if(wd===0||wd===6) continue;
   if(k%11===3&&i%2===0){daily[key]={attendance:'Leave',leaveType:'SL'};continue;}
   daily[key]={attendance:'Present',leaveType:'',aht:500+i*20+(k%5)*5,cq:95-i*2,pkt:90-i,calls:50+i};
  }});
 const users=[
  {id:'u1',role:'admin',name:'Admin',username:'admin',passwordHash:'H-ADMIN-SECRET',passwordSalt:'s',securityAHash:'SECA-SECRET'},
  {id:'u2',role:'wfm',name:'Wanda WFM',username:'wfm'},
  {id:'u3',role:'tl',name:'Anita',username:'anita',tlName:'Anita',viewAll:false},
  {id:'u4',role:'tl',name:'Meera',username:'meera',tlName:'Meera',viewAll:false},
  {id:'u5',role:'sme',name:'Sam SME',username:'sam',tlName:'Anita'},
  {id:'u6',role:'trainer',name:'Tara Trainer',username:'tara'},
  {id:'u7',role:'client',name:'Cleo Client',username:'cleo'},
  {id:'u8',role:'quality',name:'Quinn Quality',username:'quinn'},
  {id:'u9',role:'manager',name:'Mo Manager',username:'mo'}];
 const qa=[]; roster.forEach((a,i)=>{ for(let j=0;j<2;j++){ const params={}; params[3]={tag:i%2?'No':'Yes',error:'Missed verification'}; qa.push({id:'q'+i+j,agentEmpId:a.empId,agentName:a.name,callId:'C'+i+j,auditDate:iso(new Date(d.getTime()-j*86400000*3)),auditorName:'Quinn Quality',auditorUsername:'quinn',ztp:i===5&&j===0?'Not Met':'Met',score:0.95-i*0.03,lob:a.lob,params,supervisor:a.tlName}); }});
 const dueDate=iso(new Date(d.getTime()+5*86400000));
 return {
  settings:Object.assign({},JSON.parse(w.eval("JSON.stringify(state.settings)")),{users,tls:['Anita','Meera'],leoSupervisors:['anita']}),
  roster,daily,qaAudits:qa,
  pkts:[{id:'p1',title:'Weekly PKT 1',lob:'',status:'live',dueDate,passMark:80,questions:[{id:'x',text:'Q SECRET QUESTION',correctId:'o1',options:[{id:'o1',text:'ANSWER-KEY'}]}],createdAt:iso(d)}],
  pktAttempts:[{id:'p1__E001',pktId:'p1',empId:'E001',agentName:'Priya Sharma',status:'submitted',score:92,passed:true},{id:'p1__E002',pktId:'p1',empId:'E002',agentName:'Rahul Verma',status:'submitted',score:60,passed:false}],
  leoCalls:[
   {id:'l1',reason:'Claim denial',refNumber:'R1',callbackAt:iso(new Date(d.getTime()-86400000))+'T10:00',lob:'Claims',status:'open',supStatus:'new',createdByEmpId:'E001',createdByName:'Priya Sharma',createdAt:iso(d),assignedTo:'Anita',assignedToUsername:'anita'},
   {id:'l2',reason:'Appeal/Dispute',refNumber:'R2',callbackAt:iso(d)+'T18:00',lob:'Claims',status:'open',supStatus:'new',createdByEmpId:'E005',createdByName:'Amit Joshi',createdAt:iso(d),assignedTo:'Meera',assignedToUsername:'meera'}],
  kbArticles:[
   {id:'k1',title:'Handling a claim denial call',lob:'Claims',category:'Claims',summary:'Verify the member, check the denial code, then offer the appeal process.',body:'Step one verify the member. Step two read the denial code.',tags:['denial','appeal'],status:'published',updatedAt:iso(d)},
   {id:'k2',title:'Eligibility check steps',lob:'Eligibility',category:'Eligibility',summary:'Confirm coverage dates in the portal.',body:'Open portal and confirm coverage.',tags:['coverage'],status:'published',updatedAt:iso(d)},
   {id:'k3',title:'General greeting script',lob:'',category:'General',summary:'Use the standard greeting.',body:'Hello thank you for contacting',tags:['greeting'],status:'published',updatedAt:iso(d)},
   {id:'k4',title:'Draft denial secret',lob:'',category:'x',summary:'DRAFT-ONLY',body:'',tags:[],status:'draft'}],
  processUpdates:[{id:'u1',lob:'Claims',title:'Claims denial code change',message:'New denial code 45 applies',postedBy:'Tara',postedAt:iso(d)},{id:'u2',lob:'Eligibility',title:'Eligibility portal downtime',message:'Portal down Friday',postedBy:'Tara',postedAt:iso(d)}],
  documentationTemplates:[{id:'d1',lob:'Claims',title:'Denial appeal template',subtitle:'Email',bodyText:'Dear provider appeal text',isEmail:true,postedAt:iso(d)},{id:'d2',lob:'Eligibility',title:'Coverage template',bodyText:'coverage text',postedAt:iso(d)}],
  dailySummaryData:[{id:'s1',date:iso(new Date(d.getTime()-86400000)),lob:'Claims',values:{serviceLevel:88,offered:100,handled:95,abandoned:4,occupancy:80}}],
  shiftSwaps:[{id:'w1',requesterEmpId:'E001',recipientEmpId:'E002',date:iso(d),status:'pending',requestedAt:iso(d)},{id:'w2',requesterEmpId:'E005',recipientEmpId:'E006',date:iso(d),status:'pending',requestedAt:iso(d)}],
  auditLog:[{id:'a1',at:new Date().toISOString(),actorName:'Admin',actorRole:'Admin',action:'roster edit',summary:'edited'}],
  history:[],ipaDirectory:[{id:'i1',name:'IPA One',phone:'123'}],kbFeedback:[]
 };
};
