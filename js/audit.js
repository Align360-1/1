/* ---------------- AUDIT LOG ----------------
   Distinct from:
   - processUpdates ("Activity history") — manual announcements posted to the team.
   - state.history ("Month History")     — monthly performance snapshots, archived on demand.
   This is a trail of admin/manager actions that change data (roster edits, shift
   swap approvals, status changes, etc), with before/after values.

   HONESTY NOTE ON INTEGRITY — read before trusting this as "tamper-proof":
   Entries are written with a single, direct Firestore .add() call (an append —
   never an update or delete), which deliberately bypasses pushToFirestore()'s
   batched full-array .set()/.delete() cycle that the rest of this app's shared
   collections (shiftSwaps, processUpdates, and even trackerHistory) go through.
   That existing pattern re-derives the *entire* remote collection from whatever
   is in this browser's local state on every save — including deleting remote
   docs for anything missing locally — so a stale or corrupted local state can
   silently erase shared history. Audit entries are intentionally never part of
   that cycle, so a local state problem cannot delete or rewrite them.
   That fixes "can this app's own normal save cycle destroy audit history" — it
   does NOT make this a tamper-proof audit log. Firestore security rules (not
   shipped by this file — see firestore.rules) must deny update/delete on the
   trackerAuditLog collection for that; and actor attribution below is only as
   trustworthy as the client-side login/session it reads from, since there's no
   server-side identity check. True tamper-evidence (IP/device capture, signed
   server timestamps, an admin who can't rewrite their own trail) needs a real
   backend — e.g. Cloud Functions as the only writer — which this app doesn't have.
*/

function logAudit(action, summary, opts){
  opts = opts || {};
  if(!state.auditLog) state.auditLog = [];
  const entry = {
    id: "aud" + Date.now() + Math.random().toString(36).slice(2,7),
    at: new Date().toISOString(),
    actorName: (currentUser && currentUser.name) || "Unknown",
    actorRole: currentUser ? (isAdmin() ? "Admin" : isWFM() ? "WFM Admin" : isTL() ? "Team Leader" : "Agent") : "Unknown",
    action,
    summary,
    empId: opts.empId || "",
    before: opts.before !== undefined ? opts.before : null,
    after: opts.after !== undefined ? opts.after : null
  };
  // Local cache — always kept (and persisted via the normal localStorage save path),
  // capped so it can't grow the local state file unboundedly. The Firestore
  // collection (when cloud sync is on) is the actual long-lived record; this
  // local array is just what's shown while that loads, and the whole story in
  // local-only/offline mode.
  state.auditLog.unshift(entry);
  if(state.auditLog.length > 500) state.auditLog.length = 500;
  saveState();

  // Direct append — bypasses pushToFirestore() on purpose (see note above).
  if(typeof fbReady !== "undefined" && fbReady && fbDb){
    fbDb.collection("trackerAuditLog").add(Object.assign({}, entry, {
      serverAt: firebase.firestore.FieldValue.serverTimestamp()
    })).catch(e => console.error("Audit log write failed", e));
  }
}

function auditActionLabel(action){
  const map = {
    roster_status: "Status change",
    roster_remove: "Agent removed",
    roster_tl: "Team Leader reassigned",
    roster_lob: "LOB reassigned",
    swap_approved: "Shift swap approved",
    swap_rejected: "Shift swap rejected",
    shift_import: "Bulk shift import",
    daily_metric: "Daily metric edited",
    daily_attendance: "Attendance changed",
    shift_edit: "Shift/break time edited",
    metric_edit: "KPI metric edited",
    metric_add: "KPI metric added",
    metric_remove: "KPI metric removed",
    dsparam_edit: "Daily Summary parameter edited",
    dsparam_add: "Daily Summary parameter added",
    dsparam_remove: "Daily Summary parameter removed",
    team_name: "Team name changed",
    app_name: "App name changed",
    leavetype_add: "Leave type added",
    leavetype_remove: "Leave type removed",
    tl_add: "Team Leader added",
    tl_remove: "Team Leader removed",
    lob_add: "LOB added",
    lob_remove: "LOB removed",
    user_add: "User account created",
    user_remove: "User account removed",
    user_enabled: "User account enabled/disabled",
    user_viewall: "User data-access changed",
    user_pw_reset: "User password reset"
  };
  return map[action] || action;
}

function auditDiffHtml(before, after){
  if(before == null && after == null) return "";
  const fmt = v => v === null || v === undefined || v === "" ? "—" : esc(String(v));
  if(typeof before === "object" || typeof after === "object"){
    const keys = Array.from(new Set([...Object.keys(before||{}), ...Object.keys(after||{})]));
    const rows = keys.filter(k => JSON.stringify((before||{})[k]) !== JSON.stringify((after||{})[k]))
      .map(k => `<div class="audit-diff-row"><span class="audit-diff-key">${esc(k)}</span><span class="audit-diff-before">${fmt((before||{})[k])}</span><span class="audit-diff-arrow">→</span><span class="audit-diff-after">${fmt((after||{})[k])}</span></div>`)
      .join("");
    return rows ? `<div class="audit-diff">${rows}</div>` : "";
  }
  return `<div class="audit-diff"><div class="audit-diff-row"><span class="audit-diff-before">${fmt(before)}</span><span class="audit-diff-arrow">→</span><span class="audit-diff-after">${fmt(after)}</span></div></div>`;
}

function renderAuditLog(content, topActions){
  topActions.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Read-only trail of admin/manager actions — see the ℹ for what this does and doesn't guarantee</span>`;

  const entries = (state.auditLog || []).slice(); // already newest-first
  const rowsHtml = entries.length ? entries.map(e => `
    <div class="audit-entry">
      <div class="audit-entry-head">
        <span class="audit-entry-when mono">${esc(new Date(e.at).toLocaleString(undefined,{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}))}</span>
        <span class="badge badge-gray">${esc((e.actorRole||"").toUpperCase())}</span>
        <span class="audit-entry-actor">${esc(e.actorName||"Unknown")}</span>
      </div>
      <div class="audit-entry-summary">${esc(e.summary||auditActionLabel(e.action))}</div>
      ${auditDiffHtml(e.before, e.after)}
    </div>
  `).join("") : `<div class="empty-state"><p>No audited actions yet. Daily entry edits, roster/status changes, KPI/Daily Summary parameter edits, settings changes, shift swaps, and user account changes will show up here.</p></div>`;

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div class="section-title"><span class="eyebrow">🛡</span>Audit Log</div>
      </div>
      <div class="section-body" style="padding:10px 14px;">
        <div class="help-note" style="margin-bottom:12px;">
          This is a trail, not a tamper-proof record — see js/audit.js for exactly what it does and doesn't guarantee.
          It won't have entries from before this feature was added, and it doesn't yet cover every action that changes data.
        </div>
        ${rowsHtml}
      </div>
    </div>
  `;
}
