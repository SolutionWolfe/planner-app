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

  const K = { loadedFor: null, loading: false, conn: null, values: null, prep: [], error: null, syncing: false };
  const LEFT = [["30", "30 min"], ["60", "1 hr"], ["120", "2 hrs"], ["none", "None"], ["other", "Other"]];
  const P = { on: false, step: 0, timer: null, slow: false, error: null, started: 0 };

  function isWeekend(date) {
    const [y, m, d] = date.split("-").map(Number);
    const w = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    return w === 0 || w === 6;
  }

  function draft() {
    const key = S.cur ? S.cur.id : "none";
    S.ui.v2drafts = S.ui.v2drafts || {};
    return (S.ui.v2drafts[key] = S.ui.v2drafts[key] || { meetTime: isWeekend(S.date || denverDate()) ? "" : "07:30", meetNone: false, sched: "", unusNone: false, unus: "", unusYes: false, feel: "", feelText: "", prepOff: [], prepMin: {}, manual: {}, left: "", leftMin: "" });
  }
  function save() { try { localStorage.setItem("planner-ui", JSON.stringify(S.ui)); } catch { /* fine without it */ } }
  const laterCheckin = () => !!(S.cur && S.cur.number > 1);
  function timeLeft(d) {
    if (d.left === "none") return null;
    if (d.left === "other") return d.leftMin === "" ? undefined : Math.max(0, Math.round(Number(d.leftMin) || 0));
    return d.left ? Number(d.left) : undefined;
  }
  function valid(d) {
    const unus = d.unusNone || (d.unusYes && d.unus && d.unus.trim());
    if (laterCheckin()) return !!(timeLeft(d) !== undefined && d.feel);
    const meet = d.meetNone || d.meetTime;
    return !!(meet && unus && d.feel);
  }

  /** Open Oura to sync (R10): the app if the phone has it, else its store page; the record is read again on return. */
  function openOura() {
    const started = Date.now();
    const store = "https://apps.apple.com/app/id1043837948";
    const onHide = () => { document.removeEventListener("visibilitychange", onHide); };
    document.addEventListener("visibilitychange", onHide);
    setTimeout(() => { if (document.visibilityState === "visible" && Date.now() - started < 2500) window.location.href = store; }, 1500);
    window.location.href = "oura://";
  }
  async function resync() {
    if (K.syncing || !S.cur) return;
    K.syncing = true;
    try {
      await fn("oura-pull", { action: "pull", reason: "focus" }).catch(() => null);
      const today = denverDate();
      const days = await fn("oura-pull", { action: "days", from: today, to: today }).catch(() => ({ days: [] }));
      K.values = (days.days || [])[0] || null;
    } finally {
      K.syncing = false;
      if (S.view === "checkin") render();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && S.view === "checkin" && S.session && K.loadedFor && connected() && needsManual()) resync();
  });

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
      ? (needsManual() ? (K.syncing ? "Reading the ring again." : "Nothing from the ring for last night yet. Open Oura so it syncs and come back; or type what you know below.") : "Last night is in.")
      : "The ring is not connected. Type what you know below, or leave it blank and the plan comes from your answers.";
    const feelBlock = `<div class="q"><div class="lab">How do you feel${laterCheckin() ? " now" : ""}</div>
        <div class="opts">${FEELS.map(([k, label]) => `<button class="opt" data-c="feel" data-v="${k}" aria-pressed="${d.feel === k}">${label}</button>`).join("")}</div>
        <input class="txt" id="feelText" placeholder="optional: where or what" aria-label="Feel notes" value="${esc(d.feelText)}"></div>`;
    if (laterCheckin()) {
      return `${tierBox("plain", `Check-in #${c.number}${c.is_test ? " (test)" : ""}`, "Done blocks stay as they are. Only what is left gets planned again.")}
        ${K.error ? `<div class="err">${esc(K.error)}</div>` : ""}
        <div class="q"><div class="lab">How much time is left today</div>
          <div class="opts">${LEFT.map(([k, label]) => `<button class="opt" data-c="left" data-v="${k}" aria-pressed="${d.left === k}">${label}</button>`).join("")}</div>
          ${d.left === "other" ? `<input class="txt" id="leftMin" type="number" inputmode="numeric" min="0" max="600" placeholder="minutes" aria-label="Minutes left" value="${esc(d.leftMin)}">` : ""}
          <p class="muted">${d.left === "none" ? "No window: the rest of today is rest." : "Rounds down to a column of the Later grid; under 15 minutes is rest."}</p></div>
        ${feelBlock}
        <div class="foot"><button class="btn primary" data-c="make-plan" ${valid(d) && !S.busy ? "" : "disabled"}>Revise the rest of today</button></div>`;
    }
    return `${tierBox("plain", `Check-in #${c.number}${c.is_test ? " (test)" : ""}`, nightLine)}
      ${K.error ? `<div class="err">${esc(K.error)}</div>` : ""}
      ${connected() && needsManual() ? `<button class="btn accent" data-c="open-oura" ${K.syncing ? "disabled" : ""}>Open Oura to sync</button>` : ""}
      <div class="q"><div class="lab">First commitment today</div>
        <div class="opts"><input type="time" id="meetTime" class="opt" aria-label="First commitment time" value="${esc(d.meetTime)}" ${d.meetNone ? "disabled" : ""}><button class="opt" data-c="meet-none" aria-pressed="${d.meetNone}">None today</button></div>
        <input class="txt" id="sched" placeholder="optional: in meetings till 11" aria-label="Schedule notes" value="${esc(d.sched)}"></div>
      <div class="q"><div class="lab">Prep before the window</div>
        <div class="stack prep">${K.prep.map((p) => { const on = !d.prepOff.includes(p.key); const m = d.prepMin[p.key] != null ? d.prepMin[p.key] : p.minutes; return `<div class="prow ${on ? "" : "off"}"><input type="checkbox" class="box" data-c="prep-toggle" data-k="${esc(p.key)}" ${on ? "checked" : ""} aria-label="${esc(p.name)} today"><span class="pn">${esc(p.name)}</span><span class="pm"><input type="number" inputmode="numeric" min="0" max="600" value="${esc(String(m))}" data-pm="${esc(p.key)}" aria-label="${esc(p.name)}, minutes" ${on ? "" : "disabled"}> min</span></div>`; }).join("") || `<p class="muted">No Prep entries in the Library.</p>`}</div>
        <p class="muted">${prepTotal} min of prep comes off before the window.</p></div>
      <div class="q"><div class="lab">Anything unusual?</div>
        <div class="opts"><button class="opt" data-c="unus-none" aria-pressed="${d.unusNone}">No</button><button class="opt" data-c="unus-yes" aria-pressed="${d.unusYes}">Yes</button></div>
        ${d.unusYes ? `<input class="txt" id="unus" placeholder="what is going on: left toe weird, slept badly" aria-label="Unusual notes" value="${esc(d.unus)}">` : ""}</div>
      ${feelBlock}
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
    const body = laterCheckin()
      ? { checkin_id: c.id, v2: true, time_left: timeLeft(d), answers: { feel: d.feel, feel_text: d.feelText || null } }
      : {
        checkin_id: c.id, v2: true, unusual_flag: !!d.unusYes,
        answers: { next_commitment: d.meetNone ? null : d.meetTime, none_today: d.meetNone, unusual_text: d.unusYes ? (d.unus || null) : null, feel: d.feel, feel_text: d.feelText || null, schedule_notes: d.sched || null },
        prep: prepToday(d).map((p) => ({ key: p.key, minutes: p.minutes })),
      };
    if (!laterCheckin() && needsManual() && Object.keys(manual).length) body.values = manual;
    S.v2Extra = laterCheckin() ? { v2: true, time_left: body.time_left } : { v2: true, prep: body.prep }; // a follow-up answer or a resume carries the same choices
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
      else if (a === "unus-none") { d.unusNone = !d.unusNone; if (d.unusNone) { d.unusYes = false; d.unus = ""; } save(); render(); }
      else if (a === "unus-yes") { d.unusYes = !d.unusYes; if (d.unusYes) d.unusNone = false; save(); render(); }
      else if (a === "left") { d.left = el.dataset.v; save(); render(); }
      else if (a === "open-oura") openOura();
      else if (a === "feel") { d.feel = d.feel === el.dataset.v ? "" : el.dataset.v; save(); render(); }
      else if (a === "prep-toggle") { const k = el.dataset.k; d.prepOff = d.prepOff.includes(k) ? d.prepOff.filter((x) => x !== k) : [...d.prepOff, k]; save(); render(); }
      else if (a === "make-plan") { if (valid(d)) await makePlan(); }
      else if (a === "back") { P.error = null; go("checkin"); }
    }));
    const mt = $("#meetTime"); if (mt) mt.addEventListener("change", () => { d.meetTime = mt.value; save(); render(); });
    const sc = $("#sched"); if (sc) sc.addEventListener("input", () => { d.sched = sc.value; save(); });
    const un = $("#unus"); if (un) un.addEventListener("input", () => { d.unus = un.value; save(); $$("[data-c=make-plan]").forEach((b) => { b.disabled = !valid(d); }); });
    const lm = $("#leftMin"); if (lm) lm.addEventListener("input", () => { d.leftMin = lm.value; save(); $$("[data-c=make-plan]").forEach((b) => { b.disabled = !valid(d); }); });
    const ft = $("#feelText"); if (ft) ft.addEventListener("input", () => { d.feelText = ft.value; save(); });
    $$("[data-pm]").forEach((i) => i.addEventListener("change", () => { d.prepMin[i.dataset.pm] = Math.max(0, Math.min(600, Number(i.value) || 0)); save(); render(); }));
    $$("[data-m]").forEach((i) => i.addEventListener("input", () => { d.manual[i.dataset.m] = i.value; save(); }));
  }

  window.PlannerViews = Object.assign(window.PlannerViews || {}, {
    checkin: { open: async () => { K.loadedFor = null; await load(); }, render: view, bind },
    processing: { open: async () => {}, render: viewProcessing, bind },
  });
})();
