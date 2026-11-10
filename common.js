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
// Chapters per book, same order as BOOKS (Song of Solomon / Song of Songs listed twice)
const CHAPTERS = [50,40,27,36,34,24,21,4,31,24,22,25,29,36,10,13,10,42,150,31,12,8,8,66,52,5,48,12,14,3,9,1,4,7,3,3,3,2,14,4,28,16,24,21,28,16,16,13,6,6,4,4,5,3,6,4,3,1,13,5,5,3,5,1,1,1,22];
// Book, then: "8:28" | "8.28" | "8 verse 28" | "8 28" | "828" (speech often drops the colon), optional range
const FIND_RE = new RegExp("\\b(" + bookAlt + ")\\s+(?:chapter\\s+)?(\\d{1,4})(?:\\s*(?::|\\.|,?\\s*verses?\\s+|\\s)\\s*(\\d{1,3}))?(?:\\s*(?:-|–|through|to)\\s*(\\d{1,3}))?(?![\\d:])", "gi");
export const MAX_VERSES = 6;

// Finds references that include a verse, e.g. "Romans 8:28", "Romans 828", "1 John 1:8–10".
// Each result may carry "alts": other ways to read a run-together number like "231".
export function findRefs(text) {
  const out = [];
  for (const m of String(text).matchAll(FIND_RE)) {
    const i = bookIndex(m[1]);
    if (i < 0) continue;
    const max = CHAPTERS[i];
    let cands = [];
    if (m[3]) cands.push([+m[2], +m[3]]);
    else {
      const n = m[2];
      if (max === 1) cands.push([1, +n]);                       // Jude 3, Philemon 4
      else if (+n > max) {                                       // "828" → 8:28
        for (let k = n.length - 1; k >= 1; k--) {
          const ch = +n.slice(0, k), v = +n.slice(k);
          if (ch >= 1 && ch <= max && v >= 1 && n[k] !== "0") cands.push([ch, v]);
        }
      }                                                          // otherwise chapter only: no card
    }
    cands = cands.filter(([c, v]) => c >= 1 && c <= max && v >= 1);
    if (!cands.length) continue;
    const mk = ([ch, v1]) => {
      const v2 = m[4] ? Math.max(+m[4], v1) : v1;
      return { id: IDS[i], ch, v1, v2, label: NAMES[i] + " " + ch + ":" + v1 + (v2 > v1 ? "–" + v2 : "") };
    };
    const first = mk(cands[0]);
    first.alts = cands.slice(1).map(mk);
    out.push(first);
  }
  return out;
}

const chapterCache = new Map();
let relayBase = "", useRelay = false;
// Optional relay through your Cloudflare Worker, for networks that block bible.helloao.org
export const setBibleRelay = url => { relayBase = url ? url.replace(/\/+$/, "") : ""; };
const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error("bible " + r.status); return r.json(); });
async function loadChapter(key) {
  if (!useRelay) {
    try { return await getJSON("https://bible.helloao.org/api/BSB/" + key + ".json"); }
    catch (err) { if (!relayBase) throw err; useRelay = true; }
  }
  return getJSON(relayBase + "/bible/" + key);
}
// Returns { label, text, more } or null. "more" is true when the range was cut to MAX_VERSES.
export async function fetchVerses(ref) {
  const key = ref.id + "/" + ref.ch;
  if (!chapterCache.has(key)) {
    chapterCache.set(key, loadChapter(key).catch(err => { chapterCache.delete(key); throw err; }));
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
