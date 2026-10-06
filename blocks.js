// A whole block added to a day: from the library, or Something else (a name, a group, minutes).
// On a closed day it is added as done, every exercise done with its sets open to change; on today
// it is added as open, to do now. One backend call writes the block; every tap on it afterwards is
// one more call that points at it. The picker and the screen are used by the Day view and by
// today's home screen.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, busy, go, render, tierBox, S, denverDate, niceDate } = X;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const ex = () => X.extras; // the set row and the replay helpers from sets.js

  // add: the block_add row on screen; events: the rows pointing at it; reason: one reason per visit to a past day; from: where back goes.
  const B = { add: null, events: [], loaded: false, reason: null, status: "", from: null };

  // ---------- the picker ----------
  /** The library's blocks by training group, each with its live exercises, and the groups for Something else. */
  async function library() {
    const [blocks, exs, groups] = await Promise.all([
      sb.from("effective_library_blocks").select("key, name, group_key, minutes, position").is("retired_at", null).order("position"),
      sb.from("effective_library_exercises").select("key, name, block_key, mode, sets, reps, seconds, load_lb, band, position").eq("excluded", false).neq("mode", "prep").order("position"),
      sb.from("effective_training_groups").select("key, name, position, retired_at").order("position"),
    ]);
    if (blocks.error || exs.error || groups.error) throw new Error("Could not load the library.");
    const live = (groups.data || []).filter((g) => !g.retired_at && g.key !== "prep");
    const order = {}; live.forEach((g, i) => { order[g.key] = i; });
    const list = (blocks.data || []).filter((b) => b.key !== "prep" && order[b.group_key] != null)
      .sort((a, b) => order[a.group_key] - order[b.group_key] || a.position - b.position)
      .map((b) => ({ ...b, group_name: live.find((g) => g.key === b.group_key).name, exercises: (exs.data || []).filter((e) => e.block_key === b.key) }));
    return { list, groups: live };
  }
  /** The sheet's body: the blocks group by group, then Something else. `attr` is the click attribute the screen binds. */
  function sheet(lib, attr, title) {
    const byGroup = [];
    lib.list.forEach((b) => { let g = byGroup.find((x) => x.key === b.group_key); if (!g) { g = { key: b.group_key, name: b.group_name, items: [] }; byGroup.push(g); } g.items.push(b); });
    const items = byGroup.map((g) => `<div class="pg">${esc(g.name)}</div>${g.items.map((b) => `<button ${attr}="pick-block" data-k="${esc(b.key)}">${esc(b.name)}<small> ${b.minutes ?? ""} min · ${b.exercises.length} exercise${b.exercises.length === 1 ? "" : "s"}</small></button>`).join("")}`).join("") || "<p class='muted'>No blocks in the library.</p>";
    return `<div class="sheetbg" ${attr}="pick-cancel"></div><div class="sheet on" role="dialog" aria-modal="true"><div class="h2">${esc(title)}</div>
      <div class="pick">${items}<div class="pg">Something else</div><div class="else">
        <input type="text" id="blkName" maxlength="80" placeholder="what you did" aria-label="what you did">
        <select id="blkGroup" aria-label="group">${lib.groups.map((g) => `<option value="${esc(g.key)}">${esc(g.name)}</option>`).join("")}</select>
        <label><input type="number" inputmode="numeric" min="0" id="blkMin" placeholder="0" aria-label="minutes"> min</label>
        <button ${attr}="pick-block-else">Add it</button></div></div>
      <div class="acts"><button class="btn sm" ${attr}="pick-cancel">Cancel</button></div></div>`;
  }
  /** The block to add: from the tapped library row, or from the Something else fields. { block } or { error }. */
  function chosen(lib, el) {
    if (el.dataset.k) {
      const b = lib.list.find((x) => x.key === el.dataset.k);
      if (!b) return { error: "Not in the library." };
      return { block: { key: b.key, name: b.name, group_key: b.group_key, minutes: b.minutes == null ? null : Number(b.minutes), exercises: b.exercises.map((e) => ex().doneAs(e)) } };
    }
    const name = (($("#blkName") || {}).value || "").trim();
    if (!name) return { error: "Say what you did first." };
    const min = Number(($("#blkMin") || {}).value) || 0;
    if (!(min > 0)) return { error: "Give it minutes." };
    return { block: { key: null, name, group_key: ($("#blkGroup") || {}).value || null, minutes: Math.round(min), exercises: [] } };
  }
  /** Writes the block: done on a past day, open on today. `planId` is the day's plan when there is one. */
  async function add(date, planId, block, reason) {
    const past = date !== denverDate();
    const r = await fn("event", { date, plan_id: planId || undefined, kind: "block_add", group_key: block.group_key || undefined, added_block: { ...block, done: past }, reason });
    return r.event;
  }

  // ---------- where an added block stands, from the rows pointing at it ----------
  function state(a, events) {
    const x = a.added_block || {}, list = Array.isArray(x.exercises) ? x.exercises : [];
    const rows = (events || []).filter((e) => e.is_edit_of === a.id);
    const blockRow = rows.filter((e) => e.exercise_index == null && e.set_index == null && (e.kind === "check" || e.kind === "skip")).slice(-1)[0];
    const fallback = blockRow ? blockRow.kind : (x.done ? "check" : null);
    const st = list.map((_, i) => {
      const own = rows.filter((e) => e.exercise_index === i && e.set_index == null && ["check", "uncheck", "skip"].includes(e.kind)).slice(-1)[0];
      const k = own ? own.kind : fallback;
      return k === "check" ? "done" : k === "skip" ? "skip" : "";
    });
    const done = st.filter((s) => s === "done").length, skipped = st.filter((s) => s === "skip").length;
    const status = !list.length ? (fallback === "check" ? "done" : fallback === "skip" ? "skip" : "open") : (done + skipped < list.length ? "open" : done > 0 ? "done" : "skip");
    const recorded = rows.filter((e) => e.exercise_index == null && e.kind === "check" && e.actual_seconds != null).slice(-1)[0];
    return { st, done, skipped, exercises: list.length, status, recorded_seconds: recorded ? recorded.actual_seconds : null };
  }
  /** The sets of one exercise of the block, replayed from the rows pointing at it. */
  function setsOf(a, i, events, exState) {
    const E = ex(), e = ((a.added_block || {}).exercises || [])[i] || {};
    const mode = e.mode === "reps" ? "reps" : "time";
    const base = (Array.isArray(e.sets) && e.sets.length ? e.sets : [{ seconds: 60 }]).map(E.clean);
    const sets = base.map((s) => ({ planned: s, actual: { ...s }, done: false, own: false, removed: false }));
    for (const r of events || []) {
      if (r.is_edit_of !== a.id || r.exercise_index !== i || r.set_index == null) continue;
      const k = r.set_index;
      if (r.kind === "set_add") { sets[k] = { planned: E.has(r, "planned") ? E.fromEvent(r, "planned") : E.fromEvent(r, "actual"), actual: E.fromEvent(r, "actual"), done: false, own: true, removed: false, added: true }; continue; }
      const s = sets[k];
      if (!s) continue;
      if (r.kind === "set_remove") s.removed = true;
      else if (r.kind === "set_edit") { if (E.has(r, "actual")) s.actual = E.fromEvent(r, "actual"); }
      else if (r.kind === "set_done") { s.done = true; s.own = true; if (E.has(r, "actual")) s.actual = E.fromEvent(r, "actual"); }
      else if (r.kind === "set_undone") { s.done = false; s.own = true; }
    }
    sets.forEach((s) => { if (s && !s.own && exState === "done") s.done = true; });
    return { mode, sets };
  }

  // ---------- the screen ----------
  async function open() {
    B.loaded = false; B.status = ""; B.reason = null;
    const id = S.ablockId;
    const [a, ev] = await Promise.all([
      sb.from("events").select("*").eq("id", id).maybeSingle(),
      sb.from("events").select("*").eq("is_edit_of", id).order("created_at"),
      ex().ready(),
    ]);
    if (a.error || !a.data) throw new Error("Could not load the block.");
    B.add = a.data; B.events = ev.data || []; B.loaded = true;
  }
  /** Opens the screen for one added block; `from` is where back goes ("home" or "day"). */
  async function openScreen(id, from) {
    S.ablockId = id; B.from = from;
    await open();
    go("ablock");
  }
  const past = () => !!B.add && B.add.date !== denverDate();
  function view() {
    if (!B.loaded || !B.add) return tierBox("plain", "Block", "Loading.");
    const E = ex(), x = B.add.added_block || {}, s = state(B.add, B.events), list = Array.isArray(x.exercises) ? x.exercises : [];
    const back = B.from === "home" ? `<button data-act="go-today">‹ Today</button>` : `<button data-b="back-day">‹ ${past() ? esc(niceDate(B.add.date)) : "Today"}</button>`;
    const where = x.group_key ? ` · ${esc(String(x.group_key).replace(/_/g, " "))}` : "";
    return `<div class="crumb">${back}<span class="pos">${esc(x.name || "added")} · ${x.minutes ?? "?"} min · added${where}</span></div>
      ${past() ? `<p class="muted">A past day: the first change asks for a reason, once.</p>` : ""}
      <div class="stack">${list.map((e, ei) => {
        const st = s.st[ei], r = setsOf(B.add, ei, B.events, st), rows = E.live(r.sets), tag = `data-a="${esc(B.add.id)}" data-e="${ei}"`;
        return `<div class="blk exc ${st === "done" ? "isdone" : ""} ${st === "skip" ? "isskip" : ""}">
          <div class="nm">${esc(e.name || "exercise")}<span class="tmpl">${r.mode}</span>${st === "done" ? '<span class="tmpl on">done</span>' : st === "skip" ? '<span class="tmpl">skipped</span>' : ""}</div>
          <ul class="sets">${rows.map((w, n) => E.setRow(r.mode, w.s, tag, w.i, n + 1, rows.length > 1)).join("")}</ul>
          <button class="addset" data-s="add" ${tag}>+ set</button></div>`;
      }).join("")}
      ${list.length ? "" : `<p class="muted">${s.status === "done" ? `Done${s.recorded_seconds ? `, ${E.dur(s.recorded_seconds)}` : ""}.` : s.status === "skip" ? "Skipped." : "Nothing listed for this block. Done records it with the time it took."}</p>`}</div>
      <div class="muted" id="ablock-status" aria-live="polite">${esc(B.status)}</div>
      <div class="foot col">${s.status === "open" ? `<button class="btn primary" data-b="block-done">Done with this block</button><button class="btn quiet" data-b="block-skip">Skip the rest, with a reason</button>` : ""}</div>`;
  }

  // ---------- saving ----------
  function reasonFor() {
    if (!past()) return { ok: true, reason: undefined };
    if (!B.reason) {
      const r = (window.prompt("Changing a past day. Reason?", "") || "").trim();
      if (!r) return { ok: false };
      B.reason = r;
    }
    return { ok: true, reason: B.reason };
  }
  function say(text) { B.status = text; const el = $("#ablock-status"); if (el) el.textContent = text; }
  /** One set change through set-event, pointing at the block. */
  async function send(body, quiet) {
    const why = reasonFor();
    if (!why.ok) return false;
    try {
      const r = await fn("set-event", { added_id: B.add.id, reason: why.reason, ...body });
      B.events.push(...(r.events || []));
      S.err = null;
      if (!quiet) render();
      return true;
    } catch (e) { S.err = e.message || String(e); render(); return false; }
  }
  /** One tap on an exercise of the block (check, uncheck, skip) through event, pointing at the block. */
  async function tap(body, reason) {
    try {
      const r = await fn("event", { date: B.add.date, plan_id: B.add.plan_id || undefined, is_edit_of: B.add.id, reason, ...body });
      B.events.push(r.event);
      S.err = null;
      return true;
    } catch (e) { S.err = e.message || String(e); render(); return false; }
  }
  function at(el) {
    const ei = Number(el.dataset.e), si = el.dataset.i == null ? null : Number(el.dataset.i);
    const st = state(B.add, B.events).st[ei] || "";
    const x = setsOf(B.add, ei, B.events, st);
    return { ei, si, st, x, set: si == null ? null : x.sets[si], name: (((B.add.added_block || {}).exercises || [])[ei] || {}).name || "exercise" };
  }
  const actions = {
    "done": async (el) => {
      const E = ex(), c = at(el), rows = E.live(c.x.sets), doneNow = !c.set.done;
      if (!doneNow) {
        for (const r of rows) if (r.i !== c.si && r.s.done && !r.s.own) { if (!(await send({ exercise_index: c.ei, set_index: r.i, kind: "set_done", planned: r.s.planned, actual: r.s.actual }, true))) return; }
      }
      const allDone = doneNow && rows.every((r) => r.i === c.si || r.s.done);
      const exercise = allDone && c.st !== "done" ? "done" : (!doneNow && c.st === "done" ? "open" : undefined);
      B.status = `${c.name}, set ${rows.findIndex((r) => r.i === c.si) + 1}: ${doneNow ? "done, " + E.words(c.x.mode, c.set.actual) : "open again"}.`;
      await send({ exercise_index: c.ei, set_index: c.si, kind: doneNow ? "set_done" : "set_undone", planned: c.set.planned, actual: c.set.actual, exercise });
    },
    "rm": async (el) => {
      const E = ex(), c = at(el), rows = E.live(c.x.sets);
      if (rows.length < 2) return;
      B.status = `${c.name}: set removed.`;
      await send({ exercise_index: c.ei, set_index: c.si, kind: "set_remove", planned: c.set.planned, actual: c.set.actual });
    },
    "add": async (el) => {
      const E = ex(), c = at(el), rows = E.live(c.x.sets);
      const last = rows.length ? rows[rows.length - 1].s.actual : E.clean({});
      B.status = `${c.name}: set added.`;
      await send({ exercise_index: c.ei, set_index: c.x.sets.length, kind: "set_add", planned: last, actual: last, exercise: c.st === "done" ? "open" : undefined });
    },
    /** Every exercise not yet decided is recorded as done; a block with nothing listed is done as a whole with its time. */
    "block-done": async () => {
      const why = reasonFor();
      if (!why.ok) return;
      const x = B.add.added_block || {}, list = Array.isArray(x.exercises) ? x.exercises : [];
      await busy("Checking off", async () => {
        if (!list.length) {
          const planned = x.minutes != null ? Math.round(Number(x.minutes) * 60) : null;
          const m = (window.prompt("How long did it take, in minutes?", x.minutes != null ? String(x.minutes) : "") || "").trim();
          if (m === "" || !(Number(m) >= 0)) return;
          await send({ kind: "block_done", planned: { seconds: planned }, actual: { seconds: Math.round(Number(m) * 60) }, reason: why.reason || "done" });
          B.status = "";
          return;
        }
        const s = state(B.add, B.events);
        for (let ei = 0; ei < list.length; ei++) { if (s.st[ei]) continue; if (!(await tap({ exercise_index: ei, kind: "check" }, why.reason))) return; }
        B.status = "";
      });
    },
    "block-skip": async () => {
      const reason = (window.prompt("Skip what is left of this block. Reason?", "") || "").trim();
      if (!reason) return;
      const x = B.add.added_block || {}, list = Array.isArray(x.exercises) ? x.exercises : [];
      await busy("Skipping", async () => {
        if (!list.length) { await tap({ kind: "skip" }, reason); return; }
        const s = state(B.add, B.events);
        for (let ei = 0; ei < list.length; ei++) { if (s.st[ei]) continue; if (!(await tap({ exercise_index: ei, kind: "skip" }, reason))) return; }
      });
    },
    "back-day": () => busy("Loading", async () => {
      if (S.date !== B.add.date) await X.loadDay(B.add.date);
      const dv = (window.PlannerViews || {}).day;
      if (dv) { await dv.open(); go("day"); } else go("home");
    }),
  };
  /** A field changed: the whole set is saved as it now reads. */
  async function edited(el) {
    const E = ex(), c = at(el);
    if (!c.set) return;
    const row = el.closest(".set"), val = (k) => { const i = row.querySelector(`[data-k="${k}"]`); return i ? i.value : null; };
    const num = (v) => (v === null || v === "" ? null : Math.max(0, Number(v) || 0));
    const actual = { ...c.set.actual };
    if (val("mm") !== null) actual.seconds = Math.round((num(val("mm")) || 0) * 60 + (num(val("ss")) || 0));
    if (val("r") !== null) actual.reps = num(val("r")) === null ? null : Math.round(num(val("r")));
    if (val("w") !== null) actual.load_lb = num(val("w")) || 0;
    if (val("band") !== null) actual.band = val("band") || null;
    if (JSON.stringify(actual) === JSON.stringify(c.set.actual)) return;
    const ok = await send({ exercise_index: c.ei, set_index: c.si, kind: "set_edit", planned: c.set.planned, actual }, true);
    if (ok) say(`${c.name}: saved ${E.words(c.x.mode, actual)}.`);
  }
  function bind() {
    $$("[data-s]").forEach((el) => el.addEventListener("click", (ev) => { const a = actions[el.dataset.s]; if (a) { ev.stopPropagation(); a(el); } }));
    $$("[data-b]").forEach((el) => el.addEventListener("click", (ev) => { const a = actions[el.dataset.b]; if (a) { ev.stopPropagation(); a(el); } }));
    $$(".set [data-k]").forEach((el) => el.addEventListener("change", () => edited(el)));
  }
  function enter() { B.status = ""; }

  X.blocks = { library, sheet, chosen, add, state, openScreen };
  window.PlannerViews = Object.assign(window.PlannerViews || {}, { ablock: { enter, render: view, bind, open } });
})();
