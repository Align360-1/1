# Knowledge Base — full documents + sharper search (v19)

## 1. Agents can open the complete Word file
**Import from document** now has a ticked box **"Also keep the complete document"**. On the review screen a blue card shows
what will be stored (sections / images / size), lets you rename it and choose who can open it, and it is saved/published together
with the articles (or on its own — untick all articles and keep only the document).

Agents see it on the Knowledge Base home page under **📄 Full documents (SOPs)** and inside search results
("📄 Found in the full documents"). The reader has a contents list that follows your scroll, 🔎 Find (highlights every match,
Enter / Shift+Enter to move), screenshots with click-to-zoom, and copy-on-click for phone numbers/codes.
Imported articles get **"Open this part of the full document →"**, which jumps to the matching heading.

* Everything is kept in order — including Revision history / Purpose / Scope that are skipped as *articles*.
* Re-importing a revised file with the **same file name replaces** the document (same link). Manage articles → **Full documents** table:
  View / Publish / Unpublish / Delete.
* Storage: same Firestore collection as the articles (`trackerKb`, rows with `kind:"document"` / `kind:"docpart"`) —
  **no new collection and no rules change**. Big documents are split into ≤ ~700 KB parts; picture budget 4.5 MB per document
  (extra pictures are dropped with a warning on the review screen). Documents are left out of the localStorage copy and the
  Settings backup (they live in the cloud; re-import the .docx if you ever need to rebuild).
* Not stored: the original `.docx` binary. Agents see a faithful web rendering (headings, lists, tables, images, bold/italic, links);
  Word-only features (text boxes, tracked changes, fancy layout) are not reproduced.

## 2. What changed in search / reading
* Whole-word / word-start matching. Before, "ad" matched every word containing "ad"; now it doesn't, and "print" still finds "printer".
* Light stemming (resets / resetting → reset), filler words ignored ("how do I…"), short synonym list (`KB_SYNONYMS` in `js/kb.js` —
  edit it to your own jargon; one-word synonyms only, use each article's **Search words** for phrases like "sign in").
* Ranking: title > search words > section headings > quick answer > category > body; exact-phrase bonus; helpful 👍/👎 votes nudge order.
* Results show **which section** answered the question and open the article scrolled to it with the words highlighted.
* Typo tolerance only kicks in for a word that matches nothing.
* Articles: "On this page" contents chips (3+ headings), 🔎 Find, "You may also need" related articles.
* **Searches that find nothing are now logged** (once per person per question per day; staff searches excluded) and appear in
  Feedback → "🔍 Searched — no result" with a count. **＋ Write article** pre-fills the title and search words, and publishing it
  resolves the line for everyone who searched it. This is how the KB gets complete from real doubts instead of guesses.

Files: `js/kb-docs.js` (new), `js/kb.js` (search + reader), `js/kb-import.js`, `js/kb-ai.js` (`full` output + section anchors),
`js/kb-editor.js` (documents table, no-result searches), `js/firebase.js` + `js/state.js` (document rows), `css/components.css`, `index.html`.
