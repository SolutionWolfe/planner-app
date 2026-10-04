# planner-app

A morning check-in that turns a few taps and two Oura screenshots into one finishable workout, on your phone, before the day starts.

## Install on the phone

1. Open `https://solutionwolfe.github.io/planner-app/` in Safari or DuckDuckGo.
2. Share, then Add to Home Screen.
3. Open the icon, enter your email, enter the code from the email.
4. Settings, Allow notifications.

That is the whole setup. Notifications and the one-time sign-in work only from the home-screen icon, not from a browser tab.

## Use

- **Home.** The app opens on today: the date, where the last plan day ended, and what is next. Start today opens the morning check-in; a plan in progress shows its blocks; Check in again makes a new plan that takes the place of the unfinished part of the earlier one; a day left unfinished can be closed in two taps, which records what was left as skipped; any item can be marked done first, with the time it took.
- **Check-in.** A notification arrives in the morning. Tap it, answer three questions by tapping (next commitment, anything unusual, how you feel), attach your Oura screenshots, and tap Get my plan. One follow-up question may come back first.
- **Plan.** Tier and why, total minutes, then the blocks. Tap a block for its exercises, each with its sets: change the reps, the time (minutes and seconds), the weight or the band, add or remove a set, and tap a set when it is done. Every change is saved as it is made; a change to a past day asks for a reason once. Tap an exercise's name for the detail.
- **End workout.** Counts what was done, takes an optional note, and lands on Today's Calendar.
- **Today's Calendar.** The day's entries in order. Start and done taps are optional.
- **Check-in #2 and #3.** Any time later, from Today's Calendar.
- **Days.** Any past day. Changing a saved day asks for a reason.
- **Privacy and terms.** Two plain pages, linked from Settings. The privacy page has a short form for asking to see, correct or delete data.
- **Settings.** Notifications on or off for this device, a test check-in, sign out. Under Rules: thresholds, the selection grid, the library and the note templates, each change saved with a reason and in force from tomorrow unless you apply it today; History lists every change.

## What is in here

```
index.html            the page
app.css               styles
app.js                the app
rules.js              the rules screens under Settings
home.js               the home screen for today
sets.js               the block screen with its sets
privacy.html          the privacy policy and the data request form
privacy.js            the form's one post
terms.html            the terms of use
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
