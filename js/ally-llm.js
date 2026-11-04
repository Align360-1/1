/* =========================================================
   ALLY — optional AI helper  (js/ally-llm.js)
   ---------------------------------------------------------
   When Ally's rules can't make sense of a question, this asks an AI model (Gemini/OpenAI, via the Cloud Function in
   functions/index.js) to REWORD it into a question Ally understands. Ally then answers that from the user's own
   scoped data, exactly as before.
     - Only the typed question (+ the previous question, for follow-ups) leaves the browser. No Align360 data, no role.
     - No API key here. The key is a server-side secret; this file only knows the function's URL.
     - Any failure (offline, not deployed, limit hit) returns null and Ally behaves as it did before.
   To switch the AI helper off: set ENDPOINT to "".
   ========================================================= */
const AllyLLM = (function(){
  "use strict";
  const ENDPOINT = "https://asia-south1-align360-6fa04.cloudfunctions.net/allyLlm";
  const TIMEOUT_MS = 8000, MAX_FAILS = 3, PAUSE_MS = 5 * 60 * 1000;
  let fails = 0, pausedUntil = 0;

  function available(){
    return !!ENDPOINT && Date.now() >= pausedUntil && typeof firebase !== "undefined" && !!(firebase.auth && firebase.auth().currentUser);
  }
  function fail(){ if(++fails >= MAX_FAILS){ pausedUntil = Date.now() + PAUSE_MS; fails = 0; } return null; }

  async function rewrite(question, prev){
    if(!available()) return null;
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(()=>{ if(ctl) ctl.abort(); }, TIMEOUT_MS);
    try{
      const token = await firebase.auth().currentUser.getIdToken();
      const r = await fetch(ENDPOINT, {
        method: "POST",
        headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token},
        body: JSON.stringify({question: String(question||"").slice(0,300), prev: String(prev||"").slice(0,300)}),
        signal: ctl ? ctl.signal : undefined
      });
      if(!r.ok) return fail();
      const j = await r.json();
      fails = 0;
      return (j && typeof j.q === "string" && j.q.trim()) ? j.q.trim().slice(0,200) : null;
    }catch(e){ return fail(); }
    finally{ clearTimeout(timer); }
  }
  return {available, rewrite};
})();
