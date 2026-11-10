# Every Word: Setup Guide

Every Word puts the sermon on people's phones as live captions, in large print or another language. Readers scan a QR code; they don't need an app or an account.

**Cost:** $0 a month for most churches.
**Time:** about 20 minutes for English captions, plus 10 more for translation.
**You need:** a free GitHub account, a free Google account, and a laptop with Google Chrome or Microsoft Edge in the sound booth.

---

## Part 1: Put the files on GitHub (5 minutes)

1. Go to **github.com** and sign in or create a free account.
2. Click **+** (top right) → **New repository**. Name it `every-word`, choose **Public**, and click **Create repository**.
3. Click **uploading an existing file**. Drag in every file from this folder, *including the `worker` folder*. Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Branch*, choose **main** and **/ (root)**, then **Save**.
5. After a minute or two, the page shows your site's address, something like
   `https://yourname.github.io/every-word/`
   Write it down. Readers use this address; the booth uses the same address with `booth.html` on the end.

---

## Part 2: Set up Firebase to relay the captions (10–15 minutes)

1. Go to **console.firebase.google.com** and sign in with a Google account (a church account is best).
2. Click **Create a project**. Name it `every-word`. You can turn Google Analytics off. Click **Create project**.
3. In the left menu: **Build → Realtime Database → Create database**. Pick the location closest to you (United States is fine). Choose **Start in locked mode** → **Enable**.
4. Open the **Rules** tab. Delete what's there and paste in the contents of `database.rules.json`.
   **Change `booth@yourchurch.org` to the email you'll use for the booth.** Click **Publish**.
5. In the left menu: **Build → Authentication → Get started**. Choose **Email/Password**, switch it **on**, and **Save**.
6. Open the **Users** tab → **Add user**. Enter the same booth email from step 4 and a strong password. This is the only login the booth needs.
7. Still in Authentication, open **Settings → Authorized domains → Add domain** and add `yourname.github.io` (your GitHub Pages domain, without `https://` or the folder).
8. Click the **gear icon → Project settings**. Under *Your apps*, click the **web icon `</>`**. Name it `every-word` and click **Register app**. (You don't need Firebase Hosting.)
9. You'll see a block of code with `firebaseConfig`. Copy the values for `apiKey`, `authDomain`, `databaseURL`, `projectId` and `appId`.
   *If there's no `databaseURL`, copy it from the top of the Realtime Database page instead.*
10. Back on GitHub, open **config.js**, click the **pencil** to edit, paste those values in place of the `PASTE-HERE` text, and set your church name. Click **Commit changes**.

> **Is the apiKey safe to put on GitHub?** Yes. Firebase web keys are meant to be public. The database rules from step 4 are what protect you: anyone can *read* captions, but only the booth login can *write* them.

**Test it:** open `.../every-word/booth.html` on a laptop in Chrome, sign in, press **Start captions**, and talk. Open `.../every-word/` on your phone. Your words should appear within a second or two.

You now have working English captions.

---

## Part 3 (optional): Turn on translation (10 minutes)

Translation uses **DeepL**, which is free for up to 500,000 characters a month. A typical sermon is 30,000–40,000 characters, so the free plan covers one language every Sunday with room to spare.

### A. Get a DeepL key
1. Go to **deepl.com/pro-api** and sign up for **DeepL API Free**. DeepL may ask for a card to verify your identity; the Free plan doesn't charge it, and it simply stops when the monthly allowance runs out.
2. In your DeepL account, open **API Keys** and copy your key. A Free key ends in `:fx`.

### B. Create the Cloudflare Worker (keeps your key private)
1. Go to **dash.cloudflare.com** and create a free account.
2. Open **Workers & Pages → Create → Create Worker**. Name it `every-word-translate` and click **Deploy**.
3. Click **Edit code**. Delete everything, paste in the contents of `worker/worker.js`, and click **Deploy**.
4. Go back to the Worker → **Settings → Variables and Secrets → Add**:
   - Type **Secret**, name `DEEPL_KEY`, value: your DeepL key.
   - Type **Text**, name `ALLOWED_ORIGIN`, value: `https://yourname.github.io` (no folder, no slash at the end).
   Click **Deploy** / **Save**.
5. Copy the Worker's address, something like `https://every-word-translate.yourname.workers.dev`.
   Open it in a browser; you should see *"Every Word translator is running."*
6. On GitHub, edit **config.js** and paste that address into `translateUrl`. Commit.

Now the booth's **Translate into** checkboxes work. Readers choose their language from the menu at the top of their screen.

---

## Every Sunday

1. Connect the soundboard's output to the booth laptop's audio input (or use a mic near a speaker). In Chrome's microphone settings, choose that input.
2. Open `booth.html` and press **Start captions**. Allow the microphone the first time.
3. **Keep the booth tab in front and the laptop plugged in.** Captions stop if the laptop sleeps.
4. Put the QR code in the bulletin or on the screen. Use **Print QR card for the bulletin** in the booth.
5. Afterward, use **Copy transcript** to share the sermon with shut-ins. Press **Start a new service** before next week.

**Tips**
- Add tricky words under **Sermon fixes** in the booth, like `never can answer = Nebuchadnezzar`.
- Say Scripture references clearly ("Romans chapter 8, verse 28"). They're highlighted on readers' screens.
- Two services at once? Open `booth.html?room=youth` and share `index.html?room=youth`.

---

## Limits and troubleshooting

| What you see | What to do |
|---|---|
| Reader says **Not set up yet** | config.js still has `PASTE-HERE` in it. |
| Booth says **Can't write: check database rules** | The email in the database rules doesn't match the booth login exactly. |
| Sign-in fails | Check the user in Firebase → Authentication → Users, and that your github.io domain is under Authorized domains. |
| **Microphone access was blocked** | Click the lock icon in Chrome's address bar → allow Microphone. |
| Translations stop | Your DeepL allowance may be used up for the month; English keeps working. |
| More than 100 readers at once | Firebase's free plan allows 100 simultaneous connections. Upgrading to its pay-as-you-go plan keeps the same free allowance and handles far more. |

Speech recognition is good, but not perfect. It works best with a clean soundboard feed and a speaker who doesn't rush.
