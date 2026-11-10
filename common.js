// Shared helpers for the reader and booth pages.

// DeepL target languages offered in the booth.
export const LANGS = {
  ES: "Español (Spanish)",
  RU: "Русский (Russian)",
  UK: "Українська (Ukrainian)",
  KO: "한국어 (Korean)",
  ZH: "中文 (Chinese)",
  JA: "日本語 (Japanese)",
  "PT-BR": "Português (Portuguese)",
  FR: "Français (French)",
  DE: "Deutsch (German)",
  AR: "العربية (Arabic)"
};
export const RTL = new Set(["AR"]);

export const FIREBASE_VERSION = "10.12.2";

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export const store = {
  get(k, d) { try { const v = localStorage.getItem("ew-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ew-" + k, JSON.stringify(v)); } catch { /* storage off */ } }
};

export const roomName = fallback => {
  const p = new URLSearchParams(location.search).get("room");
  return (p || fallback || "main").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40) || "main";
};

export const isConfigured = cfg => cfg.firebase && cfg.firebase.databaseURL && !/PASTE-HERE/.test(cfg.firebase.databaseURL + cfg.firebase.apiKey);

// ---- Bible reference highlighting ----
const BOOKS = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth","1 Samuel","2 Samuel","1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms?","Proverbs","Ecclesiastes","Song of Solomon","Song of Songs","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos","Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi","Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians","Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon","Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"];
const bookAlt = BOOKS.map(b => b.replace(/^([123]) /, "(?:$1|First|Second|Third|1st|2nd|3rd) ")).join("|");
const REF_RE = new RegExp("\\b(" + bookAlt + ")\\s+(?:chapter\\s+)?(\\d{1,3})(?:\\s*(?::|verses?)\\s*(\\d{1,3})(?:\\s*(?:-|–|through|to)\\s*(\\d{1,3}))?)?\\b", "gi");
export const markRefs = html => html.replace(REF_RE, m => '<span class="ref">' + m + "</span>");

// Turn spoken references into written ones: "Romans chapter 8 verse 28" -> "Romans 8:28"
const SPOKEN_RE = new RegExp("\\b(" + bookAlt + ")\\s+chapter\\s+(\\d{1,3})(?:,?\\s+verses?\\s+(\\d{1,3})(?:\\s+(?:through|to)\\s+(\\d{1,3}))?)?", "gi");
export const tidyRefs = t => t.replace(SPOKEN_RE, (m, b, c, v, v2) => b + " " + c + (v ? ":" + v + (v2 ? "–" + v2 : "") : ""));
