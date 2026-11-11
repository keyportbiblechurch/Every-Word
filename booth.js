import { CONFIG } from "./config.js";
import { LANGS, esc, store, roomName, markRefs, tidyRefs, resolveRefs, isConfigured, findRefs, fetchVerses, setBibleRelay, bookMentioned, fetchCatalog, biblesFor } from "./common.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, set, update, remove, serverTimestamp, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = id => document.getElementById(id);
const room = roomName(CONFIG.room);
const base = `rooms/${room}`;
const readerUrl = new URL("index.html" + (room !== (CONFIG.room || "main") ? "?room=" + room : ""), location.href).href;

if (!isConfigured(CONFIG)) {
  $("setupNeeded").classList.remove("hidden");
  throw new Error("Every Word: config.js is not filled in yet.");
}

const app = initializeApp(CONFIG.firebase);
const db = getDatabase(app);
const auth = getAuth(app);

// ---------- sign in ----------
onAuthStateChanged(auth, user => {
  $("login").classList.toggle("hidden", !!user);
  $("booth").classList.toggle("hidden", !user);
  if (user) startConsole();
});
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  try { await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch (err) {
    $("loginMsg").textContent = "Sign-in failed. Check the email and password you created in Firebase (Authentication → Users).";
    $("loginMsg").classList.remove("hidden");
  }
});
$("signOut").onclick = () => { stopMic(); signOut(auth); };

// ---------- state ----------
let started = false, lines = [], partial = "", wantListening = false, session = store.get("session", Date.now().toString(36));
let selLangs = store.get("langs", CONFIG.defaultLanguages || []).filter(c => LANGS[c]);
let trBackoff = 0, trBusy = false;
const canTranslate = !!CONFIG.translateUrl;
setBibleRelay(CONFIG.translateUrl);

function startConsole() {
  if (started) return; started = true;
  $("shareUrl").textContent = readerUrl;
  $("printUrl").textContent = readerUrl;
  try {
    new QRCode($("qr"), { text: readerUrl, width: 180, height: 180 });
    new QRCode($("qrPrint"), { text: readerUrl, width: 300, height: 300 });
  } catch { $("qr").classList.add("hidden"); }

  $("svcTitle").value = store.get("title", "Sunday Worship");
  $("vocab").value = store.get("vocab", $("vocab").value);
  $("svcTitle").oninput = e => { store.set("title", e.target.value); pushState(); };
  $("vocab").oninput = e => store.set("vocab", e.target.value);

  $("langBox").innerHTML = Object.entries(LANGS).map(([c, n]) =>
    `<label><input type="checkbox" value="${c}" ${selLangs.includes(c) ? "checked" : ""} ${canTranslate ? "" : "disabled"}> ${esc(n)}</label>`).join("");
  $("langBox").onchange = () => {
    selLangs = [...$("langBox").querySelectorAll("input:checked")].map(i => i.value);
    store.set("langs", selLangs); pushState(true); renderBibles();
  };
  loadBibles();
  if (!canTranslate) showTr("Translation is off. Add your Cloudflare Worker URL to config.js to turn it on (SETUP.md, Part 3).");

  $("sermonRefs").value = store.get("sermonRefs", $("sermonRefs").value);
  let refT = null;
  $("sermonRefs").oninput = e => { store.set("sermonRefs", e.target.value); clearTimeout(refT); refT = setTimeout(loadPlanned, 700); };
  loadPlanned();

  onValue(ref(db, ".info/connected"), s => {
    const ok = !!s.val();
    $("conn").className = "chip" + (ok ? " live" : " warn");
    $("conn").textContent = ok ? "Connected · room " + room : "Offline: check the internet";
  });
  setInterval(() => pushState(true), 20000); // heartbeat for readers
  pushState(true);
  renderPreview();
}

// ---------- writing to Firebase ----------
let stT = null, stLast = 0;
function pushState(now) {
  const go = () => {
    stT = null; stLast = Date.now();
    set(ref(db, base + "/state"), {
      title: $("svcTitle").value.slice(0, 80),
      live: wantListening || paused,
      paused,
      langs: canTranslate ? selLangs : [],
      partial: partial.slice(-240),
      session, beat: serverTimestamp()
    }).catch(writeErr);
  };
  if (now || Date.now() - stLast > 400) { clearTimeout(stT); go(); }
  else if (!stT) stT = setTimeout(go, 400);
}
function writeErr(err) {
  $("conn").className = "chip warn";
  $("conn").textContent = "Can’t write: check database rules (SETUP.md, Part 2)";
  console.error(err);
}

const fixes = () => $("vocab").value.split("\n").map(s => s.split(/\s*(?:=>|→|=)\s*/)).filter(p => p.length === 2 && p[0] && p[1]);
const applyFixes = t => fixes().reduce((s, [a, b]) => s.replace(new RegExp("\\b" + a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), b), t);
const tidy = t => { t = resolveRefs(tidyRefs(applyFixes(t.trim())), planned); return t.charAt(0).toUpperCase() + t.slice(1); };

function addLine(text) {
  text = tidy(text);
  if (!text) return;
  const r = push(ref(db, base + "/lines"));
  const l = { key: r.key, src: text, t: Date.now(), tr: {}, pending: canTranslate && selLangs.length > 0 };
  lines.push(l);
  set(r, { src: text, t: serverTimestamp() }).catch(writeErr);
  renderPreview();
  pumpTranslate();
  attachVerses(l);
}

// ---------- full Scripture cards (BSB) ----------
const recentRefs = [];
const isRecent = label => recentRefs.slice(-6).includes(label);
async function attachVerses(l, force) {
  let refs = findRefs(l.src).filter(r => force || !isRecent(r.label));
  // Rule 2: a book + chapter from today's list ("Romans 8 …") shows that planned passage
  if (!refs.length && !findRefs(l.src).length) {
    const nums = (l.src.match(/\d+/g) || []).map(Number);
    refs = planned.filter(p => (force || !isRecent(p.label)) && bookMentioned(l.src, p.id) && nums.includes(p.ch)).slice(0, 1);
  }
  if (!refs.length) return;
  const cards = [];
  let fixedSrc = l.src;
  for (const r of refs.slice(0, 3)) {
    for (const cand of [r, ...(r.alts || [])]) {          // Rule 4: "Psalm 231" tries 23:1, then 2:31 — the one that exists wins
      try {
        const card = await buildCard(cand);
        if (!card) continue;
        recentRefs.push(cand.label);
        cards.push(card);
        // Rule 5: caption agrees with the card ("Psalm 231" → "Psalm 23:1")
        if (r.raw && !/:/.test(r.raw) && fixedSrc.includes(r.raw)) fixedSrc = fixedSrc.replace(r.raw, cand.label);
        $("verseNotice").classList.add("hidden");
        break;
      } catch (err) {
        console.warn("Verse lookup failed for", cand.label, err);
        $("verseNotice").textContent = "Couldn’t load " + cand.label + ". This network may block the Bible service, and the backup route through your Cloudflare Worker didn’t answer either. Make sure the latest worker.js is deployed. Captions are unaffected.";
        $("verseNotice").classList.remove("hidden");
        break;
      }
    }
  }
  if (!cards.length) return;
  l.scripture = cards;
  set(ref(db, `${base}/lines/${l.key}/scripture`), cards).catch(writeErr);
  if (fixedSrc !== l.src) {
    l.src = fixedSrc;
    update(ref(db, `${base}/lines/${l.key}`), { src: fixedSrc }).catch(writeErr);
  }
  renderPreview();
}

// ---------- translation (Cloudflare Worker → DeepL) ----------
async function pumpTranslate() {
  if (trBusy || !canTranslate) return;
  if (Date.now() < trBackoff) { setTimeout(pumpTranslate, trBackoff - Date.now() + 50); return; }
  const batch = lines.filter(l => l.pending).slice(0, 8);
  if (!batch.length || !selLangs.length) { lines.forEach(l => l.pending = false); renderPreview(); return; }
  trBusy = true;
  const targets = selLangs.slice();
  const context = lines.filter(l => !l.pending).slice(-4).map(l => l.src).join(" ");
  try {
    const res = await fetch(CONFIG.translateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: batch.map(l => l.src), targets, context })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || res.status), { code: data.error, status: res.status });
    batch.forEach((l, i) => {
      const tr = {};
      targets.forEach(c => { const t = data.translations && data.translations[c] && data.translations[c][i]; if (typeof t === "string") tr[c] = t; });
      l.tr = { ...l.tr, ...tr }; l.pending = false;
      if (Object.keys(tr).length) update(ref(db, `${base}/lines/${l.key}/tr`), tr).catch(writeErr);
      else l.failed = true;
    });
    const failed = Object.keys(data.failed || {});
    if (failed.length) {
      showTr("Not translating " + failed.map(c => LANGS[c] || c).join(", ") + ": DeepL refused " + (failed.length > 1 ? "these languages" : "this language") + " (" + Object.values(data.failed).join(", ") + "). It may not be included in your DeepL plan. The other languages are working.");
    } else $("trNotice").classList.add("hidden");
  } catch (err) {
    if (err.code === "quota") {
      showTr("This month’s free DeepL allowance is used up. Captions continue in English; translation returns when DeepL resets.");
      lines.forEach(l => { if (l.pending) { l.pending = false; l.failed = true; } });
      trBackoff = Date.now() + 10 * 60 * 1000;
    } else {
      const why = {
        origin: "The Worker refused this site. In Cloudflare, set ALLOWED_ORIGIN to exactly " + location.origin + " and redeploy.",
        no_key: "The Worker has no DEEPL_KEY. Add it as a Secret in Cloudflare and redeploy.",
        deepl_403: "DeepL rejected the key. Re-copy your DeepL API key (Free keys end in :fx) into DEEPL_KEY.",
        deepl_456: "This month’s DeepL allowance is used up.",
        too_long: "A caption batch was too long for the Worker."
      }[err.code] || (err instanceof TypeError
        ? "Couldn’t reach the Worker at " + CONFIG.translateUrl + ". Open that address in a new tab: it should say “Every Word translator is running.” If it says Page not found, the address in config.js is wrong or the Worker isn’t deployed. If it loads, ALLOWED_ORIGIN must be exactly " + location.origin + "."
        : "The Worker answered with error " + (err.status || "") + " " + (err.code || err.message || "") + ".");
      showTr("Translation problem: " + why + " English captions are still live.");
      trBackoff = Date.now() + 8000;
    }
  } finally {
    trBusy = false; renderPreview();
    if (lines.some(l => l.pending)) setTimeout(pumpTranslate, 300);
  }
}
function showTr(msg) { $("trNotice").textContent = msg; $("trNotice").classList.remove("hidden"); }

// ---------- Bible versions for each language ----------
let catalogList = null, catalogErr = false;
let bibles = store.get("bibles", {});          // { ES: "spa_r09", PL: "" (= none) }
function loadBibles() {
  renderBibles();
  fetchCatalog().then(list => { catalogList = list; catalogErr = false; renderBibles(); })
    .catch(() => { catalogErr = true; renderBibles(); });
}
function bibleFor(lang) {
  if (bibles[lang] !== undefined) return bibles[lang] || null;
  if (!catalogList) return null;
  const first = biblesFor(lang, catalogList)[0];
  return first ? first.id : null;
}
function renderBibles() {
  const box = $("bibleBox");
  if (!selLangs.length) { box.innerHTML = '<span class="hint">Tick a language above to choose its Bible.</span>'; return; }
  if (catalogErr) { box.innerHTML = '<span class="notice">Couldn’t load the list of Bibles. Verse cards will show in English (BSB) only. If this network blocks the Bible service, deploy the latest worker.js.</span>'; return; }
  if (!catalogList) { box.innerHTML = '<span class="hint">Loading Bibles…</span>'; return; }
  box.innerHTML = selLangs.map(c => {
    const opts = biblesFor(c, catalogList), cur = bibleFor(c) || "";
    const name = t => esc((t.name && t.englishName && t.name !== t.englishName ? t.name + " · " + t.englishName : t.englishName || t.name || t.id) + (t.shortName ? " (" + t.shortName + ")" : ""));
    return `<label class="field" for="bible-${c}">${esc(LANGS[c] || c)}
      <select id="bible-${c}" data-lang="${c}">
        ${opts.map(t => `<option value="${esc(t.id)}" ${t.id === cur ? "selected" : ""}>${name(t)}</option>`).join("")}
        <option value="" ${cur ? "" : "selected"}>${opts.length ? "None: show English (BSB)" : "No full Bible available: show English (BSB)"}</option>
      </select></label>`;
  }).join("");
}
$("bibleBox").addEventListener("change", e => {
  const s = e.target.closest("select[data-lang]"); if (!s) return;
  bibles[s.dataset.lang] = s.value; store.set("bibles", bibles);
});

// Builds a verse card: BSB text plus the same passage from each selected language's Bible
async function buildCard(r) {
  const v = await fetchVerses(r);
  if (!v) return null;
  const card = toCard(v);
  const tr = {};
  await Promise.all(selLangs.map(async c => {
    const id = bibleFor(c); if (!id) return;
    try {
      const t = await fetchVerses(r, id);
      if (t) tr[c] = { label: t.label, text: t.text, version: t.version };
    } catch (err) { console.warn("Bible", id, "failed for", r.label, err); }
  }));
  if (Object.keys(tr).length) card.tr = tr;
  return card;
}

// ---------- today's Scripture (preloaded) ----------
let planned = [];
const toCard = v => v.more ? { label: v.label, text: v.text, note: "Showing verses " + v.more } : { label: v.label, text: v.text };
function loadPlanned() {
  planned = [];
  $("sermonRefs").value.split("\n").forEach(line => findRefs(tidyRefs(line)).forEach(r => {
    if (!planned.some(p => p.label === r.label)) planned.push(r);
  }));
  $("refList").innerHTML = planned.length
    ? planned.map((r, i) => `<div class="ref-item"><span class="ref">${esc(r.label)}</span><span class="hint" id="pl-${i}">Loading…</span><button class="btn" data-show="${i}">Show</button></div>`).join("")
    : '<span class="hint">No references recognized yet. Write them like Romans 8:28 or John 3:16–18.</span>';
  planned.forEach((r, i) => fetchVerses(r)
    .then(v => { const el = $("pl-" + i); if (el) el.textContent = v ? "Ready" : "Verse not found: check the reference"; })
    .catch(() => { const el = $("pl-" + i); if (el) el.textContent = "Couldn’t load right now"; }));
}
$("refList").addEventListener("click", async e => {
  const b = e.target.closest("[data-show]"); if (!b) return;
  const r = planned[+b.dataset.show]; if (!r) return;
  b.disabled = true;
  try {
    const card = await buildCard(r);
    if (!card) throw new Error("not found");
    const nr = push(ref(db, base + "/lines"));
    const l = { key: nr.key, src: card.label, t: Date.now(), tr: {}, scripture: [card] };
    lines.push(l); recentRefs.push(card.label);
    set(nr, { src: card.label, t: serverTimestamp(), scripture: [card] }).catch(writeErr);
    renderPreview();
    b.textContent = "Sent ✓"; setTimeout(() => { b.textContent = "Show"; b.disabled = false; }, 2500);
  } catch { b.textContent = "Couldn’t load"; setTimeout(() => { b.textContent = "Show"; b.disabled = false; }, 2500); }
});

// ---------- fix a line ----------
let editing = null;
function openEdit(l) {
  editing = l;
  $("editIn").value = l.src;
  $("editWhen").textContent = "(sent " + hhmm(l.t) + ")";
  $("editBar").classList.remove("hidden");
  $("editIn").focus(); $("editIn").select();
  renderPreview();
}
function closeEdit() { editing = null; $("editBar").classList.add("hidden"); renderPreview(); }
function saveEdit() {
  const l = editing, text = $("editIn").value.trim();
  closeEdit();
  if (!l || !text || text === l.src) return;
  l.src = text; l.tr = {}; l.failed = false;
  l.pending = canTranslate && selLangs.length > 0;
  update(ref(db, `${base}/lines/${l.key}`), { src: text, tr: null }).catch(writeErr);
  renderPreview(); pumpTranslate(); attachVerses(l, true);
}
$("preview").addEventListener("click", e => {
  const row = e.target.closest(".pline[data-key]"); if (!row) return;
  const l = lines.find(x => x.key === row.dataset.key);
  if (l) openEdit(l);
});
$("editSave").onclick = saveEdit;
$("editCancel").onclick = closeEdit;
$("editIn").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
  else if (e.key === "Escape") { e.preventDefault(); closeEdit(); }
});

// ---------- preview ----------
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function renderPreview() {
  const p = $("preview"), stick = p.scrollHeight - p.scrollTop - p.clientHeight < 60;
  if (!lines.length && !partial) {
    p.innerHTML = '<div class="hint">Press <b>Start captions</b> and speak, or type a line below. Each phrase shows here and on every reader’s phone. Click any line to fix a mis-heard word.</div>';
    return;
  }
  p.innerHTML = lines.slice(-80).map(l => {
    const tr = Object.entries(l.tr || {}).map(([c, t]) => `<span class="tr">${c}: ${esc(t)}</span>`).join("");
    const st = l.pending ? '<span class="tr state">Translating…</span>' : l.failed ? '<span class="tr state">English only</span>' : "";
    const sc = (l.scripture || []).map(s => `<span class="tr verse-mini"><b>${esc(s.label)}</b> ${esc(s.text)}${
      s.tr ? Object.entries(s.tr).map(([c, t]) => `<br><b>${c}:</b> ${esc(t.label)} <i>(${esc(t.version)})</i>`).join("") : ""}</span>`).join("");
    return `<div class="pline${editing === l ? " editing" : ""}" data-key="${esc(l.key)}" title="Click to fix this line"><time>${hhmm(l.t)}</time><span>${markRefs(esc(l.src))}</span>${sc}${tr}${st}</div>`;
  }).join("") + (partial ? `<div class="pline"><time>now</time><span class="hint"><i>${esc(partial)}…</i></span></div>` : "");
  if (stick) p.scrollTop = p.scrollHeight;
}

// ---------- speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, wakeLock = null;
function browserName() {
  const ua = navigator.userAgent;
  if (navigator.brave) return "Brave";
  const brands = (navigator.userAgentData && navigator.userAgentData.brands || []).map(b => b.brand).filter(b => !/Not.?A.?Brand|Chromium/i.test(b));
  if (/Electron/i.test(ua)) return "an app’s built-in browser";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/DuckDuckGo/i.test(ua)) return "DuckDuckGo";
  if (brands.length) return brands.join(", ");
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "unknown browser";
}
function micNotice(msg) { const n = $("micNotice"); n.textContent = msg || ""; n.classList.toggle("hidden", !msg); }
function setMicUI() {
  $("micBtn").textContent = wantListening ? "Stop captions" : "Start captions";
  $("micBtn").classList.toggle("on", wantListening);
  $("micState").className = "chip" + (wantListening ? " live" : "");
  $("micState").textContent = wantListening ? "Listening" : "Mic off";
}
function startMic() {
  if (!SR) { micNotice("This browser (" + browserName() + ") doesn’t offer speech recognition. Open this page in Google Chrome or Microsoft Edge, typed straight into the address bar rather than opened from inside another app. Brave, Opera, Firefox and DuckDuckGo don’t support it. You can still type lines below."); return; }
  rec = new SR();
  rec.lang = CONFIG.speechLang || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = e => {
    if (!wantListening) return;   // ignore words that arrive after Stop or Pause
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addLine(r[0].transcript);
      else interim += r[0].transcript;
    }
    partial = interim.trim();
    renderPreview(); pushState();
  };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { wantListening = false; setMicUI(); micNotice("Microphone access was blocked. Click the lock icon in the address bar, allow the microphone, then press Start captions."); }
    else if (e.error === "network") micNotice("Speech recognition lost its internet connection. It will keep trying.");
    else if (e.error === "audio-capture") { wantListening = false; setMicUI(); micNotice("No microphone found. Check that the soundboard or mic is plugged in and chosen as the input."); }
  };
  rec.onend = () => { if (wantListening) setTimeout(() => { try { rec.start(); } catch { /* already started */ } }, 250); };
  wantListening = true;
  if (paused) { paused = false; setPauseUI(); }
  try { rec.start(); } catch { /* ignore */ }
  micNotice("");
  setMicUI(); pushState(true);
  if (navigator.wakeLock) navigator.wakeLock.request("screen").then(w => wakeLock = w).catch(() => {});
}
function stopMic() {
  wantListening = false;
  if (rec) { try { rec.stop(); } catch { /* ignore */ } }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  partial = ""; setMicUI(); renderPreview(); if (started) pushState(true);
}
$("micBtn").onclick = () => wantListening ? stopMic() : startMic();

// ---------- pause for prayer ----------
let paused = false;
function setPauseUI() {
  $("pauseBtn").textContent = paused ? "Resume captions" : "Pause for prayer";
  $("pauseBtn").classList.toggle("on", paused);
  if (paused) { $("micState").className = "chip warn"; $("micState").textContent = "Paused · readers see “paused for prayer”"; }
}
$("pauseBtn").onclick = () => {
  if (!paused) {
    if (wantListening) stopMic();
    paused = true; setPauseUI(); pushState(true);
  } else {
    startMic();   // also clears the pause
    setPauseUI(); setMicUI(); pushState(true);
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && wantListening && navigator.wakeLock) navigator.wakeLock.request("screen").then(w => wakeLock = w).catch(() => {});
});

// ---------- other controls ----------
$("typeIn").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addLine(e.target.value); e.target.value = ""; } });
$("typeSend").onclick = () => { addLine($("typeIn").value); $("typeIn").value = ""; $("typeIn").focus(); };
$("copyBtn").onclick = async () => {
  const text = $("svcTitle").value + " — " + new Date().toLocaleDateString() + "\n\n" + lines.map(l => l.src).join("\n");
  try { await navigator.clipboard.writeText(text); $("copyMsg").textContent = "Copied " + lines.length + " lines."; }
  catch { $("copyMsg").textContent = "Copy was blocked. Select the preview text instead."; }
};
let clearArmed = false;
$("clearBtn").onclick = () => {
  if (!clearArmed) { clearArmed = true; $("clearBtn").textContent = "Click again to clear"; setTimeout(() => { clearArmed = false; $("clearBtn").textContent = "Start a new service"; }, 4000); return; }
  clearArmed = false; $("clearBtn").textContent = "Start a new service";
  lines = []; partial = ""; recentRefs.length = 0; session = Date.now().toString(36); store.set("session", session);
  remove(ref(db, base + "/lines")).catch(writeErr);
  renderPreview(); pushState(true);
};
$("printBtn").onclick = () => window.print();
