# Every Word

Free live sermon captions and translation for churches, made for members with hearing loss and for those who speak another language.

- Readers scan a QR code and read the sermon live on their phone. There's no app and no account.
- Large, adjustable text, a high-contrast mode, and highlighted Bible references.
- Optional live translation into Spanish, Russian, Ukrainian, Korean, Chinese and more.
- Runs on free services: GitHub Pages, Firebase and (for translation) DeepL with a Cloudflare Worker.

**To set it up for your church, follow [SETUP.md](SETUP.md).** You only edit one file: `config.js`.

| File | What it is |
|---|---|
| `index.html`, `reader.js` | The page readers open on their phones |
| `booth.html`, `booth.js` | The sound booth console (sign-in required) |
| `config.js` | Your church's settings |
| `common.js`, `styles.css` | Shared code and styles |
| `database.rules.json` | Paste into Firebase so only the booth can write |
| `worker/worker.js` | Paste into Cloudflare to enable translation |

Offered freely to serve the local church. Share it, adapt it, and pass it on.
