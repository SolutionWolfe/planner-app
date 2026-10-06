// The Day view: any past day, or today. The night's values, the day's blocks and where each
// stands, anything added from the library that day, and a note. A block opens the block screen;
// something done that day and a note are each one backend call, with a reason on a past day.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, busy, go, render, tierBox, S, denverDate, niceDate } = X;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const D = { date: null, row: null, values: null, extras: [], notes: [], picker: null, loaded: false };

  async function load() {
    D.date = S.date;
    D.loaded = false;
    const [row, days, ev] = await Promise.all([
      sb.from("day_summary").select("*").eq("date", D.date).maybeSingle(),
      fn("oura-pull", { action: "days", from: D.date, to: D.date }).catch(() => ({ days: [] })),
      sb.from("events").select("*").eq("date", D.date).order("created_at"),
    ]);
    D.row = row.data || null;
    D.values = (days.days || [])[0] || null;
    const rows = ev.data || [];
    D.extras = rows.filter((e) => e.kind === "exercise_add");
    D.notes = rows.filter((e) => e.kind === "day_note");
    D.loaded = true;
  }

  const past = () => D.date !== denverDate();
  const fmt = (n, d = 0) => (n == null ? "" : Number(n).toFixed(d));

  function values() {
    const v = D.values;
    if (!v || (v.readiness == null && v.sleep == null && v.rest_hr == null)) return `<div class="vals"><div class="val" style="grid-column:1/-1"><b>Night</b><span>no data</span></div></div>`;
    return `<div class="vals">
      <div class="val"><b>Readiness</b><span>${esc(fmt(v.readiness))}</span></div>
      <div class="val"><b>Sleep</b><span>${esc(fmt(v.sleep))}</span></div>
      <div class="val"><b>Rest HR</b><span>${esc(fmt(v.rest_hr))}</span></div>
      <div class="val"><b>HRV</b><span>${esc(fmt(v.hrv))}</span></div>
      <div class="val"><b>Temp</b><span>${v.temp_f == null ? "" : (v.temp_f > 0 ? "+" : "") + esc(fmt(v.temp_f, 1)) + "°F"}</span></div>
    </div>`;
  }

  function blocks() {
    const r = D.row;
    if (!r || !r.blocks || !r.blocks.length) return `<p class="muted">No plan that day.</p>`;
    return `<ul class="rows">${r.blocks.filter((b) => b.status !== "replaced").map((b) => `<li class="row ${b.status === "done" ? "done" : ""} ${b.status === "skip" ? "skip" : ""}" data-d="block" data-c="${esc(b.checkin_id)}" data-g="${b.group_index}">
      <div class="ring ${b.status === "done" ? "full" : ""}">${b.status === "done" ? "✓" : `${b.done}/${b.exercises}`}</div>
      <div><div class="name">${esc(b.name)}</div><div class="short">${b.status === "done" ? "done" : b.status === "skip" ? "skipped" : "open"}${b.recorded_seconds ? ` · ${Math.round(b.recorded_seconds / 60)} min` : ""}</div></div>
      <div class="min">${esc(String(b.minutes || ""))}</div></li>`).join("")}</ul>`;
  }

  function extras() {
    if (!D.extras.length) return "";
    return `<ul class="rows">${D.extras.map((e) => { const a = e.added_exercise || {}; return `<li class="row done"><div class="ring full">✓</div><div><div class="name">${esc(a.name || "added")}</div><div class="short">done that day${e.group_key ? ` · ${esc(e.group_key.replace(/_/g, " "))}` : ""}</div></div><div class="min">+</div></li>`; }).join("")}</ul>`;
  }

  function view() {
    if (!D.loaded || D.date !== S.date) return tierBox("plain", niceDate(S.date || denverDate()), "Loading.");
    const title = past() ? niceDate(D.date) : "Today";
    const note = D.notes.length ? D.notes[D.notes.length - 1].note : "";
    return `${tierBox("plain", title, D.row && D.row.tier_line ? D.row.tier_line : "")}
      ${values()}
      <div class="lab" style="margin-top:8px">Plan that day</div>
      ${blocks()}
      ${extras()}
      <div class="stack">
        <button class="btn" data-d="add">+ Add something done that day</button>
        <div class="q"><div class="lab">Note for the day</div><textarea class="txt" id="dayNote" rows="2" placeholder="Anything worth remembering about this day">${esc(note)}</textarea>
          <button class="btn" data-d="save-note">Save the note</button></div>
        ${past() ? `<p class="muted">A past day: a change asks for a reason.</p>` : ""}
      </div>
      ${picker()}`;
  }

  // ---------- the library picker ----------
  function picker() {
    const p = D.picker;
    if (!p) return "";
    const groups = {};
    (p.lib || []).forEach((e) => { (groups[e.group] = groups[e.group] || []).push(e); });
    return `<div class="sheetbg" data-d="pick-cancel"></div><div class="sheet on" role="dialog" aria-modal="true"><div class="h2">${esc(p.title)}</div>
      <div class="pick">${Object.keys(groups).map((g) => `<div class="pg">${esc(g.replace(/_/g, " "))}</div>${groups[g].map((e) => `<button data-d="pick" data-k="${esc(e.key)}">${esc(e.name)}<small> ${esc(e.words)}</small></button>`).join("")}`).join("") || "<p class='muted'>Nothing in the library.</p>"}</div>
      <div class="acts"><button class="btn sm" data-d="pick-cancel">Cancel</button></div></div>`;
  }
  const dur = (s) => (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ""}` : `${s} s`);
  async function libraryList() {
    const [ex, blocks] = await Promise.all([
      sb.from("effective_library_exercises").select("key, name, block_key, mode, sets, reps, seconds, load_lb, band, position").eq("excluded", false).neq("mode", "prep").order("position"),
      sb.from("effective_library_blocks").select("key, group_key, name").is("retired_at", null),
    ]);
    if (ex.error || blocks.error) throw new Error("Could not load the library.");
    const groupOf = {}; (blocks.data || []).forEach((b) => { groupOf[b.key] = b.group_key; });
    return (ex.data || []).map((e) => ({ ...e, group: groupOf[e.block_key] || "other", words: e.mode === "reps" ? `${e.sets} x ${e.reps ?? 0}` : `${e.sets} x ${dur(e.seconds || 0)}` }));
  }
  /** What the library says the exercise is, as the sets it was done with. */
  function doneAs(e) {
    return { key: e.key, name: e.name, mode: e.mode, sets: Array.from({ length: e.sets || 1 }, () => ({ reps: e.reps ?? null, seconds: e.seconds ?? null, load_lb: Number(e.load_lb) || 0, band: e.band || null })) };
  }

  const actions = {
    block: (el) => {
      const c = S.checkins.find((x) => x.id === el.dataset.c);
      if (!c) return;
      S.cur = c; S.g = Number(el.dataset.g); S.e = 0;
      go("group");
    },
    add: () => busy("Loading the library", async () => { D.picker = { title: `Add something done ${past() ? "that day" : "today"}`, lib: await libraryList() }; }),
    "pick-cancel": () => { D.picker = null; render(); },
    pick: (el) => {
      const e = (D.picker.lib || []).find((x) => x.key === el.dataset.k);
      if (!e) return;
      let reason;
      if (past()) { reason = (window.prompt(`${e.name}, done ${niceDate(D.date)}. Reason for adding it now?`, "") || "").trim(); if (!reason) return; }
      busy("Saving", async () => {
        const r = await fn("event", { date: D.date, kind: "exercise_add", group_key: e.group, added_exercise: doneAs(e), reason });
        D.extras.push(r.event); D.picker = null;
        S.msg = `${e.name} added as done.`;
      });
    },
    "save-note": () => {
      const text = ($("#dayNote").value || "").trim();
      if (!text) { S.err = "Type the note first."; render(); return; }
      let reason;
      if (past()) { reason = (window.prompt("A note on a past day. Reason?", "") || "").trim(); if (!reason) return; }
      busy("Saving", async () => {
        const r = await fn("event", { date: D.date, kind: "day_note", note: text, reason });
        D.notes.push(r.event);
        S.msg = "Note saved.";
      });
    },
  };
  function bind() {
    $$("[data-d]").forEach((el) => el.addEventListener("click", (ev) => { const a = actions[el.dataset.d]; if (!a) return; if (el.dataset.d === "pick-cancel" && ev.target !== el) return; ev.stopPropagation(); a(el); }));
  }

  window.PlannerViews = Object.assign(window.PlannerViews || {}, { day: { open: load, render: view, bind } });
})();
