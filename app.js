// The Supabase URL and anon key live in config.js (fill them in once there).
if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined" || /PASTE_YOUR/.test(SUPABASE_URL + SUPABASE_ANON_KEY)) {
  document.body.textContent = "Setup needed: open config.js and paste your Supabase URL and anon key, then reload.";
  throw new Error("config.js is not filled in");
}
const FN = (n) => `${SUPABASE_URL}/functions/v1/api/${n}`;   // one combined Edge Function named "api"

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} }, del: (k) => { try { localStorage.removeItem(k); } catch (_) {} } };
let mode = "signin", lastUid, toastTimer, installEvt, plan = null, picked = new Set(), T = null, timerId = null;
let bmIds = new Set(), lastSid = null, lastResult = null, myCentre = null, centrePlan = null, pinPlan = null, pinCodes = [], aiHist = [], aiBusy = false;
const QIMG = {}, QIMG_ASKED = new Set();   // question id -> image url

function toast(msg, err) { const t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500); }
function friendly(e) {
  const m = String(e?.message || e || "").toLowerCase();
  if (m.includes("invalid login")) return "Wrong email or password.";
  if (m.includes("not confirmed")) return "Confirm your email first. Check your inbox.";
  if (m.includes("already registered")) return "That email already has an account. Sign in instead.";
  if (m.includes("no_centre")) return "Create your centre first, then pay.";
  if (m.includes("user_not_found")) return "No Exampro account with that email. Ask them to sign up first.";
  if (m.includes("bad_quantity")) return "Enter a number of students from 1 to 500.";
  if (m.includes("bad_request")) return "Check the details and try again. Use a valid phone number.";
  if (m.includes("already_in_centre")) return "Your account already belongs to a centre.";
  if (m.includes("licence_required")) return "Your centre licence is not active. Pay or renew it to continue.";
  if (m.includes("free_limit_mock")) return "You have used this month's free timed mock. Get a pass for unlimited tests, or try Study mode.";
  if (m.includes("free_limit_practice")) return "You have used this month's free practice tests. Get a pass to keep practising.";
  if (m.includes("not_study")) return "Answers can only be revealed in Study mode.";
  if (m.includes("no_bookmarks")) return "You have not saved any questions yet.";
  if (m.includes("forbidden")) return "You do not have permission to do that.";
  if (m.includes("rate limit")) return "Too many attempts. Wait a few minutes and try again.";
  if (m.includes("no_questions")) return "No questions found for that choice yet. Try another year or subject.";
  if (m.includes("invalid_or_used_code")) return "That pin is invalid, expired or already used.";
  if (m.includes("already_redeemed")) return "You already used this pin.";
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
// Shows a spinner on a button while an async job runs, and ignores extra taps meanwhile.
async function busy(btn, fn) {
  if (!btn || btn.classList.contains("loading")) return;
  const was = btn.disabled; btn.classList.add("loading"); btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove("loading"); btn.disabled = was; }
}
// A friendly "nothing here yet" block, optionally with a button.
function empty(icon, title, text, label, onclick) {
  const d = el("div", "empty"); d.append(el("i", "", icon), el("b", "", title), el("span", "", text));
  if (label) { const b = el("button", "btn primary", label); b.onclick = onclick; d.append(b); }
  return d;
}
const naira = (kobo) => "₦" + Math.round(kobo / 100).toLocaleString();

// ---- auth ----
$("switchMode").onclick = () => {
  mode = mode === "signin" ? "signup" : "signin";
  $("authTitle").textContent = mode === "signin" ? "Welcome back" : "Create account"; $("authSubmit").textContent = mode === "signin" ? "Sign in" : "Sign up";
  $("switchText").textContent = mode === "signin" ? "New here?" : "Have an account?"; $("switchMode").textContent = mode === "signin" ? "Create account" : "Sign in";
  $("password").autocomplete = mode === "signin" ? "current-password" : "new-password"; $("authMsg").textContent = "";
};
$("authForm").onsubmit = (e) => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value, msg = $("authMsg"); msg.className = "msg"; msg.textContent = "";
  return busy($("authSubmit"), async () => {
    try {
      if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) { msg.className = "msg ok"; msg.textContent = "Account created. Check your email to confirm, then sign in."; }
      } else { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; }
    } catch (err) { msg.textContent = friendly(err); }
  });
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
  $("adminLink").classList.toggle("hidden", p?.role !== "super_admin");
  loadExams(); loadPlan().then(loadCentre); loadBookmarkIds(); remindInit(); refreshStatus(); checkResume();   // centre card needs the plan prices first
  const ref = sessionStorage.getItem("exampro_ref"); if (ref) { sessionStorage.removeItem("exampro_ref"); checkPayment(ref); }
  setTimeout(maybeShowInstall, 3500);
}
$("saveName").onclick = () => busy($("saveName"), async () => {
  const { error } = await sb.from("profiles").update({ display_name: $("dname").value.trim().slice(0, 40) }).eq("id", lastUid);
  toast(error ? friendly(error) : "Name saved.", !!error);
});

// ---- tabs ----
function goTab(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden")); $("p-" + name).classList.remove("hidden");
  if (name === "history") { refreshStatus(); loadBoard(); }
  if (name === "saved") loadSaved();
  if (name === "ai" && !$("aiLog").children.length) aiMsg("ai", "Hi! I am your JAMB tutor. Ask me about any topic, or finish a test and tap \"Ask the tutor to explain\" on a question.");
  if (name === "centre") loadCentre();
}
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => goTab(b.dataset.tab)));
$("quotaUpgrade").onclick = () => goTab("upgrade");

// ---- status, plan, free quota ----
async function refreshQuota() {
  const { data } = await rpc("free_quota", {}); const b = $("quotaBox");
  if (!data || data.pro) return b.classList.add("hidden");
  const m = data.mock_left, p = data.practice_left;
  $("quotaText").textContent = `Free plan this month: ${m} timed mock${m === 1 ? "" : "s"} and ${p} practice or study test${p === 1 ? "" : "s"} left.`;
  b.classList.remove("hidden");
}
async function refreshStatus() {
  refreshQuota();
  const { data } = await sb.rpc("my_status"); if (!data) return;
  $("planChip").textContent = data.pro ? "Pass active" : "No pass"; $("planChip").classList.toggle("free", !data.pro);
  $("sTests").textContent = data.tests; $("sAvg").textContent = data.avg != null ? data.avg + "%" : "–";
  const pi = $("passInfo"); pi.classList.toggle("hidden", !data.pro);
  if (data.pro) pi.textContent = "Your pass is active until " + new Date(data.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + ".";
  $("payBtn").textContent = data.pro ? "Extend by another year" : "Get annual pass";
  const r = $("recent"); r.replaceChildren();
  if (!data.recent.length) r.append(empty("📝", "No tests yet", "Your finished tests will show up here so you can review every answer.", "Take your first test", () => goTab("home")));
  data.recent.forEach((t) => {
    const row = el("div", "rrow"), l = el("div"); l.append(el("b", "", `${t.exam_code} · ${t.mode === "mock" ? "Timed mock" : "Practice"}`), el("div", "sub", new Date(t.started_at).toLocaleString()));
    const b = el("button", "", `${t.score}/${t.total} · Review`); b.onclick = () => openReview(t.id); row.append(l, b); r.append(row);
  });
}
async function loadPlan() {
  const { data: all } = await sb.from("plans").select("*").eq("active", true);
  centrePlan = all?.find((p) => p.id === "centre") || null; pinPlan = all?.find((p) => p.id === "pins") || null;
  updatePinTotal();
  const data = all?.find((p) => p.id === "annual"); if (!data) return;
  plan = data; $("planName").textContent = data.name; $("planPrice").textContent = naira(data.amount_kobo) + " / year";
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
  if (!data?.subjects.length) box.append(el("p", "sub", "No questions added for this exam yet. Check back soon or try another exam."));
  data?.subjects.forEach((s) => {
    const b = el("button", "pick", s.name); b.type = "button";
    b.onclick = () => { if (picked.has(s.code)) picked.delete(s.code); else if (picked.size < 4) picked.add(s.code); else return toast("You can choose up to 4 subjects."); b.classList.toggle("sel", picked.has(s.code)); updateStart(); };
    box.append(b);
  });
  const y = $("year"); y.replaceChildren(el("option", "", "All years")); y.firstChild.value = "";
  (data?.years || []).forEach((v) => { const o = el("option", "", v); o.value = v; y.append(o); });
}
function updateStart() { $("startBtn").disabled = picked.size === 0; $("hint").textContent = picked.size ? `${picked.size} subject${picked.size > 1 ? "s" : ""} selected.` : "Pick at least one subject."; }
$("studyMode").onchange = () => { $("mode").disabled = $("studyMode").checked; };
$("startBtn").onclick = () => busy($("startBtn"), async () => {
  const study = $("studyMode").checked;
  const { data, error } = await rpc("start_test", { p_exam: $("exam").value, p_subjects: [...picked], p_mode: study ? "study" : $("mode").value, p_year: $("year").value ? Number($("year").value) : null, p_per_subject: Number($("count").value) });
  if (error) { toast(friendly(error), true); if (/free_limit/.test(error.message || "")) goTab("upgrade"); return; }
  refreshQuota(); openTest(data, study);
}).then(updateStart);
async function checkResume() {
  const id = store.get("exampro_active"); $("resumeBox").classList.add("hidden"); if (!id) return;
  const { data } = await rpc("get_test", { p_session: id });
  if (!data || data.submitted || (data.remaining_sec !== null && data.remaining_sec <= 0)) { if (data && !data.submitted) { await rpc("submit_test", { p_session: id }); refreshStatus(); } store.del("exampro_active"); return; }
  $("resumeBox").classList.remove("hidden"); $("resumeBtn").onclick = () => openTest(data);
}

// ---- question images (kept separate from get_test) ----
async function loadImages(ids) {
  const need = ids.filter((id) => !QIMG_ASKED.has(id)); if (!need.length) return;
  need.forEach((id) => QIMG_ASKED.add(id));
  const { data } = await rpc("question_images", { p_ids: need }); (data || []).forEach((r) => { if (r.image_url) QIMG[r.id] = r.image_url; });
}

// ---- test screen ----
function openTest(d, study) {
  const isStudy = !!(study ?? d.study ?? store.get("exampro_study_" + d.id) === "1");
  T = { id: d.id, mode: d.mode, exam: d.exam, qs: d.questions, ans: { ...d.answers }, pend: {}, flags: new Set(), i: 0, study: isStudy, rev: {},
        endAt: d.remaining_sec == null || isStudy ? null : Date.now() + d.remaining_sec * 1000 };
  if (isStudy) store.set("exampro_study_" + d.id, "1");
  store.set("exampro_active", d.id); $("tTitle").textContent = `${d.exam} · ${isStudy ? "Study mode" : d.mode === "mock" ? "Timed mock" : "Practice"}`;
  const subs = [...new Set(T.qs.map((q) => q.subject))], tabs = $("subTabs"); tabs.replaceChildren();
  subs.forEach((s) => { const b = el("button", "pick", s); b.onclick = () => { T.i = T.qs.findIndex((q) => q.subject === s); render(); }; tabs.append(b); });
  $("timer").classList.toggle("hidden", T.endAt == null); $("test").classList.remove("hidden"); render(); flush();
  loadImages(T.qs.map((q) => q.id)).then(() => { if (T) render(); });
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
  const img = $("qImg"), src = QIMG[q.id]; img.classList.toggle("hidden", !src); if (src) { if (img.getAttribute("src") !== src) img.src = src; img.onerror = () => img.classList.add("hidden"); } else img.removeAttribute("src");
  $("flagBtn").textContent = T.flags.has(q.id) ? "⚑ Flagged" : "⚑ Flag"; $("bmBtn").textContent = bmIds.has(q.id) ? "★ Saved" : "☆ Save";
  const rev = T.study ? T.rev[q.id] : null, o = $("qOpts"); o.replaceChildren();
  Object.keys(q.options).sort().forEach((k) => {
    let cls = "opt";
    if (rev) { if (k === rev.correct) cls += " right"; else if (T.ans[q.id] === k) cls += " wrong"; } else if (T.ans[q.id] === k) cls += " sel";
    const b = el("button", cls); b.append(el("b", "", k), el("span", "", q.options[k]));
    b.onclick = () => { if (rev) return; T.ans[q.id] = k; T.pend[q.id] = k; render(); flush(); }; o.append(b);
  });
  $("studyBox").classList.toggle("hidden", !T.study); $("revealBtn").classList.toggle("hidden", !!rev); $("studyExpl").classList.toggle("hidden", !rev);
  if (rev) $("studyExpl").textContent = rev.explanation || "No explanation is available for this question yet.";
  $("prevBtn").disabled = T.i === 0; $("nextBtn").textContent = T.i === T.qs.length - 1 ? "Review" : "Next";
  const g = $("qGrid"); g.replaceChildren();
  T.qs.forEach((x, n) => { const b = el("button", "qn" + (T.ans[x.id] ? " done" : "") + (T.flags.has(x.id) ? " flag" : "") + (n === T.i ? " cur" : ""), n + 1); b.onclick = () => { T.i = n; render(); }; g.append(b); });
  $("answeredCount").textContent = `${Object.keys(T.ans).length} of ${T.qs.length} answered`;
  [...$("subTabs").children].forEach((b) => b.classList.toggle("sel", b.textContent === q.subject));
}
$("revealBtn").onclick = () => busy($("revealBtn"), async () => {
  const t = T; if (!t) return; const q = t.qs[t.i];
  const { data, error } = await rpc("reveal_answer", { p_session: t.id, p_qid: q.id });
  if (error || !data) return toast(friendly(error), true);
  t.rev[q.id] = data; if (T === t) render();
});
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
  if (await ask("Submit test?", left ? `You have ${left} unanswered question${left > 1 ? "s" : ""}. You cannot change answers after submitting.` : "You cannot change answers after submitting.", "Submit")) busy($("submitBtn"), () => finish(false));
};
async function finish(auto) {
  await flush();
  if (!auto && Object.keys(T.pend).length) return toast("Still saving your answers on a slow network. Try Submit again in a moment.", true);
  const { data, error } = await rpc("submit_test", { p_session: T.id });
  if (error || !data) { report("submit-failed", String(error?.message || "no data")); return toast("Could not submit yet. Your answers are saved. Tap Submit again.", true); }
  clearInterval(timerId); store.del("exampro_active"); $("test").classList.add("hidden"); const sid = T.id; T = null; showResult(data, sid); refreshStatus(); $("resumeBox").classList.add("hidden");
}

// ---- results, review, share ----
function showResult(d, sid) { lastSid = sid;
  const pct = d.total ? Math.round((d.score / d.total) * 100) : 0; lastResult = { score: d.score, total: d.total, pct };
  $("rScore").textContent = `${d.score}/${d.total}`; $("rPct").textContent = `${pct}% correct`;
  const s = $("rSubj"); s.replaceChildren();
  d.by_subject.forEach((x) => { const r = el("div", "srow"), h = el("div"); h.append(el("b", "", x.subject), el("span", "sub", `${x.correct}/${x.total}`)); const bar = el("div", "bar"), i = el("i"); i.style.width = (x.total ? (x.correct / x.total) * 100 : 0) + "%"; bar.append(i); r.append(h, bar); s.append(r); });
  const rv = $("rReview"); rv.replaceChildren();
  d.review.forEach((q, n) => {
    const box = el("div", "rv"); box.dataset.qid = q.id; box.append(el("p", "q", `${n + 1}. ${q.question}`));
    Object.keys(q.options).sort().forEach((k) => { const o = el("div", "opt" + (k === q.correct ? " right" : k === q.choice ? " wrong" : "")); o.append(el("b", "", k), el("span", "", q.options[k] + (k === q.choice ? "  (your answer)" : ""))); box.append(o); });
    if (!q.choice) box.append(el("p", "sub", "You did not answer this question."));
    if (q.explanation) box.append(el("p", "expl", q.explanation));
    const ex = el("button", "link", "Ask the tutor to explain"); ex.onclick = () => { $("result").classList.add("hidden"); goTab("ai"); askAI(`Explain question ${n + 1}: why is ${q.correct} the correct answer?`, q.id); };
    const bm = el("button", "link", bmIds.has(q.id) ? "★ Saved" : "☆ Save question"); bm.onclick = () => toggleBookmark(q.id, bm, "☆ Save question"); box.append(ex, bm); rv.append(box);
  });
  loadImages(d.review.map((q) => q.id)).then(() => rv.querySelectorAll(".rv").forEach((box) => {
    const u = QIMG[box.dataset.qid]; if (!u || box.querySelector(".qimg")) return; const im = el("img", "qimg"); im.src = u; im.alt = "Question diagram"; im.onerror = () => im.remove(); box.children[0].after(im);
  }));
  $("result").classList.remove("hidden"); $("result").scrollTop = 0;
}
async function openReview(id) { const { data, error } = await rpc("submit_test", { p_session: id }); if (error) return toast(friendly(error), true); showResult(data, id); }
$("rDone").onclick = () => { $("result").classList.add("hidden"); goTab("home"); };
$("shareBtn").onclick = async () => {
  if (!lastResult) return;
  const text = `I scored ${lastResult.score}/${lastResult.total} (${lastResult.pct}%) on Exampro, the CBT past questions app. Can you beat me?`, url = location.origin + location.pathname;
  const wa = () => window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
  try { if (navigator.share) await navigator.share({ title: "My Exampro score", text, url }); else wa(); }
  catch (e) { if (e && e.name !== "AbortError") wa(); }
};

// ---- annual pass (price is read from the plans table, never from the browser) ----
$("payBtn").onclick = () => busy($("payBtn"), async () => {
  if (!plan) return toast("Pass price is not available yet. Try again shortly.", true);
  try {
    const res = await fetch(FN("paystack-init"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ plan: plan.id }) });
    const out = await res.json(); if (!res.ok || !out.url) throw new Error("init");
    sessionStorage.setItem("exampro_ref", out.reference); location.href = out.url; await new Promise(() => {});   // keep the spinner until the page leaves
  } catch (_) { toast("Could not open checkout. Check your connection and try again.", true); }
});
addEventListener("pageshow", (e) => { if (e.persisted) document.querySelectorAll(".btn.loading").forEach((b) => { b.classList.remove("loading"); b.disabled = false; }); });
(function () { const p = new URLSearchParams(location.search), ref = p.get("reference") || p.get("trxref"); if (ref) { history.replaceState({}, "", location.pathname); sessionStorage.setItem("exampro_ref", ref); } })();
function showPay(t, m) { $("payTitle").textContent = t; $("payMsg").textContent = m; $("payOverlay").classList.remove("hidden"); }
$("payClose").onclick = () => $("payOverlay").classList.add("hidden");
async function checkPayment(ref) {
  showPay("Confirming payment…", "Keep this page open. It only takes a moment.");
  try {
    const res = await fetch(FN("paystack-verify"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ reference: ref }) });
    const out = await res.json();
    if (out.status === "success") {
      await refreshStatus(); await loadCentre();
      if (out.pins != null) { goTab("centre"); return showPay("Payment confirmed", `${out.pins} activation pin${out.pins === 1 ? "" : "s"} created. You can view, copy and print them below.`); }
      return showPay("Payment confirmed", "Your payment was confirmed and your access is now active.");
    }
    if (out.status === "pending") { sessionStorage.setItem("exampro_ref", ref); return showPay("Still processing", "Your bank has not confirmed yet. Reopen the app in a few minutes."); }
    showPay("Payment failed", "If money left your account, contact support with reference " + ref + ".");
  } catch (_) { sessionStorage.setItem("exampro_ref", ref); showPay("Could not confirm yet", "Check your connection and reopen the app."); }
}
$("codeForm").onsubmit = (e) => {
  e.preventDefault(); const code = $("code").value.trim(); if (!code) return;
  return busy($("codeBtn"), async () => {
    const { data, error } = await sb.rpc("redeem_code", { p_code: code }); if (error) return toast(friendly(error), true);
    $("code").value = ""; await refreshStatus(); toast("Pin accepted. Pass active until " + new Date(data).toLocaleDateString());
  });
};

// ---- PWA install banner and button ----
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
function maybeShowInstall() {
  if (isStandalone() || !matchMedia("(max-width: 759px)").matches || $("app").classList.contains("hidden")) return;
  if (Date.now() - Number(store.get("exampro_install_later") || 0) < 7 * 864e5) return;
  if (!installEvt && !isIOS) return;
  $("ibText").textContent = installEvt ? "Add Exampro to your home screen for faster access and offline practice." : "Tap the Share button, then Add to Home Screen to install Exampro.";
  $("ibInstall").classList.toggle("hidden", !installEvt); $("installBanner").classList.add("show");
}
const hideBanner = (later) => { $("installBanner").classList.remove("show"); if (later) store.set("exampro_install_later", String(Date.now())); };
async function doInstall() { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $("installBtn").hidden = true; hideBanner(false); }
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("installBtn").hidden = false; setTimeout(maybeShowInstall, 2500); });
addEventListener("appinstalled", () => { installEvt = null; $("installBtn").hidden = true; hideBanner(false); });
$("installBtn").onclick = doInstall; $("ibInstall").onclick = doInstall; $("ibLater").onclick = () => hideBanner(true);
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
    else if (res.status === 401) wait.textContent = "Your session expired. Log out and sign in again.";
    else if (out?.error === "ai_failed") wait.textContent = "The tutor service is not responding. We have logged it and will fix it. Try again later.";
    else if (!out) wait.textContent = "The tutor server did not respond (HTTP " + res.status + "). The function may need to be redeployed.";
    else wait.textContent = "The tutor could not answer right now. Try again.";
  } catch (_) { wait.textContent = "Slow network. Please try again."; }
  wait.classList.remove("typing"); $("aiLog").scrollTop = $("aiLog").scrollHeight; clearTimeout(t); aiBusy = false; $("aiSend").disabled = false;
}
$("aiForm").onsubmit = (e) => { e.preventDefault(); const v = $("aiInput").value; $("aiInput").value = ""; askAI(v); };

// ---- centres: create instantly, pay the licence, then manage tutors, pins and students ----
async function loadCentre() {
  const { data } = await rpc("my_centres", {}); const list = data || [];
  const owned = list.find((c) => c.role === "centre_admin") || null, tutorAt = list.find((c) => c.role === "tutor" && c.active) || null;
  const staff = owned?.active ? owned : tutorAt; myCentre = staff;
  $("tabCentre").classList.toggle("hidden", !staff);           // the dashboard stays hidden until the licence is paid
  $("centreApply").classList.toggle("hidden", !!staff);
  if (!staff) {
    const price = centrePlan ? naira(centrePlan.amount_kobo) + " per year" : "the licence fee";
    $("applyBtn").textContent = centrePlan ? `Pay ${naira(centrePlan.amount_kobo)} & Create Centre` : "Pay & Create Centre";
    if (!centrePlan) report("centre-plan-missing", "No active plan with id 'centre' found in the plans table");
    if (owned) { $("aName").value = owned.name; $("aLoc").value = owned.location || ""; $("aPhone").value = owned.phone || ""; }
    $("applyState").textContent = !owned ? `Set up your centre in minutes. Pay the centre licence (${price}) and your dashboard opens immediately. Student pins are bought separately, per student.`
      : owned.ends_at ? `Your licence for ${owned.name} has expired. Pay ${price} to renew and unlock your dashboard.`
      : `Your centre ${owned.name} is created, but its licence is unpaid. Pay ${price} to unlock your dashboard.`;
    return;
  }
  const isAdmin = staff.role === "centre_admin";
  $("cName").textContent = staff.name;
  $("cRole").textContent = (isAdmin ? "You are the centre admin." : "You are a tutor at this centre.") + (staff.ends_at ? " Licence valid until " + new Date(staff.ends_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) + "." : "");
  $("cStaff").classList.toggle("hidden", !isAdmin); $("cPins").classList.toggle("hidden", !isAdmin); $("cStudents").classList.remove("hidden");
  if (isAdmin) { loadMembers(); loadPins(); updatePinTotal(); }
  loadStudents();
}
$("applyForm").onsubmit = (e) => {
  e.preventDefault();
  return busy($("applyBtn"), async () => {
    const { data: cid, error } = await rpc("create_centre_instant", { p_name: $("aName").value, p_location: $("aLoc").value, p_phone: $("aPhone").value });
    if (error || !cid) return toast(friendly(error), true);
    try {
      const res = await fetch(FN("paystack-init"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ plan: "centre", centre_id: cid }) });
      const out = await res.json(); if (!res.ok || !out.url) throw new Error("init");
      sessionStorage.setItem("exampro_ref", out.reference); location.href = out.url; await new Promise(() => {});
    } catch (_) { toast("Your centre is saved, but checkout did not open. Tap the button to try again.", true); loadCentre(); }
  });
};
async function loadMembers() {
  const { data } = await rpc("centre_members", { p_centre: myCentre.id }); const l = $("cList"); l.replaceChildren();
  (data || []).forEach((m) => {
    const r = el("div", "rrow"), t = el("div"); t.append(el("b", "", m.email), el("div", "sub", m.role === "centre_admin" ? "Centre admin" : "Tutor")); r.append(t);
    if (m.role === "tutor") { const b = el("button", "btn sm danger", "Remove"); b.onclick = () => busy(b, async () => { if (!(await ask("Remove tutor?", m.email + " will lose access to this centre.", "Remove"))) return; const { error } = await rpc("centre_remove_tutor", { p_centre: myCentre.id, p_user: m.user_id }); if (error) toast(friendly(error), true); loadMembers(); }); r.append(b); }
    l.append(r);
  });
}
$("tutorForm").onsubmit = (e) => {
  e.preventDefault();
  return busy($("tutorBtn"), async () => {
    const { error } = await rpc("centre_add_tutor", { p_centre: myCentre.id, p_email: $("tutorEmail").value });
    if (error) return toast(friendly(error), true); $("tutorEmail").value = ""; toast("Tutor added."); loadMembers();
  });
};

// ---- centre pins: pay per student, then view, copy and print unused pins ----
function updatePinTotal() {
  const n = Math.floor(Number($("pinQty").value)), t = $("pinTotal");
  if (!pinPlan) { t.textContent = "Pin price is not set up yet."; return; }
  const unit = pinPlan.amount_kobo / 100;
  t.textContent = n >= 1 && n <= 500 ? `${n} × ₦${unit.toLocaleString()} = ₦${(unit * n).toLocaleString()}` : `₦${unit.toLocaleString()} per student. Enter 1 to 500 students.`;
}
$("pinQty").oninput = updatePinTotal;
$("pinBuy").onclick = () => busy($("pinBuy"), async () => {
  const n = Math.floor(Number($("pinQty").value));
  if (!pinPlan) { report("pins-plan-missing", "No active plan with id 'pins' in the plans table"); return toast("Pin price is not set up yet. Contact support.", true); }
  if (!(n >= 1 && n <= 500)) return toast(friendly("bad_quantity"), true);
  if (!(await ask(`Generate ${n} pin${n > 1 ? "s" : ""}?`, `You will pay ₦${(pinPlan.amount_kobo / 100 * n).toLocaleString()} (${n} × ₦${(pinPlan.amount_kobo / 100).toLocaleString()}). Your pins are created as soon as the payment is confirmed.`, "Continue to payment"))) return;
  try {
    const res = await fetch(FN("paystack-init"), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ plan: "pins", centre_id: myCentre.id, quantity: n }) });
    const out = await res.json().catch(() => null); if (!res.ok || !out?.url) throw new Error(out?.error || "init");
    sessionStorage.setItem("exampro_ref", out.reference); location.href = out.url; await new Promise(() => {});
  } catch (e) { toast(e?.message === "licence_required" ? friendly("licence_required") : e?.message === "bad_quantity" ? friendly("bad_quantity") : "Could not open checkout. Check your connection and try again.", true); }
});
async function loadPins() {
  const { data } = await rpc("centre_pins", { p_centre: myCentre.id }); const rows = data || [], l = $("pinList"); l.replaceChildren();
  const unused = rows.filter((r) => !r.used && !r.expired); pinCodes = unused.map((r) => r.code);
  $("pinUnused").textContent = `${unused.length} unused`; $("pinUsed").textContent = `${rows.filter((r) => r.used).length} used`;
  $("pinActions").classList.toggle("hidden", !unused.length);
  if (!unused.length) return l.append(empty("🎟️", rows.length ? "No unused pins left" : "No pins yet", rows.length ? "All your pins have been used or have expired. Generate more when you add new students." : "Enter how many students you are registering, then tap Generate Pins.", null));
  const box = el("div", "pinlist");
  unused.forEach((r) => {
    const row = el("div", "pin"), t = el("div"); t.append(el("code", "", r.code), el("small", "", r.expires_at ? "Valid until " + new Date(r.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "No expiry"));
    const b = el("button", "btn sm", "Copy"); b.onclick = async () => { try { await navigator.clipboard.writeText(r.code); toast("Copied " + r.code); } catch (_) { toast("Could not copy.", true); } };
    row.append(t, b); box.append(row);
  });
  l.append(box);
}
$("pinCopyAll").onclick = async () => { try { await navigator.clipboard.writeText(pinCodes.join("\n")); toast(`${pinCodes.length} pins copied.`); } catch (_) { toast("Could not copy.", true); } };
$("pinPrint").onclick = () => { const d = el("div"); d.id = "printArea"; d.append(el("h2", "", `${myCentre.name}: Exampro activation pins`), el("pre", "", pinCodes.join("\n"))); document.body.append(d); document.body.classList.add("printing"); window.print(); document.body.classList.remove("printing"); d.remove(); };

// ---- tutor / admin view: students and their average scores ----
async function loadStudents() {
  const { data } = await rpc("centre_students", { p_centre: myCentre.id }); const rows = data || [], l = $("studentList"); l.replaceChildren();
  const scored = rows.filter((r) => r.avg != null), classAvg = scored.length ? Math.round(scored.reduce((a, r) => a + r.avg, 0) / scored.length) : null;
  $("studentSummary").textContent = rows.length ? `${rows.length} student${rows.length > 1 ? "s" : ""}` + (classAvg != null ? ` · class average ${classAvg}%` : " · no finished tests yet") : "";
  if (!rows.length) return l.append(empty("🎓", "No students yet", "Students appear here after they redeem one of your activation pins in the Pass tab.", null));
  rows.forEach((r) => {
    const row = el("div", "rrow"), t = el("div"); t.append(el("b", "", r.name), el("div", "sub", `${r.tests} test${r.tests === 1 ? "" : "s"}` + (r.last_test ? " · last " + new Date(r.last_test).toLocaleDateString() : "")));
    const right = el("div", "mini"), bar = el("div", "avgbar"), i = el("i"); i.style.width = (r.avg ?? 0) + "%"; bar.append(i); right.append(bar, el("b", "", r.avg != null ? r.avg + "%" : "–")); row.append(t, right); l.append(row);
  });
}

// ---- bookmarks and saved questions ----
async function loadBookmarkIds() { const { data } = await sb.from("bookmarks").select("question_id"); bmIds = new Set((data || []).map((x) => x.question_id)); }
async function toggleBookmark(qid, btn, offLabel) {
  const { data, error } = await rpc("toggle_bookmark", { p_qid: qid }); if (error) return toast(friendly(error), true);
  data ? bmIds.add(qid) : bmIds.delete(qid); btn.textContent = data ? "★ Saved" : offLabel; toast(data ? "Saved." : "Removed from saved.");
}
$("bmBtn").onclick = () => toggleBookmark(T.qs[T.i].id, $("bmBtn"), "☆ Save");
async function loadSaved() {
  const { data } = await rpc("my_bookmarks", {}); const l = $("savedList"); l.replaceChildren(); const rows = data || [];
  $("savedPractice").classList.toggle("hidden", !rows.length); $("savedCount").textContent = rows.length ? `${rows.length} saved question${rows.length > 1 ? "s" : ""}` : "";
  if (!rows.length) return l.append(empty("🔖", "Nothing saved yet", "Tap ☆ Save on a question during a test or in your review, and it will be kept here for practice.", "Start a test", () => goTab("home")));
  rows.forEach((q) => { const r = el("div", "rrow"), t = el("div"); t.append(el("b", "", q.subject), el("div", "sub", q.question.slice(0, 140)));
    const b = el("button", "btn sm danger", "Remove"); b.onclick = async () => { await toggleBookmark(q.id, b, "Remove"); loadSaved(); }; r.append(t, b); l.append(r); });
}
$("savedPractice").onclick = () => busy($("savedPractice"), async () => { const { data, error } = await rpc("start_saved_test", {}); if (error) { toast(friendly(error), true); if (/free_limit/.test(error.message || "")) goTab("upgrade"); return; } refreshQuota(); openTest(data); });

// ---- leaderboard and retake ----
async function loadBoard() {
  const { data } = await rpc("get_leaderboard", {}); const l = $("boardList"); l.replaceChildren(); if (!data) return;
  $("boardMe").textContent = data.me ? `Your rank: #${data.me.rank}, ${data.me.avg}% average over ${data.me.tests} tests` : "Finish 3 tests and set a display name in Account to join the leaderboard.";
  if (!data.top.length) l.append(empty("🏆", "No one is ranked yet", "Finish 3 tests and set a display name in Account to be the first on the board.", "Set display name", () => goTab("account")));
  data.top.forEach((u) => { const r = el("div", "rrow" + (u.me ? " me" : "")), t = el("div"); t.append(el("b", "", `#${u.rank} ${u.name}`), el("div", "sub", `${u.tests} tests`)); r.append(t, el("b", "", u.avg + "%")); l.append(r); });
}
$("retakeBtn").onclick = () => busy($("retakeBtn"), async () => {
  if (!lastSid) return;
  const { data, error } = await rpc("retake_test", { p_session: lastSid });
  if (error) { toast(friendly(error), true); if (/free_limit/.test(error.message || "")) { $("result").classList.add("hidden"); goTab("upgrade"); } return; }
  refreshQuota(); $("result").classList.add("hidden"); openTest(data);
});

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
