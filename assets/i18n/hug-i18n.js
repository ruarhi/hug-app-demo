/* hug app — client-side UI translation engine.
 * Ported from the storefront engine (hug-theme/assets/hug-i18n.js) so the app and the
 * website share one translation model and identical terminology.
 *
 * English (en) is the source: this file then does nothing and no dictionary loads.
 * For any other language it lazy-loads assets/i18n/hug-i18n-<lang>.js — one dictionary
 * keyed by the exact English source string — and swaps matching visible text + a few
 * attributes. The app renders its screens dynamically (app.js rebuilds innerHTML as you
 * navigate), so a MutationObserver re-translates anything injected after the first pass.
 * Switching language persists the choice and reloads, so every launch renders English
 * first and is translated from a clean DOM — no double-translation, no stale state.
 *
 * The native Shopify checkout sheet is hosted by Shopify and follows the store locale;
 * this engine covers the app's own UI only (same boundary as the storefront).
 */
(function () {
  "use strict";
  var KEY = "hug_lang";
  var DEFAULT = "en";
  var RTL = { ar: 1, ur: 1, fa: 1, he: 1 };
  // Capture our own asset URL now (currentScript is null later, at DOMContentLoaded).
  var SELF_SRC = (document.currentScript && document.currentScript.src) || "";

  function readLang() {
    try {
      var ls = localStorage.getItem(KEY);
      if (ls) return ls.toLowerCase();
      var m = document.cookie.match(/(?:^|;\s*)hug_lang=([a-zA-Z-]+)/);
      if (m) return m[1].toLowerCase();
    } catch (e) {}
    return DEFAULT;
  }
  function writeLang(code) {
    try { localStorage.setItem(KEY, code); } catch (e) {}
    try { document.cookie = KEY + "=" + code + ";path=/;max-age=31536000;samesite=lax"; } catch (e) {}
    // Best-effort durable mirror for WKWebView (localStorage can be evicted under
    // storage pressure). Async + optional — never blocks the language switch.
    try {
      var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
      if (P && P.set) P.set({ key: KEY, value: code });
    } catch (e) {}
  }

  var lang = readLang();
  window.HUG_I18N_DICT = window.HUG_I18N_DICT || {};

  // The chosen language stays until it is changed (owner, 2026-10-16: "it should also remember
  // what you last set it as"). In the iPhone app, localStorage is the only place the two reads
  // above can find it: the cookie does not persist on the app's own capacitor:// origin, and iOS
  // may drop localStorage under storage pressure. writeLang has always mirrored the choice into
  // Capacitor Preferences (the shelf the sign-in session lives on); this is where it comes back.
  // With no language in localStorage on a phone, the first paint (and, through the boot gate's
  // boot-i18n hold, the launch cover) waits for that shelf, at most 600 ms. On the web nothing
  // changes. Once a language is in localStorage, the shelf is only kept up to date.
  var settled = true, onSettled = null;
  (function restoreFromShelf() {
    var P = null, stored = null;
    try { P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences; } catch (e) {}
    if (!P || !P.get || !P.set) return;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    if (stored) { try { P.set({ key: KEY, value: lang }); } catch (e) {} return; }
    settled = false;
    var h = document.documentElement;
    h.classList.add("hug-i18n-pending");
    function finish(code, late) {
      if (settled && !late) return;
      code = String(code || "").toLowerCase();
      var known = /^[a-z]{2,3}(-[a-z0-9]+)?$/.test(code);
      if (late) {
        // The shelf answered after the page came up in English: it is right from the next launch.
        if (known && code !== lang) { try { localStorage.setItem(KEY, code); } catch (e) {} }
        return;
      }
      settled = true;
      if (known && code !== lang) {
        try { localStorage.setItem(KEY, code); } catch (e) {}
        lang = code;                                  // boot() waits for this, so it starts in it
      } else if (!code) {
        // Nothing on the shelf either: English was never changed. Say so in localStorage, so
        // later launches do not ask again (a choice still goes to both through writeLang).
        try { localStorage.setItem(KEY, DEFAULT); } catch (e) {}
      }
      if (onSettled) { var f = onSettled; onSettled = null; f(); }
    }
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;                                 // too slow: carry on in English this time
      if (onSettled) { var f = onSettled; onSettled = null; f(); }
    }, 600);
    try {
      Promise.resolve(P.get({ key: KEY })).then(function (r) {
        var v = r && r.value;
        if (settled) finish(v, true); else { clearTimeout(timer); finish(v, false); }
      }, function () { if (!settled) { clearTimeout(timer); finish(null, false); } });
    } catch (e) { clearTimeout(timer); settled = true; }
  })();

  // Public API used by the language selector in Settings.
  window.hugCurrentLang = function () { return lang; };
  // Exposed so a label built in JavaScript can be translated BEFORE its tick character is
  // swapped for the drawn mark — the dictionary keys carry that character.
  window.hugT = tr;
  window.hugSetLang = function (code) {
    if (!code) return;
    if (code === lang) return;
    writeLang(code);
    if (window.HugDiag) { try { window.HugDiag.log("lang:set", { lang: code }); } catch (e) {} }
    location.reload();
  };
  // The 20 shipped languages (flag + native name), shared with the storefront selector.
  // Kept here so the picker and any other surface read one list. Never translated.
  window.HUG_LANGS = [
    { code: "en", flag: "🇬🇧", name: "English" },
    { code: "zh", flag: "🇨🇳", name: "中文" },
    { code: "hi", flag: "🇮🇳", name: "हिन्दी" },
    { code: "es", flag: "🇪🇸", name: "Español" },
    { code: "fr", flag: "🇫🇷", name: "Français" },
    { code: "ar", flag: "🇸🇦", name: "العربية" },
    { code: "bn", flag: "🇧🇩", name: "বাংলা" },
    { code: "pt", flag: "🇧🇷", name: "Português" },
    { code: "ru", flag: "🇷🇺", name: "Русский" },
    { code: "ur", flag: "🇵🇰", name: "اردو" },
    { code: "id", flag: "🇮🇩", name: "Bahasa Indonesia" },
    { code: "de", flag: "🇩🇪", name: "Deutsch" },
    { code: "ja", flag: "🇯🇵", name: "日本語" },
    { code: "mr", flag: "म", name: "मराठी" },
    { code: "te", flag: "త", name: "తెలుగు" },
    { code: "tr", flag: "🇹🇷", name: "Türkçe" },
    { code: "ta", flag: "த", name: "தமிழ்" },
    { code: "vi", flag: "🇻🇳", name: "Tiếng Việt" },
    { code: "ko", flag: "🇰🇷", name: "한국어" },
    { code: "it", flag: "🇮🇹", name: "Italiano" },
    { code: "he", flag: "🇮🇱", name: "עברית" }
  ];

  function dict() { return window.HUG_I18N_DICT[lang] || null; }

  function tr(s) {
    var d = dict();
    if (!d) return s;
    var key = s.replace(/\s+/g, " ").trim();
    if (!key) return s;
    var v = d[key];
    if (typeof v !== "string" || !v) return s;
    var lead = (s.match(/^\s*/) || [""])[0];
    var trail = (s.match(/\s*$/) || [""])[0];
    return lead + v + trail;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, SVG: 1 };
  function skippable(el) {
    var p = el;
    while (p && p.nodeType === 1) {
      if (SKIP[p.tagName]) return true;
      if (p.getAttribute) {
        if (p.getAttribute("translate") === "no") return true;
        if (p.hasAttribute("data-i18n-skip")) return true;
      }
      p = p.parentNode;
    }
    return false;
  }

  function translateTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) return;
    if (skippable(node.parentNode)) return;
    var t = tr(node.nodeValue);
    if (t !== node.nodeValue) node.nodeValue = t;
  }

  var ATTRS = ["placeholder", "data-placeholder", "aria-label", "title", "alt"];
  function translateEl(el) {
    if (el.nodeType !== 1) return;
    // Explicit key wins: <x data-i18n="Some English">
    var k = el.getAttribute("data-i18n");
    if (k) { var d = dict(); if (d && typeof d[k] === "string" && d[k]) el.textContent = d[k]; }
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v) { var tv = tr(v); if (tv !== v) el.setAttribute(a, tv); }
    }
    if ((el.tagName === "INPUT") && (el.type === "submit" || el.type === "button") && el.value) {
      var bv = tr(el.value); if (bv !== el.value) el.value = bv;
    }
  }

  function walk(root) {
    if (root.nodeType === 3) { translateTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (SKIP[root.tagName]) return;
    if (root.hasAttribute && (root.getAttribute("translate") === "no" || root.hasAttribute("data-i18n-skip"))) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var batch = [], n;
    while ((n = tw.nextNode())) batch.push(n);
    for (var i = 0; i < batch.length; i++) translateTextNode(batch[i]);
    translateEl(root);
    var els = root.querySelectorAll("[placeholder],[aria-label],[title],[alt],[data-i18n],input[type=submit],input[type=button]");
    for (var j = 0; j < els.length; j++) translateEl(els[j]);
  }

  function closePending() {
    var h = document.documentElement;
    if (h.classList.contains("hug-i18n-pending")) h.classList.remove("hug-i18n-pending");
  }

  // Exposed so a dictionary file can trigger the pass the moment it finishes loading.
  window.__hugApplyI18n = function () {
    try {
      if (lang !== DEFAULT && dict() && document.body) walk(document.body);
    } catch (e) {}
    closePending();
  };

  function boot() {
    if (!settled) { onSettled = boot; return; }        // still asking the native shelf (above)
    var h = document.documentElement;
    h.setAttribute("lang", lang);
    // Deliberately do NOT set dir="rtl". The app's chrome is built with physical-CSS
    // positioning (absolute left/right, translateX, grid columns) tuned for LTR, so
    // document-level mirroring breaks it — overlapping top bar, reversed number+unit
    // ("kg 69.6"), and content clipping off the edge on scaled devices. RTL languages
    // (ar/he/ur) are still fully translated and their text renders right-to-left within
    // each element via the browser's bidi algorithm; the layout keeps its proven LTR form.
    if (h.getAttribute("dir") === "rtl") h.removeAttribute("dir");

    if (lang === DEFAULT) { closePending(); return; }

    function afterDict() {
      window.__hugApplyI18n();
      // Re-translate content injected after the first pass. app.js rebuilds screen
      // innerHTML on navigation, so childList/subtree catches new nodes; characterData
      // catches in-place text swaps. Idempotent: a translated (non-English) string never
      // matches an English key, so re-visiting a node is a no-op — no loop.
      if (window.MutationObserver && document.body) {
        var mo = new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var mu = muts[i];
            if (mu.type === "characterData") { try { translateTextNode(mu.target); } catch (e) {} continue; }
            var added = mu.addedNodes;
            for (var j = 0; j < added.length; j++) { try { walk(added[j]); } catch (e) {} }
          }
        });
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
    }
    if (dict()) { afterDict(); return; }
    var base = SELF_SRC;
    if (!base) { var sc = document.querySelector('script[src*="hug-i18n.js"]'); base = sc && sc.src; }
    if (!base) { closePending(); return; }
    var url = base.replace(/hug-i18n\.js(\?|$)/, "hug-i18n-" + lang + ".js$1");
    var s = document.createElement("script");
    s.src = url;
    s.onload = afterDict;
    s.onerror = function () { closePending(); };
    (document.head || document.documentElement).appendChild(s);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* ── the HUG tick, inline in a line of text ──────────────────────────────────────────
   Every dictionary keys on the English string WITH its tick in it ("copied \u2713",
   "\u2713 available"), and each translation carries the tick in the right place for that
   language. So: translate first, THEN swap the character for the drawn mark. Nothing
   below uses innerHTML, so no string can smuggle markup in.
   Defined guarded, because several files may be the first one loaded. */
window.hugTickEl = window.hugTickEl || function () {
  var NS = 'http://www.w3.org/2000/svg';
  var s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'hug-tick');
  s.setAttribute('aria-hidden', 'true');
  var p = document.createElementNS(NS, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M18.16 4 C18.35 3.96 18.46 3.98 18.58 4 C18.69 4.02 18.8 4.06 18.87 4.11 C18.93 4.16 18.98 4.23 18.99 4.3 C19 4.38 19.36 3.93 18.94 4.57 C18.52 5.21 17.21 6.98 16.47 8.14 C15.73 9.3 15.13 10.33 14.49 11.53 C13.86 12.73 13.1 14.37 12.66 15.35 C12.21 16.33 12.07 16.74 11.81 17.42 C11.55 18.1 11.26 19.06 11.11 19.44 C10.96 19.83 11 19.65 10.91 19.73 C10.83 19.81 10.72 19.87 10.6 19.92 C10.49 19.96 10.35 19.99 10.21 20 C10.07 20.01 9.9 20.01 9.76 19.97 C9.62 19.93 9.69 20.2 9.36 19.77 C9.04 19.34 8.3 18.09 7.79 17.4 C7.28 16.7 6.74 16.1 6.31 15.6 C5.88 15.11 5.43 14.66 5.22 14.42 C5.01 14.19 5.09 14.25 5.05 14.18 C5.02 14.1 4.99 14.06 5.01 13.97 C5.03 13.88 5.09 13.74 5.19 13.65 C5.3 13.55 5.47 13.46 5.63 13.42 C5.78 13.37 5.99 13.36 6.14 13.37 C6.29 13.39 6.36 13.4 6.51 13.5 C6.67 13.6 6.8 13.68 7.07 13.97 C7.34 14.25 7.67 14.6 8.12 15.21 C8.57 15.82 9.48 17.2 9.78 17.63 C10.09 18.05 9.91 17.75 9.96 17.76 C10.02 17.77 10.07 17.75 10.12 17.7 C10.17 17.65 10.09 17.91 10.26 17.48 C10.44 17.05 10.85 15.92 11.19 15.11 C11.53 14.29 11.93 13.39 12.3 12.61 C12.67 11.82 13.07 11.03 13.42 10.38 C13.76 9.72 13.95 9.37 14.37 8.66 C14.79 7.96 15.51 6.8 15.94 6.14 C16.37 5.49 16.68 5.05 16.93 4.74 C17.19 4.42 17.26 4.37 17.46 4.25 C17.67 4.13 17.98 4.04 18.16 4 Z');
  s.appendChild(p);
  return s;
};
/* Set an element's text, with any tick in it drawn rather than typed. */
window.hugSetText = window.hugSetText || function (el, str) {
  if (!el) return;
  var s = String(str == null ? '' : str);
  try { if (typeof window.hugT === 'function') s = window.hugT(s); } catch (e) {}
  var parts = s.split('\u2713'), i;
  el.textContent = '';
  for (i = 0; i < parts.length; i++) {
    if (i) el.appendChild(window.hugTickEl());
    if (parts[i]) el.appendChild(document.createTextNode(parts[i]));
  }
};
/* Swap ticks already sitting in the DOM under `root` — for blocks built as an HTML
   string. Touches nothing but those characters. */
window.hugTickify = window.hugTickify || function (root) {
  if (!root || !document.createTreeWalker) return;
  var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), hits = [], n, i, j;
  while ((n = w.nextNode())) { if (n.nodeValue && n.nodeValue.indexOf('\u2713') >= 0) hits.push(n); }
  for (i = 0; i < hits.length; i++) {
    var parts = hits[i].nodeValue.split('\u2713'), frag = document.createDocumentFragment();
    for (j = 0; j < parts.length; j++) {
      if (j) frag.appendChild(window.hugTickEl());
      if (parts[j]) frag.appendChild(document.createTextNode(parts[j]));
    }
    hits[i].parentNode.replaceChild(frag, hits[i]);
  }
};
