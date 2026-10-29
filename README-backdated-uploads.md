# v25 — Present %, backdated Quality Audits, backdated PKT results

No new Firestore collections and no rule changes: backdated audits live in `trackerQualityAudits`,
backdated PKTs in `trackerPkt` / `trackerPktAttempts` (rules already cover them).

## 1. Dashboard — Present %
Present % = Present days ÷ working days. Working days = Present + Half day + Leave (days the agent was
expected to work and has an attendance mark). WeekOff, Client holiday and unmarked days are left out.
Shown as a new KPI card ("Present %", with "x of y working days"), as Present / Present % columns in the
Attention / Week / Month tables, on the agent Report Card, in the Excel export (Weekly + Monthly sheets) and in
Month History archives. Change the definition in `isWorkingAttendance()` in js/daily.js.

## 2. Quality Audit → "📤 Upload past audits" (Admin / Manager / Quality)
File layout = the same 75 columns as "Download Excel" on Audits (the old workbook's DUMP tab), so the old DUMP
rows can be pasted straight in and an exported file can be edited and re-uploaded. "Download template" gives
the headers, a "How to fill" sheet and a roster-names sheet.
- Same validation as a live audit (agent on roster, all 19 tagged, N/A only where allowed, "No" needs an error
  category, ZTP Not Met needs a policy). Score is always recalculated from the tags.
- Preview before saving; problem rows are skipped and can be downloaded as an issues file.
- Duplicate Call IDs: skip (default) or import anyway.
- Stored with `backdated:true`, original audit date, uploader, batch id. Shows a "Backdated" badge in the list and
  a banner on the detail page; list can be filtered "Backdated only". Sorted by audit date, not upload time.
- Agents are NOT notified (no sidebar badge / "New" tag) unless "Notify agents" is ticked.
- "Undo upload" removes a whole batch (Admin, or the person who uploaded it).
- Excel download gained 3 columns at the end: Backdated, Uploaded By, Uploaded On.

## 3. PKT → "📤 Upload past results" (Quality / Admin / Manager)
Upload the RESULTS of PKTs held earlier. One file may contain several PKTs.
Columns: PKT Title, Test Date, Emp ID and/or Agent Name, Score (%) or Correct + Total Questions,
Pass Mark (%), Time Taken (min), LOB. Title / date / LOB / pass mark can also be set once in the boxes on screen.
- Rows with the same Title + Test Date = one PKT, saved as a closed "Backdated" PKT (no questions; agents can't take it).
- Score from Correct/Total when both given; else Score (%). 0–100. Pass/Below vs pass mark.
- Score is written to Daily Data → PKT Score (%) on the test date. Existing rule kept: ONE PKT score per agent per
  week. If the week already has one, the result is kept on the PKT, flagged "Week already scored", and Daily Data is
  left alone — unless "Replace the week's score in Daily Data" is ticked. The preview shows who is affected.
- Agent already has a result for that PKT: skip (default) or replace.
- Results page, agent's "My PKT results", Excel export (single sheet) and the Dashboard all handle backdated PKTs.
  The live PKT dashboard card and default Results selection ignore backdated PKTs.
- "Undo upload" removes the PKTs/results and takes the scores it wrote back out of Daily Data
  (a score it replaced is put back).

## 4. Fix included — Firestore 500-write limit
`pushToFirestore()` used a single batch; Firestore rejects batches over 500 writes, so a big upload would have
failed to sync. Writes are now committed in chunks of 400 (`chunkedBatch()` in js/firebase.js).

## New / changed files
New: js/qa-backdated.js, js/pkt-backdated.js
Changed: js/daily.js, js/dashboard.js, js/history.js, js/import-export.js, js/qualityaudit.js, js/pkt.js,
js/firebase.js, index.html (new script tags, cache-bust ?v=24)
