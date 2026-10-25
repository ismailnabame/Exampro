// ---- CONFIG: only the public URL and anon key go here. Never put secret keys in this file. ----
const SUPABASE_URL = "PASTE_YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "PASTE_YOUR_ANON_KEY_HERE";
const FN = (n) => `${SUPABASE_URL}/functions/v1/api/${n}`;   // one combined Edge Function named "api"

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }, del: (k) => { try { localStorage.removeItem(k); } catch (_) {} } };
let mode = "signin", lastUid, toastTimer, installEvt, payBusy = false, plan = null, picked = new Set(), T = null, timerId = null;
let bmIds = new Set(), lastSid = null, myCentre = null, centrePlan = null, aiHist = [], aiBusy = false;

function toast(msg, err) { const t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500); }
function friendly(e) {
  const m = String(e?.message || e || "").toLowerCase();
  if (m.includes("invalid login")) return "Wrong email or password.";
  if (m.includes("not confirmed")) return "Confirm your email first. Check your inbox.";
  if (m.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (m.includes("no_centre")) return "Create your centre first, then pay.";
  if (m.includes("user_not_found")) return "No Exampro account with that email. Ask them to sign up first.";
  if (m.includes("bad_request")) return "Check the details and try again. Use a valid phone number.";
  if (m.includes("already_in_centre")) return "Your account already belongs to a centre.";
  if (m.includes("licence_required")) return "Your centre licence is not active. Pay or renew it to continue.";
  if (m.includes("no_bookmarks")) return "You have not saved any questions yet.";
  if (m.includes("code_cap")) return "You have reached the code limit for this licence year. Contact support for more.";
  if (m.includes("forbidden")) return "You do not have permission to do that.";
  if (m.includes("rate limit")) return "Too many attempts. Wait a few minutes and try again.";
  if (m.includes("no_questions")) return "No questions found for that choice yet. Try another year or subject.";
  if (m.includes("invalid_or_used_code")) return "That code is invalid, expired or fully used.";
  if (m.includes("already_redeemed")) return "You already used this code.";
  if (m.includes("fetch") || m.includes("network") || m.includes("timeout")) return "Connection problem. Check your internet.";
  return e?.message || "Something went wrong. Try again.";
}
const rpc = (fn, args, ms = 25000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  return sb.rpc(fn, args).abortSignal(c.signal).then((r) => { clearTimeout(t); return r; }, () => { clearTimeout(t); return { data: null, error: { message: "network timeout" } }; }); };
const report = (source, message) => { sb.rpc("report_event", { p_source: source, p_message: message }).then(() => {}, () => {}); };
const token = async () => (await sb.auth.getSession()).data.session?.access_token;
const ask = (title, msg, ok) => new Promise((res) => {
  $("dlgTitle").textContent = title; $("dlgMsg").textContent = msg; $("dlgOk").textContent = ok || "Yes"; $("dlg").classList.remove("hidden");
  const done = (v) => { $("dlg").classList.add("hidden"); res(v); }; $("dlgOk").onclick = () => done(true); $("dlgNo").onclick = () => done(false);
});

// ---- auth ----
$("switchMode").onclick = () => {
  mode = mode === "signin" ? "signup" : "signin";
  $("authTitle").textContent = mode === "signin" ? "Welcome back" : "Create account"; $("authSubmit").textContent = mode === "signin" ? "Sign in" : "Sign up";
  $("switchText").textContent = mode === "signin" ? "New here?" : "Have an account?"; $("switchMode").textContent = mode === "signin" ? "Create account" : "Sign in";
  $("password").autocomplete = mode === "signin" ? "current-password" : "new-password"; $("authMsg").textContent = "";
};
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value, msg = $("authMsg"); msg.className = "msg"; msg.textContent = ""; $("authSubmit").disabled = true;
  try {
    if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      if (!data.session) { msg.className = "msg ok"; msg.textContent = "Account created. Check your email to confirm, then sign in."; }
    } else { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; }
  } catch (err) { msg.textContent = friendly(err); }
  $("authSubmit").disabled = false;
};
$("forgot").onclick = async () => {
  const email = $("email").value.trim(), msg = $("authMsg");
  if (!email) { msg.className = "msg"; return (msg.textContent = "Type your email first."); }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  msg.className = "msg" + (error ? "" : " ok"); msg.textContent = error ? friendly(error) : "Reset link sent. Check your email.";
};
$("logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
sb.auth.onAuthStateChange((event, session) => {
  if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
  const id = session?.user?.id ?? null; if (id === lastUid) return; lastUid = id;
  setTimeout(() => (id ? enterApp(session.user) : (($("app").classList.add("hidden")), $("auth").classList.remove("hidden"))), 0);
});
async function enterApp(user) {
  $("auth").classList.add("hidden"); $("app").classList.remove("hidden"); $("accEmail").textContent = user.email;
  const { data: p } = await sb.from("profiles").select("display_name,role").eq("id", user.id).single(); $("dname").value = p?.display_name || "";
  $("tabAdmin").classList.toggle("hidden", p?.role !== "super_admin");
  loadExams(); loadPlan(); loadCentre(); loadBookmarkIds(); remindInit(); refreshStatus(); checkResume();
  const ref = sessionStorage.getItem("exampro_ref"); if (ref) { sessionStorage.removeItem("exampro_ref"); checkPayment(ref); }
}
$("saveName").onclick = async () => {
  const { error } = await sb.from("profiles").update({ display_name: $("dname").value.trim().slice(0, 40) }).eq("id", lastUid);
  toast(error ? friendly(error) : "Name saved.", !!error);
};

// ---- tabs ----
function goTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden")); $("p-" + name).classList.remove("hidden");
  if (name === "history") { refreshStatus(); loadBoard(); }
  if (name === "saved") loadSaved();
  if (name === "ai" && !$("aiLog").children.length) aiMsg("ai", "Hi! I am your JAMB tutor. Ask me about any topic, or finish a test and tap \"Ask the tutor to explain\" on a question.");
  if (name === "admin") { loadEvents(); loadAnalytics(); loadReports(); }
  if (name === "centre") loadCentre();
}
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => goTab(b.dataset.tab)));

// ---- status, plan ----
async function refreshStatus() {
  const { data } = await sb.rpc("my_status"); if (!data) return;
  $("planChip").textContent = data.pro ? "Pass active" : "No pass"; $("planChip").classList.toggle("free", !data.pro);
  $("sTests").textContent = data.tests; $("sAvg").textContent = data.avg != null ? data.avg + "%" : "–";
  const pi = $("passInfo"); pi.classList.toggle("hidden", !data.pro);
  if (data.pro) pi.textContent = "Your pass is active until " + new Date(data.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + ".";
  $("payBtn").textContent = data.pro ? "Extend by another year" : "Get annual pass";
  const r = $("recent"); r.replaceChildren();
  if (!data.recent.length) r.append(el("p", "sub", "Finished tests will appear here."));
  data.recent.forEach((t) => {
    const row = el("div", "rrow"), l = el("div"); l.append(el("b", "", `${t.exam_code} · ${t.mode === "mock" ? "Timed mock" : "Practice"}`), el("div", "sub", new Date(t.started_at).toLocaleString()));
    const b = el("button", "", `${t.score}/${t.total} · Review`); b.onclick = () => openReview(t.id); row.append(l, b); r.append(row);
  });
}
async function loadPlan() {
  const { data: all } = await sb.from("plans").select("*").eq("active", true); centrePlan = all?.find((p) => p.id === "centre") || null;
  const data = all?.find((p) => p.id === "annual"); if (!data) return;
  plan = data; $("planName").textContent = data.name; $("planPrice").textContent = "₦" + (data.amount_kobo / 100).toLocaleString() + " / year";
}

// ---- test setup ----
async function loadExams() {
  const { data } = await sb.from("exams").select("code,name").order("name"); const s = $("exam"); s.replaceChildren();
  (data || []).forEach((x) => { const o = el("option", "", x.name); o.value = x.code; s.append(o); }); if (data?.length) loadExamInfo();
}
$("exam").onchange = loadExamInfo;
async function loadExamInfo() {
  picked.clear(); updateStart(); $("subjects").replaceChildren(el("p", "sub", "Loading…"));
  const { data } = await sb.rpc("exam_info", { p_exam: $("exam").value }); const box = $("subjects"); box.replaceChildren();
  if (!data?.subjects.length) box.append(el("p", "sub", "No questions added for this exam yet."));
  data?.subjects.forEach((s) => {
    const b = el("button", "pick", s.name); b.type = "button";
    b.onclick = () => { if (picked.has(s.code)) picked.delete(s.code); else if (picked.size < 4) picked.add(s.code); else return toast("You can choose up to 4 subjects."); b.classList.toggle("sel", picked.has(s.code)); updateStart(); };
    box.append(b);
  });
  const y = $("year"); y.replaceChildren(el("option", "", "All years")); y.firstChild.value = "";
  (data?.years || []).forEach((v) => { const o = el("option", "", v); o.value = v; y.append(o); });
}
function updateStart() { $("startBtn").disabled = picked.size === 0; $("hint").textContent = picked.size ? `${picked.size} subject${picked.size > 1 ? "s" : ""} selected.` : "Pick at least one subject."; }
$("startBtn").onclick = async () => {
  $("startBtn").disabled = true;
  const { data, error } = await rpc("start_test", { p_exam: $("exam").value, p_subjects: [...picked], p_mode: $("mode").value, p_year: $("year").value ? Number($("year").value) : null, p_per_subject: Number($("count").value) });
  $("startBtn").disabled = false; if (error) return toast(friendly(error), true); openTest(data);
};
async function checkResume() {
  const id = store.get("exampro_active"); $("resumeBox").classList.add("hidden"); if (!id) return;
  const { data } = await rpc("get_test", { p_session: id });
  if (!data || data.submitted || (data.remaining_sec !== null && data.remaining_sec <= 0)) { if (data && !data.submitted) { await rpc("submit_test", { p_session: id }); refreshStatus(); } store.del("exampro_active"); return; }
  $("resumeBox").classList.remove("hidden"); $("resumeBtn").onclick = () => openTest(data);
}

// ---- test screen ----
function openTest(d) {
  T = { id: d.id, mode: d.mode, exam: d.exam, qs: d.questions, ans: { ...d.answers }, pend: {}, flags: new Set(), i: 0, subj: null,
        endAt: d.remaining_sec == null ? null : Date.now() + d.remaining_sec * 1000 };
  store.set("exampro_active", d.id); $("tTitle").textContent = `${d.exam} · ${d.mode === "mock" ? "Timed mock" : "Practice"}`;
  const subs = [...new Set(T.qs.map((q) => q.subject))], tabs = $("subTabs"); tabs.replaceChildren();
  subs.forEach((s) => { const b = el("button", "pick", s); b.onclick = () => { T.i = T.qs.findIndex((q) => q.subject === s); render(); }; tabs.append(b); });
  $("timer").classList.toggle("hidden", T.endAt == null); $("test").classList.remove("hidden"); render(); flush();
  clearInterval(timerId); if (T.endAt) { timerId = setInterval(tick, 1000); tick(); }
}
const setSave = (t) => { $("saveState").textContent = t; };
function tick() {
  const s = Math.max(0, Math.round((T.endAt - Date.now()) / 1000)), m = Math.floor(s / 60);
  $("timer").textContent = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; $("timer").classList.toggle("low", s <= 300);
  if (s === 0) { clearInterval(timerId); toast("Time is up. Submitting your test."); finish(true); }
}
function render() {
  const q = T.qs[T.i]; $("qNum").textContent = `Question ${T.i + 1} of ${T.qs.length} · ${q.subject}`; $("qText").textContent = q.question;
  $("flagBtn").textContent = T.flags.has(q.id) ? "⚑ Flagged" : "⚑ Flag"; $("bmBtn").textContent = bmIds.has(q.id) ? "★ Saved" : "☆ Save";
  const o = $("qOpts"); o.replaceChildren();
  Object.keys(q.options).sort().forEach((k) => {
    const b = el("button", "opt" + (T.ans[q.id] === k ? " sel" : "")); b.append(el("b", "", k), el("span", "", q.options[k]));
    b.onclick = () => { T.ans[q.id] = k; T.pend[q.id] = k; render(); flush(); }; o.append(b);
  });
  $("prevBtn").disabled = T.i === 0; $("nextBtn").textContent = T.i === T.qs.length - 1 ? "Review" : "Next";
  const g = $("qGrid"); g.replaceChildren();
  T.qs.forEach((x, n) => { const b = el("button", "qn" + (T.ans[x.id] ? " done" : "") + (T.flags.has(x.id) ? " flag" : "") + (n === T.i ? " cur" : ""), n + 1); b.onclick = () => { T.i = n; render(); }; g.append(b); });
  $("answeredCount").textContent = `${Object.keys(T.ans).length} of ${T.qs.length} answered`;
  [...$("subTabs").children].forEach((b) => b.classList.toggle("sel", b.textContent === q.subject));
}
$("prevBtn").onclick = () => { if (T.i > 0) { T.i--; render(); } };
$("nextBtn").onclick = () => { if (T.i < T.qs.length - 1) { T.i++; render(); } else $("submitBtn").click(); };
$("flagBtn").onclick = () => { const id = T.qs[T.i].id; T.flags.has(id) ? T.flags.delete(id) : T.flags.add(id); render(); };
$("reportBtn").onclick = async () => {
  const { error } = await sb.from("question_reports").insert({ question_id: T.qs[T.i].id, user_id: lastUid, note: "Reported from test screen" });
  toast(error ? friendly(error) : "Thanks. We will check this question.", !!error);
};
// Each answer is sent as soon as it is chosen. On a slow network it retries every few seconds until it is saved.
let flushing = false, retryT = null;
async function flush() {
  if (!T || flushing) return; flushing = true; setSave("Saving…"); let failed = false;
  for (const [qid, c] of Object.entries(T.pend)) {
    const { error } = await rpc("save_answer", { p_session: T.id, p_qid: qid, p_choice: c });
    if (!error || /closed|time_up/.test(error.message)) { if (T.pend[qid] === c) delete T.pend[qid]; } else { failed = true; break; }
  }
  flushing = false;
  if (failed) { T.fails = (T.fails || 0) + 1; if (T.fails === 3) report("save-failed", "Answers failed to save 3 times in a row"); setSave("Slow network. Retrying…"); clearTimeout(retryT); retryT = setTimeout(flush, 4000); }
  else { T.fails = 0; if (Object.keys(T.pend).length) return flush(); setSave("Saved"); }
}
addEventListener("online", () => flush());
$("submitBtn").onclick = async () => {
  const left = T.qs.length - Object.keys(T.ans).length;
  if (await ask("Submit test?", left ? `You have ${left} unanswered question${left > 1 ? "s" : ""}. You cannot change answers after submitting.` : "You cannot change answers after submitting.", "Submit")) finish(false);
};
async function finish(auto) {
  await flush();
  if (!auto && Object.keys(T.pend).length) return toast("Still saving your answers on a slow network. Try Submit again in a moment.", true);
  const { data, error } = await rpc("submit_test", { p_session: T.id });
  if (error || !data) { report("submit-failed", String(error?.message || "no data")); return toast("Could not submit yet. Your answers are saved. Tap Submit again.", true); }
  clearInterval(timerId); store.del("exampro_active"); $("test").classList.add("hidden"); const sid = T.id; T = null; showResult(data, sid); refreshStatus(); $("resumeBox").classList.add("hidden");
}

// ---- results and review ----
function showResult(d, sid) { lastSid = sid;
  $("rScore").textContent = `${d.score}/${d.total}`; $("rPct").textContent = `${d.total ? Math.round((d.score / d.total) * 100) : 0}% correct`;
  const s = $("rSubj"); s.replaceChildren();
  d.by_subject.forEach((x) => { const r = el("div", "srow"), h = el("div"); h.append(el("b", "", x.subject), el("span", "sub", `${x.correct}/${x.total}`)); const bar = el("div", "bar"), i = el("i"); i.style.width = (x.total ? (x.correct / x.total) * 100 : 0) + "%"; bar.append(i); r.append(h, bar); s.append(r); });
  const rv = $("rReview"); rv.replaceChildren();
  d.review.forEach((q, n) => {
    const box = el("div", "rv"); box.append(el("p", "q", `${n + 1}. ${q.question}`));
    Object.keys(q.options).sort().forEach((k) => { const o = el("div", "opt" + (k === q.correct ? " right" : k === q.choice ? " wrong" : "")); o.append(el("b", "", k), el("span", "", q.options[k] + (k === q.choice ? "  (your answer)" : ""))); box.append(o); });
    if (!q.choice) box.append(el("p", "sub", "You did not answer this question."));
    if (q.explanation) box.append(el("p", "expl", q.explanation));
    const ex = el("button", "link", "Ask the tutor to explain"); ex.onclick = () => { $("result").classList.add("hidden"); goTab("ai"); askAI(`Explain question ${n + 1}: why is ${q.correct} the correct answer?`, q.id); };
    const bm = el("button", "link", bmIds.has(q.id) ? "★ Saved" : "☆ Save question"); bm.onclick = () => toggleBookmark(q.id, bm, "☆ Save question"); box.append(ex, bm); rv.append(box);
  });
  $("result").classList.remove("hidden"); $("result").scrollTop = 0;
}
async function openReview(id) { const { data, error } = await rpc("submit_test", { p_session: id }); if (error) return toast(friendly(error), true); showResult(data, id); }
$("rDone").onclick = () => { $("result").classList.add("hidden"); goTab("home"); };

// ---- annual pass (price is read from the plans table, never from the browser) ----
$("payBtn").onclick = async () => {
  if (payBusy || !plan) return; payBusy = true;
  try {
    const res = await fetch(FN("paystack-init"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ plan: plan.id }) });
    const out = await res.json(); if (!res.ok || !out.url) throw new Error("init");
    sessionStorage.setItem("exampro_ref", out.reference); location.href = out.url; return;
  } catch (_) { toast("Could not open checkout. Check your connection and try again.", true); }
  payBusy = false;
};
addEventListener("pageshow", (e) => { if (e.persisted) payBusy = false; });
(function () { const p = new URLSearchParams(location.search), ref = p.get("reference") || p.get("trxref"); if (ref) { history.replaceState({}, "", location.pathname); sessionStorage.setItem("exampro_ref", ref); } })();
function showPay(t, m) { $("payTitle").textContent = t; $("payMsg").textContent = m; $("payOverlay").classList.remove("hidden"); }
$("payClose").onclick = () => $("payOverlay").classList.add("hidden");
async function checkPayment(ref) {
  showPay("Confirming payment…", "Keep this page open. It only takes a moment.");
  try {
    const res = await fetch(FN("paystack-verify"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ reference: ref }) });
    const out = await res.json();
    if (out.status === "success") { await refreshStatus(); loadCentre(); return showPay("Payment confirmed", "Your payment was confirmed and your access is now active."); }
    if (out.status === "pending") { sessionStorage.setItem("exampro_ref", ref); return showPay("Still processing", "Your bank has not confirmed yet. Reopen the app in a few minutes."); }
    showPay("Payment failed", "If money left your account, contact support with reference " + ref + ".");
  } catch (_) { sessionStorage.setItem("exampro_ref", ref); showPay("Could not confirm yet", "Check your connection and reopen the app."); }
}
$("codeForm").onsubmit = async (e) => {
  e.preventDefault(); const code = $("code").value.trim(); if (!code) return;
  const { data, error } = await sb.rpc("redeem_code", { p_code: code }); if (error) return toast(friendly(error), true);
  $("code").value = ""; await refreshStatus(); toast("Code accepted. Pass active until " + new Date(data).toLocaleDateString());
};

// ---- PWA, connectivity ----
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; });
$("installBtn").onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("installBtn").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// ---- AI tutor ----
function aiMsg(role, text) { const d = el("div", "aimsg " + role, text); if (!text) { d.classList.add("typing"); d.append(el("i"), el("i"), el("i")); } $("aiLog").append(d); $("aiLog").scrollTop = $("aiLog").scrollHeight; return d; }
async function askAI(text, qid) {
  text = (text || "").trim(); if (!text || aiBusy) return; aiBusy = true; $("aiSend").disabled = true;
  aiMsg("user", text); const wait = aiMsg("ai", ""), c = new AbortController(), t = setTimeout(() => c.abort(), 30000);
  try {
    const res = await fetch(FN("ai-tutor"), { method: "POST", signal: c.signal, headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, question_id: qid || undefined, history: aiHist.slice(-6) }) });
    const out = await res.json().catch(() => null);
    if (res.ok && out?.reply) { wait.textContent = out.reply; aiHist.push({ role: "user", content: text }, { role: "assistant", content: out.reply }); $("aiLeft").textContent = `${out.left} tutor question${out.left === 1 ? "" : "s"} left today`; }
    else if (out?.error === "daily_limit") wait.textContent = "You have used today's tutor questions. They reset at midnight. A pass gives you more.";
    else if (out?.error === "busy") wait.textContent = "The tutor is very busy right now. Please try again later.";
    else wait.textContent = "The tutor could not answer. Try again.";
  } catch (_) { wait.textContent = "Slow network. Please try again."; }
  wait.classList.remove("typing"); $("aiLog").scrollTop = $("aiLog").scrollHeight; clearTimeout(t); aiBusy = false; $("aiSend").disabled = false;
}
$("aiForm").onsubmit = (e) => { e.preventDefault(); const v = $("aiInput").value; $("aiInput").value = ""; askAI(v); };

// ---- admin monitoring (only super_admin can read app_events; the database enforces it) ----
async function loadEvents() {
  const lvl = $("evLevel").value, list = $("evList"); list.replaceChildren(el("p", "sub", "Loading…"));
  let q = sb.from("app_events").select("*").order("created_at", { ascending: false }).limit(50); if (lvl !== "all") q = q.eq("level", lvl);
  const day = new Date(Date.now() - 864e5).toISOString(), week = new Date(Date.now() - 6048e5).toISOString();
  const [ev, errs, pay] = await Promise.all([q,
    sb.from("app_events").select("id", { count: "exact", head: true }).eq("level", "error").gte("created_at", day),
    sb.from("app_events").select("id", { count: "exact", head: true }).like("source", "paystack%").in("level", ["warn", "error"]).gte("created_at", week)]);
  $("evErr").textContent = errs.count ?? "–"; $("evPay").textContent = pay.count ?? "–";
  list.replaceChildren(); if (ev.error) return list.append(el("p", "sub", "Could not load events."));
  if (!ev.data.length) list.append(el("p", "sub", "Nothing to show."));
  ev.data.forEach((e) => {
    const d = el("details"), s = el("summary", "", `${/PAID BUT/.test(e.message) ? "⚠️ " : ""}${e.source}: ${e.message}`);
    d.append(s, el("p", "sub", new Date(e.created_at).toLocaleString() + (e.user_id ? " · user " + e.user_id.slice(0, 8) : "")), el("pre", "", e.detail ? JSON.stringify(e.detail, null, 1) : "")); list.append(d);
  });
}
$("evReload").onclick = loadEvents; $("evLevel").onchange = loadEvents;

// ---- centres: create instantly, pay the licence, then manage tutors ----
async function loadCentre() {
  const { data } = await rpc("my_centres", {}); const list = data || [];
  const owned = list.find((c) => c.role === "centre_admin") || null, tutorAt = list.find((c) => c.role === "tutor" && c.active) || null;
  const staff = owned?.active ? owned : tutorAt; myCentre = staff;
  $("tabCentre").classList.toggle("hidden", !staff);           // the dashboard stays hidden until the licence is paid
  $("centreApply").classList.toggle("hidden", !!staff);
  if (!staff) {
    const price = centrePlan ? "₦" + (centrePlan.amount_kobo / 100).toLocaleString() + " per year" : "the licence fee";
    if (owned) { $("aName").value = owned.name; $("aLoc").value = owned.location || ""; $("aPhone").value = owned.phone || ""; }
    $("applyState").textContent = !owned ? `Set up your centre in minutes. Pay the centre licence (${price}) and your dashboard opens immediately.`
      : owned.ends_at ? `Your licence for ${owned.name} has expired. Pay ${price} to renew and unlock your dashboard.`
      : `Your centre ${owned.name} is created, but its licence is unpaid. Pay ${price} to unlock your dashboard.`;
    return;
  }
  $("cName").textContent = staff.name;
  $("cRole").textContent = (staff.role === "centre_admin" ? "You are the centre admin." : "You are a tutor at this centre.") + (staff.ends_at ? " Licence valid until " + new Date(staff.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + "." : "");
  $("cStaff").classList.toggle("hidden", staff.role !== "centre_admin"); $("cCodes").classList.toggle("hidden", staff.role !== "centre_admin"); if (staff.role === "centre_admin") loadMembers();
}
$("applyForm").onsubmit = async (e) => {
  e.preventDefault(); const btn = $("applyBtn"); btn.disabled = true;
  const { data: cid, error } = await rpc("create_centre_instant", { p_name: $("aName").value, p_location: $("aLoc").value, p_phone: $("aPhone").value });
  if (error || !cid) { btn.disabled = false; return toast(friendly(error), true); }
  try {
    const res = await fetch(FN("paystack-init"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ plan: "centre", centre_id: cid }) });
    const out = await res.json(); if (!res.ok || !out.url) throw new Error("init");
    sessionStorage.setItem("exampro_ref", out.reference); location.href = out.url; return;
  } catch (_) { toast("Your centre is saved, but checkout did not open. Tap the button to try again.", true); }
  btn.disabled = false; loadCentre();
};
async function loadMembers() {
  const { data } = await rpc("centre_members", { p_centre: myCentre.id }); const l = $("cList"); l.replaceChildren();
  (data || []).forEach((m) => {
    const r = el("div", "rrow"), t = el("div"); t.append(el("b", "", m.email), el("div", "sub", m.role === "centre_admin" ? "Centre admin" : "Tutor")); r.append(t);
    if (m.role === "tutor") { const b = el("button", "btn sm danger", "Remove"); b.onclick = async () => { if (!(await ask("Remove tutor?", m.email + " will lose access to this centre.", "Remove"))) return; const { error } = await rpc("centre_remove_tutor", { p_centre: myCentre.id, p_user: m.user_id }); if (error) toast(friendly(error), true); loadMembers(); }; r.append(b); }
    l.append(r);
  });
}
$("tutorForm").onsubmit = async (e) => {
  e.preventDefault(); const { error } = await rpc("centre_add_tutor", { p_centre: myCentre.id, p_email: $("tutorEmail").value });
  if (error) return toast(friendly(error), true); $("tutorEmail").value = ""; toast("Tutor added."); loadMembers();
};

// ---- bookmarks and saved questions ----
async function loadBookmarkIds() { const { data } = await sb.from("bookmarks").select("question_id"); bmIds = new Set((data || []).map((x) => x.question_id)); }
async function toggleBookmark(qid, btn, offLabel) {
  const { data, error } = await rpc("toggle_bookmark", { p_qid: qid }); if (error) return toast(friendly(error), true);
  data ? bmIds.add(qid) : bmIds.delete(qid); btn.textContent = data ? "★ Saved" : offLabel; toast(data ? "Saved." : "Removed from saved.");
}
$("bmBtn").onclick = () => toggleBookmark(T.qs[T.i].id, $("bmBtn"), "☆ Save");
async function loadSaved() {
  const { data } = await rpc("my_bookmarks", {}); const l = $("savedList"); l.replaceChildren(); const rows = data || [];
  $("savedPractice").disabled = !rows.length;
  $("savedCount").textContent = rows.length ? `${rows.length} saved question${rows.length > 1 ? "s" : ""}` : "Nothing saved yet. Tap Save on a question during a test or in your review.";
  rows.forEach((q) => { const r = el("div", "rrow"), t = el("div"); t.append(el("b", "", q.subject), el("div", "sub", q.question.slice(0, 140)));
    const b = el("button", "btn sm danger", "Remove"); b.onclick = async () => { await toggleBookmark(q.id, b, "Remove"); loadSaved(); }; r.append(t, b); l.append(r); });
}
$("savedPractice").onclick = async () => { const { data, error } = await rpc("start_saved_test", {}); if (error) return toast(friendly(error), true); openTest(data); };

// ---- leaderboard and retake ----
async function loadBoard() {
  const { data } = await rpc("get_leaderboard", {}); const l = $("boardList"); l.replaceChildren(); if (!data) return;
  $("boardMe").textContent = data.me ? `Your rank: #${data.me.rank}, ${data.me.avg}% average over ${data.me.tests} tests` : "Finish 3 tests and set a display name in Account to join the leaderboard.";
  if (!data.top.length) l.append(el("p", "sub", "No one is ranked yet."));
  data.top.forEach((u) => { const r = el("div", "rrow" + (u.me ? " me" : "")), t = el("div"); t.append(el("b", "", `#${u.rank} ${u.name}`), el("div", "sub", `${u.tests} tests`)); r.append(t, el("b", "", u.avg + "%")); l.append(r); });
}
$("retakeBtn").onclick = async () => {
  if (!lastSid) return; $("retakeBtn").disabled = true;
  const { data, error } = await rpc("retake_test", { p_session: lastSid }); $("retakeBtn").disabled = false;
  if (error) return toast(friendly(error), true); $("result").classList.add("hidden"); openTest(data);
};

// ---- admin: analytics, SdashAPI import, flagged questions ----
async function loadAnalytics() {
  const { data } = await rpc("admin_analytics", {}); if (!data) return;
  $("anRev").textContent = "₦" + Math.round(data.revenue_kobo / 100).toLocaleString(); $("anUsers").textContent = data.users; $("anPaid").textContent = data.paid_students; $("anQ").textContent = data.questions;
}
$("sdashForm").onsubmit = async (e) => {
  e.preventDefault(); const b = e.target.querySelector("button"); b.disabled = true;
  try {
    const res = await fetch(FN("import-sdash"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: $("sdSubject").value, year: Number($("sdYear").value), limit: Number($("sdLimit").value) }) });
    const out = await res.json().catch(() => null);
    toast(res.ok ? `Imported ${out.imported}, skipped ${out.skipped} (of ${out.received})` : "Import failed: " + (out?.error || res.status), !res.ok);
  } catch (_) { toast("Network problem. Try again.", true); }
  b.disabled = false; loadAnalytics();
};
async function loadReports() {
  const { data } = await rpc("admin_reports", {}); const l = $("repList"); l.replaceChildren();
  if (!data?.length) return l.append(el("p", "sub", "No flagged questions."));
  data.forEach((r) => {
    const box = el("div", "rv"); box.append(el("b", "", `${r.subject}, reported ${new Date(r.created_at).toLocaleDateString()}`), el("p", "q", r.question));
    Object.keys(r.options).sort().forEach((k) => { const o = el("div", "opt" + (k === r.correct ? " right" : "")); o.append(el("b", "", k), el("span", "", r.options[k])); box.append(o); });
    if (r.note) box.append(el("p", "sub", "Note: " + r.note));
    const row = el("div", "row"), f = el("button", "btn sm primary", "Mark as Fixed"), d = el("button", "btn sm danger", "Delete question");
    const act = async (a, msg) => {
      if (a === "delete" && !(await ask("Delete this question?", "It is removed from all future tests. Past results keep their history.", "Delete"))) return;
      const { error } = await rpc("admin_report_action", { p_id: r.id, p_action: a }); if (error) return toast(friendly(error), true); toast(msg); loadReports();
    };
    f.onclick = () => act("fixed", "Marked as fixed."); d.onclick = () => act("delete", "Question deleted."); row.append(f, d); box.append(row); l.append(box);
  });
}

// ---- centre access codes ----
document.querySelectorAll("[data-codes]").forEach((b) => (b.onclick = async () => {
  if (!myCentre) return;
  if (!(await ask(`Generate ${b.dataset.codes} codes?`, "Each code gives one student a one-year pass. Codes are shown once, so copy or print them now.", "Generate"))) return;
  b.disabled = true; const { data, error } = await rpc("generate_centre_codes", { p_centre: myCentre.id, p_count: Number(b.dataset.codes) }, 60000); b.disabled = false;
  if (error) return toast(friendly(error), true); showCodes(data);
}));
function showCodes(codes) {
  $("codeOut").textContent = codes.join("\n"); $("codeBox").classList.remove("hidden");
  $("codeCopy").onclick = async () => { try { await navigator.clipboard.writeText(codes.join("\n")); toast("Codes copied."); } catch (_) { toast("Could not copy.", true); } };
  $("codePrint").onclick = () => { const d = el("div"); d.id = "printArea"; d.append(el("h2", "", `${myCentre.name}: Exampro access codes`), el("pre", "", codes.join("\n"))); document.body.append(d); document.body.classList.add("printing"); window.print(); document.body.classList.remove("printing"); d.remove(); };
}

// ---- daily reminder (a local notification, shown when the app is open or running in the background) ----
const todayKey = () => new Date().toDateString();
function remindInit() {
  if (!("Notification" in window)) return $("remindCard").classList.add("hidden");
  const on = store.get("exampro_remind") === "1" && Notification.permission === "granted";
  $("remindBtn").textContent = on ? "Daily reminder is on (tap to turn off)" : "Turn on daily reminder"; checkReminder();
}
$("remindBtn").onclick = async () => {
  if (store.get("exampro_remind") === "1") { store.set("exampro_remind", "0"); return remindInit(); }
  const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (p !== "granted") return toast("Notifications are blocked. Allow them in your browser settings.", true);
  store.set("exampro_remind", "1"); toast("Reminder on. You will be reminded in the evening if you have not practised."); remindInit();
};
async function checkReminder() {
  if (store.get("exampro_remind") !== "1" || !("Notification" in window) || Notification.permission !== "granted") return;
  if (new Date().getHours() < 17 || store.get("exampro_reminded") === todayKey()) return;
  const { data } = await sb.rpc("my_status"); if (!data) return;
  if (data.last_test && new Date(data.last_test).toDateString() === todayKey()) return;
  store.set("exampro_reminded", todayKey());
  const reg = await navigator.serviceWorker?.getRegistration(), o = { body: "You have not practised today. A short test helps you improve.", icon: "icon-192.png", tag: "exampro-daily" };
  if (reg) reg.showNotification("Time to practise", o); else new Notification("Time to practise", o);
}
setInterval(checkReminder, 30 * 60 * 1000); document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminder(); });
