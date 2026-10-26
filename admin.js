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
  show("adm"); loadExams(); loadSubjectHints(); loadDashboard(); loadReports(); loadEvents();
}
start();

// ---- dashboard ----
const money = (kobo) => "₦" + Math.round((kobo || 0) / 100).toLocaleString();
const compact = (kobo) => { const n = Math.round((kobo || 0) / 100); return n >= 1e6 ? "₦" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? "₦" + Math.round(n / 1e3) + "k" : "₦" + n; };
const PLAN_NAMES = { annual: "Student annual passes", pins: "Centre student pins", centre: "Centre licences" };
const pct = (a, b) => (b ? (Math.round((a / b) * 1000) / 10) + "%" : "–");
function tile(value, label, sub, hero) { const d = el("div", hero ? "hero" : ""); d.append(el("b", "", String(value ?? "–")), el("small", "", label)); if (sub) d.append(el("small", "sub2", sub)); return d; }
function grid(tiles, cls) { const g = el("div", "stats " + (cls || "")); tiles.forEach((t) => g.append(t)); return g; }
function dcard(title, ...nodes) { const c = el("div", "card"); c.append(el("h2", "", title), ...nodes); return c; }
function section(title, data, build) {
  if (!data) return dcard(title, el("p", "sub", "No data."));
  if (data.error) return dcard(title, el("p", "msg", "Could not load this section: " + data.error));
  return dcard(title, ...build(data));
}
function listRows(rows) { const l = el("div"); rows.forEach(([a, b, sub]) => { const r = el("div", "rrow"), t = el("div"); t.append(el("b", "", a)); if (sub) t.append(el("div", "sub", sub)); r.append(t, el("b", "", b)); l.append(r); }); return l; }
function renderDashboard(d) {
  const now = new Date(), month = now.toLocaleString("en", { month: "long", timeZone: "Africa/Lagos" }), year = now.toLocaleString("en", { year: "numeric", timeZone: "Africa/Lagos" });
  $("asOf").textContent = "Updated " + new Date(d.as_of).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const out = [];
  out.push(section("Revenue", d.revenue, (r) => {
    const nodes = [grid([tile(money(r.year), `This year (${year})`, `${r.payments_year} payment${r.payments_year === 1 ? "" : "s"}`, true), tile(money(r.month), `This month (${month})`, `${r.payments_month} payment${r.payments_month === 1 ? "" : "s"}`),
      tile(money(r.today), "Today"), tile(money(r.all_time), "All time", `${r.payments_all} payment${r.payments_all === 1 ? "" : "s"}`)], "cols4")];
    if (r.undated) nodes.push(el("p", "sub", `${r.undated} older payment${r.undated === 1 ? " has" : "s have"} no date recorded, so ${r.undated === 1 ? "it counts" : "they count"} in "All time" only.`));
    const max = Math.max(1, ...(r.monthly || []).map((m) => m.kobo));
    const bars = el("div", "mbars"); (r.monthly || []).forEach((m) => { const c = el("div", "mcol"), i = el("i"); i.style.height = Math.max(m.kobo ? 4 : 2, Math.round((m.kobo / max) * 100)) + "%"; c.title = `${m.month}: ${money(m.kobo)}`; c.append(el("small", "mval", m.kobo ? compact(m.kobo) : ""), i, el("small", "", m.label)); bars.append(c); });
    nodes.push(el("h3", "", "Last 12 months"), bars);
    if (r.by_plan?.length) nodes.push(el("h3", "", "By product (this year)"), listRows(r.by_plan.map((p) => [PLAN_NAMES[p.plan] || p.plan, money(p.year), `${p.count_year} this year · ${money(p.all_time)} all time (${p.count_all})`])));
    return nodes;
  }));
  out.push(section("Users", d.users, (u) => [grid([tile(u.total, "Registered users", `${u.new_today} today`, true), tile(u.new_7d, "New, last 7 days"), tile(u.new_30d, "New, last 30 days"),
    tile(u.pass_holders, "Active pass holders", `${pct(u.pass_holders, u.total)} of all users`), tile(u.expiring_30d, "Passes ending in 30 days"), tile(Math.max(0, u.total - u.pass_holders), "On the free plan")])]));
  out.push(section("Student activity", d.activity, (a) => {
    const nodes = [grid([tile(a.tests_today, "Tests today", null, true), tile(a.tests_7d, "Tests, last 7 days"), tile(a.tests_30d, "Tests, last 30 days", `${a.finished_30d} finished`),
      tile(a.active_students_7d, "Active students, 7 days"), tile(a.active_students_30d, "Active students, 30 days"), tile(a.avg_score_30d != null ? a.avg_score_30d + "%" : "–", "Average score, 30 days")])];
    if (a.top_subjects?.length) nodes.push(el("h3", "", "Most practised subjects (30 days)"), listRows(a.top_subjects.map((s) => [s.subject, s.tests + (s.tests === 1 ? " test" : " tests")])));
    return nodes;
  }));
  out.push(section("Questions", d.content, (c) => {
    const nodes = [grid([tile(c.questions_active, "Live questions", `${c.questions_total} in total`, true), tile(c.open_reports, "Open reports", c.open_reports ? "See Flagged questions below" : "All clear")])];
    if (c.by_exam?.length) nodes.push(el("h3", "", "Live questions by exam"), listRows(c.by_exam.map((e) => [e.exam, String(e.questions)])));
    return nodes;
  }));
  out.push(section("Centres and pins", d.centres, (c) => [grid([tile(c.centres, "Centres", `${c.active_licences} with an active licence`, true), tile(c.pins_sold, "Pins sold"), tile(c.pins_redeemed, "Pins redeemed", `${pct(c.pins_redeemed, c.pins_sold)} of sold`), tile(c.pins_unused, "Pins unused and valid")], "cols4")]));
  $("dash").replaceChildren(...out);
}
async function loadDashboard() {
  const { data, error } = await rpc("admin_dashboard", {});
  if (error || !data) {
    const missing = /could not find|does not exist|schema cache/i.test(error?.message || "");
    return $("dash").replaceChildren(dcard("Dashboard", el("p", "msg", missing ? "The dashboard function is not in your database yet. Run admin_dashboard.sql in the Supabase SQL editor, then refresh." : friendly(error) || "Could not load the dashboard.")));
  }
  renderDashboard(data);
}
$("dashReload").onclick = () => busy($("dashReload"), async () => { await loadDashboard(); await loadReports(); });

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
    loadDashboard();
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
