// Exampro admin console. Every action here is also checked on the server (super_admin role), so hiding this page is not what protects it.
if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined" || /PASTE_YOUR/.test(SUPABASE_URL + SUPABASE_ANON_KEY)) {
  document.body.textContent = "Setup needed: open config.js and paste your Supabase URL and anon key, then reload.";
  throw new Error("config.js is not filled in");
}
const FN = (n) => `${SUPABASE_URL}/functions/v1/api/${n}`;
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let toastTimer;
function toast(msg, err) { const t = $("toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4000); }
const friendly = (e) => { const m = String(e?.message || e || "").toLowerCase(); return m.includes("forbidden") ? "You do not have permission to do that." : m.includes("invalid login") ? "Wrong email or password." : m.includes("fetch") || m.includes("network") || m.includes("timeout") ? "Connection problem. Check your internet." : (e?.message || "Something went wrong. Try again."); };
const rpc = (fn, args, ms = 25000) => { const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  return sb.rpc(fn, args).abortSignal(c.signal).then((r) => { clearTimeout(t); return r; }, () => { clearTimeout(t); return { data: null, error: { message: "network timeout" } }; }); };
const token = async () => (await sb.auth.getSession()).data.session?.access_token;
const naira = (kobo) => "₦" + Math.round(kobo / 100).toLocaleString();
async function busy(btn, fn) {
  if (!btn || btn.classList.contains("loading")) return;
  const was = btn.disabled; btn.classList.add("loading"); btn.disabled = true;
  try { return await fn(); } finally { btn.classList.remove("loading"); btn.disabled = was; }
}
function empty(icon, title, text) { const d = el("div", "empty"); d.append(el("i", "", icon), el("b", "", title), el("span", "", text)); return d; }
const ask = (title, msg, ok) => new Promise((res) => {
  $("dlgTitle").textContent = title; $("dlgMsg").textContent = msg; $("dlgOk").textContent = ok || "Yes"; $("dlg").classList.remove("hidden");
  const done = (v) => { $("dlg").classList.add("hidden"); res(v); }; $("dlgOk").onclick = () => done(true); $("dlgNo").onclick = () => done(false);
});
const show = (id) => ["gate", "denied", "adm"].forEach((x) => $(x).classList.toggle("hidden", x !== id));
const authedFetch = async (route, body) => fetch(FN(route), { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

// ---- sign in and role gate ----
$("loginForm").onsubmit = (e) => {
  e.preventDefault(); const msg = $("loginMsg"); msg.textContent = "";
  return busy($("loginBtn"), async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
    if (error) msg.textContent = friendly(error); else start();
  });
};
$("signOut").onclick = $("deniedOut").onclick = async () => { await sb.auth.signOut(); location.reload(); };
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return show("gate");
  const { data: p } = await sb.from("profiles").select("role").eq("id", session.user.id).single();
  if (p?.role !== "super_admin") { $("deniedMsg").textContent = `${session.user.email} does not have admin access.`; return show("denied"); }
  show("adm"); loadExams(); loadSubjectHints(); loadAnalytics(); loadReports(); loadEvents();
}
start();

// ---- analytics, exams, subjects ----
async function loadAnalytics() {
  const { data } = await rpc("admin_analytics", {}); if (!data) return;
  $("anRev").textContent = naira(data.revenue_kobo); $("anUsers").textContent = data.users; $("anPaid").textContent = data.paid_students; $("anQ").textContent = data.questions;
}
async function loadExams() {
  const { data } = await sb.from("exams").select("code,name").order("name"); const s = $("sdExam"); s.replaceChildren();
  (data || []).forEach((x) => { const o = el("option", "", x.name); o.value = x.code; s.append(o); });
}
async function loadSubjectHints() {
  const { data } = await sb.from("subjects").select("name").order("name"); const dl = $("subjList"); dl.replaceChildren();
  (data || []).forEach((s) => { const o = el("option"); o.value = s.name; dl.append(o); });
}

// ---- system checks ----
$("aiTestBtn").onclick = () => busy($("aiTestBtn"), async () => {
  const out = $("aiTestOut"); out.classList.remove("hidden"); out.textContent = "Testing…";
  try {
    const res = await authedFetch("ai-test"); const j = await res.json().catch(() => null);
    if (!j) return (out.textContent = `No readable answer from the server (HTTP ${res.status}).\nThe function is probably not redeployed yet.`);
    if (j.error) return (out.textContent = "Server said: " + j.error + (res.status === 404 ? "\nThe ai-test route is missing. Redeploy the function." : ""));
    out.textContent = (j.all_ok ? "ALL OK. The tutor should work.\n\n" : "PROBLEM FOUND\n\n") +
      `Usage counter (database): ${j.usage_counter}\nAI provider: ${j.provider}\nProvider HTTP status: ${j.provider_http ?? "none"}\n` +
      (j.provider_message ? `Provider message: ${j.provider_message}\n` : "") + `Model: ${j.model}\nProvider host: ${j.host}\nAPI key set: ${j.key_set ? "yes" : "NO"}`;
  } catch (_) { out.textContent = "Could not reach the server. Check your connection."; }
});
$("healthBtn").onclick = () => busy($("healthBtn"), async () => {
  const out = $("healthOut"); out.classList.remove("hidden"); out.textContent = "Checking…";
  try {
    const res = await authedFetch("health"); const j = await res.json().catch(() => null);
    if (!j) return (out.textContent = `No readable answer from the server (HTTP ${res.status}).\nThe function is probably not redeployed yet.`);
    if (j.error) return (out.textContent = "Server said: " + j.error + (res.status === 404 ? "\nThe health route is missing. Redeploy the function." : ""));
    const dd = Object.entries(j.practice_dropdowns || {}).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  (no exams found)";
    out.textContent = `Exams: ${j.exams_count} -> ${(j.exams || []).join(", ") || "none"}\nSubjects in database: ${j.subjects_count}\nQuestions: ${j.questions_total} total, ${j.questions_active} active\n\nWhat the Practice tab shows:\n${dd}\n\n` +
      `SdashAPI key set: ${j.sdash_key_set ? "yes" : "NO"}\n` + (j.sdash_key_set ? `SdashAPI HTTP status: ${j.sdash_http}\nExam types it offers: ${(j.sdash_exam_types || []).join(", ") || "none returned"}\n` + (j.sdash_message ? `SdashAPI message: ${j.sdash_message}\n` : "") : "");
  } catch (_) { out.textContent = "Could not reach the server. Check your connection."; }
});

// ---- SdashAPI import ----
const SDASH_ERRORS = { unsupported_exam: "SdashAPI does not offer that exam type.", unknown_exam: "Add this exam to the exams table first.", unknown_subject: "That subject is not in your subjects table.", not_configured: "SDASH_API_KEY is not set on the server.", sdash_failed: "SdashAPI refused the request. Check the API key and plan." };
$("sdashForm").onsubmit = (e) => {
  e.preventDefault();
  return busy($("sdBtn"), async () => {
    try {
      const res = await authedFetch("import-sdash", { exam: $("sdExam").value, subject: $("sdSubject").value, year: Number($("sdYear").value), limit: Number($("sdLimit").value) });
      const out = await res.json().catch(() => null);
      toast(res.ok ? `Imported ${out.imported}, skipped ${out.skipped} (of ${out.received})` + (out.images ? `, ${out.images} with images` : "") : "Import failed: " + (SDASH_ERRORS[out?.error] || out?.error || res.status), !res.ok);
    } catch (_) { toast("Network problem. Try again.", true); }
    loadAnalytics();
  });
};

// ---- flagged questions ----
async function loadReports() {
  const { data } = await rpc("admin_reports", {}); const l = $("repList"); l.replaceChildren();
  if (!data?.length) return l.append(empty("✅", "No flagged questions", "When students report a broken question it will appear here."));
  data.forEach((r) => {
    const box = el("div", "rv"); box.append(el("b", "", `${r.subject}, reported ${new Date(r.created_at).toLocaleDateString()}`), el("p", "q", r.question));
    Object.keys(r.options).sort().forEach((k) => { const o = el("div", "opt" + (k === r.correct ? " right" : "")); o.append(el("b", "", k), el("span", "", r.options[k])); box.append(o); });
    if (r.note) box.append(el("p", "sub", "Note: " + r.note));
    const row = el("div", "row"), f = el("button", "btn sm primary", "Mark as Fixed"), d = el("button", "btn sm danger", "Delete question");
    const act = (btn, a, msg) => busy(btn, async () => {
      if (a === "delete" && !(await ask("Delete this question?", "It is removed from all future tests. Past results keep their history.", "Delete"))) return;
      const { error } = await rpc("admin_report_action", { p_id: r.id, p_action: a }); if (error) return toast(friendly(error), true); toast(msg); loadReports();
    });
    f.onclick = () => act(f, "fixed", "Marked as fixed."); d.onclick = () => act(d, "delete", "Question deleted."); row.append(f, d); box.append(row); l.append(box);
  });
}

// ---- event log (only super_admin can read app_events; the database enforces it) ----
async function loadEvents() {
  const lvl = $("evLevel").value, list = $("evList"); list.replaceChildren(el("p", "sub", "Loading…"));
  let q = sb.from("app_events").select("*").order("created_at", { ascending: false }).limit(50); if (lvl !== "all") q = q.eq("level", lvl);
  const day = new Date(Date.now() - 864e5).toISOString(), week = new Date(Date.now() - 6048e5).toISOString();
  const [ev, errs, pay] = await Promise.all([q,
    sb.from("app_events").select("id", { count: "exact", head: true }).eq("level", "error").gte("created_at", day),
    sb.from("app_events").select("id", { count: "exact", head: true }).like("source", "paystack%").in("level", ["warn", "error"]).gte("created_at", week)]);
  $("evErr").textContent = errs.count ?? "–"; $("evPay").textContent = pay.count ?? "–";
  list.replaceChildren(); if (ev.error) return list.append(el("p", "sub", "Could not load events."));
  if (!ev.data.length) list.append(empty("✅", "All clear", "No events at this level."));
  ev.data.forEach((e) => {
    const d = el("details"), s = el("summary", "", `${/PAID BUT/.test(e.message) ? "⚠️ " : ""}${e.source}: ${e.message}`);
    d.append(s, el("p", "sub", new Date(e.created_at).toLocaleString() + (e.user_id ? " · user " + e.user_id.slice(0, 8) : "")), el("pre", "", e.detail ? JSON.stringify(e.detail, null, 1) : "")); list.append(d);
  });
}
$("evReload").onclick = loadEvents; $("evLevel").onchange = loadEvents;
