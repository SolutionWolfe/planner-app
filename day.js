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

  // extras: what was added from the library that day (on a block or on the day); sets: the changes to their sets; reason: one reason per past day, asked once.
  // added: whole blocks added that day (blocks.js); all: every events row on the day, for their state.
  const D = { date: null, row: null, values: null, extras: [], sets: [], notes: [], added: [], all: [], picker: null, loaded: false, reason: null };
  const extrasApi = () => X.extras || null;
  const blocksApi = () => X.blocks || null;

  async function load() {
    D.date = S.date;
    D.loaded = false;
    D.reason = null;
    const [row, days, ev] = await Promise.all([
      sb.from("day_summary").select("*").eq("date", D.date).maybeSingle(),
      fn("oura-pull", { action: "days", from: D.date, to: D.date }).catch(() => ({ days: [] })),
      sb.from("events").select("*").eq("date", D.date).order("created_at"),
      extrasApi() ? extrasApi().ready().catch(() => null) : null,
    ]);
    D.row = row.data || null;
    D.values = (days.days || [])[0] || null;
    const rows = ev.data || [];
    D.all = rows;
    D.added = rows.filter((e) => e.kind === "block_add");
    D.extras = rows.filter((e) => e.kind === "exercise_add" && !e.is_edit_of);
    D.sets = rows.filter((e) => e.is_edit_of && e.set_index != null);
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

  /** The plan's blocks from day_summary, then the blocks added that day, read from their own rows (so a day with no plan shows them too). */
  function blocks() {
    const r = D.row;
    const planned = r && Array.isArray(r.blocks) ? r.blocks.filter((b) => b.status !== "replaced" && b.group_index != null) : [];
    const api = blocksApi();
    const added = api ? D.added.map((a) => ({ a, s: api.state(a, D.all) })) : [];
    if (!planned.length && !added.length) return `<p class="muted">No plan that day.</p>`;
    const row = (b, attrs, extra) => `<li class="row ${b.status === "done" ? "done" : ""} ${b.status === "skip" ? "skip" : ""}" ${attrs}>
      <div class="ring ${b.status === "done" ? "full" : ""}">${b.status === "done" ? "✓" : b.status === "skip" ? "–" : `${b.done}/${b.exercises}`}</div>
      <div><div class="name">${esc(b.name)}</div><div class="short">${b.status === "done" ? "done" : b.status === "skip" ? "skipped" : "open"}${b.recorded_seconds ? ` · ${Math.round(b.recorded_seconds / 60)} min` : ""}${extra}</div></div>
      <div class="min">${esc(String(b.minutes ?? ""))}</div></li>`;
    return `<ul class="rows">${planned.map((b) => row(b, `data-d="block" data-c="${esc(b.checkin_id)}" data-g="${b.group_index}"`, "")).join("")}
      ${added.map(({ a, s }) => { const x = a.added_block || {}; return row({ ...s, name: x.name || "added", minutes: x.minutes }, `data-d="ablock" data-a="${esc(a.id)}"`, ` · added${x.group_key ? ", " + esc(String(x.group_key).replace(/_/g, " ")) : ""}`); }).join("")}</ul>`;
  }

  /** What was added from the library that day, each with its sets, editable like any other exercise. */
  function extras() {
    if (!D.extras.length) return "";
    const api = extrasApi();
    return `<div class="lab" style="margin-top:8px">Added that day</div><div class="stack">${D.extras.map((e) => api ? api.card(e, D.sets) : `<div class="blk exc isdone"><div class="nm">${esc((e.added_exercise || {}).name || "added")}</div></div>`).join("")}</div>`;
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
        ${blocksApi() ? `<button class="btn" data-d="add-block">+ Add a block</button>` : ""}
        <button class="btn" data-d="add">+ Add something done that day</button>
        <div class="q"><div class="lab">Note for the day</div><textarea class="txt" id="dayNote" rows="2" placeholder="Anything worth remembering about this day">${esc(note)}</textarea>
          <button class="btn" data-d="save-note">Save the note</button></div>
        ${past() ? `<p class="muted">A past day: a change asks for a reason.</p>` : ""}
      </div>
      ${picker()}`;
  }

  // ---------- the library picker (the list, the card and the set editor come from sets.js) ----------
  function picker() {
    const p = D.picker;
    if (!p) return "";
    if (p.kind === "block") return blocksApi().sheet(p.lib, "data-d", `Add a block ${past() ? "done that day" : "to today"}`);
    return `<div class="sheetbg" data-d="pick-cancel"></div><div class="sheet on" role="dialog" aria-modal="true"><div class="h2">${esc(p.title)}</div>
      <div class="pick">${extrasApi().pickList(p.lib, "data-d", true)}</div>
      <div class="acts"><button class="btn sm" data-d="pick-cancel">Cancel</button></div></div>`;
  }
  /** A change to a past day needs a reason: asked once per visit to the day. */
  function reasonFor() {
    if (!past()) return { ok: true, reason: undefined };
    if (!D.reason) {
      const r = (window.prompt("Changing a past day. Reason?", "") || "").trim();
      if (!r) return { ok: false };
      D.reason = r;
    }
    return { ok: true, reason: D.reason };
  }

  const actions = {
    block: (el) => {
      const c = S.checkins.find((x) => x.id === el.dataset.c);
      if (!c) return;
      S.cur = c; S.g = Number(el.dataset.g); S.e = 0;
      go("group");
    },
    add: () => { if (!extrasApi()) return; busy("Loading the library", async () => { D.picker = { title: `Add something done ${past() ? "that day" : "today"}`, lib: await extrasApi().library() }; }); },
    "add-block": () => { if (!blocksApi()) return; busy("Loading the library", async () => { D.picker = { kind: "block", lib: await blocksApi().library() }; }); },
    "pick-block-else": (el) => actions["pick-block"](el),
    "pick-block": (el) => {
      const r = blocksApi().chosen(D.picker.lib, el);
      if (r.error) { S.err = r.error; render(); return; }
      const why = reasonFor();
      if (!why.ok) return;
      busy("Adding the block", async () => {
        // Today's add belongs to today's plan when there is one; a past day's add stands on the day.
        const plan = !past() && D.row && S.plans ? S.plans[D.row.plan_checkin_id] : null;
        const a = await blocksApi().add(D.date, plan ? plan.id : null, r.block, why.reason);
        D.added.push(a); D.all.push(a); D.picker = null;
        S.msg = `${r.block.name} added${past() ? " as done" : ""}. Tap it to change its sets.`;
      });
    },
    ablock: (el) => busy("Loading", async () => { await blocksApi().openScreen(el.dataset.a, "day"); }),
    "pick-cancel": () => { D.picker = null; render(); },
    "pick-else": (el) => actions.pick(el),
    pick: (el) => {
      let e;
      if (el.dataset.d === "pick-else") { const r = extrasApi().elseEntry(); if (r.error) { S.err = r.error; render(); return; } e = r.e; }
      else e = (D.picker.lib || []).find((x) => x.key === el.dataset.k);
      if (!e) return;
      const why = reasonFor();
      if (!why.ok) return;
      busy("Saving", async () => {
        const r = await fn("event", { date: D.date, kind: "exercise_add", group_key: e.group, added_exercise: extrasApi().doneAs(e), reason: why.reason });
        D.extras.push(r.event); D.picker = null;
        S.msg = `${e.name} added as done. Change its sets below if they were different.`;
      });
    },
    "save-note": () => {
      const text = ($("#dayNote").value || "").trim();
      if (!text) { S.err = "Type the note first."; render(); return; }
      const why = reasonFor();
      if (!why.ok) return;
      busy("Saving", async () => {
        const r = await fn("event", { date: D.date, kind: "day_note", note: text, reason: why.reason });
        D.notes.push(r.event);
        S.msg = "Note saved.";
      });
    },
  };
  function bind() {
    $$("[data-d]").forEach((el) => el.addEventListener("click", (ev) => { const a = actions[el.dataset.d]; if (!a) return; if (el.dataset.d === "pick-cancel" && ev.target !== el) return; ev.stopPropagation(); a(el); }));
    if (extrasApi()) extrasApi().bind({ adds: () => D.extras, events: () => D.sets, push: (rows) => { D.sets.push(...rows); }, reason: reasonFor });
  }

  window.PlannerViews = Object.assign(window.PlannerViews || {}, { day: { open: load, render: view, bind } });
})();
