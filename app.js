// The app. Every read and write goes through the signed-in session; nothing is written from the browser directly.
(function () {
  "use strict";
  const C = window.PLANNER_CONFIG;
  const TZ = "America/Denver";
  const FEELS = [["good", "Good"], ["okay", "Okay"], ["rough", "Rough"], ["pain", "Pain somewhere"]];
  const PREP_NAMES = { "Walk Archer": 35, "Coffee": 35, "Shower and get ready": 35 };

  const sb = window.supabase.createClient(C.supabaseUrl, C.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
  });
  const $app = document.getElementById("app");

  // ---------- state ----------
  const S = {
    session: null,
    view: "loading",
    date: null, // the day on screen (Denver)
    checkins: [],
    plans: {}, // by checkin_id
    events: {}, // by plan_id
    calendar: [],
    pending: [], // unanswered follow-ups
    cur: null, // the check-in on screen
    followup: null,
    g: 0,
    e: 0,
    shots: [],
    days: [],
    err: null,
    msg: null,
    busy: null,
    ui: loadUI(),
  };

  function loadUI() {
    try { return JSON.parse(localStorage.getItem("planner-ui") || "{}"); } catch { return {}; }
  }
  function saveUI() {
    try { localStorage.setItem("planner-ui", JSON.stringify(S.ui)); } catch { /* fine without it */ }
  }

  // ---------- time ----------
  function denverDate(d = new Date()) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  }
  function denverTime(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }
  function denverHHMM(iso) {
    return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  }
  function niceDate(date) {
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  }
  function isWeekend(date) {
    const [y, m, d] = date.split("-").map(Number);
    const w = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    return w === 0 || w === 6;
  }

  // ---------- helpers ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root = $app) => root.querySelector(sel);
  const $$ = (sel, root = $app) => Array.from(root.querySelectorAll(sel));
  function on(sel, ev, handler) { $$(sel).forEach((el) => el.addEventListener(ev, handler)); }

  async function fn(name, body) {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error("Sign in first.");
    const res = await fetch(`${C.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(body || {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) throw new Error("Sign in again.");
      if (res.status === 404) throw new Error("Not found.");
      if (res.status >= 500) throw new Error("Something went wrong. Try again.");
      throw new Error(json.error || "That did not go through.");
    }
    return json;
  }

  async function busy(label, work) {
    S.busy = label; S.err = null; render();
    try { return await work(); }
    catch (e) { S.err = e.message || String(e); return null; }
    finally { S.busy = null; render(); }
  }

  // ---------- data ----------
  async function loadDay(date) {
    S.date = date;
    const { data: cks, error } = await sb.from("checkins").select("*").eq("date", date).order("number");
    if (error) throw new Error(error.message);
    S.checkins = cks || [];
    const ids = S.checkins.map((c) => c.id);
    S.plans = {}; S.events = {}; S.pending = [];
    if (ids.length) {
      const { data: plans } = await sb.from("plans").select("*").in("checkin_id", ids);
      (plans || []).forEach((p) => { S.plans[p.checkin_id] = p; });
      const planIds = (plans || []).map((p) => p.id);
      if (planIds.length) {
        const { data: evs } = await sb.from("events").select("*").in("plan_id", planIds).order("created_at");
        (evs || []).forEach((e) => { (S.events[e.plan_id] = S.events[e.plan_id] || []).push(e); });
      }
      const { data: fus } = await sb.from("followups").select("*").in("checkin_id", ids).is("answer", null).order("asked_at");
      S.pending = fus || [];
    }
    const { data: cal } = await sb.from("calendar").select("*").eq("date", date).order("position");
    S.calendar = cal || [];
    const wanted = S.ui.checkinId && S.checkins.find((c) => c.id === S.ui.checkinId);
    S.cur = wanted || S.checkins[S.checkins.length - 1] || null;
  }

  async function loadCheckinById(id) {
    const { data } = await sb.from("checkins").select("*").eq("id", id).maybeSingle();
    if (!data) return false;
    S.ui.checkinId = id; saveUI();
    await loadDay(data.date);
    S.cur = S.checkins.find((c) => c.id === id) || data;
    return true;
  }

  function planFor(c) { return c ? S.plans[c.id] : null; }
  function groupsOf(plan) { return (plan && plan.plan && plan.plan.groups) || []; }

  /** Replays the events of a plan: per-exercise state, extras per group, whether the workout was saved. */
  function progress(plan) {
    const st = {}, last = {}, extras = {};
    let saved = false;
    for (const e of S.events[plan.id] || []) {
      if (e.group_index == null && e.kind === "done") { saved = true; continue; }
      const key = `${e.group_index}.${e.exercise_index}`;
      if (e.kind === "check") st[key] = "done";
      else if (e.kind === "uncheck") st[key] = "";
      else if (e.kind === "skip") st[key] = "skip";
      else if (e.kind === "add") (extras[e.group_index] = extras[e.group_index] || []).push(e);
      if (["check", "uncheck", "skip"].includes(e.kind)) last[key] = e.id;
    }
    return { st, last, extras, saved };
  }
  function groupStats(plan, gi) {
    const p = progress(plan), g = groupsOf(plan)[gi];
    let done = 0;
    g.exercises.forEach((_, ei) => { const s = p.st[`${gi}.${ei}`]; if (s === "done" || s === "skip") done++; });
    const extra = (p.extras[gi] || []).length;
    return { done: done + extra, tot: g.exercises.length + extra, full: done === g.exercises.length };
  }

  /** One tap on an exercise. After the workout is saved, or on a past day, a reason is required. */
  async function tap(plan, gi, ei, kind, label) {
    const p = progress(plan);
    const editing = p.saved || S.date !== denverDate();
    const body = { plan_id: plan.id, group_index: gi, exercise_index: ei, kind };
    if (editing) {
      const reason = window.prompt(`Editing a saved workout (${label}). Reason?`, "");
      if (!reason || !reason.trim()) return false;
      body.reason = reason.trim();
      const prior = p.last[`${gi}.${ei}`];
      if (prior) body.is_edit_of = prior;
    }
    const r = await fn("event", body);
    (S.events[plan.id] = S.events[plan.id] || []).push(r.event);
    return true;
  }

  // ---------- rendering ----------
  function render() {
    const v = S.view;
    let html = "";
    if (v === "loading") html = tierBox("plain", "Planner", "Loading.");
    else if (v === "signin") html = viewSignin();
    else {
      html = topBar();
      if (S.err) html += `<div class="err">${esc(S.err)}</div>`;
      if (S.msg) html += `<div class="ok">${esc(S.msg)}</div>`;
      if (S.busy) html += `<div class="muted" style="padding:6px 4px">${esc(S.busy)}</div>`;
      const views = { home: viewHome, checkin: viewCheckin, followup: viewFollowup, summary: viewSummary, group: viewGroup, exercise: viewExercise, end: viewEnd, calendar: viewCalendar, days: viewDays, settings: viewSettings };
      html += (views[v] || viewHome)();
    }
    $app.innerHTML = html;
    bind();
  }

  function tierBox(cls, title, why) {
    return `<div class="tier ${cls}"><div class="t">${esc(title)}</div><div class="why">${esc(why)}</div></div>`;
  }

  function topBar() {
    const today = S.date === denverDate();
    return `<div class="top"><span>${esc(niceDate(S.date || denverDate()))}${today ? "" : " (not today)"}</span><span>
      <button data-act="go-today">Today</button><button data-act="go-days">Days</button><button data-act="go-settings">Settings</button></span></div>`;
  }

  function viewSignin() {
    const step = S.ui.signinEmail ? "code" : "email";
    return `<div class="tier plain"><div class="t">Planner</div><div class="why">Sign in once on this device. You get an email with a one-time code.</div></div>
      ${S.err ? `<div class="err">${esc(S.err)}</div>` : ""}${S.msg ? `<div class="ok">${esc(S.msg)}</div>` : ""}
      <div class="q"><div class="lab">Email</div><input class="txt" id="email" type="email" autocomplete="email" inputmode="email" value="${esc(S.ui.signinEmail || "")}" placeholder="your email"></div>
      <div class="foot"><button class="btn primary" data-act="send-code" ${S.busy ? "disabled" : ""}>${step === "code" ? "Send a new code" : "Send me a code"}</button></div>
      ${step === "code" ? `<div class="q" style="margin-top:14px"><div class="lab">Paste the link from the email</div><input class="txt" id="link" type="url" inputmode="url" autocomplete="off" placeholder="long-press the link in the email, Copy, paste here"></div>
      <div class="q"><div class="lab">Or the code, if the email has one</div><input class="txt" id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6 digits"></div>
      <div class="foot"><button class="btn accent" data-act="verify-code" ${S.busy ? "disabled" : ""}>Sign in</button></div>
      <p class="muted">From the home-screen app, paste the link or type the code. Opening the link in Mail signs in the browser instead.</p>` : ""}
      ${S.busy ? `<p class="muted">${esc(S.busy)}</p>` : ""}`;
  }

  function viewHome() {
    const c = S.cur;
    const next = (S.checkins.length ? S.checkins[S.checkins.length - 1].number : 0) + 1;
    let html = "";
    if (!c) {
      html += tierBox("plain", "No check-in yet", `Nothing for ${niceDate(S.date)} so far. Check-in #1 arrives at ${isWeekend(S.date) ? "6:00" : "4:30"} as a notification.`);
    } else {
      const plan = planFor(c);
      html += tierBox(plan ? c.tier || "plain" : "plain", `Check-in #${c.number}${c.is_test ? " (test)" : ""}`, plan ? plan.tier_line : (c.answered_at ? "Answered, plan pending." : "Waiting for your answers."));
      if (S.checkins.length > 1) html += `<ul class="list">${S.checkins.map((x) => `<li data-act="pick-checkin" data-id="${x.id}"><div class="name">Check-in #${x.number}${x.is_test ? " (test)" : ""}</div><div class="muted">${esc(S.plans[x.id] ? S.plans[x.id].tier_line : (x.answered_at ? "plan pending" : "unanswered"))}</div></li>`).join("")}</ul>`;
    }
    html += `<div class="stack home" style="margin-top:12px">
      ${c && !c.answered_at ? `<button class="btn primary big" data-act="open-checkin" data-id="${c.id}">Answer check-in #${c.number}</button>` : ""}
      ${c && c.answered_at && !planFor(c) ? `<button class="btn primary big" data-act="resume-plan" data-id="${c.id}">Get my plan</button>` : ""}
      ${c && planFor(c) ? `<button class="btn primary big" data-act="open-plan" data-id="${c.id}">Open the plan</button>` : ""}
      ${S.calendar.length ? `<button class="btn" data-act="go-calendar">Today's Calendar</button>` : ""}
      ${S.date === denverDate() ? `<button class="btn" data-act="start-checkin">Start check-in #${next}</button><button class="btn" data-act="start-test">Start a test check-in</button>` : ""}
    </div>`;
    return html;
  }

  function draft() {
    const key = S.cur ? S.cur.id : "none";
    S.ui.drafts = S.ui.drafts || {};
    return (S.ui.drafts[key] = S.ui.drafts[key] || { meetTime: isWeekend(S.date) ? "" : "07:30", meetNone: false, sched: "", unusNone: false, unus: "", feel: "", feelText: "" });
  }
  function draftValid(d) {
    const meet = d.meetNone || d.meetTime;
    const unus = d.unusNone || (d.unus && d.unus.trim());
    return !!(meet && unus && d.feel);
  }

  function viewCheckin() {
    const c = S.cur, d = draft();
    return `${tierBox("plain", `Check-in #${c.number}${c.is_test ? " (test)" : ""}`, "Tap to answer. Text is optional. Open Oura for a second so the ring syncs.")}
      <div class="q"><div class="lab">Next commitment</div>
        <div class="opts"><input type="time" id="meetTime" class="opt" aria-label="Next commitment time" value="${esc(d.meetTime)}" ${d.meetNone ? "disabled" : ""}><button class="opt" data-act="meet-none" aria-pressed="${d.meetNone}">None today</button></div>
        <input class="txt" id="sched" placeholder="optional: in meetings till 11" aria-label="Schedule notes" value="${esc(d.sched)}"></div>
      <div class="q"><div class="lab">Anything unusual</div>
        <div class="opts one"><button class="opt" data-act="unus-none" aria-pressed="${d.unusNone}">Nothing</button></div>
        <input class="txt" id="unus" placeholder="or type it: left toe weird, slept badly" aria-label="Unusual notes" value="${esc(d.unus)}"></div>
      <div class="q"><div class="lab">How do you feel</div>
        <div class="opts">${FEELS.map(([k, label]) => `<button class="opt" data-act="feel" data-v="${k}" aria-pressed="${d.feel === k}">${label}</button>`).join("")}</div>
        <input class="txt" id="feelText" placeholder="optional: where or what" aria-label="Feel notes" value="${esc(d.feelText)}"></div>
      <div class="q"><div class="lab">Oura shots</div>
        <div class="shots"><div class="shot"><b>Readiness</b>score and contributors</div><div class="shot"><b>Sleep</b>score and key metrics</div></div>
        <input class="file" id="shots" type="file" accept="image/*" multiple aria-label="Attach Oura screenshots">
        <div class="thumbs">${S.shots.map((s, i) => `<img class="thumb" src="${s.preview}" alt="shot ${i + 1}" data-act="drop-shot" data-i="${i}" title="tap to remove">`).join("")}</div>
        <p class="muted">${S.shots.length ? `${S.shots.length} attached. Tap one to remove it.` : "Optional today, but without them the plan is built from your answers only."}</p></div>
      <div class="foot"><button class="btn primary" data-act="get-plan" ${draftValid(d) && !S.busy ? "" : "disabled"}>Get my plan</button></div>`;
  }

  function viewFollowup() {
    const f = S.followup;
    return `${tierBox("plain", `One question (check-in #${S.cur.number})`, f.question)}
      <div class="q"><div class="opts one">${(f.options || []).map((o) => `<button class="opt" data-act="fu-answer" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>
      <input class="txt" id="fuText" placeholder="or type an answer" aria-label="Answer"></div>
      <div class="foot"><button class="btn primary" data-act="fu-send" ${S.busy ? "disabled" : ""}>Answer</button></div>`;
  }

  function viewSummary() {
    const c = S.cur, plan = planFor(c);
    if (!plan) return viewHome();
    const p = progress(plan);
    const groups = groupsOf(plan);
    return `${tierBox(c.tier || "plain", (c.tier || "plan").replace(/^\w/, (x) => x.toUpperCase()) + (c.is_test ? " (test check-in)" : ""), plan.tier_line)}
      ${plan.plan.note ? `<p class="muted" style="margin:0 6px 8px">${esc(plan.plan.note)}</p>` : ""}
      <div class="total"><span class="n">${plan.total_minutes}</span><span class="u">min</span><span class="left">window ${plan.window_minutes ?? "?"}${plan.plan.proposed_start ? ` · start ${plan.plan.proposed_start}` : ""}${plan.plan.later_workout_time ? ` · later slot ${plan.plan.later_workout_time}` : ""}${p.saved ? " · saved" : ""}</span></div>
      <ul class="rows">${groups.map((g, gi) => { const s = groupStats(plan, gi); return `<li class="row ${s.full ? "done" : ""} ${S.g === gi && !s.full ? "cur" : ""}" data-act="open-group" data-g="${gi}">
        <div class="ring ${s.full ? "full" : ""}">${s.full ? "✓" : `${s.done}/${s.tot}`}</div><div><div class="name">${esc(g.name)}</div><div class="short">${esc(g.exercises.map((e) => e.name).join(", "))}</div></div><div class="min">${g.minutes}</div></li>`; }).join("")}</ul>
      <div class="foot"><button class="btn" data-act="go-calendar">Today's Calendar</button><button class="btn primary" data-act="end-workout">${p.saved ? "Workout summary" : "End workout"}</button></div>`;
  }

  function viewGroup() {
    const plan = planFor(S.cur), gi = S.g, g = groupsOf(plan)[gi];
    if (!g) return viewSummary();
    const p = progress(plan);
    return `<div class="crumb"><button data-act="go-summary">‹ Plan</button><span class="pos">group ${gi + 1} of ${groupsOf(plan).length}</span></div>
      <div class="total" style="padding-top:0"><span class="n" style="font-size:26px">${g.minutes}</span><span class="u">min</span><span class="left" style="font-family:var(--font);font-size:16px;font-weight:700;color:var(--ink)">${esc(g.name)}</span></div>
      <ul class="rows">${g.exercises.map((e, ei) => { const s = p.st[`${gi}.${ei}`] || ""; return `<li class="row ${s === "done" ? "done" : ""} ${s === "skip" ? "skip" : ""} ${S.e === ei ? "cur" : ""}" data-act="open-exercise" data-e="${ei}">
        <input class="box" type="checkbox" aria-label="Mark ${esc(e.name)} done" data-act="toggle" data-e="${ei}" ${s === "done" ? "checked" : ""}><div><div class="name">${esc(e.name)}</div><div class="short">${esc(e.prescription)}</div></div><div class="min">${e.minutes}</div></li>`; }).join("")}
      ${(p.extras[gi] || []).map((x) => `<li class="row done extra"><input class="box" type="checkbox" checked disabled><div><div class="name">${esc((x.added_exercise && x.added_exercise.name) || "added")}</div><div class="short">added by you ${esc(denverTime(x.at))}</div></div><div class="min">+</div></li>`).join("")}</ul>
      <div class="foot"><button class="btn" data-act="add-exercise">+ add to this group</button><button class="btn primary" data-act="group-done">All done</button></div>`;
  }

  function viewExercise() {
    const plan = planFor(S.cur), g = groupsOf(plan)[S.g], e = g && g.exercises[S.e];
    if (!e) return viewGroup();
    const s = progress(plan).st[`${S.g}.${S.e}`] || "";
    return `<div class="crumb"><button data-act="go-group">‹ Group</button><span class="pos">${esc(g.name)} · ${S.e + 1} of ${g.exercises.length}</span></div>
      <div class="ex"><h2>${esc(e.name)}</h2><div class="m">${e.minutes} min · ${esc(e.prescription)}</div>
        <p>${esc(e.cue)}</p>
        <div class="watch"><b>Watch for</b>${esc(e.watch_for)}</div>
        <div class="watch" style="border-left-color:var(--line)"><b>Done when</b>${esc(e.done_when)}</div></div>
      <div class="dfoot"><button class="btn" data-act="prev" ${S.e === 0 ? "disabled" : ""}>‹ Previous</button><button class="btn" data-act="next" ${S.e === g.exercises.length - 1 ? "disabled" : ""}>Next ›</button>
        <button class="btn" data-act="skip">${s === "skip" ? "Skipped (tap to undo)" : "Skip this one"}</button><button class="btn primary big" data-act="done">${s === "done" ? "Done ✓ (tap to undo)" : "Done ✓"}</button></div>`;
  }

  function viewEnd() {
    const plan = planFor(S.cur), p = progress(plan);
    let done = 0, skip = 0, left = 0, added = 0;
    groupsOf(plan).forEach((g, gi) => { g.exercises.forEach((_, ei) => { const s = p.st[`${gi}.${ei}`]; if (s === "done") done++; else if (s === "skip") skip++; else left++; }); added += (p.extras[gi] || []).length; });
    const lastNote = (S.events[plan.id] || []).filter((e) => e.note && e.group_index == null).slice(-1)[0];
    return `${tierBox(S.cur.tier || "plain", p.saved ? "Workout saved" : "Workout ended", `${done} done, ${skip} skipped${left ? `, ${left} not started` : ""}${added ? `, ${added} added` : ""}.`)}
      <label for="noteBox" class="muted" style="margin:6px 0;display:block">Anything to note? Optional.</label>
      <textarea class="note" id="noteBox" placeholder="toe was fine, added 5 min walk">${esc(lastNote ? lastNote.note : "")}</textarea>
      <div class="foot"><button class="btn" data-act="go-summary">Back to plan</button><button class="btn primary" data-act="save-workout">${p.saved ? "Save note" : "Save"}</button></div>`;
  }

  function viewCalendar() {
    const next = (S.checkins.length ? S.checkins[S.checkins.length - 1].number : 0) + 1;
    return `${tierBox("plain", "Today's Calendar", "Every entry has its own flow. Start and done are optional; they teach the plan how long things really take.")}
      <ul class="rows">${S.calendar.map((x) => {
        const t = x.planned_start_at ? denverTime(x.planned_start_at) : "";
        if (x.kind === "workout") { const plan = Object.values(S.plans).find((pl) => pl.id === x.plan_id); return `<li class="nx"><div><div class="name">${esc(x.name)}</div><div class="t">${t}${plan ? ` · ${esc(plan.tier_line.split(".")[0])}` : ""}${x.done_at ? " · done " + denverTime(x.done_at) : ""}</div></div><button data-act="open-plan-id" data-plan="${x.plan_id}">Open</button><span></span></li>`; }
        if (x.kind === "commitment") return `<li class="nx meet"><div><div class="name">${esc(x.name)}</div><div class="t">${t}</div></div><span></span><span></span></li>`;
        if (x.kind === "note") return `<li class="nx meet"><div><div class="name">${esc(x.name)}</div><div class="t">your note</div></div><span></span><span></span></li>`;
        if (x.kind === "later_workout") return `<li class="nx"><div><div class="name">${esc(x.name)}</div><div class="t">${t} · reminder at ${t}</div></div><button data-act="cal-start" data-id="${x.id}" class="${x.started_at ? "on" : ""}">Start</button><button data-act="cal-done" data-id="${x.id}" class="${x.done_at ? "on" : ""}">Done</button></li>`;
        return `<li class="nx"><div><div class="name">${esc(x.name)}</div><div class="t">${x.minutes_held} min held${x.started_at ? " · started " + denverTime(x.started_at) : ""}${x.done_at ? " · done " + denverTime(x.done_at) : ""}</div></div><button data-act="cal-start" data-id="${x.id}" class="${x.started_at ? "on" : ""}">Start</button><button data-act="cal-done" data-id="${x.id}" class="${x.done_at ? "on" : ""}">Done</button></li>`;
      }).join("")}</ul>
      <div class="foot">${S.date === denverDate() ? `<button class="btn" data-act="start-checkin">Check-in #${next}</button>` : ""}<button class="btn primary" data-act="go-home">Close</button></div>`;
  }

  function viewDays() {
    const byDate = {};
    S.days.forEach((c) => { (byDate[c.date] = byDate[c.date] || []).push(c); });
    const dates = Object.keys(byDate).sort().reverse();
    return `${tierBox("plain", "Days", "Any past day, from the tables. Tap one to open it; changes there need a reason.")}
      <ul class="list">${dates.map((d) => `<li data-act="open-day" data-date="${d}"><div class="name">${esc(niceDate(d))}</div><div class="muted">${byDate[d].map((c) => `#${c.number}${c.is_test ? " test" : ""} ${c.tier || (c.answered_at ? "pending" : "unanswered")}`).join(" · ")}</div></li>`).join("") || "<li>No days yet.</li>"}</ul>`;
  }

  function viewSettings() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const canPush = "serviceWorker" in navigator && "PushManager" in window;
    const perm = ("Notification" in window) ? Notification.permission : "unsupported";
    return `${tierBox("plain", "Settings", "Signed in on this device.")}
      <div class="stack">
        <div class="tier plain"><div class="t">Notifications</div><div class="why">${standalone ? "Home-screen app: good." : "Open the app from its home-screen icon to allow notifications (Share, Add to Home Screen)."} Permission: ${esc(perm)}.${canPush ? "" : " Push is not available in this browser."}</div></div>
        <button class="btn accent" data-act="enable-push" ${canPush && !S.busy ? "" : "disabled"}>Allow notifications on this device</button>
        <button class="btn" data-act="disable-push" ${canPush && !S.busy ? "" : "disabled"}>Turn off notifications on this device</button>
        <button class="btn" data-act="start-test">Start a test check-in</button>
        <button class="btn" data-act="sign-out">Sign out</button>
        <p class="muted">Everything you see is read live; nothing is stored on the phone beyond your sign-in and where you left off.</p>
      </div>`;
  }

  // ---------- actions ----------
  function go(view) { S.view = view; S.ui.view = view; S.ui.checkinId = S.cur ? S.cur.id : null; S.ui.g = S.g; S.ui.e = S.e; saveUI(); render(); }

  function bind() {
    on("[data-act]", "click", async (ev) => {
      const el = ev.currentTarget;
      const act = el.dataset.act;
      if (act === "toggle") ev.stopPropagation();
      await act$(act, el, ev);
    });
    on("#meetTime", "change", (ev) => { const d = draft(); d.meetTime = ev.target.value; saveUI(); render(); });
    on("#sched", "input", (ev) => { draft().sched = ev.target.value; saveUI(); });
    on("#unus", "input", (ev) => { const d = draft(); d.unus = ev.target.value; if (ev.target.value) d.unusNone = false; saveUI(); $("[data-act=unus-none]").setAttribute("aria-pressed", String(d.unusNone)); $("[data-act=get-plan]").disabled = !draftValid(d); });
    on("#feelText", "input", (ev) => { draft().feelText = ev.target.value; saveUI(); });
    on("#email", "input", (ev) => { S.ui.signinEmailTyped = ev.target.value; });
    on("#shots", "change", async (ev) => {
      const files = Array.from(ev.target.files || []);
      await busy("Preparing the shots", async () => { for (const f of files) S.shots.push(await fileToShot(f)); });
    });
  }

  async function act$(act, el) {
    const c = S.cur;
    switch (act) {
      case "send-code": {
        const email = ($("#email").value || "").trim();
        if (!email) { S.err = "Type the email address first."; render(); return; }
        await busy("Sending", async () => {
          // A refused address and a sent code read the same on screen.
          await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + C.appPath, shouldCreateUser: false } }).catch(() => ({}));
          S.ui.signinEmail = email; saveUI(); S.msg = "If that address can sign in here, a code is on its way.";
        });
        return;
      }
      case "verify-code": {
        const link = ($("#link").value || "").trim();
        const token = ($("#code").value || "").replace(/\s/g, "");
        if (!link && !token) { S.err = "Paste the link from the email, or type the code."; render(); return; }
        await busy("Signing in", async () => {
          let result;
          if (link) {
            // Only the token and type values are read from the pasted address; nothing is fetched from it.
            const parsed = linkTokens(link);
            if (!parsed) throw new Error("That does not look like the sign-in link. Long-press the link in the email, Copy, and paste it here.");
            result = await sb.auth.verifyOtp({ token_hash: parsed.token_hash, type: parsed.type });
          } else {
            result = await sb.auth.verifyOtp({ email: S.ui.signinEmail, token, type: "email" });
          }
          if (result.error) throw new Error("That did not work. Send a new email and try again.");
          S.msg = null;
        });
        return;
      }
      case "sign-out": await sb.auth.signOut(); S.ui = {}; saveUI(); return;
      case "go-today": await busy("Loading", async () => { S.ui.checkinId = null; await loadDay(denverDate()); go(homeView()); }); return;
      case "go-days": await busy("Loading", async () => { const { data } = await sb.from("checkins").select("id,date,number,tier,is_test,answered_at").order("date", { ascending: false }).order("number").limit(120); S.days = data || []; go("days"); }); return;
      case "open-day": await busy("Loading", async () => { S.ui.checkinId = null; await loadDay(el.dataset.date); go(homeView()); }); return;
      case "go-settings": go("settings"); return;
      case "go-home": go("home"); return;
      case "go-summary": go("summary"); return;
      case "go-group": go("group"); return;
      case "go-calendar": go("calendar"); return;
      case "pick-checkin": S.cur = S.checkins.find((x) => x.id === el.dataset.id) || c; go(homeView()); return;
      case "open-checkin": S.cur = S.checkins.find((x) => x.id === el.dataset.id) || c; S.shots = []; go("checkin"); return;
      case "open-plan": S.cur = S.checkins.find((x) => x.id === el.dataset.id) || c; S.g = 0; S.e = 0; go("summary"); return;
      case "open-plan-id": { const plan = Object.values(S.plans).find((p) => p.id === el.dataset.plan); if (plan) { S.cur = S.checkins.find((x) => x.id === plan.checkin_id) || c; S.g = 0; S.e = 0; go("summary"); } return; }
      case "start-checkin":
      case "start-test": {
        const isTest = act === "start-test";
        await busy(isTest ? "Starting a test check-in" : "Starting the check-in", async () => {
          const r = await fn("checkin-open", isTest ? { is_test: true } : {});
          S.ui.checkinId = r.checkin.id; saveUI();
          await loadDay(r.checkin.date);
          S.cur = S.checkins.find((x) => x.id === r.checkin.id) || r.checkin;
          S.shots = [];
          go("checkin");
        });
        return;
      }
      case "meet-none": { const d = draft(); d.meetNone = !d.meetNone; if (d.meetNone) d.meetTime = ""; else if (!d.meetTime) d.meetTime = "07:30"; saveUI(); render(); return; }
      case "unus-none": { const d = draft(); d.unusNone = !d.unusNone; if (d.unusNone) d.unus = ""; saveUI(); render(); return; }
      case "feel": { const d = draft(); d.feel = d.feel === el.dataset.v ? "" : el.dataset.v; saveUI(); render(); return; }
      case "drop-shot": S.shots.splice(Number(el.dataset.i), 1); render(); return;
      case "get-plan": {
        const d = draft();
        await busy(S.shots.length ? "Reading the shots and building your plan" : "Building your plan", async () => {
          const body = {
            checkin_id: c.id,
            answers: { next_commitment: d.meetNone ? null : d.meetTime, none_today: d.meetNone, unusual_text: d.unusNone ? null : (d.unus || null), feel: d.feel, feel_text: d.feelText || null, schedule_notes: d.sched || null },
          };
          if (S.shots.length) body.screenshots = S.shots.map((s) => ({ name: s.name, base64: s.base64 }));
          const r = await fn("checkin-submit", body);
          S.shots = [];
          await applySubmit(r);
        });
        return;
      }
      case "fu-answer": $("#fuText").value = el.dataset.v; $$("[data-act=fu-answer]").forEach((b) => b.setAttribute("aria-pressed", String(b === el))); return;
      case "fu-send": {
        const answer = ($("#fuText").value || "").trim();
        if (!answer) { S.err = "Pick or type an answer."; render(); return; }
        await busy("Building your plan", async () => { const r = await fn("checkin-submit", { checkin_id: c.id, followup: { id: S.followup.id, answer } }); await applySubmit(r); });
        return;
      }
      case "resume-plan": await busy("Building your plan", async () => { const r = await fn("checkin-submit", { checkin_id: el.dataset.id }); await applySubmit(r); }); return;
      case "open-group": S.g = Number(el.dataset.g); S.e = 0; go("group"); return;
      case "open-exercise": S.e = Number(el.dataset.e); go("exercise"); return;
      case "toggle": {
        const plan = planFor(c), ei = Number(el.dataset.e), e = groupsOf(plan)[S.g].exercises[ei];
        const cur = progress(plan).st[`${S.g}.${ei}`] || "";
        await busy(null, async () => { await tap(plan, S.g, ei, cur === "done" ? "uncheck" : "check", e.name); });
        return;
      }
      case "add-exercise": {
        const name = window.prompt("What did you add to this group?", "");
        if (!name || !name.trim()) return;
        const plan = planFor(c);
        await busy(null, async () => {
          const body = { plan_id: plan.id, group_index: S.g, kind: "add", added_exercise: { name: name.trim() } };
          if (progress(plan).saved || S.date !== denverDate()) { const reason = window.prompt("Editing a saved workout. Reason?", ""); if (!reason) return; body.reason = reason; }
          const r = await fn("event", body); (S.events[plan.id] = S.events[plan.id] || []).push(r.event);
        });
        return;
      }
      case "group-done": {
        const plan = planFor(c), g = groupsOf(plan)[S.g], p = progress(plan);
        await busy("Checking off", async () => {
          for (let ei = 0; ei < g.exercises.length; ei++) if (!p.st[`${S.g}.${ei}`]) { const ok = await tap(plan, S.g, ei, "check", g.exercises[ei].name); if (!ok) break; }
          if (S.g < groupsOf(plan).length - 1) S.g++;
          go("summary");
        });
        return;
      }
      case "prev": S.e--; go("exercise"); return;
      case "next": S.e++; go("exercise"); return;
      case "done": case "skip": {
        const plan = planFor(c), g = groupsOf(plan)[S.g], e = g.exercises[S.e];
        const cur = progress(plan).st[`${S.g}.${S.e}`] || "";
        const kind = act === "done" ? (cur === "done" ? "uncheck" : "check") : (cur === "skip" ? "uncheck" : "skip");
        await busy(null, async () => {
          const ok = await tap(plan, S.g, S.e, kind, e.name);
          if (ok && kind !== "uncheck") { if (S.e < g.exercises.length - 1) { S.e++; go("exercise"); } else go("group"); }
        });
        return;
      }
      case "end-workout": go("end"); return;
      case "save-workout": {
        const plan = planFor(c), note = ($("#noteBox").value || "").trim(), p = progress(plan);
        await busy("Saving", async () => {
          const body = p.saved ? { plan_id: plan.id, kind: "note", note } : { plan_id: plan.id, kind: "done", note: note || null };
          if (p.saved && !note) return;
          const r = await fn("event", body); (S.events[plan.id] = S.events[plan.id] || []).push(r.event);
          await loadDay(S.date);
          go("calendar");
        });
        return;
      }
      case "cal-start": case "cal-done": {
        await busy(null, async () => {
          await fn("event", { calendar_id: el.dataset.id, kind: act === "cal-start" ? "start" : "done" });
          await loadDay(S.date);
        });
        return;
      }
      case "enable-push": await busy("Asking for permission", enablePush); if (!S.err) S.msg = "Notifications are on for this device."; render(); return;
      case "disable-push": await busy("Turning off", disablePush); if (!S.err) S.msg = "Notifications are off on this device."; render(); return;
      default: return;
    }
  }

  async function applySubmit(r) {
    if (r.status === "followup") { S.followup = r.followup; go("followup"); return; }
    await loadDay(S.date);
    if (r.status === "plan") { S.cur = S.checkins.find((x) => x.id === r.checkin.id) || S.cur; S.g = 0; S.e = 0; go("summary"); return; }
    go(homeView());
  }

  /** Which screen the current check-in wants. */
  function homeView() {
    const c = S.cur;
    if (!c) return "home";
    const pending = S.pending.find((f) => f.checkin_id === c.id);
    if (pending) { S.followup = pending; return "followup"; }
    if (!c.answered_at) return "home";
    if (planFor(c) && S.ui.view && ["summary", "group", "exercise", "end", "calendar"].includes(S.ui.view) && S.ui.checkinId === c.id) { S.g = S.ui.g || 0; S.e = S.ui.e || 0; return S.ui.view; }
    return planFor(c) ? "summary" : "home";
  }

  // ---------- shots ----------
  function readDataUrl(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("could not read the file")); r.readAsDataURL(file); });
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("this image could not be opened; send the screenshot, not a photo")); img.src = url; });
  }
  /** PNG and JPEG go up as they are; anything else (a HEIC photo) is drawn to a canvas and sent as JPEG. */
  async function fileToShot(file) {
    const isPng = file.type === "image/png", isJpeg = file.type === "image/jpeg";
    if ((isPng || isJpeg) && file.size <= 9 * 1024 * 1024) {
      const dataUrl = await readDataUrl(file);
      return { name: file.name, base64: dataUrl.split(",")[1], preview: dataUrl };
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      return { name: file.name.replace(/\.\w+$/, "") + ".jpg", base64: dataUrl.split(",")[1], preview: dataUrl };
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- sign-in link ----------
  /** The token hash and type carried by a pasted sign-in link, or null. Handles a link that was wrapped or padded by the mail app. */
  function linkTokens(text) {
    const m = /https?:\/\/[^\s"'<>]+/.exec(text);
    if (!m) return null;
    let url;
    try { url = new URL(m[0]); } catch { return null; }
    const p = url.searchParams;
    const token_hash = p.get("token") || p.get("token_hash") || "";
    const type = p.get("type") || "magiclink";
    if (!token_hash || !/^[A-Za-z0-9_-]{10,}$/.test(token_hash)) return null;
    if (!["magiclink", "email", "signup", "recovery", "invite"].includes(type)) return null;
    return { token_hash, type };
  }

  // ---------- push ----------
  function b64ToBytes(s) {
    const t = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(t); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function enablePush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Notifications need the home-screen app: Share, Add to Home Screen, then open it from the icon.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications were not allowed.");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(C.vapidPublicKey) });
    const j = sub.toJSON();
    await fn("push-subscribe", { endpoint: j.endpoint, keys: j.keys, device_label: "phone" });
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fn("push-subscribe", { endpoint: sub.endpoint, revoke: true });
    await sub.unsubscribe();
  }

  // ---------- start ----------
  async function start() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    const { data } = await sb.auth.getSession();
    S.session = data.session;
    sb.auth.onAuthStateChange((_event, session) => {
      const had = !!S.session; S.session = session;
      if (!session) { S.view = "signin"; render(); }
      else if (!had) boot();
    });
    if (!S.session) { S.view = "signin"; render(); return; }
    await boot();
  }
  async function boot() {
    S.view = "loading"; render();
    try {
      const params = new URLSearchParams(location.search);
      const wanted = params.get("checkin");
      if (wanted) { history.replaceState(null, "", location.pathname); if (!(await loadCheckinById(wanted))) await loadDay(denverDate()); }
      else await loadDay(S.ui.checkinId ? (S.ui.date || denverDate()) : denverDate());
      S.ui.date = S.date;
      go(homeView());
    } catch (e) {
      S.err = e.message || String(e); S.view = "home"; render();
    }
  }
  start();
})();
