# CLAUDE.md — Align360 project memory

> **How this works:** this file is the project's memory. It lives inside the project zip. Start every new chat by uploading the latest zip
> (or pasting this file). Claude must read it first, follow section 1, and add a changelog entry (section 8) for every change or feature.
> It is only as current as the last zip you saved — always keep the newest zip.
> Detailed how-to / setup / feature guides are in `README.md` (the single README). This file holds the *why*, the decisions, the status and the history.

Last updated: 2026-11-02 · Current version: **v40** · Owner: Anjali (builds and administers Align360)

## 1. Rules (always follow)
1. **One README only.** `README.md` is the single README. Never create `README-*.md`, `README2.md`, `NOTES.md` or any other README/docs file.
   Put new documentation into a section of `README.md`; update the existing section when a feature changes.
2. **Update this file after every feature or change.** Add a changelog entry (section 8): what was done, files changed, tested, follow-ups.
   Also update, when affected: "Last updated" / version, section 4 (features), section 5 (decisions), section 6 (open decisions), section 7 (known issues).
3. **Update `README.md`** whenever behaviour, setup, roles or files change. Both files go in every delivered zip.
4. **Bump the cache-bust** (`?v=NN`) on all asset tags in `index.html` whenever JS/CSS changes; bump the version here and in README.
5. **Deliver a zip** of the whole project named `align360-<short-description>-vNN.zip`. Work on a copy; never edit the upload in place.
6. **Run the tests** (README §10) before delivering anything that touches `js/ally-*.js`, `js/auth.js`, role/tab logic in `js/app.js`, or `functions/`. Report results honestly.
7. **No secrets in the app.** No API keys, passwords or tokens in `index.html`, `js/` or `functions/.env`. The AI key lives only in the Firebase secret `LLM_API_KEY`.
8. **Don't change what wasn't asked.** If something else looks wrong, log it in section 7 and tell the owner.
9. **Working style (owner's instruction):** don't be a yes-man. Analyse a request or strategy first, say what is wrong with it, give a reality check, then build.
10. **Keep the stack:** static vanilla JS, no build step, no frameworks, unless the owner decides otherwise.
11. **Record decisions.** When the owner makes or changes a decision in chat, add it to section 5 the same turn.

## 2. Session checklist
**Start:** read this file → read the relevant `README.md` section → check sections 6–7 → say what you will change.
**End:** tests run → `README.md` updated → section 4/5/6/7 updated if affected → changelog entry added → version bumped (if code changed) → zip delivered → 2–3 line summary to the owner.

## 3. What the project is
**Align360** is a web console for a support / contact-centre operations floor (appears to be healthcare-claims support, judging by the LOBs Claims / Eligibility / UM Intake, ServiceNow notes and IPA/vendor lookups).
It replaces a spreadsheet-based "Team Performance Tracker", the Excel "AHC Calibration Form" quality workbook, scattered Word SOPs and hand-edited ServiceNow notes with one shared real-time app.
It serves Admin, Manager/WFM, Team Leaders, Trainers, SMEs, Quality analysts, Clients and Agents, each with a role-scoped view.
Owner builds and administers it and shares it as a zip of static files (no repository).

**Stack:** static HTML + vanilla JS + CSS (no build, no framework) · Firebase Firestore (project `align360-6fa04`) with anonymous auth · one Cloud Function `allyLlm`
(Node 22, `asia-south1`, optional) calling Gemini/OpenAI · CDN libs: SheetJS 0.18.5, ExcelJS 4.4.0, Chart.js 3.9.1, Firebase compat 12.16.0 · bundled mammoth.js for Word import.
~20k lines across ~50 files. Largest: `qualityaudit.js` 1461, `components.css` 1041, `app.js` 1005, `ally-engine.js` 951, `leo.js` 925, `settings.js` 917, `firebase.js` 887.
**Pointers:** architecture, structure, data model, setup → `README.md` §4–8.

**Conventions seen in the code:** one `js/<page>.js` per page registered in `index.html` (order matters) · role gates are reused, not re-invented (Ally is built on them) ·
Firestore writes chunked at 400 · one Firestore doc per audit / PKT / attempt so concurrent writers don't overwrite · Production vs Sandbox via a collection-prefix wrapper in `js/env.js`.

## 4. Features — what is built (status as of v40)
| Area | Status | Notes |
|---|---|---|
| Dashboard (team, Client, Quality variants), report cards, charts, Excel export | Done | KPIs: AHT 550s/650s, Call Quality 90/80, PKT 90/80, Total Calls 60/40 (target/threshold, editable); **Present %** added v25 |
| Daily Data (attendance + KPIs), CSV/XLSX import | Done | KPI cells unlock only for Present / Half day |
| Daily Summary (LOB-wise numbers) | Done | TL and above |
| Break Schedule + break reminders | Done | Sound + flashing tab title |
| Shift seasons (US daylight saving) | Done (v29) | Dated +/-1 hr changes to every shift/break; confirm or auto-apply; notice pop-up; Settings editor |
| Team Roster (incl. cross-trained LOBs `extraLobs`) | Done | Trainer read-only |
| Leave Tracker | Done | Derived from Daily Data attendance |
| Month History + Process Updates | Done | Rich-text updates, unread badges, pin |
| LEO supervisor-call queue + monthly report | Done | Round-robin to supervisor rotation; transactions on create/escalate; **SME role** works assigned calls |
| Quality Audit | Done | 19-parameter rubric, scoring, corrections with reason, 75-col Excel DUMP export; **backdated audit upload** (v25) |
| PKT weekly knowledge test | Done | Kahoot-style creator and play, live results, score into Daily Data; **backdated results upload** (v25) |
| Knowledge Base | Done | Articles, Quick answers, topics, feedback, no-result search log; **Word import** (rule-based); **full documents** + ranked search (v19) |
| Documentation templates | Done | Token syntax, Call details panel, dispositions, IPA directory, copy-to-ServiceNow |
| Ally assistant | Done | Rule-based, role-scoped; conversation/spelling/voice (v17); cross-trained LOBs; optional AI rewording |
| Audit Log | Done | Admin only, append-only rule snippet |
| Settings, backups, Production ↔ Sandbox | Done | Restricted Settings for SME and Quality |
| EWS | **Placeholder** | "Work in progress" |
| Employee Engagement Zone | **Placeholder** | "Work in progress" |
| Contents of v26 and v27 specifically | **Unknown** | Not documented anywhere; ask the owner |

## 5. Decisions (what we decided, and why)
Sources: the old READMEs, code comments and what the owner told Claude. Decisions made in earlier chats that were never written down are missing — owner, please correct/add.
| # | Decision | Reason |
|---|---|---|
| D1 | Static vanilla-JS app, no build step; shared as a zip | Easy to host and hand over; owner's choice |
| D2 | KB import and Ally are **rule-based and run in the browser**; documents and data never leave it | Privacy; no AI cost or key exposure |
| D3 | AI (Gemini/OpenAI) only **rewords an unclear question** via a Cloud Function; it never sees app data and never writes the answer | Data protection; a tricked model can only produce a question that still goes through `AllyScope` |
| D4 | AI key only as Firebase secret `LLM_API_KEY`; function rate-limited (12 req/min per visitor, max 5 instances) | Anything in `js/` is readable by every user |
| D5 | Ally sits bottom-right on every page for all roles, answers only from Align360 data (no internet) | Owner's request |
| D6 | **Data rule:** Agents see only their own data; other roles see what their pages show. `js/ally-scope.js` is the *only* Ally file that reads app data and reuses the app's own gates; where the app is looser than intended, Ally takes the stricter scope | Owner's request; consistency with role changes |
| D7 | Ally never exposes passwords/hashes/security answers/user list, PKT answer keys, roster notes, silent QA corrections; asking about a non-visible colleague gets the same refusal whether or not they exist | Prevent probing |
| D8 | New **SME role** works supervisor calls in LEO and sees only calls assigned to them | Owner's request |
| D9 | ServiceNow stays **copy/paste**; no API integration | No backend, credentials or InfoSec review needed; still removes the time cost |
| D10 | Documentation: Call details and fill values are **never persisted**; usage is audit-logged by identity only; disposition list and IPA directory are **Admin-only** to edit | Privacy; avoid drift between inconsistent variants |
| D11 | Quality scoring copied from the workbook: only "No" loses points, N/A keeps full points, Zero Tolerance "Not Met" scores 0; app additionally **requires every parameter tagged** and an error category for each "No" | Workbook allowed blanks that silently scored full |
| D12 | Audit corrections need a mandatory reason, recalculate the score, and are kept on the audit and in the Audit Log | Accountability |
| D13 | **One PKT score per agent per week** in Daily Data; extra attempts are kept and flagged "Week already scored" (Quality can override) | Existing Daily Data rule |
| D14 | Present % = Present ÷ (Present + Half day + Leave); WeekOff, Client holiday and unmarked days excluded | Definition in `isWorkingAttendance()` |
| D15 | KB and backdated uploads add **no new Firestore collections** and need no rule changes | Rules are edited by hand in Console |
| D16 | KB stores a web rendering of the Word file, **not** the original `.docx`; documents split into ≤ ~700 KB parts, picture budget 4.5 MB per document | Firestore document size limits |
| D17 | Re-importing an SOP with the same file name replaces it; hand-edited articles default to Skip; import defaults to **drafts** | Never overwrite people's edits |
| D18 | Backdated uploads: agents **not notified** by default; duplicates skipped by default; batch can be undone | Avoid noise and double counting |
| D19 | Firestore writes committed in chunks of 400 | Firestore rejects batches over 500 |
| D20 | **One README only; CLAUDE.md updated after every feature** (project memory) | Owner's instruction, 2026-11-02 |
| D21 | Deliver changes as a whole-project zip | Owner shares the app as a zip |
| D23 | **Client sees totals only, never individual agents' numbers** (decided 2026-11-02). Dashboard already complies; Ally and the raw data in the browser do not yet — see issue #4 | Owner's decision |
| D24 | **Move to real per-user logins** (Firebase Authentication) with strict server-side Firestore rules; the current browser-checked login is to be retired (decided 2026-11-02) | Site is public; role limits are UI-only |
| D25 | Hosting repo on GitHub is **public**; it holds, and the live site runs, `align360-quality-audit-v26`. The v27 zip (newest) has **not** been deployed (owner, 2026-11-02) | Fact, not a choice |
| D27 | Interim `firestore.rules` (allowlist of the 11 production collections + append-only Audit Log + `sbx_` sandbox) to be published as a stopgap. It does **not** stop outsiders reading/deleting data; only per-user logins (D24) do. Not yet tested against the live app | Cheap, reversible improvement while D24 is built |
| D26 | The old Firestore-rules comment recorded an earlier decision to keep the app's own TL-password / agent-picker login as the only gate. **Superseded by D24** (owner, 2026-11-02) | Public site; rules allow any anonymous visitor |
| D28 | **US daylight-saving shift changes are data, not code:** a dated schedule in `settings.shiftSeasons`. Nov 2 2026 = +1 hr (asks first, because the roster may already hold the new times); Mar 15 2027 = −1 hr (auto). Later years are added automatically from the US rule (2nd Sun Mar / 1st Sun Nov, effective the Monday after). Everyone sees a pop-up from 7 days before | Owner 2026-11-02: three shifts (5:30 pm–3:30 am, 6:30 pm–4:30 am, 7:30 pm–5:30 am) each move +1 hr from Nov 2 for ~4 months, then back |
| D22 | Web app is hosted on **GitHub Pages**: https://align360-ahc.github.io/1/ (Cloud Function and Firestore stay on Firebase) | Owner's setup, stated 2026-11-02 |

## 6. Open decisions and planned work
**Decided 2026-11-02:** Client = totals only (D23) · real per-user logins (D24) · hosting = GitHub Pages, public repo (D22, D25) · every user has an email address · live site = v26.
**Still open:**
1. Deploy v27? v27 is the newest build; the contents of v26→v27 are undocumented. Owner decides when to publish; security work builds on v27.
2. How many users, and are any shared logins (one login used by several people)? Per-user logins need one email per person.
3. License; screenshots; what EWS and the Engagement Zone should become.

**What the data layout allows (checked in `js/firebase.js`):**
- Rule-friendly already: `trackerDaily` (one doc per agent per month, has `empId`), `trackerRoster` (one doc per agent), `trackerQualityAudits`, `trackerPkt`, `trackerPktAttempts`, `trackerHistory`, `trackerDailySummary` (one doc each).
- **Must be reshaped before rules can protect them:** `trackerSettings/main` (one doc holding settings **and the users list with hashes**), and the single documents in `trackerMisc` (`leoCalls`, `processUpdates`, `shiftSwaps`, `documentationTemplates`, `ipaDirectory`) — one document cannot be partly readable.

**Planned work — security migration (D24). Nothing started yet. Order:**
- **Step 0 — today, no code (0b: publish the interim `firestore.rules`; keep the old rules text so you can revert instantly):** (a) back up all data now (anyone can currently wipe it): Firebase Console → Firestore → export, or run the app's Settings backup as Admin and keep the file; (b) take the audit-log rule from `firestore.rules.audit-log-snippet.txt` only if it does not break the app (test in Sandbox first); (c) keep real caller/member details out of audit notes and call summaries.
- **Step 1 — sign-in:** Firebase Authentication (email + password, email-link reset). Admin-only Cloud Function creates users and sets **custom claims** (role, empId, team/TL, LOBs, viewAll, canAudit…). Enable the Email/Password provider; Blaze plan already needed for the AI function.
- **Step 2 — reshape data:** move the users list out of `trackerSettings/main` into per-user docs (no hashes anywhere); split `trackerSettings` into a public-to-staff doc and an admin-only doc; split `trackerMisc` arrays into one document per item (LEO call, process update, swap, template) so rules can scope them (e.g. SME sees only calls assigned to them).
- **Step 3 — rules:** complete `firestore.rules` per collection and role (agent: own docs only; TL/SME: own team; Client: **no per-agent collections at all** — totals come from a small aggregate doc maintained by a Cloud Function; Quality/Trainer/Admin per the role matrix), delete-protection and append-only audit log; test with the Firebase emulator, including "attacker" tests; **then** switch off anonymous sign-in for the app.
- **Step 4 — Client totals-only in Ally:** no people list, aggregates only, refuse "top N / at risk / who" answers; add Client leak tests to `tests/`.
- **Rollout:** build and test in Sandbox, migrate users with a one-time script (send each person a password-set email), keep the old site until everyone has signed in once, then tighten rules and turn off anonymous auth. Each step is its own release and changelog entry.
- **Reality check on effort:** this is the largest change the app has had (auth, data reshaping and every role's rules). Expect it across many sessions; the rules cannot be switched on until the app code and data are reshaped, or the app will stop working.

## 7. Known issues and risks (open — tell the owner before building on them)
| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | **CRITICAL** | **Production Firestore rules (pasted by owner 2026-11-02) are `match /{document=**} { allow read, write: if request.auth != null; }`.** Every visitor to the public site silently gets an anonymous sign-in, so **anyone on the internet** (the Firebase config is in the public repo) can read, change or delete **all** data: users and password hashes, roster, audits, PKT, audit log. They can make themselves Admin by editing a user record. No brute-forcing is needed. None of the rules snippets (audit log append-only, KB, PKT, sandbox) are in the pasted rules, so the Audit Log is **not** append-only in production. | Open — fix = Steps 0–3 in section 6 |
| 2 | **High** | Roles and the login are enforced only in the browser (salted SHA-256 compare in `js/auth.js`); every browser downloads all data. Follows from #1; fixed by the same steps. | Open |
| 3 | Medium | Month History: a TL without "Full data access" sees every team's archived rows (`js/history.js` filters Agent and SME only). From old README; not re-verified. | Open |
| 4 | Medium | Client should see totals only (D23). The app's Client dashboard already shows no per-agent tables, but **Ally gives Client per-agent answers** (`reachOf()` returns "org" in `js/ally-scope.js`), and the Client's browser still downloads all agent data (#2). Correction: an earlier note said the Client *Dashboard* shows per-agent rows — that was wrong; the exposure is Ally and the raw data. | Open — Step 4 |
| 5 | Low | `tests/harness.js` default `SRC` is stale; jsdom not in any `package.json`. | Open |
| 6 | Low | No automated tests for any page except Ally. | Open |
| 7 | Info | Firebase web `apiKey` in `js/firebase.js` is public by design; safe only with strict rules (#2). | Note |
| 8 | Info | KB full documents are excluded from the localStorage copy and Settings backup. | By design |
| 10 | High | **Shift swaps ignore the date.** A swap request carries a date but approval permanently exchanges both agents' roster shifts (and "Swap shifts" by WFM is also permanent). A one-day swap therefore never reverts by itself. Needs a per-date shift override (design decision). | Open — owner to decide |
| 11 | Medium | Month History: archiving the same month twice creates two blocks; there is no delete/replace for an archive. Archives made before v33 hold figures built from dates that were one day early. | Open |
| 12 | Medium | Week-offs are hard-coded Saturday/Sunday for everyone (`isWeekend`). If the team's real week-offs differ or rotate, "Apply week-offs" marks the wrong days (it now asks first, listing how much data it would erase). | Open — owner to confirm real week-offs |
| 13 | Medium | Excel cells formatted as % arrive as fractions (0.85 not 85), so a "%" KPI or Daily Summary column could show 0.9% — not verified against the owner's files. | Open — check with a real file |
| 14 | Medium | Process Updates keep attachments (base64) inside ONE Firestore document (1 MiB limit); a guard now blocks posting past ~900 KB, but long-term attachments belong in Firebase Storage. | Mitigated v34 |
| 15 | Low | Audit Log shows only the newest 300 entries, no search/filter/export; timestamps come from the device clock. Not logged: leave, KB/PKT bulk uploads, backdated uploads. | Open |
| 16 | Low | Daily Summary upload has no fill-down for blank date cells and no header-row detection (Daily Data and Roster imports do/now do). | Open |
| 18 | Medium | Backdated Quality-audit and PKT uploads (`js/qa-backdated.js`, `js/pkt-backdated.js`) read CSV with `cellDates:true`; SheetJS may swap day/month on `dd/mm/yyyy` text (the bug fixed for Daily Data in v37). Use .xlsx or `yyyy-mm-dd` dates there until checked. | Fixed v38 |
| 17 | Low | Add-agent form defaults to a 9–6 day shift with 11:00/13:30/16:00 breaks; swap requests let an agent pick anyone on the roster (any LOB) and the other agent is not asked. | Open |
| 9a | Medium | Live site and its GitHub repo are public on the internet (GitHub Pages). On 2026-11-02 its page title read "Team Performance Tracker", not "Align360" (v27 title) — the live build looks older than v27 (unverified). Anything uploaded to the Pages repo is public: do **not** publish `CLAUDE.md`, `README.md`, `tests/`, `functions/` or `.env`; `CLAUDE.md` lists the app's weaknesses. Could not check whether `CLAUDE.md` is already exposed (fetch blocked). | Open — owner to check repo |
| 9b | Medium | Shift seasons: there is no server clock, so a due change is applied only when an Admin/WFM user next opens the app (not at midnight). It shifts stored times by ±delta, so it is protected against double-applying by a Firestore claim, not by recomputation; a failed save after the claim leaves the entry "applied" but the roster unchanged (fix with Revert + Apply). Past dates in Month History/reports show the *current* shift, as shifts are not stored per date. Every roster agent with times is shifted — there is no "ignore DST" flag per agent yet. | Open |
| 9 | Info | Documentation dispositions and IPA lists start empty; Admin must fill them. | By design |

## 8. Changelog (newest first — add an entry after every feature/change)
Entry format: `### YYYY-MM-DD — vNN — title` then **Done**, **Files changed**, **Tested**, **Not done / follow-ups**.

### 2026-11-04 — v40 — "Provider" LOB now appears on existing deployments (LOBs: Claims, Eligibility, UM Intake, Provider)
**Problem:** the owner asked for a 4th LOB, Provider, "in all affected areas". Provider was already a built-in default since v27, but the LOB list is saved data, so any deployment that already had a saved list (the live site, the sandbox) kept only 3 LOBs unless an Admin added it by hand.
**Done:** new `ensureProviderLobSeeded()` (`js/state.js`) runs once on load, before `LOB_OPTIONS` is mirrored (called from `repairLoadedState` and both load paths in `js/firebase.js`). If the saved list has no Provider it appends it and sets `settings.dailySummary.providerLobSeeded = true`; the flag is saved with the state, so if an Admin later removes Provider it is **not** re-added (this replaces the v27 "deliberately no auto-migration" note, keeping its intent). Fresh/reset installs already include Provider and start with the flag set. Every LOB dropdown/filter/tab (Roster, Daily Data, Dashboard, Client Dashboard, Daily Summary, Quality, KB, Process Updates, Documentation, PKT, Leo, Ally) reads `LOB_OPTIONS`, so no per-page change was needed; there is no per-LOB colour or config table to extend. Also: Ally vocabulary gets "provider/providers" (`js/ally-nlu.js`); two code comments updated.
**Existing data:** agents are not auto-assigned; set their LOB in Roster (or re-import the roster; "Provider"/"Providers" in the LOB column now matches). Daily Summary Provider rows start empty.
**Tested:** Node logic test of the migration (existing list gets Provider once; admin removal sticks; case-insensitive duplicate guard); syntax checks. Not clicked through in a browser.

### 2026-11-04 — v39 — Daily Data: numbers shown as whole numbers
**Done:** owner asked for no decimals in Daily Data. `fmt2()` in `js/daily.js` became `fmtWhole()`: standard rounding to a whole number (699.449 → 699, 699.50 → 700, 50.49 → 50, 50.50 → 51), applied to the editable cells and the SME read-only view; input step is now 1 for every KPI. **Display only:** stored values keep their decimals, so averages, colours, the Dashboard and exports still use the exact numbers. Attendance % (e.g. 91.7%) is not a KPI cell and still shows one decimal.
**Tested:** syntax check and a quick Node check of the rounding examples; not clicked through in a browser.

### 2026-11-04 — v38 — Backdated Quality-audit and PKT uploads: CSV dates no longer swap day/month
**Done:** same fix as v37 applied to `js/qa-backdated.js` (`qaUpReadAoa`) and `js/pkt-backdated.js` (file reader): CSV is read with `raw:true` so cells stay text and `parseFlexibleDate` (with the page's date-format choice) reads `dd/mm/yyyy` correctly. Excel (.xlsx) reading is unchanged. Known issue #18 closed. Text numbers are already handled by `qaUp*` / `pktBdNum` (a "85%" text cell now reads as 85, which the existing logic treats correctly).
**Tested:** syntax checks; the underlying SheetJS behaviour was reproduced in v37 (22/59 wrong before, 0 after). Not clicked through in a browser; please try one small CSV in each upload (check the preview dates before importing).

### 2026-11-04 — v37 — Daily Data: 2-decimal display + CSV import landing on the wrong weekday
**Done:** (1) Daily Data number cells (editable and SME read-only) now show at most 2 digits after the decimal point via `fmt2()` in `js/daily.js`; display only, stored values are unchanged; CQ/PKT input step is now 0.01. (2) **Root cause of "Feb data on Sunday, Fri/Sat blank":** CSV files were read by SheetJS without `raw:true`, so it guessed dates as MONTH/DAY (02/01/2026 = 2 Jan became 1 Feb), scattering rows onto wrong days and months. Fixed in `readSheetRows()` (`js/import-export.js`): CSV cells stay text and the app's own `parseFlexibleDate` (with the DMY/MDY choice) reads them. Reproduced and verified in Node with SheetJS 0.18.5 (TZ Asia/Kolkata): before 22 of 59 dates wrong, after 0. Excel (.xlsx) date cells were checked in 4 timezones: all correct. Whitespace-only metric cells no longer import as 0.
**Not fixed (same pattern, logged in §7):** `js/qa-backdated.js` and `js/pkt-backdated.js` read CSV with `cellDates:true` and may have the same day/month swap; check before relying on CSV there.
**Existing bad data:** months already imported with the old code keep the wrong dates; clear the affected month(s) and re-import.
**Tested:** syntax checks + the Node reproduction above; not clicked through in a browser.

### 2026-11-04 — v36 — Daily Data: fixed "date scrolls away" with a always-visible "Working on" bar
**Why:** v35 relied on `position:sticky` inside a rowspan table cell. That is unreliable across browsers, and in the owner's browser the date still scrolled out of view.
**Done:** a "Working on" bar (`#dailyWorkingOn`) now sits just above the scrolling table, outside the scroller, so it cannot scroll away. While scrolling it shows the weekday + date of the row at the top of the visible area; when you click or type in a row it shows that row's date and agent name. JS in `js/daily.js` (scroll + focusin listeners, rAF-throttled), CSS `.daily-working-on` in `css/components.css`. The v35 `.sticky-day` wrapper is left in place (harmless, works where the browser supports it).
**Tested:** syntax check only (`node --check`); not tested in a real browser here. **Follow-up:** owner to confirm on the live app; if confirmed, `.sticky-day` can be removed.

### 2026-11-04 — v35 — Daily Data: date and day stay pinned while scrolling
**Done:** the Date and Day cells are rowspans covering all agents of one date; their text is now wrapped in `.sticky-day` (`position:sticky`, `top` = header height, set by JS as `--daily-head-h` on the table wrap). While a date's rows scroll, that date and day stay just under the header; when the next date's block arrives it pushes the old one out. Both row builders (editable and read-only/SME) changed in `js/daily.js`; CSS in `css/components.css`.
**Files changed:** `js/daily.js`, `css/components.css`, `index.html` (?v=35), `CLAUDE.md`. **Tested:** headless Chromium with the real CSS and a 3-date table at 5 scroll positions (current date pinned 1px under the header, replaced by the next date at its boundary); syntax check; `run.js`/`adv.js`/`llm.js` pass. Not viewed in the live app. **Follow-ups:** none.

### 2026-11-04 — v34 — Review of Daily Summary, Break Schedule, Team Roster, Month History, Audit Log
**Why:** owner asked for the same kind of check that found the import date bug. Read all five pages; fixed the clear-cut, low-risk bugs, logged the design-level ones in section 7 (items 10–17).
**Fixed**
- `js/breaks.js`: break reminders for night shifts — a break at 12:00–12:15 AM never reminded (the code only looked at today's date); now also checks tomorrow's occurrence, de-duplicated per break date.
- `js/breaks.js`: approving/rejecting a swap that was already handled (two people clicking) is refused; a double approval swapped the shifts back.
- `js/dailysummary.js`: upload no longer blanks parameters that have no column in the file; "Update" on a duplicate row now merges instead of replacing all values; conflict view shows unmapped params as unchanged; LOB text matched case-insensitively to the real LOBs ("claims" no longer becomes a look-alike LOB).
- `js/import-export.js`: Daily Data import no longer wipes fields without a column in the file (a file with only AHT used to blank Call Quality, PKT, calls and attendance on existing days).
- `js/history.js`: posting a Process Update is blocked when the single Firestore document would pass ~900 KB (attachments are stored inside it).
- `js/daily.js`: "Apply week-offs" asks first and says how many entries already have attendance/numbers that would be erased.
- Audit Log: now records Daily Data import, Roster import, Apply week-offs and Month archive; date column shows the year. (`js/audit.js`, `js/import-export.js`, `js/roster.js`, `js/daily.js`, `js/history.js`)
**Files changed:** `js/breaks.js`, `js/dailysummary.js`, `js/import-export.js`, `js/history.js`, `js/daily.js`, `js/audit.js`, `js/roster.js`, `index.html` (?v=34), `CLAUDE.md`.
**Tested:** Node tests — midnight reminders (5 cases), Daily Data import merge, Daily Summary merge/LOB case (10 checks pass); syntax check all JS; `run.js` LEAKS 0, `adv.js` BAD 0, `llm.js` 8/8. Not run in a browser.
**Not done / follow-ups:** section 7 items 10–17 need owner decisions (esp. 10 swaps by date, 12 real week-offs, 13 % fractions).

### 2026-11-04 — v33 — Excel dates imported one day early (weekend data on the wrong days)
**Why:** owner: uploading Daily Data put Saturday/Sunday data on Friday/Saturday and Sunday got Monday's. Reproduced: in the India time zone SheetJS (`cellDates:true`) returns a date-only Excel cell as **23:59:50 the previous day** (e.g. raw `2026-10-31T18:29:50Z` for 1 Nov), and `parseFlexibleDate` read it with local getters → every imported date was one day early. In US time zones the same file reads correctly, which is why it looked random.
**Done:** `js/import-export.js` `parseFlexibleDate`: Date cells are rounded to the nearest minute and anything within 5 min before midnight counts as the next day; numeric Excel serials are read with UTC getters (previously local → one day early in time zones west of UTC). This single function feeds Daily Data, Daily Summary, backdated Quality audits, backdated PKT results and roster joining dates, so all are fixed.
**Files changed:** `js/import-export.js`, `index.html` (?v=33), `CLAUDE.md`. **Tested:** generated .xlsx (Fri 30 Oct–Mon 2 Nov) read the way the app reads it; correct ISO dates in 7 time zones (Asia/Kolkata, UTC, New York, Los Angeles, Paris, Auckland, Tokyo) incl. numeric serials and text forms; `run.js` LEAKS 0, `adv.js` BAD 0, `llm.js` 8/8. Not run in a browser.
**Known impact / follow-ups:** data imported before this fix is stored one day early in the owner's Daily Data (and joining dates / audit dates / PKT dates from Excel). Re-importing the same file overwrites the correct dates; the one stray day before the file's first date must be cleared by hand. `qa-backdated.js` `qaUpDT` (audit date-time) already rounded to the minute and was not changed.

### 2026-11-03 — v32 — Daily Data: hide number spinners
**Done:** the up/down spinner arrows on the numeric KPI cells of Daily Data are hidden (they only took up space). New class `daily-num` on those inputs (`js/daily.js`) + CSS in `css/components.css`. Typing and keyboard arrow keys still work. Other pages' number inputs (Settings, Daily Summary, etc.) are unchanged.
**Files changed:** `js/daily.js`, `css/components.css`, `index.html` (?v=32), `CLAUDE.md`. **Tested:** syntax check; Node check that the Daily Data cell markup carries the class; not viewed in a browser. **Follow-ups:** none.

### 2026-11-03 — v31 — Owner's real file: "6.30 PM" shift text + no shift end
**Why:** owner sent `Agent_break_schedule.xlsx` (55 agents; columns EmpID, LOB, Agent Name, Shift, Break 1, Lunch, Break 2, TL). Review step flagged all 55 rows and showed Shift "–". Cause: the Shift column is **text with a dot** ("6.30 PM", "7.30 PM", "8.30 PM"); the time parser only accepted a colon. Break columns are real Excel times and already worked. The file also has no shift end.
**Done**
- `js/roster.js` `rosterParseTime`: accepts "6.30 PM" / "6.30PM" (dot separator).
- `rosterReadTimes`: when the file has a shift start but no shift end, end = start + 10 h (`ROSTER_DEFAULT_SHIFT_MIN`; all Align360 shifts are 10 h). Review step shows an info note when no Shift End column is mapped. Also applies to the Break Schedule import (shared reader).
**Files changed:** `js/roster.js`, `index.html` (?v=31), `CLAUDE.md`, `README.md`.
**Tested:** the real file through `readSheetRowsSmart` → `importAgentsFile` in Node (TZ Asia/Kolkata): 55/55 rows read, 0 unreadable; shifts 18:30–04:30 ×13, 19:30–05:30 ×9, 20:30–06:30 ×33; earlier tests re-run. Not exercised in a browser.
**Data observations (not changed):** (1) 26 of 55 rows have Lunch earlier than Break 1 (Break 1 / Lunch columns look swapped; list sent to owner as `Rows_to_check_break_order.csv`); (2) file has **no Joining Date** column → imported agents get today's date as joining date; (3) no Status column → all Active.
**Not done / follow-ups:** owner to confirm the 26 rows and supply joining dates.

### 2026-11-03 — v30 — Shift/break imports made robust (roster + Break Schedule)
**Why:** owner uploaded the shift data and "it's not taking the shift". The actual Excel was never seen, so every cause found in the code was fixed: (1) a single "Break" column was recognised by neither importer; (2) the Break Schedule import kept only the first time of a range cell ("6:30 PM - 4:30 AM" lost its end) and had a narrower header list than the roster import; (3) only row 1 of the first sheet was read, so a title row above the header or data on a later sheet gave "no columns"; (4) skipped columns and unmatched names were silent.
**Done**
- `js/roster.js`: new `breaksAll` field ("Break" / "Breaks" / "Break Timings" columns): one cell with up to three `start - end` pairs (comma, slash or space separated) → Break 1, Break 2, Lunch in order. New `readSheetRowsSmart` finds the header row (first 15 rows) and the sheet that best match known column names; falls back to the old reader. Roster import uses it.
- `js/breaks.js`: Break Schedule "Import shifts" now uses the roster import's header recognition and time reader (`detectAgentColumnMap`, `rosterReadTimes`) → ranges, "Shift Timings", "Break", Excel time cells all work; end times no longer reported missing when they came from a range. Result message now lists ignored columns, rows with unreadable times, and the first unmatched names (add them via Team Roster import first).
**Files changed:** `js/roster.js`, `js/breaks.js`, `index.html` (?v=30), `CLAUDE.md`, `README.md`.
**Tested:** Node tests with generated .xlsx (title rows + header on row 3 + data on 2nd sheet; single Shift and Break columns; text ranges; real time cells; existing agent kept) through both importers; earlier v28/v29 tests re-run (37/37); `run.js` LEAKS 0, `adv.js` BAD 0, `llm.js` 8/8. Not exercised in a browser; the owner's real file still unseen.
**Not done / follow-ups:** get the owner's header row + two sample rows to confirm; a combined "Break" cell with a different layout than three ranges would still not parse.

### 2026-11-03 — v29 — US daylight-saving shift changes (Shift seasons)
**Why:** US DST ended 1 Nov 2026, so all shifts moved +1 hr from Mon 2 Nov (5:30→6:30 pm, 6:30→7:30, 7:30→8:30) for about 4 months, then move back. Owner wanted this date-driven with a pop-up.
**Done**
- New `js/shiftseason.js`. Schedule lives in `state.settings.shiftSeasons.entries` (`id, date, deltaMin, auto, label, status pending|applied|done|reverted`). Seeded: 2026-11-02 +60 (asks first) and 2027-03-15 −60 (auto). After any change is applied a next US-rule entry is added so the schedule never runs out.
- Due change is applied by the first Admin/WFM who opens the app on/after the date: shifts every shift/break/lunch time ±60 min (wraps midnight). Non-auto entries show a confirm pop-up with the old→new shift table and an "Already updated — just mark done" option (prevents shifting twice if the roster already has the new times).
- Double-apply protection: the entry is claimed inside a Firestore transaction (`shiftSeasons` added to `LEO_ATOMIC_SETTINGS_FIELDS`), so two admins cannot both apply it. Revert moves everyone back once.
- Notice pop-up for every role except Client: from 7 days before to 7 days after, once per person (localStorage). Agents see only their own shift; others see the shift table (counts only for WFM+).
- Settings → "Shift seasons": edit date/auto while pending, Apply now, Mark done, Revert, delete, add US changes for a year, add a custom change. Audit Log action `shift_season`.
**Files changed:** `js/shiftseason.js` (new), `js/app.js` (render hook), `js/settings.js`, `js/firebase.js`, `js/audit.js`, `index.html` (script tag, ?v=29), `CLAUDE.md`, `README.md`.
**Tested:** Node logic tests (US dates 2026–2028, midnight wrap, apply/idempotent/revert/mark-done, auto in March, notice windows, agent/TL/client roles); syntax check on all JS; `run.js` LEAKS 0, `adv.js` BAD 0, `llm.js` 8/8. Not exercised in a browser or against live Firestore.
**Not done / follow-ups:** per-agent "ignore DST" flag; server-side scheduled apply (needs Cloud Scheduler + Blaze plan); per-date shift history; confirm 2027-03-15 as the effective date with the client.

### 2026-11-02 — v28 — Roster import now reads shift, break and lunch times
**Why:** the Team Roster Excel import had no shift/break fields at all — `importAgentsFile` hard-coded all eight time fields to blank, so times in the file were ignored. Only the separate Break Schedule import read them.
**Done**
- `js/roster.js`: the roster import recognises Shift Start/End, Break 1 Start/End, Break 2 Start/End, Lunch Start/End (header names incl. "Shift Timings", "Break 1", "Lunch"; mappable in the Review step like TL/LOB).
- Accepts Excel time cells, text ("5:30 PM", "17:30", "9 AM") and a range in one cell ("9:00 AM - 6:00 PM", "21:00-06:00") which fills start and end. Missing break/lunch ends are auto-filled (15 / 15 / 30 min), as on the Break Schedule import.
- Agents **already on the roster** are no longer just skipped when the file has times: only their shift/break time fields are updated; name, TL, LOB, status, notes are untouched. Rows with nothing to update are still skipped.
- Review step preview shows Shift and Breaks/Lunch columns, counts existing agents getting time updates, and warns about unreadable time cells (left blank).
- Date cells are rounded to the nearest minute (SheetJS time-only cells carry seconds of drift).
**Files changed:** `js/roster.js`, `index.html` (cache-bust ?v=28), `CLAUDE.md`, `README.md`.
**Tested:** Node test with real .xlsx files (time cells, text ranges, night shift 21:00–06:00, existing agent) in TZ Asia/Kolkata and America/New_York; syntax check. Not exercised in a browser. `run.js`/`adv.js`/`llm.js` not re-run (no change to ally/auth/app/functions).
**Not done / follow-ups:** Break Schedule import (`js/breaks.js`) unchanged; it still only matches the older header spellings.

### 2026-11-02 — v27 (docs only) — Full CLAUDE.md and industry-standard README
**Done**
- Rewrote `README.md` to a standard project README: overview and problem, feature table, role matrix, architecture diagram, getting started (prerequisites, run, connect Firebase, deploy web app and function),
  configuration table, project structure, data model, security (with honest limitations), testing, troubleshooting, roadmap, contributing/release process. The six detailed feature guides were kept as lettered appendices A–F.
- Rewrote `CLAUDE.md` into full project memory: what the project is, stack, feature status table, decisions log (D1–D21), open decisions, known issues, changelog.
- Verified from code: `trackerMisc` holds single docs (`leoCalls`, `processUpdates`, `shiftSwaps`, `documentationTemplates`, `ipaDirectory`); Sandbox prefixes collection names; `firebase.json` configures functions only; EWS and Engagement Zone are placeholders.
**Files changed:** `README.md`, `CLAUDE.md` only. No app code changed; `?v=27` unchanged.
**Tested:** no code touched; baseline tests were green earlier today (LEAKS 0, BAD 0, 8/8). README internal links checked.
**Not done / follow-ups:** no screenshots, license or hosting config (not known); v26/v27 contents unknown; decisions in section 6 pending.

### 2026-11-02 — v27 (docs only) — Interim Firestore rules file
**Done:** added `firestore.rules` (complete file): signed-in required, only the 11 collections the app uses (checked with grep over `js/`), append-only `trackerAuditLog` (app only uses `.add`, so it is compatible), `sbx_*` sandbox open for reset. Honest limit documented in the file: it cannot stop anonymous visitors from reading/deleting data.
**Files changed:** added `firestore.rules`; `CLAUDE.md`, `README.md`. **Tested:** NOT run against Firestore or the emulator (not available here). Owner must publish, then open every page + Sandbox; revert if anything shows Offline.
**Follow-ups:** optional App Check (needs small code change + reCAPTCHA key) as a further stopgap; Steps 1–4 still pending.

### 2026-11-02 — v27 (docs only) — Production rules reviewed, plan refined
**Done:** owner pasted the live Firestore rules; recorded the finding as **critical issue #1** (any anonymous visitor can read/write/delete everything; rules snippets not applied). Recorded that the live site is v26 and every user has an email. Checked the data layout and wrote which collections can be protected as-is and which must be reshaped. Rewrote the migration plan (section 6) as Steps 0–4. Added D26 (earlier "keep app login as the only gate" decision superseded).
**Files changed:** `CLAUDE.md`, `README.md` (security section). **Tested:** docs only; no code changed.
**Follow-ups:** owner to do Step 0 (backup) and say how many users there are and whether any logins are shared.

### 2026-11-02 — v27 (docs only) — Owner decisions recorded
**Done:** recorded D23 (Client totals only), D24 (real per-user logins), D25 (public repo holding v26); rewrote section 6 with open items and a staged security-migration plan; corrected issue #4 (the Client Dashboard has no per-agent tables; Ally does).
**Files changed:** `CLAUDE.md`, `README.md` (roadmap, deploy note). **Tested:** docs only; no code changed.
**Follow-ups:** owner to paste the live Firestore rules, confirm which version is live, and say whether users have email addresses.

### 2026-11-02 — v27 (docs only) — Hosting recorded
**Done:** owner confirmed hosting is GitHub Pages (https://align360-ahc.github.io/1/). Recorded as D22, closed open decision 6.3, added issue 9a, updated README deploy section. Fetched the live page: title is "Team Performance Tracker" (older than v27).
**Files changed:** `CLAUDE.md`, `README.md`. **Tested:** docs only.
**Follow-ups:** owner to confirm repo visibility, what files are in the Pages repo, and whether the live build is current.

### 2026-11-02 — v27 — New LOB "Provider"
**Done:** added `Provider` to the built-in default LOB list (`js/state.js`: `LOB_OPTIONS` and `DEFAULT_STATE.settings.dailySummary.lobs`) so fresh/reset installs include it. Roster import LOB matching (`rosterParseLobs`, `js/roster.js`) now matches any LOB in the list (exact, or name contained in the cell text, e.g. "Providers" → Provider), not just Claims/Eligibility.
**Important:** the live LOB list is **saved data** (`settings.dailySummary.lobs`), so an existing deployment does **not** pick up the new default. An Admin must add it once in **Settings → LOB list → Add** (audit-logged as `lob_add`). Deliberately no auto-migration, so an LOB an admin removed is never silently re-added.
**Files changed:** `js/state.js`, `js/roster.js`, `CLAUDE.md`. **Tested:** Node logic test + syntax check; not exercised in a browser.

### 2026-11-02 — v27 — Roster import: review-mapping step (TL no longer silently left unassigned)
**Problem:** "Import agents (Excel)" auto-detected headers against a fixed list and imported straight away. If the TL header wasn't recognised (e.g. `Team Lead Name`, `Supervisor`), every agent was saved as Unassigned with no prompt or warning.
**Done:** `js/roster.js` — import is now two steps: pick file → **Review agent import** (per-column "Maps to" dropdowns, live preview, warning when no TL column is mapped or some rows have no TL, **Default TL** / **Default LOB** for blank rows, "blank TL cells belong to the TL above" for merged cells). New shared reader `rosterReadImportRows` feeds both preview and import. More TL header aliases (`Team Leader Name`, `Supervisor`, `Reports To`, …). Success toast now reports how many agents ended up with no TL.
**Files changed:** `js/roster.js`, `CLAUDE.md`, `README.md`. **Tested:** Node logic test (detect, fill-down, default TL/LOB, no-TL-column, skip existing); syntax check. Not yet exercised in a browser; `run.js` / `adv.js` / `llm.js` not re-run (no roster import coverage there).

### 2026-11-02 — v27 (docs only) — Project memory + single README
**Done**
- Reviewed the project (~20k lines). Created `CLAUDE.md`. Merged six README files (`README-ally.md`, `README-ally-llm.md`, `README-kb-import.md`, `README-kb-refine.md`, `README-backdated-uploads.md`,
  `README-documentation-templates.md`) into one `README.md` and deleted them. Added the "one README only" rule.
**Files changed:** added `CLAUDE.md`, `README.md`; removed the six `README-*.md`; one comment in `js/ally-scope.js` now points to `README.md`.
**Tested:** `run.js` LEAKS 0, `adv.js` BAD 0, `llm.js` 8/8; `functions/.env` contains no secrets.
**Not done / follow-ups:** security issues #1–2.
