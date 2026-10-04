// The data request form on the privacy page: one post, then the same thank-you line whatever comes back.
(function () {
  "use strict";
  const form = document.getElementById("request");
  const thanks = document.getElementById("thanks");
  const config = window.PLANNER_CONFIG || {};
  if (!form || !thanks) return;
  const value = (id) => (document.getElementById(id) || {}).value || "";

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector("button");
    if (button) button.disabled = true;
    const body = { type: value("r-type"), message: value("r-message"), contact: value("r-contact"), website: value("r-website") };
    try {
      await fetch(`${config.supabaseUrl}/functions/v1/data-request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch { /* the line below is shown either way */ }
    form.hidden = true;
    thanks.hidden = false;
    thanks.focus && thanks.focus();
  });
})();
