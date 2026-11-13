import { CONFIG } from "./config.js?v=2026-11-12b";
import { VERSION, LANGS, RTL, esc, store, roomName, groupCodeParam, roomPathForCode, prettyCode, normCode, STALE_HOURS, markRefs, isConfigured } from "./common.js?v=2026-11-12b";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, query, limitToLast, onValue, onChildAdded, onChildChanged, onChildRemoved } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
window.__ewStarted = true;   // tells the page the code loaded (see the fallback message in the .html)

const $ = id => document.getElementById(id);
const groupCode = prettyCode(groupCodeParam());
const isGroup = normCode(groupCode).length >= 6;
const room = isGroup ? roomPathForCode(groupCode) : roomName(CONFIG.room);
const isFresh = l => !l.t || Date.now() - l.t < STALE_HOURS * 3600 * 1000;   // hide captions from earlier meetings
$("church").textContent = CONFIG.churchName || "Every Word";
document.title = (CONFIG.churchName ? CONFIG.churchName + " · " : "") + "Live Captions";

let size = store.get("size", 30), lang = store.get("lang", "EN");
let showOrig = store.get("orig", true);
// Display options (remembered on this phone)
let theme = store.get("theme", store.get("hc", false) ? "yellow" : "auto");
let font = store.get("font", "standard"), spacing = store.get("spacing", "normal");
let rate = Number(store.get("rate", 1)) || 1, keepAwake = store.get("wake", true), focus = store.get("focus", false);
let lines = new Map(), order = [], partial = "", langs = ["ES"], title = "", live = false, paused = false;
let lastBeat = 0, gotReal = false, connected = false;

// Example lines so the page never opens empty
[
  { src: "Turn with me to Romans 10:17.", tr: { ES: "Acompáñenme a Romanos 10:17." },
    scripture: [{ label: "Romans 10:17", text: "Consequently, faith comes by hearing, and hearing by the word of Christ." }] },
  { src: "Paul is telling us how the gospel travels.", tr: { ES: "Pablo nos dice cómo viaja el evangelio." } },
  { src: "God uses ordinary voices to carry extraordinary news.", tr: { ES: "Dios usa voces comunes para llevar noticias extraordinarias." } }
].forEach((l, i) => { lines.set("ex" + i, l); order.push("ex" + i); });

const box = $("captions"), cap = $("capInner");
const atBottom = () => box.scrollHeight - box.scrollTop - box.clientHeight < 80;

function applyPrefs() {
  const b = document.body.classList;
  document.documentElement.style.setProperty("--cap-size", size + "px");
  b.toggle("hc", theme === "yellow");
  b.toggle("theme-white", theme === "white");
  b.toggle("theme-cream", theme === "cream");
  b.toggle("font-lexend", font === "lexend");
  b.toggle("spacing-roomy", spacing === "roomy");
  b.toggle("spacing-extra", spacing === "extra");
  b.toggle("focus", focus);
  $("focusBtn").setAttribute("aria-pressed", focus);
  $("listenBtn").setAttribute("aria-pressed", listening);
  $("listenBtn").textContent = listening ? "Stop listening" : "Listen";
  $("listenChip").classList.toggle("hidden", !listening);
  $("sizeVal").textContent = size + " px";
  $("origBtn").setAttribute("aria-pressed", showOrig);
  $("origBtn").classList.toggle("hidden", lang === "EN");
  const box = $("displayBox");
  [["theme", theme], ["font", font], ["spacing", spacing], ["rate", String(rate)]].forEach(([n, v]) => {
    const r = box.querySelector(`input[name="${n}"][value="${v}"]`); if (r) r.checked = true;
  });
  $("wakeChk").checked = keepAwake;
}
function fillLangs() {
  const sel = $("lang"), want = ["EN", ...langs.filter(c => LANGS[c])];
  if ([...sel.options].map(o => o.value).join() !== want.join()) {
    sel.innerHTML = want.map(c => `<option value="${c}">${c === "EN" ? "English" : esc(LANGS[c])}</option>`).join("");
  }
  if (!want.includes(lang)) lang = "EN";
  sel.value = lang;
  applyPrefs();
}
function render() {
  let shown = order.filter(id => isFresh(lines.get(id)));
  deliver(shown);                                   // speak / announce new lines
  if (focus && shown.length) shown = shown.slice(-1); // Focus mode: just the current line
  const stick = atBottom(), n = shown.length;
  let html = shown.map((id, i) => {
    const l = lines.get(id), en = l.src || "";
    const t = lang !== "EN" && l.tr && l.tr[lang];
    const main = t || en, orig = t && showOrig ? en : "";
    const dir = t && RTL.has(lang) ? ' dir="rtl"' : "";
    const cards = (l.scripture || []).map(s => {
      if (!s || !s.text) return "";
      const t = lang !== "EN" && s.tr && s.tr[lang] && s.tr[lang].text ? s.tr[lang] : null;
      if (!t) return `<blockquote class="verse-card" dir="ltr"><cite>${esc(s.label)} <span>BSB</span></cite>${esc(s.text)}${s.note ? `<small>${esc(s.note)}</small>` : ""}</blockquote>`;
      const vdir = RTL.has(lang) ? "rtl" : "ltr";
      return `<blockquote class="verse-card" dir="${vdir}"><cite>${esc(t.label)} <span>${esc(t.version || "")}</span></cite>${esc(t.text)}${
        showOrig ? `<span class="orig-verse" dir="ltr"><b>${esc(s.label)} (BSB)</b> ${esc(s.text)}</span>` : ""}${s.note ? `<small dir="ltr">${esc(s.note)}</small>` : ""}</blockquote>`;
    }).join("");
    return `<p class="cap${i < n - 6 ? " old" : ""}"${dir}>${markRefs(esc(main))}${orig ? `<span class="orig" dir="ltr">${markRefs(esc(orig))}</span>` : ""}</p>${cards}`;
  }).join("");
  if (paused) html += `<p class="paused-banner">Captions are paused during prayer. They’ll pick up again shortly.</p>`;
  else if (partial) html += `<p class="cap partial">${lang === "EN" ? esc(partial) : ""}…</p>`;
  cap.innerHTML = html;
  if (stick) box.scrollTop = box.scrollHeight;
  $("jump").classList.toggle("hidden", atBottom());
}
function setStatus() {
  const s = $("status");
  const fresh = Date.now() - lastBeat < 60000;
  if (!connected) { s.className = "chip warn"; s.textContent = isConfigured(CONFIG) ? "Connecting…" : "Not set up yet"; }
  else if (paused && fresh) { s.className = "chip warn"; s.textContent = "Paused for prayer"; }
  else if (live && fresh) { s.className = "chip live"; s.textContent = title ? "Live · " + title : "Live"; }
  else if (gotReal) { s.className = "chip warn"; s.textContent = "Paused"; }
  else { s.className = "chip"; s.textContent = isGroup ? "Waiting for the group to start" : "Waiting for service"; }
  updateWake();
}

$("lang").onchange = e => {
  lang = e.target.value; store.set("lang", lang);
  if (listening) { stopListening(); startListening(); }
  applyPrefs(); render();
};
$("smaller").onclick = () => { size = Math.max(18, size - 4); store.set("size", size); applyPrefs(); render(); };
$("bigger").onclick = () => { size = Math.min(64, size + 4); store.set("size", size); applyPrefs(); render(); };
$("focusBtn").onclick = () => { focus = !focus; store.set("focus", focus); applyPrefs(); render(); };
// ---------- menu ----------
function openMenu() {
  $("menuPanel").classList.remove("hidden"); $("menuBackdrop").classList.remove("hidden");
  $("menuBtn").setAttribute("aria-expanded", "true");
  $("menuClose").focus();
}
function closeMenu(returnFocus = true) {
  $("menuPanel").classList.add("hidden"); $("menuBackdrop").classList.add("hidden");
  $("menuBtn").setAttribute("aria-expanded", "false");
  if (returnFocus) $("menuBtn").focus();
}
$("menuBtn").onclick = () => $("menuPanel").classList.contains("hidden") ? openMenu() : closeMenu();
$("menuClose").onclick = () => closeMenu();
$("menuBackdrop").onclick = () => closeMenu();
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("menuPanel").classList.contains("hidden")) closeMenu(); });
$("displayBox").addEventListener("change", e => {
  const t = e.target;
  if (t.name === "theme") { theme = t.value; store.set("theme", theme); }
  if (t.name === "font") { font = t.value; store.set("font", font); }
  if (t.name === "spacing") { spacing = t.value; store.set("spacing", spacing); }
  if (t.name === "rate") { rate = Number(t.value) || 1; store.set("rate", rate); }
  if (t.id === "wakeChk") { keepAwake = t.checked; store.set("wake", keepAwake); updateWake(); }
  applyPrefs(); render();
});
$("listenBtn").onclick = () => listening ? stopListening() : startListening();
$("origBtn").onclick = () => { showOrig = !showOrig; store.set("orig", showOrig); applyPrefs(); render(); };
$("jump").onclick = () => { box.scrollTop = box.scrollHeight; };
box.addEventListener("scroll", () => $("jump").classList.toggle("hidden", atBottom()));

// ---------- new lines: read aloud and screen-reader announcements ----------
const SPEECH = { EN: "en", ES: "es", RU: "ru", UK: "uk", KO: "ko", ZH: "zh", JA: "ja", "PT-BR": "pt", FR: "fr", DE: "de", PL: "pl", AR: "ar" };
const WAIT_FOR_TRANSLATION = 6000;  // ms to wait for a line's translation before falling back to English
let listening = false, delivered = new Set(), seenAt = new Map(), queue = [], speaking = false;
const voices = () => ("speechSynthesis" in window ? speechSynthesis.getVoices() : []);
function voiceFor(code) {
  const p = SPEECH[code] || "en", vs = voices().filter(v => String(v.lang).toLowerCase().replace("_", "-").startsWith(p));
  return vs.find(v => v.localService) || vs[0] || null;
}
function listenMsg(text) { const m = $("listenMsg"); m.textContent = text || ""; m.classList.toggle("hidden", !text); }

// Called on every render with the visible lines, oldest first
function deliver(shown) {
  for (const id of shown) {
    if (delivered.has(id) || String(id).startsWith("ex")) continue;
    const l = lines.get(id);
    if (!seenAt.has(id)) seenAt.set(id, Date.now());
    let text = l.src, code = "EN";
    if (lang !== "EN") {
      if (l.tr && l.tr[lang]) { text = l.tr[lang]; code = lang; }
      else if (Date.now() - seenAt.get(id) < WAIT_FOR_TRANSLATION) { setTimeout(render, 1500); break; }  // keep order: wait
    }
    delivered.add(id);
    const verses = (l.scripture || []).map(s => {
      const t = lang !== "EN" && s.tr && s.tr[lang];
      return t ? { text: t.label + ". " + t.text, code: lang } : { text: s.label + ". " + s.text, code: "EN" };
    });
    $("srLive").textContent = [text, ...verses.map(v => v.text)].join(" ");
    if (listening) {
      queue.push({ text, code }, ...verses);
      if (queue.length > 4) queue = queue.slice(-3);   // stay close to live if speech falls behind
      speakNext();
    }
  }
}
function speakNext() {
  if (speaking || !queue.length || !listening) return;
  const item = queue.shift();
  const u = new SpeechSynthesisUtterance(item.text);
  const v = voiceFor(item.code);
  if (v) u.voice = v;
  u.lang = v ? v.lang : (SPEECH[item.code] || "en");
  u.rate = rate;
  speaking = true;
  u.onend = u.onerror = () => { speaking = false; speakNext(); };
  speechSynthesis.speak(u);
}
function startListening() {
  if (!("speechSynthesis" in window)) { listenMsg("This browser can’t read aloud. Try Chrome or Safari."); return; }
  listening = true;
  // Start from now: don't read the backlog
  order.forEach(id => delivered.add(id));
  speechSynthesis.cancel();
  const hello = new SpeechSynthesisUtterance(" ");   // a tap-started utterance unlocks speech on phones
  hello.volume = 0; speechSynthesis.speak(hello);
  const check = () => {
    if (!listening) return;
    if (lang !== "EN" && !voiceFor(lang)) {
      listenMsg("Your phone doesn’t have a " + (LANGS[lang] || lang) + " voice installed, so it may read in a different voice. You can add voices in your phone’s accessibility or text-to-speech settings.");
    } else listenMsg("Reading new lines aloud. Use earbuds so you don’t disturb others.");
  };
  if (voices().length) check(); else { speechSynthesis.onvoiceschanged = check; setTimeout(check, 1500); }
  applyPrefs(); updateWake();
}
function stopListening() {
  listening = false; queue = []; speaking = false;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  listenMsg(""); applyPrefs();
}

// ---------- keep the screen on while captions are live ----------
let wakeLock = null;
async function updateWake() {
  const want = keepAwake && document.visibilityState === "visible" && (live || listening);
  try {
    if (want && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }   // not supported or not allowed: the phone just sleeps as usual
}
document.addEventListener("visibilitychange", updateWake);
document.addEventListener("click", updateWake);   // some phones only allow it after a tap

function clearExamples() {
  if (gotReal) return;
  gotReal = true; lines = new Map(); order = [];
  $("exampleNote").classList.add("hidden");
}

if (isConfigured(CONFIG)) {
  const db = getDatabase(initializeApp(CONFIG.firebase));
  onValue(ref(db, ".info/connected"), s => { connected = !!s.val(); setStatus(); });
  onValue(ref(db, `rooms/${room}/state`), s => {
    const st = s.val() || {};
    live = !!st.live; paused = !!st.paused; title = String(st.title || ""); partial = paused ? "" : String(st.partial || "");
    langs = Array.isArray(st.langs) ? st.langs : [];
    lastBeat = Date.now();
    fillLangs(); render(); setStatus();
  });
  const q = query(ref(db, `rooms/${room}/lines`), limitToLast(400));
  const upsert = s => {
    clearExamples();
    const v = s.val() || {};
    if (!lines.has(s.key)) order.push(s.key);
    lines.set(s.key, {
      src: String(v.src || ""),
      tr: v.tr && typeof v.tr === "object" ? v.tr : {},
      scripture: Array.isArray(v.scripture) ? v.scripture.slice(0, 3) : [],
      t: typeof v.t === "number" ? v.t : 0
    });
    render();
  };
  onChildAdded(q, upsert);
  onChildChanged(q, upsert);
  onChildRemoved(q, s => { lines.delete(s.key); order = order.filter(k => k !== s.key); render(); });
}
// ---- join a private group ----
if ($("joinBtn") && $("joinBox") && $("joinIn") && $("joinGo")) {
$("joinBtn").textContent = isGroup ? "Leave group" : "Join a group";
if (isGroup) $("church").textContent = "Private group";
$("joinBtn").onclick = () => {
  if (isGroup) { closeMenu(false); location.assign(new URL("index.html", location.href).href); return; }
  closeMenu(false);
  $("joinBox").classList.toggle("hidden"); $("joinIn").focus();
};
const join = () => {
  const c = $("joinIn").value;
  if (normCode(c).length < 6) { $("joinMsg").textContent = "Enter the whole code your group leader gave you, like GRACE-HARBOR-482."; return; }
  $("joinMsg").textContent = "Joining…";
  location.assign(new URL("index.html?code=" + encodeURIComponent(prettyCode(c)), location.href).href);
};
$("joinGo").onclick = join;
$("joinIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); join(); } });
} else console.warn("index.html is out of date: the Join a group button is missing. Upload the latest index.html.");
setInterval(() => { setStatus(); render(); }, 60000);
setInterval(setStatus, 5000);
fillLangs(); applyPrefs(); render(); setStatus();
