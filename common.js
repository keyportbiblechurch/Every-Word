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

// ---- Full verse lookup (Berean Standard Bible via bible.helloao.org) ----
const IDS = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"];
const NAMES = BOOKS.map(b => b.replace("Psalms?", "Psalm"));
const bookIndex = name => {
  const n = name.replace(/\s+/g, " ").replace(/^(First|1st)\b/i, "1").replace(/^(Second|2nd)\b/i, "2").replace(/^(Third|3rd)\b/i, "3");
  return BOOKS.findIndex(b => new RegExp("^" + b + "$", "i").test(n));
};
const FIND_RE = new RegExp("\\b(" + bookAlt + ")\\s+(?:chapter\\s+)?(\\d{1,3})\\s*(?::|,?\\s*verses?\\s+)\\s*(\\d{1,3})(?:\\s*(?:-|–|through|to)\\s*(\\d{1,3}))?", "gi");
export const MAX_VERSES = 6;

// Finds references that include a verse, e.g. "Romans 8:28" or "1 John 1:8–10".
export function findRefs(text) {
  const out = [];
  for (const m of String(text).matchAll(FIND_RE)) {
    const i = bookIndex(m[1]);
    if (i < 0) continue;
    const ch = +m[2], v1 = +m[3], v2 = m[4] ? Math.max(+m[4], v1) : v1;
    if (!ch || !v1) continue;
    const label = NAMES[i] + " " + ch + ":" + v1 + (v2 > v1 ? "–" + v2 : "");
    out.push({ id: IDS[i], ch, v1, v2, label });
  }
  return out;
}

const chapterCache = new Map();
// Returns { label, text, more } or null. "more" is true when the range was cut to MAX_VERSES.
export async function fetchVerses(ref) {
  const key = ref.id + "/" + ref.ch;
  if (!chapterCache.has(key)) {
    chapterCache.set(key, fetch("https://bible.helloao.org/api/BSB/" + key + ".json")
      .then(r => { if (!r.ok) throw new Error("bible " + r.status); return r.json(); })
      .catch(err => { chapterCache.delete(key); throw err; }));
  }
  const data = await chapterCache.get(key);
  const content = (data && data.chapter && data.chapter.content) || [];
  const last = Math.min(ref.v2, ref.v1 + MAX_VERSES - 1);
  const parts = [];
  for (const item of content) {
    if (!item || item.type !== "verse" || item.number < ref.v1 || item.number > last) continue;
    const words = (item.content || []).map(c => typeof c === "string" ? c : (c && typeof c.text === "string" ? c.text : "")).join(" ");
    parts.push((ref.v2 > ref.v1 ? item.number + " " : "") + words.replace(/\s+/g, " ").replace(/\s+([,.;:!?’”)\]])/g, "$1").trim());
  }
  if (!parts.length) return null;
  return { label: ref.label, text: parts.join(" "), more: ref.v2 > last ? ref.v1 + "–" + last : "" };
}

// Turn spoken references into written ones: "Romans chapter 8 verse 28" -> "Romans 8:28"
const SPOKEN_RE = new RegExp("\\b(" + bookAlt + ")\\s+chapter\\s+(\\d{1,3})(?:,?\\s+verses?\\s+(\\d{1,3})(?:\\s+(?:through|to)\\s+(\\d{1,3}))?)?", "gi");
export const tidyRefs = t => t.replace(SPOKEN_RE, (m, b, c, v, v2) => b + " " + c + (v ? ":" + v + (v2 ? "–" + v2 : "") : ""));
