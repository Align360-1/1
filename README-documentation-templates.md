# Documentation Template — Fill & Generate

This update turns the Documentation Template section from a copy-paste library into a
fill-in-the-blanks system: agents fill a short form, get a ready-to-paste note, and copy
it into ServiceNow's Final Notes field — instead of hand-editing a pasted block on every
call.

Nothing about how the note gets into ServiceNow changed (still copy/paste, see
**Integration status** below). What changed is how fast and consistent it is to produce
that note in the first place.

---

## What's new, at a glance

| Piece | What it does |
|---|---|
| **Call details panel** | Fill 12 common fields (Member ID, Claim Number, DOB, etc.) once per call. Every template pulls from it automatically. |
| **Token syntax in templates** | Trainer/TL/Admin write templates with `{{placeholders}}` instead of hardcoded example text. |
| **Fill & generate modal** | Agent clicks "Use template," fills only what's specific to that template, sees the finished note update live. |
| **Optional clauses** | `[[ ]]` and `{{list:...}}` make a sentence disappear cleanly when its info wasn't shared on the call — no dangling blanks or stray punctuation. |
| **Suggested disposition** | Each template can carry one or more suggested ServiceNow dispositions, with a plain-language rule for when to pick which. |
| **IPA / Vendor directory** | Look up an IPA by name once — phone and address auto-fill, still editable per call. |
| **Native spellcheck** | The fill form and generated note both have browser spellcheck enabled. |

---

## For agents: how to use it

1. Open **Documentation Template**.
2. Expand **📞 Call details** at the top and fill in what you have (Member ID, Claim
   Number, DOB, etc.). This is once per call — leave it filled while you use multiple
   templates during the same call.
3. Find your template, click **📝 Use template**.
4. If the template has a suggested disposition, it's shown at the top with its own Copy
   button — that's a second thing you'll select in ServiceNow, separate from the note.
5. Fill in whatever's specific to this template (dates, IPA name, etc.). The **Generated
   note** box below updates as you type.
6. Use **Additional notes** for anything from the call the template doesn't cover — leave
   it blank and it won't show up in the note at all.
7. Review the generated note, fix anything by hand if needed, then **📋 Copy note** and
   paste into ServiceNow's Final Notes.
8. When the call ends (or you start a new one), click **Clear (new call)** on the Call
   details panel.

**Nothing in Call details or the fill form is saved anywhere** — it only lives on your
screen for that call and clears on logout. If you refresh the page mid-call, you'll need
to re-fill it.

---

## For Trainers / TL / Admin: how to write a template

Templates are still posted the same way (Documentation → **+ Post template**), with one
addition: write the body using tokens for anything that changes per call.

### Token reference

| Syntax | What it does |
|---|---|
| `{{field_name}}` | A plain fillable text field. |
| `{{field_name:date}}` | Renders as a date picker. |
| `{{field_name:select:A\|B\|C}}` | Renders as a dropdown with those options. |
| `[[ ... ]]` | Wraps an optional clause — the whole thing (words, punctuation, and all) disappears if every `{{token}}` inside it is left blank. |
| `{{list:f1=Label 1,f2=Label 2,...}}` | Joins whichever of `f1`/`f2`/... the agent filled in, with correct "and"/comma punctuation. Renders to nothing if none were filled. |
| `{{additional_notes}}` | Placed alone on its own line, ideally at the end. Optional catch-all — disappears if left blank. |

**Reserved names** — these exact field names auto-fill from the Call details panel
instead of asking the agent again on that template, so reuse them rather than inventing
new ones:

```
caller_name, callback_number, claim_type, member_id, member_name, member_dob,
company_id, state, date_of_service, bill_amount, claim_number, npi_tax_id
```

`agent_name` and `today` are also reserved and fill automatically (agent's logged-in name
and today's date) — no field is shown for either.

### Important: wrap a `{{list:...}}` together with its sentence

On its own, `{{list:...}}` only removes the *missing values* — not the sentence around
it. If you want the whole clause to vanish when nothing was filled, wrap the connector
words and the list token together in `[[ ]]`:

```
[[Informed the provider and provided {{list:ipa_name=the IPA name,ipa_phone=phone number,ipa_address=address}}.]]
```

### Worked example

Template as typed (Category: **Claim Denied**, Sub Category: **IPA Responsibility**):

```
Spoke with the provider regarding the claim status. Denied as IPA
responsibility.[[ Claim received date: {{claim_received_date}}.]][[ Claim
Denied in: {{claim_denied_date}}.]][[ Informed the provider that the claim
was denied due to IPA responsibility and provided {{list:ipa_name=the IPA name,ipa_phone=phone number,ipa_address=address}}.]]

{{additional_notes}}
```

If the agent only has an IPA name (no phone or address, no dates, no extra notes), the
generated note is simply:

```
Spoke with the provider regarding the claim status. Denied as IPA
responsibility. Informed the provider that the claim
was denied due to IPA responsibility and provided the IPA name Preferred Health IPA.
```

If nothing at all is filled in, it cleanly falls back to just the base sentence — no
blank fields, no dangling punctuation.

### Suggested disposition

When posting or editing a template, check one or more dispositions from the master list
and optionally add a short rule (e.g. "if provider confirmed no refiling needed"). If you
check more than one, the rule text is what tells the agent which to pick — write it as a
plain, checkable fact from the call, not a judgment call.

---

## Admin setup (one-time, before this is usable)

Two master lists start **empty** and must be populated by an Admin before templates can
use them:

1. **Disposition master list** — Documentation → **⚙ Manage dispositions & IPA
   directory** → add each disposition value **exactly as it appears in ServiceNow's
   dropdown**. This is the single source of truth every template's checklist pulls from.
2. **IPA / Vendor directory** — same panel → add each IPA's name, phone, and address.
   Agents search by name in the fill form; phone/address auto-fill from here.

Only Admins can add/remove entries in either list, to keep them from drifting into
inconsistent variants across different Trainers/TLs. Trainer/TL can still select from
whatever's there when authoring a template.

---

## Data & privacy

- **Call details (Tier 1) and per-template fill values are never persisted.** They live
  only in the browser tab's memory for the duration of the call, and are cleared on
  logout or when "Clear (new call)" is clicked.
- **Template usage is audit-logged by identity only** — which template (title/subtitle/
  LOB) was used and by whom, never the actual field values (Member ID, DOB, etc.) that
  were typed in.
- The disposition master list and IPA directory **are** persisted (they're
  non-call-specific reference data, same as your LOB list or leave types).

---

## Integration status (ServiceNow)

This release does **not** connect to ServiceNow directly — the agent still copies the
generated note and disposition and pastes them in manually. That was a deliberate choice:
it needed no new backend, no ServiceNow credentials, and no InfoSec/compliance review to
ship, while still eliminating the actual time cost (composing/editing the sentence by
hand). A real API integration remains a separate, larger initiative if it's ever wanted —
see the "How Align360 will communicate with ServiceNow" discussion for the tiers
considered and what each would require.

---

## Files changed in this update

- `js/docgen.js` — new file. Token engine, Call details panel, admin management panel,
  and the fill/generate modal.
- `js/documentation.js` — disposition picker + token help text in "Post template";
  entry rows show suggested disposition; "Copy" replaced with "Use template".
- `js/state.js` — new `state.ipaDirectory` and `state.settings.dispositionOptions`,
  plus template entries now carry a `dispositions` array.
- `js/app.js` — `docSession` (in-memory call data) cleared on logout.
- `css/components.css`, `css/responsive.css` — styling for the new panels and modal,
  including mobile layout.
- `index.html` — registers `js/docgen.js`.

## Known limitations / natural next steps

- Disposition and IPA lists start empty — need Admin setup before first use.
- No conditional-wording logic beyond `[[ ]]` and `{{list:...}}` (e.g. no `if/else`
  branching) — covers the scenarios discussed so far, but a more complex scenario might
  need a genuinely different template rather than one template handling everything.
- Spellcheck is native-browser only (Tier 0) — no custom claims-terminology dictionary or
  grammar checking yet; see the earlier discussion for what a Tier 1/2 upgrade would need.
- No ServiceNow API integration (see above) — still copy/paste by design, for now.
