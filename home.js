// The home screen for today: what day it is, where the last plan day ended, and what is next.
// Everything shown comes from one read of the signed-in session's own days; the two writes
// (start today, close a past day) each go through one backend call.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, busy, go, render, tierBox, S } = X;
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const H = { today: null, days: [], loaded: false, loading: false, open: false, sheet: false, swept: null };

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
    const done = names(y.blocks, "done"), open = names(y.blocks, "open"), skipped = names(y.blocks, "skip");
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
  function sheet() {
    const y = lastPlanDay();
    if (!H.sheet || !y) return "";
    const open = y.blocks.filter((b) => b.status === "open");
    return `<div class="sheetbg" data-h="close-cancel"></div><div class="sheet on" role="dialog" aria-modal="true">
      <div class="h2">Close ${y.date === dayBefore(H.today) ? "yesterday" : esc(X.niceDate(y.date))}</div>
      <p class="muted">What is left from ${esc(longDate(y.date).split(",")[0])}. One more tap marks these as skipped. Nothing is ever marked done for you; to record something as done, open the day instead.</p>
      <div class="stack">${open.map((b) => `<div class="cellrow"><span>${esc(b.name)}</span><span class="tmpl">skip</span></div>`).join("")}</div>
      <div class="acts"><button class="btn sm" data-h="close-cancel">Cancel</button><button class="btn sm dark" data-h="close-save">Close the day</button></div></div>`;
  }

  // ---------- the four states ----------
  function view() {
    if (!H.loaded) return tierBox("plain", "Planner", "Loading.");
    const t = todayRow();
    const state = !t ? "new" : t.state;
    const pendingFollowup = S.pending && S.pending.length ? S.pending[0] : null;
    const sub = { new: "Nothing started yet today", checkin_open: `Check-in #${t ? t.first_checkin_number : 1} is open`, pending: "Answered, plan pending", in_progress: t ? `Plan in progress, ${t.blocks_done + t.blocks_skipped} of ${t.blocks_total} blocks done` : "", done: "Done for today" }[state];
    let body = "", foot = "";

    if (state === "new") {
      foot = `<button class="btn primary big" data-h="start">Start today</button>`;
    } else if (state === "checkin_open") {
      foot = `<button class="btn primary big" data-act="open-checkin" data-id="${t.first_checkin_id}">Continue check-in #${t.first_checkin_number}</button>`;
    } else if (state === "pending") {
      foot = pendingFollowup
        ? `<button class="btn primary big" data-h="followup">Answer one question</button>`
        : `<button class="btn primary big" data-act="resume-plan" data-id="${t.first_checkin_id}">Get my plan</button>`;
    } else {
      const next = t.blocks.find((b) => b.status === "open");
      if (state === "in_progress") {
        body = `${tierBox(t.tier || "plain", t.tier_line || "Today's plan", `${t.window_minutes != null ? `Window ${t.window_minutes} minutes. ` : ""}Next up: ${next ? next.name : "nothing"}.`)}
          ${t.note ? `<p class="muted" style="margin:0 6px 8px">${esc(t.note)}</p>` : ""}
          <ul class="rows">${t.blocks.map((b) => `<li class="row ${b.status === "done" ? "done" : ""} ${b.status === "skip" ? "skip" : ""} ${next && b === next ? "cur" : ""}" data-h="block" data-c="${b.checkin_id}" data-g="${b.group_index}">
            <div class="ring ${b.status === "done" ? "full" : ""}">${b.status === "done" ? "✓" : b.status === "skip" ? "–" : `${b.done + b.skipped}/${b.exercises}`}</div><div><div class="name">${esc(b.name)}</div><div class="short">${b.status === "open" ? "open" : b.status === "skip" ? "skipped" : "done"}</div></div><div class="min">${b.minutes ?? ""}</div></li>`).join("")}</ul>`;
      } else {
        const skipped = names(t.blocks, "skip");
        body = tierBox("green", "Done for today", t.blocks_total ? `${t.total_minutes} minutes planned, ${t.minutes_done} done${skipped.length ? `, ${skipped.join(", ")} skipped` : ""}.` : "Nothing planned today.");
      }
      const nextNumber = (S.checkins.length ? S.checkins[S.checkins.length - 1].number : t.checkins) + 1;
      foot = `<button class="btn ${state === "in_progress" ? "primary" : ""}" data-act="open-plan" data-id="${t.blocks.length ? t.blocks[0].checkin_id : t.first_checkin_id}">Open today's plan</button>
        ${S.calendar && S.calendar.length ? `<button class="btn quiet" data-act="go-calendar">Today's Calendar</button>` : ""}
        <button class="btn quiet" data-act="start-checkin">Check-in #${nextNumber}</button>`;
    }
    const collapsed = state === "in_progress" || state === "done";
    return `<div class="date"><div class="d">${esc(longDate(H.today))}</div><div class="s">${esc(sub)}</div></div>
      ${card(collapsed)}${body}
      <div class="foot col">${foot}</div>${sheet()}`;
  }

  // ---------- events ----------
  const actions = {
    "card-toggle": () => { H.open = !H.open; render(); },
    "close-ask": () => { H.sheet = true; S.err = null; render(); },
    "close-cancel": () => { H.sheet = false; render(); },
    "close-save": async () => {
      const y = lastPlanDay();
      if (!y) return;
      await busy("Closing", async () => {
        const r = await fn("day-close", { date: y.date });
        H.sheet = false;
        await read();
        const n = (r.closed && r.closed[0] && r.closed[0].skipped) || 0;
        S.msg = `Closed: ${n} skipped. Nothing was marked done.`;
      });
    },
    "open-day": async () => {
      const y = lastPlanDay();
      if (!y) return;
      await busy("Loading", async () => {
        await X.loadDay(y.date);
        S.cur = S.checkins.find((c) => y.blocks.length && c.id === y.blocks[0].checkin_id) || S.checkins.find((c) => !c.is_test) || S.cur;
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
    "followup": () => { S.followup = S.pending[0]; S.cur = S.checkins.find((c) => c.id === S.followup.checkin_id) || S.cur; go("followup"); },
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
  function enter() { H.sheet = false; H.open = false; load(); }

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
