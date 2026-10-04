// The home screen for today: what day it is, where the last plan day ended, and what is next.
// Everything shown comes from one read of the signed-in session's own days; the two writes
// (start today, close a past day) each go through one backend call.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, busy, go, render, tierBox, S } = X;
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // choice: what the close sheet will record for each open block, keyed by plan and block; verify: the block being checked as done.
  const H = { today: null, days: [], loaded: false, loading: false, open: false, sheet: false, swept: null, choice: {}, verify: null };
  const REASON_DONE = "done late, recorded next morning";
  const keyOf = (b) => `${b.plan_id}.${b.group_index}`;
  const dur = (sec) => { sec = Math.round(sec || 0); const m = Math.floor(sec / 60), r = sec % 60; return m && r ? `${m} min ${r} s` : m ? `${m} min` : `${r} s`; };

  // ---------- data ----------
  const longDate = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  };
  const weekday = (date) => longDate(date).slice(0, 3);
  const dayBefore = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1, 12)).toISOString().slice(0, 10);
  };

  async function read() {
    const { data, error } = await sb.from("day_summary").select("*").lte("date", H.today).order("date", { ascending: false }).limit(30);
    if (error) throw new Error("Could not load the day.");
    H.days = data || [];
  }
  /** Loads the days, and closes any older day still open behind the one on the card. */
  async function load() {
    if (H.loading) return;
    H.loading = true;
    try {
      H.today = X.denverDate();
      await read();
      const past = H.days.filter((d) => d.date < H.today && d.plans > 0);
      if (H.swept !== H.today && past.slice(1).some((d) => d.blocks_open > 0)) {
        H.swept = H.today; // asked once a day; the backend decides which days it may close
        const r = await fn("day-close", { sweep: true });
        if (r.closed && r.closed.length) await read();
      }
      H.loaded = true;
    } catch (e) {
      S.err = e.message || String(e);
      H.loaded = true;
    } finally {
      H.loading = false;
      if (S.view === "home") render();
    }
  }

  const todayRow = () => H.days.find((d) => d.date === H.today) || null;
  const lastPlanDay = () => H.days.find((d) => d.date < H.today && d.plans > 0) || null;
  const names = (blocks, status) => blocks.filter((b) => b.status === status).map((b) => b.name);
  const planWords = (d) => `${d.total_minutes}-minute ${d.tier && d.tier !== "no_data" ? d.tier + " " : ""}plan`;

  // ---------- the card for the last plan day ----------
  function card(collapsed) {
    const y = lastPlanDay();
    if (!y) return "";
    const isYesterday = y.date === dayBefore(H.today);
    const label = isYesterday ? `Yesterday, ${weekday(y.date)}` : `Last plan, ${X.niceDate(y.date)}`;
    const done = names(y.blocks, "done"), open = names(y.blocks, "open"), skipped = names(y.blocks, "skip"); // a replaced block is none of these
    const closed = open.length === 0;
    if (collapsed && !H.open) {
      return `<button class="card ycard one" data-h="card-toggle">${esc(label)}: ${esc(planWords(y))}, ${done.length} of ${y.blocks_total} blocks done${closed ? "" : `, ${open.length} still open`}</button>`;
    }
    return `<div class="card ycard${closed ? " closed" : ""}">
      <div class="h">${esc(label)}</div>
      <div class="big">${closed && !done.length ? "Closed" : esc(planWords(y))}</div>
      <div class="line"><b>Done:</b> ${esc(done.join(", ") || "nothing")}</div>
      ${closed ? (skipped.length ? `<div class="line"><b>Skipped:</b> ${esc(skipped.join(", "))}</div>` : "") : `<div class="line"><b>Not done:</b> ${esc(open.join(", "))}</div>`}
      <div class="acts"><button data-h="close-ask" ${closed ? "disabled" : ""}>Close ${isYesterday ? "yesterday" : "that day"}</button><button data-h="open-day">Open ${isYesterday ? "yesterday" : "that day"}</button></div>
    </div>`;
  }
  /** The close sheet: what is left, each item set to Skip unless it is marked Done; or the check of one item being marked Done. */
  function sheet() {
    const y = lastPlanDay();
    if (!H.sheet || !y) return "";
    const open = y.blocks.filter((b) => b.status === "open");
    const isYesterday = y.date === dayBefore(H.today);
    let body;
    if (H.verify) {
      const b = open.find((x) => keyOf(x) === H.verify.key);
      body = `<div class="h2">${esc(b ? b.name : "")}</div>
        <p class="muted">What counts as done. Check or change, then Done.</p>
        <div class="fld"><span>Time</span><div class="mmss"><input type="number" id="v-min" inputmode="numeric" min="0" max="600" placeholder="0" value="${esc(H.verify.min)}" aria-label="minutes"> min <input type="number" id="v-sec" inputmode="numeric" min="0" max="59" placeholder="0" value="${esc(H.verify.sec)}" aria-label="seconds"> s</div></div>
        <p class="muted">${b && b.minutes != null ? `Planned: ${b.minutes} minutes. ` : ""}Recorded as done, with the reason "${REASON_DONE}".</p>
        <div class="acts"><button class="btn sm" data-h="verify-cancel">Cancel</button><button class="btn sm dark" data-h="verify-done">Done</button></div>`;
    } else {
      body = `<div class="h2">Close ${isYesterday ? "yesterday" : esc(X.niceDate(y.date))}</div>
        <p class="muted">What is left from ${esc(longDate(y.date).split(",")[0])}. Skip all in one more tap, or mark one Done: that opens what counts as done so you can check or change it.</p>
        <div class="stack">${open.map((b) => { const c = H.choice[keyOf(b)]; const done = c && c.action === "done"; return `<div class="item"><span>${esc(b.name)}${done && c.seconds != null ? ` <span class="min">${esc(dur(c.seconds))}</span>` : ""}</span><button data-h="item-skip" data-k="${keyOf(b)}" aria-pressed="${!done}">Skip</button><button data-h="item-done" data-k="${keyOf(b)}" aria-pressed="${!!done}">${done ? "Done ✓" : "Done"}</button></div>`; }).join("")}</div>
        <div class="acts"><button class="btn sm" data-h="close-cancel">Cancel</button><button class="btn sm dark" data-h="close-save">Close ${isYesterday ? "yesterday" : "the day"}</button></div>`;
    }
    return `<div class="sheetbg" data-h="close-cancel"></div><div class="sheet on" role="dialog" aria-modal="true">${S.err ? `<div class="err">${esc(S.err)}</div>` : ""}${body}</div>`;
  }

  // ---------- the four states ----------
  /** What the last check-in of the day still needs, if anything: its answers, one question, or its plan. */
  function unfinished(t) {
    if (!t.last_answered) return `<button class="btn primary big" data-act="open-checkin" data-id="${t.last_checkin_id}">Continue check-in #${t.last_checkin_number}</button>`;
    if (t.last_checkin_id === t.plan_checkin_id) return "";
    const ask = (S.pending || []).find((f) => f.checkin_id === t.last_checkin_id);
    return ask
      ? `<button class="btn primary big" data-h="followup" data-id="${ask.id}">Answer one question</button>`
      : `<button class="btn primary big" data-act="resume-plan" data-id="${t.last_checkin_id}">Get my plan</button>`;
  }
  function view() {
    if (!H.loaded) return tierBox("plain", "Planner", "Loading.");
    const t = todayRow();
    const state = !t ? "new" : t.state;
    const sub = { new: "Nothing started yet today", checkin_open: `Check-in #${t ? t.last_checkin_number : 1} is open`, pending: "Answered, plan pending", in_progress: t ? `Plan in progress, ${t.blocks_done + t.blocks_skipped} of ${t.blocks_total} blocks done` : "", done: "Done for today" }[state];
    let body = "", foot = "";

    if (state === "new") {
      foot = `<button class="btn primary big" data-h="start">Start today</button>`;
    } else if (state === "checkin_open" || state === "pending") {
      foot = unfinished(t);
    } else {
      // The newest plan is the day's plan; what an earlier plan left unfinished is not listed.
      const blocks = t.blocks.filter((b) => b.status !== "replaced");
      const next = blocks.find((b) => b.status === "open");
      const waiting = unfinished(t);
      if (state === "in_progress") {
        body = `${tierBox(t.tier || "plain", t.tier_line || "Today's plan", `${t.window_minutes != null ? `Window ${t.window_minutes} minutes. ` : ""}Next up: ${next ? next.name : "nothing"}.`)}
          ${t.note ? `<p class="muted" style="margin:0 6px 8px">${esc(t.note)}</p>` : ""}
          <ul class="rows">${blocks.map((b) => `<li class="row ${b.status === "done" ? "done" : ""} ${b.status === "skip" ? "skip" : ""} ${next && b === next ? "cur" : ""}" data-h="block" data-c="${b.checkin_id}" data-g="${b.group_index}">
            <div class="ring ${b.status === "done" ? "full" : ""}">${b.status === "done" ? "✓" : b.status === "skip" ? "–" : `${b.done + b.skipped}/${b.exercises}`}</div><div><div class="name">${esc(b.name)}</div><div class="short">${b.status === "open" ? "open" : b.status === "skip" ? "skipped" : "done"}${b.checkin_number !== t.plan_checkin_number ? " · earlier plan" : ""}</div></div><div class="min">${b.minutes ?? ""}</div></li>`).join("")}</ul>`;
      } else {
        const skipped = names(blocks, "skip");
        body = tierBox("green", "Done for today", blocks.length ? `${t.total_minutes} minutes planned, ${t.minutes_done} done${skipped.length ? `, ${skipped.join(", ")} skipped` : ""}.` : "Nothing planned today.");
      }
      foot = `${waiting}<button class="btn ${state === "in_progress" && !waiting ? "primary" : ""}" data-act="open-plan" data-id="${t.plan_checkin_id}">Open today's plan</button>
        ${waiting ? "" : `<button class="btn" data-act="start-checkin">Check in again</button>`}
        ${S.calendar && S.calendar.length ? `<button class="btn quiet" data-act="go-calendar">Today's Calendar</button>` : ""}`;
    }
    const collapsed = state === "in_progress" || state === "done";
    return `<div class="date"><div class="d">${esc(longDate(H.today))}</div><div class="s">${esc(sub)}</div></div>
      ${card(collapsed)}${body}
      <div class="foot col">${foot}</div>${sheet()}`;
  }

  // ---------- events ----------
  const actions = {
    "card-toggle": () => { H.open = !H.open; render(); },
    "close-ask": () => { H.sheet = true; H.choice = {}; H.verify = null; S.err = null; render(); },
    "close-cancel": () => { if (H.verify) H.verify = null; else H.sheet = false; S.err = null; render(); },
    "item-skip": (el) => { delete H.choice[el.dataset.k]; render(); },
    "item-done": (el) => {
      const y = lastPlanDay(), b = y && y.blocks.find((x) => keyOf(x) === el.dataset.k);
      if (!b) return;
      const had = H.choice[el.dataset.k];
      const sec = had && had.seconds != null ? had.seconds : (b.minutes != null ? Math.round(Number(b.minutes) * 60) : null);
      H.verify = { key: el.dataset.k, min: sec == null ? "" : String(Math.floor(sec / 60) || ""), sec: sec == null ? "" : String(sec % 60 || "") };
      render();
    },
    "verify-cancel": () => { H.verify = null; S.err = null; render(); },
    "verify-done": () => {
      const read = (id) => ((document.querySelector(id) || {}).value || "").trim();
      const m = read("#v-min"), sc = read("#v-sec");
      if ([m, sc].some((v) => v !== "" && !(Number(v) >= 0 && Number(v) <= 6000))) { S.err = "Time must be minutes and seconds."; render(); return; }
      H.choice[H.verify.key] = { action: "done", seconds: m === "" && sc === "" ? null : Math.round(Number(m || 0) * 60 + Number(sc || 0)) };
      H.verify = null; S.err = null;
      render();
    },
    /** Done items are recorded first, one row per block; whatever is still open is then closed as skipped. */
    "close-save": async () => {
      const y = lastPlanDay();
      if (!y) return;
      await busy("Closing", async () => {
        const done = y.blocks.filter((b) => b.status === "open" && H.choice[keyOf(b)] && H.choice[keyOf(b)].action === "done");
        for (const b of done) {
          const planned = b.minutes != null ? Math.round(Number(b.minutes) * 60) : null;
          await fn("set-event", { plan_id: b.plan_id, group_index: b.group_index, kind: "block_done", reason: REASON_DONE, planned: { seconds: planned }, actual: { seconds: H.choice[keyOf(b)].seconds ?? planned } });
        }
        const r = await fn("day-close", { date: y.date });
        H.sheet = false; H.choice = {}; H.verify = null;
        await read();
        const n = (r.closed && r.closed[0] && r.closed[0].skipped) || 0;
        S.msg = `Closed: ${done.length ? `${done.length} done, ` : ""}${n} skipped.`;
      });
    },
    "open-day": async () => {
      const y = lastPlanDay();
      if (!y) return;
      await busy("Loading", async () => {
        await X.loadDay(y.date);
        S.cur = S.checkins.find((c) => c.id === y.plan_checkin_id) || S.checkins.find((c) => !c.is_test) || S.cur;
        S.g = 0; S.e = 0; S.msg = null;
        go("summary");
      });
    },
    "start": async () => {
      await busy("Starting", async () => {
        const r = await fn("checkin-open", { start: true });
        S.ui.checkinId = r.checkin.id;
        await X.loadDay(H.today);
        S.cur = S.checkins.find((c) => c.id === r.checkin.id) || r.checkin;
        S.shots = [];
        S.msg = null;
        go(S.cur.answered_at ? "home" : "checkin");
      });
    },
    "followup": (el) => {
      S.followup = S.pending.find((f) => f.id === el.dataset.id) || S.pending[0];
      S.cur = S.checkins.find((c) => c.id === S.followup.checkin_id) || S.cur;
      go("followup");
    },
    "block": (el) => {
      const c = S.checkins.find((x) => x.id === el.dataset.c);
      if (!c) return;
      S.cur = c; S.g = Number(el.dataset.g); S.e = 0;
      go("group");
    },
  };
  function bind() {
    $$("[data-h]").forEach((el) => el.addEventListener("click", (ev) => {
      const a = actions[el.dataset.h];
      if (!a) return;
      if (el.dataset.h === "close-cancel" && ev.target !== el) return;
      ev.stopPropagation();
      a(el);
    }));
  }

  /** Called whenever the app moves to the home screen: the day is read again, never kept. */
  function enter() { H.sheet = false; H.open = false; H.choice = {}; H.verify = null; load(); }

  // Coming back to the app: the date may have changed, and so may the day.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || S.view !== "home" || !S.session) return;
    if (X.denverDate() !== S.date) { try { await X.loadDay(X.denverDate()); } catch { /* shown on the next load */ } }
    go("home");
  });

  window.PlannerViews = Object.assign(window.PlannerViews || {}, { "home-today": { enter, render: view, bind } });
  // If the app reached the home screen before this file had loaded, show it now.
  if (S.view === "home" && S.session) { enter(); render(); }
})();
