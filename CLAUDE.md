# CLAUDE.md

Working agreements for any Claude session in this repo. Do not relax them. The private half of this system carries the full rules and the runbook; a session that works here reads those first.

## What this repo is

The static web app, served by GitHub Pages. Public means anyone can read and copy the code; it never means anyone can sign in or see data.

## Rules

- **Only public configuration here.** `config.js` holds values that are meant to ship in a client. No secret, no private name, no internal detail, ever. If a secret lands in this repo it counts as leaked the moment it is pushed: rotate first, then remove.
- **No personal data.** No screenshots, no check-ins, no plans, no test data. `icon.png` is the one image allowed, by name, in `.gitignore` and `ci.yml`.
- **No em dashes** anywhere: not in code, comments, commits, or UI text.
- **Minimal disclosure on every public surface** (the repo, the screens, every error, the emails). No personal name, address, home folder path, health detail, or device detail. Nothing that describes how sign-in is gated, what the backend checks, which service does what, where it runs, how secrets are kept, or what the private half contains. Errors and messages say nothing useful to a stranger: a refused sign-in and a sent code read the same. Comments and docs describe what the code does, not why it is safe. `ci.yml` fails on a short list of words.
- **The app never writes to storage directly.** Every write goes through a backend call with the session; reads go through the session too.
- **Every change is a pull request**: one branch per step, PR against `main`, never a direct commit to `main`, every box of `.github/pull_request_template.md` ticked, `ci.yml` green, the owner merges. Pages deploys `main` on its own.
- **Keep this file true.** Any PR that changes an address, a configuration value's location or a route updates `CLAUDE.md` in the same PR.

## Where things are

| Thing | Where |
| --- | --- |
| Page, styles, logic | `index.html`, `app.css`, `app.js` |
| Service worker | `sw.js`, scoped to `/planner-app/`; shows every push; caches only the shell |
| Install | `manifest.webmanifest`, `icon.png` |
| Public configuration | `config.js` |
| Pages deployment | `.github/workflows/static.yml` |

## Testing

The real check-in is the test: "Start a test check-in" in the app creates a check-in flagged as a test through the same path as a real morning. No fake clock, no mock data.
