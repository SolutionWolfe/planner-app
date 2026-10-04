// Settings, Oura: connect, pause, resume and disconnect. The screen shows where the connection
// stands and offers the next step; every tap is one backend call with the signed-in session.
(function () {
  "use strict";
  const X = window.PlannerCtx;
  if (!X) return;
  const { fn, esc, busy, go, render, tierBox, S } = X;
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const O = { loaded: false, c: null, confirm: false };

  function day(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" }).format(new Date(iso));
  }

  async function load() {
    O.c = await fn("oura-connect", { action: "check" });
    O.loaded = true;
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
    }
  }

  function card(title, line, buttons) {
    return `<div class="tier plain"><div class="t">${esc(title)}</div><div class="why">${esc(line)}</div></div>
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
      return card(`Paused${c.paused_at ? " since " + day(c.paused_at) : ""}`, "Nothing is read until you resume. Everything stored stays.", [btn("resume", "Resume", "accent"), btn("disconnect", "Disconnect Oura")]);
    }
    return card(`Connected${since}`, "Pause stops reading until you resume. Disconnect withdraws access at Oura.", [btn("pause", "Pause Oura"), btn("disconnect", "Disconnect Oura")]);
  }

  const actions = {
    back: () => { S.msg = null; go("settings"); },
    connect: () => busy("Opening Oura", async () => {
      const r = await fn("oura-connect", { action: "begin" });
      if (!r || typeof r.url !== "string" || !/^https?:\/\//.test(r.url)) throw new Error("That did not go through.");
      window.location.assign(r.url);
    }),
    pause: () => busy("Pausing", async () => { O.c = await fn("oura-disconnect", { action: "pause" }); S.msg = "Paused."; }),
    resume: () => busy("Resuming", async () => { O.c = await fn("oura-disconnect", { action: "resume" }); S.msg = "Resumed."; }),
    disconnect: () => { O.confirm = true; S.msg = null; render(); },
    "disconnect-no": () => { O.confirm = false; render(); },
    "disconnect-yes": () => busy("Disconnecting", async () => {
      O.confirm = false;
      const r = await fn("oura-disconnect", { action: "disconnect" });
      O.c = r;
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
