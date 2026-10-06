# planner-app

A morning check-in that turns a few taps and last night's values from your Oura account into one finishable workout, on your phone, before the day starts.

## Install on the phone

1. Open `https://solutionwolfe.github.io/planner-app/` in Safari or DuckDuckGo.
2. Share, then Add to Home Screen.
3. Open the icon, enter your email, enter the code from the email.
4. Settings, Allow notifications.

That is the whole setup. Notifications and the one-time sign-in work only from the home-screen icon, not from a browser tab.

## Use

- **Home.** The app opens on today: the date, where the last plan day ended, and what is next. Start today opens the morning check-in; a plan in progress shows its blocks; Check in again makes a new plan that takes the place of the unfinished part of the earlier one; a day left unfinished can be closed in two taps, which records what was left as skipped; any item can be marked done first, with the time it took.
- **Check-in.** Start today opens it. Say when your first commitment is, keep or drop today's prep entries, say if anything is unusual and how you feel, then tap Make today's plan. With your Oura account connected the plan is made from last night's values; with nothing from the ring you can type the night's numbers or leave them blank. One question may come back first. While the plan is made the screen says what it is doing. If the ring has not synced yet, Open Oura to sync opens the Oura app and the check-in reads again when you come back. Check in again later in the day asks how much time is left and plans the rest of the day; what is done stays done. On a block, + Add from the library records something extra as done, and can keep it in the block from tomorrow. (With the connection paused, the earlier screen with screenshots comes back.)
- **Plan.** Tier and why, total minutes, then the blocks. Tap a block for its exercises, each with its sets: change the reps, the time (minutes and seconds), the weight or the band, add or remove a set, and tap a set when it is done. Every change is saved as it is made; a change to a past day asks for a reason once. Tap an exercise's name for the detail.
- **End workout.** Counts what was done, takes an optional note, and lands on Today's Calendar.
- **Today's Calendar.** The day's entries in order. Start and done taps are optional.
- **Check-in #2 and #3.** Any time later, from Today's Calendar.
- **Days.** Any past day: the night's values once Oura is connected, the day's blocks and where each stands, anything you add from the library as done that day, and a note. Changing a past day asks for a reason.
- **Privacy and terms.** Two plain pages, linked from Settings. No form and no script.
- **Settings.** Oura: connect once (Connect Oura, then Allow on Oura's page), pause and resume, or disconnect; once connected it shows when it was last read and how much history is in, with Read now and Fetch history. Notifications on or off for this device, a test check-in, sign out. Under Rules: thresholds, the selection grid, the library and the note templates, each change saved with a reason and in force from tomorrow unless you apply it today; History lists every change.

## What is in here

```
index.html            the page
app.css               styles
app.js                the app
rules.js              the rules screens under Settings
home.js               the home screen for today
sets.js               the block screen with its sets
connect.js            the Oura screen under Settings
checkin.js            the check-in and the processing screen
day.js                the Day view: any day, its values, blocks, additions and note
privacy.html          the privacy policy
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
