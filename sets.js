// The block screen: each exercise of a block with its sets, every one editable (reps, or time in
// minutes and seconds, weight, band), sets added and removed, each change saved as it is made
// through one backend call that keeps what was planned beside what was done.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, busy, go, render, tierBox, S } = X;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // lib: every version of every library exercise; reasons: one reason per block for a past or saved day.
  const E = { lib: null, bands: [], reasons: {}, status: "", picker: null };

  // ---------- what a set is ----------
  async function loadLibrary() {
    if (E.lib) return;
    const [lib, bands] = await Promise.all([
      sb.from("library_exercises").select("key, mode, sets, reps, seconds, load_lb, band, effective_from, created_at").order("created_at", { ascending: true }),
      sb.from("effective_bands").select("name, position, retired_at"),
    ]);
    if (lib.error || bands.error) throw new Error("Could not load the exercises.");
    E.lib = lib.data || [];
    E.bands = (bands.data || []).filter((b) => !b.retired_at).sort((a, b) => a.position - b.position).map((b) => b.name);
  }
  /** The library's version of an exercise that was in force on the plan's day (or its first version, for an older plan). */
  function libraryFor(key, date) {
    const rows = (E.lib || []).filter((r) => r.key === key);
    const inForce = rows.filter((r) => r.effective_from <= date);
    return inForce.length ? inForce[inForce.length - 1] : rows[0] || null;
  }
  const clean = (v) => ({ reps: v.reps ?? null, seconds: v.seconds ?? null, load_lb: v.load_lb == null ? 0 : Number(v.load_lb), band: v.band || null });
  /** The sets a plan's exercise starts from: the plan's own if it carries them, else the library's, else one timed set. */
  function planned(ex, date) {
    if (Array.isArray(ex.sets) && ex.sets.length) return { mode: ex.mode || (ex.sets[0].seconds != null ? "time" : "reps"), sets: ex.sets.map(clean) };
    const row = libraryFor(ex.key, date);
    if (row && row.mode !== "prep") return { mode: row.mode, sets: Array.from({ length: row.sets || 1 }, () => clean(row)) };
    return { mode: "time", sets: [clean({ seconds: Math.max(1, Number(ex.minutes) || 1) * 60 })] };
  }
  const fromEvent = (e, prefix) => clean({ reps: e[prefix + "_reps"], seconds: e[prefix + "_seconds"], load_lb: e[prefix + "_load_lb"], band: e[prefix + "_band"] });
  const has = (e, prefix) => ["_reps", "_seconds", "_load_lb", "_band"].some((k) => e[prefix + k] != null);

  /** Replays the set changes of one exercise over its planned sets. */
  function setsOf(plan, gi, ei, ex, exState) {
    const p = planned(ex, S.date);
    const sets = p.sets.map((s) => ({ planned: s, actual: { ...s }, done: false, own: false, removed: false }));
    for (const e of S.events[plan.id] || []) {
      if (e.group_index !== gi || e.exercise_index !== ei || e.set_index == null) continue;
      const i = e.set_index;
      if (e.kind === "set_add") { sets[i] = { planned: has(e, "planned") ? fromEvent(e, "planned") : fromEvent(e, "actual"), actual: fromEvent(e, "actual"), done: false, own: true, removed: false, added: true }; continue; }
      const s = sets[i];
      if (!s) continue;
      if (e.kind === "set_remove") s.removed = true;
      else if (e.kind === "set_edit") { if (has(e, "actual")) s.actual = fromEvent(e, "actual"); }
      else if (e.kind === "set_done") { s.done = true; s.own = true; if (has(e, "actual")) s.actual = fromEvent(e, "actual"); }
      else if (e.kind === "set_undone") { s.done = false; s.own = true; }
    }
    // An exercise recorded as done as a whole counts every set that was not recorded on its own.
    sets.forEach((s) => { if (s && !s.own && exState === "done") s.done = true; });
    return { mode: p.mode, sets };
  }
  const live = (sets) => sets.map((s, i) => ({ s, i })).filter((x) => x.s && !x.s.removed);

  // ---------- the screen ----------
  function current() {
    const plan = X.planFor(S.cur), g = plan && X.groupsOf(plan)[S.g];
    return { plan, g };
  }
  function timeFields(v, ei, si) {
    const sec = Math.round(v.seconds || 0);
    return `<input type="number" inputmode="numeric" min="0" value="${Math.floor(sec / 60) || ""}" placeholder="0" data-k="mm" data-e="${ei}" data-i="${si}" aria-label="minutes"> min
      <input type="number" inputmode="numeric" min="0" value="${sec % 60 || ""}" placeholder="0" data-k="ss" data-e="${ei}" data-i="${si}" aria-label="seconds"> s
      <input type="number" inputmode="numeric" min="0" value="${v.reps ?? ""}" placeholder="–" data-k="r" data-e="${ei}" data-i="${si}" aria-label="reps, optional"> reps`;
  }
  function setRow(mode, s, ei, si, n, canRemove) {
    const v = s.actual;
    return `<li class="set ${s.done ? "done" : ""}"><button class="ring ${s.done ? "full" : ""}" data-s="done" data-e="${ei}" data-i="${si}" aria-label="set ${n}${s.done ? ", done" : ""}">${s.done ? "✓" : n}</button>
      <div class="f">${mode === "reps" ? `<input type="number" inputmode="numeric" min="0" value="${v.reps ?? ""}" data-k="r" data-e="${ei}" data-i="${si}" aria-label="reps"> reps` : timeFields(v, ei, si)}
        <input type="number" inputmode="decimal" min="0" step="0.5" value="${Number(v.load_lb) || 0}" data-k="w" data-e="${ei}" data-i="${si}" aria-label="weight in lb"> lb
        <select data-k="band" data-e="${ei}" data-i="${si}" aria-label="band"><option value="">no band</option>${E.bands.map((b) => `<option value="${esc(b)}"${v.band === b ? " selected" : ""}>${esc(b)}</option>`).join("")}${v.band && !E.bands.includes(v.band) ? `<option value="${esc(v.band)}" selected>${esc(v.band)}</option>` : ""}</select></div>
      ${canRemove ? `<button class="x" data-s="rm" data-e="${ei}" data-i="${si}" aria-label="remove set ${n}">−</button>` : "<span></span>"}</li>`;
  }
  function view() {
    const { plan, g } = current();
    if (!g) return tierBox("plain", "Plan", "Nothing to show.");
    if (!E.lib) return tierBox("plain", g.name, "Loading.");
    const p = X.progress(plan);
    const past = S.date !== X.denverDate();
    return `<div class="crumb"><button data-act="go-summary">‹ Plan</button><span class="pos">${esc(g.name)} · ${g.minutes} min</span></div>
      ${past || p.saved ? `<p class="muted">${past ? "A past day" : "A saved workout"}: the first change asks for a reason, once.</p>` : ""}
      <div class="stack">${g.exercises.map((ex, ei) => {
        const st = p.st[`${S.g}.${ei}`] || "";
        const x = setsOf(plan, S.g, ei, ex, st), rows = live(x.sets);
        return `<div class="blk exc ${st === "done" ? "isdone" : ""} ${st === "skip" ? "isskip" : ""}">
          <div class="nm"><button class="link" data-act="open-exercise" data-e="${ei}">${esc(ex.name)}</button><span class="tmpl">${x.mode}</span>${st === "done" ? '<span class="tmpl on">done</span>' : st === "skip" ? '<span class="tmpl">skipped</span>' : ""}</div>
          ${ex.prescription ? `<div class="cue">Plan: ${esc(ex.prescription)}</div>` : ""}
          <ul class="sets">${rows.map((r, n) => setRow(x.mode, r.s, ei, r.i, n + 1, rows.length > 1)).join("")}</ul>
          <button class="addset" data-s="add" data-e="${ei}">+ set</button></div>`;
      }).join("")}
      ${(p.extras[S.g] || []).map((a) => { const x = a.added_exercise || {}; return `<div class="blk exc isdone"><div class="nm">${esc(x.name || "added")}<span class="tmpl on">${a.kind === "exercise_add" ? "from the library" : "added by you"}</span></div>${x.sets ? `<div class="cue">Done: ${x.sets.length} x ${x.sets[0] && x.sets[0].seconds != null ? dur(x.sets[0].seconds) : (x.sets[0] ? x.sets[0].reps : "")}</div>` : ""}</div>`; }).join("")}</div>
      <div class="muted" id="set-status" aria-live="polite">${esc(E.status)}</div>
      <div class="foot col"><button class="btn primary" data-s="block-done">Done with this block</button>
        <button class="btn" data-s="add-lib">+ Add from the library</button>
        <button class="btn quiet" data-s="block-skip">Skip the rest, with a reason</button></div>
      ${picker()}`;
  }

  // ---------- the library picker (D75) ----------
  function picker() {
    const p = E.picker;
    if (!p) return "";
    const groups = {};
    (p.lib || []).forEach((e) => { (groups[e.group] = groups[e.group] || []).push(e); });
    return `<div class="sheetbg" data-s="pick-cancel"></div><div class="sheet on" role="dialog" aria-modal="true"><div class="h2">${esc(p.title)}</div>
      <label class="tog"><input type="checkbox" id="keepTomorrow" ${p.keep ? "checked" : ""}> Also keep it in this block from tomorrow</label>
      <div class="pick">${Object.keys(groups).map((g) => `<div class="pg">${esc(g.replace(/_/g, " "))}</div>${groups[g].map((e) => `<button data-s="pick" data-k="${esc(e.key)}">${esc(e.name)}<small> ${esc(e.words)}</small></button>`).join("")}`).join("")}</div>
      <div class="acts"><button class="btn sm" data-s="pick-cancel">Cancel</button></div></div>`;
  }
  async function libraryList() {
    const [ex, blocks] = await Promise.all([
      sb.from("effective_library_exercises").select("key, name, block_key, mode, sets, reps, seconds, load_lb, band, cues, watch_for, done_when, position").eq("excluded", false).neq("mode", "prep").order("position"),
      sb.from("effective_library_blocks").select("key, group_key").is("retired_at", null),
    ]);
    if (ex.error || blocks.error) throw new Error("Could not load the library.");
    const groupOf = {}; (blocks.data || []).forEach((b) => { groupOf[b.key] = b.group_key; });
    return (ex.data || []).map((e) => ({ ...e, group: groupOf[e.block_key] || "other", words: e.mode === "reps" ? `${e.sets} x ${e.reps ?? 0}` : `${e.sets} x ${dur(e.seconds || 0)}` }));
  }

  // ---------- saving ----------
  /** A past day or a saved workout needs a reason: asked once per block, then reused. */
  function reasonFor(plan) {
    if (S.date === X.denverDate() && !X.progress(plan).saved) return { ok: true, reason: undefined };
    const key = `${plan.id}.${S.g}`;
    if (!E.reasons[key]) {
      const r = (window.prompt("Changing a past or saved workout. Reason?", "") || "").trim();
      if (!r) return { ok: false };
      E.reasons[key] = r;
    }
    return { ok: true, reason: E.reasons[key] };
  }
  function say(text) { E.status = text; const el = $("#set-status"); if (el) el.textContent = text; }
  async function send(plan, body, quiet) {
    const why = reasonFor(plan);
    if (!why.ok) return false;
    try {
      const r = await fn("set-event", { plan_id: plan.id, group_index: S.g, reason: why.reason, ...body });
      (S.events[plan.id] = S.events[plan.id] || []).push(...(r.events || []));
      S.err = null;
      if (!quiet) render();
      return true;
    } catch (e) {
      S.err = e.message || String(e);
      render();
      return false;
    }
  }
  const words = (mode, v) => (mode === "reps" ? `${v.reps ?? 0} reps` : dur(v.seconds)) + ` · ${Number(v.load_lb) || 0} lb${v.band ? " + " + v.band + " band" : ""}`;
  function dur(sec) { sec = Math.round(sec || 0); const m = Math.floor(sec / 60), s = sec % 60; return m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`; }

  function at(el) {
    const { plan, g } = current();
    const ei = Number(el.dataset.e), si = el.dataset.i == null ? null : Number(el.dataset.i);
    const st = X.progress(plan).st[`${S.g}.${ei}`] || "";
    const x = setsOf(plan, S.g, ei, g.exercises[ei], st);
    return { plan, ei, si, st, x, set: si == null ? null : x.sets[si], name: g.exercises[ei].name };
  }
  const actions = {
    /** A tap on a set's ring: done, or open again. The last set done records the exercise as done. */
    "done": async (el) => {
      const c = at(el), rows = live(c.x.sets), doneNow = !c.set.done;
      if (!doneNow) {
        // Sets that only counted as done because the whole exercise was checked are recorded first, so they stay done.
        for (const r of rows) if (r.i !== c.si && r.s.done && !r.s.own) { if (!(await send(c.plan, { exercise_index: c.ei, set_index: r.i, kind: "set_done", planned: r.s.planned, actual: r.s.actual }, true))) return; }
      }
      const allDone = doneNow && rows.every((r) => r.i === c.si || r.s.done);
      const exercise = allDone && c.st !== "done" ? "done" : (!doneNow && c.st === "done" ? "open" : undefined);
      E.status = `${c.name}, set ${rows.findIndex((r) => r.i === c.si) + 1}: ${doneNow ? "done, " + words(c.x.mode, c.set.actual) : "open again"}.`;
      await send(c.plan, { exercise_index: c.ei, set_index: c.si, kind: doneNow ? "set_done" : "set_undone", planned: c.set.planned, actual: c.set.actual, exercise });
    },
    "rm": async (el) => {
      const c = at(el), rows = live(c.x.sets);
      if (rows.length < 2) return;
      const rest = rows.filter((r) => r.i !== c.si);
      const exercise = c.st !== "done" && rest.every((r) => r.s.done) ? "done" : undefined;
      E.status = `${c.name}: set removed.`;
      await send(c.plan, { exercise_index: c.ei, set_index: c.si, kind: "set_remove", planned: c.set.planned, actual: c.set.actual, exercise });
    },
    "add": async (el) => {
      const c = at(el), rows = live(c.x.sets);
      const last = rows.length ? rows[rows.length - 1].s.actual : clean({});
      E.status = `${c.name}: set added.`;
      await send(c.plan, { exercise_index: c.ei, set_index: c.x.sets.length, kind: "set_add", planned: last, actual: last, exercise: c.st === "done" ? "open" : undefined });
    },
    /** Every exercise not yet decided is recorded as done, as it stands on the screen. */
    "block-done": async () => {
      const { plan, g } = current();
      const why = reasonFor(plan);
      if (!why.ok) return;
      await busy("Checking off", async () => {
        const p = X.progress(plan);
        for (let ei = 0; ei < g.exercises.length; ei++) {
          if (p.st[`${S.g}.${ei}`]) continue;
          const r = await fn("event", { plan_id: plan.id, group_index: S.g, exercise_index: ei, kind: "check", reason: why.reason });
          (S.events[plan.id] = S.events[plan.id] || []).push(r.event);
        }
        E.status = "";
        if (S.g < X.groupsOf(plan).length - 1) S.g++;
        go("summary");
      });
    },
    "add-lib": async () => {
      const { g } = current();
      await busy("Loading the library", async () => { E.picker = { title: `Add to ${g.name} today`, lib: await libraryList(), keep: false }; });
    },
    "pick-cancel": () => { E.picker = null; render(); },
    "pick": async (el) => {
      const { plan, g } = current();
      const e = (E.picker.lib || []).find((x) => x.key === el.dataset.k);
      if (!e) return;
      const keep = !!($("#keepTomorrow") && $("#keepTomorrow").checked);
      const why = reasonFor(plan);
      if (!why.ok) return;
      await busy("Adding", async () => {
        const done = { key: e.key, name: e.name, mode: e.mode, sets: Array.from({ length: e.sets || 1 }, () => ({ reps: e.reps ?? null, seconds: e.seconds ?? null, load_lb: Number(e.load_lb) || 0, band: e.band || null })) };
        const r = await fn("event", { plan_id: plan.id, group_index: S.g, kind: "exercise_add", group_key: g.group_key || null, added_exercise: done, reason: why.reason });
        (S.events[plan.id] = S.events[plan.id] || []).push(r.event);
        let kept = "";
        if (keep && g.key) {
          try {
            await fn("rules-update", { op: "exercise", reason: `added to ${g.name} from the workout`, apply: "tomorrow", exercise: { name: e.name, block_key: g.key, mode: e.mode, sets: e.sets, reps: e.reps, seconds: e.seconds, load_lb: e.load_lb, band: e.band, cues: e.cues, watch_for: e.watch_for, done_when: e.done_when } });
            kept = `, and kept in ${g.name} from tomorrow`;
          } catch (err) { kept = `; not kept in the block (${err.message || "that did not go through"})`; }
        }
        E.picker = null;
        E.status = `${e.name} added as done today${kept}.`;
      });
    },
    "block-skip": async () => {
      const { plan } = current();
      const reason = (window.prompt("Skip what is left of this block. Reason?", "") || "").trim();
      if (!reason) return;
      await busy("Skipping", async () => {
        const r = await fn("event", { plan_id: plan.id, group_index: S.g, kind: "skip", reason });
        (S.events[plan.id] = S.events[plan.id] || []).push(r.event);
        E.status = "";
        go("summary");
      });
    },
  };
  /** A field changed: the whole set is saved as it now reads. The screen is not redrawn, so typing is not interrupted. */
  async function edited(el) {
    const c = at(el);
    if (!c.set) return;
    const row = el.closest(".set"), val = (k) => { const i = row.querySelector(`[data-k="${k}"]`); return i ? i.value : null; };
    const num = (v) => (v === null || v === "" ? null : Math.max(0, Number(v) || 0));
    const actual = { ...c.set.actual };
    if (val("mm") !== null) actual.seconds = Math.round((num(val("mm")) || 0) * 60 + (num(val("ss")) || 0));
    if (val("r") !== null) actual.reps = num(val("r")) === null ? null : Math.round(num(val("r")));
    if (val("w") !== null) actual.load_lb = num(val("w")) || 0;
    if (val("band") !== null) actual.band = val("band") || null;
    if (JSON.stringify(actual) === JSON.stringify(c.set.actual)) return;
    const ok = await send(c.plan, { exercise_index: c.ei, set_index: c.si, kind: "set_edit", planned: c.set.planned, actual }, true);
    if (ok) say(`${c.name}: saved ${words(c.x.mode, actual)} (planned ${words(c.x.mode, c.set.planned)}).`);
  }

  function bind() {
    $$("[data-s]").forEach((el) => el.addEventListener("click", (ev) => { const a = actions[el.dataset.s]; if (a) { ev.stopPropagation(); a(el); } }));
    $$(".set [data-k]").forEach((el) => el.addEventListener("change", () => edited(el)));
  }
  function enter() {
    E.status = "";
    if (E.lib) return;
    loadLibrary().catch((e) => { S.err = e.message || String(e); E.lib = E.lib || []; }).finally(() => { if (S.view === "group") render(); });
  }

  window.PlannerViews = Object.assign(window.PlannerViews || {}, { group: { enter, render: view, bind } });
  if (S.view === "group" && S.session) { enter(); render(); }
})();
