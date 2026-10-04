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

  const R = { loaded: false, today: null, values: [], groups: [], blocks: [], exercises: [], exGroups: [], bands: [], cells: [], templates: [], history: [], gridTab: "morning", libTab: null, tplTier: "green", sheet: null, tplDraft: {}, thrDraft: {}, reason: "" };

  // ---------- data ----------
  const TABLES = {
    rule_values: (r) => r.key,
    training_groups: (r) => r.key,
    library_blocks: (r) => r.key,
    library_exercises: (r) => r.key,
    exercise_groups: (r) => r.exercise_key + "|" + r.group_key,
    bands: (r) => r.key,
    selection_cells: (r) => r.grid + "|" + r.tier + "|" + r.window_cell,
    note_templates: (r) => r.tier,
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
    const [v, g, b, e, eg, bd, c, t] = await Promise.all(Object.keys(TABLES).map((x) => current(x, R.today)));
    R.values = v.sort(byPos);
    R.groups = g.sort(byPos);
    R.blocks = b.sort(byPos);
    R.exercises = e.sort(byPos);
    R.exGroups = eg.filter((r) => r.active);
    R.bands = bd.filter((r) => !r.retired_at).sort(byPos);
    R.cells = c;
    R.templates = t;
    if (!R.libTab || !liveGroups().some((x) => x.key === R.libTab)) R.libTab = (liveGroups()[0] || {}).key || null;
    R.loaded = true;
  }
  async function loadHistory() {
    const [v, g, b, e, bd, c, t] = await Promise.all(["rule_values", "training_groups", "library_blocks", "library_exercises", "bands", "selection_cells", "note_templates"].map(changes));
    const { data: seed } = await sb.from("rule_values").select("created_at").eq("source", "seed").order("created_at", { ascending: true }).limit(1);
    R.history = history({ v, g, b, e, bd, c, t, seeded: seed && seed[0] ? seed[0].created_at : null });
  }

  function history(raw) {
    const out = [];
    const add = (r, what) => out.push({ at: r.created_at, from: r.effective_from, what, reason: r.reason });
    raw.v.forEach((r) => add(r, `${r.label}: ${Number(r.value)}${r.unit ? " " + r.unit : ""}`));
    raw.g.forEach((r) => add(r, r.retired_at ? `Group removed: ${r.name}` : `Group: ${r.name}`));
    raw.b.forEach((r) => { if (r.key === "prep") add(r, `Prep total: ${r.minutes} min`); else if (!r.retired_at) add(r, `Block: ${r.name}`); });
    raw.e.forEach((r) => add(r, `${r.name}${r.excluded ? ": retired" : ": saved"}`));
    raw.bd.forEach((r) => add(r, r.retired_at ? `Band removed: ${r.name}` : `Band: ${r.name}`));
    raw.c.forEach((r) => add(r, `Grid ${r.grid}, ${tierName(r.tier)} × ${colName(r.window_cell)}: ${r.blocks.map((k) => (R.blocks.find((x) => x.key === k) || {}).name || k).join(", ") || "rest"}`));
    raw.t.forEach((r) => add(r, `Note template, ${tierName(r.tier)}`));
    if (raw.seeded) out.push({ at: raw.seeded, from: null, what: "Rules seeded.", reason: "" });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 150);
  }

  const liveGroups = () => R.groups.filter((g) => !g.retired_at);
  const group = (k) => R.groups.find((g) => g.key === k);
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
  const cell = (grid, tier, col) => R.cells.find((c) => c.grid === grid && c.tier === tier && c.window_cell === col);
  function viewSel() {
    const grid = R.gridTab;
    return `${crumb("Selection grid")}
      <div class="tabs"><button data-r="grid-tab" data-v="morning" aria-pressed="${grid === "morning"}">Morning (check-in #1)</button><button data-r="grid-tab" data-v="later" aria-pressed="${grid === "later"}">Later (every check-in after the first)</button></div>
      <p class="muted">${grid === "morning" ? "Used by check-in #1. Prep is not in the grid: it runs before the morning session." : "Used by every check-in after the first, for the time left."} Tap a cell to change its blocks.</p>
      <div class="gridwrap"><table class="grid"><tr><th>Tier</th>${COLS.map((c) => `<th>${colName(c)}</th>`).join("")}</tr>
        ${TIERS.map((t) => `<tr><th>${tierName(t)}</th>${COLS.map((c) => { const x = cell(grid, t, c); const ks = x ? x.blocks : []; const bad = !x || ks.some((k) => !block(k)); return `<td class="c${bad ? " bad" : ""}" data-r="cell" data-t="${t}" data-c="${c}">${ks.length ? ks.map((k) => `<div class="cellb"><b>${esc(block(k) ? block(k).name : k)}</b>${esc(block(k) ? group(block(k).group_key).name : "missing")}</div>`).join("") : '<div class="cellb">rest</div>'}${x ? pending(x) : ""}</td>`; }).join("")}</tr>`).join("")}
      </table></div>${sheet()}`;
  }
  function sheetCell() {
    const s = R.sheet, d = s.draft;
    const total = d.reduce((a, k) => a + (block(k) ? block(k).minutes : 0), 0);
    return `<div class="h2">Cell: ${tierName(s.tier)} × ${colName(s.col)} (${s.grid})</div>
      <p class="muted">Blocks in this cell, in order. A missing block shows red and cannot be saved.</p>
      <div class="stack">${d.length ? d.map((k, i) => `<div class="cellrow"${block(k) ? "" : ' style="color:var(--red)"'}><span>${block(k) ? esc(block(k).name) + ` <span class="grp">${esc(group(block(k).group_key).name)}</span>` : esc(k) + " (missing)"}</span><button data-r="cell-up" data-i="${i}" aria-label="move up">↑</button><button data-r="cell-down" data-i="${i}" aria-label="move down">↓</button><button data-r="cell-rm" data-i="${i}" aria-label="remove">−</button></div>`).join("") : '<p class="muted">Rest: no blocks.</p>'}</div>
      <div class="pick"><div class="pg">Add a block</div>${liveGroups().filter((g) => g.key !== "prep").map((g) => `<div class="pg">${esc(g.name)}</div>${blocksOf(g.key).map((b) => `<button data-r="cell-add" data-k="${esc(b.key)}"${d.includes(b.key) || !liveEx(b.key).length ? " disabled" : ""}>${esc(b.name)} <span class="min">${liveEx(b.key).length ? b.minutes + " min" : "no exercises yet"}</span></button>`).join("")}`).join("")}</div>
      <p class="muted">Total: ${total} min for a ${s.col === "none" ? "no-window" : s.col + "-minute"} cell.</p>${reasonBox()}${saveRow("cell-save")}`;
  }

  // ---------- library ----------
  function viewLib() {
    const g = group(R.libTab);
    if (!g) return `${crumb("Library")}<p class="muted">No groups yet.</p>`;
    const isPrep = g.key === "prep";
    return `${crumb("Library")}
      <div class="tabs">${liveGroups().map((x) => `<button data-r="lib-tab" data-v="${esc(x.key)}" aria-pressed="${x.key === g.key}">${esc(x.name)}</button>`).join("")}</div>
      <div class="rowbtns"><button class="addset" data-r="group-new">+ Add a group</button>${isPrep ? "" : `<button class="addset" data-r="group-edit">Rename or remove ${esc(g.name)}</button>`}</div>
      ${isPrep ? `<p class="muted">Prep entries are a title and minutes each; their total (${prepTotal()} min) is taken off the window before the morning session.</p>` : ""}
      <div class="stack">${blocksOf(g.key).map((b) => `<div class="blk"><div class="nm">${esc(b.name)} <span class="min">${b.minutes} min</span></div>
        ${exOf(b.key).map((e, i) => `<div class="kv${e.excluded ? " retired" : ""}"><div class="k">${esc(e.name)}<span class="tmpl">${e.mode}</span>${pending(e)}<small>${e.excluded ? "retired: " + esc(e.exclusion_reason || "") : esc(e.cues || "no cue") + " · " + setText(e) + (groupsOf(e.key).length > 1 ? " · also in " + groupsOf(e.key).filter((x) => x !== g.key).map((x) => esc((group(x) || {}).name || x)).join(", ") : "")}</small></div><div class="kvb">${e.excluded ? `<button class="x" data-r="ex-restore" data-k="${esc(e.key)}">restore</button>` : `<button class="x" data-r="ex-edit" data-k="${esc(e.key)}">edit</button>${i > 0 ? ` <button class="x" data-r="ex-up" data-k="${esc(e.key)}" aria-label="move up">↑</button>` : ""}`}</div></div>`).join("")}
        <button class="addset" data-r="ex-new" data-b="${esc(b.key)}">+ ${isPrep ? "prep entry" : "exercise or activity in " + esc(b.name)}</button></div>`).join("") || '<p class="muted">This group has no blocks.</p>'}
        ${also(g.key).length ? `<div class="blk"><div class="nm">Also in ${esc(g.name)}</div>${also(g.key).map((e) => `<div class="kv"><div class="k">${esc(e.name)}<span class="tmpl">${e.mode}</span>${pending(e)}<small>${esc((R.blocks.find((b) => b.key === e.block_key) || {}).name || "")} · ${setText(e)}</small></div><div class="kvb"><button class="x" data-r="ex-edit" data-k="${esc(e.key)}">edit</button></div></div>`).join("")}</div>` : ""}</div>
      <div class="card"><div class="h">Bands</div><div class="line">${R.bands.map((b) => `<span class="grp">${esc(b.name)}</span>`).join(" ")} <button class="link" data-r="bands-edit">edit</button></div><p class="muted">The load choices offered on every set, next to weight in lb.</p></div>${sheet()}`;
  }
  function sheetExercise() {
    const d = R.sheet.draft;
    if (R.sheet.prep) {
      return `<div class="h2">${R.sheet.key ? esc(d.name) : "New prep entry"}</div>
        <label class="fld"><span>Title</span><input type="text" id="e-name" value="${esc(d.name)}" maxlength="80" placeholder="e.g. Coffee"></label>
        <label class="fld"><span>Minutes</span><input type="number" id="e-min" inputmode="numeric" min="1" value="${Math.round((d.seconds || 600) / 60)}"></label>
        <p class="muted">Prep is a title and minutes; no sets, reps or load.</p>${reasonBox()}
        <div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button>${R.sheet.key ? '<button class="btn sm" data-r="ex-retire">Retire</button>' : ""}<button class="btn sm" data-r="ex-save" data-when="today">Save for today</button><button class="btn sm dark" data-r="ex-save" data-when="tomorrow">Save from tomorrow</button></div>`;
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
      <div class="acts"><button class="btn sm" data-r="sheet-close">Cancel</button>${R.sheet.key ? '<button class="btn sm" data-r="ex-retire">Retire</button>' : ""}<button class="btn sm" data-r="ex-save" data-when="today">Save for today</button><button class="btn sm dark" data-r="ex-save" data-when="tomorrow">Save from tomorrow</button></div>`;
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
        ${reasonBox()}<div class="acts"><button class="btn sm" data-r="group-back">Go back</button><button class="btn sm dark" data-r="group-remove" data-when="today">Remove ${esc(g.name)}</button></div>`;
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
  function sheet() {
    if (!R.sheet) return "";
    const body = { cell: sheetCell, exercise: sheetExercise, group: sheetGroup, bands: sheetBands }[R.sheet.kind]();
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

  /** A change with no fields of its own: asks for the reason, then saves from tomorrow. */
  async function quick(label, calls, done) {
    const why = (window.prompt(label + " (required)", "") || "").trim();
    if (!why) return;
    S.msg = null;
    await busy("Saving", async () => { for (const body of calls) await fn("rules-update", { ...body, reason: why, apply: "tomorrow" }); await load(); S.msg = `${done} Takes effect tomorrow.`; });
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
    "cell": (el) => { const x = cell(R.gridTab, el.dataset.t, el.dataset.c); sheetOpen({ kind: "cell", grid: R.gridTab, tier: el.dataset.t, col: el.dataset.c, draft: x ? x.blocks.slice() : [] }); },
    "cell-up": (el) => { const d = R.sheet.draft, i = Number(el.dataset.i); if (i > 0) [d[i - 1], d[i]] = [d[i], d[i - 1]]; render(); },
    "cell-down": (el) => { const d = R.sheet.draft, i = Number(el.dataset.i); if (i < d.length - 1) [d[i + 1], d[i]] = [d[i], d[i + 1]]; render(); },
    "cell-rm": (el) => { R.sheet.draft.splice(Number(el.dataset.i), 1); render(); },
    "cell-add": (el) => { R.sheet.draft.push(el.dataset.k); render(); },
    "cell-save": async (el) => {
      const s = R.sheet;
      if (s.draft.some((k) => !block(k))) { S.err = "This cell names a block that does not exist; remove it first."; render(); return; }
      await save([{ op: "cell", grid: s.grid, tier: s.tier, window_cell: s.col, blocks: s.draft }], el.dataset.when, "Cell saved.");
    },
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
    "ex-retire": async () => { await save([{ op: "exercise_retire", key: R.sheet.key }], "tomorrow", "Retired; restore it any time."); },
    "ex-restore": (el) => quick("Reason for restoring", [{ op: "exercise_restore", key: el.dataset.k }], "Restored."),
    "ex-up": (el) => {
      const e = R.exercises.find((x) => x.key === el.dataset.k), list = exOf(e.block_key).map((x) => x.key), i = list.indexOf(e.key);
      [list[i - 1], list[i]] = [list[i], list[i - 1]];
      quick("Reason for the new order", [{ op: "exercise_order", block_key: e.block_key, keys: list }], "Order saved.");
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
    "group-remove": async () => { await save([{ op: "group_remove", key: R.sheet.key }], "tomorrow", "Group removed; past records keep the label."); },
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
  });
})();
