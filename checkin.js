// Check-in #1 and the processing screen. The check-in asks the same three things as before, plus
// which Prep entries are on today; the plan is then made from last night's values and the rules in
// Settings. When the ring is not connected the values can be typed. While the plan is made the
// screen says what it is doing.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, go, render, tierBox, S, denverDate, applySubmit, viewCheckinV1 } = X;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const FEELS = [["good", "Good"], ["okay", "Okay"], ["rough", "Rough"], ["pain", "Pain somewhere"]];

  const K = { loadedFor: null, loading: false, conn: null, values: null, prep: [], error: null };
  const P = { on: false, step: 0, timer: null, slow: false, error: null, started: 0 };

  function isWeekend(date) {
    const [y, m, d] = date.split("-").map(Number);
    const w = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    return w === 0 || w === 6;
  }

  function draft() {
    const key = S.cur ? S.cur.id : "none";
    S.ui.v2drafts = S.ui.v2drafts || {};
    return (S.ui.v2drafts[key] = S.ui.v2drafts[key] || { meetTime: isWeekend(S.date || denverDate()) ? "" : "07:30", meetNone: false, sched: "", unusNone: false, unus: "", feel: "", feelText: "", prepOff: [], prepMin: {}, manual: {} });
  }
  function save() { try { localStorage.setItem("planner-ui", JSON.stringify(S.ui)); } catch { /* fine without it */ } }
  function valid(d) {
    const meet = d.meetNone || d.meetTime;
    const unus = d.unusNone || (d.unus && d.unus.trim());
    return !!(meet && unus && d.feel);
  }

  /** The connection, today's values and the Prep entries, read once per check-in. */
  async function load() {
    const key = S.cur ? S.cur.id : "none";
    if (K.loading || K.loadedFor === key) return;
    K.loading = true; K.error = null;
    try {
      const today = denverDate();
      const [conn, days, prep] = await Promise.all([
        fn("oura-connect", { action: "check" }).catch(() => ({ state: "none" })),
        fn("oura-pull", { action: "days", from: today, to: today }).catch(() => ({ days: [] })),
        sb.from("effective_library_exercises").select("key, name, seconds, position").eq("block_key", "prep").eq("excluded", false).order("position"),
      ]);
      K.conn = conn;
      K.values = (days.days || [])[0] || null;
      K.prep = (prep.data || []).map((e) => ({ key: e.key, name: e.name, minutes: Math.round((e.seconds || 0) / 60) }));
      K.loadedFor = key;
    } catch (e) {
      K.error = e.message || String(e);
    } finally {
      K.loading = false;
      render();
    }
  }

  const connected = () => K.conn && K.conn.state === "connected";
  const needsManual = () => !connected() || !K.values || (K.values.readiness == null && K.values.sleep == null && K.values.rest_hr == null);

  function prepToday(d) {
    return K.prep.filter((p) => !d.prepOff.includes(p.key)).map((p) => ({ key: p.key, name: p.name, minutes: d.prepMin[p.key] != null ? Number(d.prepMin[p.key]) : p.minutes }));
  }

  function view() {
    const c = S.cur;
    if (!c) return tierBox("plain", "Check-in", "Nothing to answer.");
    if (K.conn && K.conn.state === "paused" && viewCheckinV1) return viewCheckinV1();
    if (K.loadedFor !== c.id) { load(); return tierBox("plain", `Check-in #${c.number}`, "Loading."); }
    const d = draft();
    const kept = prepToday(d);
    const prepTotal = kept.reduce((s, p) => s + p.minutes, 0);
    const nightLine = connected()
      ? (needsManual() ? "Nothing from the ring for last night yet. Open the Oura app for a moment so it syncs, then come back; or type what you know below." : "Last night is in.")
      : "The ring is not connected. Type what you know below, or leave it blank and the plan comes from your answers.";
    return `${tierBox("plain", `Check-in #${c.number}${c.is_test ? " (test)" : ""}`, nightLine)}
      ${K.error ? `<div class="err">${esc(K.error)}</div>` : ""}
      <div class="q"><div class="lab">First commitment today</div>
        <div class="opts"><input type="time" id="meetTime" class="opt" aria-label="First commitment time" value="${esc(d.meetTime)}" ${d.meetNone ? "disabled" : ""}><button class="opt" data-c="meet-none" aria-pressed="${d.meetNone}">None today</button></div>
        <input class="txt" id="sched" placeholder="optional: in meetings till 11" aria-label="Schedule notes" value="${esc(d.sched)}"></div>
      <div class="q"><div class="lab">Prep before the window</div>
        <div class="stack prep">${K.prep.map((p) => { const on = !d.prepOff.includes(p.key); const m = d.prepMin[p.key] != null ? d.prepMin[p.key] : p.minutes; return `<div class="prow ${on ? "" : "off"}"><input type="checkbox" class="box" data-c="prep-toggle" data-k="${esc(p.key)}" ${on ? "checked" : ""} aria-label="${esc(p.name)} today"><span class="pn">${esc(p.name)}</span><span class="pm"><input type="number" inputmode="numeric" min="0" max="600" value="${esc(String(m))}" data-pm="${esc(p.key)}" aria-label="${esc(p.name)}, minutes" ${on ? "" : "disabled"}> min</span></div>`; }).join("") || `<p class="muted">No Prep entries in the Library.</p>`}</div>
        <p class="muted">${prepTotal} min of prep comes off before the window.</p></div>
      <div class="q"><div class="lab">Anything unusual</div>
        <div class="opts one"><button class="opt" data-c="unus-none" aria-pressed="${d.unusNone}">Nothing</button></div>
        <input class="txt" id="unus" placeholder="or type it: left toe weird, slept badly" aria-label="Unusual notes" value="${esc(d.unus)}"></div>
      <div class="q"><div class="lab">How do you feel</div>
        <div class="opts">${FEELS.map(([k, label]) => `<button class="opt" data-c="feel" data-v="${k}" aria-pressed="${d.feel === k}">${label}</button>`).join("")}</div>
        <input class="txt" id="feelText" placeholder="optional: where or what" aria-label="Feel notes" value="${esc(d.feelText)}"></div>
      ${needsManual() ? `<div class="q"><div class="lab">Last night, by hand</div>
        <p class="muted">Every field is optional. Leave them all blank for a day planned from your answers.</p>
        <div class="manual">
          <label><span>Readiness</span><input type="number" inputmode="numeric" min="0" max="100" data-m="readiness" value="${esc(d.manual.readiness ?? "")}" placeholder="0 to 100"></label>
          <label><span>Sleep score</span><input type="number" inputmode="numeric" min="0" max="100" data-m="sleep_score" value="${esc(d.manual.sleep_score ?? "")}" placeholder="0 to 100"></label>
          <label><span>Resting HR</span><input type="number" inputmode="numeric" min="20" max="200" data-m="resting_hr" value="${esc(d.manual.resting_hr ?? "")}" placeholder="bpm"></label>
          <label><span>HRV</span><input type="number" inputmode="numeric" min="1" max="300" data-m="avg_hrv" value="${esc(d.manual.avg_hrv ?? "")}" placeholder="ms"></label>
          <label class="wide"><span>Temperature deviation</span><input type="number" inputmode="decimal" step="0.1" min="-10" max="10" data-m="temp_f" value="${esc(d.manual.temp_f ?? "")}" placeholder="°F, e.g. 0.4 or -0.2"></label>
        </div></div>` : ""}
      <div class="foot"><button class="btn primary" data-c="make-plan" ${valid(d) && !S.busy ? "" : "disabled"}>Make today's plan</button></div>`;
  }

  // ---------- processing (R20.1) ----------
  const STEPS = ["Reading last night", "Comparing to your baselines", "Picking the session for the window", "Applying flags and your notes", "Writing the note"];
  function viewProcessing() {
    if (P.error) return `${tierBox("plain", "That did not go through", P.error)}<div class="foot"><button class="btn" data-c="back">Back to the check-in</button></div>`;
    return `<div class="proc"><div class="spin" aria-hidden="true"></div><div class="t">Making today's plan</div>
      <ul class="steps">${STEPS.map((s, i) => `<li class="${i < P.step ? "ok" : ""}">${esc(s)}</li>`).join("")}</ul>
      <p class="muted">${P.slow ? "Taking longer than usual. Still working." : "No model, no upload. Usually a few seconds."}</p></div>`;
  }
  function tick() {
    if (!P.on) return;
    if (P.step < STEPS.length - 1) P.step += 1;
    if (Date.now() - P.started > 20000) P.slow = true;
    render();
    P.timer = setTimeout(tick, 1200);
  }
  async function makePlan() {
    const c = S.cur, d = draft();
    const manual = {};
    for (const k of ["readiness", "sleep_score", "resting_hr", "avg_hrv", "temp_f"]) { const v = d.manual[k]; if (v !== "" && v != null && !Number.isNaN(Number(v))) manual[k] = Number(v); }
    const body = {
      checkin_id: c.id, v2: true,
      answers: { next_commitment: d.meetNone ? null : d.meetTime, none_today: d.meetNone, unusual_text: d.unusNone ? null : (d.unus || null), feel: d.feel, feel_text: d.feelText || null, schedule_notes: d.sched || null },
      prep: prepToday(d).map((p) => ({ key: p.key, minutes: p.minutes })),
    };
    if (needsManual() && Object.keys(manual).length) body.values = manual;
    S.v2Extra = { v2: true, prep: body.prep }; // a follow-up answer or a resume carries the same choices
    P.on = true; P.step = 0; P.slow = false; P.error = null; P.started = Date.now();
    go("processing");
    P.timer = setTimeout(tick, 900);
    try {
      const r = await fn("checkin-submit", body);
      P.step = STEPS.length;
      await applySubmit(r);
    } catch (e) {
      P.error = e.message || String(e);
      render();
    } finally {
      P.on = false;
      if (P.timer) clearTimeout(P.timer);
      P.timer = null;
    }
  }

  function bind() {
    const d = draft();
    $$("[data-c]").forEach((el) => el.addEventListener("click", async () => {
      const a = el.dataset.c;
      if (a === "meet-none") { d.meetNone = !d.meetNone; if (d.meetNone) d.meetTime = ""; else if (!d.meetTime) d.meetTime = "07:30"; save(); render(); }
      else if (a === "unus-none") { d.unusNone = !d.unusNone; if (d.unusNone) d.unus = ""; save(); render(); }
      else if (a === "feel") { d.feel = d.feel === el.dataset.v ? "" : el.dataset.v; save(); render(); }
      else if (a === "prep-toggle") { const k = el.dataset.k; d.prepOff = d.prepOff.includes(k) ? d.prepOff.filter((x) => x !== k) : [...d.prepOff, k]; save(); render(); }
      else if (a === "make-plan") { if (valid(d)) await makePlan(); }
      else if (a === "back") { P.error = null; go("checkin"); }
    }));
    const mt = $("#meetTime"); if (mt) mt.addEventListener("change", () => { d.meetTime = mt.value; save(); render(); });
    const sc = $("#sched"); if (sc) sc.addEventListener("input", () => { d.sched = sc.value; save(); });
    const un = $("#unus"); if (un) un.addEventListener("input", () => { d.unus = un.value; if (un.value) d.unusNone = false; save(); $$("[data-c=make-plan]").forEach((b) => { b.disabled = !valid(d); }); });
    const ft = $("#feelText"); if (ft) ft.addEventListener("input", () => { d.feelText = ft.value; save(); });
    $$("[data-pm]").forEach((i) => i.addEventListener("change", () => { d.prepMin[i.dataset.pm] = Math.max(0, Math.min(600, Number(i.value) || 0)); save(); render(); }));
    $$("[data-m]").forEach((i) => i.addEventListener("input", () => { d.manual[i.dataset.m] = i.value; save(); }));
  }

  window.PlannerViews = Object.assign(window.PlannerViews || {}, {
    checkin: { open: async () => { K.loadedFor = null; await load(); }, render: view, bind },
    processing: { open: async () => {}, render: viewProcessing, bind },
  });
})();
