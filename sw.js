// Service worker, scoped to /planner-app/. Two jobs: show every push as a notification, and keep
// the app shell available offline. Data is never cached.
const VERSION = "planner-app-v1";
const SHELL = ["./", "./index.html", "./app.css", "./app.js", "./config.js", "./manifest.webmanifest", "./icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first for the shell, cache as the fallback. Anything outside the scope is not touched.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html"))),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Planner", body: event.data ? event.data.text() : "" }; }
  const title = data.title || "Planner";
  const options = {
    body: data.body || "Open the app.",
    icon: "./icon.png",
    badge: "./icon.png",
    tag: data.checkin_id || data.calendar_id || "planner",
    data: { url: data.url || "./" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) { client.navigate(url); return client.focus(); }
      }
      return self.clients.openWindow(url);
    }),
  );
});
