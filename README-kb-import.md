# Knowledge Base — Import from document

**Where:** Knowledge Base tab → **📄 Import from document** (Trainer, TL, SME, Quality, Admin).

1. Pick who the SOP is for (a LOB or General) and upload the SOP (.docx; .txt / .md also work).
2. The app finds the topics, writes a ⚡ Quick answer for each, converts steps / tables / notes / warnings /
   screenshots, and suggests search words.
3. Review screen: tick / untick articles, fix title, topic, LOB, quick answer or details, then
   **Save as drafts** (recommended) or **Publish**.

How topics are decided: each Word Heading becomes an article; the heading above it becomes the topic (category).
Revision history / approvals / "Purpose" / "Scope" style sections come up unticked.
Re-uploading a revised SOP updates the same articles (matched by file name + title). Articles edited by hand since
the last import default to Skip so nobody's edits are overwritten.

**No AI service is called.** The engine (`js/kb-ai.js`) is rule-based and runs in the browser; the document never leaves
the browser. Word files are read with mammoth.js (`js/vendor/`, BSD-2-Clause), loaded only when the screen is opened.
To plug in a hosted language model later, replace `kbAi.fromHtml` / `kbAi.fromText` — the review screen and the output
shape are unchanged (the model call must go through a server-side function; never put an API key in this app).

No new Firestore collections or rules. Imported articles carry an extra `source:{file,section,importedAt,hash}` field.
Also changed: numbered lists in articles now keep their numbering when resumed after a note (`<ol start>`).

Files: `js/kb-ai.js` (engine), `js/kb-import.js` (screens), `js/vendor/mammoth.browser.min.js`, small edits in
`js/kb.js`, `css/components.css`, `index.html`.
