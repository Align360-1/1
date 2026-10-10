/* ---------------- Post-login intro animation ---------------- */
let __introStylesInjected = false;
function ensureIntroStyles(){
  if(__introStylesInjected) return;
  __introStylesInjected = true;
  const style = document.createElement("style");
  style.id = "introAnimStyles";
  style.textContent = `
  #introOverlay{position:fixed;inset:0;z-index:500;background:#090C10;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:opacity .4s ease;}
  #introOverlay.intro-fade-out{opacity:0;pointer-events:none;}
  .intro-flare{position:absolute;width:100%;height:100%;background:radial-gradient(circle, rgba(242,184,75,0.18) 0%, transparent 60%);opacity:0;animation:introFlashGlow .8s 1s cubic-bezier(0.16,1,0.3,1) forwards;pointer-events:none;}
  .intro-ring-container{position:absolute;width:280px;height:280px;border-radius:50%;}
  .intro-ring{position:absolute;inset:0;border-radius:50%;border:2px solid transparent;}
  .intro-ring-1{border-top-color:#A78BFA;border-right-color:#A78BFA;animation:introSpin1 1.2s cubic-bezier(0.16,1,0.3,1) forwards;}
  .intro-ring-2{border-bottom-color:#E879F9;border-left-color:#E879F9;animation:introSpin2 1.2s cubic-bezier(0.16,1,0.3,1) forwards;}
  .intro-ring-3{border-top-color:#818CF8;border-left-color:#818CF8;animation:introSpin3 1.2s cubic-bezier(0.16,1,0.3,1) forwards;}
  @keyframes introSpin1{0%{transform:scale(2.2) rotate(0deg);opacity:0;}50%{opacity:1;}100%{transform:scale(1) rotate(360deg);opacity:.2;}}
  @keyframes introSpin2{0%{transform:scale(1.8) rotate(180deg);opacity:0;}50%{opacity:1;}100%{transform:scale(1) rotate(540deg);opacity:.2;}}
  @keyframes introSpin3{0%{transform:scale(2.6) rotate(-90deg);opacity:0;}50%{opacity:1;}100%{transform:scale(1) rotate(270deg);opacity:.2;}}
  .intro-logo-box{z-index:2;text-align:center;opacity:0;transform:scale(.85);animation:introLogoReveal 1s .8s cubic-bezier(0.16,1,0.3,1) forwards;}
  .intro-welcome-text{font-family:'Inter',sans-serif;font-size:15px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:#9AA4B2;margin-bottom:10px;}
  .intro-brand-text{font-family:'Space Grotesk',sans-serif;font-size:56px;font-weight:700;letter-spacing:-0.02em;display:flex;align-items:center;justify-content:center;gap:14px;color:#E7ECF2;}
  .intro-dot-glow{width:20px;height:20px;background:#A78BFA;border-radius:6px;box-shadow:0 0 25px #A78BFA, 0 0 50px #A78BFA;animation:introPulseDot 1.5s infinite alternate;flex-shrink:0;}
  @keyframes introLogoReveal{0%{opacity:0;transform:scale(.85) translateY(15px);filter:blur(10px);}100%{opacity:1;transform:scale(1) translateY(0);filter:blur(0);}}
  @keyframes introFlashGlow{0%{opacity:0;}50%{opacity:1;}100%{opacity:.3;}}
  @keyframes introPulseDot{0%{box-shadow:0 0 15px #A78BFA;}100%{box-shadow:0 0 35px #A78BFA, 0 0 60px #A78BFA;}}
  @media (max-width:600px){ .intro-brand-text{font-size:38px;} .intro-ring-container{width:200px;height:200px;} .intro-welcome-text{font-size:12px;} }
  `;
  document.head.appendChild(style);
}
// Plays a short brand intro over whatever is already rendered behind it (the dashboard,
// prepared by render() just before this is called), then fades out on its own.
function showIntroAnimation(onDone){
  ensureIntroStyles();
  const old = document.getElementById("introOverlay");
  if(old) old.remove();
  const overlay = document.createElement("div");
  overlay.id = "introOverlay";
  const appName = esc(state.settings.appName || "Align360");
  overlay.innerHTML = `
    <div class="intro-flare"></div>
    <div class="intro-ring-container">
      <div class="intro-ring intro-ring-1"></div>
      <div class="intro-ring intro-ring-2"></div>
      <div class="intro-ring intro-ring-3"></div>
    </div>
    <div class="intro-logo-box">
      <div class="intro-welcome-text">Welcome to</div>
      <div class="intro-brand-text"><span class="intro-dot-glow"></span><span>${appName}</span></div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(()=>{
    overlay.classList.add("intro-fade-out");
    setTimeout(()=>{ overlay.remove(); if(onDone) onDone(); }, 420);
  }, 2000);
}
function showLoginModal(){
  const existing = document.getElementById("loginOverlay");
  if(existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "loginOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:var(--bg);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;color:var(--text);";
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:6px 28px 28px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 4px;">
        <img src="${ALIGNMENT_LOGO}" style="height:90px;width:auto;max-width:360px;display:block;object-fit:contain;" alt="Alignment Healthcare">
        <span style="font-size:28px;font-weight:300;color:var(--text-muted);line-height:1;">|</span>
        <img src="${COGNIZANT_LOGO}" style="height:90px;width:auto;max-width:360px;display:block;object-fit:contain;" alt="Cognizant">
      </div>
      <div style="text-align:center;font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;margin-bottom:6px;">${esc(state.settings.teamName || "Team")}</div>
      <div style="text-align:center;color:var(--text-muted);font-size:12px;margin-bottom:22px;text-transform:uppercase;letter-spacing:0.08em;">Align360</div>
      <div style="margin-bottom:18px;">
        <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Team Leader / WFM / Admin</div>
        <input type="text" id="loginUsername" placeholder="Username" autocomplete="username" style="width:100%;margin-bottom:4px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);">
        <div class="field-error" id="loginUsernameError" style="margin:0 0 8px;"></div>
        ${pwFieldHtml("loginPassword","Password",{autocomplete:"current-password", wrapStyle:"margin-bottom:4px;", inputStyle:"background:var(--surface-2);color:var(--text);border:1px solid var(--border);"})}
        <div class="field-error" id="loginPasswordError" style="margin:0 0 8px;"></div>
        <button class="btn btn-accent" id="staffLoginBtn" style="width:100%;justify-content:center;">Login</button>
        <div style="text-align:right;margin-top:6px;"><a href="#" id="forgotPwLink" style="font-size:11px;color:var(--accent);text-decoration:none;">Forgot password?</a></div>
      </div>
      <div style="height:1px;background:var(--border);margin:18px 0;"></div>
      <div style="margin-bottom:8px;">
        <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Agent</div>
        <select id="agentLoginSel" style="width:100%;margin-bottom:8px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);">
          <option value="">Select your name</option>
          ${state.roster.filter(a=>a.status==="Active").map(a=>`<option value="${esc(a.empId)}">${esc(a.name)}</option>`).join("")}
        </select>
        <button class="btn" id="agentLoginBtn" style="width:100%;justify-content:center;">Login as Agent</button>
      </div>
      <div style="text-align:center;margin-top:14px;font-size:11px;">${IS_SANDBOX
        ? `<span class="env-pill-tag">🧪 SANDBOX</span> · <a href="#" id="envLoginSwitch" style="color:var(--accent);">Go to production</a>`
        : `<a href="#" id="envLoginSwitch" style="color:var(--text-dim);">Open sandbox (demo)</a>`}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  const envLink = overlay.querySelector("#envLoginSwitch");
  if(envLink) envLink.addEventListener("click", e=>{ e.preventDefault(); switchEnv(IS_SANDBOX ? "production" : "sandbox"); });
  function setLoginError(id, msg){
    const el = document.getElementById(id);
    if(!el) return;
    if(msg){ el.textContent = msg; el.classList.add("show"); }
    else { el.textContent = ""; el.classList.remove("show"); }
  }
  function clearLoginErrors(){
    setLoginError("loginUsernameError", "");
    setLoginError("loginPasswordError", "");
  }
  async function attemptStaffLogin(){
    clearLoginErrors();
    const uname = document.getElementById("loginUsername").value.trim();
    const pw = document.getElementById("loginPassword").value;
    if(!uname){ setLoginError("loginUsernameError", "Enter your username."); return; }
    if(!pw){ setLoginError("loginPasswordError", "Enter your password."); return; }
    const user = findUserByUsername(uname);
    if(!user){ setLoginError("loginUsernameError", "We couldn't find an account with that username."); return; }
    const staffLoginBtn = document.getElementById("staffLoginBtn");
    if(staffLoginBtn) staffLoginBtn.disabled = true;
    const ok = await verifyUserPassword(user, pw);
    if(staffLoginBtn) staffLoginBtn.disabled = false;
    if(!ok){ setLoginError("loginPasswordError", "That password is incorrect. Try again, or use Forgot password?"); return; }
    if(user.enabled===false){ setLoginError("loginPasswordError", "This account has been disabled. Contact your Admin."); return; }
    saveState(); // in case verifyUserPassword just upgraded a legacy plaintext password to a hash
    if(user.mustChangePassword){
      overlay.remove();
      showForceChangePasswordModal(user);
      return;
    }
    currentUser = {role:user.role, id:user.id, name:user.name, username:user.username, tlName:user.tlName||"", viewAll:!!user.viewAll};
    loadViewPeriodForUser();
    loadThemeForUser();
    ensureViewMonthLoaded();
    saveSession(currentUser);
    overlay.remove();
    applyTheme();
    render();
    stopBreakReminder();
    showIntroAnimation(()=> showToast(`Logged in as ${user.name}`));
  }
  document.getElementById("loginUsername").addEventListener("input", ()=>setLoginError("loginUsernameError",""));
  document.getElementById("loginPassword").addEventListener("input", ()=>setLoginError("loginPasswordError",""));
  document.getElementById("staffLoginBtn").addEventListener("click", attemptStaffLogin);
  document.getElementById("loginUsername").addEventListener("keydown", e=>{ if(e.key==="Enter") attemptStaffLogin(); });
  document.getElementById("loginPassword").addEventListener("keydown", e=>{ if(e.key==="Enter") attemptStaffLogin(); });
  document.getElementById("forgotPwLink").addEventListener("click", e=>{
    e.preventDefault();
    overlay.remove();
    openForgotPasswordModal();
  });
  document.getElementById("agentLoginBtn").addEventListener("click", ()=>{
    const empId = document.getElementById("agentLoginSel").value;
    const agent = state.roster.find(a=>a.empId===empId);
    if(agent){
      currentUser = {role:'agent', empId: agent.empId, name: agent.name};
      loadViewPeriodForUser();
      loadThemeForUser();
      ensureViewMonthLoaded();
      saveSession(currentUser);
      overlay.remove();
      applyTheme();
      render();
      startBreakReminder();
      showIntroAnimation(()=> showToast(`Logged in as ${agent.name}`));
    } else {
      showToast("Select your name from the list");
    }
  });
}
// Self-service reset via security question: available to any staff login (Team Leader,
// WFM, or Admin) to reset THEIR OWN password — it can never be used to reset someone
// else's password. Resetting another user's password stays an Admin-only action, done
// from Settings → User accounts.
function openForgotPasswordModal(){
  const overlay = showModal(`
    <div class="modal-title">Reset password</div>
    <p style="font-size:12px;color:var(--text-muted);line-height:1.5;margin:0 0 14px;">Enter your username, then answer your security question to set a new password. If your account has no security question set up yet, ask your Admin to reset it for you in Settings \u2192 User accounts.</p>
    <div class="field">
      <label>Username</label>
      <input type="text" id="fpUsername" placeholder="Your username">
      <div class="field-error" id="fpUsernameError"></div>
    </div>
    <button class="btn" id="fpFindBtn">Continue</button>
    <div id="fpStep2" style="display:none;margin-top:16px;">
      <div class="field">
        <label id="fpQuestionLabel">Security question</label>
        <input type="text" id="fpAnswer" placeholder="Your answer">
        <div class="field-error" id="fpAnswerError"></div>
      </div>
      <div class="field">
        <label>New password</label>
        ${pwFieldHtml("fpNewPw","New password")}
        <div class="field-error" id="fpNewPwError"></div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="fpBack">Back to login</button>
      <button class="btn btn-accent" id="fpResetBtn" style="display:none;">Reset password</button>
    </div>
  `);
  let foundUser = null;

  function setError(id, msg){
    const el = document.getElementById(id);
    if(!el) return;
    if(msg){ el.textContent = msg; el.classList.add("show"); }
    else { el.textContent = ""; el.classList.remove("show"); }
  }
  function clearAllErrors(){
    ["fpUsernameError","fpAnswerError","fpNewPwError"].forEach(id=>setError(id, ""));
  }
  function exitForgotPassword(){
    document.removeEventListener("keydown", fpEscHandler);
    closeModal();
    if(!currentUser) showLoginModal();
  }
  // The shared modal-overlay backdrop click already closes this modal (see showModal) —
  // this second listener runs afterward and makes sure the login screen reappears
  // instead of leaving a blank page behind it.
  overlay.addEventListener("click", e=>{
    if(e.target===overlay){
      document.removeEventListener("keydown", fpEscHandler);
      setTimeout(()=>{ if(!currentUser && !document.getElementById("loginOverlay") && !document.querySelector(".modal-overlay")) showLoginModal(); }, 0);
    }
  });
  function fpEscHandler(e){ if(e.key==="Escape") exitForgotPassword(); }
  document.removeEventListener("keydown", modalEscHandler);
  document.addEventListener("keydown", fpEscHandler);

  overlay.querySelector("#fpFindBtn").addEventListener("click", ()=>{
    clearAllErrors();
    const uname = document.getElementById("fpUsername").value.trim();
    foundUser = findUserByUsername(uname);
    if(!foundUser){ setError("fpUsernameError", "No account with that username."); return; }
    if(!foundUser.securityQ){ setError("fpUsernameError", "This account has no security question set up — ask your Admin to reset it in Settings \u2192 User accounts."); return; }
    document.getElementById("fpQuestionLabel").textContent = foundUser.securityQ;
    document.getElementById("fpStep2").style.display = "block";
    document.getElementById("fpResetBtn").style.display = "inline-flex";
    document.getElementById("fpFindBtn").style.display = "none";
    document.getElementById("fpUsername").disabled = true;
    document.getElementById("fpAnswer").focus();
  });
  overlay.querySelector("#fpResetBtn").addEventListener("click", async ()=>{
    setError("fpAnswerError", "");
    setError("fpNewPwError", "");
    if(!foundUser) return;
    const ans = document.getElementById("fpAnswer").value.trim();
    const newPw = document.getElementById("fpNewPw").value;
    if(!ans){ setError("fpAnswerError", "Enter your answer to the security question."); return; }
    const fpResetBtn = document.getElementById("fpResetBtn");
    if(fpResetBtn) fpResetBtn.disabled = true;
    const answerOk = await verifyUserSecurityAnswer(foundUser, ans);
    if(fpResetBtn) fpResetBtn.disabled = false;
    if(!answerOk){ setError("fpAnswerError", "That answer doesn't match what's on file for this account. Please try again."); return; }
    if(!newPw){ setError("fpNewPwError", "Enter a new password."); return; }
    await setUserPassword(foundUser, newPw);
    foundUser.mustChangePassword = false;
    saveState();
    document.removeEventListener("keydown", fpEscHandler);
    closeModal();
    showToast("✅ Password updated — you can log in now");
    showLoginModal();
  });
  overlay.querySelector("#fpBack").addEventListener("click", exitForgotPassword);
}
function computeEndTime(startVal, minutes){
  if(!startVal) return "";
  const [h, m] = startVal.split(":").map(Number);
  const endDate = new Date(2000, 0, 1, h, m + minutes);
  return String(endDate.getHours()).padStart(2,"0") + ":" + String(endDate.getMinutes()).padStart(2,"0");
}
function autoBreakEnd(startId, endId, minutes){
  const endVal = computeEndTime(document.getElementById(startId).value, minutes);
  if(endVal) document.getElementById(endId).value = endVal;
}
function logout(){
  clearSession();
  if(typeof pktReset==="function") pktReset();
  if(typeof kbDraft!=="undefined"){ kbQuery = ""; kbCat = null; kbOpenId = null; kbView = "list"; kbDraft = null; kbDirty = false; kbSubTab = "browse"; }
  if(typeof stopLeoEscalationWatcher==="function") stopLeoEscalationWatcher();
  currentUser = null;
  viewPeriod = {month:null, year:null};
  userTheme = (state.settings.theme === "light" ? "light" : "dark");
  currentTab = "dashboard";
  applyTheme();
  render();
  showLoginModal();
}


/* ---------------- Modal helpers (replaces blocked prompt/confirm) ---------------- */
function showForceChangePasswordModal(user){
  const overlay = document.createElement("div");
  overlay.id = "forceChangePwOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:var(--bg);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;color:var(--text);";
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px;width:100%;max-width:380px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700;margin-bottom:4px;">Set a new password</div>
      <div style="font-size:12.5px;color:var(--text-muted);margin-bottom:18px;line-height:1.5;">This account is using a temporary password. Choose your own before continuing — only you will know it.</div>
      ${pwFieldHtml("fcpNew","New password",{wrapStyle:"margin-bottom:10px;", inputStyle:"background:var(--surface-2);color:var(--text);border:1px solid var(--border);"})}
      ${pwFieldHtml("fcpConfirm","Confirm new password",{wrapStyle:"margin-bottom:10px;", inputStyle:"background:var(--surface-2);color:var(--text);border:1px solid var(--border);"})}
      <div class="field-error" id="fcpError" style="margin:0 0 10px;"></div>
      <div style="height:1px;background:var(--border);margin:14px 0;"></div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Optional — set a security question so you can reset your own password later without waiting on your Admin:</div>
      <div class="field" style="margin-bottom:8px;"><input type="text" id="fcpSecQ" placeholder="e.g. First pet's name?" style="background:var(--surface-2);color:var(--text);border:1px solid var(--border);"></div>
      <div class="field" style="margin-bottom:14px;"><input type="text" id="fcpSecA" placeholder="Answer" style="background:var(--surface-2);color:var(--text);border:1px solid var(--border);"></div>
      <button class="btn btn-accent" id="fcpSubmit" style="width:100%;justify-content:center;">Continue</button>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById("fcpSubmit").addEventListener("click", async ()=>{
    const errEl = document.getElementById("fcpError");
    errEl.textContent = ""; errEl.classList.remove("show");
    const pw = document.getElementById("fcpNew").value;
    const confirmPw = document.getElementById("fcpConfirm").value;
    const secQ = document.getElementById("fcpSecQ").value.trim();
    const secA = document.getElementById("fcpSecA").value.trim();
    if(!pw || pw.length<4){ errEl.textContent="Enter a password (at least 4 characters)."; errEl.classList.add("show"); return; }
    if(pw!==confirmPw){ errEl.textContent="Passwords don't match."; errEl.classList.add("show"); return; }
    const submitBtn = document.getElementById("fcpSubmit");
    submitBtn.disabled = true;
    await setUserPassword(user, pw);
    user.mustChangePassword = false;
    if(secQ && secA){ user.securityQ = secQ; await setUserSecurityAnswer(user, secA); }
    saveState();
    currentUser = {role:user.role, id:user.id, name:user.name, username:user.username, tlName:user.tlName||"", viewAll:!!user.viewAll};
    loadViewPeriodForUser();
    loadThemeForUser();
    ensureViewMonthLoaded();
    saveSession(currentUser);
    overlay.remove();
    applyTheme();
    render();
    stopBreakReminder();
    showIntroAnimation(()=> showToast(`Password updated — logged in as ${user.name}`));
  });
  document.getElementById("fcpConfirm").addEventListener("keydown", e=>{ if(e.key==="Enter") document.getElementById("fcpSubmit").click(); });
}
function showModal(innerHtml){
  closeModal();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal-box">${innerHtml}</div>`;
  overlay.addEventListener("click", e=>{ if(e.target===overlay) closeModal(); });
  document.addEventListener("keydown", modalEscHandler);
  document.body.appendChild(overlay);
  return overlay;
}
function closeModal(){
  document.querySelectorAll(".modal-overlay").forEach(o=>o.remove());
  document.removeEventListener("keydown", modalEscHandler);
}
function modalEscHandler(e){ if(e.key==="Escape") closeModal(); }

/* ---------------- Image lightbox (fit-to-screen view, no download) ---------------- */
function closeImageLightbox(){
  const ov = document.getElementById("imgLightboxOverlay");
  if(ov) ov.remove();
  document.removeEventListener("keydown", lightboxEscHandler);
}
function lightboxEscHandler(e){ if(e.key==="Escape") closeImageLightbox(); }
function openImageLightbox(src, name){
  closeImageLightbox();
  const overlay = document.createElement("div");
  overlay.id = "imgLightboxOverlay";
  overlay.className = "img-lightbox-overlay";
  overlay.innerHTML = `
    <button class="img-lightbox-close" id="imgLightboxCloseBtn" title="Close" aria-label="Close">✕</button>
    <img class="img-lightbox-img" src="${src}" alt="${esc(name||"")}">
    ${name ? `<div class="img-lightbox-caption">${esc(name)}</div>` : ""}
  `;
  overlay.addEventListener("click", e=>{ if(e.target===overlay) closeImageLightbox(); });
  document.addEventListener("keydown", lightboxEscHandler);
  document.body.appendChild(overlay);
  overlay.querySelector("#imgLightboxCloseBtn").addEventListener("click", closeImageLightbox);
}
function showConfirm(message, onYes, confirmLabel){
  const overlay = showModal(`
    <div class="modal-title">Are you sure?</div>
    <p style="font-size:12.5px;color:var(--text-muted);line-height:1.5;margin:0;">${message}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalNo">Cancel</button>
      <button class="btn btn-danger" id="modalYes">${confirmLabel||"Confirm"}</button>
    </div>
  `);
  overlay.querySelector("#modalNo").addEventListener("click", closeModal);
  overlay.querySelector("#modalYes").addEventListener("click", ()=>{ closeModal(); onYes(); });
}


/* ---------------- Rendering shell ---------------- */
const TABS = [
  {id:"dashboard", label:"Dashboard", ic:"◧"},
  {id:"processupdate", label:"Process Update", ic:"📢"},
  {id:"kb", label:"Knowledge Base", ic:"📚"},
  {id:"leo", label:"LEO", ic:"📞"},
  {id:"ews", label:"EWS", ic:"⚠"},
  {id:"qualityaudit", label:"Quality Audit", ic:"✅"},
  {id:"pkt", label:"PKT", ic:"🧠"},
  {id:"engagementzone", label:"Employee Engagement Zone", ic:"🎉"},
  {id:"daily", label:"Daily Data", ic:"▤"},
  {id:"dailysummary", label:"Daily Summary", ic:"◫"},
  {id:"breaks", label:"Break Schedule", ic:"◷"},
  {id:"roster", label:"Team Roster", ic:"◍"},
  {id:"leave", label:"Leave Tracker", ic:"◔"},
  {id:"history", label:"Month History", ic:"▥"},
  {id:"auditlog", label:"Audit Log", ic:"🛡"},
  {id:"documentation", label:"Documentation template", ic:"📄"},
  {id:"settings", label:"Settings", ic:"⚙"}
];

// Small unread-count badge shown on a nav tab's icon. Process Update (backed
// by unreadProcessUpdateCount in history.js), LEO (backed by
// unreadLeoCallCount in leo.js, TL/Trainer/Admin only) and Quality Audit (agents,
// qaUnreadCount in qualityaudit.js) currently have one —
// add more tab ids here if other sections grow their own "new item" concept.
function navBadgeCount(tabId){
  if(tabId==="processupdate" && typeof canViewProcessUpdates==="function" && canViewProcessUpdates() && typeof unreadProcessUpdateCount==="function"){
    return unreadProcessUpdateCount();
  }
  if(tabId==="leo" && typeof canManageLEO==="function" && canManageLEO() && typeof unreadLeoCallCount==="function"){
    return unreadLeoCallCount();
  }
  // Agents: audits submitted about them that they haven't opened the Quality Audit tab to see yet.
  if(tabId==="qualityaudit" && typeof isAgent==="function" && isAgent() && typeof qaUnreadCount==="function"){
    return qaUnreadCount();
  }
  // Knowledge Base: staff who maintain it see how many agent requests / "not helpful" votes are waiting.
  if(tabId==="kb" && typeof canManageKB==="function" && canManageKB() && typeof kbOpenCount==="function"){
    return kbOpenCount();
  }
  // Agents: published PKTs they haven't submitted yet.
  if(tabId==="pkt" && typeof isAgent==="function" && isAgent() && typeof pktPendingCount==="function"){
    return pktPendingCount();
  }
  return 0;
}
function navBadgeHtml(tabId){
  const n = navBadgeCount(tabId);
  return n>0 ? `<span class="nav-count-badge">${n>99?'99+':n}</span>` : "";
}

// Role-based tab visibility, factored out of __renderInner so refreshNavBadges()
// (a lightweight nav-only repaint) can recompute the same list without doing a
// full render().
function computeVisibleTabs(){
  if(!currentUser) return [];
  if(isTrainer()){
    // Trainer: read access to Dashboard/Roster/Breaks/Leave, full access to Process Update
    // and Documentation template, plus the Quality Audit / Employee Engagement Zone
    // work-in-progress tabs (visible to everyone except Client and plain WFM).
    // Nothing else (no EWS, Daily Data, History, Settings, etc).
    return TABS.filter(t => ["dashboard","roster","breaks","leave","processupdate","leo","qualityaudit","pkt","kb","engagementzone","documentation"].includes(t.id));
  } else if(isClient()){
    // Client: read-only access to Dashboard, Process Update, Daily Summary, and
    // Documentation template. Nothing else is visible — no roster, no breaks, no leave,
    // no settings, and no create/edit/delete anywhere.
    return TABS.filter(t => ["dashboard","processupdate","leo","dailysummary","documentation"].includes(t.id));
  } else if(isManager()){
    return TABS.filter(t => t.id!=="auditlog" || isFullAdmin())
      .filter(t => t.id!=="processupdate" || canViewProcessUpdates())
      .filter(t => t.id!=="leo" || canViewLEO())
      .filter(t => t.id!=="qualityaudit" || canViewQualityAudit())
      .filter(t => t.id!=="pkt" || canViewPKT())
      .filter(t => t.id!=="kb" || canViewKB())
      .filter(t => t.id!=="engagementzone" || canViewEngagementZone())
      .filter(t => t.id!=="documentation" || canViewDocumentation());
  } else if(isQuality()){
    // Quality analyst: Dashboard (their own audit dashboard), Process Update (view only),
    // Quality Audit, Employee Engagement Zone, Documentation template (view only) and a
    // restricted Settings page. Must be its own branch — the final else below is the Agent list.
    return TABS.filter(t => ["dashboard","processupdate","qualityaudit","pkt","kb","engagementzone","documentation","settings"].includes(t.id));
  } else if(isSME()){
    // SME: scoped-to-their-team view of Dashboard/Daily Data/Break Schedule/Team
    // Roster/Leave Tracker/Month History, view+pin on Process Update, full access
    // to Documentation template and LEO (minus the Admin-only Manage reasons/
    // Manage supervisors settings, already gated to isAdmin() in leo.js), and a
    // restricted Settings (own login only), plus the Quality Audit / Employee
    // Engagement Zone work-in-progress tabs (visible to everyone except Client
    // and plain WFM). No EWS, no Daily Summary, no Audit Log.
    return TABS.filter(t => ["dashboard","processupdate","leo","qualityaudit","pkt","kb","engagementzone","daily","breaks","roster","leave","history","documentation","settings"].includes(t.id))
      .filter(t => t.id!=="leo" || canViewLEO());
  } else {
    // Agent: also gets the Quality Audit / Employee Engagement Zone
    // work-in-progress tabs, since those are visible to everyone except
    // Client and plain WFM.
    return TABS.filter(t => ["dashboard","processupdate","leo","qualityaudit","pkt","kb","engagementzone","breaks","documentation"].includes(t.id))
      .filter(t => t.id!=="processupdate" || canViewProcessUpdates())
      .filter(t => t.id!=="leo" || canViewLEO())
      .filter(t => t.id!=="documentation" || canViewDocumentation());
  }
}

// Renders the sidebar nav list for a given tab set and wires its click handler.
function renderSidebarNav(visibleTabs){
  const nav = document.getElementById("navList");
  if(!nav) return;
  nav.innerHTML = visibleTabs.map(t=>`<div class="nav-item ${t.id===currentTab?'active':''}" data-tab="${t.id}" title="${t.label}"><span class="ic-wrap"><span class="ic">${t.ic}</span>${navBadgeHtml(t.id)}</span><span class="nav-label">${t.label}</span></div>`).join("");
  nav.querySelectorAll(".nav-item").forEach(el=>el.addEventListener("click", ()=>{ currentTab = el.dataset.tab; render(); }));
}

// Lightweight nav-only repaint: rebuilds the sidebar, bottom nav, and (if open)
// the More sheet so their badge counts stay live — without touching the main
// content area or scroll position the way a full render() would. Used right
// after something changes a badge count in place, e.g. marking a process
// update as read while its card is expanded.
function refreshNavBadges(){
  if(!currentUser) return;
  const visibleTabs = computeVisibleTabs();
  renderSidebarNav(visibleTabs);
  renderBottomNav(visibleTabs);
}

/* ---------------- Focus tracking (for re-render restoration) ---------------- */
let __lastFocus = null; // {selector, isTextLike}
function __cssEsc(s){ return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/["\\\]]/g,"\\$&"); }
function __buildFocusSelector(el){
  const parts = [];
  const tr = el.closest("tr");
  if(tr){
    if(tr.dataset.emp!==undefined && tr.dataset.iso!==undefined) parts.push(`tr[data-emp="${__cssEsc(tr.dataset.emp)}"][data-iso="${__cssEsc(tr.dataset.iso)}"]`);
    else if(tr.dataset.i!==undefined) parts.push(`tr[data-i="${__cssEsc(tr.dataset.i)}"]`);
    else if(tr.dataset.id!==undefined) parts.push(`tr[data-id="${__cssEsc(tr.dataset.id)}"]`);
  }
  let tagSel = el.tagName.toLowerCase();
  if(el.dataset.field) tagSel += `[data-field="${__cssEsc(el.dataset.field)}"]`;
  if(el.dataset.mf) tagSel += `[data-mf="${__cssEsc(el.dataset.mf)}"]`;
  if(el.dataset.id!==undefined && !tr) tagSel += `[data-id="${__cssEsc(el.dataset.id)}"]`;
  if(el.type==="radio") tagSel += `[value="${__cssEsc(el.value)}"]`;
  if(el.id) tagSel = `#${__cssEsc(el.id)}`;
  parts.push(tagSel);
  return parts.join(" ");
}
let __rendering = false;
document.addEventListener("focusin", (e)=>{
  const el = e.target;
  if(!el || (el.tagName!=="INPUT" && el.tagName!=="SELECT")) return;
  const content0 = document.getElementById("content");
  const topActions0 = document.getElementById("topbarActions");
  const tracked = (content0 && content0.contains(el)) || (topActions0 && topActions0.contains(el));
  if(!tracked) return;
  try{
    __lastFocus = {
      selector: __buildFocusSelector(el),
      isTextLike: el.tagName==="INPUT" && (el.type==="text"||el.type==="search"||el.type==="tel"||el.type==="url"||el.type==="password")
    };
  }catch(err){ __lastFocus = null; }
}, true);
document.addEventListener("focusout", (e)=>{
  // If we're mid-render, any blur here is just the old DOM node being torn down and
  // replaced — not the user actually leaving the field — so don't forget it; we're
  // about to restore focus into its replacement in this same render pass.
  if(__rendering) return;
  // Otherwise: if focus is leaving the app entirely (not moving to another field), forget it so a later
  // unrelated re-render doesn't unexpectedly steal focus back into a stale cell.
  const next = e.relatedTarget;
  const content0 = document.getElementById("content");
  const topActions0 = document.getElementById("topbarActions");
  const stillTracked = next && ((content0 && content0.contains(next)) || (topActions0 && topActions0.contains(next)));
  if(!stillTracked) __lastFocus = null;
}, true);

function restoreTrackedFocus(scopeEl, wrapScrollVal){
  const focusInfo = __lastFocus;
  if(!focusInfo || !focusInfo.selector) return;
  // Search the whole document — the field being restored may live in #topbarActions
  // (search boxes, filter dropdowns) rather than #content, and id-based selectors
  // are unique across the page anyway.
  try{
    const el = document.querySelector(focusInfo.selector);
    if(el){
      el.focus({preventScroll:true});
      if(focusInfo.isTextLike && el.setSelectionRange){
        try{ const len = el.value.length; el.setSelectionRange(len, len); }catch(e){}
      }
      if(wrapScrollVal!=null){
        const newWrap = el.closest(".table-wrap");
        if(newWrap) newWrap.scrollTop = wrapScrollVal;
      }
    }
  }catch(e){ /* selector mismatch — ignore, just skip refocus */ }
}
// Mobile bottom tab bar. Reuses the same role-filtered `visibleTabs` the sidebar
// nav uses, so e.g. agents (who only ever see 3 tabs) get a plain 3-item bar with
// no "More" bucket, while manager roles (7 tabs) get 3 primary + overflow.
function renderBottomNav(visibleTabs){
  const bar = document.getElementById("bottomNav");
  const overlay = document.getElementById("moreSheetOverlay");
  if(!bar || !overlay) return;

  const PRIMARY_COUNT = 3;
  const primaryTabs = visibleTabs.length > PRIMARY_COUNT + 1 ? visibleTabs.slice(0, PRIMARY_COUNT) : visibleTabs;
  const overflowTabs = visibleTabs.length > PRIMARY_COUNT + 1 ? visibleTabs.slice(PRIMARY_COUNT) : [];
  const overflowActive = overflowTabs.some(t=>t.id===currentTab);

  const itemHtml = t => `<div class="bottom-nav-item ${t.id===currentTab?'active':''}" data-tab="${t.id}"><span class="ic-wrap"><span class="ic">${t.ic}</span>${navBadgeHtml(t.id)}</span><span class="bn-label">${t.label}</span></div>`;

  const overflowUnread = overflowTabs.some(t=> navBadgeCount(t.id) > 0);
  bar.innerHTML = primaryTabs.map(itemHtml).join("") +
    (overflowTabs.length ? `<div class="bottom-nav-item ${overflowActive?'active':''}" data-more="1"><span class="ic-wrap"><span class="ic">⋯</span>${overflowUnread ? '<span class="nav-dot-badge"></span>' : ''}</span><span class="bn-label">More</span></div>` : "");

  bar.querySelectorAll(".bottom-nav-item[data-tab]").forEach(el=>el.addEventListener("click", ()=>{
    currentTab = el.dataset.tab; moreSheetOpen = false; render();
  }));

  const moreTrigger = bar.querySelector(".bottom-nav-item[data-more]");
  if(moreTrigger) moreTrigger.addEventListener("click", ()=>{ moreSheetOpen = !moreSheetOpen; renderMoreSheet(overflowTabs); });

  renderMoreSheet(overflowTabs);
}

function renderMoreSheet(overflowTabs){
  const overlay = document.getElementById("moreSheetOverlay");
  if(!overlay) return;
  overlay.classList.toggle("open", moreSheetOpen);
  if(!moreSheetOpen){ overlay.innerHTML = ""; return; }

  overlay.innerHTML = `
    <div class="more-sheet">
      <div class="more-sheet-handle"></div>
      <div class="more-sheet-title">More</div>
      ${overflowTabs.map(t=>`<div class="more-sheet-item ${t.id===currentTab?'active':''}" data-tab="${t.id}"><span class="ic-wrap"><span class="ic">${t.ic}</span>${navBadgeHtml(t.id)}</span>${esc(t.label)}</div>`).join("")}
    </div>
  `;
  overlay.querySelectorAll(".more-sheet-item").forEach(el=>el.addEventListener("click", (e)=>{
    e.stopPropagation();
    currentTab = el.dataset.tab; moreSheetOpen = false; render();
  }));
  // Tapping the backdrop (outside the sheet itself) closes without changing tab.
  overlay.addEventListener("click", (e)=>{
    if(e.target !== overlay) return;
    moreSheetOpen = false; renderMoreSheet(overflowTabs);
  }, {once:true});
}

function render(){
  __rendering = true;
  try{
    __renderInner();
  } finally {
    __rendering = false;
  }
}
function __renderInner(){
  const main = document.getElementById("main");
  const scrollMain = main ? main.scrollTop : 0;
  const content0 = document.getElementById("content");
  const wrapBefore = content0 ? content0.querySelector(".table-wrap") : null;
  const wrapScroll = wrapBefore ? wrapBefore.scrollTop : null;

  applyTheme();
  document.getElementById("brandName").textContent = state.settings.teamName || "Team";
  const logoWrap = document.getElementById("logoWrap");
  if(logoWrap) logoWrap.innerHTML = brandLogoImgHtml(28);
  const logoutBtn = document.getElementById("logoutBtn");
  if(logoutBtn){
    logoutBtn.style.display = currentUser ? "flex" : "none";
    logoutBtn.onclick = logout;
  }
  const loggedInAsLabel = document.getElementById("loggedInAsLabel");
  if(loggedInAsLabel){
    if(currentUser){
      const roleLabel = currentRoleLabel();
      loggedInAsLabel.textContent = `${currentUser.name} · ${roleLabel}`;
      loggedInAsLabel.style.display = "block";
    } else {
      loggedInAsLabel.style.display = "none";
    }
  }

  if(!currentUser){
    document.getElementById("navList").innerHTML = "";
    document.getElementById("pageTitle").textContent = "Login";
    document.getElementById("pagePeriod").textContent = "Please sign in to continue";
    document.getElementById("content").innerHTML = "";
    document.getElementById("topbarActions").innerHTML = "";
    const ppWrapOut = document.getElementById("periodPickerWrap");
    if(ppWrapOut) ppWrapOut.innerHTML = "";
    return;
  }

  if(isAgent() && !["dashboard","processupdate","leo","qualityaudit","pkt","kb","engagementzone","breaks","documentation"].includes(currentTab)) currentTab = "dashboard";
  if(isTrainer() && !["dashboard","roster","breaks","leave","processupdate","leo","qualityaudit","pkt","kb","engagementzone","documentation"].includes(currentTab)) currentTab = "dashboard";
  if(isClient() && !["dashboard","processupdate","leo","dailysummary","documentation"].includes(currentTab)) currentTab = "dashboard";
  if(isQuality() && !["dashboard","processupdate","qualityaudit","pkt","kb","engagementzone","documentation","settings"].includes(currentTab)) currentTab = "dashboard";
  if(isSME() && !["dashboard","processupdate","leo","qualityaudit","pkt","kb","engagementzone","daily","breaks","roster","leave","history","documentation","settings"].includes(currentTab)) currentTab = "dashboard";
  if(currentTab==="auditlog" && !isFullAdmin()) currentTab = "dashboard";
  if(currentTab==="processupdate" && !canViewProcessUpdates()) currentTab = "dashboard";
  if(currentTab==="leo" && !canViewLEO()) currentTab = "dashboard";
  if(currentTab==="qualityaudit" && !canViewQualityAudit()) currentTab = "dashboard";
  if(currentTab==="pkt" && !canViewPKT()) currentTab = "dashboard";
  if(currentTab==="kb" && !canViewKB()) currentTab = "dashboard";
  if(currentTab==="engagementzone" && !canViewEngagementZone()) currentTab = "dashboard";
  if(currentTab==="documentation" && !canViewDocumentation()) currentTab = "dashboard";

  let visibleTabs = computeVisibleTabs();

  renderSidebarNav(visibleTabs);

  renderBottomNav(visibleTabs);

  const titleMap = {dashboard:"Dashboard", processupdate:"Process Update", leo:"LEO", ews:"EWS", qualityaudit:"Quality Audit", pkt:"PKT", kb:"Knowledge Base", engagementzone:"Employee Engagement Zone", daily:"Daily Data", dailysummary:"Daily Summary", breaks:"Break Schedule", roster:"Team Roster", leave:"Leave Tracker", history:"Month History", auditlog:"Audit Log", documentation:"Documentation template", settings:"Settings"};
  document.getElementById("pageTitle").textContent = titleMap[currentTab];
  document.documentElement.setAttribute("data-active-section", currentTab);
  document.getElementById("pagePeriod").textContent = `${state.settings.teamName} · ${viewPeriod.month} ${viewPeriod.year}`;
  renderPeriodPicker();
  ensureViewMonthLoaded();

  const content = document.getElementById("content");
  const topActions = document.getElementById("topbarActions");
  topActions.innerHTML = "";

  // Start/stop break reminders based on login state
  if(isAgent()) startBreakReminder(); else stopBreakReminder();
  // LEO auto-escalation runs in the browsers of the people who work the queue
  if(typeof canManageLEO==="function" && canManageLEO()) startLeoEscalationWatcher(); else stopLeoEscalationWatcher();

  try{
    if(currentTab==="dashboard"){ renderDashboard(content, topActions); if(typeof pktInjectDashboard==="function") pktInjectDashboard(content); }
    else if(currentTab==="processupdate") renderProcessUpdate(content, topActions);
    else if(currentTab==="leo") renderLEO(content, topActions);
    else if(currentTab==="ews") renderEWS(content, topActions);
    else if(currentTab==="qualityaudit") renderQualityAudit(content, topActions);
    else if(currentTab==="pkt") renderPkt(content, topActions);
    else if(currentTab==="kb") renderKB(content, topActions);
    else if(currentTab==="engagementzone") renderEngagementZone(content, topActions);
    else if(currentTab==="daily") renderDaily(content, topActions);
    else if(currentTab==="dailysummary") renderDailySummary(content, topActions);
    else if(currentTab==="breaks") renderBreaks(content, topActions);
    else if(currentTab==="roster") renderRoster(content, topActions);
    else if(currentTab==="leave") renderLeave(content, topActions);
    else if(currentTab==="history") renderHistory(content, topActions);
    else if(currentTab==="auditlog") renderAuditLog(content, topActions);
    else if(currentTab==="documentation") renderDocumentation(content, topActions);
    else if(currentTab==="settings") renderSettings(content, topActions);
  }catch(err){
    console.error("Render error on tab '"+currentTab+"':", err);
    topActions.innerHTML = "";
    content.innerHTML = `
      <div class="section">
        <div class="empty-state">
          <div class="big">⚠</div>
          <div class="disp" style="font-size:15px;font-weight:600;">This tab hit an unexpected error</div>
          <p>Your saved data hasn't been changed. Try another tab, or use the options below. If this keeps happening, downloading a backup and sharing what you were doing helps track it down.</p>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap;">
            <button class="btn btn-accent" id="errRetryBtn">↻ Try again</button>
            <button class="btn" id="errGoDashboard">Go to Dashboard</button>
            <button class="btn" id="errGoSettings">Go to Settings (backup)</button>
          </div>
        </div>
      </div>`;
    const retryBtn = document.getElementById("errRetryBtn");
    if(retryBtn) retryBtn.addEventListener("click", render);
    const dashBtn = document.getElementById("errGoDashboard");
    if(dashBtn) dashBtn.addEventListener("click", ()=>{ currentTab="dashboard"; render(); });
    const setBtn = document.getElementById("errGoSettings");
    if(setBtn) setBtn.addEventListener("click", ()=>{ currentTab="settings"; render(); });
    return;
  }

  if(main) main.scrollTop = scrollMain;
  const wrapAfter = content.querySelector(".table-wrap");
  if(wrapAfter && wrapScroll!=null) wrapAfter.scrollTop = wrapScroll;
  restoreTrackedFocus(content, wrapScroll);
}


/* ---------------- Global search (topbar) ----------------
   Searches across every section of the app from one box, regardless of which
   tab is currently open. Add a new source here as new searchable content is
   built (e.g. once Documentation Template has real entries, index them the
   same way Process Updates are indexed below). */
function buildGlobalSearchIndex(query){
  const items = [];

  // Process Updates — title, message body, and who posted it (skipped entirely for
  // roles that can't see the Process Update tab at all, e.g. WFM)
  if(canViewProcessUpdates()) agentVisibleProcessUpdates((state.processUpdates||[]).filter(u=>!u.archived)).forEach(u=>{
    items.push({
      group: "Process Updates",
      id: "pu-"+u.id,
      title: u.title||"(untitled update)",
      sub: (u.message||"").slice(0,80),
      haystack: [u.title, u.message, u.postedBy].filter(Boolean).join(" ").toLowerCase(),
      onSelect: ()=>{
        currentTab = "processupdate";
        expandedUpdateIds.add(u.id);
        markUpdateRead(u.id);
        render();
        setTimeout(()=>{
          const card = document.querySelector(`.update-card[data-id="${u.id}"]`);
          if(card) card.scrollIntoView({behavior:"smooth", block:"center"});
        }, 30);
      }
    });
  });

  // Roster — agents by name, employee ID, team leader, and LOB (Client never sees
  // roster data anywhere, including here)
  if(!isClient() && !isQuality()) scopedRoster().forEach(a=>{
    items.push({
      group: "Roster",
      id: "ag-"+a.empId,
      title: a.name||a.empId,
      sub: [a.empId, a.tlName, a.lob].filter(Boolean).join(" · "),
      haystack: [a.name, a.empId, a.tlName, a.lob].filter(Boolean).join(" ").toLowerCase(),
      onSelect: ()=>{
        currentTab = "roster";
        rosterSearch = a.name || a.empId;
        render();
      }
    });
  });

  // Documentation Template — LOB-scoped for Agent (see agentVisibleDocEntries()),
  // unrestricted for Trainer/TL/Admin/Client (whoever can see the tab at all).
  if(canViewDocumentation()){
    const docEntries = isAgent() ? agentVisibleDocEntries() : (state.documentationTemplates||[]).filter(e=>!e.archived);
    docEntries.forEach(e=>{
      items.push({
        group: "Documentation Template",
        id: "doc-"+e.id,
        title: e.title||"(untitled)",
        sub: e.subtitle||"",
        haystack: [e.title, e.subtitle, e.bodyText, e.lob].filter(Boolean).join(" ").toLowerCase(),
        onSelect: ()=>{
          currentTab = "documentation";
          docViewTab = "all"; // guarantee the entry is actually visible — a LOB tab or the
                               // Settings tab could otherwise hide it from the rendered list
          expandedDocTitles.add(normalizeDocTitle(e.title));
          render();
          setTimeout(()=>{
            const card = document.querySelector(`.doc-entry-row[data-id="${e.id}"]`);
            if(card) card.scrollIntoView({behavior:"smooth", block:"center"});
          }, 30);
        }
      });
    });
  }

  // IPA / Vendor directory — lives under Documentation → ⚙ Settings, only reachable
  // by whoever can manage that tab (Trainer/TL/Admin). Not otherwise part of any
  // template's text, so without this it was previously invisible to search entirely.
  if(canManageDocumentation()){
    (state.ipaDirectory||[]).forEach(ipa=>{
      items.push({
        group: "IPA / Vendor Directory",
        id: "ipa-"+ipa.id,
        title: ipa.name||"(unnamed IPA)",
        sub: [ipa.code, ipa.phone].filter(Boolean).join(" · "),
        haystack: [ipa.code, ipa.name, ipa.phone, ipa.address].filter(Boolean).join(" ").toLowerCase(),
        onSelect: ()=>{
          currentTab = "documentation";
          docViewTab = "settings";
          docSettingsSubTab = "ipa";
          render();
          setTimeout(()=>{
            const row = document.querySelector(`tr[data-id="${ipa.id}"]`);
            if(row) row.scrollIntoView({behavior:"smooth", block:"center"});
          }, 30);
        }
      });
    });
  }

  if(typeof kbGlobalSearchItems==="function") kbGlobalSearchItems().forEach(i=>items.push(i));
  return items;
}

function performGlobalSearch(query){
  const q = query.trim().toLowerCase();
  if(!q) return [];
  const index = buildGlobalSearchIndex(query);
  return index.filter(item => item.haystack.indexOf(q) !== -1).slice(0, 30);
}

function renderGlobalSearchResults(results, query){
  const box = document.getElementById("globalSearchResults");
  if(!box) return;
  if(!query.trim()){
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  if(!results.length){
    box.innerHTML = `<div class="global-search-empty">No matches for "${esc(query)}"</div>`;
    box.style.display = "block";
    return;
  }
  let lastGroup = null;
  const html = results.map(item=>{
    const groupHtml = item.group!==lastGroup ? `<div class="global-search-group-label">${esc(item.group)}</div>` : "";
    lastGroup = item.group;
    return `${groupHtml}<div class="global-search-item" data-id="${esc(item.id)}">
      <div class="global-search-item-title">${esc(item.title)}</div>
      ${item.sub ? `<div class="global-search-item-sub">${esc(item.sub)}</div>` : ""}
    </div>`;
  }).join("");
  box.innerHTML = html;
  box.style.display = "block";
  box.querySelectorAll(".global-search-item").forEach((el, i)=>{
    el.addEventListener("click", ()=>{
      const item = results.find(r=>r.id===el.dataset.id);
      if(!item) return;
      const input = document.getElementById("globalSearchInput");
      if(input) input.value = "";
      box.style.display = "none";
      const clearBtn = document.getElementById("globalSearchClearBtn");
      if(clearBtn) clearBtn.style.display = "none";
      item.onSelect();
    });
  });
}

(function(){
  const input = document.getElementById("globalSearchInput");
  const clearBtn = document.getElementById("globalSearchClearBtn");
  const resultsBox = document.getElementById("globalSearchResults");
  const wrap = document.getElementById("globalSearchWrap");
  if(!input || !resultsBox || !wrap) return;

  // Icon shows only when the box is empty and unfocused — clicking in (or typing)
  // hides it immediately rather than trying to keep icon and text visually apart.
  input.addEventListener("focus", ()=>{
    wrap.classList.add("search-active");
    if(input.value.trim()) renderGlobalSearchResults(performGlobalSearch(input.value), input.value);
  });
  input.addEventListener("blur", ()=>{
    if(!input.value.trim()) wrap.classList.remove("search-active");
  });
  input.addEventListener("input", ()=>{
    wrap.classList.add("search-active");
    clearBtn.style.display = input.value ? "flex" : "none";
    const results = performGlobalSearch(input.value);
    renderGlobalSearchResults(results, input.value);
  });
  clearBtn.addEventListener("click", ()=>{
    input.value = "";
    clearBtn.style.display = "none";
    resultsBox.style.display = "none";
    resultsBox.innerHTML = "";
    input.focus();
  });
  document.addEventListener("click", (e)=>{
    if(!wrap.contains(e.target)){
      resultsBox.style.display = "none";
      if(!input.value.trim()) wrap.classList.remove("search-active");
    }
  });
  input.addEventListener("keydown", (e)=>{
    if(e.key==="Escape"){ input.blur(); resultsBox.style.display = "none"; }
  });
})();

(function(){
  const sb = document.getElementById("sidebar");
  const pinBtn = document.getElementById("sidebarPinBtn");
  if(!sb || !pinBtn) return;
  let pinned = localStorage.getItem("a360_sidebar_pinned");
  pinned = pinned === null ? true : pinned === "1";

  function apply(){
    sb.classList.toggle("collapsed", !pinned);
    if(!pinned) sb.classList.remove("hover-open");
    pinBtn.classList.toggle("active", pinned);
    pinBtn.textContent = pinned ? "📌" : "📍";
    pinBtn.title = pinned ? "Unpin sidebar (auto-hide when not hovered)" : "Pin sidebar (keep it open)";
  }
  apply();

  pinBtn.addEventListener("click", ()=>{
    pinned = !pinned;
    localStorage.setItem("a360_sidebar_pinned", pinned ? "1" : "0");
    apply();
  });
  sb.addEventListener("mouseenter", ()=>{ if(!pinned) sb.classList.add("hover-open"); });
  sb.addEventListener("mouseleave", ()=>{ sb.classList.remove("hover-open"); });
})();

loadState();
