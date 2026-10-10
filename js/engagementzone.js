/* ---------------- Employee Engagement Zone ----------------
   Visibility: everyone except Client and plain WFM (see canViewEngagementZone()
   in js/auth.js). Placeholder tab — work in progress, same pattern as EWS. */
function renderEngagementZone(content, topActions){
  topActions.innerHTML = "";
  content.innerHTML = `
    <div class="section">
      <div class="section-body">
        <div class="empty-state" style="padding:48px 20px;text-align:center;">
          <p style="font-size:14px;">🚧 Work in progress</p>
        </div>
      </div>
    </div>
  `;
}
