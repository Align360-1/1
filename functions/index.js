/* =========================================================
   Ally LLM proxy  (functions/index.js)
   ---------------------------------------------------------
   The ONLY place the AI API key lives (as the Firebase secret LLM_API_KEY — never in js/ or index.html).
   The browser sends just a short question; THIS file owns the prompt, so the endpoint can't be reused as a
   free general-purpose chatbot. The model never sees Align360 data: it only rewrites a free-text question
   into one the rule-based Ally engine understands. Ally then answers it from the user's own scoped data.

   Identity note: Align360 logs in with its own accounts and Firebase *anonymous* auth, so the Firebase token
   proves "a visitor of this app", not a role. That's fine here — this function holds no data and returns
   only a reworded question.
   ========================================================= */
const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret, defineString} = require("firebase-functions/params");
const admin = require("firebase-admin");
admin.initializeApp();

const LLM_API_KEY  = defineSecret("LLM_API_KEY");
const LLM_PROVIDER = defineString("LLM_PROVIDER", {default: "gemini"});          // "gemini" | "openai"
const LLM_MODEL    = defineString("LLM_MODEL",    {default: "gemini-2.5-flash"}); // e.g. "gpt-4o-mini" for openai

const SYSTEM = [
  "You rewrite a user's message into ONE short English question that 'Ally', a rule-based assistant inside the Align360",
  "contact-centre performance app, can answer. Ally understands questions about: agent/team KPIs (AHT, CQ, attendance, targets,",
  "rankings, who is at risk), attendance and leave (who is on leave today/tomorrow/in a month, missing attendance), shifts, breaks",
  "and shift swaps, the roster (agents per LOB, inactive agents, new joiners), quality audits, PKT results, sup calls (LEO),",
  "the Daily Summary (service level, occupancy), Knowledge Base articles, documentation templates and process updates.",
  "Rules: keep person names, LOB names, months and metric names exactly as the user wrote them; never invent names;",
  "never answer the question yourself; if the message is not about these topics or cannot be mapped, return null.",
  'Reply with JSON only: {"q": "<rewritten question under 200 characters>"} or {"q": null}.'
].join(" ");

/* best-effort per-visitor limit (each warm instance keeps its own counter; maxInstances caps the total) */
const hits = new Map();
function limited(uid){
  const now = Date.now(), win = hits.get(uid) || [];
  const recent = win.filter(t => now - t < 60000);
  recent.push(now); hits.set(uid, recent);
  if(hits.size > 5000) hits.clear();
  return recent.length > 12;
}

function clean(s, n){ return String(s == null ? "" : s).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n); }

async function callGemini(key, model, userText){
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: {"Content-Type": "application/json", "x-goog-api-key": key},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: SYSTEM}]},
      contents: [{role: "user", parts: [{text: userText}]}],
      generationConfig: {temperature: 0, maxOutputTokens: 120, responseMimeType: "application/json"}
    })
  });
  if(!r.ok) throw new Error("gemini " + r.status);
  const j = await r.json();
  const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  return parts && parts[0] && parts[0].text || "";
}
async function callOpenAI(key, model, userText){
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": "Bearer " + key},
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 120, response_format: {type: "json_object"},
      messages: [{role: "system", content: SYSTEM}, {role: "user", content: userText}]
    })
  });
  if(!r.ok) throw new Error("openai " + r.status);
  const j = await r.json();
  return j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "";
}

exports.allyLlm = onRequest(
  {region: "asia-south1", secrets: [LLM_API_KEY], cors: true, maxInstances: 5, timeoutSeconds: 15, memory: "256MiB"},
  async (req, res) => {
    try{
      if(req.method !== "POST") return res.status(405).json({error: "POST only"});
      const m = /^Bearer (.+)$/.exec(req.get("Authorization") || "");
      if(!m) return res.status(401).json({error: "Sign in first"});
      let uid;
      try{ uid = (await admin.auth().verifyIdToken(m[1])).uid; }catch(e){ return res.status(401).json({error: "Invalid sign-in"}); }
      if(limited(uid)) return res.status(429).json({error: "Too many requests — try again in a minute"});

      const question = clean(req.body && req.body.question, 300);
      const prev = clean(req.body && req.body.prev, 300);
      if(!question) return res.status(400).json({error: "Missing question"});

      const userText = (prev ? "Previous question: " + prev + "\n" : "") + "Message: " + question;
      const key = LLM_API_KEY.value(), model = LLM_MODEL.value();
      const raw = LLM_PROVIDER.value() === "openai" ? await callOpenAI(key, model, userText) : await callGemini(key, model, userText);

      let q = null;
      try{ const j = JSON.parse(String(raw).replace(/^```(?:json)?|```$/g, "").trim()); if(typeof j.q === "string") q = clean(j.q, 200) || null; }catch(e){}
      return res.json({q});
    }catch(e){
      console.error("allyLlm failed:", e && e.message);   // never log the key or the question
      return res.status(502).json({error: "AI service unavailable"});
    }
  }
);
