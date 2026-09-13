# planner-app

A morning check-in that turns a few taps and two Oura screenshots into one finishable workout, on your phone, before the day starts.

## Install on the phone

1. Open `https://solutionwolfe.github.io/planner-app/` in Safari or DuckDuckGo.
2. Share, then Add to Home Screen.
3. Open the icon, enter your email, enter the code from the email.
4. Settings, Allow notifications.

That is the whole setup. Notifications and the one-time sign-in work only from the home-screen icon, not from a browser tab.

## Use

- **Check-in.** A notification arrives in the morning. Tap it, answer three questions by tapping (next commitment, anything unusual, how you feel), attach your Oura screenshots, and tap Get my plan. One follow-up question may come back first.
- **Plan.** Tier and why, total minutes, then the groups. Tap a group for its exercises, tap an exercise for the detail. Check, skip, or add; nothing is lost if you close the app mid-workout.
- **End workout.** Counts what was done, takes an optional note, and lands on Today's Calendar.
- **Today's Calendar.** The day's entries in order. Start and done taps are optional.
- **Check-in #2 and #3.** Any time later, from Today's Calendar.
- **Days.** Any past day. Changing a saved day asks for a reason.
- **Settings.** Notifications on or off for this device, a test check-in, sign out.

## What is in here

```
index.html            the page
app.css               styles
app.js                the app
sw.js                 service worker (notifications, offline shell)
manifest.webmanifest  home-screen install
icon.png              the app icon
config.js             public configuration
```

## Git hook

Commits on `main` are refused by a pre-commit hook (every change is a pull request). Install it once per checkout:

```bash
cp scripts/git-hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
```
