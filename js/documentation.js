/* ---------------- Documentation template ---------------- */
function renderDocumentation(content, topActions){
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
