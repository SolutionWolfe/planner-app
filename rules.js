// Settings, Rules: thresholds, selection grid, library, note templates and history.
// Everything shown here is read from the signed-in session's own rows; every save goes through one
// backend call with a reason and takes effect tomorrow unless "today" is chosen.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { sb, fn, esc, busy, go, render, tierBox, S } = X;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const TIERS = ["green", "yellow", "red", "no_data"];
  const COLS = ["15", "25", "40", "60", "90", "120", "none"];
  const tierName = (t) => (t === "no_data" ? "no data" : t);
  const colName = (c) => (c === "none" ? "none" : c + " min");

  const R = { loaded: false, today: null, values: [], groups: [], blocks: [], exercises: [], exGroups: [], bands: [], cells: [], templates: [], goals: [], schedule: [], history: [], gridTab: "pt", phaseTab: null, libTab: null, tplTier: "green", sheet: null, tplDraft: {}, thrDraft: {}, noteDraft: {}, reason: "" };

  // ---------- data ----------
  const TABLES = {
    rule_values: (r) => r.key,
    training_groups: (r) => r.key,
    library_blocks: (r) => r.key,
    library_exercises: (r) => r.key,
    exercise_groups: (r) => r.exercise_key + "|" + r.group_key,
    bands: (r) => r.key,
    selection_cells: (r) => r.grid + "|" + r.tier + "|" + r.window_cell + "|" + (r.phase ?? ""),
    note_templates: (r) => r.tier,
    goals: (r) => r.key,
    schedule_days: (r) => r.goal_key + "|" + r.number + "|" + r.slot,
  };
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0);

  /** What the last save says, per key: the rows in force today, with anything saved for tomorrow on top. */
  async function current(table, today) {
    const keyOf = TABLES[table];
    const [now, later] = await Promise.all([
      sb.from("effective_" + table).select("*"),
      sb.from(table).select("*").gt("effective_from", today).order("created_at", { ascending: true }),
    ]);
    if (now.error || later.error) throw new Error("Could not load the rules.");
    const m = new Map((now.data || []).map((r) => [keyOf(r), r]));
    for (const r of later.data || []) { const cur = m.get(keyOf(r)); if (!cur || new Date(r.created_at) > new Date(cur.created_at)) m.set(keyOf(r), r); }
    return [...m.values()];
  }
  async function changes(table) {
    const { data, error } = await sb.from(table).select("*").neq("source", "seed").order("created_at", { ascending: false }).limit(60);
    if (error) throw new Error("Could not load the rules.");
    return data || [];
  }

  async function load() {
    R.today = X.denverDate();
    const [v, g, b, e, eg, bd, c, t, gl, sd] = await Promise.all(Object.keys(TABLES).map((x) => current(x, R.today)));
    R.values = v.sort(byPos);
    R.groups = g.sort(byPos);
    R.blocks = b.sort(byPos);
    R.exercises = e.sort(byPos);
    R.exGroups = eg.filter((r) => r.active);
    R.bands = bd.filter((r) => !r.retired_at).sort(byPos);
    R.cells = c;
    R.templates = t;
    R.goals = gl.sort(byPos);
    R.schedule = sd.filter((r) => !r.retired_at).sort((a, b) => a.number - b.number);
    R.noteDraft = {};
    if (!R.libTab || !liveGroups().some((x) => x.key === R.libTab)) R.libTab = (liveGroups()[0] || {}).key || null;
    if (R.gridTab !== "pt" && !sessionGroups().some((x) => x.key === R.gridTab)) R.gridTab = "pt";
    const ag = activeGoal();
    if (!ag) R.phaseTab = null; else if (!R.phaseTab || R.phaseTab > ag.phases) R.phaseTab = ag.phase;
    R.loaded = true;
  }
  async function loadHistory() {
    const [v, g, b, e, bd, c, t, gl, sd] = await Promise.all(["rule_values", "training_groups", "library_blocks", "library_exercises", "bands", "selection_cells", "note_templates", "goals", "schedule_days"].map(changes));
    const { data: seed } = await sb.from("rule_values").select("created_at").eq("source", "seed").order("created_at", { ascending: true }).limit(1);
    R.history = history({ v, g, b, e, bd, c, t, gl, sd, seeded: seed && seed[0] ? seed[0].created_at : null });
  }

  function history(raw) {
    const out = [];
    const add = (r, what) => out.push({ at: r.created_at, from: r.effective_from, what, reason: r.reason });
    raw.v.forEach((r) => add(r, `${r.label}: ${Number(r.value)}${r.unit ? " " + r.unit : ""}`));
    raw.g.forEach((r) => add(r, r.retired_at ? `Group removed: ${r.name}` : `Group: ${r.name}`));
    raw.b.forEach((r) => { if (r.key === "prep") add(r, `Prep total: ${r.minutes} min`); else if (!r.retired_at) add(r, `Block: ${r.name}`); });
    raw.e.forEach((r) => add(r, `${r.name}${r.excluded ? ": retired" : ": saved"}`));
    raw.bd.forEach((r) => add(r, r.retired_at ? `Band removed: ${r.name}` : `Band: ${r.name}`));
    raw.c.forEach((r) => add(r, `Grid ${gridName(r.grid)}${r.phase ? ", phase " + r.phase : ""}, ${tierName(r.tier)} × ${colName(r.window_cell)}: ${r.blocks.map((k) => (R.blocks.find((x) => x.key === k) || {}).name || k).join(", ") || "rest"}`));
    raw.t.forEach((r) => add(r, `Note template, ${tierName(r.tier)}`));
    (raw.gl || []).forEach((r) => add(r, r.retired_at ? `Goal retired: ${r.name}` : `Goal ${r.name}: phase ${r.phase} of ${r.phases}, day ${r.day}${r.active ? "" : " (not active)"}`));
    (raw.sd || []).forEach((r) => add(r, r.retired_at ? `Schedule, day ${r.number} removed` : `Schedule, day ${r.number} ${r.slot}: ${(r.sessions || []).map((k) => (group(k) || {}).name || k).join(", ") || "rest"}`));
    if (raw.seeded) out.push({ at: raw.seeded, from: null, what: "Rules seeded.", reason: "" });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 150);
  }

  const liveGroups = () => R.groups.filter((g) => !g.retired_at);
  const group = (k) => R.groups.find((g) => g.key === k);
  /** The session types: every live group but Prep; PT (morning_pt) reads the Morning and Later grids by slot. */
  const sessionGroups = () => liveGroups().filter((g) => g.key !== "prep");
  const gridName = (k) => (k === "morning" ? "PT, morning" : k === "later" ? "PT, later" : (group(k) || {}).name || k);
  const activeGoal = () => R.goals.find((g) => g.active && !g.retired_at) || null;
  const schedOf = (gk) => R.schedule.filter((d) => d.goal_key === gk);
  const schedDays = (gk) => schedOf(gk).reduce((m, d) => Math.max(m, d.number), 0);
  const schedFor = (gk, n, slot) => schedOf(gk).find((d) => d.number === n && d.slot === slot) || null;
  const sessionName = (k) => (group(k) || {}).name || k;
  const block = (k) => { const b = R.blocks.find((x) => x.key === k); if (!b || b.retired_at) return null; const g = group(b.group_key); return g && !g.retired_at ? b : null; };
  const blocksOf = (gk) => R.blocks.filter((b) => b.group_key === gk && !b.retired_at);
  const exOf = (bk) => R.exercises.filter((e) => e.block_key === bk);
  const liveEx = (bk) => exOf(bk).filter((e) => !e.excluded);
  const groupsOf = (ek) => R.exGroups.filter((x) => x.exercise_key === ek).map((x) => x.group_key);
  /** Exercises that live in another group's block and are also in this group. */
  const also = (gk) => R.exercises.filter((e) => !e.excluded && groupsOf(e.key).includes(gk) && (R.blocks.find((b) => b.key === e.block_key) || {}).group_key !== gk);
  const prepTotal = () => Math.round(liveEx("prep").reduce((s, e) => s + (e.seconds || 0), 0) / 60);
  const pending = (r) => (r.effective_from > R.today ? ' <span class="tmpl">from tomorrow</span>' : "");

  function dur(sec) { sec = Math.round(sec || 0); const m = Math.floor(sec / 60), s = sec % 60; return m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`; }
  function setText(e) {
    if (e.mode === "prep") return Math.round((e.seconds || 0) / 60) + " min";
    const load = `${Number(e.load_lb) || 0} lb${e.band ? " + " + e.band + " band" : ""}`;
    return `${e.sets} × ${e.mode === "reps" ? e.reps + " reps" : dur(e.seconds) + (e.reps ? " · " + e.reps + " reps" : "")} · ${load}`;
  }

  // ---------- saving ----------
  function reason() {
    const i = $("#r-reason"), text = ((i || {}).value || "").trim();
    if (!text && i) { i.classList.add("need"); i.placeholder = "A reason is required"; i.focus(); }
    return text;
  }
  async function save(calls, when, done) {
    const why = reason();
    if (!why) return;
    S.msg = null;
    await busy("Saving", async () => {
      for (const body of calls) await fn("rules-update", { ...body, reason: why, apply: when });
      R.sheet = null; R.tplDraft = {}; R.thrDraft = {}; R.reason = "";
      await load();
      S.msg = `${done} ${when === "today" ? "Applied today." : "Takes effect tomorrow."}`;
    });
  }
  const reasonBox = () => `<div class="reason"><input type="text" id="r-reason" value="${esc(R.reason)}" placeholder="Reason for the change (required)" maxlength="300"></div>`;
  const saveRow = (act) => `<div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button><button class="btn sm" data-r="${act}" data-when="today">Save for today</button><button class="btn sm dark" data-r="${act}" data-when="tomorrow">Save from tomorrow</button></div>`;
  const crumb = (title) => `<div class="crumb"><button data-act="go-settings">‹ Settings</button><span class="pos">${esc(title)}</span></div>`;

  // ---------- thresholds ----------
  function viewThr() {
    return `${crumb("Thresholds")}
      <div class="card kvs">${R.values.map((v) => `<div class="kv"><div class="k">${esc(v.label)}${pending(v)}<small>${esc(v.meaning)}</small></div><div><input type="number" step="any" inputmode="decimal" data-thr="${esc(v.key)}" data-was="${Number(v.value)}" value="${esc(R.thrDraft[v.key] ?? Number(v.value))}" aria-label="${esc(v.label)}"><span class="u">${esc(v.unit)}</span></div></div>`).join("")}
        <div class="kv"><div class="k">Prep, default<small>The sum of the prep entries in the Library. The check-in can leave one out or change its minutes for the day. <button class="link" data-r="to-prep">Edit in Library</button></small></div><div><span class="ro">${prepTotal()}</span><span class="u">min</span></div></div></div>
      ${reasonBox()}<p class="muted">Takes effect tomorrow, so an early edit never changes today's plan mid-flow.</p>
      <div class="foot col"><button class="btn primary" data-r="thr-save" data-when="tomorrow">Save from tomorrow</button><button class="btn quiet" data-r="thr-save" data-when="today">Apply today instead</button></div>`;
  }

  // ---------- selection grid ----------
  /** The cell for a grid, tier and column: the row for the phase when one exists, else the row for every phase. */
  const cell = (grid, tier, col, phase) => {
    const mine = R.cells.filter((c) => c.grid === grid && c.tier === tier && c.window_cell === col);
    return (phase != null && mine.find((c) => c.phase === phase)) || mine.find((c) => c.phase == null) || null;
  };
  function gridTable(grid, phase) {
    return `<div class="gridwrap"><table class="grid"><tr><th>Tier</th>${COLS.map((c) => `<th>${colName(c)}</th>`).join("")}</tr>
        ${TIERS.map((t) => `<tr><th>${tierName(t)}</th>${COLS.map((c) => { const x = cell(grid, t, c, phase); const ks = x ? x.blocks : []; const bad = (grid === "morning" || grid === "later") ? (!x || ks.some((k) => !block(k))) : ks.some((k) => !block(k)); const own = x && phase != null && x.phase === phase; return `<td class="c${bad ? " bad" : ""}" data-r="cell" data-g="${esc(grid)}" data-t="${t}" data-c="${c}">${ks.length ? ks.map((k) => `<div class="cellb"><b>${esc(block(k) ? block(k).name : k)}</b>${esc(block(k) ? group(block(k).group_key).name : "missing")}</div>`).join("") : '<div class="cellb">rest</div>'}${x ? pending(x) : ""}${own ? '<span class="tmpl">this phase</span>' : ""}</td>`; }).join("")}</tr>`).join("")}
      </table></div>`;
  }
  function viewSel() {
    const tab = R.gridTab, ag = activeGoal();
    const tabs = `<div class="tabs"><button data-r="grid-tab" data-v="pt" aria-pressed="${tab === "pt"}">PT</button>${sessionGroups().filter((g) => g.key !== "morning_pt").map((g) => `<button data-r="grid-tab" data-v="${esc(g.key)}" aria-pressed="${tab === g.key}">${esc(g.name)}</button>`).join("")}</div>`;
    if (tab === "pt") {
      return `${crumb("Selection grid")}${tabs}
        <p class="muted">PT is the Morning grid in the morning slot and the Later grid in a later slot; the Schedule says which. Prep is not in the grid: it runs before the morning session. Tap a cell to change its blocks.</p>
        <div class="h2">Morning (check-in #1)</div>${gridTable("morning", null)}
        <div class="h2">Later (every check-in after the first, for the time left)</div>${gridTable("later", null)}${sheet()}`;
    }
    const phases = ag ? `<div class="phases"><span>Phase</span>${Array.from({ length: ag.phases }, (_, i) => i + 1).map((p) => `<button data-r="phase-tab" data-v="${p}" aria-pressed="${R.phaseTab === p}">${p}</button>`).join("")}</div>` : "";
    return `${crumb("Selection grid")}${tabs}${phases}
      <p class="muted">Used when the Schedule names ${esc(gridName(tab))}. An empty cell is rest for this session.${ag ? ` A cell saved for one phase shows "this phase"; the others serve every phase.` : ""} Tap a cell to change it.</p>
      ${gridTable(tab, ag ? R.phaseTab : null)}${sheet()}`;
  }
  function sheetCell() {
    const s = R.sheet, d = s.draft;
    const total = d.reduce((a, k) => a + (block(k) ? block(k).minutes : 0), 0);
    return `<div class="h2">Cell: ${tierName(s.tier)} × ${colName(s.col)} (${esc(gridName(s.grid))}${s.phase ? ", phase " + s.phase : ""})</div>
      <p class="muted">Blocks in this cell, in order. A missing block shows red and cannot be saved.</p>
      <div class="stack">${d.length ? d.map((k, i) => `<div class="cellrow"${block(k) ? "" : ' style="color:var(--red)"'}><span>${block(k) ? esc(block(k).name) + ` <span class="grp">${esc(group(block(k).group_key).name)}</span>` : esc(k) + " (missing)"}</span><button data-r="cell-up" data-i="${i}" aria-label="move up">↑</button><button data-r="cell-down" data-i="${i}" aria-label="move down">↓</button><button data-r="cell-rm" data-i="${i}" aria-label="remove">−</button></div>`).join("") : '<p class="muted">Rest: no blocks.</p>'}</div>
      <div class="pick"><div class="pg">Add a block</div>${liveGroups().filter((g) => g.key !== "prep").map((g) => `<div class="pg">${esc(g.name)}</div>${blocksOf(g.key).map((b) => `<button data-r="cell-add" data-k="${esc(b.key)}"${d.includes(b.key) || !liveEx(b.key).length ? " disabled" : ""}>${esc(b.name)} <span class="min">${liveEx(b.key).length ? b.minutes + " min" : "no exercises yet"}</span></button>`).join("")}`).join("")}</div>
      <p class="muted">Total: ${total} min for a ${s.col === "none" ? "no-window" : s.col + "-minute"} cell.</p>${reasonBox()}
      ${s.phase ? `<div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button><button class="btn sm" data-r="cell-save" data-when="today" data-every="1">Save, every phase</button><button class="btn sm dark" data-r="cell-save" data-when="today">Save, phase ${s.phase} only</button></div><p class="muted">Both take effect today; the grid is read at the next check-in.</p>` : saveRow("cell-save")}`;
  }

  // ---------- library ----------
  function viewLib() {
    const g = group(R.libTab);
    if (!g) return `${crumb("Library")}<p class="muted">No groups yet.</p>`;
    const isPrep = g.key === "prep";
    const noteBox = (b) => {
      const draft = R.noteDraft[b.key];
      const dirty = draft !== undefined && draft !== (b.note || "");
      return `<input class="txt note" type="text" maxlength="400" data-bnote="${esc(b.key)}" value="${esc(draft !== undefined ? draft : (b.note || ""))}" placeholder="Note on this block (shown on the plan)" aria-label="Note on ${esc(b.name)}">
        ${dirty ? `<div class="saverow">${reasonBox()}<div class="acts"><button class="btn sm" data-r="bnote-save" data-k="${esc(b.key)}" data-when="today">Save note for today</button><button class="btn sm dark" data-r="bnote-save" data-k="${esc(b.key)}" data-when="tomorrow">Save note from tomorrow</button></div></div>` : ""}`;
    };
    return `${crumb("Library")}
      <div class="tabs">${liveGroups().map((x) => `<button data-r="lib-tab" data-v="${esc(x.key)}" aria-pressed="${x.key === g.key}">${esc(x.name)}</button>`).join("")}</div>
      <div class="rowbtns"><button class="addset" data-r="group-new">+ Add a group</button>${isPrep ? "" : `<button class="addset" data-r="group-edit">Rename or remove ${esc(g.name)}</button><button class="addset" data-r="block-new">+ Add a block</button>`}</div>
      ${isPrep ? `<p class="muted">Prep entries are a title and minutes each; their total (${prepTotal()} min) is taken off the window before the morning session.</p>` : ""}
      <div class="stack">${blocksOf(g.key).map((b) => `<div class="blk"><div class="nm">${esc(b.name)} <span class="min">${b.minutes} min</span>${pending(b)}</div>
        ${isPrep ? "" : noteBox(b)}
        ${exOf(b.key).map((e, i) => `<div class="kv${e.excluded ? " retired" : ""}"><div class="k">${esc(e.name)}<span class="tmpl">${e.mode}</span>${pending(e)}<small>${e.excluded ? "retired: " + esc(e.exclusion_reason || "") : esc(e.cues || "no cue") + " · " + setText(e) + (groupsOf(e.key).length > 1 ? " · also in " + groupsOf(e.key).filter((x) => x !== g.key).map((x) => esc((group(x) || {}).name || x)).join(", ") : "")}</small></div><div class="kvb">${e.excluded ? `<button class="x" data-r="ex-restore" data-k="${esc(e.key)}">restore</button>` : `${i > 0 ? `<button class="x" data-r="ex-up" data-k="${esc(e.key)}" aria-label="move up">↑</button>` : ""}<button class="x" data-r="ex-edit" data-k="${esc(e.key)}">edit</button>`}</div></div>`).join("") || '<p class="muted">Nothing in this block yet.</p>'}
        <button class="addset" data-r="ex-new" data-b="${esc(b.key)}">+ ${isPrep ? "prep entry" : "exercise or activity in " + esc(b.name)}</button></div>`).join("") || '<p class="muted">This group has no blocks.</p>'}
        ${also(g.key).length ? `<div class="blk"><div class="nm">Also in ${esc(g.name)}</div>${also(g.key).map((e) => `<div class="kv"><div class="k">${esc(e.name)}<span class="tmpl">${e.mode}</span>${pending(e)}<small>${esc((R.blocks.find((b) => b.key === e.block_key) || {}).name || "")} · ${setText(e)}</small></div><div class="kvb"><button class="x" data-r="ex-edit" data-k="${esc(e.key)}">edit</button></div></div>`).join("")}</div>` : ""}</div>
      <div class="card"><div class="h">Bands</div><div class="line">${R.bands.map((b) => `<span class="grp">${esc(b.name)}</span>`).join(" ")} <button class="link" data-r="bands-edit">edit</button></div><p class="muted">The load choices offered on every set, next to weight in lb.</p></div>${sheet()}`;
  }
  /** + Add a block: a name, minutes, a note and its first exercise; more exercises come from "+ exercise" under it. */
  function sheetBlock() {
    const d = R.sheet.draft;
    return `<div class="h2">New block in ${esc((group(R.libTab) || {}).name || "")}</div>
      <label class="fld"><span>Block name</span><input type="text" id="bk-name" value="${esc(d.name)}" maxlength="80" placeholder="e.g. Swings and band pushups"></label>
      <div class="fld2"><label class="fld"><span>Minutes</span><input type="number" id="bk-min" inputmode="numeric" min="0" max="600" value="${d.minutes}"></label>
        <label class="fld"><span>Sets of the first exercise</span><input type="number" id="bk-sets" inputmode="numeric" min="1" max="20" value="${d.sets}"></label></div>
      <label class="fld"><span>Note (shown on the plan)</span><input type="text" id="bk-note" value="${esc(d.note)}" maxlength="400" placeholder="e.g. Superset: alternate the two"></label>
      <label class="fld"><span>First exercise</span><input type="text" id="bk-ex" value="${esc(d.ex)}" maxlength="80" placeholder="e.g. Banded kettlebell front swings"></label>
      <div class="fld"><span>Type</span><div class="gchips"><button data-r="bk-mode" data-v="reps" aria-pressed="${d.mode === "reps"}">Reps</button><button data-r="bk-mode" data-v="time" aria-pressed="${d.mode === "time"}">Time</button></div></div>
      <label class="fld"><span>${d.mode === "reps" ? "Reps per set" : "Seconds per set"}</span><input type="number" id="bk-amount" inputmode="numeric" min="0" value="${d.amount}"></label>
      ${reasonBox()}${saveRow("block-save")}`;
  }
  function sheetExercise() {
    const d = R.sheet.draft;
    if (R.sheet.retire) {
      return `<div class="h2">Retire ${esc(d.name)}</div>
        <p class="muted">It leaves every plan from the day you choose. Nothing is deleted: it stays in the library, greyed out, and can be restored.</p>
        ${reasonBox()}<div class="acts"><button class="btn sm" data-r="ex-retire-back">Go back</button><button class="btn sm" data-r="ex-retire" data-when="today">Retire today</button><button class="btn sm dark" data-r="ex-retire" data-when="tomorrow">Retire from tomorrow</button></div>`;
    }
    if (R.sheet.prep) {
      return `<div class="h2">${R.sheet.key ? esc(d.name) : "New prep entry"}</div>
        <label class="fld"><span>Title</span><input type="text" id="e-name" value="${esc(d.name)}" maxlength="80" placeholder="e.g. Coffee"></label>
        <label class="fld"><span>Minutes</span><input type="number" id="e-min" inputmode="numeric" min="1" value="${Math.round((d.seconds || 600) / 60)}"></label>
        <p class="muted">Prep is a title and minutes; no sets, reps or load.</p>${reasonBox()}
        <div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button>${R.sheet.key ? '<button class="btn sm" data-r="ex-retire-ask">Retire</button>' : ""}<button class="btn sm" data-r="ex-save" data-when="today">Save for today</button><button class="btn sm dark" data-r="ex-save" data-when="tomorrow">Save from tomorrow</button></div>`;
    }
    return `<div class="h2">${R.sheet.key ? esc(d.name) : "New exercise or activity"}</div>
      <label class="fld"><span>Name</span><input type="text" id="e-name" value="${esc(d.name)}" maxlength="80" placeholder="e.g. Walk, Clamshells"></label>
      <label class="fld"><span>Cue</span><input type="text" id="e-cue" value="${esc(d.cues)}" maxlength="400" placeholder="what to watch for"></label>
      <div class="fld"><span>Type</span><div class="gchips"><button data-r="ex-mode" data-v="reps" aria-pressed="${d.mode === "reps"}">Reps: reps + load</button><button data-r="ex-mode" data-v="time" aria-pressed="${d.mode === "time"}">Time: minutes and seconds + load, reps optional</button></div></div>
      <div class="fld2"><label class="fld"><span>Sets</span><input type="number" id="e-sets" inputmode="numeric" min="1" max="20" value="${d.sets}"></label>
        ${d.mode === "time" ? `<label class="fld"><span>Time per set</span><div class="mmss"><input type="number" id="e-mm" inputmode="numeric" min="0" value="${Math.floor((d.seconds || 0) / 60)}" aria-label="minutes"> min <input type="number" id="e-ss" inputmode="numeric" min="0" max="59" value="${Math.round(d.seconds || 0) % 60}" aria-label="seconds"> s</div></label>` : ""}
        <label class="fld"><span>${d.mode === "reps" ? "Reps per set" : "Reps per set (optional)"}</span><input type="number" id="e-reps" inputmode="numeric" min="0" value="${d.reps ?? ""}" placeholder="${d.mode === "reps" ? "" : "optional"}"></label></div>
      <div class="fld2"><label class="fld"><span>Weight, lb (0 allowed)</span><input type="number" id="e-load" inputmode="decimal" min="0" step="0.5" value="${Number(d.load_lb) || 0}"></label>
        <label class="fld"><span>Band</span><select id="e-band"><option value="">no band</option>${R.bands.map((b) => `<option value="${esc(b.name)}"${d.band === b.name ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label></div>
      <div class="fld"><span>Groups (one or more)</span><div class="gchips">${liveGroups().filter((g) => g.key !== "prep").map((g) => `<button data-r="ex-group" data-v="${esc(g.key)}" aria-pressed="${d.groups.includes(g.key)}">${esc(g.name)}</button>`).join("")}</div></div>
      ${reasonBox()}
      <div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button>${R.sheet.key ? '<button class="btn sm" data-r="ex-retire-ask">Retire</button>' : ""}<button class="btn sm" data-r="ex-save" data-when="today">Save for today</button><button class="btn sm dark" data-r="ex-save" data-when="tomorrow">Save from tomorrow</button></div>`;
  }
  /** Keeps what was typed into the new-block sheet before a re-render. */
  function readBlock() {
    const d = R.sheet.draft, val = (id) => ($(id) ? $(id).value : null);
    if (val("#bk-name") != null) d.name = val("#bk-name");
    if (val("#bk-min") != null) d.minutes = Math.max(0, Math.min(600, Number(val("#bk-min")) || 0));
    if (val("#bk-sets") != null) d.sets = Math.max(1, Math.min(20, Number(val("#bk-sets")) || 1));
    if (val("#bk-note") != null) d.note = val("#bk-note");
    if (val("#bk-ex") != null) d.ex = val("#bk-ex");
    if (val("#bk-amount") != null) d.amount = Math.max(0, Number(val("#bk-amount")) || 0);
  }
  /** Keeps what was typed into the open exercise sheet before a re-render. */
  function readExercise() {
    const d = R.sheet.draft, val = (id) => ($(id) ? $(id).value : null);
    if (val("#e-name") != null) d.name = val("#e-name");
    if (R.sheet.prep) { if (val("#e-min") != null) d.seconds = Math.max(1, Number(val("#e-min")) || 1) * 60; return; }
    if (val("#e-cue") != null) d.cues = val("#e-cue");
    if (val("#e-sets") != null) d.sets = Math.max(1, Number(val("#e-sets")) || 1);
    if (val("#e-mm") != null) d.seconds = Math.max(0, Number(val("#e-mm")) || 0) * 60 + Math.min(59, Math.max(0, Number(val("#e-ss")) || 0));
    if (val("#e-reps") != null) d.reps = val("#e-reps") === "" ? null : Math.max(0, Number(val("#e-reps")));
    if (val("#e-load") != null) d.load_lb = Math.max(0, Number(val("#e-load")) || 0);
    if (val("#e-band") != null) d.band = val("#e-band") || null;
  }
  function sheetGroup() {
    const s = R.sheet;
    if (s.confirm) {
      const g = group(s.key), mine = blocksOf(g.key), keys = mine.map((b) => b.key);
      const exs = mine.flatMap((b) => liveEx(b.key));
      const shared = exs.filter((e) => groupsOf(e.key).some((x) => x !== g.key && group(x) && !group(x).retired_at));
      const cells = R.cells.filter((c) => c.blocks.some((k) => keys.includes(k))).map((c) => `${c.grid} ${tierName(c.tier)} × ${colName(c.window_cell)}`);
      return `<div class="h2">Remove ${esc(g.name)}</div><p class="muted">Removing it takes it out of every workflow. Here is what is attached:</p>
        <div class="card"><div class="line"><b>${mine.length} block${mine.length === 1 ? "" : "s"}:</b> ${mine.map((b) => esc(b.name)).join(", ") || "none"}</div>
        <div class="line"><b>${exs.length} exercise${exs.length === 1 ? "" : "s"}:</b> ${exs.map((e) => esc(e.name)).join(", ") || "none"}${shared.length ? ` (${shared.length} also in another group; those stay there)` : ""}</div>
        <div class="line"><b>${cells.length} grid cell${cells.length === 1 ? "" : "s"}:</b> ${cells.map(esc).join("; ") || "none"}${cells.length ? " (its blocks are removed from these cells)" : ""}</div>
        <div class="line"><b>Past records:</b> kept, still labelled ${esc(g.name)}. Nothing is deleted.</div></div>
        ${reasonBox()}<div class="acts"><button class="btn sm" data-r="group-back">Go back</button><button class="btn sm" data-r="group-remove" data-when="today">Remove today</button><button class="btn sm dark" data-r="group-remove" data-when="tomorrow">Remove from tomorrow</button></div>`;
    }
    return `<div class="h2">${s.key ? esc(group(s.key).name) : "New group"}</div>
      <label class="fld"><span>Group name</span><input type="text" id="g-name" value="${esc(s.name || "")}" maxlength="60" placeholder="e.g. Swimming, Climbing"></label>
      <p class="muted">${s.key ? "Renaming keeps every block, exercise and past record in the group. Remove takes the group out of every workflow after a confirmation that lists what is attached." : "A new group starts with one empty block of the same name; add exercises to it, then put it in the selection grid when you want it picked."}</p>
      ${reasonBox()}<div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button>${s.key ? '<button class="btn sm" data-r="group-confirm">Remove</button>' : ""}<button class="btn sm" data-r="group-save" data-when="today">Save for today</button><button class="btn sm dark" data-r="group-save" data-when="tomorrow">Save from tomorrow</button></div>`;
  }
  function sheetBands() {
    return `<div class="h2">Bands</div><label class="fld"><span>Band strengths, lightest first, comma separated</span><input type="text" id="b-list" value="${esc(R.sheet.list ?? R.bands.map((b) => b.name).join(", "))}"></label>
      <p class="muted">Offered as the load on every set, next to weight in lb. Sets already recorded keep the name they were saved with.</p>${reasonBox()}${saveRow("bands-save")}`;
  }
  /** A change with no fields of its own (restore, reorder): the reason and the day. */
  function sheetConfirm() {
    return `<div class="h2">${esc(R.sheet.title)}</div><p class="muted">${esc(R.sheet.text)}</p>${reasonBox()}${saveRow("confirm-save")}`;
  }
  function sheet() {
    if (!R.sheet) return "";
    const body = { cell: sheetCell, exercise: sheetExercise, group: sheetGroup, bands: sheetBands, confirm: sheetConfirm, block: sheetBlock, goal: sheetGoal, sched: sheetSched, restart: sheetRestart }[R.sheet.kind]();
    return `<div class="sheetbg" data-r="sheet-close"></div><div class="sheet on" role="dialog" aria-modal="true">${S.err ? `<div class="err">${esc(S.err)}</div>` : ""}${body}</div>`;
  }

  // ---------- templates ----------
  function fill(tpl, tier) {
    const x = cell("morning", tier, "40");
    const session = x && x.blocks.length ? x.blocks.map((k) => (block(k) ? block(k).name : k)).join(" + ") : "Rest";
    const line = { green: "Green.", yellow: "Yellow.", red: "Red.", no_data: "" }[tier];
    return tpl.split("{tier_line}").join(line).split("{session}").join(session).split("{minutes}").join("40").split("{flags}").join("").trim();
  }
  function viewTpl() {
    const t = R.tplTier, row = R.templates.find((x) => x.tier === t) || { template: "" };
    const text = R.tplDraft[t] ?? row.template;
    return `${crumb("Note templates")}
      <div class="tabs">${TIERS.map((x) => `<button data-r="tpl-tab" data-v="${x}" aria-pressed="${x === t}">${tierName(x)}</button>`).join("")}</div>
      <div class="tpl"><textarea id="tpl-text" maxlength="600">${esc(text)}</textarea></div>
      <p class="muted">Slots: <code>{session}</code> <code>{minutes}</code> <code>{tier_line}</code> <code>{flags}</code>. Plain text.${row.effective_from > R.today ? " The saved version takes effect tomorrow." : ""}</p>
      <div class="preview" id="tpl-preview">${esc(fill(text, t))}</div>
      ${reasonBox()}<div class="foot col"><button class="btn primary" data-r="tpl-save" data-when="tomorrow">Save from tomorrow</button><button class="btn quiet" data-r="tpl-save" data-when="today">Apply today instead</button></div>`;
  }

  // ---------- goals ----------
  function viewGoals() {
    const g = activeGoal(), others = R.goals.filter((x) => !x.retired_at && !(g && x.key === g.key));
    const days = g ? Math.max(1, schedDays(g.key)) : 0;
    const card = g
      ? `<div class="card"><div class="h">${esc(g.name)}${pending(g)}</div><div class="line">${g.phases} phase${g.phases === 1 ? "" : "s"} of a ${days}-day schedule. Used the moment it is active; a save here restarts today.</div>
        <div class="kv"><div class="k">Phase<small>moves on when the last day of the schedule is done</small></div><span class="ro">${g.phase} of ${g.phases}</span></div>
        <div class="kv"><div class="k">Day<small>moves on after a day with something done</small></div><span class="ro">${g.day} of ${days}</span></div>
        <div class="rowbtns" style="margin-top:10px"><button class="addset" data-r="goal-move" data-what="phase" data-d="-1" ${g.phase <= 1 ? "disabled" : ""}>Phase back</button><button class="addset" data-r="goal-move" data-what="phase" data-d="1" ${g.phase >= g.phases ? "disabled" : ""}>Phase on</button><button class="addset" data-r="goal-move" data-what="day" data-d="-1" ${g.day <= 1 ? "disabled" : ""}>Day back</button><button class="addset" data-r="goal-move" data-what="day" data-d="1" ${g.day >= days ? "disabled" : ""}>Day on</button></div>
        <div class="rowbtns"><button class="addset" data-r="goal-edit">Edit goal</button><button class="addset" data-r="goal-retire">Retire</button><button class="addset" data-act="open-ext" data-view="rules-sched">Schedule ›</button></div>
        <div class="rowbtns"><button class="btn accent" data-r="restart">Restart today from day ${g.day}</button></div></div>
        <div class="card"><div class="h">Phases to get there</div>${Array.from({ length: g.phases }, (_, i) => i + 1).map((p) => `<div class="goalrow"><div class="ring${p < g.phase ? " full" : ""}">${p < g.phase ? "✓" : p}</div><div>Phase ${p}<small>${p < g.phase ? "done" : p === g.phase ? `now, day ${g.day} of ${days}` : "not started"}</small></div><span class="min">${p < g.phase ? "done" : p === g.phase ? "now" : "next"}</span></div>`).join("")}</div>`
      : `<div class="card"><div class="h">No goal</div><div class="line">Mornings plan from the PT grid as before. Add a goal to follow a schedule of sessions.</div></div>`;
    return `${crumb("Goals")}
      <p class="muted">A goal is any program: a name, a number of phases and a schedule of numbered days. One is active at a time.</p>
      ${card}
      <div class="rowbtns"><button class="addset" data-r="goal-new">+ Add a goal</button></div>
      ${others.length ? `<div class="card"><div class="h">Other goals</div>${others.map((x) => `<div class="kv"><div class="k">${esc(x.name)}<small>${x.phases} phases, at phase ${x.phase} day ${x.day}</small></div><div class="kvb"><button class="x" data-r="goal-activate" data-k="${esc(x.key)}">make active</button></div></div>`).join("")}</div>` : ""}${sheet()}`;
  }
  function sheetGoal() {
    const d = R.sheet.draft;
    return `<div class="h2">${R.sheet.key ? esc(d.name) : "New goal"}</div>
      <label class="fld"><span>Goal name</span><input type="text" id="gl-name" value="${esc(d.name)}" maxlength="60" placeholder="e.g. Challenge, my version"></label>
      <label class="fld"><span>Phases</span><input type="number" id="gl-phases" inputmode="numeric" min="1" max="12" value="${d.phases}"></label>
      <p class="muted">${R.sheet.key ? "Fewer phases than the current one moves the phase to the new last one." : "A new goal becomes the active one, at its first phase and first day, with a one-day schedule (PT in the morning) to fill in."} A save for today restarts today.</p>
      ${reasonBox()}<div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button><button class="btn sm dark" data-r="goal-save" data-when="today">Save for today</button><button class="btn sm" data-r="goal-save" data-when="tomorrow">Save from tomorrow</button></div>`;
  }
  /** Restart today (D101): a later check-in on the goal's morning slot for the time left; done work stays done. */
  function sheetRestart() {
    const d = R.sheet;
    const LEFT = [["30", "30 min"], ["60", "1 hr"], ["120", "2 hrs"], ["none", "None"], ["other", "Other"]];
    return `<div class="h2">Restart today</div>
      <p class="muted">A new plan for today from the goal's day ${(activeGoal() || {}).day || 1}, morning slot, for the time you have. Blocks already done today stay done; the rest of today's plan is replaced.</p>
      <div class="opts">${LEFT.map(([k, label]) => `<button class="opt" data-r="restart-left" data-v="${k}" aria-pressed="${d.left === k}">${label}</button>`).join("")}</div>
      ${d.left === "other" ? `<input class="txt" id="rs-min" type="number" inputmode="numeric" min="0" max="600" placeholder="minutes" value="${esc(d.minutes || "")}">` : ""}
      <div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button><button class="btn sm dark" data-r="restart-go" ${d.left ? "" : "disabled"}>Restart today</button></div>`;
  }
  function viewSched() {
    const g = activeGoal();
    if (!g) return `${crumb("Schedule")}<p class="muted">No goal is active. Add one on Goals first.</p><div class="rowbtns"><button class="addset" data-act="open-ext" data-view="rules-goals">‹ Goals</button></div>`;
    const n = Math.max(1, schedDays(g.key));
    const names = (d) => (d ? d.sessions.map(sessionName).join(", ") : "");
    return `${crumb("Schedule")}
      <p class="muted">${esc(g.name)}: the days inside a phase, in order. A day moves on only after a day with something done; after the last day the phase moves on and the days start again at 1. Tap a slot to set its sessions. A save for today restarts today.</p>
      <table class="sched"><tr><th>Day</th><th>Morning (check-in #1)</th><th>Later (after it)</th></tr>
        ${Array.from({ length: n }, (_, i) => i + 1).map((k) => { const m = schedFor(g.key, k, "morning"), l = schedFor(g.key, k, "later"); return `<tr class="${k === g.day ? "cur" : ""}"><th>${k}${k === g.day ? ' <span class="tmpl on">now</span>' : ""}</th><td class="c" data-r="sched-cell" data-n="${k}" data-slot="morning">${esc(names(m)) || '<span class="muted">rest</span>'}${m ? pending(m) : ""}</td><td class="c" data-r="sched-cell" data-n="${k}" data-slot="later">${esc(names(l)) || '<span class="muted">nothing</span>'}${l ? pending(l) : ""}</td></tr>`; }).join("")}
      </table>
      <div class="rowbtns"><button class="addset" data-r="sched-add">+ Add a day</button>${n > 1 ? `<button class="addset" data-r="sched-remove" data-n="${n}">Remove day ${n}</button>` : ""}<button class="addset" data-act="open-ext" data-view="rules-goals">‹ Goals</button></div>${sheet()}`;
  }
  function sheetSched() {
    const d = R.sheet;
    return `<div class="h2">Day ${d.number}, ${d.slot}</div>
      <p class="muted">Tap a session to add it in order; tap again to take it out. The window is filled session by session.</p>
      <div class="gchips">${sessionGroups().map((g) => `<button data-r="sched-toggle" data-v="${esc(g.key)}" aria-pressed="${d.draft.includes(g.key)}">${d.draft.includes(g.key) ? d.draft.indexOf(g.key) + 1 + ". " : ""}${esc(g.name)}</button>`).join("")}</div>
      <p class="muted">${d.draft.map(sessionName).join(" then ") || (d.slot === "morning" ? "Rest: the morning plans nothing." : "Nothing later.")}</p>
      ${reasonBox()}<div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button><button class="btn sm dark" data-r="sched-save" data-when="today">Save for today</button><button class="btn sm" data-r="sched-save" data-when="tomorrow">Save from tomorrow</button></div>`;
  }

  // ---------- history ----------
  function viewHist() {
    const when = (iso) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    return `${crumb("History")}<div class="card hist">${R.history.map((h) => `<div><b>${esc(h.what)}</b><br>${when(h.at)}${h.from ? " · in force from " + esc(h.from) : ""}${h.reason ? " · " + esc(h.reason) : ""}</div>`).join("") || "No changes yet."}</div>`;
  }

  // ---------- events ----------
  function sheetOpen(sheet) { R.sheet = sheet; R.reason = ""; S.err = null; render(); }
  function exerciseSheet(key, blockKey) {
    const e = key ? R.exercises.find((x) => x.key === key) : null;
    const bk = e ? e.block_key : blockKey;
    return { kind: "exercise", key: key || null, block: bk, prep: bk === "prep", draft: e ? { name: e.name, cues: e.cues || "", mode: e.mode, sets: e.sets, reps: e.reps, seconds: e.seconds, load_lb: e.load_lb, band: e.band, groups: groupsOf(e.key) } : { name: "", cues: "", mode: bk === "prep" ? "prep" : "reps", sets: 1, reps: bk === "prep" ? null : 10, seconds: bk === "prep" ? 600 : 60, load_lb: 0, band: null, groups: [(R.blocks.find((b) => b.key === bk) || {}).group_key] } };
  }

  const actions = {
    "sheet-close": () => { R.sheet = null; R.reason = ""; S.err = null; render(); },
    "to-prep": () => { R.libTab = "prep"; go("rules-lib"); },
    "thr-save": async (el) => {
      const calls = $$("[data-thr]").filter((i) => Number(i.value) !== Number(i.dataset.was) && i.value !== "").map((i) => ({ op: "threshold", key: i.dataset.thr, value: Number(i.value) }));
      if (!calls.length) { S.err = "Nothing changed."; S.msg = null; render(); return; }
      await save(calls, el.dataset.when, "Saved.");
    },
    "grid-tab": (el) => { R.gridTab = el.dataset.v; render(); },
    "phase-tab": (el) => { R.phaseTab = Number(el.dataset.v); render(); },
    "cell": (el) => { const grid = el.dataset.g, phase = (grid === "morning" || grid === "later" || !activeGoal()) ? null : R.phaseTab; const x = cell(grid, el.dataset.t, el.dataset.c, phase); sheetOpen({ kind: "cell", grid, tier: el.dataset.t, col: el.dataset.c, phase, draft: x ? x.blocks.slice() : [] }); },
    "cell-up": (el) => { const d = R.sheet.draft, i = Number(el.dataset.i); if (i > 0) [d[i - 1], d[i]] = [d[i], d[i - 1]]; render(); },
    "cell-down": (el) => { const d = R.sheet.draft, i = Number(el.dataset.i); if (i < d.length - 1) [d[i + 1], d[i]] = [d[i], d[i + 1]]; render(); },
    "cell-rm": (el) => { R.sheet.draft.splice(Number(el.dataset.i), 1); render(); },
    "cell-add": (el) => { R.sheet.draft.push(el.dataset.k); render(); },
    "cell-save": async (el) => {
      const s = R.sheet;
      if (s.draft.some((k) => !block(k))) { S.err = "This cell names a block that does not exist; remove it first."; render(); return; }
      const every = el.dataset.every === "1";
      await save([{ op: "cell", grid: s.grid, tier: s.tier, window_cell: s.col, blocks: s.draft, phase: s.phase && !every ? s.phase : undefined }], el.dataset.when, "Cell saved.");
    },
    "bnote-save": async (el) => {
      const k = el.dataset.k, note = (R.noteDraft[k] || "").trim();
      await save([{ op: "block_note", key: k, note }], el.dataset.when, "Note saved.");
    },
    "block-new": () => sheetOpen({ kind: "block", draft: { name: "", minutes: 15, note: "", ex: "", mode: "reps", sets: 3, amount: 10 } }),
    "bk-mode": (el) => { readBlock(); R.sheet.draft.mode = el.dataset.v; R.sheet.draft.amount = el.dataset.v === "time" ? 60 : 10; render(); },
    "block-save": async (el) => {
      readBlock();
      const d = R.sheet.draft;
      if (!d.name.trim()) { S.err = "Give the block a name."; render(); return; }
      if (!d.ex.trim()) { S.err = "Give the first exercise a name."; render(); return; }
      const ex = { name: d.ex, mode: d.mode, sets: d.sets, reps: d.mode === "reps" ? d.amount : null, seconds: d.mode === "time" ? Math.max(1, d.amount) : null };
      await save([{ op: "block_add", block: { name: d.name, group_key: R.libTab, minutes: d.minutes, note: d.note, exercises: [ex] } }], el.dataset.when, `${d.name.trim()} added.`);
    },
    "goal-new": () => sheetOpen({ kind: "goal", key: null, draft: { name: "", phases: 6 } }),
    "goal-edit": () => { const g = activeGoal(); if (g) sheetOpen({ kind: "goal", key: g.key, draft: { name: g.name, phases: g.phases } }); },
    "goal-save": async (el) => {
      const name = (($("#gl-name") || {}).value || "").trim(), phases = Math.max(1, Math.min(12, Number(($("#gl-phases") || {}).value) || 1));
      if (!name) { S.err = "Give the goal a name."; render(); return; }
      await save([R.sheet.key ? { op: "goal_edit", key: R.sheet.key, name, phases } : { op: "goal_add", name, phases }], el.dataset.when, `${name} saved. Restart today to use it now.`);
    },
    "goal-activate": async (el) => { const k = el.dataset.k; sheetOpen({ kind: "confirm", title: `Make ${(R.goals.find((x) => x.key === k) || {}).name || "it"} the active goal`, text: "The other goal steps aside; its phase and day are kept. Restart today afterwards to use it now.", calls: [{ op: "goal_activate", key: k }], done: "Active." }); },
    "goal-retire": () => { const g = activeGoal(); if (g) sheetOpen({ kind: "confirm", title: `Retire ${g.name}`, text: "It leaves every screen; its rows stay as history. With no goal, mornings plan from the PT grid as before.", calls: [{ op: "goal_retire", key: g.key }], done: "Retired." }); },
    "goal-move": (el) => {
      const g = activeGoal(); if (!g) return;
      const what = el.dataset.what, d = Number(el.dataset.d);
      const next = what === "phase" ? { phase: g.phase + d } : { day: g.day + d };
      sheetOpen({ kind: "confirm", title: `${what === "phase" ? "Phase" : "Day"} ${what === "phase" ? next.phase : next.day}`, text: "Set by hand; the app moves them on by itself as days are done.", calls: [{ op: "goal_set", key: g.key, ...next }], done: "Saved." });
    },
    "restart": () => sheetOpen({ kind: "restart", left: "", minutes: "" }),
    "restart-left": (el) => { R.sheet.left = el.dataset.v; render(); },
    "restart-go": async () => {
      const s = R.sheet;
      const left = s.left === "none" ? null : s.left === "other" ? Math.max(0, Math.min(600, Number((($("#rs-min") || {}).value) || 0))) : Number(s.left);
      S.msg = null;
      await busy("Restarting today", async () => {
        const opened = await fn("checkin-open", {});
        const r = await fn("checkin-submit", { checkin_id: opened.checkin.id, v2: true, restart: true, time_left: left, answers: { feel: "okay", feel_text: null } });
        R.sheet = null;
        await X.applySubmit(r);
      });
    },
    "sched-cell": (el) => { const g = activeGoal(); if (!g) return; const n = Number(el.dataset.n), slot = el.dataset.slot, d = schedFor(g.key, n, slot); sheetOpen({ kind: "sched", number: n, slot, draft: d ? d.sessions.slice() : [] }); },
    "sched-toggle": (el) => { const d = R.sheet.draft, k = el.dataset.v, i = d.indexOf(k); if (i >= 0) d.splice(i, 1); else d.push(k); render(); },
    "sched-save": async (el) => { const g = activeGoal(), s = R.sheet; await save([{ op: "schedule", key: g.key, number: s.number, slot: s.slot, sessions: s.draft }], el.dataset.when, "Schedule saved."); },
    "sched-add": () => { const g = activeGoal(); if (!g) return; const n = schedDays(g.key) + 1; sheetOpen({ kind: "confirm", title: `Add day ${n}`, text: "It starts with PT in the morning and nothing later; tap its slots to change them.", calls: [{ op: "schedule", key: g.key, number: n, slot: "morning", sessions: ["morning_pt"] }], done: `Day ${n} added.` }); },
    "sched-remove": (el) => { const g = activeGoal(); if (!g) return; const n = Number(el.dataset.n); sheetOpen({ kind: "confirm", title: `Remove day ${n}`, text: "Its two slots leave the schedule; the rows stay as history.", calls: [{ op: "schedule_remove", key: g.key, number: n }], done: `Day ${n} removed.` }); },
    "lib-tab": (el) => { R.libTab = el.dataset.v; render(); },
    "ex-new": (el) => sheetOpen(exerciseSheet(null, el.dataset.b)),
    "ex-edit": (el) => sheetOpen(exerciseSheet(el.dataset.k)),
    "ex-mode": (el) => {
      readExercise();
      const d = R.sheet.draft;
      d.mode = el.dataset.v;
      if (d.mode === "time" && !R.sheet.key) d.reps = null;
      if (d.mode === "reps" && d.reps == null) d.reps = 10;
      render();
    },
    "ex-group": (el) => { readExercise(); const d = R.sheet.draft, k = el.dataset.v; if (d.groups.includes(k)) { if (d.groups.length > 1) d.groups = d.groups.filter((x) => x !== k); } else d.groups.push(k); render(); },
    "ex-save": async (el) => {
      readExercise();
      const s = R.sheet, d = s.draft;
      if (!d.name.trim()) { S.err = "Give it a name."; render(); return; }
      if (d.mode === "reps" && d.reps == null) { S.err = "A reps exercise needs reps per set."; render(); return; }
      const exercise = s.prep ? { key: s.key || undefined, block_key: "prep", name: d.name, seconds: d.seconds }
        : { key: s.key || undefined, block_key: s.block, name: d.name, mode: d.mode, sets: d.sets, reps: d.reps, seconds: d.mode === "time" ? Math.max(1, d.seconds || 0) : null, load_lb: d.load_lb, band: d.band, cues: d.cues, groups: d.groups };
      await save([{ op: "exercise", exercise }], el.dataset.when, `${d.name.trim()} saved.`);
    },
    "ex-retire-ask": () => { readExercise(); R.sheet.retire = true; render(); },
    "ex-retire-back": () => { R.sheet.retire = false; render(); },
    "ex-retire": async (el) => { await save([{ op: "exercise_retire", key: R.sheet.key }], el.dataset.when, "Retired; restore it any time."); },
    "ex-restore": (el) => {
      const e = R.exercises.find((x) => x.key === el.dataset.k);
      sheetOpen({ kind: "confirm", title: `Restore ${e.name}`, text: "It goes back into its block from the day you choose.", calls: [{ op: "exercise_restore", key: e.key }], done: "Restored." });
    },
    "ex-up": (el) => {
      const e = R.exercises.find((x) => x.key === el.dataset.k), list = exOf(e.block_key).map((x) => x.key), i = list.indexOf(e.key);
      [list[i - 1], list[i]] = [list[i], list[i - 1]];
      sheetOpen({ kind: "confirm", title: `Move ${e.name} up`, text: "The new order is used from the day you choose.", calls: [{ op: "exercise_order", block_key: e.block_key, keys: list }], done: "Order saved." });
    },
    "group-new": () => sheetOpen({ kind: "group", key: null, name: "" }),
    "group-edit": () => sheetOpen({ kind: "group", key: R.libTab, name: group(R.libTab).name }),
    "group-confirm": () => { R.sheet.confirm = true; render(); },
    "group-back": () => { R.sheet.confirm = false; render(); },
    "group-save": async (el) => {
      const name = (($("#g-name") || {}).value || "").trim();
      if (!name) { S.err = "Give the group a name."; render(); return; }
      R.sheet.name = name;
      await save([R.sheet.key ? { op: "group_rename", key: R.sheet.key, name } : { op: "group_add", name }], el.dataset.when, `${name} saved.`);
    },
    "group-remove": async (el) => { await save([{ op: "group_remove", key: R.sheet.key }], el.dataset.when, "Group removed; past records keep the label."); },
    "confirm-save": async (el) => { await save(R.sheet.calls, el.dataset.when, R.sheet.done); },
    "bands-edit": () => sheetOpen({ kind: "bands" }),
    "bands-save": async (el) => {
      const names = (($("#b-list") || {}).value || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (!names.length) { S.err = "At least one band."; render(); return; }
      await save([{ op: "bands", names }], el.dataset.when, "Bands saved.");
    },
    "tpl-tab": (el) => { R.tplTier = el.dataset.v; render(); },
    "tpl-save": async (el) => {
      const text = (($("#tpl-text") || {}).value || "").trim();
      if (!text) { S.err = "The template is empty."; render(); return; }
      await save([{ op: "template", tier: R.tplTier, template: text }], el.dataset.when, "Template saved.");
    },
  };

  function bind() {
    $$("[data-r]").forEach((el) => el.addEventListener("click", (ev) => {
      const a = actions[el.dataset.r];
      if (!a) return;
      if (el.dataset.r === "sheet-close" && ev.target !== el) return;
      ev.stopPropagation();
      a(el);
    }));
    const why = $("#r-reason");
    if (why) why.addEventListener("input", () => { R.reason = why.value; why.classList.remove("need"); });
    $$("[data-thr]").forEach((i) => i.addEventListener("input", () => { R.thrDraft[i.dataset.thr] = i.value; }));
    const bl = $("#b-list");
    if (bl) bl.addEventListener("input", () => { R.sheet.list = bl.value; });
    const gn = $("#g-name");
    if (gn) gn.addEventListener("input", () => { R.sheet.name = gn.value; });
    $$("[data-bnote]").forEach((i) => i.addEventListener("change", () => { R.noteDraft[i.dataset.bnote] = i.value; render(); }));
    const rs = $("#rs-min");
    if (rs) rs.addEventListener("input", () => { R.sheet.minutes = rs.value; });
    const t = $("#tpl-text");
    if (t) t.addEventListener("input", () => { R.tplDraft[R.tplTier] = t.value; $("#tpl-preview").textContent = fill(t.value, R.tplTier); });
  }

  const view = (renderer, withHistory) => ({
    open: async () => { S.msg = null; R.sheet = null; R.reason = ""; R.thrDraft = {}; R.tplDraft = {}; await load(); if (withHistory) await loadHistory(); },
    render: () => (R.loaded ? renderer() : tierBox("plain", "Rules", "Loading.")),
    bind,
  });
  window.PlannerViews = Object.assign(window.PlannerViews || {}, {
    "rules-thr": view(viewThr),
    "rules-sel": view(viewSel),
    "rules-lib": view(viewLib),
    "rules-tpl": view(viewTpl),
    "rules-hist": view(viewHist, true),
    "rules-goals": view(viewGoals),
    "rules-sched": view(viewSched),
  });
})();
