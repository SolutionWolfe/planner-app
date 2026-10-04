# planner-app

A morning check-in that turns a few taps and two Oura screenshots into one finishable workout, on your phone, before the day starts.

## Install on the phone

1. Open `https://solutionwolfe.github.io/planner-app/` in Safari or DuckDuckGo.
2. Share, then Add to Home Screen.
3. Open the icon, enter your email, enter the code from the email.
4. Settings, Allow notifications.

That is the whole setup. Notifications and the one-time sign-in work only from the home-screen icon, not from a browser tab.

## Use

- **Home.** The app opens on today: the date, where the last plan day ended, and what is next. Start today opens the morning check-in; a plan in progress shows its blocks; a day left unfinished can be closed in two taps, which records what was left as skipped.
- **Check-in.** A notification arrives in the morning. Tap it, answer three questions by tapping (next commitment, anything unusual, how you feel), attach your Oura screenshots, and tap Get my plan. One follow-up question may come back first.
- **Plan.** Tier and why, total minutes, then the groups. Tap a group for its exercises, tap an exercise for the detail. Check, skip, or add; nothing is lost if you close the app mid-workout.
- **End workout.** Counts what was done, takes an optional note, and lands on Today's Calendar.
- **Today's Calendar.** The day's entries in order. Start and done taps are optional.
- **Check-in #2 and #3.** Any time later, from Today's Calendar.
- **Days.** Any past day. Changing a saved day asks for a reason.
- **Settings.** Notifications on or off for this device, a test check-in, sign out. Under Rules: thresholds, the selection grid, the library and the note templates, each change saved with a reason and in force from tomorrow unless you apply it today; History lists every change.

## What is in here

```
index.html            the page
app.css               styles
app.js                the app
rules.js              the rules screens under Settings
home.js               the home screen for today
sw.js                 service worker (notifications, offline shell)
manifest.webmanifest  home-screen install
icon.png              the app icon
config.js             public configuration
```

## Git hook

Commits on `main` and pushes of `main` are refused by hooks (every change is a pull request). Install it once per checkout:

```bash
cp scripts/git-hooks/pre-commit scripts/git-hooks/pre-push .git/hooks/ && chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

The `main-guard` workflow turns red when a commit reaches `main` without a merged pull request.
