// ============================================================
//  EVERY WORD — your church's settings
//  This is the only file you need to edit. See SETUP.md.
// ============================================================

export const CONFIG = {
  // Shown at the top of the reader page.
  churchName: "Keyport Bible Church",

  // Default room. Use different rooms if you caption more than one
  // service or room at the same time (e.g. "main", "youth").
  // Readers can also open  index.html?room=youth
  room: "main",

  // Language the pastor speaks (for the booth laptop's speech recognition).
  speechLang: "en-US",

  // Paste your Firebase web app config here (SETUP.md, Part 2, step 9).
  firebase: {
    apiKey: "PASTE-HERE",
    authDomain: "PASTE-HERE.firebaseapp.com",
    databaseURL: "https://PASTE-HERE-default-rtdb.firebaseio.com",
    projectId: "PASTE-HERE",
    appId: "PASTE-HERE"
  },

  // Optional: your Cloudflare Worker URL for translation (SETUP.md, Part 3).
  // Leave as "" for English-only captions.
  translateUrl: "",

  // Languages the booth turns on by default (DeepL codes, see common.js).
  defaultLanguages: ["ES"]
};
