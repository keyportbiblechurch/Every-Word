// Every Word translation helper — a Cloudflare Worker.
// It keeps your DeepL key secret and only answers your own captions site.
//
// Settings (Cloudflare → your Worker → Settings → Variables and Secrets):
//   DEEPL_KEY       (Secret)  your DeepL API key, e.g. abc123...:fx
//   ALLOWED_ORIGIN  (Text)    your site, e.g. https://yourname.github.io
//                             (several allowed, separated by commas)

const TARGETS = new Set(["ES", "RU", "UK", "KO", "ZH", "JA", "PT-BR", "FR", "DE", "AR"]);
const MAX_LINES = 20;
const MAX_CHARS = 4000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
    const ok = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : (allowed[0] || ""),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin"
    };
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET") return reply({ ok: true, message: "Every Word translator is running.", originAllowed: ok });
    if (request.method !== "POST") return reply({ error: "method" }, 405);
    if (!ok) return reply({ error: "origin", message: "Add this site to ALLOWED_ORIGIN." }, 403);
    if (!env.DEEPL_KEY) return reply({ error: "no_key", message: "Add DEEPL_KEY as a secret." }, 500);

    let body;
    try { body = await request.json(); } catch { return reply({ error: "bad_json" }, 400); }
    const text = (Array.isArray(body.text) ? body.text : []).map(t => String(t)).slice(0, MAX_LINES);
    const targets = (Array.isArray(body.targets) ? body.targets : []).map(String).filter(t => TARGETS.has(t)).slice(0, 5);
    if (!text.length || !targets.length) return reply({ translations: {} });
    if (text.join("").length > MAX_CHARS) return reply({ error: "too_long" }, 413);
    const context = typeof body.context === "string" ? body.context.slice(0, 1500) : "";

    const host = env.DEEPL_KEY.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
    try {
      const pairs = await Promise.all(targets.map(async target => {
        const payload = { text, source_lang: "EN", target_lang: target };
        if (context) payload.context = context; // helps DeepL, not billed
        const r = await fetch(host + "/v2/translate", {
          method: "POST",
          headers: { "Authorization": "DeepL-Auth-Key " + env.DEEPL_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (r.status === 456) throw Object.assign(new Error("quota"), { code: "quota" });
        if (!r.ok) throw Object.assign(new Error("deepl " + r.status), { code: "deepl_" + r.status });
        const j = await r.json();
        return [target, (j.translations || []).map(x => x.text)];
      }));
      return reply({ translations: Object.fromEntries(pairs) });
    } catch (err) {
      return reply({ error: err.code || "failed" }, err.code === "quota" ? 429 : 502);
    }
  }
};
