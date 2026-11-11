import { CONFIG } from "./config.js?v=2026-11-10f";
import { VERSION, LANGS, RTL, esc, store, roomName, groupCodeParam, roomPathForCode, prettyCode, normCode, STALE_HOURS, markRefs, isConfigured } from "./common.js?v=2026-11-10f";
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
let hc = store.get("hc", false), showOrig = store.get("orig", true);
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
  document.documentElement.style.setProperty("--cap-size", size + "px");
  document.body.classList.toggle("hc", hc);
  $("hcBtn").setAttribute("aria-pressed", hc);
  $("origBtn").setAttribute("aria-pressed", showOrig);
  $("origBtn").classList.toggle("hidden", lang === "EN");
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
  const shown = order.filter(id => isFresh(lines.get(id)));
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
}

$("lang").onchange = e => { lang = e.target.value; store.set("lang", lang); applyPrefs(); render(); };
$("smaller").onclick = () => { size = Math.max(18, size - 4); store.set("size", size); applyPrefs(); render(); };
$("bigger").onclick = () => { size = Math.min(64, size + 4); store.set("size", size); applyPrefs(); render(); };
$("hcBtn").onclick = () => { hc = !hc; store.set("hc", hc); applyPrefs(); };
$("origBtn").onclick = () => { showOrig = !showOrig; store.set("orig", showOrig); applyPrefs(); render(); };
$("jump").onclick = () => { box.scrollTop = box.scrollHeight; };
box.addEventListener("scroll", () => $("jump").classList.toggle("hidden", atBottom()));

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
  if (isGroup) { location.assign(new URL("index.html", location.href).href); return; }
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
