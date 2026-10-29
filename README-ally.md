# Ally — in-app assistant (bottom-right chat bubble)

**What it is:** a chat bubble on every page, for every logged-in role. It answers questions from Align360's own data only.
No internet, no AI service, no API key — it is a rule-based engine running in the browser (same approach as the KB importer).
Nothing is sent anywhere, and the chat is kept in memory only (wiped on logout / when another person signs in).

## The data rule
Ally can never know more than the person's own pages show them. `js/ally-scope.js` is the ONLY file that reads app data;
it is built on the app's existing gates (`computeVisibleTabs`, `scopedRoster`, `scopedLeoCalls`, `qaVisibleAudits`, `kbVisible`, …),
so it follows role changes automatically.

| Login | Ally can answer about |
|---|---|
| Agent | own KPIs, attendance/leave, shift & breaks, swaps, audits, PKT, sup calls; KB / templates / updates for their LOB. No other person, no team figures, no rankings. |
| SME / TL | their team (TL with Full data access: all teams). SME sees only sup calls assigned to them (as in LEO). |
| Trainer | all teams: KPIs, roster, shifts, leave, audits, PKT, LEO, KB, docs, updates |
| Client | Dashboard-level numbers, Daily Summary, LEO, updates, docs (no roster/shifts/audits/PKT/KB) |
| Quality | audits they submitted, PKT results, KB, docs, updates (no KPIs/roster) |
| WFM / Manager / Admin | everything their pages show (plain WFM: no audits/PKT/LEO/KB/docs/updates, as in the app); Audit Log: Admin only |

Never exposed to anyone: passwords/hashes/security answers/user list, PKT questions & answer keys, roster notes, silent QA corrections.
Asking about a colleague gets the same refusal whether or not that person exists (no roster probing). Typing "I am the admin" changes nothing.

## Files
`js/ally-scope.js` (permissions) · `js/ally-nlu.js` (understanding the question) · `js/ally-engine.js` (answers) · `js/ally-ui.js` + `css/ally.css` (widget)
Edits to existing files: `index.html` (css + 4 scripts), `js/app.js` (one line in `__renderInner` that calls `AllyUI.onRender()`).
No new Firestore collections or rules.

## Tests
`tests/` (Node + jsdom): `node run.js` runs 27 questions as each of 9 roles and checks for leaked secrets; `node adv.js` tries to extract
other people's data as Agent / TL / SME / Quality. Run with `SRC=<project folder>`.

## Things I found in the existing app (not changed, worth a look)
1. **Everything is loaded into every browser** (all agents' daily data, audits, etc.); role limits are enforced in the UI only. Ally respects the limits,
   but anyone with DevTools can already read more. Real enforcement needs Firestore rules / a backend.
2. **Month History for TL**: `history.js` filters rows for Agent and SME but not for a TL without Full data access, so such a TL sees every team's archived rows. Ally applies the stricter team scope.
3. **Client** can see per-agent KPI rows on the Dashboard, so Ally answers them too. To make Ally aggregate-only for Client, return no people for Client in `ally-scope.js` (`rawPeople`).

## v17 — conversation, spelling and voice

- **Follow-ups.** Ally remembers the previous question: "who is on leave today" → "check for August" → "and tomorrow" keeps the topic and the "who" shape; "aht of Rahul" → "and cq" → "his leave" keeps the person; "last month" re-runs the last answer for that month. Ally also asks short yes/no questions ("Want me to check the whole month?") — "yes" runs it — and "the first one" picks from a list of matching people.
- **Spelling and chat shorthand.** `js/ally-lang.js` fixes typos (agust, lave, attendence, septembr, tomorow), shorthand (wat, tdy, u, pls, pndng) and number words ("top five"). Corrections are shown ("I read “agust” as “august”") so a wrong guess is visible. Words are only ever corrected towards things the signed-in login may see (an Agent's typo is never "fixed" into a colleague's name).
- **Own voice.** Answers are written as sentences with insight: gap to target, trend vs previous month, which metric needs attention, and honest empty states ("attendance for tomorrow isn't filled in yet" instead of "nobody is on leave").
- **Small talk / meta.** Greetings, "how are you", "who are you", "that's wrong" (Ally says what it understood and asks you to rephrase), and off-topic requests (politely declined: Align360 data only).
- **Permissions unchanged.** Every follow-up goes through the same `AllyScope` gate. An Agent's "who is on leave" followed by "check August" stays refused; "his aht" / "and Rahul" is refused uniformly.
- Tests: `node tests/run.js`, `node tests/adv.js` (leak checks), `node tests/conv.js <role> '["q1","q2"]'` (conversation transcript). Set `SRC` to the app folder.

## Cross-trained agents (multiple LOBs)
An agent has one primary LOB (`lob`) plus optional cross-trained LOBs (`extraLobs`). Ally's person data carries both (`lob`, `lobs`), so "who is on Eligibility" includes cross-trained agents, an agent's profile lists all their LOBs, and an agent only ever gets Knowledge Base / template / update / PKT content for the LOBs they are trained on (those checks reuse the app's own visibility functions).
