/* ---------------- Quality Audit ----------------
   Replaces the manual "AHC Calibration Form" Excel workbook (CalibForm + Proposed Rubric +
   DUMP tabs + the Submit macro). Same rubric, same scoring, same DUMP columns — but the
   audits now live in the app (synced to everyone), instead of one person's .xlsm file.

   How the workbook maps to this tab:
     CalibForm tab        -> "New audit"  (19 parameters, Yes/No/N/A tagging, per-parameter Error
                             Category list, Notes, Zero Tolerance, Call Summary)
     Proposed Rubric tab  -> "Rubric"     (read-only: category, parameter, weightage, what is checked)
     DUMP tab + Submit    -> "Audits"     (every submitted audit; Download Excel gives the exact
                             75-column DUMP layout so existing pivots/reports keep working)

   Scoring (copied from the workbook's Data tab):
     - A parameter earns its full points unless it is tagged "No" (Yes and N/A both earn full
       points; N/A is NOT removed from the 100-point total).
     - Overall score = points earned / 100, but ONLY if Zero Tolerance is "Met" — if a Zero
       Tolerance policy is "Not Met" the whole audit scores 0.
   The app additionally requires every parameter to be tagged and an Error Category whenever
   a parameter is tagged "No" — the workbook allowed blanks, which silently scored as full points.

   Who: canAuditQuality() (Admin, Manager, TL, Trainer, SME, Quality) can submit audits; Admin/Manager can
   delete one. A Quality login sees only the audits it submitted itself (its dashboard — js/qualitydashboard.js —
   is built from that same set). Everyone else who can open the tab (Agents) sees only audits about themselves;
   TLs/SMEs see their own team's. Submitted audits can be CORRECTED (see "Corrections" below): the original auditor, or an Admin/Manager,
   can change tags / Zero Tolerance / notes — including reversing a wrong charge (a "No" that should have been
   "Yes", or a Zero Tolerance flag that should be "Met") — with a mandatory reason. The score is recalculated and every
   correction is kept on the audit (audit.corrections) and in the Audit Log. Stored in state.qaAudits, one Firestore doc each
   (collection trackerQualityAudits), so two auditors submitting at once can't overwrite each other. */

const QA_PARAMS = [
 {
  "n": 1,
  "cat": "Greeting",
  "name": "Call Opening",
  "pts": 1,
  "na": true,
  "desc": [
   "Call greeting script: \"Hello, thank you for contacting Alignment this is XXX in XXX on a recorded line. How can I help you today?\""
  ],
  "errors": [
   "Did Not Thank the Caller",
   "Call Branding",
   "Used unapproved pseudo names",
   "Call reason not asked",
   "No call recording disclosure",
   "Delayed Call Recording Disclosure",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 2,
  "cat": "Greeting",
  "name": "Call Prepardness",
  "pts": 1,
  "na": true,
  "desc": [
   "Opened the call within five (5) seconds",
   "System Ready/prepared before taking the call",
   "Not distracted, caught off guard, or ask the caller to repeat information"
  ],
  "errors": [
   "Delayed Greeting",
   "EZ Cap - Not Logged In",
   "Not Applicable"
  ]
 },
 {
  "n": 3,
  "cat": "Greeting",
  "name": "Call Back Number Obtained",
  "pts": 1,
  "na": true,
  "desc": [
   "Asked if the number they are calling from is the best call back number in case the line drops",
   "If the caller declines to provide a call back number, Agent advised that we will not be able to call back if the line drops",
   "Obtained the call back number before verifying the account",
   "<direct number vs extension> readback OK"
  ],
  "errors": [
   "CB# not asked",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 4,
  "cat": "Greeting",
  "name": "Issue Paraphrasing and Offer to Assist",
  "pts": 1,
  "na": true,
  "desc": [
   "Paraphrased all of the caller's concern correctly",
   "Offered to assist at least once e.g. \"I'll be happy to check the patient's eligibility for you.\""
  ],
  "errors": [
   "No Paraphrasing",
   "No offering to assist statement",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 5,
  "cat": "HIPPA / Compliance",
  "name": "Member Identification",
  "pts": 5,
  "na": true,
  "desc": [
   "Did representative ask caller to confirm members’ first name, last name and DOB before moving forward with the call?"
  ],
  "errors": [
   "First name",
   "Last Name",
   "DOB",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 6,
  "cat": "HIPPA / Compliance",
  "name": "Provider Authentication",
  "pts": 5,
  "na": true,
  "desc": [
   "Did the representative ask for the NPI and/or TIN to verify provider in question and determine in or out of network status?"
  ],
  "errors": [
   "NPI",
   "TAX ID",
   "Others",
   "PHI violation",
   "Not Applicable"
  ]
 },
 {
  "n": 7,
  "cat": "HIPPA / Compliance",
  "name": "Minimum Necessary Guidelines",
  "pts": 5,
  "na": false,
  "desc": [
   "Adhered to the minimum necessary guidelines - especially for non-authenticated callers"
  ],
  "errors": [
   "Incorrect verification",
   "Incomplete Verification",
   "No verification",
   "PHI violation",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 8,
  "cat": "SOP Adherence (Accuracy)",
  "name": "Information Complete",
  "pts": 15,
  "na": false,
  "desc": [
   "Asked clarifying questions if necessary to ensure complete information is provided.",
   "Advised entirety of information present to better support the provider ex: provided full limitation benefits or exclusions, provided all necessary details of a authorization or claim"
  ],
  "errors": [
   "Effective date",
   "Termination date",
   "Status",
   "Contact information",
   "Time frames",
   "Out of pocket",
   "Medical Beneifts",
   "Dental beneifts",
   "Behavioral Health Benefits",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 9,
  "cat": "SOP Adherence (Accuracy)",
  "name": "Information Accuracy",
  "pts": 15,
  "na": true,
  "desc": [
   "All information provided on the call was accurate"
  ],
  "errors": [
   "Effective date",
   "Termination date",
   "Status",
   "Contact information",
   "Time frames",
   "Out of pocket",
   "Medical Beneifts",
   "Dental beneifts",
   "Behavioral Health Benefits",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 10,
  "cat": "SOP Adherence (Accuracy)",
  "name": "Tool Navigation",
  "pts": 5,
  "na": true,
  "desc": [
   "Did representative effectively use the most current tools and resources available?"
  ],
  "errors": [
   "Incorrect tools",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 11,
  "cat": "SOP Adherence (Accuracy)",
  "name": "Self-Service Education",
  "pts": 5,
  "na": true,
  "desc": [
   "Educated the Caller about Self Service Options when applicable",
   "Self Service education must be tailor fit with the issue"
  ],
  "errors": [
   "No Education",
   "Incomplete Education",
   "Did not Customize",
   "Did not Troubleshoot",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 12,
  "cat": "SOP Adherence (Accuracy)",
  "name": "Actions, Next Steps",
  "pts": 5,
  "na": true,
  "desc": [
   "If needed, the agent detailed out next steps to the provider to help resolve an issue  ex: submitting an appeal/dispute, escalating an incident report",
   "AND",
   "Completed all necessary actions on the agent's end incluiding but not limited to: Calling back the provider, routing a case, sending forms/letters/EOP, fax, etc. Submitting an incident report or escalating to another team"
  ],
  "errors": [
   "No Call Back",
   "No Case Routing",
   "No Letters/Forms Sent",
   "No Emails Sent",
   "Lapsed timeframe for action",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 13,
  "cat": "SOP Adherence (Accuracy)",
  "name": "Documentation",
  "pts": 10,
  "na": false,
  "desc": [
   "Agent utilized the correct disposition / tag for the call",
   "Agent documented the caller's name and phone number",
   "Agent documented pertinent information provided on the call including: providers NPI/TIN, DOS, MM information, reason for the call etc.",
   "Incident report contained all necessary and required data elements and was submitted correctly"
  ],
  "errors": [
   "Incomplete - Concerns",
   "Incomplete - Indications",
   "Incomplete - Actions",
   "Incomplete - Information",
   "Incomplete - Resolution",
   "Incomplete - Caller's Name",
   "Incomplete - CB#",
   "Incorrect - Concerns",
   "Incorrect - Indications",
   "Incorrect - Actions",
   "Incorrect - Information",
   "Incorrect - Resolution",
   "Incorrect - Caller's Name",
   "Incorrect - CB#",
   "No Documentation",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 14,
  "cat": "Soft Skills",
  "name": "Tone, Pacing and Professionalism",
  "pts": 5,
  "na": true,
  "desc": [
   "Demonstrated courteous, upbeat and professional demeanor throughout the call",
   "Matched the caller's pace",
   "Genuinely apologized and emphatized when necessary"
  ],
  "errors": [
   "Tone",
   "Pacing",
   "Contentious topics",
   "Use of Slang",
   "Mouth Noises",
   "Religion Specific Greetings",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 15,
  "cat": "Soft Skills",
  "name": "Clarity",
  "pts": 5,
  "na": false,
  "desc": [
   "Did the representative convey information 'clearly' and in a manner that was easily 'understood' by the caller? Caller did not have to ask representative multiple times to repeat themselves"
  ],
  "errors": [
   "Interruption",
   "Talking Over",
   "Repeated Information",
   "Did not use phonetics when applicable",
   "Lack of Focus - Side Chat",
   "Lack of Focus - Other Accounts",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 16,
  "cat": "Soft Skills",
  "name": "Call Control",
  "pts": 5,
  "na": false,
  "desc": [
   "Avoided Interrupting the caller",
   "Apologized during unintended verbal collisions and gave way to the caller",
   "Did not ask the caller to repeat previously provided information",
   "Provided a reason for needing to repeat information e.g. line of caller is unclear",
   "Used phonetics for hard to spell/hear words/names",
   "Gave undivided attention to the current call by only accessing tools and resources related to the current call"
  ],
  "errors": [
   "Lack of Empathy",
   "Lack of Acknowledgement",
   "Inappropriate response to a life event",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 17,
  "cat": "Soft Skills",
  "name": "Hold Policy / Transfer Policy",
  "pts": 5,
  "na": true,
  "desc": [
   "Asked permission before placing the call on hold",
   "Set expectations regarding hold time and provided reason",
   "Kept the caller informed by refreshing the line and not placing the call on extended hold",
   "Minimized gaps of silence to less than 20 seconds",
   "Adhered to the 3 minutes threshold for Hold",
   "Adhered to the Transfer Policies (warm / cold)",
   "Provided the correct phone number when applicable",
   "Relayed necessary information to the next party/representative on warm transfers"
  ],
  "errors": [
   "Didn't Provide Phone Number",
   "Didn't follow warm transfer",
   "Didn't follow cold transfer",
   "Didn't share relevant information",
   "Hold Threshold Exceeded",
   "Dead Air Threshold Exceeded",
   "Hold - Didn’t gain agreement",
   "Hold - Didn't thank the caller",
   "Hold - Misused (No screen movement)",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 18,
  "cat": "Call Closing",
  "name": "Offer of Assistance",
  "pts": 1,
  "na": true,
  "desc": [
   "Did the representative ask caller if there was anything else, he/she could assist with prior to ending the call?",
   "Did the representative effectively address all of caller's questions/concerns?"
  ],
  "errors": [
   "No Recap",
   "No Additional Help",
   "Others",
   "Not Applicable"
  ]
 },
 {
  "n": 19,
  "cat": "Call Closing",
  "name": "Closing Script",
  "pts": 5,
  "na": true,
  "desc": [
   "Thank the caller and advise of the survey"
  ],
  "errors": [
   "No Branding",
   "Missed to pitch survey",
   "Others",
   "Not Applicable"
  ]
 }
];
const QA_CALL_REASONS = ["Benefits","Eligibility","Claims Status","Others (Non Supported)"];
const QA_ZT_ERRORS = ["Call Avoidance","Rudeness","Speaking in Vernacular","Unauthorized Account Changes"];
const QA_ZT_POLICIES = ["Call Avoidance","Antagonizing or blatantly disrespecting the caller, including use of foul language","Speaking in Vernacular","Unauthorized account changes"];
// Exact column headers of the workbook's DUMP tab (A..BW) — keep in this order. "Coaching Summary" (BX) is an
// app-only extra appended at the end, so nothing the workbook's pivots point at moves.
const QA_DUMP_HEADERS = ["Agent's Name", "Supervisor", "Call ID", "Auditor", "Call Reason", "Call Start", "Call End", "Audit Date", "ZTP", "ZTP ERROR", "Total Points", "Achieved Points", "Score", "1. Call Opening", "2. Call Prepardness", "3. Call Back Number Obtained", "4. Issue Paraphrasing and Offer to Assist", "5. Member Identification", "6. Provider Authentication", "7. Minimum Necessary Guidelines", "8. Information Complete", "9. Information Accuracy", "10. Tool Navigation", "11. Self-Service Education", "12. Actions, Next Steps", "13. Documentation", "14. Tone, Pacing and Professionalism", "15. Clarity", "16. Call Control", "17. Hold Policy / Transfer Policy", "18. Offer of Assistance", "19. Closing Script", "1. Call Opening", "2. Call Prepardness", "3. Call Back Number Obtained", "4. Issue Paraphrasing and Offer to Assist", "5. Member Identification", "6. Provider Authentication", "7. Minimum Necessary Guidelines", "8. Information Complete", "9. Information Accuracy", "10. Tool Navigation", "11. Self-Service Education", "12. Actions, Next Steps", "13. Documentation", "14. Tone, Pacing and Professionalism", "15. Clarity", "16. Call Control", "17. Hold Policy / Transfer Policy", "18. Offer of Assistance", "19. Closing Script", "1. Call Opening", "2. Call Prepardness", "3. Call Back Number Obtained", "4. Issue Paraphrasing and Offer to Assist", "5. Member Identification", "6. Provider Authentication", "7. Minimum Necessary Guidelines", "8. Information Complete", "9. Information Accuracy", "10. Tool Navigation", "11. Self-Service Education", "12. Actions, Next Steps", "13. Documentation", "14. Tone, Pacing and Professionalism", "15. Clarity", "16. Call Control", "17. Hold Policy / Transfer Policy", "18. Offer of Assistance", "19. Closing Script", "Call Summary", "Exact Error ", "Cause of the Error", "Start Time", "End Time", "Coaching Summary", "Times Corrected", "Last Correction Reason"];

let qaSubTab = "new";        // "new" | "audits" | "rubric"
let qaDraft = null;          // the in-progress form, kept in memory so a re-render never wipes it
let qaViewId = null;         // audit open in the detail view
let qaCorrId = null;         // audit being corrected (null = not in correction mode)
let qaCorrDraft = null;      // the in-progress correction form (separate from qaDraft so a half-filled New audit isn't lost)
let qaFilter = {month:"", agent:"", auditor:""};

// The Error Category dropdown for a parameter: the Admin's customised list from Settings if there
// is one, otherwise the built-in list from the AHC rubric workbook.
function qaErrorOptions(p){
  const o = ((state.settings && state.settings.qaErrorCategories) || {})[p.n];
  return Array.isArray(o) && o.length ? o : p.errors;
}

function qaNewDraft(){
  const params = {};
  QA_PARAMS.forEach(p=>{ params[p.n] = {tag:"", error:"", notes:""}; });
  return {empId:"", supervisor:"", callId:"", callReason:"", callStart:"", callEnd:"", params,
          ztp:"Met", ztpError:"", summary:"", exactError:"", cause:"", coaching:""};
}

// The form functions below work on whichever draft is active: the correction draft while correcting, else the New audit draft.
function qaActiveDraft(){ return qaCorrId && qaCorrDraft ? qaCorrDraft : qaDraft; }

/* ---------- Corrections ----------
   Who can correct: the auditor who submitted the audit, or Admin/Manager (isAdmin()).
   What can change: every parameter tag / error category / note, Zero Tolerance, call details, summary,
   coaching, exact error and cause. The agent and Call ID are locked — if the audit is about the wrong
   agent or call, delete it (Admin) and submit a new one.
   "Reverse charge" = set a parameter tagged "No" back to "Yes" (removes the deduction) or set Zero Tolerance
   back to "Met" (removes the zero-score penalty). Score is recomputed with the same qaCompute().
   Each correction is appended to audit.corrections: {at, by, byUsername, reason, scoreBefore, scoreAfter,
   changes:[{field, from, to}]} — the original values are never lost. */
function qaCanCorrect(a){
  if(!a || !currentUser) return false;
  if(isAdmin()) return true;
  return !!currentUser.username && a.auditorUsername === currentUser.username && canAuditQuality();
}
function qaDraftFromAudit(a){
  const params = {};
  QA_PARAMS.forEach(p=>{ const v = (a.params||{})[p.n] || {}; params[p.n] = {tag:v.tag||"", error:v.error||"", notes:v.notes||""}; });
  return {empId:a.agentEmpId, supervisor:a.supervisor||"", callId:a.callId, callReason:a.callReason||"", callStart:a.callStart||"", callEnd:a.callEnd||"",
          params, ztp:a.ztp||"Met", ztpError:a.ztpError||"", summary:a.summary||"", exactError:a.exactError||"", cause:a.cause||"",
          coaching:a.coaching||"", reason:"", silent:false};
}
function qaStartCorrection(id){
  const a = (state.qaAudits||[]).find(x=>x.id===id);
  if(!a || !qaCanCorrect(a)){ showToast("⚠ You can't correct this audit"); return; }
  qaCorrId = id; qaCorrDraft = qaDraftFromAudit(a); qaSubTab = "correct"; qaViewId = null; render();
}
function qaCancelCorrection(){
  const id = qaCorrId; qaCorrId = null; qaCorrDraft = null; qaSubTab = "audits"; qaViewId = id; render();
}
// What changed between the stored audit and the corrected draft → [{field, from, to}] (human-readable).
function qaDiff(a, d){
  const ch = [], add = (field, from, to)=>{ if(String(from||"") !== String(to||"")) ch.push({field, from:String(from||"—"), to:String(to||"—")}); };
  QA_PARAMS.forEach(p=>{
    const o = (a.params||{})[p.n] || {tag:"",error:"",notes:""}, n = d.params[p.n];
    const nErr = n.tag==="No" ? n.error : "";
    add(`${p.n}. ${p.name} — tag`, o.tag, n.tag);
    add(`${p.n}. ${p.name} — error category`, o.error, nErr);
    add(`${p.n}. ${p.name} — notes`, o.notes, n.notes.trim());
  });
  add("Zero Tolerance", a.ztp, d.ztp);
  add("Zero Tolerance violation", a.ztpError, d.ztp==="Not Met" ? d.ztpError : "");
  add("Supervisor", a.supervisor, d.supervisor.trim());
  add("Call reason", a.callReason, d.callReason);
  add("Call start", qaDateTimeLabel(a.callStart), qaDateTimeLabel(d.callStart));
  add("Call end", qaDateTimeLabel(a.callEnd), qaDateTimeLabel(d.callEnd));
  add("Call summary", a.summary, d.summary.trim());
  add("Exact error", a.exactError, d.exactError.trim());
  add("Cause of the error", a.cause, d.cause.trim());
  add("Coaching summary", a.coaching, (d.coaching||"").trim());
  return ch;
}
/* Rule-based "reason for correction" (no AI model, nothing leaves the browser) — same idea as the coaching
   summary, but built from the diff between the saved audit and the corrected form: which charges were
   reversed (No → Yes/N/A), which were added, Zero Tolerance changes, other edits, and the score change.
   It only restates what changed; it doesn't invent why. The auditor can edit it before saving. */
function qaCorrectionReasonFor(a, d){
  const q = t => `"${t}"`, short = t => { t = String(t||"").trim(); return t.length>140 ? t.slice(0,140)+"…" : t; };
  const reversed = [], added = [], retagged = [], reErrored = [], noted = [], other = [];
  QA_PARAMS.forEach(p=>{
    const o = (a.params||{})[p.n] || {tag:"",error:"",notes:""}, n = d.params[p.n];
    const nErr = n.tag==="No" ? n.error : "", label = `parameter ${p.n} (${p.name})`;
    const nNote = n.notes.trim() ? ` — note: ${q(short(n.notes))}` : "";
    if(o.tag !== n.tag){
      if(o.tag==="No") reversed.push(`${label}: No → ${n.tag}${o.error ? ` (error category ${q(o.error)} removed)` : ""}${nNote}`);
      else if(n.tag==="No") added.push(`${label}: ${o.tag||"untagged"} → No${nErr ? ` (error category ${q(nErr)})` : ""}${nNote}`);
      else retagged.push(`${label}: ${o.tag||"untagged"} → ${n.tag}${nNote}`);
    } else if(n.tag==="No" && o.error !== nErr){
      reErrored.push(`${label}: error category changed from ${q(o.error||"—")} to ${q(nErr||"—")}`);
    } else if(String(o.notes||"").trim() !== n.notes.trim()){
      noted.push(`${label}: note updated`);
    }
  });
  let zt = "";
  if(a.ztp !== d.ztp){
    zt = a.ztp==="Not Met"
      ? `Zero Tolerance: penalty reversed, Not Met${a.ztpError ? ` (${a.ztpError})` : ""} → Met.`
      : `Zero Tolerance: now Not Met${d.ztpError ? ` (${d.ztpError})` : ""}, Met → Not Met.`;
  } else if(d.ztp==="Not Met" && a.ztpError !== d.ztpError){
    zt = `Zero Tolerance violation changed from ${q(a.ztpError||"—")} to ${q(d.ztpError||"—")}.`;
  }
  const fields = [];
  if((a.supervisor||"") !== d.supervisor.trim()) fields.push("supervisor");
  if((a.callReason||"") !== d.callReason) fields.push("call reason");
  if(qaDateTimeLabel(a.callStart) !== qaDateTimeLabel(d.callStart) || qaDateTimeLabel(a.callEnd) !== qaDateTimeLabel(d.callEnd)) fields.push("call start/end");
  if((a.summary||"") !== d.summary.trim()) fields.push("call summary");
  if((a.exactError||"") !== d.exactError.trim()) fields.push("exact error");
  if((a.cause||"") !== d.cause.trim()) fields.push("cause of the error");
  if((a.coaching||"") !== (d.coaching||"").trim()) fields.push("coaching summary");
  const calc = qaCompute(n=>d.params[n].tag, d.ztp);
  const lines = [];
  const bullet = (title, arr) => { if(arr.length) lines.push(title + "\n" + arr.map(x=>"• "+x).join("\n")); };
  bullet(reversed.length>1 ? "Charges reversed:" : "Charge reversed:", reversed);
  bullet("Charges added:", added);
  bullet("Tags changed:", retagged);
  bullet("Error categories changed:", reErrored);
  bullet("Notes updated:", noted);
  if(zt) lines.push(zt);
  if(fields.length) lines.push(`Also updated: ${fields.join(", ")}.`);
  if(!lines.length) return "";
  lines.push(calc.score !== a.score ? `Score changed from ${qaPct(a.score)} to ${qaPct(calc.score)}.` : `Score unchanged at ${qaPct(calc.score)}.`);
  return "Audit corrected after re-review.\n" + lines.join("\n");
}

function qaSaveCorrection(){
  const a = (state.qaAudits||[]).find(x=>x.id===qaCorrId), d = qaCorrDraft;
  if(!a || !d || !qaCanCorrect(a)){ showToast("⚠ You can't correct this audit"); return; }
  const problem = qaValidate(d, true);
  if(problem){ showToast("⚠ " + problem); return; }
  const reason = (d.reason||"").trim();
  if(reason.length < 5){ showToast("⚠ Enter the reason for this correction"); return; }
  const changes = qaDiff(a, d);
  if(!changes.length){ showToast("Nothing has changed — there's nothing to correct"); return; }
  const calc = qaCompute(n=>d.params[n].tag, d.ztp);
  if(!confirm(`Save this ${d.silent ? "SILENT " : ""}correction?${d.silent ? "\n(The agent will NOT be notified.)" : "\n(The agent will be notified.)"}\n\nScore: ${qaPct(a.score)} → ${qaPct(calc.score)}\n${changes.length} change${changes.length===1?"":"s"} will be recorded with your reason.`)) return;
  const params = {};
  QA_PARAMS.forEach(p=>{ const v = d.params[p.n]; params[p.n] = {tag:v.tag, error:v.tag==="No"?v.error:"", notes:v.notes.trim()}; });
  const now = new Date().toISOString();
  const silent = !!d.silent;
  const entry = {at:now, by:currentUser.name, byUsername:currentUser.username||"", reason, silent, scoreBefore:a.score, scoreAfter:calc.score, changes};
  Object.assign(a, {
    supervisor:d.supervisor.trim(), callReason:d.callReason, callStart:d.callStart, callEnd:d.callEnd,
    ztp:d.ztp, ztpError:d.ztp==="Not Met" ? d.ztpError : "",
    totalPoints:calc.total, achievedPoints:calc.achieved, score:calc.score,
    params, summary:d.summary.trim(), exactError:d.exactError.trim(), cause:d.cause.trim(), coaching:(d.coaching||"").trim(),
    corrections:(a.corrections||[]).concat([entry]), lastCorrectedAt:now
  });
  if(!silent) a.notifyCorrectedAt = now;   // only a normal correction re-notifies the agent; a silent one leaves their badge alone
  logAudit("qa_audit_correct", `${silent ? "Silently corrected" : "Corrected"} quality audit for ${a.agentName} (Call ${a.callId}) — ${qaPct(entry.scoreBefore)} → ${qaPct(entry.scoreAfter)}. Reason: ${reason}`,
    {empId:a.agentEmpId, before:{score:entry.scoreBefore}, after:{score:entry.scoreAfter, changes:changes.length, reason}});
  saveState();
  qaCorrId = null; qaCorrDraft = null; qaSubTab = "audits"; qaViewId = a.id;
  showToast(`✅ Correction saved — ${a.agentName}: ${qaPct(entry.scoreBefore)} → ${qaPct(entry.scoreAfter)}`);
  render();
}

/* ---------- Coaching summary (rule-based — no AI model, nothing leaves the browser) ----------
   Builds an agent-facing write-up from what the auditor already entered: the parameters tagged "No",
   their Error Category and Notes. For each miss it adds a specific "next time" action, looked up by
   parameter + error category in QA_COACH below (written from the rubric's own wording — not new policy).
   An error category with no entry (e.g. "Others", or one an Admin added in Settings) falls back to the
   parameter-level action. The auditor's note is quoted as written; nothing about the call is invented.
   The auditor can edit the text before submitting; it is stored on the audit as `coaching`.
   To tune the advice, edit QA_COACH — keys must match the Error Category text exactly. */
const QA_COACH = {
  1: { _: "Use the full opening script on every call: thank the caller, give your name and location, say the call is recorded, then ask how you can help.",
       "Did Not Thank the Caller": "Start with \"thank you for contacting Alignment\" before anything else.",
       "Call Branding": "Say the company name exactly as the script has it — don't shorten or swap it.",
       "Used unapproved pseudo names": "Introduce yourself only with your approved name.",
       "Call reason not asked": "End the greeting with \"How can I help you today?\" so the caller gives the reason up front.",
       "No call recording disclosure": "Say the call is on a recorded line in every opening, without exception.",
       "Delayed Call Recording Disclosure": "Give the recorded-line disclosure inside the greeting itself, not later in the call." },
  2: { _: "Have your tools open and ready before the call connects, and greet within five seconds.",
       "Delayed Greeting": "Be ready to speak the moment the call lands — the greeting should start within five seconds.",
       "EZ Cap - Not Logged In": "Log in to EZ Cap before you go available, so your system is ready when the call connects." },
  3: { _: "Get a call-back number early, before you start verifying the account.",
       "CB# not asked": "Ask if the number they're calling from is the best call-back number in case the line drops — before account verification. If they decline, tell them we won't be able to call back if the line drops." },
  4: { _: "Repeat the caller's whole concern back in your own words, then tell them you'll help.",
       "No Paraphrasing": "Restate the caller's full concern in your own words to confirm you understood it correctly.",
       "No offering to assist statement": "After paraphrasing, offer to help, e.g. \"I'll be happy to check the patient's eligibility for you.\"" },
  5: { _: "Before moving forward, confirm the member's first name, last name and date of birth with the caller.",
       "First name": "Ask the caller to confirm the member's first name before moving forward.",
       "Last Name": "Ask the caller to confirm the member's last name before moving forward.",
       "DOB": "Ask the caller to confirm the member's date of birth before moving forward." },
  6: { _: "Ask for the provider's NPI and/or TIN to verify them and confirm in- or out-of-network status.",
       "NPI": "Ask for the provider's NPI to verify them before going further.",
       "TAX ID": "Ask for the provider's TIN (Tax ID) to verify them before going further.",
       "PHI violation": "Share no member information until the provider is authenticated — this is a compliance miss, so treat it as a must-fix." },
  7: { _: "Share only what's needed to answer the question, especially with callers who aren't authenticated.",
       "Incorrect verification": "Use the right verification steps for this type of caller before sharing anything.",
       "Incomplete Verification": "Complete every verification step before giving information — don't stop partway.",
       "No verification": "Verify the caller before giving any information.",
       "PHI violation": "Stop and re-verify before disclosing anything further, and share only the minimum necessary — this is a compliance miss." },
  8: { _: "Ask clarifying questions where needed and give the provider the full picture — all limitations, exclusions and details." },
  9: { _: "Check every detail against the system before you say it." },
  10: { _: "Use the most current tools and resources for the question; if you're unsure which one applies, check with your TL or SME.",
        "Incorrect tools": "Confirm you're in the current, correct tool for this type of query before you answer." },
  11: { _: "Offer self-service options when they fit the issue, tailored to what this caller is trying to do.",
        "No Education": "Offer the relevant self-service option when the issue can be handled that way.",
        "Incomplete Education": "Walk the caller through the self-service option — where to go and what to do — rather than just mentioning it.",
        "Did not Customize": "Tie the self-service option to this caller's specific issue instead of giving a generic pitch.",
        "Did not Troubleshoot": "If the caller struggles with the self-service option, troubleshoot with them." },
  12: { _: "Tell the provider the next steps, and finish every action on your side before the call is closed out.",
        "No Call Back": "When a call-back is needed, make it — and tell the caller when to expect it.",
        "No Case Routing": "Route the case to the right team, and tell the caller it has been routed.",
        "No Letters/Forms Sent": "Send the required letter, form, EOP or fax, and tell the caller it's on its way.",
        "No Emails Sent": "Send the required email as part of closing out the call.",
        "Lapsed timeframe for action": "Complete the action inside the required timeframe — don't let it sit." },
  13: { _: "Document the correct disposition, the caller's name and number, and the key details: NPI/TIN, DOS, reason for the call, actions taken and the resolution.",
        "No Documentation": "Document every call — notes are required each time." },
  14: { _: "Stay courteous, upbeat and professional, match the caller's pace, and apologise or empathise where it fits.",
        "Tone": "Keep your tone warm and upbeat from start to finish, even when the topic is difficult.",
        "Pacing": "Match the caller's pace — slow down if they're taking notes, and don't rush them.",
        "Contentious topics": "Avoid contentious topics and keep the conversation on the caller's reason for calling.",
        "Use of Slang": "Use professional language only — leave out slang.",
        "Mouth Noises": "Keep the line free of mouth noises (eating, gum, throat-clearing) while a caller is on.",
        "Religion Specific Greetings": "Use neutral, standard greetings — avoid religion-specific ones." },
  15: { _: "Speak clearly so the caller never has to ask you to repeat yourself.",
        "Interruption": "Let the caller finish before you speak.",
        "Talking Over": "If you do overlap, apologise and give way to the caller.",
        "Repeated Information": "Say it once, clearly — avoid repeating information the caller already has.",
        "Did not use phonetics when applicable": "Use phonetics for names and words that are hard to spell or hear.",
        "Lack of Focus - Side Chat": "Give the caller your full attention — no side conversations while on a call.",
        "Lack of Focus - Other Accounts": "Open only the tools and accounts that relate to the call you're on." },
  16: { _: "Keep control of the call without interrupting, and give the caller your undivided attention.",
        "Lack of Empathy": "Respond to how the caller feels, not just to what they asked.",
        "Lack of Acknowledgement": "Acknowledge what the caller says (\"I understand…\") before moving on to the answer.",
        "Inappropriate response to a life event": "When a caller mentions a life event, give a sincere, appropriate acknowledgement before returning to the call." },
  17: { _: "Follow the hold and transfer policy: ask permission, set expectations and give a reason, keep holds under 3 minutes and silences under 20 seconds.",
        "Didn't Provide Phone Number": "Give the correct phone number whenever you transfer or redirect the caller.",
        "Didn't follow warm transfer": "On a warm transfer, stay on the line and hand the caller over to the next party.",
        "Didn't follow cold transfer": "Follow the cold-transfer steps exactly as the policy lays them out.",
        "Didn't share relevant information": "Brief the next party on the issue so the caller doesn't have to repeat it.",
        "Hold Threshold Exceeded": "Keep holds within the 3-minute threshold — refresh the line before it runs out.",
        "Dead Air Threshold Exceeded": "Keep silence under 20 seconds; tell the caller what you're doing while you work.",
        "Hold - Didn’t gain agreement": "Ask the caller's permission before placing them on hold, and wait for their yes.",
        "Hold - Didn't thank the caller": "Thank the caller for holding when you come back to the line.",
        "Hold - Misused (No screen movement)": "Place a call on hold only when you're actively working on it — no holds without activity on your screen." },
  18: { _: "Before ending, ask if there's anything else you can help with, and make sure all of the caller's questions were answered.",
        "No Recap": "Recap what was done and any next steps before you close.",
        "No Additional Help": "Ask \"Is there anything else I can assist you with today?\" before closing." },
  19: { _: "Close by thanking the caller and telling them about the survey.",
        "No Branding": "Use the company branding in your closing, as in the script.",
        "Missed to pitch survey": "Tell the caller about the survey before the call ends." }
};
const QA_COACH_ZT = {
  "Call Avoidance": "Stay on every call until it's resolved or properly transferred — avoiding or cutting a call short is a Zero Tolerance violation.",
  "Rudeness": "Stay respectful at all times — antagonising or disrespecting the caller, or using foul language, is a Zero Tolerance violation.",
  "Speaking in Vernacular": "Speak only in the approved call language for the whole call.",
  "Unauthorized Account Changes": "Make only the account changes the process allows and the caller is authorised for."
};
// Wording for the "which detail was wrong/missing" errors shared by parameters 8 and 9.
const QA_COACH_DETAIL = {"effective date":"effective date","termination date":"termination date","status":"status","contact information":"contact information","time frames":"time frames","out of pocket":"out-of-pocket amounts","medical beneifts":"medical benefits","dental beneifts":"dental benefits","behavioral health benefits":"behavioral health benefits"};

// The "next time" action for one miss: exact error match → built-from-pattern → parameter-level → rubric text.
function qaCoachTip(p, error){
  const t = QA_COACH[p.n] || {}, e = String(error||"").toLowerCase().replace(/\s+/g," ").trim();
  if(error && t[error]) return t[error];
  const detail = QA_COACH_DETAIL[e];
  if(p.n === 8 && detail) return `Give the ${detail} without waiting to be asked, and ask a clarifying question if you're not sure what the provider needs.`;
  if(p.n === 9 && detail) return `Check the ${detail} in the system before you say it — don't give it from memory.`;
  if(p.n === 13){
    const m = /^(incomplete|incorrect)\s*-\s*(.+)$/i.exec(String(error||""));
    if(m){
      const what = /^cb#$/i.test(m[2]) ? "CB#" : m[2].toLowerCase();
      return m[1].toLowerCase() === "incomplete"
        ? `Your notes were missing the ${what} — include it every time.`
        : `The ${what} in your notes was wrong — re-check it against what was said on the call before you save.`;
    }
  }
  return t._ || p.desc.filter(d=> d !== "AND")[0];
}

/* Takes anything shaped like {params, ztp, ztpError}. */
function qaCoachingFor(a){
  const tagOf = n => (a.params[n] || {}).tag || "";
  const calc = qaCompute(tagOf, a.ztp);
  const misses = QA_PARAMS.filter(p=> tagOf(p.n) === "No").sort((x,y)=> y.pts - x.pts || x.n - y.n);
  const lost = misses.reduce((s,p)=> s + p.pts, 0);
  const ztFail = a.ztp === "Not Met";
  const out = [];

  out.push(ztFail
    ? `QUALITY AUDIT COACHING\nScore: 0% — Zero Tolerance not met (the parameters alone came to ${calc.achieved} of ${calc.total} points)`
    : `QUALITY AUDIT COACHING\nScore: ${qaPct(calc.score)} (${calc.achieved} of ${calc.total} points)`);

  if(ztFail){
    const why = a.ztpError ? (QA_COACH_ZT[a.ztpError] || "") : "";
    out.push(`FIRST PRIORITY — Zero Tolerance not met${a.ztpError ? ": " + a.ztpError : ""}\nAny Zero Tolerance miss makes the whole audit score 0%, whatever else went well on the call.${why ? "\nNext time: " + why : ""}`);
  }

  // What went well: categories where nothing was missed, plus any heavy (10+ pt) parameter that was met.
  const cats = Array.from(new Set(QA_PARAMS.map(p=>p.cat)));
  const clean = cats.filter(c=>{
    const ps = QA_PARAMS.filter(p=>p.cat===c), tags = ps.map(p=>tagOf(p.n));
    return tags.every(t=> t==="Yes" || t==="N/A") && tags.some(t=> t==="Yes");
  });
  const heavyMet = QA_PARAMS.filter(p=> p.pts >= 10 && tagOf(p.n)==="Yes" && !clean.includes(p.cat));
  const good = clean.map(c=>`${c} — all parameters met`).concat(heavyMet.map(p=>`${p.name} — met (${p.pts} pts)`));
  if(good.length) out.push("WHAT WENT WELL\n" + good.map(g=>"- " + g).join("\n"));

  if(!misses.length){
    out.push(ztFail ? "Every scored parameter was met — the 0% comes only from the Zero Tolerance result above."
                    : "No parameters were missed on this call. Keep doing exactly what you did here.");
    return out.join("\n\n");
  }

  out.push(`WHAT TO FIX — ${misses.length} parameter${misses.length===1?"":"s"}, ${lost} point${lost===1?"":"s"} lost, biggest first`);
  misses.forEach((p,i)=>{
    const v = a.params[p.n], err = v.error && !/^not applicable$/i.test(v.error) ? v.error : "";
    const note = (v.notes || "").trim();
    const lines = [`${i+1}. ${p.name} (−${p.pts} ${p.pts===1?"pt":"pts"})${err ? " · " + err : ""}`];
    if(note) lines.push(`   Auditor's note: ${note}`);
    lines.push(`   Next time: ${qaCoachTip(p, err)}`);
    out.push(lines.join("\n"));
  });

  // Patterns worth calling out.
  const byCat = {};
  misses.forEach(p=>{ (byCat[p.cat] = byCat[p.cat] || []).push(p); });
  const patterns = [];
  Object.keys(byCat).forEach(c=>{ if(byCat[c].length > 1) patterns.push(`${byCat[c].length} misses in ${c} (${byCat[c].map(p=>p.name).join(", ")}) — worth practising that part of the call as a whole.`); });
  if(byCat["HIPPA / Compliance"]) patterns.push("Compliance parameters (Member Identification, Provider Authentication, Minimum Necessary) are 5 points each — make them a habit on every call.");
  if(patterns.length) out.push("PATTERNS\n" + patterns.map(x=>"- " + x).join("\n"));

  const f = misses[0], s = misses[1];
  out.push(`FOCUS FOR YOUR NEXT CALLS\nStart with ${f.name}${s ? `, then ${s.name}` : ""}.${f.pts >= 5 ? ` ${f.name} alone is worth ${f.pts} points.` : ""}`);
  return out.join("\n\n");
}

function qaId(){ return "qa_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function qaPct(x){ return (Math.round(x*1000)/10).toFixed(1).replace(/\.0$/,"") + "%"; }
function qaScoreClass(x){ return x >= 0.9 ? "badge-green" : x >= 0.8 ? "badge-yellow" : "badge-red"; }

// Same maths as the workbook's Data tab. tagOf(n) returns "Yes" | "No" | "N/A" | "".
function qaCompute(tagOf, ztp){
  const total = QA_PARAMS.reduce((s,p)=> s + p.pts, 0);
  const achieved = QA_PARAMS.reduce((s,p)=> s + (tagOf(p.n)==="No" ? 0 : p.pts), 0);
  return {total, achieved, score: ztp==="Met" ? achieved/total : 0};
}

// Audits this person may see (see header comment).
function qaVisibleAudits(){
  const all = state.qaAudits || [];
  if(isAgent()) return all.filter(a=> a.agentEmpId === currentUser.empId);
  // Quality analysts see only the audits they submitted themselves (their dashboard is built from the same set).
  if(isQuality()) return all.filter(a=> currentUser.username && a.auditorUsername === currentUser.username);
  const ids = new Set(scopedRoster().map(a=>a.empId));
  return all.filter(a=> ids.has(a.agentEmpId) || (currentUser.username && a.auditorUsername === currentUser.username));
}

// The line of business an audit belongs to = the audited agent's roster LOB. New audits store it
// (`lob`) at submit time so a later roster change doesn't move old audits; older audits fall back
// to the agent's current roster LOB, then "Unassigned".
function qaAuditLob(a){
  return a.lob || (typeof agentLOB==="function" ? agentLOB(a.agentEmpId) : "") || "Unassigned";
}

function qaDateTimeLabel(s){ return s ? String(s).replace("T"," ") : ""; }
function qaFormatTime(s){ return s && String(s).includes("T") ? String(s).split("T")[1] : ""; }

/* ---------- Agent notification (badge + "latest audits") ----------
   When an auditor submits an audit about an agent, that agent gets a count badge on the Quality Audit
   tab (see navBadgeCount in js/app.js) until they open the tab, and the top of their Audits view
   shows the two most recent audits they've received. "Read" is remembered per login on this device,
   the same way the LEO and Process Update badges work. */
function qaReadKey(){ const k = userViewKey(); return k ? "a360_read_qa_audits_" + k : null; }
function qaLoadRead(){
  const key = qaReadKey(); if(!key) return new Set();
  try{ const raw = localStorage.getItem(key); return raw ? new Set(JSON.parse(raw)) : new Set(); }catch(e){ return new Set(); }
}
function qaMarkRead(ids){
  const key = qaReadKey(); if(!key || !ids.length) return;
  const set = qaLoadRead(); ids.forEach(id=> set.add(id));
  try{ localStorage.setItem(key, JSON.stringify(Array.from(set))); }catch(e){}
}
// A corrected audit gets a new token, so the agent is notified again that their score changed.
function qaReadToken(a){ return a.notifyCorrectedAt ? a.id + "@" + a.notifyCorrectedAt : a.id; }
function qaUnreadCount(){
  if(!currentUser || !isAgent()) return 0;
  const read = qaLoadRead();
  return qaVisibleAudits().filter(a=> !read.has(qaReadToken(a))).length;
}
let qaSessionNew = new Set(); // audits that were new when the agent opened the tab — keeps their "New" tag for this visit

function qaLatestForAgentHtml(){
  const latest = qaVisibleAudits().slice().sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||"")).slice(0,2);
  if(!latest.length) return "";
  const cards = latest.map(a=>{
    const misses = QA_PARAMS.filter(p=> a.params[p.n] && a.params[p.n].tag==="No");
    const shown = misses.slice(0,3).map(p=>{
      const v = a.params[p.n];
      return `<div style="margin-top:4px;"><b>${p.n}. ${esc(p.name)}</b>${v.error ? ` — ${esc(v.error)}` : ""}${v.notes ? `<div style="color:var(--text-muted);font-size:12px;white-space:normal;">${esc(v.notes.length>140 ? v.notes.slice(0,140)+"…" : v.notes)}</div>` : ""}</div>`;
    }).join("");
    const isNew = qaSessionNew.has(a.id);
    return `<div style="flex:1 1 320px;min-width:280px;border:1px solid var(--border);border-left:4px solid ${isNew ? "var(--accent)" : "var(--border)"};border-radius:8px;padding:14px;background:var(--surface-2);">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span class="badge ${qaScoreClass(a.score)}" style="font-size:15px;padding:3px 10px;">${qaPct(a.score)}</span>
        ${isNew ? `<span class="badge" style="background:var(--accent);color:#fff;">${a.notifyCorrectedAt ? "Updated" : "New"}</span>` : ""}
        ${a.ztp==="Not Met" ? `<span class="badge badge-red">Zero Tolerance not met</span>` : ""}
        <span style="margin-left:auto;font-size:11.5px;color:var(--text-dim);">${esc(a.auditDate)}</span>
      </div>
      <div style="margin-top:8px;font-size:12.5px;">Call <span class="mono">${esc(a.callId)}</span> · ${esc(a.callReason)} · audited by ${esc(a.auditorName)}</div>
      <div style="margin-top:10px;font-size:12.5px;white-space:normal;">${misses.length
        ? `<div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;">Missed (${misses.length})</div>${shown}${misses.length>3 ? `<div style="margin-top:4px;color:var(--text-dim);">…and ${misses.length-3} more</div>` : ""}`
        : `<span style="color:var(--green,#3caa5a);">✓ No parameters missed — nice work.</span>`}</div>
      ${a.summary ? `<div style="margin-top:10px;font-size:12px;color:var(--text-muted);white-space:normal;">${esc(a.summary.length>180 ? a.summary.slice(0,180)+"…" : a.summary)}</div>` : ""}
      ${a.coaching ? `<div style="margin-top:8px;font-size:12px;color:var(--text-dim);">💡 Coaching notes included in the full audit</div>` : ""}
      <button class="btn btn-ghost btn-sm qa-view-btn" data-id="${esc(a.id)}" style="margin-top:12px;">View full audit</button>
    </div>`;
  }).join("");
  return `<div style="margin-bottom:20px;">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">Your latest audit${latest.length>1?"s":""}</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">${cards}</div></div>`;
}

/* ---------- main render ---------- */
function renderQualityAudit(content, topActions){
  topActions.innerHTML = "";
  if(isAgent()){
    // Opening the tab counts as seeing the audits; remember which were new for this visit, then clear the badge.
    const read = qaLoadRead();
    const fresh = qaVisibleAudits().filter(a=> !read.has(qaReadToken(a)));
    if(fresh.length){
      fresh.forEach(a=> qaSessionNew.add(a.id));
      qaMarkRead(fresh.map(qaReadToken));
      if(typeof refreshNavBadges === "function") refreshNavBadges();
    }
  }
  if(!canAuditQuality() && qaSubTab === "new") qaSubTab = "audits";
  if(qaSubTab === "correct" && !(qaCorrId && qaCorrDraft && qaCanCorrect((state.qaAudits||[]).find(x=>x.id===qaCorrId)))){ qaCorrId = null; qaCorrDraft = null; qaSubTab = "audits"; }
  if(!qaDraft) qaDraft = qaNewDraft();
  const tab = (id, label) => `<button class="dash-tab ${qaSubTab===id?"active":""}" data-qatab="${id}">${label}</button>`;
  const body = qaSubTab === "correct" ? qaNewAuditHtml()
             : qaSubTab === "new" ? qaNewAuditHtml()
             : qaSubTab === "rubric" ? qaRubricHtml()
             : (qaViewId ? qaDetailHtml(qaViewId) : qaAuditsHtml());
  content.innerHTML = `
    <div class="section">
      <div class="section-head" style="flex-wrap:wrap;gap:8px;">
        <div class="dash-tabs" style="margin:0;">
          ${canAuditQuality() ? tab("new","📝 New audit") : ""}
          ${tab("audits","📋 Audits")}
          ${tab("rubric","📖 Rubric")}
          ${qaSubTab==="correct" ? tab("correct","✏️ Correcting audit") : ""}
        </div>
      </div>
      ${body}
    </div>`;
  content.querySelectorAll("[data-qatab]").forEach(b=> b.addEventListener("click", ()=>{
    if(qaSubTab === "correct" && b.dataset.qatab !== "correct"){
      if(!confirm("Leave without saving this correction?")) return;
      qaCorrId = null; qaCorrDraft = null;
    }
    qaSubTab = b.dataset.qatab; qaViewId = null; render();
  }));
  if(qaSubTab === "new" || qaSubTab === "correct") qaWireForm(content);
  else if(qaSubTab === "audits") qaWireAudits(content);
}

/* ---------- Rubric (read-only) ---------- */
function qaRubricHtml(){
  let lastCat = null;
  const rows = QA_PARAMS.map(p=>{
    const catCell = p.cat !== lastCat ? `<td style="font-weight:600;vertical-align:top;" rowspan="${QA_PARAMS.filter(x=>x.cat===p.cat).length}">${esc(p.cat)}<div style="font-weight:400;font-size:11px;color:var(--text-dim);">${QA_PARAMS.filter(x=>x.cat===p.cat).reduce((s,x)=>s+x.pts,0)} pts</div></td>` : "";
    lastCat = p.cat;
    return `<tr>${catCell}
      <td style="vertical-align:top;white-space:nowrap;"><b>${p.n}.</b> ${esc(p.name)}${p.na ? "" : `<div style="font-size:10.5px;color:var(--text-dim);">No N/A option</div>`}</td>
      <td style="vertical-align:top;text-align:center;width:70px;">${p.pts}</td>
      <td style="font-size:12px;white-space:normal;min-width:340px;">${p.desc.map(d=>`<div>• ${esc(d)}</div>`).join("")}
        <details style="margin-top:4px;"><summary style="cursor:pointer;color:var(--text-dim);font-size:11px;">Error categories (${qaErrorOptions(p).length})</summary>
          <div style="font-size:11.5px;color:var(--text-muted);">${qaErrorOptions(p).map(esc).join(" · ")}</div></details></td>
    </tr>`;
  }).join("");
  const total = QA_PARAMS.reduce((s,p)=>s+p.pts,0);
  return `<div class="section-body">
    <div class="table-wrap"><table class="mini-table" style="width:100%;min-width:780px;"><thead><tr><th>Category</th><th>Parameter</th><th style="text-align:center;">Weightage</th><th>What is checked</th></tr></thead>
      <tbody>${rows}<tr style="border-top:2px solid var(--border);"><td colspan="2"><b>Total</b></td><td class="num"><b>${total}</b></td><td></td></tr></tbody></table></div>
    <div class="help-note" style="margin-top:12px;">
      <b>Zero Tolerance</b> (any one makes the whole audit score 0): ${QA_ZT_POLICIES.map((z,i)=>`${i+1}. ${esc(z)}`).join(" &nbsp; ")}<br>
      A parameter earns its full points unless it is tagged <b>No</b>. <b>N/A</b> earns full points. Score = points earned ÷ ${total}.
    </div></div>`;
}

/* ---------- New audit form ---------- */
function qaAgentOptions(){
  return scopedRoster().filter(a=>a.status!=="Inactive").slice().sort((a,b)=>a.name.localeCompare(b.name));
}
function qaNewAuditHtml(){
  const corr = qaCorrId && qaSubTab === "correct";
  const orig = corr ? (state.qaAudits||[]).find(x=>x.id===qaCorrId) : null;
  const d = qaActiveDraft(), agents = qaAgentOptions();
  const tagOf = n => d.params[n].tag;
  const calc = qaCompute(tagOf, d.ztp);
  const tagSel = p => {
    const v = d.params[p.n].tag;
    const opts = ["", "Yes", "No"].concat(p.na ? ["N/A"] : []);
    return `<select class="qa-tag" data-n="${p.n}" style="width:100%;min-width:110px;">${opts.map(o=>`<option value="${o}" ${o===v?"selected":""}>${o||"—"}</option>`).join("")}</select>`;
  };
  let lastCat = null;
  const rows = QA_PARAMS.map(p=>{
    const v = d.params[p.n];
    const span = QA_PARAMS.filter(x=>x.cat===p.cat).length;
    const catCell = p.cat !== lastCat ? `<td rowspan="${span}" style="font-weight:600;vertical-align:middle;background:var(--bg-soft,rgba(120,140,200,.08));">${esc(p.cat)}</td>` : "";
    lastCat = p.cat;
    return `<tr class="qa-row" data-n="${p.n}">${catCell}
      <td style="vertical-align:top;min-width:190px;"><b>${p.n}.</b> ${esc(p.name)}
        <details><summary style="cursor:pointer;color:var(--text-dim);font-size:11px;">What's checked</summary>
          <div style="font-size:11.5px;color:var(--text-muted);white-space:normal;max-width:320px;">${p.desc.map(x=>`<div>• ${esc(x)}</div>`).join("")}</div></details></td>
      <td style="vertical-align:top;text-align:center;width:70px;">${p.pts}</td>
      <td style="vertical-align:top;width:130px;min-width:130px;">${tagSel(p)}${corr ? `<button type="button" class="btn btn-ghost btn-sm qa-reverse" data-n="${p.n}" style="margin-top:4px;width:100%;${v.tag==="No" ? "" : "display:none;"}" title="Remove this deduction — sets the tag to Yes">↩ Reverse charge</button>` : ""}</td>
      <td style="vertical-align:top;min-width:195px;"><select class="qa-err" data-n="${p.n}" style="width:100%;" ${v.tag==="No"?"":"disabled"}>
          <option value="">${v.tag==="No" ? "Select error…" : "—"}</option>
          ${(qaErrorOptions(p).includes(v.error) || !v.error ? qaErrorOptions(p) : qaErrorOptions(p).concat([v.error])).map(e=>`<option value="${esc(e)}" ${e===v.error?"selected":""}>${esc(e)}</option>`).join("")}</select></td>
      <td style="vertical-align:top;min-width:215px;"><textarea class="qa-notes" data-n="${p.n}" rows="3" placeholder="Notes" style="width:100%;min-width:195px;resize:vertical;">${esc(v.notes)}</textarea></td>
    </tr>`;
  }).join("");
  const banner = corr && orig ? `<div class="help-note" style="margin-bottom:12px;border-left:4px solid var(--accent);">
      <b>Correcting the audit for ${esc(orig.agentName)} (Call ${esc(orig.callId)})</b> — original score <b>${qaPct(orig.score)}</b>${(orig.corrections||[]).length ? ` · corrected ${(orig.corrections||[]).length}× before` : ""}.<br>
      To remove a wrong charge, click <b>↩ Reverse charge</b> next to a parameter tagged <b>No</b> (or set Zero Tolerance back to <b>Met</b>). The score is recalculated, your reason is required, and the original values stay in the audit's correction history. Tick <b>Silent correction</b> at the bottom if the agent shouldn't be notified.</div>` : "";
  return `<div class="section-body">
    ${banner}
    <div class="help-note" style="margin-bottom:12px;">Tag each parameter <b>Yes</b> / <b>No</b>${""} (or <b>N/A</b> where allowed). Tagging <b>No</b> needs an Error Category. All 19 parameters must be tagged before you can submit.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-bottom:14px;">
      <div class="field"><label>Agent's name</label>
        <select id="qaAgent" style="width:100%;" ${corr?"disabled":""}><option value="">Select agent…</option>${(corr && orig && !agents.some(a=>a.empId===d.empId) ? [{empId:orig.agentEmpId, name:orig.agentName}] : agents).map(a=>`<option value="${esc(a.empId)}" ${a.empId===d.empId?"selected":""}>${esc(a.name)} (${esc(a.empId)})</option>`).join("")}</select></div>
      <div class="field"><label>Supervisor</label><input type="text" id="qaSupervisor" value="${esc(d.supervisor)}" style="width:100%;"></div>
      <div class="field"><label>Call ID</label><input type="text" id="qaCallId" value="${esc(d.callId)}" style="width:100%;" ${corr?"disabled":""}></div>
      <div class="field"><label>Call reason</label>
        <select id="qaCallReason" style="width:100%;"><option value="">Select…</option>${QA_CALL_REASONS.map(r=>`<option ${r===d.callReason?"selected":""}>${esc(r)}</option>`).join("")}</select></div>
      <div class="field"><label>Call start</label><input type="datetime-local" id="qaCallStart" value="${esc(d.callStart)}" style="width:100%;"></div>
      <div class="field"><label>Call end</label><input type="datetime-local" id="qaCallEnd" value="${esc(d.callEnd)}" style="width:100%;"></div>
      <div class="field"><label>Audit date</label><input type="text" value="${esc(corr && orig ? orig.auditDate : todayIso())}" disabled style="width:100%;"></div>
      <div class="field"><label>Auditor</label><input type="text" value="${esc(corr && orig ? orig.auditorName : currentUser.name)}" disabled style="width:100%;"></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
      <div style="font-size:12px;color:var(--text-muted);">Overall score</div>
      <span class="badge ${qaScoreClass(calc.score)}" id="qaScoreBadge" style="font-size:16px;padding:4px 12px;">${qaPct(calc.score)}</span>
      <span style="font-size:12px;color:var(--text-dim);" id="qaPointsText">${calc.achieved} / ${calc.total} points${d.ztp==="Not Met" ? " — Zero Tolerance not met, score is 0" : ""}</span>
    </div>
    <div class="table-wrap"><table class="mini-table" id="qaTable" style="width:100%;min-width:1020px;"><thead><tr><th>Category</th><th>Parameter</th><th style="text-align:center;">Points</th><th>Tagging</th><th>Error category</th><th>Notes</th></tr></thead>
      <tbody>${rows}
        <tr style="border-top:2px solid var(--border);">
          <td style="font-weight:600;background:rgba(220,60,60,.08);">Zero Tolerance Policies</td>
          <td style="font-size:12px;" colspan="2">${QA_ZT_POLICIES.map((z,i)=>`<div>${i+1}. ${esc(z)}</div>`).join("")}</td>
          <td style="vertical-align:top;width:130px;min-width:130px;"><select id="qaZtp" style="width:100%;min-width:110px;"><option ${d.ztp==="Met"?"selected":""}>Met</option><option ${d.ztp==="Not Met"?"selected":""}>Not Met</option></select>${corr ? `<button type="button" class="btn btn-ghost btn-sm" id="qaZtpReverse" style="margin-top:4px;width:100%;${d.ztp==="Not Met" ? "" : "display:none;"}" title="Remove the Zero Tolerance penalty — sets it back to Met">↩ Reverse charge</button>` : ""}</td>
          <td style="vertical-align:top;min-width:195px;"><select id="qaZtpErr" style="width:100%;" ${d.ztp==="Not Met"?"":"disabled"}><option value="">${d.ztp==="Not Met"?"Select violation…":"—"}</option>${QA_ZT_ERRORS.map(e=>`<option ${e===d.ztpError?"selected":""}>${esc(e)}</option>`).join("")}</select></td>
          <td></td>
        </tr></tbody></table></div>
    <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px;">
      <div class="field"><label>Call summary</label><textarea id="qaSummary" rows="4" style="width:100%;">${esc(d.summary)}</textarea></div>
      <div class="field"><label>Coaching summary for the agent <span style="color:var(--text-dim);">(optional — built from the parameters tagged No, their error categories and your notes; edit freely)</span></label>
        <div style="margin-bottom:6px;"><button class="btn btn-ghost btn-sm" id="qaCoachBtn" type="button">✨ Generate from tags &amp; notes</button></div>
        <textarea id="qaCoaching" rows="9" style="width:100%;" placeholder="Click Generate after tagging, or write your own.">${esc(d.coaching)}</textarea>
        <div class="help-note" style="margin-top:4px;">Don't put member names, DOBs, member IDs or claim numbers in your notes — this text is shown to the agent and saved with the audit.</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
        <div class="field"><label>Exact error <span style="color:var(--text-dim);">(optional)</span></label><input type="text" id="qaExact" value="${esc(d.exactError)}" style="width:100%;"></div>
        <div class="field"><label>Cause of the error <span style="color:var(--text-dim);">(optional)</span></label><input type="text" id="qaCause" value="${esc(d.cause)}" style="width:100%;"></div>
      </div>
    </div>
    ${corr ? `<div class="field" style="margin-top:14px;"><label>Reason for correction <span style="color:var(--danger,#d44);">*</span> <span style="color:var(--text-dim);">(built from the changes you made — edit freely, and add why if you like)</span></label>
      <div style="margin-bottom:6px;"><button class="btn btn-ghost btn-sm" id="qaCorrGenBtn" type="button">✨ Generate from corrections</button></div>
      <textarea id="qaCorrReason" rows="6" style="width:100%;" placeholder="e.g. Wrong charge applied — the agent did give the call-back number at 0:42.">${esc(d.reason||"")}</textarea></div>
    <label style="display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:13px;cursor:pointer;">
      <input type="checkbox" id="qaCorrSilent" ${d.silent?"checked":""} style="margin-top:3px;">
      <span><b>Silent correction</b> — don't notify the agent. The agent's score updates quietly; the audit is marked <b>Corrected</b> for auditors and managers only. Leave unticked to notify the agent that their audit was updated.</span></label>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-accent" id="qaCorrSaveBtn">💾 Save correction</button>
      <button class="btn btn-ghost" id="qaCorrCancelBtn">Cancel</button>
    </div>` : `<div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn btn-accent" id="qaSubmitBtn">✅ Submit audit</button>
      <button class="btn btn-ghost" id="qaClearBtn">Clear form</button>
    </div>`}
  </div>`;
}

function qaRefreshScore(){
  const d = qaActiveDraft(), calc = qaCompute(n=>d.params[n].tag, d.ztp);
  const badge = document.getElementById("qaScoreBadge"), txt = document.getElementById("qaPointsText");
  if(badge){ badge.textContent = qaPct(calc.score); badge.className = "badge " + qaScoreClass(calc.score); }
  if(txt) txt.textContent = `${calc.achieved} / ${calc.total} points${d.ztp==="Not Met" ? " — Zero Tolerance not met, score is 0" : ""}`;
}
function qaTintRow(tr, tag){
  tr.style.background = tag==="Yes" ? "rgba(60,170,90,.10)" : tag==="No" ? "rgba(220,60,60,.12)" : tag==="N/A" ? "rgba(230,170,40,.12)" : "";
}

/* Searchable dropdown: turns a <select> into a type-to-search combobox. The original <select> stays in the DOM
   (hidden) and remains the source of truth, so existing "change" handlers keep working unchanged. */
function qaEnhanceSelect(root, id, placeholder){
  const sel = root.querySelector("#"+id);
  if(!sel || sel.dataset.qaSearch) return;
  sel.dataset.qaSearch = "1";
  const opts = Array.from(sel.options).map(o=>({value:o.value, label:o.textContent.trim()}));
  const wrap = document.createElement("div");
  wrap.className = "qa-combo" + (sel.classList.contains("week-select") ? " qa-combo-inline" : "");
  wrap.innerHTML = `<input type="text" class="qa-combo-input" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false"><span class="qa-combo-icon" aria-hidden="true">🔍</span><div class="qa-combo-list" role="listbox" hidden></div>`;
  sel.style.display = "none";
  sel.parentNode.insertBefore(wrap, sel);
  const input = wrap.querySelector("input"), list = wrap.querySelector(".qa-combo-list");
  input.disabled = sel.disabled;
  const curLabel = ()=>{ const o = opts.find(x=>x.value===sel.value); return o && o.value ? o.label : ""; };
  input.placeholder = (opts[0] && !opts[0].value ? opts[0].label : (placeholder||"Search…"));
  input.value = curLabel();
  let shown = [], hi = -1;
  const mark = (label, q)=>{
    if(!q) return esc(label);
    const i = label.toLowerCase().indexOf(q);
    return i<0 ? esc(label) : esc(label.slice(0,i)) + "<mark>" + esc(label.slice(i,i+q.length)) + "</mark>" + esc(label.slice(i+q.length));
  };
  const open = (filter)=>{
    const q = (filter||"").trim().toLowerCase();
    shown = opts.filter(o=> !q ? true : (o.value && o.label.toLowerCase().includes(q)));
    hi = q ? (shown.length ? 0 : -1) : shown.findIndex(o=>o.value===sel.value);
    list.innerHTML = shown.length
      ? shown.map((o,i)=>`<div class="qa-combo-opt${i===hi?" active":""}${o.value===sel.value?" selected":""}${o.value?"":" qa-combo-clear"}" role="option" data-i="${i}">${mark(o.label,q)}</div>`).join("")
      : `<div class="qa-combo-empty">No agent matches “${esc(filter.trim())}”</div>`;
    list.hidden = false; input.setAttribute("aria-expanded","true");
    const a = list.querySelector(".active"); if(a) a.scrollIntoView({block:"nearest"});
  };
  const close = ()=>{ list.hidden = true; input.setAttribute("aria-expanded","false"); input.value = curLabel(); };
  const choose = i=>{
    const o = shown[i]; if(!o) return;
    const changed = sel.value !== o.value;
    sel.value = o.value; input.value = curLabel();
    list.hidden = true; input.setAttribute("aria-expanded","false");
    if(changed) sel.dispatchEvent(new Event("change",{bubbles:true}));
  };
  const move = d=>{
    if(list.hidden) return open("");
    if(!shown.length) return;
    hi = (hi + d + shown.length) % shown.length;
    list.querySelectorAll(".qa-combo-opt").forEach((el,i)=>el.classList.toggle("active", i===hi));
    const a = list.querySelector(".active"); if(a) a.scrollIntoView({block:"nearest"});
  };
  input.addEventListener("focus", ()=>{ input.select(); open(""); });
  input.addEventListener("click", ()=>{ if(list.hidden) open(""); });
  input.addEventListener("input", ()=> open(input.value));
  input.addEventListener("keydown", e=>{
    if(e.key==="ArrowDown"){ e.preventDefault(); move(1); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); move(-1); }
    else if(e.key==="Enter"){ e.preventDefault(); if(!list.hidden){ if(hi<0 && shown.length===1) hi = 0; choose(hi); } }
    else if(e.key==="Escape"){ close(); input.blur(); }
    else if(e.key==="Tab"){ close(); }
  });
  // mousedown (not click) so it fires before the input's blur
  list.addEventListener("mousedown", e=>{
    const el = e.target.closest(".qa-combo-opt"); if(!el) return;
    e.preventDefault(); choose(+el.dataset.i);
  });
  input.addEventListener("blur", close);
}

function qaWireForm(content){
  const d = qaActiveDraft(), corr = !!(qaCorrId && qaSubTab === "correct");
  const $ = id => content.querySelector("#"+id);
  qaEnhanceSelect(content, "qaAgent", "Search agent…");
  content.querySelectorAll("#qaTable .qa-row").forEach(tr=> qaTintRow(tr, d.params[tr.dataset.n].tag));
  if(!corr) $("qaAgent").addEventListener("change", e=>{
    d.empId = e.target.value;
    const a = state.roster.find(x=>x.empId===d.empId);
    d.supervisor = a ? (a.tlName||"") : "";
    $("qaSupervisor").value = d.supervisor;
  });
  $("qaSupervisor").addEventListener("input", e=>{ d.supervisor = e.target.value; });
  if(!corr) $("qaCallId").addEventListener("input", e=>{ d.callId = e.target.value; });
  $("qaCallReason").addEventListener("change", e=>{ d.callReason = e.target.value; });
  $("qaCallStart").addEventListener("change", e=>{ d.callStart = e.target.value; });
  $("qaCallEnd").addEventListener("change", e=>{ d.callEnd = e.target.value; });
  $("qaSummary").addEventListener("input", e=>{ d.summary = e.target.value; });
  $("qaExact").addEventListener("input", e=>{ d.exactError = e.target.value; });
  $("qaCause").addEventListener("input", e=>{ d.cause = e.target.value; });
  $("qaCoaching").addEventListener("input", e=>{ d.coaching = e.target.value; });
  $("qaCoachBtn").addEventListener("click", ()=>{
    const tagged = QA_PARAMS.filter(p=> d.params[p.n].tag).length;
    if(!tagged){ showToast("Tag the parameters first"); return; }
    if(d.coaching.trim() && !confirm("Replace the coaching text with a fresh one? Your edits will be lost.")) return;
    if(tagged < QA_PARAMS.length) showToast(`Note: only ${tagged} of ${QA_PARAMS.length} parameters tagged so far`);
    d.coaching = qaCoachingFor(d);
    $("qaCoaching").value = d.coaching;
  });
  content.querySelectorAll(".qa-tag").forEach(sel=> sel.addEventListener("change", ()=>{
    const n = sel.dataset.n, tr = sel.closest("tr"), err = tr.querySelector(".qa-err");
    d.params[n].tag = sel.value;
    if(sel.value !== "No"){ d.params[n].error = ""; err.value = ""; }
    err.disabled = sel.value !== "No";
    err.options[0].textContent = sel.value==="No" ? "Select error…" : "—";
    qaTintRow(tr, sel.value);
    const rv = tr.querySelector(".qa-reverse"); if(rv) rv.style.display = sel.value==="No" ? "" : "none";
    qaRefreshScore();
  }));
  content.querySelectorAll(".qa-reverse").forEach(btn=> btn.addEventListener("click", ()=>{
    const n = btn.dataset.n, tr = btn.closest("tr"), tag = tr.querySelector(".qa-tag"), err = tr.querySelector(".qa-err");
    d.params[n].tag = "Yes"; d.params[n].error = "";
    tag.value = "Yes"; err.value = ""; err.disabled = true; err.options[0].textContent = "—";
    btn.style.display = "none"; qaTintRow(tr, "Yes"); qaRefreshScore();
    showToast(`↩ Charge reversed on parameter ${n} — add a note/reason below`);
  }));
  content.querySelectorAll(".qa-err").forEach(sel=> sel.addEventListener("change", ()=>{ d.params[sel.dataset.n].error = sel.value; }));
  content.querySelectorAll(".qa-notes").forEach(inp=> inp.addEventListener("input", ()=>{ d.params[inp.dataset.n].notes = inp.value; }));
  $("qaZtp").addEventListener("change", e=>{
    d.ztp = e.target.value;
    const zErr = $("qaZtpErr");
    if(d.ztp === "Met"){ d.ztpError = ""; zErr.value = ""; }
    zErr.disabled = d.ztp !== "Not Met";
    zErr.options[0].textContent = d.ztp==="Not Met" ? "Select violation…" : "—";
    const zr = $("qaZtpReverse"); if(zr) zr.style.display = d.ztp==="Not Met" ? "" : "none";
    qaRefreshScore();
  });
  const zRev = $("qaZtpReverse");
  if(zRev) zRev.addEventListener("click", ()=>{
    d.ztp = "Met"; d.ztpError = "";
    $("qaZtp").value = "Met"; $("qaZtpErr").value = ""; $("qaZtpErr").disabled = true; $("qaZtpErr").options[0].textContent = "—";
    zRev.style.display = "none"; qaRefreshScore();
    showToast("↩ Zero Tolerance charge reversed");
  });
  $("qaZtpErr").addEventListener("change", e=>{ d.ztpError = e.target.value; });
  if(corr){
    $("qaCorrReason").addEventListener("input", e=>{ d.reason = e.target.value; });
    $("qaCorrSilent").addEventListener("change", e=>{ d.silent = e.target.checked; });
    $("qaCorrGenBtn").addEventListener("click", ()=>{
      const a = (state.qaAudits||[]).find(x=>x.id===qaCorrId);
      if(!a) return;
      const text = qaCorrectionReasonFor(a, d);
      if(!text){ showToast("Make a correction first — there's nothing to summarise yet"); return; }
      if((d.reason||"").trim() && !confirm("Replace the reason with a fresh one? Your edits will be lost.")) return;
      d.reason = text; $("qaCorrReason").value = text;
    });
    $("qaCorrSaveBtn").addEventListener("click", qaSaveCorrection);
    $("qaCorrCancelBtn").addEventListener("click", ()=>{ if(confirm("Discard this correction?")) qaCancelCorrection(); });
    return;
  }
  $("qaClearBtn").addEventListener("click", ()=>{
    if(!confirm("This will clear the form. Proceed?")) return;
    qaDraft = qaNewDraft(); render();
  });
  $("qaSubmitBtn").addEventListener("click", qaSubmit);
}

// Returns the first problem with the draft, or "" if it can be submitted.
function qaValidate(d, isCorrection){
  if(!d.empId) return "Select the agent";
  if(!d.callId.trim()) return "Enter the Call ID";
  if(!d.callReason) return "Select the call reason";
  if(d.callStart && d.callEnd && d.callEnd < d.callStart) return "Call end is before call start";
  const untagged = QA_PARAMS.filter(p=>!d.params[p.n].tag);
  if(untagged.length) return `Tag every parameter — still missing: ${untagged.slice(0,3).map(p=>p.n+". "+p.name).join(", ")}${untagged.length>3 ? ` and ${untagged.length-3} more` : ""}`;
  const noErr = QA_PARAMS.filter(p=>d.params[p.n].tag==="No" && !d.params[p.n].error);
  if(noErr.length) return `Pick an Error Category for "${noErr[0].n}. ${noErr[0].name}"`;
  if(d.ztp==="Not Met" && !d.ztpError) return "Pick which Zero Tolerance policy was violated";
  return "";
}
function qaSubmit(){
  const d = qaDraft, problem = qaValidate(d);
  if(problem){ showToast("⚠ " + problem); return; }
  const callId = d.callId.trim();
  if((state.qaAudits||[]).some(a=> a.callId.toLowerCase() === callId.toLowerCase())
     && !confirm(`Call ID ${callId} has already been audited. Submit another audit for it?`)) return;
  if(!confirm("Submit the audit?")) return;
  const agent = state.roster.find(a=>a.empId===d.empId);
  const calc = qaCompute(n=>d.params[n].tag, d.ztp);
  const params = {};
  QA_PARAMS.forEach(p=>{ const v = d.params[p.n]; params[p.n] = {tag:v.tag, error:v.tag==="No"?v.error:"", notes:v.notes.trim()}; });
  const audit = {
    id: qaId(), agentEmpId: d.empId, agentName: agent ? agent.name : d.empId, supervisor: d.supervisor.trim(),
    lob: (agent && agent.lob) || "",
    callId, callReason: d.callReason, callStart: d.callStart, callEnd: d.callEnd,
    auditorName: currentUser.name, auditorUsername: currentUser.username || "", auditDate: todayIso(), createdAt: new Date().toISOString(),
    ztp: d.ztp, ztpError: d.ztp==="Not Met" ? d.ztpError : "",
    totalPoints: calc.total, achievedPoints: calc.achieved, score: calc.score,
    params, summary: d.summary.trim(), exactError: d.exactError.trim(), cause: d.cause.trim(),
    coaching: (d.coaching || "").trim()
  };
  state.qaAudits = state.qaAudits || [];
  state.qaAudits.push(audit);
  logAudit("qa_audit_submit", `Submitted quality audit for ${audit.agentName} (Call ${callId}) — ${qaPct(audit.score)}`, {empId:audit.agentEmpId, after:{callId, score:audit.score}});
  saveState();
  qaDraft = qaNewDraft();
  qaSubTab = "audits"; qaViewId = null;
  showToast(`✅ Audit submitted — ${audit.agentName}: ${qaPct(audit.score)}`);
  render();
}

/* ---------- Audits list ---------- */
function qaMonthKey(a){ return String(a.auditDate||"").slice(0,7); }
function qaMonthLabel(key){
  const m = /^(\d{4})-(\d{2})$/.exec(key); return m ? `${MONTHS[Number(m[2])-1]} ${m[1]}` : key;
}
function qaFilteredAudits(){
  return qaVisibleAudits()
    .filter(a=> (!qaFilter.month || qaMonthKey(a)===qaFilter.month)
             && (!qaFilter.agent || a.agentEmpId===qaFilter.agent)
             && (!qaFilter.auditor || a.auditorName===qaFilter.auditor))
    .sort((a,b)=> (b.createdAt||"").localeCompare(a.createdAt||""));
}
function qaAuditsHtml(){
  const visible = qaVisibleAudits(), list = qaFilteredAudits();
  const months = Array.from(new Set(visible.map(qaMonthKey))).filter(Boolean).sort().reverse();
  const agents = Array.from(new Map(visible.map(a=>[a.agentEmpId, a.agentName])).entries()).sort((x,y)=>x[1].localeCompare(y[1]));
  const auditors = Array.from(new Set(visible.map(a=>a.auditorName))).sort();
  const avg = list.length ? list.reduce((s,a)=>s+a.score,0)/list.length : 0;
  const ztFails = list.filter(a=>a.ztp==="Not Met").length;
  const kpi = (l,v)=>`<div class="kpi"><div class="kpi-label">${esc(l)}</div><div class="kpi-value">${v}</div></div>`;
  const rows = list.map(a=>{
    const nos = QA_PARAMS.filter(p=>a.params[p.n] && a.params[p.n].tag==="No").length;
    return `<tr>
      <td class="mono">${esc(a.auditDate)}</td><td>${esc(a.agentName)}</td><td>${esc(a.supervisor||"—")}</td>
      <td class="mono">${esc(a.callId)}${isAgent() && qaSessionNew.has(a.id) ? ` <span class="badge" style="background:var(--accent);color:#fff;">New</span>` : ""}</td><td>${esc(a.callReason)}</td><td>${esc(a.auditorName)}</td>
      <td class="num"><span class="badge ${qaScoreClass(a.score)}">${qaPct(a.score)}</span></td>
      <td>${a.ztp==="Not Met" ? `<span class="badge badge-red" title="${esc(a.ztpError)}">Not Met</span>` : `<span style="color:var(--text-dim);">Met</span>`}</td>
      <td class="num">${nos}</td>
      <td style="white-space:nowrap;"><button class="btn btn-ghost btn-sm qa-view-btn" data-id="${esc(a.id)}">View</button>
        ${qaCanCorrect(a) ? `<button class="btn btn-ghost btn-sm qa-corr-btn" data-id="${esc(a.id)}" title="Correct this audit / reverse a wrong charge">✏️ Correct</button>` : ""}
        ${isAdmin() ? `<button class="icon-btn qa-del-btn" data-id="${esc(a.id)}" title="Delete this audit">✕</button>` : ""}</td></tr>`;
  }).join("");
  return `<div class="section-body">
    ${isAgent() ? qaLatestForAgentHtml() : ""}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
      <select id="qaFMonth" class="week-select"><option value="">All months</option>${months.map(m=>`<option value="${m}" ${m===qaFilter.month?"selected":""}>${esc(qaMonthLabel(m))}</option>`).join("")}</select>
      ${isAgent() ? "" : `<select id="qaFAgent" class="week-select"><option value="">All agents</option>${agents.map(([id,n])=>`<option value="${esc(id)}" ${id===qaFilter.agent?"selected":""}>${esc(n)}</option>`).join("")}</select>
      ${isQuality() ? "" : `<select id="qaFAuditor" class="week-select"><option value="">All auditors</option>${auditors.map(n=>`<option ${n===qaFilter.auditor?"selected":""}>${esc(n)}</option>`).join("")}</select>`}`}
      <span style="flex:1;"></span>
      ${canAuditQuality() ? `<button class="btn btn-accent btn-sm" id="qaDownloadBtn" ${list.length?"":"disabled"}>⬇ Download Excel</button>` : ""}
    </div>
    <div class="kpi-grid" style="margin-bottom:16px;">${kpi("Audits", list.length)}${kpi("Average score", list.length ? qaPct(avg) : "—")}${kpi("Zero Tolerance not met", ztFails)}</div>
    ${list.length ? `<div class="table-wrap"><table class="mini-table"><thead><tr><th>Audit date</th><th>Agent</th><th>Supervisor</th><th>Call ID</th><th>Call reason</th><th>Auditor</th><th class="num">Score</th><th>Zero Tol.</th><th class="num">Errors</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty-state" style="padding:28px;text-align:center;color:var(--text-dim);">${visible.length ? "No audits match these filters." : "No audits yet."}</div>`}
  </div>`;
}
function qaWireAudits(content){
  // Detail view -> back to the list. (The button is only on the detail view, so this is a no-op on the list.)
  const back = content.querySelector("#qaBackBtn");
  if(back) back.addEventListener("click", ()=>{ qaViewId = null; render(); });
  const bind = (id, key)=>{ const el = content.querySelector("#"+id); if(el) el.addEventListener("change", ()=>{ qaFilter[key] = el.value; render(); }); };
  bind("qaFMonth","month"); bind("qaFAgent","agent"); bind("qaFAuditor","auditor");
  qaEnhanceSelect(content, "qaFAgent", "Search agent…");
  content.querySelectorAll(".qa-view-btn").forEach(b=> b.addEventListener("click", ()=>{ qaViewId = b.dataset.id; render(); }));
  content.querySelectorAll(".qa-corr-btn").forEach(b=> b.addEventListener("click", ()=> qaStartCorrection(b.dataset.id)));
  content.querySelectorAll(".qa-del-btn").forEach(b=> b.addEventListener("click", ()=>{
    const a = (state.qaAudits||[]).find(x=>x.id===b.dataset.id); if(!a) return;
    if(!confirm(`Delete the audit for ${a.agentName} (Call ${a.callId})? This can't be undone.`)) return;
    state.qaAudits = state.qaAudits.filter(x=>x.id!==a.id);
    logAudit("qa_audit_delete", `Deleted quality audit for ${a.agentName} (Call ${a.callId})`, {empId:a.agentEmpId, before:{callId:a.callId, score:a.score, auditor:a.auditorName}});
    saveState(); showToast("Audit deleted"); render();
  }));
  const dl = content.querySelector("#qaDownloadBtn");
  if(dl) dl.addEventListener("click", qaDownloadExcel);
}

/* ---------- Audit detail (read-only) ---------- */
function qaDetailHtml(id){
  const a = qaVisibleAudits().find(x=>x.id===id);
  if(!a){ qaViewId = null; return qaAuditsHtml(); }
  let lastCat = null;
  const rows = QA_PARAMS.map(p=>{
    const v = a.params[p.n] || {tag:"",error:"",notes:""};
    const span = QA_PARAMS.filter(x=>x.cat===p.cat).length;
    const catCell = p.cat !== lastCat ? `<td rowspan="${span}" style="font-weight:600;">${esc(p.cat)}</td>` : "";
    lastCat = p.cat;
    const tint = v.tag==="No" ? "rgba(220,60,60,.12)" : v.tag==="N/A" ? "rgba(230,170,40,.12)" : "rgba(60,170,90,.08)";
    return `<tr style="background:${tint};">${catCell}<td><b>${p.n}.</b> ${esc(p.name)}</td><td style="text-align:center;">${p.pts}</td><td><b>${esc(v.tag)}</b></td><td>${esc(v.error||"")}</td><td style="font-size:12px;white-space:normal;min-width:200px;">${esc(v.notes||"")}</td></tr>`;
  }).join("");
  const kv = (l,v)=>`<div><div style="font-size:11px;color:var(--text-dim);">${esc(l)}</div><div>${v||"—"}</div></div>`;
  return `<div class="section-body">
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" id="qaBackBtn">← Back to audits</button>
      ${qaCanCorrect(a) ? `<button class="btn btn-accent btn-sm qa-corr-btn" data-id="${esc(a.id)}">✏️ Correct this audit</button>` : ""}
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin:14px 0;flex-wrap:wrap;">
      <div style="font-size:20px;font-weight:600;">${esc(a.agentName)}</div>
      <span class="badge ${qaScoreClass(a.score)}" style="font-size:16px;padding:4px 12px;">${qaPct(a.score)}</span>
      <span style="font-size:12px;color:var(--text-dim);">${a.achievedPoints} / ${a.totalPoints} points</span>
      ${a.ztp==="Not Met" ? `<span class="badge badge-red">Zero Tolerance not met — ${esc(a.ztpError)}</span>` : ""}
      ${!isAgent() && (a.corrections||[]).some(c=>c.silent) ? `<span class="badge badge-yellow" title="Silent correction — the agent was not notified">Corrected</span>` : ""}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
      ${kv("Supervisor", esc(a.supervisor))}${kv("Call ID", esc(a.callId))}${kv("Call reason", esc(a.callReason))}
      ${kv("Call start", esc(qaDateTimeLabel(a.callStart)))}${kv("Call end", esc(qaDateTimeLabel(a.callEnd)))}
      ${kv("Audit date", esc(a.auditDate))}${kv("Auditor", esc(a.auditorName))}
    </div>
    <div class="table-wrap"><table class="mini-table" style="width:100%;min-width:1020px;"><thead><tr><th>Category</th><th>Parameter</th><th style="text-align:center;">Points</th><th>Tagging</th><th>Error category</th><th>Notes</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin-top:14px;"><div style="font-size:11px;color:var(--text-dim);">Call summary</div><div style="white-space:pre-wrap;">${esc(a.summary)||"—"}</div></div>
    ${a.exactError || a.cause ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px;">${kv("Exact error", esc(a.exactError))}${kv("Cause of the error", esc(a.cause))}</div>` : ""}
    ${a.coaching ? `<div style="margin-top:16px;border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:8px;padding:14px;background:var(--surface-2);">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">💡 Coaching summary</div>
      <div style="white-space:pre-wrap;font-size:13px;">${esc(a.coaching)}</div></div>` : ""}
    ${qaCorrectionHistoryHtml(a)}
  </div>`;
}
function qaCorrectionHistoryHtml(a){
  const list = (a.corrections||[]).filter(c=> !isAgent() || !c.silent).slice().reverse();
  if(!list.length) return "";
  const items = list.map(c=>`<div style="border-top:1px solid var(--border);padding:10px 0;">
      <div style="font-size:12.5px;"><b>${esc(qaDateTimeLabel((c.at||"").slice(0,16)))}</b> · ${esc(c.by)}${c.silent ? ` · <span class="badge badge-yellow">Silent</span>` : ""} · score ${qaPct(c.scoreBefore)} → <b>${qaPct(c.scoreAfter)}</b></div>
      <div style="font-size:12.5px;margin-top:4px;white-space:normal;"><span style="color:var(--text-dim);">Reason:</span> ${esc(c.reason)}</div>
      <details style="margin-top:4px;"><summary style="cursor:pointer;font-size:12px;color:var(--text-dim);">${(c.changes||[]).length} change${(c.changes||[]).length===1?"":"s"}</summary>
        <div style="font-size:12px;white-space:normal;">${(c.changes||[]).map(x=>`<div>• ${esc(x.field)}: <span style="text-decoration:line-through;color:var(--text-dim);">${esc(x.from)}</span> → <b>${esc(x.to)}</b></div>`).join("")}</div></details></div>`).join("");
  return `<div style="margin-top:16px;border:1px solid var(--border);border-radius:8px;padding:6px 14px;background:var(--surface-2);">
    <div style="font-size:13px;font-weight:600;padding-top:8px;">🕘 Correction history</div>${items}</div>`;
}

/* ---------- Excel export — the workbook's DUMP layout (75 columns A..BW) ---------- */
function qaDumpRow(a){
  const tag = n => (a.params[n]||{}).tag || "", err = n => (a.params[n]||{}).error || "", note = n => (a.params[n]||{}).notes || "";
  return [
    a.agentName, a.supervisor, a.callId, a.auditorName, a.callReason,
    qaDateTimeLabel(a.callStart), qaDateTimeLabel(a.callEnd), a.auditDate,
    a.ztp, a.ztpError, a.totalPoints, a.achievedPoints, a.score,
    ...QA_PARAMS.map(p=>tag(p.n)), ...QA_PARAMS.map(p=>err(p.n)), ...QA_PARAMS.map(p=>note(p.n)),
    a.summary, a.exactError, a.cause, qaFormatTime(a.callStart), qaFormatTime(a.callEnd),
    a.coaching || "",   // appended after the workbook's last column (BW) so existing pivots/column letters don't move
    (a.corrections||[]).length || "", ((a.corrections||[]).slice(-1)[0] || {}).reason || ""
  ];
}
function qaDownloadExcel(){
  if(typeof XLSX === "undefined"){ showToast("⚠ Excel library didn't load — check your connection and try again"); return; }
  const list = qaFilteredAudits().slice().sort((a,b)=> (a.auditDate+a.createdAt).localeCompare(b.auditDate+b.createdAt));
  const aoa = [QA_DUMP_HEADERS, ...list.map(qaDumpRow)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  list.forEach((_,i)=>{ const c = ws[XLSX.utils.encode_cell({r:i+1, c:12})]; if(c) c.z = "0.0%"; }); // Score column (M)
  ws["!cols"] = QA_DUMP_HEADERS.map((h,i)=>({wch: i<13 ? 16 : i===QA_DUMP_HEADERS.length-1 ? 70 : i>=QA_DUMP_HEADERS.length-6 ? 30 : 22}));
  ws["!freeze"] = {xSplit:0, ySplit:1};
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DUMP");
  const label = qaFilter.month ? qaMonthLabel(qaFilter.month).replace(" ","_") : "All";
  XLSX.writeFile(wb, `AHC_QA_Audits_${label}.xlsx`);
  showToast(`✅ Downloaded ${list.length} audit${list.length===1?"":"s"}`);
}


/* ---------- Settings → Quality Audit error categories (Admin / Manager) ----------
   Lets Admin/Manager add (or remove) options in each parameter's Error Category dropdown without a
   code change. Stored in state.settings.qaErrorCategories = {"<param no>": [options…]}; a parameter with
   no entry uses its built-in list. Saved with an atomic server transaction (same approach as LEO
   reasons) so two admins editing at once can't overwrite each other. Removing an option never touches
   audits already submitted — they keep the text they were saved with. */
let qaSettingsParam = 1;

async function qaMutateErrorCategories(mutate){
  if(typeof fbReady!=="undefined" && fbReady && typeof updateSettingsFieldTransactional==="function"){
    return await updateSettingsFieldTransactional("qaErrorCategories", mutate);
  }
  const next = mutate(JSON.parse(JSON.stringify(state.settings.qaErrorCategories || {})));
  state.settings.qaErrorCategories = next;
  saveState();
  return next;
}
// New options go before the trailing "Others" / "Not Applicable" entries so those stay last.
function qaInsertOption(list, val){
  let i = list.findIndex(x=> /^others?$/i.test(x));
  if(i < 0) i = list.findIndex(x=> /^not applicable$/i.test(x));
  if(i < 0) i = list.length;
  list.splice(i, 0, val);
  return list;
}

function qaSettingsHtml(){
  const p = QA_PARAMS.find(x=>x.n===qaSettingsParam) || QA_PARAMS[0];
  const custom = Array.isArray((state.settings.qaErrorCategories||{})[p.n]);
  const rows = qaErrorOptions(p).map((o,i)=>`<tr><td>${esc(o)}</td><td style="text-align:right;"><button class="icon-btn qa-cat-del" data-i="${i}" title="Remove this option">✕</button></td></tr>`).join("");
  return `
    <div class="section">
      <div class="section-head"><div class="section-title"><span class="eyebrow">✎</span>Quality Audit — error categories</div></div>
      <div class="section-body">
        <div class="form-inline" style="margin-bottom:12px;">
          <div class="field" style="min-width:300px;"><label>Parameter</label>
            <select id="qaCatParam" style="width:100%;">${QA_PARAMS.map(x=>`<option value="${x.n}" ${x.n===p.n?"selected":""}>${x.n}. ${esc(x.name)}${Array.isArray((state.settings.qaErrorCategories||{})[x.n]) ? " ✎" : ""}</option>`).join("")}</select></div>
        </div>
        <div class="table-wrap"><table class="mini-table" style="width:100%;min-width:320px;"><thead><tr><th>Dropdown option (${qaErrorOptions(p).length})</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="form-inline" style="margin-top:12px;">
          <div class="field" style="min-width:300px;"><label>New option</label><input type="text" id="qaCatNew" placeholder="e.g. Wrong claim status given" style="width:100%;"></div>
          <button class="btn btn-sm btn-accent" id="qaCatAddBtn">+ Add option</button>
          ${custom ? `<button class="btn btn-sm btn-ghost" id="qaCatResetBtn">Reset this list to default</button>` : ""}
        </div>
        <div class="help-note">These are the choices auditors see in the <b>Error category</b> dropdown when they tag a parameter <b>No</b>. New options are added above "Others" / "Not Applicable". Parameters marked ✎ have a customised list. Removing an option doesn't change audits that were already submitted.</div>
      </div>
    </div>`;
}

function qaSettingsWire(content){
  const sel = content.querySelector("#qaCatParam");
  if(!sel) return;
  const p = ()=> QA_PARAMS.find(x=>x.n===qaSettingsParam);
  sel.addEventListener("change", ()=>{ qaSettingsParam = Number(sel.value); render(); });
  const fail = e=>{ console.error("QA error categories", e); showToast("⚠ Couldn't save — check your connection and try again"); };
  const base = (map,n)=> (Array.isArray(map[n]) && map[n].length ? map[n] : QA_PARAMS.find(x=>x.n===n).errors).slice();
  const add = async ()=>{
    const inp = content.querySelector("#qaCatNew"), val = inp.value.trim();
    if(!val){ showToast("Enter an option"); return; }
    const n = qaSettingsParam; let dup = false;
    try{
      await qaMutateErrorCategories(map=>{
        const list = base(map,n);
        if(list.some(x=>x.toLowerCase()===val.toLowerCase())){ dup = true; return map; }
        map[n] = qaInsertOption(list, val); return map;
      });
    }catch(e){ return fail(e); }
    if(dup){ showToast("That option already exists"); return; }
    logAudit("qa_errorcat_add", `Added Quality Audit error category "${val}" to parameter ${n}. ${p().name}`, {after:{param:n, value:val}});
    showToast("✅ Option added"); render();
  };
  content.querySelector("#qaCatAddBtn").addEventListener("click", add);
  content.querySelector("#qaCatNew").addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); add(); } });
  content.querySelectorAll(".qa-cat-del").forEach(btn=> btn.addEventListener("click", async ()=>{
    const n = qaSettingsParam, val = qaErrorOptions(p())[Number(btn.dataset.i)];
    if(val==null) return;
    if(qaErrorOptions(p()).length <= 1){ showToast("A parameter needs at least one option"); return; }
    if(!confirm(`Remove "${val}" from the dropdown? Audits already submitted keep it.`)) return;
    try{ await qaMutateErrorCategories(map=>{ map[n] = base(map,n).filter(x=>x!==val); return map; }); }catch(e){ return fail(e); }
    logAudit("qa_errorcat_delete", `Removed Quality Audit error category "${val}" from parameter ${n}. ${p().name}`, {before:{param:n, value:val}});
    render();
  }));
  const reset = content.querySelector("#qaCatResetBtn");
  if(reset) reset.addEventListener("click", async ()=>{
    const n = qaSettingsParam;
    if(!confirm("Reset this parameter's dropdown to the original list from the rubric?")) return;
    try{ await qaMutateErrorCategories(map=>{ delete map[n]; return map; }); }catch(e){ return fail(e); }
    logAudit("qa_errorcat_reset", `Reset Quality Audit error categories for parameter ${n}. ${p().name} to default`, {});
    render();
  });
}
