# planner-app

The web app half of the Oura planner: a morning check-in that turns a few taps and two Oura screenshots into one finishable workout. Served by GitHub Pages at `https://solutionwolfe.github.io/planner-app/`, installed on an iPhone home screen, signed in once, and pushed to at 4:30.

Everything else (the backend functions, the rules and library, the schedules, the runbook) lives in the private repo `planner`. One Supabase project, Personal Planner, serves both.

## What is in here

```
index.html            the page (noindex, home-screen meta)
app.css               the approved mockup's look
app.js                sign-in, check-in, follow-ups, plan, group, exercise, Today's Calendar, days, settings
sw.js                 service worker: shows every push, caches the shell; scoped to /planner-app/
manifest.webmanifest  home-screen install
icon.png              the one image file allowed (a clock at 4:30)
config.js             three public values: Supabase URL, anon key, VAPID public key
CLAUDE.md             working agreements for any Claude session here
.github/              PR template and ci.yml (media ban with the icon exception, em-dash scan, secret scan)
```

## How it runs

- The page loads the Supabase client with the anon key. Reads use row-level security, so a session sees only its own rows. Writes never touch a table: the app calls the Edge Functions `checkin-open`, `checkin-submit`, `event` and `push-subscribe` in the Personal Planner project with the session token.
- Sign-in is a magic link or a one-time code to one of the two allowed addresses. On an iPhone the home-screen app has its own storage, separate from Safari, so the code is the way to sign in inside the installed app; the link signs in the browser that opens it.
- Notifications: allow them once from inside the installed app (Settings in the app). The service worker shows every push and opens the app on tap.
- Oura screenshots are attached on the check-in screen. PNG and JPEG go up as they are; anything else (a HEIC photo of a screen) is converted to JPEG on the phone first.

## Privacy

What is public: this code and the three values in `config.js`, which are public by design. What is not: every screenshot, check-in, plan and event, the rules, the backend, every secret. See 3. Options, H2 plan item 3 and S-8, in the Confluence space Oura.

## Install on the phone

Open the address in Safari or DuckDuckGo, Share, Add to Home Screen. Open the icon, sign in with the code, allow notifications from Settings. That is the whole setup.
