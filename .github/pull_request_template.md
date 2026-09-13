## What this PR does

Build Plan step: <!-- e.g. 6, Web app -->
Decisions it implements: <!-- e.g. D27, D28, D31 -->
Summary in two sentences:

## Self-review checklist (Claude fills this in before asking Jess to look; every box or the PR does not open)

- [ ] No secrets anywhere in the diff. This repo holds only the three public values (Supabase URL, anon key, VAPID public key); private names are referenced nowhere in the app.
- [ ] No personal data in the diff: no screenshots, check-ins, plans, test mornings (D28). `icon.png` is the only image.
- [ ] No em dashes in code, comments, docs, or UI text.
- [ ] Every write goes through a named Edge Function; the app never writes to a table directly (D30).
- [ ] A test check-in (`is_test = true`) was run through the changed screens, and the result is written below.
- [ ] Confluence updated if this PR changed a requirement or decision (Build Plan first, then every affected page), or "no page change needed" is stated below.
- [ ] `README.md` and `CLAUDE.md` in this repo still true, and the `planner` repo's RUNBOOK still true for anything this PR touches (address, kill switch, key rotation).

## Test check-in result

<!-- Date, what was tapped, what came back, anything odd. -->

## Where to look first

<!-- The one file the reviewer should read before anything else. -->
