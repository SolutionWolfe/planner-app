// Settings, Oura: connect, pause, resume and disconnect, and once connected, when it was last read
// and how much history has been fetched. The screen shows where things stand and offers the next
// step; every tap is a backend call with the signed-in session.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { fn, esc, busy, go, render, tierBox, S } = X;
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const O = { loaded: false, c: null, rec: null, confirm: false };

  function day(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(new Date(iso));
  }

  function when(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  }

  async function loadRecord() {
    O.rec = null;
    if (!O.c || O.c.state === "none") return;
    try { O.rec = await fn("oura-pull", { action: "status" }); } catch { O.rec = null; }
  }

  async function load() {
    O.c = await fn("oura-connect", { action: "check" });
    await loadRecord();
    O.loaded = true;
  }

  /** History is fetched a month a call; keep asking until it is done or a call does not go through. */
  async function fetchHistory() {
    for (let i = 0; i < 120; i++) {
      const r = await fn("oura-pull", { action: "backfill" });
      if (r.backfill) { O.rec = Object.assign(O.rec || {}, { backfill: r.backfill }); S.busy = `Fetching history, ${r.backfill.months_done} of ${r.backfill.months_total} months`; render(); }
      if (r.status === "finished") { S.msg = "History is in."; return; }
      if (r.status !== "ok") { S.msg = null; throw new Error(r.status === "paused" ? "Paused. Resume first." : "That stopped part way. Try again in a few minutes."); }
    }
  }

  function record() {
    const r = O.rec;
    if (!r) return "";
    const b = r.backfill;
    const read = r.last_pull ? `Last read ${when(r.last_pull.at)}${r.last_pull.ok ? "" : " (not everything came back)"}.` : "Not read yet.";
    let history = "History: not fetched yet.";
    if (b && b.finished) history = `History: ${b.first_month} to ${b.last_month}, all ${b.months_total} months.`;
    else if (b) history = `History: ${b.months_done} of ${b.months_total} months (${b.first_month} to ${b.last_month}).${b.stalled ? " The last try did not finish." : ""}`;
    return `<div class="tier plain"><div class="t">What has been read</div><div class="why">${esc(read)} ${esc(history)}</div></div>`;
  }

  /** Back from the Allow page: hand over what came back, once, and show the result. */
  async function finish(back) {
    O.confirm = false;
    const sent = back.error ? { action: "callback", error: back.error, state: back.state } : { action: "callback", code: back.code, state: back.state, scope: back.scope || "" };
    try {
      O.c = await fn("oura-connect", sent);
      O.loaded = true;
      S.err = null;
      S.msg = O.c.state === "connected" && !back.error ? "Connected." : "Not connected. Try again when you like.";
    } catch (e) {
      S.msg = null;
      S.err = e.message || String(e);
      try { await load(); } catch { O.c = { state: "none" }; O.loaded = true; }
      return;
    }
    await loadRecord();
  }

  function card(title, line, buttons, extra) {
    return `<div class="tier plain"><div class="t">${esc(title)}</div><div class="why">${esc(line)}</div></div>${extra || ""}
      <div class="stack">${buttons.join("")}
        <button class="btn" data-o="back">Back to Settings</button></div>`;
  }
  const btn = (act, label, cls) => `<button class="btn ${cls || ""}" data-o="${act}" ${S.busy ? "disabled" : ""}>${esc(label)}</button>`;

  function view() {
    const c = O.c || { state: "none" };
    if (O.confirm) {
      return card("Disconnect Oura?", "Access is withdrawn at Oura and nothing more is read. What is already stored stays.", [btn("disconnect-yes", "Yes, disconnect", "accent"), btn("disconnect-no", "Cancel")]);
    }
    if (c.state === "none") {
      return card("Not connected", "Connect once at Oura. Until then the app works as it does today.", [btn("connect", "Connect Oura", "accent")]);
    }
    const since = c.connected_at ? ` since ${day(c.connected_at)}` : "";
    if (c.needs_attention) {
      return card("Connection needs renewing", `Connected${since}, but the last renewal did not go through. Connect again to carry on.`, [btn("connect", "Reconnect Oura", "accent"), btn("disconnect", "Disconnect Oura")]);
    }
    if (c.state === "paused") {
      return card(`Paused${c.paused_at ? " since " + day(c.paused_at) : ""}`, "Nothing is read until you resume. Everything stored stays.", [btn("resume", "Resume", "accent"), btn("disconnect", "Disconnect Oura")], record());
    }
    const b = O.rec && O.rec.backfill;
    const more = [btn("read", "Read now")];
    if (!b || !b.finished) more.push(btn("history", b ? "Fetch the rest of the history" : "Fetch history", "accent"));
    return card(`Connected${since}`, "Pause stops reading until you resume. Disconnect withdraws access at Oura.", [...more, btn("pause", "Pause Oura"), btn("disconnect", "Disconnect Oura")], record());
  }

  const actions = {
    back: () => { S.msg = null; go("settings"); },
    connect: () => busy("Opening Oura", async () => {
      const r = await fn("oura-connect", { action: "begin" });
      if (!r || typeof r.url !== "string" || !/^https?:\/\//.test(r.url)) throw new Error("That did not go through.");
      window.location.assign(r.url);
    }),
    read: () => busy("Reading", async () => {
      const r = await fn("oura-pull", { action: "pull" });
      O.rec = Object.assign(O.rec || {}, { last_pull: r.last_pull, backfill: r.backfill });
      if (r.status !== "ok" && r.status !== "partial") { S.msg = null; throw new Error("That did not go through. Try again in a few minutes."); }
      S.msg = r.status === "ok" ? "Read." : "Read, but not everything came back.";
    }),
    history: () => busy("Fetching history", async () => { S.msg = null; await fetchHistory(); }),
    pause: () => busy("Pausing", async () => { O.c = await fn("oura-disconnect", { action: "pause" }); S.msg = "Paused."; }),
    resume: () => busy("Resuming", async () => { O.c = await fn("oura-disconnect", { action: "resume" }); S.msg = "Resumed."; }),
    disconnect: () => { O.confirm = true; S.msg = null; render(); },
    "disconnect-no": () => { O.confirm = false; render(); },
    "disconnect-yes": () => busy("Disconnecting", async () => {
      O.confirm = false;
      const r = await fn("oura-disconnect", { action: "disconnect" });
      O.c = r;
      O.rec = null;
      S.msg = r.revoked ? "Disconnected." : "Disconnected here. Oura could not be reached, so also remove Planner in the Oura app.";
    }),
  };

  function bind() {
    $$("[data-o]").forEach((el) => el.addEventListener("click", () => { const a = actions[el.dataset.o]; if (a) a(); }));
  }

  window.PlannerViews = Object.assign(window.PlannerViews || {}, {
    conn: {
      open: async () => { S.msg = null; O.confirm = false; await load(); },
      render: () => (O.loaded ? view() : tierBox("plain", "Oura", "Loading.")),
      bind,
      finish,
    },
  });
})();
