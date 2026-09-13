# CLAUDE.md

Working agreements for any Claude session in this repo. Jess set these; do not relax them. The private repo `planner` (checkout `/Users/jess/Documents/GitHub/planner`) carries the same file, the runbook and the backend; this one points back to it.

## What this repo is

The public half of the Oura planner (3. Options, H2, chosen 2026-09-08): the static web app served by GitHub Pages at `https://solutionwolfe.github.io/planner-app/`. Public means anyone can read the code; it never means anyone can sign in or see data (S-8 on 3. Options). The plan lives in Confluence space **Oura**; **5. Build** is the working page. Read it before doing anything.

## Rules

- **Only public values here.** `config.js` holds the Supabase project URL, the anon key and the VAPID public key, all public by design. No secret, no private name, ever. If a secret lands in this repo it is leaked the moment it is pushed: rotate first, then remove (S-8).
- **No personal data** (D28): no screenshots, no check-ins, no plans, no test mornings. `icon.png` is the one image allowed, by name, in `.gitignore` and `ci.yml`.
- **No em dashes** anywhere: not in code, comments, commits, or UI text.
- **The app never writes to a table.** Every write goes through a named Edge Function in `planner` (`checkin-open`, `checkin-submit`, `event`, `push-subscribe`); reads go through the anon key with row-level security (D30, S-3).
- **Every change is a pull request** (D31): one branch per step (`step-6-app`), PR against `main`, never a direct commit to `main`, every box of `.github/pull_request_template.md` ticked, `ci.yml` green, Jess merges. Pages deploys `main` on its own; there is no deploy workflow.
- **Claude Code is the only route into the repo** (D26). No `gh` login on the Mac: when a branch is ready, stop and tell Jess; she pushes from GitHub Desktop and opens the PR.
- **Keep this file true.** Any PR that changes an address, a public value's location or a route updates `CLAUDE.md` in the same PR.
- **Nothing here talks to Confluence, Cowork or the Mac.** Production is this page plus the Supabase project Personal Planner (ref `wtfbgkyncffvtzacqqng`); one project serves both repos.

## Where things are

| Thing | Where |
| --- | --- |
| Page, styles, logic | `index.html`, `app.css`, `app.js` (the approved mockup, real) |
| Service worker | `sw.js`, scoped to `/planner-app/`; shows every push; caches only the shell |
| Install | `manifest.webmanifest`, `icon.png` |
| Public values | `config.js` |
| Backend, rules, runbook, schedules | the private repo `planner` |

## Testing

The real check-in is the test: "Start a test check-in" in the app creates a check-in flagged `is_test` through the same functions as a real morning (D24). No fake clock, no mock data.
