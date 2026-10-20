/* ── ONE REVEAL, WHEN THE FIRST SCREEN IS WHOLE ────────────────────────────────────────
   The complaint: the app "loads in different parts, at different speeds" instead of arriving
   as one page. Filmed, it was worse than that sounds. On a phone a launch went black (the old
   launch screen) -> grey -> plain white -> a page with a "refer a friend to climb the
   leaderboard" line that was not true -> the real leaderboard rows ~1.5s later, pushing that
   line down. The web curtain lifted after a fixed 300ms whether or not anything was ready,
   so every part that arrived after that was seen arriving.

   Now the app keeps a short checklist of what the first screen needs, and each part ticks
   itself off when it is drawn in its FINAL form — from cache when there is one, from the
   server when there is not. Only when the list is empty does the cover lift, in one move.
   Parts:
     account      whose account this is (local + the durable mirror)
     balance      the money pill: a known figure, or a failed read
     points       the eco points hero
     leaderboard  real rows (cached or fetched), or a real answer — never the empty-state guess
     assets       the first screen's pictures decoded and fonts ready
     i18n         the saved language applied (non-English only)
   The cover is the native launch screen on a phone (see HugBridgeViewController) and the web
   curtain in index.html in a browser. Either way the page underneath is built while covered.

   It can never hang: BOOT_REVEAL_MAX_MS lifts it regardless. A returning user has every part
   in cache, so for them this costs nothing — the list empties as soon as the durable read
   lands. Only a genuinely cold launch waits on the network, and it waits on a calm logo
   screen instead of on a half-drawn page. */
(function bootGate() {
  // 2000, not 1200. A cold launch on a phone is two round trips — a stale session is refreshed
  // first, then the reads go out — and at 1200 the cover lifted between them, so the parts still
  // in flight arrived on the open page. The native cover's own failsafe (launchCoverMaxSeconds in
  // AppDelegate.swift) must stay above this plus the fade; scripts/launch-guard-test.mjs holds the
  // pair together.
  var BOOT_REVEAL_MAX_MS = 2000;
  var h = document.documentElement;
  // Hold ids are kebab tokens on purpose: tools/i18n/extract.mjs reads every string literal in
  // this file as potential UI copy, and a bare word like "leaderboard" would be queued for
  // translation into 20 languages. It treats kebab tokens as code.
  var holds = new Set(["boot-account", "boot-balance", "boot-points", "boot-leaderboard", "boot-assets", "boot-i18n", "boot-safe-area"]);
  var revealed = false, waiters = [], t0 = (window.performance && performance.now()) || 0;
  // When each part ticked off, in ms since page start. Kept (it is tiny) so a slow launch on a
  // real phone can be read back: the reveal writes it to the console and to HugDiag.
  var timeline = [["app.js", Math.round(t0)]];
  function now() { return Math.round((window.performance && performance.now()) || 0); }
  function reveal(reason) {
    if (revealed) return;
    revealed = true;
    window.__hugBoot.reason = reason;
    window.__hugBoot.at = ((window.performance && performance.now()) || 0) - t0;
    timeline.push(["reveal:" + reason, now()]);
    var summary = timeline.map(function (e) { return e[0] + "@" + e[1]; }).join(" ") +
      (holds.size ? " || waiting " + Array.from(holds).join(",") : "");
    try { console.info("[hug-boot] " + summary); } catch (e) {}
    try { if (window.HugDiag && window.HugDiag.mark) window.HugDiag.mark("boot_reveal", summary); } catch (e) {}
    var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    try {
      if (native) {
        // The native cover sits over everything. Drop the web curtain INSTANTLY underneath it
        // (a second fade would only be seen as a flicker at the edges), let the compositor
        // present the finished page for two frames, then ask native to fade its cover.
        h.classList.add("hug-boot-instant");
        h.classList.remove("hug-boot-pending");
        h.classList.remove("hug-boot-curtain-live");
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          var HL = window.HugLaunch || (window.Capacitor.Plugins && window.Capacitor.Plugins.HugLaunch);
          // Tell native exactly where the page drew its wordmark, so the cover's copy lands on
          // it during the fade. They match already at 393pt+; narrower phones scale the page
          // (fitToViewport) and would otherwise show a few-point jump.
          var logo = null;
          try {
            var img = document.querySelector('.screen[data-screen="home"] .logo img');
            var r = img && img.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) logo = { x: r.left, y: r.top, w: r.width, h: r.height };
          } catch (e) {}
          try { if (HL && HL.reveal) HL.reveal(logo ? { duration: 260, logo: logo } : { duration: 260 }); } catch (e) {}
        }); });
      } else {
        h.classList.remove("hug-boot-pending");      // starts the 260ms web fade
        // Outlast the fade before dropping the logo's raised stacking, or the wordmark greys
        // out behind a sheet that is still partly opaque.
        setTimeout(function () { try { h.classList.remove("hug-boot-curtain-live"); } catch (e) {} }, 400);
      }
    } catch (e) {}
    var w = waiters; waiters = [];
    for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) {} }
  }
  // If the cap had to lift the cover before a part was ready (a first launch on a slow
  // network), that part will arrive on a page the user is already looking at. It then fades in
  // over 240ms instead of snapping in, so a late arrival reads as the page settling rather
  // than as a piece that failed to load. Started in rAF, i.e. before the frame that first
  // paints the new content, so that frame is already at opacity 0 — there is no flash first.
  var LATE = {
    "boot-balance": '.screen[data-screen="home"] .impact-value',   // the stats hang off the referral count
    "boot-points": '.points-block .points',
    "boot-leaderboard": '.screen[data-screen="home"] .leader-list'
  };
  function lateIn(sel) {
    if (!sel) return;
    requestAnimationFrame(function () {
      try {
        document.querySelectorAll(sel).forEach(function (el) {
          if (el.animate) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
        });
      } catch (e) {}
    });
  }
  window.__hugBoot = {
    release: function (name) {
      if (!holds.delete(name)) return;
      timeline.push([name, now()]);
      if (revealed) { lateIn(LATE[name]); return; }
      if (!holds.size) reveal("ready");
    },
    // Run `cb` once the page is showing. Anything that MOVES on its own (intro animations)
    // belongs here, so it starts on a page the user can see, not under the cover.
    onReveal: function (cb) { if (revealed) { try { cb(); } catch (e) {} } else waiters.push(cb); },
    pending: function () { return Array.from(holds); },
    timeline: function () { return timeline.slice(); },
    get revealed() { return revealed; }
  };
  setTimeout(function () { reveal("cap"); }, BOOT_REVEAL_MAX_MS);

  // i18n: the head script adds hug-i18n-pending only for a saved non-English language, and the
  // engine removes it once the page is translated.
  if (!h.classList.contains("hug-i18n-pending")) window.__hugBoot.release("boot-i18n");
  else new MutationObserver(function (_, mo) {
    if (h.classList.contains("hug-i18n-pending")) return;
    mo.disconnect(); window.__hugBoot.release("boot-i18n");
  }).observe(h, { attributes: true, attributeFilter: ["class"] });

  // status bar: on an iPhone the WebView learns its status-bar inset (env(safe-area-inset-top),
  // which every header's padding is built on) a few hundred ms AFTER the page can be ready.
  // Measured on the iPhone 16e simulator (2026-10-15): the reveal was asked for at 86 ms, the
  // inset read 0 until 451 ms, then 47 px. Lifting the cover in between showed the whole page
  // 47 pt too high for the first frames of the fade and then dropped it into place (owner: "the
  // contents ... very quickly jitter in"), and the cover's wordmark faded out beside a page
  // wordmark that was still too high. So on iOS the cover waits for the inset; the
  // BOOT_REVEAL_MAX_MS cap still lifts it regardless. Every portrait iPhone has a status bar, so
  // the inset is never legitimately 0 there. Nothing waits anywhere else (a browser, or Android,
  // may truly have 0).
  (function waitForStatusBarInset() {
    var C = window.Capacitor;
    var ios = false;
    try { ios = !!(C && C.getPlatform && C.getPlatform() === "ios"); } catch (e) {}
    if (!ios) { window.__hugBoot.release("boot-safe-area"); return; }
    var probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)";
    (document.body || h).appendChild(probe);
    (function check() {
      var top = 0;
      try { top = parseFloat(getComputedStyle(probe).paddingTop) || 0; } catch (e) {}
      if (top > 0 || window.__hugBoot.revealed) {
        try { probe.remove(); } catch (e) {}
        window.__hugBoot.release("boot-safe-area");
        return;
      }
      requestAnimationFrame(check);
    })();
  })();

  // assets: every picture on the home screen decoded, and web fonts settled. decode() rather
  // than onload: a loaded image can still paint a frame late on first use while it decodes.
  function settleAssets() {
    var imgs = Array.prototype.slice.call(document.querySelectorAll('.screen[data-screen="home"] img:not([loading="lazy"])'));
    var jobs = imgs.map(function (img) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); });
    if (document.fonts && document.fonts.ready) jobs.push(document.fonts.ready.catch(function () {}));
    Promise.all(jobs).then(function () { window.__hugBoot.release("boot-assets"); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", settleAssets, { once: true });
  else settleAssets();
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

/* =============================================================================
   hug — referral-rewards app prototype
   app.js  ·  all interaction + the hand-tuned transition state machine
   -----------------------------------------------------------------------------
   Responsible for:
     · screen routing (data-go / data-go-home) and the global logo
     · directional swipe + rubber-band "drag-peek" between screens
     · the bag (shop) open / close choreography and product-render carousel
     · settings <-> account / bag <-> scan special-case transitions
     · quantity pebble, checkout total, bag-count badge
     · swapping the placeholder <img> icons for the crisp inline SVG library
   Asset paths are relative to index.html (see /assets).
   ============================================================================= */

    // What a figure the app cannot honestly state looks like. Used wherever a read
    // failed or has not answered yet: an em dash is not a claim, whereas "0" and
    // "£0.00" are — and a customer cannot tell a fabricated zero from a real one.
    const HUG_UNKNOWN = "—";
    // Translate a WHOLE English template through the dictionary, then drop the values in.
    // "{n} kg of ocean plastic collected" is one dictionary key, so word order can differ per
    // language; building it by concatenation would leave fragments no dictionary can match.
    function hugTpl(tpl, vars) {
      let s = tpl;
      try { if (typeof window.hugT === "function") s = window.hugT(tpl) || tpl; } catch (e) {}
      if (vars) for (const k in vars) s = s.split("{" + k + "}").join(String(vars[k]));
      return s;
    }
    const phone = document.getElementById("phone");
    const globalLogo = document.querySelector("[data-go-home]");
    // Current responsive scale of the device (set by the fit helper at the
    // bottom of this file). Pointer deltas are divided by this so drags track
    // the finger 1:1 even when the phone is scaled to fit the viewport.
    const currentFitScale = () => window.__hugFit || 1;
    const screens = [...document.querySelectorAll(".screen")];
    const svgIconTargets = [...document.querySelectorAll("svg[data-lib-icon]")];
    const iconLibraryInline = document.getElementById("icon-library-inline");
    const screenOrder = ["home", "qr", "scan"];
    const bagCounts = [...document.querySelectorAll(".bag-count")];
    const qtyNumber = document.getElementById("qty-number");
    const checkoutTotalValue = document.getElementById("checkout-total-value");
    const checkoutDiscountRow = document.getElementById("checkout-discount");
    const checkoutDiscountValue = document.getElementById("checkout-discount-value");
    let referralApplied = false;   // referral code applied -> preview the friend's discount in the total
    // The friend's discount: a flat 5% (owner, 2026-10-13: 5% for the friend, 5% for the referrer,
    // no £1,000 step). The preview starts at 5%; the real figure arrives with the minted code
    // (native-bridge "hug:referral-rate") and Shopify takes off exactly that.
    let referralFriendRate = 0.05;
    const REFERRAL_DISCOUNT_RATE_DEFAULT = 0.05;
    const scanScreen = document.querySelector('.screen[data-screen="scan"]');
    const scanStatus = scanScreen?.querySelector(".scan-status");
    const scanRestart = scanScreen?.querySelector(".scan-restart");
    const scanResult = scanScreen?.querySelector(".scan-result");
    const scanResultKicker = scanScreen?.querySelector(".scan-result-kicker");
    const scanResultTitle = scanScreen?.querySelector(".scan-result-title");
    const scanResultMessage = scanScreen?.querySelector(".scan-result-message");
    const scanResultCode = scanScreen?.querySelector(".scan-result-code");
    const scanActivateAccount = scanScreen?.querySelector(".scan-activate-account");
    const scanClaimProduct = scanScreen?.querySelector(".scan-claim-product");
    const scanResultAgain = scanScreen?.querySelector(".scan-result-again");
    const scanDone = scanScreen?.querySelector(".scan-done");
    const scanCancel = scanScreen?.querySelector(".scan-cancel");
    const scanAccountSheet = scanScreen?.querySelector(".scan-account-sheet");
    const scanAccountForm = scanScreen?.querySelector(".scan-account-form");
    const scanAccountEmail = scanScreen?.querySelector(".scan-account-email");
    const scanAccountError = scanScreen?.querySelector(".scan-account-error");
    const scanAccountClose = scanScreen?.querySelector(".scan-account-close");
    const scanAccountCancel = scanScreen?.querySelector(".scan-account-cancel");
    const scanAccountCode = scanScreen?.querySelector(".scan-account-code");
    const scanAccountTitle = scanScreen?.querySelector(".scan-account-title");
    const scanAccountCopy = scanScreen?.querySelector(".scan-account-copy");
    const scanAccountConfirm = scanScreen?.querySelector(".scan-account-confirm");
    const profileEmailValue = document.querySelector('.screen[data-screen="profile"] .email-value');
    const linkedProductsList = document.getElementById("linked-list");
    const linkedProductsEmpty = document.getElementById("linked-empty");
    const linkedProductsAdd = document.getElementById("linked-add");
    const linkedReferral = document.getElementById("linked-referral");
    const linkedReferralClose = linkedReferral?.querySelector(".linked-referral-close");
    const linkedReferralName = linkedReferral?.querySelector(".linked-referral-name");
    const linkedReferralColour = linkedReferral?.querySelector(".linked-referral-colour");
    const linkedReferralCode = linkedReferral?.querySelector(".linked-referral-code");
    const linkedReferralQr = linkedReferral?.querySelector(".linked-referral-qr");
    const linkedReferralLink = linkedReferral?.querySelector(".linked-referral-link");
    const linkedReferralShowQr = linkedReferral?.querySelector(".linked-referral-show-qr");
    const linkedReferralCopy = linkedReferral?.querySelector(".linked-referral-copy");
    const linkedReferralShare = linkedReferral?.querySelector(".linked-referral-share");
    const unitPrice = 30;
    const BAG_COUNT_FADE_MS = 150;
    const BAG_MOTION_MS = 760;
    const BAG_EXIT_MS = 420;
    const BAG_CAROUSEL_RENDER_MS = 540;
    const SETTINGS_MOTION_MS = 520;
    const ACCOUNT_MOTION_MS = 760;
    const ACCOUNT_EXIT_MS = 360;
    const cartQty = [0, 0, 0, 0];
    const cartTotal = () => cartQty.reduce((a, b) => a + b, 0);
    let scanRequestId = 0;
    let confirmedScannedCode = "";
    let confirmedHugProductCode = "";
    let confirmedHugProduct = null;
    let confirmedUnitToken = "";        // server unit token from a https://www.thehuggable.co/u/<token> QR
    let activationKeyboardHeight = 0;
    let activationStage = "email";      // "email" -> "code" (OTP verify)
    let activationEmail = "";
    let activationBusy = false;
    const HUG_PRODUCT_CODE_RE = /^HUG-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
    const HUG_LINKED_PRODUCTS_KEY = "hug-linked-products-v1";
    const HUG_ACCOUNT_STATE_KEY = "hug-account-state-v1";
    const HUG_ACCOUNT_EMAIL_KEY = "hug-account-email-v1";
    const HUG_REFERRAL_CODE_KEY = "hug-referral-code-v1";
    const HUG_BALANCE_CACHE_KEY = "hug-balance-cache-v1";
    // Your tokens — the home hero number. Cached for the same reason the balance is:
    // it comes from the leaderboard RPC, so without one it reads 0 until the network lands.
    // Renamed from "hug-points-cache-v1" when eco points became tokens: the figure's meaning
    // changed (25 per mug became 6), so an old cached "375" must never be read as tokens.
    const HUG_POINTS_CACHE_KEY = "hug-tokens-cache-v1";
    // HUG Giving. The public facts (causes, token value) and this account's own split, cached and
    // mirrored like the balance: the home row and the impact screen both lead with them, so a
    // part that waits for the network pops in late. The account's copy is cleared on sign-out.
    const HUG_GIVING_OVERVIEW_KEY = "hug-giving-overview-v1";
    const HUG_GIVING_MINE_KEY = "hug-giving-mine-v1";
    // The home impact row's last-viewed panel ({ who, panel }), written by impactRow. Per account,
    // mirrored, and cleared with the rest of the account's state on sign-out.
    const HUG_IMPACT_PANEL_KEY = "hug-impact-panel-v1";
    // The last leaderboard this device drew. Mirrored like the balance and the points: it was
    // the ONE part of the first screen kept only in localStorage, so after a WebKit eviction
    // every other part came back from the durable copy and the board alone waited on the
    // network — "the leaderboard loads the slowest". Written by leaderboardFeature below.
    const HUG_LEADERBOARD_CACHE_KEY = "hug-leaderboard-cache-v2";   // v2: rows are tokens now, not eco points

    // Stay signed in across launches (the device lock is the auth) — the session
    // persists in Capacitor Preferences and is restored on boot; the user only
    // leaves via an explicit sign-out. Flip to TRUE only to force a signed-out
    // boot for testing the sign-in / Face ID flow (chips + Keychain logins
    // survive). When TRUE, the boot session-restore (syncAccountFromBackend)
    // awaits `hugLoginReset` below so it can't race getSession() and re-sign-in.
    const HUG_ALWAYS_SIGNED_OUT_ON_BOOT = false;
    let hugLoginReset = Promise.resolve();
    window.addEventListener("load", function () {
      if (!HUG_ALWAYS_SIGNED_OUT_ON_BOOT) return;
      try {
        // Both stores, or the reset does not reset: the durable mirror outlives
        // localStorage by design, so clearing only localStorage leaves the account to be
        // restored from the mirror on the very next boot.
        [HUG_ACCOUNT_STATE_KEY, HUG_ACCOUNT_EMAIL_KEY, HUG_REFERRAL_CODE_KEY, HUG_LINKED_PRODUCTS_KEY, HUG_BALANCE_CACHE_KEY, HUG_POINTS_CACHE_KEY, HUG_GIVING_MINE_KEY, HUG_IMPACT_PANEL_KEY, "hug-demo-mode"]
          .forEach(function (k) {
            try { localStorage.removeItem(k); } catch (e) {}
            durableRemove(k);
          });
        // Wipe the displayed legacy linked products + purchases immediately (don't
        // wait for the async signOut), so a fresh boot never flashes stale data.
        try { clearHugLinkedProducts(); } catch (e) {}
        try { if (window.__hugPurchases) window.__hugPurchases.clear(); } catch (e) {}
        hugLoginReset = Promise.resolve(window.HugBackend && window.HugBackend.signOut && window.HugBackend.signOut())
          .catch(function () {})
          .then(function () { if (window.clearHugAccountState) window.clearHugAccountState(); });
      } catch (e) {}
    });

    // Developer-only reset (not wired into any UI / production flow): clears only
    // this app's own localStorage keys and reloads, returning the app to guest
    // mode for testing. Uses the key constants above so nothing is hardcoded.
    window.hugDebugReset = function () {
      const keys = [HUG_LINKED_PRODUCTS_KEY, HUG_ACCOUNT_STATE_KEY, HUG_ACCOUNT_EMAIL_KEY, HUG_REFERRAL_CODE_KEY, HUG_BALANCE_CACHE_KEY, HUG_POINTS_CACHE_KEY, HUG_GIVING_MINE_KEY, HUG_IMPACT_PANEL_KEY];
      keys.forEach(function (key) {
        try { localStorage.removeItem(key); } catch (e) {}
        durableRemove(key);   // the mirror too, or the next boot restores what this cleared
      });
      console.log("hugDebugReset: cleared", keys);
      // Also end the Supabase session (if the backend is wired) before reloading.
      let signedOut = Promise.resolve();
      try { signedOut = Promise.resolve(window.HugBackend?.signOut?.()); } catch (e) {}
      signedOut.catch(function () {}).then(function () { location.reload(); });
    };
    const HUG_QR_HOSTS = new Set([
      "thehuggable.co",
      "www.thehuggable.co"
    ]);
    // Phase 1B: a build-time flag baked into the bundle (hug-flags.js, generated
    // by scripts/build.mjs) marks a production build. Read once at boot; fails
    // CLOSED — a missing/unknown stamp is treated as production (strictest). The
    // demo/test QR affordances below (synthetic test SKUs; linking a product
    // WITHOUT an atomic server claim) exist only when this is false.
    const IS_PRODUCTION_BUILD = (function () {
      try {
        const b = window.__HUG_BUILD__ || {};
        if (window.__HUG_DEMO__ === true) return false;
        return b.env ? b.env === "production" : true;
      } catch (e) { return true; }
    })();
    const HUG_PRODUCT_CATALOG = Object.freeze(Object.assign({
      "HUG-DR-001": Object.freeze({ productName: "hugo", colourName: "dark roast" }),
      "HUG-BC-001": Object.freeze({ productName: "hugo", colourName: "blue crush" }),
      "HUG-CP-001": Object.freeze({ productName: "hugo", colourName: "cherry pop" }),
      "HUG-LD-001": Object.freeze({ productName: "hugo", colourName: "lemon drop" })
    }, IS_PRODUCTION_BUILD ? {} : {
      // Non-production only: synthetic test SKUs for demo/dev scanning.
      "HUG-TEST-001": Object.freeze({ productName: "hugo", colourName: "dark roast" }),
      "HUG-TEST-002": Object.freeze({ productName: "hugo", colourName: "blue crush" })
    }));
    let linkedProducts = [];
    let accountStatus = "guest";
    let accountEmail = null;
    let referralCode = "";
    let referralAvailableCents = 0;
    let referralPendingCents = 0;
    let referralCashedOutCents = 0;
    let referralRewardCount = 0;
    /* Do we actually KNOW this signed-in user's balance yet (seeded from cache, or the
       server answered)? On the very first launch after an update there is no cache, and
       painting "£0.00" would state something false about their money. Until it is known
       the pill renders blank and fills in when the figure arrives. Guests legitimately
       show £0.00 — this only gates the signed-in unknown window. */
    let balanceKnown = false;
    /* …and do we even know WHOSE account this is yet?
       "Guest" is only an honest answer when the device actually says so. When localStorage
       holds no account status at all, the two possibilities — a genuine first run, and a
       signed-in user whose localStorage was evicted — are indistinguishable until the
       durable mirror is read a few ms later. Treating that as "guest" is what let the app
       state £0.00 as fact about someone's money before it had any idea who they were.
       So the whole account state, not just the figure, is UNKNOWN for that window: the pill
       stays blank rather than asserting a zero it may have to take back. Cleared by
       restoreDurableAccountState() either way, so it can never stick. */
    let bootAccountStateUnknown = false;

    // ---- Prototype mode ------------------------------------------------------
    // Shows the app as it will look once it is full of people, referrals and money — so it can
    // be demonstrated before that is true. Ruary, 2026-10-01: "so i can show what the referral
    // app will look like once it is populated with more people and results".
    //
    // WHO CAN TURN IT ON is decided on the server, not here: the referrals.prototype capability
    // (owners always; anyone else by a per-person grant on the admin access page), reported by
    // the referral_app_access() RPC. The app keeps that answer for the signed-in email and shows
    // the Settings switch only when it says yes.
    //
    // IT FAILS CLOSED. Prototype mode is on only when ALL of these hold, read once before
    // anything renders: this device chose "on", a real account is signed in, and the server's
    // last answer said yes FOR THAT SAME EMAIL. A missing answer, an answer for another account,
    // or a signed-out device is "off" — whatever the switch was left on. If the server later says
    // no (access removed), refreshPrototypeAccess() switches it off and reloads into the real
    // account.
    //
    // IT IS DISPLAY-ONLY. The sample world below lives in this bundle. While it is on, the
    // backend is never synced over it, and every write to the server is refused at the bridge
    // (native-bridge.js, prototypeGuard) — so nothing done in prototype can touch the real
    // account, the real referral ledger or a real order.
    //
    // Decided once per launch because roughly a dozen features read it while they build the
    // page; changing it means a reload, which the launch curtain covers.
    const HUG_PROTOTYPE_MODE_KEY = "hug-demo-mode";              // "on" | "off" — this device's choice
    const HUG_PROTOTYPE_ACCESS_KEY = "hug-prototype-access-v1";  // { email, prototype, at } — the server's answer
    const normEmail = (e) => String(e || "").trim().toLowerCase();
    function loadPrototypeAccess() {
      try {
        const a = JSON.parse(localStorage.getItem(HUG_PROTOTYPE_ACCESS_KEY) || "null");
        return a && typeof a === "object" ? a : null;
      } catch (error) { return null; }
    }
    function prototypeAllowedFor(email) {
      const a = loadPrototypeAccess();
      return !!(a && a.prototype === true && normEmail(email) && normEmail(a.email) === normEmail(email));
    }
    function savePrototypeAccess(email, allowed) {
      try {
        localStorage.setItem(HUG_PROTOTYPE_ACCESS_KEY, JSON.stringify({ email: normEmail(email), prototype: !!allowed, at: Date.now() }));
      } catch (error) { /* best-effort: without it the switch simply stays hidden */ }
    }
    function setPrototypeMode(on) {
      try { localStorage.setItem(HUG_PROTOTYPE_MODE_KEY, on ? "on" : "off"); } catch (error) {}
    }
    // Sign-out ends prototype mode and forgets the permission: the next person to sign in on
    // this device must be asked about afresh, never inherit someone else's yes.
    function clearPrototypeAccess() {
      try { localStorage.removeItem(HUG_PROTOTYPE_ACCESS_KEY); } catch (error) {}
      setPrototypeMode(false);
    }
    const PROTOTYPE_ON = (function () {
      try {
        if (localStorage.getItem(HUG_PROTOTYPE_MODE_KEY) !== "on") return false;
        if (localStorage.getItem(HUG_ACCOUNT_STATE_KEY) !== "active") return false;
        return prototypeAllowedFor(localStorage.getItem(HUG_ACCOUNT_EMAIL_KEY));
      } catch (error) { return false; }
    })();
    const PROTOTYPE_EMAIL = PROTOTYPE_ON ? normEmail(localStorage.getItem(HUG_ACCOUNT_EMAIL_KEY)) : "";
    function isDemoMode() { return PROTOTYPE_ON; }
    window.__hugIsDemo = isDemoMode;
    document.documentElement.dataset.demo = PROTOTYPE_ON ? "on" : "off";

    /* THE SAMPLE WORLD. One self-consistent picture of a busy app, so every screen ties up:
       the referral history is the money (the balance and the account cells are summed from it),
       the tokens obey the real scale (6 per linked hug + 1 per referral — the same formula
       as referral_leaderboard()), and the leaderboard puts "you" at a believable place in a
       long, realistic tail of other people. Deterministic (seeded), so it is the same picture on
       every launch and in every screenshot. */
    const DEMO_REFERRAL_ORDERS = 268;   // every referral ended in an order (see applySummary)
    const DEMO = {
      linkedCodes: ["HUG-DR-001", "HUG-CP-001", "HUG-BC-001", "HUG-LD-001"],
      referrals: DEMO_REFERRAL_ORDERS,
      get mugs() { return this.linkedCodes.length; },
      get points() { return 6 * this.mugs + 1 * this.referrals; },   // tokens == leaderboard "you" == home hero (6x4 + 1x268 = 292)
      // Fallbacks only — the demo balance is summed from the history txns. They equal those sums
      // (5% of every order: 505 mugs x £1.50 = £757.50), so a paint before the history builds
      // states the same figures (scripts/referral-rate-test.mjs pins this).
      availableCents: 10500,
      pendingCents: 7050,
      cashedOutCents: 58200,
      qrScans: 3184,
      referralCode: "HUGPROTO",
      name: (PROTOTYPE_EMAIL.split("@")[0] || "you").replace(/[^a-z]/g, "") || "you",
      email: PROTOTYPE_EMAIL || "you@example.com",
      bankLast4: "4471",
      address: { "name": "", "street-address": "14 Maple Street", "city": "Bristol", "postal-code": "BS1 4ND" },
      // Seeded generator: same sequence every launch.
      rng(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; },
      // n distinct display names in the shapes real people choose: "maya k", "theo.b", a handle.
      people(n, seed) {
        const FIRST = ["maya","theo","isla","leo","ruby","finn","elsie","arlo","orla","kai","willow","jude",
          "iris","reuben","edie","otis","maeve","jonah","etta","milo","cleo","dexter","posy","hugo","marnie",
          "bram","cora","dax","fern","gus","hazel","juno","kit","lena","mabel","ned","opal","quinn","rory",
          "sage","tess","uma","vera","wade","yara","zane","bea","enzo","flo","gwen","hank","imo","jett","kira",
          "lottie","nell","ori","pia","remy","sol","tova","amara","felix","sienna","rowan","nina","omar","priya",
          "sam","alex","jamie","noor","ezra","ada","ivy","luke","noa","eli","harriet","fatima","ben","chloe",
          "aria","max","zara","oscar","freya","rafi","tomas","yusuf","ines","kemi","mei","sofia","lucas","hana",
          "anya","bilal","carys","dmitri","esme","gabe","hollie","idris","jess","kofi","laila","mo","nia","olly",
          "petra","raj","saoirse","toby","una","viktor","wren","xander","yasmin","zoe","alfie","bella","cal"];
        const HANDLE = ["ladymoon","coffeefox","oatlatte","brewdad","flatwhite","lidlover","teaforone","mugshot",
          "slowpour","cupcrew","beanqueen","refillrita","pocketmug","hugfan","morningsip","greenhouse",
          "plasticfree","littlesteps","cosycup","warmhands","citycyclist","trailmix","sundayroast","kettleon"];
        const ABC = "abcdefghijklmnoprstvwy";
        const r = this.rng(seed), out = [], seen = new Set();
        for (let i = 0; out.length < n && i < n * 20; i++) {
          const f = FIRST[Math.floor(r() * FIRST.length)], x = r(), c = ABC[Math.floor(r() * ABC.length)];
          const name = x < 0.55 ? f + " " + c : x < 0.8 ? f + "." + c : x < 0.9 ? f + "_" + c + Math.floor(r() * 90 + 10)
            : HANDLE[Math.floor(r() * HANDLE.length)] + (r() < 0.5 ? "" : Math.floor(r() * 90 + 10));
          if (!seen.has(name)) { seen.add(name); out.push(name); }
        }
        return out;
      },
      // The leaderboard: five people ahead of you, you, then a long tail. Tokens are always
      // 6 per linked hug + 1 per referral, so every figure is at least 6.
      board(n) {
        const r = this.rng(4040), names = this.people(n, 909);
        const rows = [1010, 805, 630, 505, 405].map((p, i) => ({ label: names[i], points: p, me: false }));
        rows.push({ label: "you", points: this.points, me: true });
        let prev = this.points;
        for (let i = rows.length; i < n; i++) {
          const t = (i - 6) / Math.max(1, n - 7);
          const raw = 6 + (this.points * 0.86 - 6) * Math.pow(1 - t, 2.6) * (0.97 + r() * 0.06);
          const p = Math.max(6, Math.min(prev, Math.round(raw)));
          rows.push({ label: names[i], points: p, me: false });
          prev = p;
        }
        return rows;
      },
      // A few of your own past orders, for Settings → purchases.
      purchases() {
        const DAY = 86400000, now = Date.now();
        const mk = (ago, n, items) => ({ order_number: "#" + n, ordered_at: new Date(now - ago * DAY).toISOString(),
          total_cents: items.length * 3000, mug_qty: items.length, items: items.map((v) => ({ title: "hug o", variant: v })) });
        return [mk(19, 1184, ["lemon drop"]), mk(143, 1027, ["blue crush", "blue crush"]),
          mk(311, 1006, ["cherry pop"]), mk(402, 1001, ["dark roast"])];
      }
    };
    DEMO.address.name = DEMO.name;
    let selectedLinkedProduct = null;
    let referralCopyTimer = null;

    // Linked-product share link — query-mode launch link tied to the user's own
    // referral code (the referral system attributes on ?ref=). Matches referralUrl()'s
    // host + shape; productCode retained for a future per-product deep-link.
    // Launch uses ?ref= only — no /r/ shortlink (not a real HTTP redirect yet).
    function buildLocalReferralUrl(productCode) {
      void productCode;
      return referralUrl(loadReferralCode());
    }

    // The user's personal referral code (one per account, minted server-side).
    // Cached locally like the email so it survives offline app launches.
    function loadReferralCode() {
      try {
        return String(localStorage.getItem(HUG_REFERRAL_CODE_KEY) || "").trim();
      } catch (error) {
        return "";
      }
    }

    function saveReferralCode(code) {
      // Mirrored for the same reason as the linked products: without the code the master
      // QR falls back to its "set up an account" nudge, in front of somebody who has one.
      if (code) durableSet(HUG_REFERRAL_CODE_KEY, code);
      else durableRemove(HUG_REFERRAL_CODE_KEY);
      try {
        if (code) {
          localStorage.setItem(HUG_REFERRAL_CODE_KEY, code);
        } else {
          localStorage.removeItem(HUG_REFERRAL_CODE_KEY);
        }
      } catch (error) {
        console.warn("Unable to save referral code", error);
      }
    }

    // Render the real code into the profile share-box: the visible value and the
    // data-copy on both copy buttons (code + link). The generic copy handler
    // reads data-copy at click time, so updating the attribute is enough.
    // The canonical referral URL the master QR + copy-link encode: straight to the
    // Shopify product picker with the code, so it lands on "choose your hug",
    // applies the friend's discount on add-to-cart, and credits this user.
    // (Swap the host to a branded thehuggable.co domain once it's on Shopify.)
    function referralUrl(code) {
      return `https://zyeeke-kx.myshopify.com/products/hug-o?ref=${encodeURIComponent(code)}`;
    }

    function renderReferralCode() {
      const shareValue = document.querySelector(".share-box .share-value");
      const codeBtn = document.querySelector('.share-box .copy-btn[aria-label="Copy referral code"]');
      const linkBtn = document.querySelector('.share-box .copy-btn[aria-label="Copy referral link"]');
      const qrSlot = document.querySelector(".share-box .share-qr");
      const code = (accountStatus === "active" || isDemoMode()) ? referralCode : "";
      if (shareValue) shareValue.textContent = code || "—";
      if (codeBtn) codeBtn.setAttribute("data-copy", code);
      if (linkBtn) linkBtn.setAttribute("data-copy", code ? referralUrl(code) : "");
      // The account's "master" referral QR — generated from the code, same
      // styled aesthetic as the etch maker. Static icon before activation.
      if (qrSlot) {
        if (code && window.HugQr) {
          qrSlot.innerHTML = window.HugQr.render(referralUrl(code), { ecc: "M" });
          qrSlot.classList.add("share-qr-live");
        } else {
          qrSlot.innerHTML = '<img src="assets/icon-qr.svg" alt="QR code">';
          qrSlot.classList.remove("share-qr-live");
        }
      }
    }

    // Save the master referral QR as a crisp PNG so it can be shared or dropped
    // into a video. SVG -> offscreen canvas -> PNG download.
    function downloadReferralQr() {
      if (!referralCode || !window.HugQr) return;
      const svg = window.HugQr.render(referralUrl(referralCode), { ecc: "M" });
      const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      img.onload = () => {
        const px = 1024;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = px;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, px, px);
        ctx.drawImage(img, 0, 0, px, px);
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob(blob => {
          if (!blob) return;
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `hug-referral-${referralCode}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        }, "image/png");
      };
      img.onerror = () => URL.revokeObjectURL(svgUrl);
      img.src = svgUrl;
    }

    // Tap the master QR to save it (wired once; innerHTML swaps keep this).
    (function wireReferralQr() {
      const qrSlot = document.querySelector(".share-box .share-qr");
      if (!qrSlot) return;
      qrSlot.setAttribute("role", "button");
      qrSlot.setAttribute("aria-label", "Save referral QR code");
      qrSlot.addEventListener("click", () => {
        if (accountStatus === "active" && referralCode) downloadReferralQr();
      });
    })();

    async function refreshReferralCodeFromServer(prefetched) {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await (prefetched || backend.getMyProfile());
      if (!res.ok) return;
      if (res.referralCode) {
        referralCode = res.referralCode;
        saveReferralCode(referralCode);
        renderReferralCode();
        // The master QR's gate render runs before this async fetch returns, so
        // re-render it now that we finally have the code — otherwise it stays
        // stuck on the "set up an account" nudge for a signed-in user.
        updateReferralGate();
      }
      applyShippingAddress(res.shippingAddress);   // shared delivery address (web parity)
    }

    // Fill the profile address form from the SHARED profiles.shipping_address.
    // Web shape: { name, line1, line2, city, postcode, country }. The app shows a
    // single street line, so line1+line2 are joined on read; saving folds them
    // back into line1 (see saveAddressToProfile). Pass null to clear the form.
    function applyShippingAddress(addr) {
      const form = document.querySelector('.screen[data-screen="profile"] .addr-form');
      if (!form) return;
      const street = addr ? [addr.line1, addr.line2].filter(Boolean).join(", ") : "";
      const map = {
        name: addr ? (addr.name || "") : "",
        "street-address": street,
        city: addr ? (addr.city || "") : "",
        "postal-code": addr ? (addr.postcode || "") : ""
      };
      Object.keys(map).forEach(function (k) {
        const el = form.querySelector('[name="' + k + '"]');
        if (el) el.value = map[k];
      });
      if (typeof prefillCheckoutAddress === "function") prefillCheckoutAddress();
    }
    window.__hugApplyShippingAddress = applyShippingAddress;

    function formatGbpCents(cents) {
      return "£" + (Math.max(0, Number(cents) || 0) / 100).toFixed(2);
    }

    // The top-bar "Referral balance" pill (shown on every screen) reflects
    // spendable (available/deposited) referral credit from the server. Pending
    // is kept on window.__hugReferral for the home intro motion and future
    // account-screen wiring. Guests / signed-out show £0.00.
    function renderReferralBalance() {
      const demo = isDemoMode();
      let available, pending, cashedOut, count;
      if (demo) {
        // Demo balance is derived from the same history txns the cards show, so
        // every figure ties up. (Fallback to the constants before history builds.)
        const t = (window.__hugAccount && window.__hugAccount.totals && window.__hugAccount.totals()) || null;
        available = t ? t.deposited : DEMO.availableCents;
        pending = t ? t.pending : DEMO.pendingCents;
        cashedOut = t ? t.cashedOut : (DEMO.cashedOutCents || 0);
        count = t ? t.referrals : 0;
      } else {
        const active = accountStatus === "active";
        available = active ? referralAvailableCents : 0;
        pending = active ? referralPendingCents : 0;
        cashedOut = active ? referralCashedOutCents : 0;
        count = active ? referralRewardCount : 0;
      }
      // A signed-in user whose balance we don't know yet gets a blank pill, not "£0.00":
      // stating £0 would be a false claim about their money for the ~1s before the server
      // answers on a first launch. Guests/demo are genuinely £0 and render normally.
      // Known = we can state this figure honestly. A confirmed guest genuinely is £0.00; a
      // signed-in user is only known once cached or fetched; and while the account state
      // itself is still unresolved (see bootAccountStateUnknown) nothing is known at all.
      const known = demo || (!bootAccountStateUnknown && (accountStatus !== "active" || balanceKnown));
      // loadFailed distinguishes "not known YET" (boot, in flight — say nothing quietly)
      // from "the read FAILED" (say nothing AND offer a retry). Without it a dropped
      // request left the account screen sitting on £0.00 for ever, with no error and
      // nothing to retry, and the user could not tell that from an empty account.
      window.__hugReferral = { availableCents: available, pendingCents: pending, cashedOutCents: cashedOut, count: count, known: known, loadFailed: !known && balanceLoadFailed };
      document.querySelectorAll(".balance").forEach(el => {
        el.textContent = known ? formatGbpCents(available) : "";
      });
      // The pill is final once it states a figure, or once the read has failed (it then
      // stays blank on purpose). Either way it will not change again on its own.
      if ((known || balanceLoadFailed) && window.__hugBoot) window.__hugBoot.release("boot-balance");
      if (window.__hugAccountHistory && window.__hugAccountHistory.applySummary) window.__hugAccountHistory.applySummary();
      if (window.__hugCashout) window.__hugCashout.refresh();
      if (window.__hugImpact) window.__hugImpact.load();   // referral count feeds the +1/referral impact bonus
    }

    // The balance read failed and has not since succeeded. Drives the "couldn't load —
    // retry" state on the account screen. `if (!res.ok) return;` on its own left the
    // screen asserting £0.00 permanently: no retry, no error, nothing to tell the user
    // the figure was never fetched.
    let balanceLoadFailed = false;
    async function refreshReferralBalanceFromServer(prefetched) {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      let res;
      try {
        res = await (prefetched || backend.getReferralBalance());
      } catch (error) {
        res = { ok: false };
      }
      if (!res || !res.ok) {
        balanceLoadFailed = true;
        renderReferralBalance();   // repaint so the unknown/retry state actually appears
        return;
      }
      balanceLoadFailed = false;
      referralAvailableCents = res.availableCents;
      referralPendingCents = res.pendingCents;
      referralCashedOutCents = res.cashedOutCents || 0;
      referralRewardCount = res.count || 0;
      if (window.__hugReferralRates) window.__hugReferralRates.set(res.rates || null);   // tiered rates (additive)
      balanceKnown = true;
      saveCachedBalance();   // so the NEXT launch paints these instead of £0.00
      renderReferralBalance();
    }
    // The retry the account screen's "couldn't load" state calls, and one automatic
    // attempt when the device comes back online — so a blip heals itself instead of
    // leaving a permanent blank.
    window.__hugRetryBalance = function () {
      refreshReferralBalanceFromServer();
      if (window.__hugAccountHistory && window.__hugAccountHistory.loadLive) window.__hugAccountHistory.loadLive();
      if (window.__hugLeaderboard && window.__hugLeaderboard.load) window.__hugLeaderboard.load();
    };
    window.addEventListener("hug:online", () => { if (balanceLoadFailed) window.__hugRetryBalance(); });

    function loadHugAccountStatus() {
      try {
        return localStorage.getItem(HUG_ACCOUNT_STATE_KEY) === "active" ? "active" : "guest";
      } catch (error) {
        console.warn("Unable to load account state", error);
        return "guest";
      }
    }

    /* Durable mirror (window.HugStore, defined by native-bridge.js).
       localStorage is the fast path — it is synchronous, so it is what the first paint can
       read. But on iOS WKWebView may evict it while the auth SESSION, which lives in
       Capacitor Preferences, survives. That combination is the bug behind "it opens at
       zero": still signed in, no idea who you are, so the pill asserts £0.00 and only
       corrects itself once the network answers.
       Every write below therefore goes to BOTH; the boot restore further down reads the
       durable copy back when localStorage has lost it. Writes are fire-and-forget: the
       mirror must never be able to delay or break the localStorage path it backs up.

       They share ONE QUEUE so they land in the order they were issued. Being fire-and-forget
       across an async bridge, the dangerous pair is adjacent: a balance save still in flight
       when a sign-out clears the same key. Resolving out of order would leave a signed-out
       device holding a balance on the durable shelf. Chaining costs nothing — nothing awaits
       these — and makes that reordering impossible rather than merely unlikely. */
    let durableQueue = Promise.resolve();
    function durableWrite(op) {
      durableQueue = durableQueue.then(op).catch(() => {});
      return durableQueue;
    }
    function durableSet(key, value) {
      durableWrite(() => window.HugStore?.set(key, value));
    }
    function durableRemove(key) {
      durableWrite(() => window.HugStore?.remove(key));
    }
    // The same queue for features outside this closure (the leaderboard), so their writes land
    // in issue order with the sign-out that clears them — the reordering guarded against above.
    window.__hugDurable = Object.freeze({ set: durableSet, remove: durableRemove });

    /* Last-known balance cache (display only).
       The server figures arrive ~a second after launch; without a cache the first paint
       is always £0.00 for a signed-in user, which then visibly pops to the real number.
       We mirror each successful server refresh into localStorage (synchronous, so it is
       readable before the first paint) and seed the in-memory figures from it at boot.
       The server remains the authority — this only decides what is painted in the gap.
       Cleared on sign-out so a signed-out device can never show a stale balance. */
    function loadCachedBalance() {
      try {
        const raw = localStorage.getItem(HUG_BALANCE_CACHE_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || typeof c !== "object") return null;
        const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
        return { availableCents: n(c.a), pendingCents: n(c.p), cashedOutCents: n(c.c), count: n(c.n) };
      } catch (error) { return null; }
    }
    function saveCachedBalance() {
      const payload = JSON.stringify({
        a: referralAvailableCents, p: referralPendingCents,
        c: referralCashedOutCents, n: referralRewardCount,
      });
      try {
        localStorage.setItem(HUG_BALANCE_CACHE_KEY, payload);
      } catch (error) { /* quota/private mode — cache is best-effort */ }
      durableSet(HUG_BALANCE_CACHE_KEY, payload);
    }
    function clearCachedBalance() {
      try { localStorage.removeItem(HUG_BALANCE_CACHE_KEY); } catch (error) {}
      durableRemove(HUG_BALANCE_CACHE_KEY);
    }

    /* Your eco points, cached on the same terms as the balance.
       The home hero reads them out of the leaderboard's is_me row, so with no cache it
       painted a literal 0 on every launch and corrected itself when the RPC answered —
       the same false-figure-then-pop the balance used to do, on the number the home
       screen leads with. Null means "not known yet", which is NOT the same as zero and
       must not render as one. */
    function loadCachedPoints() {
      try {
        const raw = localStorage.getItem(HUG_POINTS_CACHE_KEY);
        if (raw == null || raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
      } catch (error) { return null; }
    }
    function saveCachedPoints(points) {
      const n = Number(points);
      if (!Number.isFinite(n) || n < 0) return;
      try { localStorage.setItem(HUG_POINTS_CACHE_KEY, String(n)); } catch (error) {}
      durableSet(HUG_POINTS_CACHE_KEY, String(n));
    }
    function clearCachedPoints() {
      try { localStorage.removeItem(HUG_POINTS_CACHE_KEY); } catch (error) {}
      durableRemove(HUG_POINTS_CACHE_KEY);
    }
    // The signed-in account's my_giving(), on the same two shelves. Sign-out wipes the
    // on-screen copy too (givingFeature), or the next person would see this account's split.
    function clearCachedGivingMine() {
      try { localStorage.removeItem(HUG_GIVING_MINE_KEY); } catch (error) {}
      durableRemove(HUG_GIVING_MINE_KEY);
      try { localStorage.removeItem(HUG_IMPACT_PANEL_KEY); } catch (error) {}
      durableRemove(HUG_IMPACT_PANEL_KEY);
      if (window.__hugGiving) window.__hugGiving.forget();
    }

    /* ONE leaderboard read per refresh, shared.
       The board and the points hero each called getLeaderboard() independently, so every
       boot made the same request twice — and both of them waited on it before showing you
       your own standing. Callers that arrive while a read is in flight join it instead. */
    let leaderboardInFlight = null;
    function fetchLeaderboardOnce() {
      if (leaderboardInFlight) return leaderboardInFlight;
      const backend = window.HugBackend;
      if (!backend?.enabled) return Promise.resolve({ ok: false });
      const p = Promise.resolve(backend.getLeaderboard()).catch(() => ({ ok: false }));
      leaderboardInFlight = p;
      // Released once settled, so a later account change still re-reads rather than
      // replaying this boot's answer forever.
      p.then(() => { if (leaderboardInFlight === p) leaderboardInFlight = null; });
      return p;
    }

    function loadHugAccountEmail() {
      try {
        const storedEmail = String(localStorage.getItem(HUG_ACCOUNT_EMAIL_KEY) || "").trim();
        return isValidEmail(storedEmail) ? storedEmail : null;
      } catch (error) {
        console.warn("Unable to load account email", error);
        return null;
      }
    }

    function hasStoredHugAccountStatus() {
      try {
        return localStorage.getItem(HUG_ACCOUNT_STATE_KEY) !== null;
      } catch (error) {
        return false;
      }
    }

    function setHugAccountState(status, email = null) {
      accountStatus = status === "active" ? "active" : "guest";
      accountEmail = accountStatus === "active" && isValidEmail(email) ? String(email).trim() : null;
      if (accountStatus !== "active") {
        referralCode = "";
        saveReferralCode("");
        referralAvailableCents = 0;
        referralPendingCents = 0;
        referralCashedOutCents = 0;
        referralRewardCount = 0;
        clearCachedBalance();   // never let a signed-out device paint a stale balance
        clearCachedPoints();    // …or a stale tokens hero
        clearCachedGivingMine();   // …or the last account's split
        // …or the last board read for that account: it names them, and its "you" row is theirs.
        // Drops what is on screen and both cached copies (leaderboardFeature). Not yet defined
        // during this file's own boot render, when there is nothing to drop.
        if (window.__hugLeaderboard) window.__hugLeaderboard.forget();
      }
      document.documentElement.dataset.accountStatus = accountStatus;
      try {
        localStorage.setItem(HUG_ACCOUNT_STATE_KEY, accountStatus);
        if (accountEmail) {
          localStorage.setItem(HUG_ACCOUNT_EMAIL_KEY, accountEmail);
        } else {
          localStorage.removeItem(HUG_ACCOUNT_EMAIL_KEY);
        }
      } catch (error) {
        console.warn("Unable to save account state", error);
      }
      // …and to the durable shelf the session is on, so an evicted localStorage cannot
      // leave a signed-in device believing it is a guest. See durableSet above.
      durableSet(HUG_ACCOUNT_STATE_KEY, accountStatus);
      if (accountEmail) durableSet(HUG_ACCOUNT_EMAIL_KEY, accountEmail);
      else durableRemove(HUG_ACCOUNT_EMAIL_KEY);
      // Prototype permission belongs to one signed-in person. Signed out: forget it. Signed in:
      // ask the server for THIS email (no-op until the bridge exists; boot asks again after).
      if (accountStatus !== "active") clearPrototypeAccess();
      else if (window.__hugRefreshPrototypeAccess) window.__hugRefreshPrototypeAccess();
      renderHugAccountState();
    }

    function clearHugAccountState() {
      setHugAccountState("guest");
      closeAccountActivation();
      closeLinkedReferral();
      applyShippingAddress(null);   // don't leak the previous user's address
      clearHugLinkedProducts();     // wipe the previous account's linked products
      if (window.__hugPurchases) window.__hugPurchases.clear();   // and its purchase history
    }

    window.clearHugAccountState = clearHugAccountState;

    function isValidEmail(value) {
      const email = String(value || "").trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // Referrals require at least one linked product. Drive the share-box state
    // (guest / locked / ready) and toast when the last product is unlinked.
    let referralGate = "";
    function showToast(message) {
      let el = document.getElementById("hug-toast");
      if (!el) { el = document.createElement("div"); el.id = "hug-toast"; el.className = "hug-toast"; document.body.appendChild(el); }
      if (window.hugSetText) window.hugSetText(el, message); else el.textContent = message;
      el.classList.add("show");
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => el.classList.remove("show"), 3400);
    }
    // On-theme yes/no confirm. Returns a Promise<boolean>.
    function showConfirm(opts) {
      const o = opts || {};
      return new Promise(resolve => {
        const ov = document.createElement("div");
        ov.className = "hug-confirm-overlay";
        ov.innerHTML =
          '<div class="hug-confirm-card" role="dialog" aria-modal="true">' +
            '<p class="hug-confirm-title"></p><p class="hug-confirm-body"></p>' +
            '<div class="hug-confirm-actions">' +
              '<button type="button" class="hug-confirm-cancel"></button>' +
              '<button type="button" class="hug-confirm-ok"></button>' +
            '</div></div>';
        ov.querySelector(".hug-confirm-title").textContent = o.title || "";
        ov.querySelector(".hug-confirm-body").textContent = o.body || "";
        ov.querySelector(".hug-confirm-cancel").textContent = o.cancel || "Cancel";
        ov.querySelector(".hug-confirm-ok").textContent = o.confirm || "Confirm";
        const close = val => { ov.classList.remove("show"); setTimeout(() => ov.remove(), 220); resolve(val); };
        ov.querySelector(".hug-confirm-cancel").addEventListener("click", () => close(false));
        ov.querySelector(".hug-confirm-ok").addEventListener("click", () => close(true));
        ov.addEventListener("click", e => { if (e.target === ov) close(false); });
        document.body.appendChild(ov);
      if (window.hugTickify) window.hugTickify(ov);
        requestAnimationFrame(() => ov.classList.add("show"));
      });
    }
    // A note at the front of the screen (showConfirm's card, one button): a title, an optional
    // amount on its own line, and short lines. Amounts never sit inside a sentence, so every line
    // stays one fixed string the translator can match. Closes on its button, the backdrop or Esc.
    // Returns close(). On body, outside the phone's tap handlers, so closing never also counts as
    // a tap on the screen behind.
    let noteSeq = 0;
    function showNote(opts) {
      const o = opts || {};
      const ov = document.createElement("div");
      ov.className = "hug-confirm-overlay pending-note";
      const box = document.createElement("div");
      box.className = "hug-confirm-card";
      box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      const titleId = "hug-note-title-" + (++noteSeq);
      box.setAttribute("aria-labelledby", titleId);
      const title = document.createElement("p");
      title.className = "hug-confirm-title"; title.id = titleId; title.textContent = o.title || "";
      box.appendChild(title);
      if (o.amount) { const a = document.createElement("p"); a.className = "pending-note-amount"; a.textContent = o.amount; box.appendChild(a); }
      (o.lines || []).forEach(t => { const p = document.createElement("p"); p.className = "pending-note-line"; p.textContent = t; box.appendChild(p); });
      const actions = document.createElement("div"); actions.className = "hug-confirm-actions";
      const ok = document.createElement("button"); ok.type = "button"; ok.className = "hug-confirm-ok"; ok.textContent = o.button || "Got it";
      actions.appendChild(ok); box.appendChild(actions);
      ov.appendChild(box);
      let open = true;
      const onKey = e => { if (e.key === "Escape") close(); };
      function close() {
        if (!open) return;
        open = false;
        document.removeEventListener("keydown", onKey);
        ov.classList.remove("show");
        setTimeout(() => ov.remove(), 220);
        if (o.returnFocus) { try { o.returnFocus.focus({ preventScroll: true }); } catch (e) {} }
        if (o.onClose) o.onClose();
      }
      ok.addEventListener("click", close);
      ov.addEventListener("click", e => { if (e.target === ov) close(); });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(ov);
      if (window.hugTickify) window.hugTickify(ov);
      requestAnimationFrame(() => { if (open) ov.classList.add("show"); });
      try { ok.focus({ preventScroll: true }); } catch (e) {}
      return close;
    }
    // On-brand input pop-out (same card as showConfirm, with a text field).
    // Resolves to the trimmed value on Save, or null on Cancel / backdrop tap.
    function showPrompt(opts) {
      const o = opts || {};
      return new Promise(resolve => {
        const ov = document.createElement("div");
        ov.className = "hug-confirm-overlay";
        ov.innerHTML =
          '<div class="hug-confirm-card" role="dialog" aria-modal="true">' +
            '<p class="hug-confirm-title"></p><p class="hug-confirm-body"></p>' +
            '<input class="hug-confirm-input">' +
            '<div class="hug-confirm-actions">' +
              '<button type="button" class="hug-confirm-cancel"></button>' +
              '<button type="button" class="hug-confirm-ok"></button>' +
            '</div></div>';
        ov.querySelector(".hug-confirm-title").textContent = o.title || "";
        const bodyEl = ov.querySelector(".hug-confirm-body");
        bodyEl.textContent = o.body || ""; if (!o.body) bodyEl.style.display = "none";
        const input = ov.querySelector(".hug-confirm-input");
        input.type = o.type || "text";
        input.value = o.value || "";
        if (o.placeholder) input.placeholder = o.placeholder;
        if (o.inputmode) input.setAttribute("inputmode", o.inputmode);
        input.autocapitalize = "off"; input.autocomplete = o.autocomplete || "off"; input.spellcheck = false;
        ov.querySelector(".hug-confirm-cancel").textContent = o.cancel || "Cancel";
        ov.querySelector(".hug-confirm-ok").textContent = o.confirm || "Save";
        const close = val => { ov.classList.remove("show"); setTimeout(() => ov.remove(), 220); resolve(val); };
        ov.querySelector(".hug-confirm-cancel").addEventListener("click", () => close(null));
        ov.querySelector(".hug-confirm-ok").addEventListener("click", () => close(input.value.trim()));
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); close(input.value.trim()); } });
        ov.addEventListener("click", e => { if (e.target === ov) close(null); });
        document.body.appendChild(ov);
        requestAnimationFrame(() => { ov.classList.add("show"); try { input.focus(); } catch (e) {} });
      });
    }
    window.__hugPrompt = showPrompt;
    function updateReferralGate() {
      const active = isDemoMode() || accountStatus === "active";
      const next = !active ? "guest" : (linkedProducts.length > 0 ? "ready" : "locked");
      document.documentElement.dataset.referral = next;
      if (referralGate === "ready" && next === "locked") {
        showToast("Referrals paused — link a product to refer again.");
      }
      referralGate = next;
      if (window.__hugMasterQr) window.__hugMasterQr.render();
    }

    function renderHugAccountState() {
      if (profileEmailValue) {
        const shownEmail = isDemoMode()
          ? DEMO.email
          : (accountStatus === "active" && accountEmail ? accountEmail : "guest");
        profileEmailValue.textContent = shownEmail;
        profileEmailValue.title = shownEmail;
      }
      renderReferralCode();
      renderReferralBalance();
      updateReferralGate();
      // Real leaderboard + "your impact" follow the account state (login/logout).
      if (window.__hugImpact) window.__hugImpact.load();
      if (window.__hugLeaderboard) window.__hugLeaderboard.load();
      if (window.__hugPoints) window.__hugPoints.load();
      if (window.__hugGiving) window.__hugGiving.load();
      if (window.__hugReferralRates) window.__hugReferralRates.render();
      if (window.__hugUsername) window.__hugUsername.load();
      if (window.__hugAccountHistory) window.__hugAccountHistory.loadLive();
      if (window.__hugAccountControls) window.__hugAccountControls.render();
    }

    function setActivationStage(stage) {
      activationStage = stage === "code" ? "code" : "email";
      if (scanAccountSheet) scanAccountSheet.dataset.stage = activationStage;
      if (activationStage === "code") {
        if (scanAccountTitle) scanAccountTitle.textContent = "Enter the code";
        if (scanAccountCopy) {
          scanAccountCopy.textContent = `We emailed a 6-digit code to ${activationEmail}.`;
        }
        if (scanAccountConfirm) scanAccountConfirm.textContent = "Verify code";
      } else {
        if (scanAccountTitle) scanAccountTitle.textContent = "Enter your email";
        if (scanAccountCopy) {
          scanAccountCopy.textContent = "Enter your email to activate referrals and link this product.";
        }
        if (scanAccountConfirm) scanAccountConfirm.textContent = "Confirm email";
      }
    }

    function openAccountActivation() {
      if (!scanAccountSheet || accountStatus !== "guest" || !confirmedHugProduct) return;
      if (scanAccountEmail) scanAccountEmail.value = "";
      if (scanAccountCode) scanAccountCode.value = "";
      if (scanAccountError) scanAccountError.textContent = "";
      activationBusy = false;
      setActivationStage("email");
      scanAccountSheet.setAttribute("aria-hidden", "false");
      scanAccountSheet.classList.add("open");
      updateActivationKeyboardInset();
      requestAnimationFrame(() => {
        scanAccountEmail?.focus();
        updateActivationKeyboardInset();
      });
    }

    function closeAccountActivation() {
      scanAccountSheet?.setAttribute("aria-hidden", "true");
      scanAccountSheet?.classList.remove("open");
      scanAccountSheet?.style.removeProperty("--keyboard-inset");
      if (scanAccountError) scanAccountError.textContent = "";
      if (scanAccountCode) scanAccountCode.value = "";
      activationBusy = false;
      setActivationStage("email");
    }

    function updateActivationKeyboardInset() {
      // resize:"none" means visualViewport does not report the iOS keyboard, so the
      // lift is driven by the native Capacitor Keyboard height captured on show/hide.
      var root = document.documentElement;
      var fit = currentFitScale() || 1;
      var kb = Math.max(0, activationKeyboardHeight || 0);
      root.style.setProperty("--kb", (kb / fit) + "px");
      root.classList.toggle("keyboard-open", kb > 0);
      if (scanAccountSheet) scanAccountSheet.style.removeProperty("--keyboard-inset");
    }

    function resolveHugProductCode(productCode, originalValue) {
      const product = HUG_PRODUCT_CATALOG[productCode];
      if (!product) {
        return {
          isHugCode: false,
          productCode: "",
          productName: "",
          colourName: "",
          originalValue,
          reason: "unknown-product-code"
        };
      }
      return {
        isHugCode: true,
        productCode,
        productName: product.productName,
        colourName: product.colourName,
        originalValue
      };
    }

    function parseHugQrCode(value) {
      const originalValue = String(value || "");
      const trimmedValue = originalValue.trim();
      if (!trimmedValue) {
        return {
          isHugCode: false,
          productCode: "",
          productName: "",
          colourName: "",
          originalValue,
          reason: "empty"
        };
      }

      const normalizeCode = candidate => String(candidate || "").trim().toUpperCase();
      const directCode = normalizeCode(trimmedValue);
      if (HUG_PRODUCT_CODE_RE.test(directCode)) {
        return resolveHugProductCode(directCode, originalValue);
      }

      try {
        const parsedUrl = new URL(trimmedValue);
        const host = parsedUrl.hostname.toLowerCase();
        const parts = parsedUrl.pathname.split("/").filter(Boolean);
        // Server unit QR: HTTPS://THEHUGGABLE.CO/U/<high-entropy token>.
        // Etched codes are UPPERCASE (QR alphanumeric mode keeps a 10mm etch
        // scannable), so the path segment match is case-insensitive. Host-
        // agnostic by design: the token is high-entropy and resolved against
        // Supabase (resolve_qr), which returns not_found for anything bogus —
        // so etched codes keep working even if the domain changes later.
        // We take the leading valid-token run of the path segment so trailing
        // junk a QR may carry (a stray ")." , slash, etc.) is tolerated.
        const unitTokenMatch = (String(parts[0]).toLowerCase() === "u" && parts.length >= 2)
          ? String(parts[1]).match(/^[A-Za-z0-9_-]{20,}/)
          : null;
        if (
          parsedUrl.protocol === "https:" &&
          unitTokenMatch
        ) {
          return {
            isHugCode: false,
            isUnitToken: true,
            unitToken: unitTokenMatch[0],
            productCode: "",
            productName: "",
            colourName: "",
            originalValue,
            reason: "unit-token"
          };
        }
        const urlCode = normalizeCode(parts[1]);
        if (
          parsedUrl.protocol === "https:" &&
          HUG_QR_HOSTS.has(host) &&
          parts.length === 2 &&
          String(parts[0]).toLowerCase() === "q" &&
          HUG_PRODUCT_CODE_RE.test(urlCode)
        ) {
          return resolveHugProductCode(urlCode, originalValue);
        }
      } catch (error) {
        return {
          isHugCode: false,
          productCode: "",
          productName: "",
          colourName: "",
          originalValue,
          reason: "unrecognised-format"
        };
      }

      return {
        isHugCode: false,
        productCode: "",
        productName: "",
        colourName: "",
        originalValue,
        reason: "not-hug-product-qr"
      };
    }

    window.parseHugQrCode = parseHugQrCode;

    function loadLinkedProducts() {
      try {
        const stored = JSON.parse(localStorage.getItem(HUG_LINKED_PRODUCTS_KEY) || "[]");
        if (!Array.isArray(stored)) return [];
        return stored.filter(item =>
          item &&
          typeof item.productCode === "string" &&
          HUG_PRODUCT_CATALOG[item.productCode]
        ).map(item => {
          const catalogProduct = HUG_PRODUCT_CATALOG[item.productCode];
          return {
            productCode: item.productCode,
            productName: catalogProduct.productName,
            colourName: catalogProduct.colourName,
            linkedAt: typeof item.linkedAt === "string" ? item.linkedAt : ""
          };
        });
      } catch (error) {
        console.warn("Unable to load linked products", error);
        return [];
      }
    }

    function saveLinkedProducts() {
      const payload = JSON.stringify(linkedProducts);
      try {
        localStorage.setItem(HUG_LINKED_PRODUCTS_KEY, payload);
      } catch (error) {
        console.warn("Unable to save linked products", error);
      }
      // Mirrored, because losing this is not just a slow number: updateReferralGate keys
      // off linkedProducts.length, so an evicted store shows a signed-in owner the LOCKED
      // referral QR ("link a product to refer again") and a zeroed impact grid until
      // listMyUnits answers. Wrong state reads as broken, not as loading.
      durableSet(HUG_LINKED_PRODUCTS_KEY, payload);
    }

    function isProductLinked(productCode) {
      return linkedProducts.some(product => product.productCode === productCode);
    }

    function renderLinkedProducts() {
      updateReferralGate();
      if (window.__hugImpact) window.__hugImpact.load();   // impact ties to linked-product count
      if (!linkedProductsList || !linkedProductsEmpty) return;
      linkedProductsList.replaceChildren();
      linkedProductsEmpty.hidden = linkedProducts.length > 0;

      linkedProducts.forEach(product => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "simple-row linked-row";
        row.setAttribute("aria-label", `${product.productName}, ${product.colourName}, linked`);
        row.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          openLinkedReferral(product.productCode);
        });

        const left = document.createElement("span");
        left.className = "row-left";
        const qrIcon = document.createElement("img");
        qrIcon.className = "row-icon qr-mini";
        qrIcon.src = "assets/icon-qr.svg";
        qrIcon.alt = "";

        const text = document.createElement("span");
        text.className = "linked-text";
        const name = document.createElement("span");
        name.className = "linked-name";
        name.textContent = product.productName;
        const variant = document.createElement("span");
        variant.className = "linked-variant";
        variant.textContent = product.colourName;
        text.append(name, variant);
        left.append(qrIcon, text);

        const status = document.createElement("span");
        status.className = "linked-status";
        status.textContent = "linked";
        row.append(left, status);
        linkedProductsList.appendChild(row);
      });
    }

    function closeLinkedReferral() {
      selectedLinkedProduct = null;
      linkedReferral?.setAttribute("aria-hidden", "true");
      linkedReferral?.classList.remove("open");
      if (linkedReferralQr) linkedReferralQr.hidden = true;
      if (linkedReferralShowQr) linkedReferralShowQr.textContent = "show referral QR";
      document.querySelector('.screen[data-screen="linked"]')?.classList.remove("referral-open");
    }

    function openLinkedReferral(productCode) {
      const product = linkedProducts.find(item => item.productCode === productCode);
      if (!product || !linkedReferral || accountStatus !== "active") return;
      selectedLinkedProduct = product;
      if (linkedReferralName) linkedReferralName.textContent = product.productName;
      if (linkedReferralColour) linkedReferralColour.textContent = product.colourName;
      if (linkedReferralCode) linkedReferralCode.textContent = product.productCode;
      if (linkedReferralLink) linkedReferralLink.value = buildLocalReferralUrl(product.productCode);
      if (linkedReferralQr) linkedReferralQr.hidden = true;
      if (linkedReferralShowQr) linkedReferralShowQr.textContent = "show referral QR";
      linkedReferralShare?.toggleAttribute("hidden", typeof navigator.share !== "function");
      linkedReferral.setAttribute("aria-hidden", "false");
      linkedReferral.classList.add("open");
      document.querySelector('.screen[data-screen="linked"]')?.classList.add("referral-open");
    }

    function clearHugLinkedProducts() {
      linkedProducts = [];
      try {
        localStorage.removeItem(HUG_LINKED_PRODUCTS_KEY);
      } catch (error) {
        console.warn("Unable to clear linked products", error);
      }
      durableRemove(HUG_LINKED_PRODUCTS_KEY);   // or the next boot restores what this cleared
      renderLinkedProducts();
      closeLinkedReferral();
    }

    window.clearHugLinkedProducts = clearHugLinkedProducts;
    linkedProducts = loadLinkedProducts();
    const hadStoredAccountStatus = hasStoredHugAccountStatus();
    // Nothing stored at all: hold off on claiming £0.00 until the durable mirror has been
    // read (a few ms). Only meaningful when a mirror could exist — a bridge-less web page
    // has nowhere else to look, so guest is already the final answer there.
    bootAccountStateUnknown = !hadStoredAccountStatus;
    accountStatus = loadHugAccountStatus();
    accountEmail = loadHugAccountEmail();
    referralCode = loadReferralCode();
    // Seed the last-known figures BEFORE the first render, so a signed-in launch paints
    // the real balance immediately instead of £0.00 and then popping when the server
    // replies ~a second later. refreshReferralBalanceFromServer() reconciles right after.
    if (accountStatus === "active") {
      const cached = loadCachedBalance();
      if (cached) {
        referralAvailableCents = cached.availableCents;
        referralPendingCents = cached.pendingCents;
        referralCashedOutCents = cached.cashedOutCents;
        referralRewardCount = cached.count;
        balanceKnown = true;
      }
    } else if (hadStoredAccountStatus) {
      // An explicit stored "guest": this device really is signed out, so drop the figures.
      clearCachedBalance();
    }
    // NOTHING stored at all falls through deliberately. "First run" and "localStorage was
    // evicted under a live session" arrive here identically, and they are not the same
    // answer — clearing here would wipe the durable mirror that tells them apart, which is
    // exactly what restoreDurableAccountState() below is about to read.
    if (!hadStoredAccountStatus && linkedProducts.length > 0 && accountEmail) {
      // Local prototype migration: existing linked products imply an activated account.
      setHugAccountState("active", accountEmail);
    } else if (accountStatus === "active" && !accountEmail) {
      // An active local prototype account requires its locally confirmed email.
      setHugAccountState("guest");
    } else {
      document.documentElement.dataset.accountStatus = accountStatus;
      renderHugAccountState();
    }
    renderLinkedProducts();
    // The launch cover used to lift here, on a fixed 300ms timer, whether or not the page was
    // ready. It is now lifted by the checklist at the top of this file (bootGate), once every
    // part of the first screen has drawn its final state. Local state is hydrated at this
    // point, but the durable restore below is not, and nor is anything from the network.

    // Display faces for the gift-card message composer, off the launch path.
    //
    // These used to be a render-blocking <link> in <head>. A stylesheet blocks the first paint
    // AND the execution of every script after it, so the Google Fonts round trip was holding up
    // app.js — which is the thing that removes .hug-boot-pending directly above. The launch was
    // therefore waiting on a third-party request for fonts nobody sees until they open the card
    // composer. Measured against the built bundle, first paint tracked that request 1:1: 200ms
    // when it was instant, 1020ms when it took 800ms.
    //
    // Loaded here instead, once, on idle. Injected rather than declared because CSP's script-src
    // has no 'unsafe-inline', so the usual media="print" onload swap is not available.
    loadCardComposerFonts();
    installImpactIconMotionGate();

    /* Supabase sync: when the backend is enabled, the auth session is the
       authority on guest/active and product_units is the authority on linked
       products. localStorage stays as an offline display cache and as the
       full fallback when the backend is disabled. */
    async function refreshLinkedProductsFromServer(prefetched) {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await (prefetched || backend.listMyUnits());
      if (!res.ok) return;
      // One display row per product type, but keep every owned unit's token so
      // an unlink can release each of them server-side.
      const byCode = new Map();
      res.units.forEach(unit => {
        const code = String(unit.sku || "").toUpperCase();
        if (!code) return;
        const token = unit.qrToken || "";
        if (byCode.has(code)) {
          if (token) byCode.get(code).unitTokens.push(token);
          return;
        }
        const catalogEntry = HUG_PRODUCT_CATALOG[code];
        byCode.set(code, {
          productCode: code,
          productName: catalogEntry?.productName || unit.name || "hugo",
          colourName: catalogEntry?.colourName || unit.variant || "",
          linkedAt: unit.claimedAt || new Date().toISOString(),
          unitTokens: token ? [token] : []
        });
      });
      linkedProducts = Array.from(byCode.values());
      saveLinkedProducts();
      renderLinkedProducts();
    }

    /* BOOT PREFETCH — why the personal figures used to cost TWO round trips.
       syncAccountFromBackend awaited getSession() and only THEN asked for the balance,
       profile and units, so a signed-in user watched an empty (or worse, £0.00) pill for
       session + balance, one after the other. On a phone that is the "couple of seconds"
       before your own numbers appear.
       They do not actually depend on each other: every one of these reads is authorised
       server-side by the very session getSession is reporting on, so firing them together
       is exactly as safe and finishes in the time of the slowest one.
       Started ONLY when local state already says "active" — a device that has never signed
       in must not fire authenticated reads on spec. Nothing is APPLIED until getSession has
       confirmed the session below; if it turns out to be dead the promises are dropped
       unread (and would have answered !ok anyway, since the token is what authorises them). */
    function startBootPrefetch(backend) {
      const guard = (p) => Promise.resolve(p).catch(() => ({ ok: false }));
      return {
        balance: guard(backend.getReferralBalance()),
        profile: guard(backend.getMyProfile()),
        units: guard(backend.listMyUnits()),
      };
    }

    /* Recover the display state that localStorage lost, from the durable mirror.
       Runs ONLY when localStorage held no account status at all — the ambiguous case that
       is either a genuine first run or an eviction under a live session. The mirror is what
       distinguishes them, and it costs a local key read rather than the two network round
       trips (token refresh, then balance) it takes to work the answer out from the server.
       A device that has truly never signed in finds nothing here and stays a guest.
       Returns true when it restored, so the caller knows the prefetch below is now worth
       firing — which is the difference between the figures costing one round trip and two. */
    /* A HOLD MUST BE ABLE TO END BY ITSELF.
       Shipped to device, the money pill came up blank and STAYED blank. The hold below is
       lifted in a finally, which only runs if the await it guards ever settles — and the
       durable read goes through Capacitor Preferences, over the native bridge, from
       DOMContentLoaded. That is earlier than this code used to run (it was window.load),
       and a plugin call made before the bridge is ready can simply never resolve. No
       rejection, no error: the promise hangs, the finally never runs, and the pill is blank
       for the life of the launch.
       That is a worse failure than the false £0.00 the hold exists to prevent — a wrong
       number for 15ms versus no number at all. So the hold now expires on its own, and the
       read itself cannot hang forever either. Belt and braces deliberately: the timeout
       below covers a hung read, and the independent expiry covers anything that stops the
       finally running at all.

       Kept short on purpose. A warm Preferences read is single-digit milliseconds, so these
       are pathological-case ceilings, not budgets. They are the point at which a blank stops
       being "about to be right" and starts being worse than the honest guest £0.00 — the
       common case on a fresh install is that there IS no mirror to find. */
    const DURABLE_READ_TIMEOUT_MS = 800;
    const BOOT_UNKNOWN_MAX_MS = 1000;
    function withTimeout(promise, ms, fallback) {
      return Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]);
    }
    function releaseBootHold() {
      if (!bootAccountStateUnknown) return;
      bootAccountStateUnknown = false;
      renderReferralBalance();
      if (window.__hugPoints) window.__hugPoints.load();
    }
    // Independent of the read: whatever happens to that promise, the hold ends.
    setTimeout(releaseBootHold, BOOT_UNKNOWN_MAX_MS);

    async function restoreDurableAccountState() {
      try {
        return await readDurableAccountState();
      } finally {
        // However it went, the ambiguity is over — either an account was restored, or there
        // was nothing to restore and "guest" is now the confirmed answer rather than a
        // guess. Clear the hold and repaint, so a blank pill resolves to a real £0.00.
        // (The success path clears it before it renders, so this only repaints the rest.)
        releaseBootHold();
      }
    }

    async function readDurableAccountState() {
      // The forced-signed-out dev flag wipes localStorage from a window.load handler, which
      // now fires AFTER this does — without this guard the restore would resurrect the very
      // account that boot is trying to clear, and only the later signOut would undo it.
      if (HUG_ALWAYS_SIGNED_OUT_ON_BOOT) return false;
      if (isDemoMode() || hadStoredAccountStatus || accountStatus === "active") return false;
      const store = window.HugStore;
      if (!store) return false;
      let status, email, rawBalance, rawPoints, rawUnits, rawCode, rawBoard, rawGivingOverview, rawGivingMine, rawImpactPanel;
      try {
        // Each read is individually timed out. A Preferences call issued before the native
        // bridge is ready can hang rather than reject, and one hung key must not strand the
        // other six — nor the hold that this function is responsible for lifting.
        const read = (key) => withTimeout(store.get(key), DURABLE_READ_TIMEOUT_MS, null);
        [status, email, rawBalance, rawPoints, rawUnits, rawCode, rawBoard, rawGivingOverview, rawGivingMine, rawImpactPanel] = await Promise.all([
          read(HUG_ACCOUNT_STATE_KEY),
          read(HUG_ACCOUNT_EMAIL_KEY),
          read(HUG_BALANCE_CACHE_KEY),
          read(HUG_POINTS_CACHE_KEY),
          read(HUG_LINKED_PRODUCTS_KEY),
          read(HUG_REFERRAL_CODE_KEY),
          read(HUG_LEADERBOARD_CACHE_KEY),
          read(HUG_GIVING_OVERVIEW_KEY),
          read(HUG_GIVING_MINE_KEY),
          read(HUG_IMPACT_PANEL_KEY),
        ]);
      } catch (error) { return false; }
      // The board first, and whatever the account turns out to be: it is keyed inside to whoever
      // it was read for (a guest, or a signed-in email), so putting it back is safe either way,
      // and the board's own load() paints it. Parsed before it is written back, like the balance:
      // a corrupt mirror value must not be copied into localStorage, where it would outlive this boot.
      if (rawBoard) {
        try {
          const b = JSON.parse(rawBoard);
          if (b && typeof b === "object" && Array.isArray(b.rows)) localStorage.setItem(HUG_LEADERBOARD_CACHE_KEY, rawBoard);
        } catch (error) { /* not a board */ }
      }
      // The giving facts are public, so they come back whoever this turns out to be; parsed first.
      if (rawGivingOverview) {
        try {
          const o = JSON.parse(rawGivingOverview);
          if (o && typeof o === "object" && Array.isArray(o.causes)) localStorage.setItem(HUG_GIVING_OVERVIEW_KEY, rawGivingOverview);
        } catch (error) { /* not an overview */ }
      }
      const restoredEmail = String(email || "").trim();
      // The panel the home row last settled on, back on the shelf localStorage lost. Only for the
      // account it was written for (a guest's carries no email), parsed before it is written back.
      if (rawImpactPanel) {
        try {
          const ip = JSON.parse(rawImpactPanel);
          const owner = status === "active" ? restoredEmail.toLowerCase() : "";
          if (ip && (ip.panel === "planet" || ip.panel === "people") && String(ip.who || "").toLowerCase() === owner) {
            localStorage.setItem(HUG_IMPACT_PANEL_KEY, rawImpactPanel);
          }
        } catch (error) { /* not a panel */ }
      }
      // Both halves required: an "active" with no confirmed email is the same broken state
      // the local boot path above already refuses to trust.
      if (status !== "active" || !isValidEmail(restoredEmail)) return false;
      // Parse BEFORE writing it back: a corrupt mirror value must not be copied into
      // localStorage, where it would outlive the boot that read it.
      if (rawBalance) {
        let cached = null;
        try {
          const c = JSON.parse(rawBalance);
          if (c && typeof c === "object") {
            const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
            cached = { availableCents: n(c.a), pendingCents: n(c.p), cashedOutCents: n(c.c), count: n(c.n) };
          }
        } catch (error) { cached = null; }
        if (cached) {
          try { localStorage.setItem(HUG_BALANCE_CACHE_KEY, rawBalance); } catch (error) {}
          referralAvailableCents = cached.availableCents;
          referralPendingCents = cached.pendingCents;
          referralCashedOutCents = cached.cashedOutCents;
          referralRewardCount = cached.count;
          balanceKnown = true;   // seed BEFORE the state change, so it paints in one step
        }
      }
      // Linked products decide the referral gate and the impact grid, so they have to be
      // back in place BEFORE setHugAccountState renders — restoring them afterwards would
      // still flash the locked QR. loadLinkedProducts() re-reads and re-validates rather
      // than trusting the mirrored shape.
      if (rawUnits) {
        try { localStorage.setItem(HUG_LINKED_PRODUCTS_KEY, rawUnits); } catch (error) {}
        const restoredUnits = loadLinkedProducts();
        if (restoredUnits.length) linkedProducts = restoredUnits;
        else { try { localStorage.removeItem(HUG_LINKED_PRODUCTS_KEY); } catch (error) {} }
      }
      const restoredCode = String(rawCode || "").trim();
      if (restoredCode) {
        referralCode = restoredCode;
        try { localStorage.setItem(HUG_REFERRAL_CODE_KEY, restoredCode); } catch (error) {}
      }
      // The eco-points hero reads its cache through localStorage, so put the mirrored
      // figure back there before the render below goes looking for it.
      const restoredPoints = Number(rawPoints);
      if (rawPoints != null && rawPoints !== "" && Number.isFinite(restoredPoints) && restoredPoints >= 0) {
        try { localStorage.setItem(HUG_POINTS_CACHE_KEY, String(restoredPoints)); } catch (error) {}
      }
      // This account's split, for the home row and the impact screen. Only ever the account the
      // mirror was written for (it carries its email), and parsed before it is written back.
      if (rawGivingMine) {
        try {
          const m = JSON.parse(rawGivingMine);
          if (m && typeof m === "object" && m.giving && Array.isArray(m.giving.per_cause)
              && String(m.who || "").toLowerCase() === restoredEmail.toLowerCase()) {
            localStorage.setItem(HUG_GIVING_MINE_KEY, rawGivingMine);
          }
        } catch (error) { /* not a split */ }
      }
      // Lift the hold BEFORE the state change, or setHugAccountState's own render would
      // still see the balance as unknown and paint the blank it is about to fill.
      bootAccountStateUnknown = false;
      setHugAccountState("active", restoredEmail);   // rewrites localStorage and re-renders
      renderLinkedProducts();   // renderHugAccountState does not cover the products list
      return true;
    }

    async function syncAccountFromBackend() {
      if (isDemoMode()) return;   // demo mode is self-contained display; never sync the backend over it
      const backend = window.HugBackend;
      if (!backend?.enabled) return;
      await hugLoginReset;        // wait out the one-time forced sign-out, or it races and re-signs-in
      const prefetch = accountStatus === "active" ? startBootPrefetch(backend) : null;
      const res = await backend.getSession();
      if (!res.ok) return;                      // offline: keep local fallback state
      if (res.session) {
        setHugAccountState("active", res.session.email);
        refreshLinkedProductsFromServer(prefetch?.units);
        if (window.__hugPurchases) window.__hugPurchases.refresh();
        refreshReferralCodeFromServer(prefetch?.profile);
        refreshReferralBalanceFromServer(prefetch?.balance);
      } else if (accountStatus === "active") {
        // Stale local "active" with no session behind it: claiming would fail
        // as unauthenticated, so drop back to guest until the user verifies.
        setHugAccountState("guest");
      }
    }
    // Recover from the durable mirror first (a local read), so that by the time the server
    // is consulted the app already knows whose account this is — which both paints the real
    // figures immediately and lets syncAccountFromBackend prefetch instead of serialising.
    async function bootAccountSync() {
      try { await restoreDurableAccountState(); } catch (error) {}
      // Whose account this is is now as settled as local knowledge can make it. The other
      // parts of the first screen tick themselves off as they draw (see bootGate).
      if (window.__hugBoot) window.__hugBoot.release("boot-account");
      await syncAccountFromBackend();
      refreshPrototypeAccess();
    }

    /* Ask the server whether THIS signed-in person may see the Prototype mode switch, and keep
       the answer. Runs in both modes: in prototype it is the only thing that can notice the
       permission was taken away (or the session ended) and drop back to the real account.
       Offline or failed: keep what we knew — prototype is display-only, so a stale "yes" for
       one launch shows sample data, never touches real data. A definite "no", or "nobody is
       signed in", ends it. */
    let prototypeAccessInFlight = null;
    function refreshPrototypeAccess() {
      if (prototypeAccessInFlight) return prototypeAccessInFlight;
      const backend = window.HugBackend;
      if (!backend?.enabled || !backend.getAppAccess) return Promise.resolve();
      prototypeAccessInFlight = Promise.resolve(backend.getAppAccess()).then((res) => {
        if (!res || !res.ok) return;
        if (!res.signedIn) clearPrototypeAccess();
        else savePrototypeAccess(res.email, res.prototype);
        const stillAllowed = res.signedIn && res.prototype && normEmail(res.email) === PROTOTYPE_EMAIL;
        if (PROTOTYPE_ON && !stillAllowed) {
          setPrototypeMode(false);
          location.reload();
          return;
        }
        if (window.__hugPrototypeSwitch) window.__hugPrototypeSwitch.render();
      }).catch(() => {}).then(() => { prototypeAccessInFlight = null; });
      return prototypeAccessInFlight;
    }
    window.__hugRefreshPrototypeAccess = refreshPrototypeAccess;
    /* WAIT FOR THE BRIDGE, DO NOT INFER IT FROM readyState.
       This previously keyed off `document.readyState === "loading"` to decide whether
       DOMContentLoaded was still coming. That is wrong for a DEFERRED script, and index.html
       loads app.js and native-bridge.js with `defer`: a deferred script executes while
       readyState is already "interactive", with DOMContentLoaded still ahead of it. So the
       check failed, the else branch ran bootAccountSync() immediately — before
       native-bridge.js had executed — and with neither HugBackend nor HugStore defined the
       entire account sync silently no-opped. On device that is a blank money pill, no
       restore, and no session: every symptom, from one wrong readiness test.
       Wait for the thing actually needed instead of predicting when it appears. Deferred
       scripts run in order before DOMContentLoaded, so DCL is the earliest point at which
       native-bridge.js is guaranteed to have run; load and a timeout are backstops so a
       bridge that never arrives degrades to local-only rather than hanging boot. */
    function whenBridgeReady() {
      return new Promise((resolve) => {
        if (window.HugBackend) return resolve();
        let settled = false;
        const finish = () => { if (settled) return; settled = true; resolve(); };
        if (document.readyState !== "complete") {
          document.addEventListener("DOMContentLoaded", finish, { once: true });
          window.addEventListener("load", finish, { once: true });
        }
        setTimeout(finish, 3000);
      });
    }
    whenBridgeReady().then(bootAccountSync);

    function shortQrValue(value) {
      const normalized = String(value || "").trim();
      if (normalized.length <= 54) return normalized;
      return `${normalized.slice(0, 35)}...${normalized.slice(-16)}`;
    }

    function clearCandidateQrCode() {
      const candidate = scanScreen?.querySelector(".scan-candidate");
      if (!candidate) return;
      candidate.classList.remove("is-positioned");
      candidate.style.removeProperty("--candidate-left");
      candidate.style.removeProperty("--candidate-top");
      const value = candidate.querySelector(".scan-candidate-value");
      if (value) value.textContent = "";
    }

    function clearScanResult() {
      closeAccountActivation();
      confirmedHugProductCode = "";
      confirmedHugProduct = null;
      confirmedUnitToken = "";
      scanResult?.setAttribute("aria-hidden", "true");
      scanResult?.classList.remove(
        "is-hug-product",
        "is-guest-product",
        "is-invalid-code",
        "is-linked-product",
        "is-already-linked"
      );
      if (scanResultKicker) scanResultKicker.textContent = "";
      if (scanResultTitle) scanResultTitle.textContent = "";
      if (scanResultMessage) scanResultMessage.textContent = "";
      if (scanResultCode) scanResultCode.textContent = "";
    }

    function setScanState(state, message) {
      if (!scanScreen) return;
      scanScreen.dataset.scanState = state;
      if (scanStatus && message) scanStatus.textContent = message;
    }

    // Best-effort tactile feedback so a scan/result "feels" registered. Uses the
    // native Haptics plugin if present (added to the shell); silent no-op otherwise.
    function scanHaptic(kind) {
      try {
        const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
        if (!H) return;
        if (kind === "success" && H.notification) { H.notification({ type: "SUCCESS" }); return; }
        if (kind === "error" && H.notification) { H.notification({ type: "ERROR" }); return; }
        if (H.impact) H.impact({ style: "LIGHT" });
      } catch (e) {}
    }

    // We are genuinely ON the scanner only if EVERY signal agrees: the scan screen
    // is active, the current screen is scan, AND scan is the SOLE active screen.
    // Any disagreement (a stale .active, a stuck dataset.current, two active
    // screens) means we're not scanning — so the transparent WebView must come off
    // (otherwise the whole app goes grey and only the opaque QR stays white).
    function isOnScanScreen() {
      if (!(scanScreen && scanScreen.classList.contains("active"))) return false;
      if ((phone.dataset.current || "home") !== "scan") return false;
      const active = document.querySelectorAll(".screen.active");
      return active.length === 1 && active[0] === scanScreen;
    }
    window.__hugOnScan = isOnScanScreen;
    function setScanCameraVisible(visible) {
      if (visible && !isOnScanScreen()) visible = false;
      document.documentElement.classList.toggle("scan-camera-active", visible);
    }

    /* Scanner lifecycle hardening.
       - cameraSessionAlive is the truth about the NATIVE camera session; the
         scan-camera-active class only governs visuals. iOS kills the session
         when the app backgrounds, so the class alone must never be trusted.
       - queueScanOp serializes every native start/stop. Without it, a stale
         stop from a nav-away can land AFTER a fresh start and silently kill
         the new session (the main "camera doesn't turn on" race). The chain
         self-releases after 10s so a hung native call can't deadlock it. */
    let cameraSessionAlive = false;
    let scanOpChain = Promise.resolve();
    function queueScanOp(op) {
      const link = scanOpChain.then(op, op);
      scanOpChain = Promise.race([
        link.then(function () {}, function () {}),
        new Promise(function (resolve) { setTimeout(resolve, 10000); })
      ]);
      return link;
    }

    // defer: a page switch off the camera (showScreen, quickFadeTo). The native stop then waits
    // until the bars' icons have eased (chromeEaseFrom, 450 ms). The mlkit plugin's stopScan
    // drops its camera view on the main thread, and that view's deinit calls
    // AVCaptureSession.stopRunning() there, synchronously: the screen froze for a moment in the
    // middle of the ease, so the icons arrived at their end values in one jump (owner,
    // 2026-10-17, camera -> home and camera -> QR: "the typical on/off mode"). Meanwhile the white
    // stop-cover (scan-stopping) keeps the still-running camera out of sight, and a code it
    // reads is ignored (cameraSessionAlive is already false: the hug:qr-scanned listener).
    var CAMERA_STOP_DEFER_MS = 520;
    var scanStopCoverToken = 0;
    async function stopProductQrScan({ state = "cancelled", message = "Scan cancelled", defer = false } = {}) {
      const hadLiveCamera = cameraSessionAlive ||
        document.documentElement.classList.contains("scan-camera-active");
      scanRequestId += 1;
      cameraSessionAlive = false;
      closeAccountActivation();
      setScanCameraVisible(false);
      const deferred = defer && hadLiveCamera;
      // Only flash the white stop-cover when a camera was actually live;
      // redundant stops (double nav calls, browser) shouldn't blink the UI.
      const coverToken = ++scanStopCoverToken;
      const dropCover = function () {
        if (coverToken === scanStopCoverToken) document.documentElement.classList.remove("scan-stopping");
      };
      if (hadLiveCamera) {
        document.documentElement.classList.add("scan-stopping");
        if (!deferred) setTimeout(dropCover, 360);
      }
      try {
        await queueScanOp(function () {
          if (!deferred) return window.HugNative?.stopQrScan?.();
          return new Promise(function (resolve) { setTimeout(resolve, CAMERA_STOP_DEFER_MS); })
            .then(function () { return window.HugNative?.stopQrScan?.(); });
        });
      } catch (error) {
        console.error("Unable to stop QR scanner", error);
      }
      // Deferred: the cover goes a moment after the camera has really stopped.
      if (deferred) setTimeout(dropCover, 80);
      if (state && scanScreen?.classList.contains("active")) {
        setScanState(state, message);
      }
    }

    async function startProductQrScan(attempt) {
      if (!scanScreen) return;
      attempt = attempt || 0;
      // Always perform a real camera (re)start on entry (no JS-only "soft resume"
      // over a possibly-dead session). A hung or thrown native start now AUTO-
      // RETRIES a couple of times before surfacing a tappable "failed" — this is
      // the fix for "open the app, go to camera, it doesn't turn on".
      const requestId = ++scanRequestId;
      clearCandidateQrCode();
      cameraSessionAlive = false;
      clearScanResult();
      confirmedScannedCode = "";
      confirmedHugProductCode = "";
      confirmedHugProduct = null;
      setScanCameraVisible(false);
      setScanState("ready", "Starting camera...");

      if (!window.HugNative?.startQrScan) {
        setScanState("unavailable", "QR scanning works on device.");
        return;
      }

      // Watchdog: if the start hasn't reached "scanning" quickly, auto-retry while
      // we remain on the scan screen, then fall back to the tappable failed state.
      // Kept short (2s) so a flaky first start self-heals on the FIRST entry
      // instead of needing the user to leave and come back.
      const RETRY_LIMIT = 2;
      setTimeout(function () {
        if (requestId !== scanRequestId) return;
        if (scanScreen.dataset.scanState !== "ready") return;
        if (!scanScreen.classList.contains("active")) return;
        if (attempt < RETRY_LIMIT) { startProductQrScan(attempt + 1); return; }
        setScanCameraVisible(false);
        setScanState("failed", "Unable to start the scanner. Tap to retry.");
      }, 2000);

      try {
        const result = await queueScanOp(function () { return window.HugNative.startQrScan(); });
        if (requestId !== scanRequestId) {
          // A newer start/stop owns the camera now; its queued ops clean up.
          return;
        }
        if (!scanScreen.classList.contains("active")) {
          queueScanOp(function () { return window.HugNative.stopQrScan?.(); });
          return;
        }

        if (result?.ok && result.status === "scanning") {
          cameraSessionAlive = true;
          setScanCameraVisible(true);
          setScanState("scanning", "Point the camera at a product QR code");
          // Re-assert visibility across the screen slide-in: if startScan resolved
          // mid-transition (two screens briefly .active), isOnScanScreen() was false
          // so the first call was gated off and the camera ran invisibly. Re-apply
          // once the scan screen settles as the sole active screen.
          [180, 420, 720].forEach(function (ms) {
            setTimeout(function () { if (requestId === scanRequestId && cameraSessionAlive) setScanCameraVisible(true); }, ms);
          });
          return;
        }

        if (result?.status === "denied") {
          setScanState("denied", "Camera permission is required to scan QR codes.");
          return;
        }

        // Unavailable/unexpected: retry once or twice (transient), else give up.
        if (attempt < RETRY_LIMIT && scanScreen.classList.contains("active")) {
          startProductQrScan(attempt + 1);
          return;
        }
        setScanState("unavailable", "QR scanning works on device.");
      } catch (error) {
        console.error("Unable to start QR scanner", error);
        if (requestId !== scanRequestId) return;
        cameraSessionAlive = false;
        setScanCameraVisible(false);
        // Transient native error -> retry shortly before surfacing failure.
        if (attempt < RETRY_LIMIT && scanScreen.classList.contains("active")) {
          setTimeout(function () {
            if (requestId === scanRequestId && scanScreen.classList.contains("active") &&
                scanScreen.dataset.scanState !== "scanning") {
              startProductQrScan(attempt + 1);
            }
          }, 600);
          return;
        }
        setScanState("failed", "Unable to start the scanner. Tap to retry.");
      }
    }

    /* Background/foreground recovery: iOS suspends the camera when the app is
       hidden. Mark the session dead immediately (so any later start is a full
       restart, never a soft resume over a dead camera) and swap the see-through
       window for the neutral cover so returning never shows a black hole. On
       return, restart automatically when the user is mid-scan; result popups
       (product-found/linked/etc.) are preserved and restart on their buttons. */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        if (!cameraSessionAlive &&
            !document.documentElement.classList.contains("scan-camera-active")) return;
        cameraSessionAlive = false;
        setScanCameraVisible(false);
        return;
      }
      if (!scanScreen?.classList.contains("active")) return;
      const st = scanScreen.dataset.scanState;
      if (st === "scanning" || st === "processing" || st === "ready" || st === "failed") {
        startProductQrScan();
      }
    });

    /* Tap-to-retry on the status pill (which shows the "Tap to retry" message)
       for terminal states. The pill is excluded from tapToHomeFromScan, so the
       retry tap doesn't trigger the tap-anywhere-to-exit gesture; taps on the
       rest of the camera window keep their existing exit-to-home behaviour. */
    scanStatus?.addEventListener("click", function (event) {
      const st = scanScreen?.dataset.scanState;
      if (st !== "failed" && st !== "unavailable" && st !== "denied") return;
      event.preventDefault();
      event.stopPropagation();
      startProductQrScan();
    });

    async function handleScannedProductCode(code) {
      const scannedCode = String(code || "").trim();
      if (!scannedCode) return;

      // QR scan-to-login (web account): "hug-login:<token>" — confirm, then approve.
      // Handled before the unit-QR logic; never falls through.
      if (scannedCode.toLowerCase().startsWith("hug-login:")) {
        const token = scannedCode.slice("hug-login:".length);
        try { await window.HugNative?.stopQrScan?.(); } catch (e) {}
        if (accountStatus !== "active") {
          showToast("Sign in to the app first, then scan to log in on web.");
          return;
        }
        const ok = await showConfirm({
          title: "Log in to account?",
          body: "Sign in to your hug account in a web browser.",
          confirm: "Log in",
          cancel: "Cancel"
        });
        if (!ok) return;
        const res = await window.HugBackend?.approveQrLogin(token);
        showToast(res && res.ok
          ? "Logged in on web ✓"
          : "That code expired — refresh the web page and scan again.");
        return;
      }

      confirmedScannedCode = scannedCode;
      const handlingRequestId = scanRequestId;
      const parsedCode = parseHugQrCode(scannedCode);
      await new Promise(function (resolve) { setTimeout(resolve, 320); });
      if (handlingRequestId !== scanRequestId) return;

      // Server unit QR (https://www.thehuggable.co/u/<token>): resolve against Supabase.
      if (parsedCode.isUnitToken && window.HugBackend?.enabled) {
        const resolved = await window.HugBackend.resolveQr(parsedCode.unitToken);
        if (handlingRequestId !== scanRequestId) return;
        clearScanResult();
        scanResult?.setAttribute("aria-hidden", "false");
        if (!resolved.ok) {
          scanResult?.classList.add("is-invalid-code");
          if (scanResultKicker) scanResultKicker.textContent = "Connection problem";
          if (scanResultTitle) scanResultTitle.textContent = "Couldn't check this code";
          if (scanResultMessage) scanResultMessage.textContent = "Check your connection and scan again.";
          setScanState("not-hug-code", "Couldn't check this code");
          return;
        }
        if (resolved.status === "not_found") {
          scanResult?.classList.add("is-invalid-code");
          if (scanResultKicker) scanResultKicker.textContent = "Not a Hug product QR";
          if (scanResultTitle) scanResultTitle.textContent = "Not a Hug product QR";
          if (scanResultMessage) scanResultMessage.textContent = "This code does not match a Hug product.";
          setScanState("not-hug-code", "Not a Hug product QR");
          return;
        }
        const sku = String(resolved.sku || "").toUpperCase();
        const catalogEntry = HUG_PRODUCT_CATALOG[sku];
        confirmedHugProductCode = sku;
        confirmedUnitToken = parsedCode.unitToken;
        confirmedHugProduct = {
          isHugCode: true,
          productCode: sku,
          productName: catalogEntry?.productName || resolved.name || "hugo",
          colourName: catalogEntry?.colourName || resolved.variant || "",
          originalValue: scannedCode
        };
        if (resolved.status === "claimed_by_me") {
          scanResult?.classList.add("is-already-linked");
          if (scanResultKicker) scanResultKicker.textContent = "Already linked";
          if (scanResultTitle) scanResultTitle.textContent = "Already linked";
          if (scanResultMessage) {
            scanResultMessage.textContent = "This product is already attached to your account.";
          }
          setScanState("already-linked", "Already linked");
          return;
        }
        if (resolved.status === "claimed_by_other") {
          scanResult?.classList.add("is-already-linked");
          if (scanResultKicker) scanResultKicker.textContent = "Already claimed";
          if (scanResultTitle) scanResultTitle.textContent = "Already claimed";
          if (scanResultMessage) {
            scanResultMessage.textContent = "This product is already linked to another account.";
          }
          setScanState("claimed-by-other", "Already claimed");
          return;
        }
        // unclaimed
        scanResult?.classList.add(accountStatus === "active" ? "is-hug-product" : "is-guest-product");
        if (scanResultKicker) scanResultKicker.textContent = "Product found";
        if (scanResultTitle) scanResultTitle.textContent = "Product found";
        if (scanResultMessage) {
          scanResultMessage.textContent = `${confirmedHugProduct.productName} · ${confirmedHugProduct.colourName}`;
        }
        scanHaptic("success");
        setScanState(accountStatus === "active" ? "product-found" : "product-found-guest", "Product found");
        return;
      }

      clearScanResult();
      scanResult?.setAttribute("aria-hidden", "false");
      if (parsedCode.isHugCode) {
        if (IS_PRODUCTION_BUILD) {
          // Phase 1B: a raw product code (not a /u/<token> QR) never grants
          // ownership in production. Real mugs carry a high-entropy unit token
          // resolved + claimed atomically server-side; guide the user there.
          confirmedHugProductCode = "";
          confirmedHugProduct = null;
          scanResult?.classList.add("is-invalid-code");
          if (scanResultKicker) scanResultKicker.textContent = "Scan your mug's code";
          if (scanResultTitle) scanResultTitle.textContent = "Scan your mug's QR";
          if (scanResultMessage) scanResultMessage.textContent = "Point the camera at the QR printed on your Hug mug to link it.";
          if (scanResultCode) scanResultCode.textContent = "";
          setScanState("not-hug-code", "Scan your mug's QR");
          console.log("Rejected non-token product code in production build");
          return;
        }
        confirmedHugProductCode = parsedCode.productCode;
        confirmedHugProduct = parsedCode;
        if (isProductLinked(parsedCode.productCode)) {
          scanResult?.classList.add("is-already-linked");
          if (scanResultKicker) scanResultKicker.textContent = "Already linked";
          if (scanResultTitle) scanResultTitle.textContent = "Already linked";
          if (scanResultMessage) {
            scanResultMessage.textContent = "This product is already attached to your account.";
          }
          if (scanResultCode) scanResultCode.textContent = "";
          setScanState("already-linked", "Already linked");
        } else {
          scanResult?.classList.add(accountStatus === "active" ? "is-hug-product" : "is-guest-product");
          if (scanResultKicker) scanResultKicker.textContent = "Product found";
          if (scanResultTitle) scanResultTitle.textContent = "Product found";
          if (scanResultMessage) scanResultMessage.textContent = `${parsedCode.productName} · ${parsedCode.colourName}`;
          if (scanResultCode) scanResultCode.textContent = "";
          setScanState(accountStatus === "active" ? "product-found" : "product-found-guest", "Product found");
        }
      } else {
        scanResult?.classList.add("is-invalid-code");
        if (scanResultKicker) scanResultKicker.textContent = "Not a Hug product QR";
        if (scanResultTitle) scanResultTitle.textContent = "Not a Hug product QR";
        if (scanResultMessage) scanResultMessage.textContent = "This code does not look like a Hug product code.";
        if (scanResultCode) scanResultCode.textContent = shortQrValue(parsedCode.originalValue);
        setScanState("not-hug-code", "Not a Hug product QR");
      }
      console.log("Scanned product QR code:", confirmedScannedCode);
    }

    window.handleScannedProductCode = handleScannedProductCode;

    window.addEventListener("hug:qr-scanned", event => {
      // Off the scan page (or its camera already stopping), a code read is not ours to handle.
      if (!cameraSessionAlive || !scanScreen?.classList.contains("active")) return;
      const scanState = scanScreen?.dataset.scanState;
      if (scanState !== "scanning") return;
      const code = String(event.detail?.rawValue || event.detail?.displayValue || event.detail?.code || "").trim();
      if (!code) return;
      scanHaptic("light");   // tactile "scan registered" the instant a code is read
      setScanState("processing", "Checking product QR...");
      handleScannedProductCode(code);
    });

    function containScanControlEvent(event) {
      event.preventDefault();
      event.stopPropagation();
    }

    scanRestart?.addEventListener("click", event => {
      containScanControlEvent(event);
      startProductQrScan();
    });

    scanResultAgain?.addEventListener("click", event => {
      containScanControlEvent(event);
      startProductQrScan();
    });

    let justActivatedAccount = false;
    async function completeConfirmedProductLink() {
      const activatedNow = justActivatedAccount;
      justActivatedAccount = false;
      if (!confirmedHugProductCode || !confirmedHugProduct) return;

      // Server unit: claim atomically via Supabase. "claimed" falls through to
      // the shared linked-confirmation below; every other status maps to its
      // own popup. The local path (demo codes / backend disabled) is unchanged.
      if (window.HugBackend?.enabled && confirmedUnitToken) {
        const claim = await window.HugBackend.claimUnit(confirmedUnitToken);
        if (claim.status === "unauthenticated") {
          justActivatedAccount = activatedNow;     // keep the activation context
          openAccountActivation();
          return;
        }
        if (claim.status === "already_claimed_by_me") {
          clearScanResult();
          scanResult?.setAttribute("aria-hidden", "false");
          scanResult?.classList.add("is-already-linked");
          if (scanResultKicker) scanResultKicker.textContent = "Already linked";
          if (scanResultTitle) scanResultTitle.textContent = "Already linked";
          if (scanResultMessage) {
            scanResultMessage.textContent = "This product is already attached to your account.";
          }
          setScanState("already-linked", "Already linked");
          setScanCameraVisible(cameraSessionAlive);
          return;
        }
        if (claim.status === "already_claimed_by_other") {
          clearScanResult();
          scanResult?.setAttribute("aria-hidden", "false");
          scanResult?.classList.add("is-already-linked");
          if (scanResultKicker) scanResultKicker.textContent = "Already claimed";
          if (scanResultTitle) scanResultTitle.textContent = "Already claimed";
          if (scanResultMessage) {
            scanResultMessage.textContent = "This product is already linked to another account.";
          }
          setScanState("claimed-by-other", "Already claimed");
          setScanCameraVisible(cameraSessionAlive);
          return;
        }
        if (claim.status !== "claimed") {
          clearScanResult();
          scanResult?.setAttribute("aria-hidden", "false");
          scanResult?.classList.add("is-invalid-code");
          if (scanResultKicker) scanResultKicker.textContent = "Couldn't link product";
          if (scanResultTitle) scanResultTitle.textContent = "Couldn't link product";
          if (scanResultMessage) {
            scanResultMessage.textContent = "Check your connection and scan again.";
          }
          setScanState("not-hug-code", "Couldn't link product");
          return;
        }
        // claimed: reconcile the display list from the server in the background.
        refreshLinkedProductsFromServer();
      } else if (IS_PRODUCTION_BUILD) {
        // Phase 1B: in production, ownership can ONLY come from a successful
        // atomic claim_unit on a /u/<token> QR (handled above). A raw/generic/
        // test product code — or a disabled backend — must NEVER locally link a
        // product, which would unlock referral rewards without a verified,
        // server-confirmed purchase. Fail closed.
        clearScanResult();
        scanResult?.setAttribute("aria-hidden", "false");
        scanResult?.classList.add("is-invalid-code");
        if (scanResultKicker) scanResultKicker.textContent = "Scan your mug's code";
        if (scanResultTitle) scanResultTitle.textContent = "Couldn't link product";
        if (scanResultMessage) scanResultMessage.textContent = "Scan the QR printed on your Hug mug to link it.";
        setScanState("not-hug-code", "Couldn't link product");
        return;
      } else if (isProductLinked(confirmedHugProductCode)) {
        handleScannedProductCode(confirmedHugProductCode);
        return;
      }
      const product = {
        productCode: confirmedHugProduct.productCode,
        productName: confirmedHugProduct.productName,
        colourName: confirmedHugProduct.colourName,
        linkedAt: new Date().toISOString()
      };
      if (!isProductLinked(product.productCode)) {
        linkedProducts.push(product);
        saveLinkedProducts();
        renderLinkedProducts();
      }
      clearScanResult();
      confirmedHugProductCode = product.productCode;
      confirmedHugProduct = product;
      scanResult?.setAttribute("aria-hidden", "false");
      scanResult?.classList.add("is-linked-product");
      if (scanResultKicker) scanResultKicker.textContent = "Product linked";
      if (scanResultTitle) {
        // When the email was just submitted (first activation), the confirmation
        // also reports the account/referrals were activated, above the link line.
        scanResultTitle.innerHTML = activatedNow
          ? 'Account/Referrals Activated<br><span class="scan-result-plus">+</span><br>Product Linked'
          : "Product linked";
      }
      if (scanResultMessage) {
        scanResultMessage.textContent = "This product is now attached to your account.";
      }
      // No code chip and no auto-resume: the linked confirmation stays put until
      // the user taps Done, which resumes scanning (see scanDone handler). The
      // camera stays live behind the popup so the same QR re-reads as "Already
      // linked" once scanning resumes.
      setScanState("product-linked", "Product linked");
      // Keep the live camera visible behind the popup, but never go transparent
      // over a dead session (e.g. the app was backgrounded mid-activation).
      setScanCameraVisible(cameraSessionAlive);
      console.log("Local product claim placeholder:", product.productCode);
    }

    scanActivateAccount?.addEventListener("click", event => {
      containScanControlEvent(event);
      if (accountStatus !== "guest" || !confirmedHugProduct) return;
      openAccountActivation();
    });

    function setActivationError(message) {
      if (scanAccountError) scanAccountError.textContent = message || "";
    }

    scanAccountForm?.addEventListener("submit", async event => {
      containScanControlEvent(event);
      if (accountStatus !== "guest" || !confirmedHugProduct) return;
      if (activationBusy) return;
      const backend = window.HugBackend;

      if (activationStage === "email") {
        const email = String(scanAccountEmail?.value || "").trim();
        if (!isValidEmail(email)) {
          setActivationError("Enter a valid email address.");
          scanAccountEmail?.focus();
          return;
        }
        if (!backend?.enabled) {
          // Backend disabled: local prototype fallback (no real verification).
          setHugAccountState("active", email);
          closeAccountActivation();
          justActivatedAccount = true;
          completeConfirmedProductLink();
          return;
        }
        activationBusy = true;
        setActivationError("");
        if (scanAccountConfirm) scanAccountConfirm.textContent = "Sending...";
        const sent = await backend.signInWithOtp(email);
        activationBusy = false;
        if (!sent.ok) {
          if (scanAccountConfirm) scanAccountConfirm.textContent = "Confirm email";
          setActivationError("Couldn't send the code. Check your connection and try again.");
          return;
        }
        activationEmail = email;
        setActivationStage("code");
        requestAnimationFrame(() => {
          scanAccountCode?.focus();
          updateActivationKeyboardInset();
        });
        return;
      }

      // Code stage: verify the 6-digit OTP, then claim.
      const code = String(scanAccountCode?.value || "").trim();
      if (!/^\d{6,10}$/.test(code)) {   // Supabase email OTP length is configurable (6-10)
        setActivationError("Enter the code from the email.");
        scanAccountCode?.focus();
        return;
      }
      activationBusy = true;
      setActivationError("");
      if (scanAccountConfirm) scanAccountConfirm.textContent = "Verifying...";
      const verified = await backend.verifyOtp(activationEmail, code);
      activationBusy = false;
      if (!verified.ok) {
        if (scanAccountConfirm) scanAccountConfirm.textContent = "Verify code";
        setActivationError(verified.status === "invalid-code"
          ? "That code didn't match. Try again."
          : "Couldn't verify the code. Try again.");
        scanAccountCode?.focus();
        scanAccountCode?.select?.();
        return;
      }
      setHugAccountState("active", verified.email || activationEmail);
      refreshReferralCodeFromServer();
      refreshReferralBalanceFromServer();
      closeAccountActivation();
      justActivatedAccount = true;
      completeConfirmedProductLink();
    });

    ["click", "pointerdown", "touchstart"].forEach(eventName => {
      scanAccountForm?.addEventListener(eventName, event => {
        event.stopPropagation();
      });
    });

    window.visualViewport?.addEventListener("resize", updateActivationKeyboardInset, { passive: true });
    window.visualViewport?.addEventListener("scroll", updateActivationKeyboardInset, { passive: true });
    window.addEventListener("resize", updateActivationKeyboardInset, { passive: true });

    function registerActivationKeyboardListeners() {
      const keyboardPlugin = window.Capacitor?.Plugins?.Keyboard;
      if (!keyboardPlugin?.addListener || registerActivationKeyboardListeners.registered) return false;
      registerActivationKeyboardListeners.registered = true;
      keyboardPlugin.addListener("keyboardWillShow", info => {
        activationKeyboardHeight = Math.max(0, Number(info?.keyboardHeight) || 0);
        requestAnimationFrame(updateActivationKeyboardInset);
      });
      keyboardPlugin.addListener("keyboardWillHide", () => {
        activationKeyboardHeight = 0;
        requestAnimationFrame(updateActivationKeyboardInset);
      });
      return true;
    }

    if (!registerActivationKeyboardListeners()) {
      window.addEventListener("load", registerActivationKeyboardListeners, { once: true });
    }

    [scanAccountClose, scanAccountCancel].forEach(control => {
      control?.addEventListener("click", event => {
        containScanControlEvent(event);
        closeAccountActivation();
      });
    });

    scanClaimProduct?.addEventListener("click", event => {
      containScanControlEvent(event);
      if (accountStatus !== "active") return;
      completeConfirmedProductLink();
    });

    scanDone?.addEventListener("click", event => {
      containScanControlEvent(event);
      startProductQrScan();
    });

    scanCancel?.addEventListener("click", event => {
      containScanControlEvent(event);
      startProductQrScan();
    });

    linkedProductsAdd?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      onNavAction("scan", { trigger: "tap" });
    });

    ["pointerdown", "touchstart"].forEach(eventName => {
      linkedProductsAdd?.addEventListener(eventName, event => {
        event.stopPropagation();
      });
    });

    // TODO: Production product QRs should use https://www.thehuggable.co/q/HUG-DR-001.
    // The app should handle universal links; the web/backend route should support native-camera
    // scans, App Store guidance, and authoritative valid/unclaimed/claimed/disabled decisions.

    linkedReferralClose?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      closeLinkedReferral();
    });

    const linkedReferralActions = linkedReferral?.querySelector(".linked-referral-actions");
    const linkedReferralUnlink = document.createElement("button");
    linkedReferralUnlink.type = "button";
    linkedReferralUnlink.className = "linked-referral-unlink";
    linkedReferralUnlink.textContent = "unlink product";
    if (linkedReferralActions) linkedReferralActions.appendChild(linkedReferralUnlink);
    let unlinkConfirm = null;
    let unlinkConfirmName = null;

    function ensureUnlinkConfirm() {
      if (unlinkConfirm) return;
      const host = document.querySelector(".phone") || document.body;
      unlinkConfirm = document.createElement("div");
      unlinkConfirm.className = "unlink-confirm";
      unlinkConfirm.setAttribute("aria-hidden", "true");
      unlinkConfirm.innerHTML =
        '<div class="unlink-confirm-card" role="dialog" aria-modal="true" aria-labelledby="unlink-confirm-title">' +
          '<p class="unlink-confirm-title" id="unlink-confirm-title">Unlink this product?</p>' +
          '<p class="unlink-confirm-copy">This removes <span class="unlink-confirm-name"></span> from your linked products. You can re-link it any time by scanning again.</p>' +
          '<div class="unlink-confirm-actions">' +
            '<button type="button" class="unlink-confirm-cancel">keep linked</button>' +
            '<button type="button" class="unlink-confirm-unlink">unlink</button>' +
          '</div>' +
        '</div>';
      host.appendChild(unlinkConfirm);
      unlinkConfirmName = unlinkConfirm.querySelector(".unlink-confirm-name");
      unlinkConfirm.querySelector(".unlink-confirm-cancel").addEventListener("click", evt => {
        evt.preventDefault();
        evt.stopPropagation();
        closeUnlinkConfirm();
      });
      unlinkConfirm.querySelector(".unlink-confirm-unlink").addEventListener("click", async evt => {
        evt.preventDefault();
        evt.stopPropagation();
        // Capture before closing the referral sheet nulls selectedLinkedProduct.
        const product = selectedLinkedProduct;
        closeUnlinkConfirm();
        closeLinkedReferral();
        if (!product) return;

        const backend = window.HugBackend;
        const tokens = Array.isArray(product.unitTokens) ? product.unitTokens.filter(Boolean) : [];
        if (backend?.enabled && tokens.length) {
          // Server is authoritative: release every owned unit of this product,
          // then re-sync the linked list from Supabase.
          await Promise.all(tokens.map(token => backend.unlinkUnit(token)));
          await refreshLinkedProductsFromServer();
          return;
        }

        // Local-only prototype fallback (backend disabled or no unit token).
        linkedProducts = linkedProducts.filter(item => item.productCode !== product.productCode);
        saveLinkedProducts();
        renderLinkedProducts();
      });
      unlinkConfirm.addEventListener("click", evt => {
        if (evt.target === unlinkConfirm) closeUnlinkConfirm();
      });
    }

    function openUnlinkConfirm() {
      ensureUnlinkConfirm();
      if (unlinkConfirmName && selectedLinkedProduct) {
        unlinkConfirmName.textContent = selectedLinkedProduct.productName + " \u00b7 " + selectedLinkedProduct.colourName;
      }
      unlinkConfirm.setAttribute("aria-hidden", "false");
      unlinkConfirm.classList.add("open");
    }

    function closeUnlinkConfirm() {
      if (!unlinkConfirm) return;
      unlinkConfirm.classList.remove("open");
      unlinkConfirm.setAttribute("aria-hidden", "true");
    }

    linkedReferralUnlink.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedLinkedProduct) return;
      openUnlinkConfirm();
    });

    linkedReferralShowQr?.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (!linkedReferralQr) return;
      linkedReferralQr.hidden = !linkedReferralQr.hidden;
      linkedReferralShowQr.textContent = linkedReferralQr.hidden ? "show referral QR" : "hide referral QR";
    });

    linkedReferralCopy?.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const referralUrl = linkedReferralLink?.value || "";
      if (!referralUrl) return;
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(referralUrl);
          copied = true;
        }
      } catch (error) {
        copied = false;
      }
      if (!copied) {
        linkedReferralLink?.focus();
        linkedReferralLink?.select();
      }
      if (referralCopyTimer) clearTimeout(referralCopyTimer);
      linkedReferralCopy.textContent = copied ? "copied" : "link selected";
      referralCopyTimer = setTimeout(() => {
        linkedReferralCopy.textContent = "copy referral link";
        referralCopyTimer = null;
      }, 1300);
    });

    linkedReferralShare?.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      if (!selectedLinkedProduct || typeof navigator.share !== "function") return;
      const url = buildLocalReferralUrl(selectedLinkedProduct.productCode);
      try {
        await navigator.share({
          title: `${selectedLinkedProduct.productName} referral`,
          text: `Take a look at ${selectedLinkedProduct.productName} in ${selectedLinkedProduct.colourName}.`,
          url
        });
      } catch (error) {
        if (error?.name !== "AbortError") console.warn("Unable to share referral link", error);
      }
    });

    window.addEventListener("hug:qr-scan-error", event => {
      // Only react while actually scanning on the active scan screen; a late
      // error from a torn-down session must not blank another screen's state.
      if (!scanScreen?.classList.contains("active")) return;
      const st = scanScreen.dataset.scanState;
      if (st !== "scanning" && st !== "processing" && st !== "ready") return;
      stopProductQrScan({
        state: "failed",
        message: event.detail?.message || "Unable to scan QR code. Tap to retry."
      });
      // One automatic recovery attempt; the tap-to-retry handler covers the rest.
      const retryId = scanRequestId;
      setTimeout(function () {
        if (retryId !== scanRequestId) return;
        if (!scanScreen.classList.contains("active")) return;
        if (scanScreen.dataset.scanState !== "failed") return;
        startProductQrScan();
      }, 900);
    });

    function hydrateCombinedSvgIcons() {
      if (!iconLibraryInline || !svgIconTargets.length) return;
      const fallbackSrc = {
        bottle: "assets/fallback-bottle.png",
        factory: "assets/fallback-factory.png",
        tree: "assets/icon-tree.svg",
        settings: "assets/fallback-settings.png",
        scanner: "assets/fallback-scanner.png"
      };
      let hydrated = false;

      const applyFallback = () => {
        if (hydrated) return;
        hydrated = true;
        document.querySelectorAll("svg[data-lib-icon]").forEach(svgNode => {
          const iconId = svgNode.dataset.libIcon;
          const src = fallbackSrc[iconId];
          if (!src) return;
          const fallback = document.createElement("img");
          fallback.className = svgNode.className.replace(/\ssvg-lib-icon\b/g, "");
          fallback.src = src;
          fallback.alt = "";
          fallback.setAttribute("aria-hidden", "true");
          svgNode.replaceWith(fallback);
        });
      };

      const mountIcons = () => {
        const styleText = [...iconLibraryInline.querySelectorAll("style")]
          .map(styleNode => styleNode.textContent || "")
          .join("\n");

        const bboxCache = new Map();

        const getIconBBox = (iconId) => {
          if (bboxCache.has(iconId)) return bboxCache.get(iconId);
          const sourceGroup = iconLibraryInline.querySelector(`[id="${iconId}"]`);
          if (!sourceGroup) return null;

          const probeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          probeSvg.style.position = "absolute";
          probeSvg.style.left = "-9999px";
          probeSvg.style.top = "-9999px";
          probeSvg.style.width = "1px";
          probeSvg.style.height = "1px";
          probeSvg.style.overflow = "visible";

          if (styleText) {
            const styleNode = document.createElementNS("http://www.w3.org/2000/svg", "style");
            styleNode.textContent = styleText;
            probeSvg.appendChild(styleNode);
          }

          const probeGroup = sourceGroup.cloneNode(true);
          probeGroup.querySelectorAll("image").forEach(node => node.remove());
          probeSvg.appendChild(probeGroup);
          document.body.appendChild(probeSvg);

          let bbox = null;
          try {
            const measured = probeGroup.getBBox();
            if (measured.width > 0 && measured.height > 0) bbox = measured;
          } catch (error) {
            bbox = null;
          }
          probeSvg.remove();

          const resolvedBBox = bbox || { x: 0, y: 0, width: 64, height: 64 };
          bboxCache.set(iconId, resolvedBBox);
          return resolvedBBox;
        };

        svgIconTargets.forEach(targetSvg => {
          const iconId = targetSvg.dataset.libIcon;
          if (!iconId) return;
          if (iconId === "scanner") {
            const fallback = document.createElement("img");
            fallback.className = targetSvg.className.replace(/\ssvg-lib-icon\b/g, "");
            fallback.src = "assets/fallback-scanner.png";
            fallback.alt = "";
            fallback.setAttribute("aria-hidden", "true");
            targetSvg.replaceWith(fallback);
            return;
          }

          const sourceGroup = iconLibraryInline.querySelector(`[id="${iconId}"]`);
          if (!sourceGroup) return;

          const bbox = getIconBBox(iconId);
          if (!bbox) return;

          while (targetSvg.firstChild) targetSvg.removeChild(targetSvg.firstChild);

          if (styleText) {
            const styleNode = document.createElementNS("http://www.w3.org/2000/svg", "style");
            styleNode.textContent = styleText;
            targetSvg.appendChild(styleNode);
          }

          const iconGroup = sourceGroup.cloneNode(true);
          iconGroup.querySelectorAll("image").forEach(node => node.remove());
          targetSvg.appendChild(iconGroup);

          const pad = 6;
          targetSvg.setAttribute(
            "viewBox",
            `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + (pad * 2)} ${bbox.height + (pad * 2)}`
          );
          targetSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        });
        hydrated = true;
      };

      mountIcons();
      if (!hydrated) applyFallback();
    }

    hydrateCombinedSvgIcons();

    // ---- Page switches: the bars' icons ease, they never snap ----
    // Every page has its own copy of the top bar (balance, bag) and the nav (settings, QR, scan),
    // each icon at that page's brightness (quiet pages dim them to .26, settings to .22). A switch
    // swapped one copy for the other, so each icon jumped to its new brightness in one frame
    // (measured in Chrome: home, QR, scan and settings, every direction). Owner, 2026-10-17: "more
    // of an s curve fade in/out and not an immediate on and off ... within 0.5 secs for all across
    // the board". Now the page coming in starts each icon at what was on screen a moment ago and
    // eases it to its own value: 450 ms, an S curve. A Web Animation over the stylesheet, so no
    // rule changes and nothing is left behind; a rule with !important still wins while it holds.
    // The bag, balance and checkout pages keep their own choreography: they slide in over home
    // and already fade their bars with it.
    // Function declarations (not consts): showScreen is hoisted and may run before this point.
    function chromeParts(screen) {
      if (!screen) return null;
      return [".top .balance", ".top .bag-button",
        '.bottom-nav [data-go="settings"]', '.bottom-nav [data-go="qr"]', '.bottom-nav [data-go="scan"]']
        .map(sel => ({ el: screen.querySelector(sel), icon: screen.querySelector(sel + " .nav-icon") }));
    }
    // settled: the value each part is heading for. A class change can have just started a CSS
    // transition, and computed style then gives its first frame; with transitions off for the
    // read it gives the end value (no transition starts afterwards: the value read is final).
    function chromeLook(parts, settled) {
      const els = settled ? parts.flatMap(p => [p.el, p.icon]).filter(Boolean) : [];
      const was = els.map(el => el.style.transition);
      els.forEach(el => { el.style.transition = "none"; });
      const look = parts.map(p => ({
        op: p.el ? parseFloat(getComputedStyle(p.el).opacity) : null,
        filter: p.icon ? getComputedStyle(p.icon).filter : null
      }));
      els.forEach((el, i) => { el.style.transition = was[i]; });
      return look;
    }
    // What the bars show right now: call BEFORE any class changes for a switch. screenName: a
    // page other than the current one (the bag, still drawn over home as it closes).
    function chromeCapture(screenName) {
      const name = screenName || phone.dataset.current || "home";
      const screen = screens.find(s => s.dataset.screen === name);
      const parts = chromeParts(screen);
      return parts ? { name, look: chromeLook(parts) } : null;
    }
    // After the switch: ease the new page's icons from what was captured. True when it applies.
    // The bag and balance pages sliding in over home or away from it keep their own fades (those
    // run on phone classes, below, and mostly not through showScreen at all).
    // opts.force: a caller that has taken the freeze rules off its own switch (bag <-> balance,
    // settings -> balance). opts.topOnly: the end of a bag close, when home takes over from the bag
    // drawn above it; only the top bar was the bag's (the nav underneath was home's all along).
    // opts.navOnly: the end of a bag close to any other page, where it is the other way round.
    function chromeEaseFrom(from, opts = {}) {
      if (!from) return false;
      const name = phone.dataset.current || "home";
      if (name === from.name) return false;            // same page (a quick fade landing): its ease runs on
      if (!opts.force) {
        if (/\b(bag-entering|account-entering|bag-closing|account-closing|bag-account-switch|settings-account-switch|bag-scan-switch|bag-target-[\w-]+|bag-to-[\w-]+-switch|bag-from-[\w-]+-switch)\b/.test(phone.className)) return false;
      }
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
      let parts = chromeParts(screens.find(s => s.dataset.screen === name));
      if (!parts || typeof Element.prototype.animate !== "function") return false;
      // An ease still running (a quick second switch) belongs to a page now leaving: drop it.
      screens.forEach(s => (chromeParts(s) || []).forEach(p => [p.el, p.icon].forEach(el => {
        if (el && el.getAnimations) el.getAnimations().forEach(a => { if (a.id === "chrome-ease") a.cancel(); });
      })));
      const to = chromeLook(parts, true);
      const timing = { duration: 450, easing: "cubic-bezier(.45, 0, .55, 1)" };
      parts.forEach((p, i) => {
        if (opts.topOnly && i > 1) return;              // the nav: home's already
        if (opts.navOnly && i < 2) return;              // the top bar: the page's own already
        const a = from.look[i], b = to[i];
        if (p.el && a.op != null && b.op != null && Math.abs(a.op - b.op) > 0.02) {
          p.el.animate([{ opacity: a.op }, { opacity: b.op }], timing).id = "chrome-ease";
        }
        if (p.icon && a.filter != null && b.filter != null && a.filter !== b.filter) {
          p.icon.animate([{ filter: a.filter }, { filter: b.filter }], timing).id = "chrome-ease";
        }
      });
      return true;
    }

    function showScreen(name, options = {}) {
      if (window.HugDiag) window.HugDiag.log("screen", { name });
      const chromeFrom = chromeCapture();
      const scanWasActive = scanScreen?.classList.contains("active");
      if (scanWasActive && name !== "scan") {
        stopProductQrScan({ state: null, defer: true });
      }
      if (name !== "linked") {
        closeLinkedReferral();
      }
      const keepBagClosing = !!options.keepBagClosing;
      if (quickFadeTimer) {
        clearTimeout(quickFadeTimer);
        quickFadeTimer = null;
      }
      phone.classList.remove("quick-fade-mode");
      phone.classList.remove("hide-enter-chrome");
      phone.classList.remove("chrome-shared");
      phone.style.removeProperty("--quick-fade-ms");
      screens.forEach(screen => {
        screen.classList.remove("quick-fade-enter", "quick-fade-leave");
      });
      cancelOverlayEntry();
      if (!keepBagClosing) {
        cancelBagClosing();
      }
      screens.forEach(screen => {
        const isActive = screen.dataset.screen === name;
        screen.classList.toggle("active", isActive);
        screen.classList.remove("drag-peek");
        screen.style.setProperty("--screen-x", "0px");
        screen.style.setProperty("--content-x", "0px");
        screen.style.setProperty("--pull-y", "0px");
        screen.style.setProperty("--pull-x", "0px");
      });
      phone.classList.remove("is-pulling");
      phone.classList.remove("is-pulling-x");
      phone.classList.remove("bag-closing");
      phone.dataset.current = name;
      // Belt-and-suspenders: the transparent-WebView class must never linger on a
      // non-scan screen, or the whole app greys out (native backdrop shows through).
      if (name !== "scan") document.documentElement.classList.remove("scan-camera-active");
      // A swipe's camera veil ends with it, a moment after the screen changes, so the scan
      // shutter can see it was a veiled leave and stay away (scanShutter, below).
      if (document.documentElement.classList.contains("scan-cam-veil")) {
        setTimeout(function () { document.documentElement.classList.remove("scan-cam-veil"); }, 450);
      }
      if (name === "account") {
        document.querySelectorAll(".history-list").forEach(list => {
          list.scrollTop = 0;
          list.style.setProperty("--hist-pull", "0px");
        });
        syncHistoryFade();
      }
      if (name === "profile") {
        const pc = document.querySelector('.screen[data-screen="profile"] .content');
        if (pc) pc.scrollTop = 0;
      }
      if (name === "scan") {
        // Defer the native camera start until the scan screen has actually laid
        // out + painted — starting it against a 0-sized viewport is the "only
        // works on the second pass" bug. Guard in case we navigated away again.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (scanScreen && scanScreen.classList.contains("active")) startProductQrScan();
        }));
      }
      chromeEaseFrom(chromeFrom);
    }

    function shouldQuickFadeTransition(current, target, trigger = "tap") {
      if (trigger !== "tap") return false;
      return current === "qr" || target === "qr";
    }

    function quickFadeTo(name, options = {}) {
      const durationMs = Number.isFinite(options.ms) ? Math.max(120, options.ms) : 170;
      const current = activeScreen();
      const next = screens.find(screen => screen.dataset.screen === name);
      const currentName = current?.dataset?.screen || "";
      const bagInvolved = currentName === "bag" || name === "bag";
      const accountInvolved = currentName === "account" || name === "account";
      const returningHomeFromQuickScreen = name === "home" && (currentName === "qr" || currentName === "scan");
      const keepEnterChromeVisible = bagInvolved || accountInvolved || returningHomeFromQuickScreen;
      if (!current || !next || current === next) {
        showScreen(name);
        return;
      }
      if (quickFadeTimer && phone.classList.contains("quick-fade-mode") && phone.dataset.current === name) {
        return;
      }
      if (quickFadeTimer) {
        clearTimeout(quickFadeTimer);
        quickFadeTimer = null;
      }
      if (currentName === "scan") {
        stopProductQrScan({ state: null, defer: true });
      }
      const chromeFrom = chromeCapture();
      phone.classList.add("quick-fade-mode");
      if (keepEnterChromeVisible) {
        phone.classList.remove("hide-enter-chrome");
      } else {
        phone.classList.add("hide-enter-chrome");
      }
      stabilizeNavSwitch(durationMs + 90);
      phone.style.setProperty("--quick-fade-ms", `${durationMs}ms`);
      screens.forEach(screen => {
        screen.classList.remove("quick-fade-enter", "quick-fade-leave");
      });
      next.classList.add("active", "quick-fade-enter");
      current.classList.add("quick-fade-leave");
      phone.dataset.current = name;
      // Bars shared through the fade (styles.css .chrome-shared): the incoming page's bars are
      // drawn at once with their icons easing from the old values, and only the page between
      // them cross-fades. No hide-enter-chrome then: the leaving bars are gone, nothing overlaps.
      if (chromeEaseFrom(chromeFrom)) {
        phone.classList.add("chrome-shared");
        phone.classList.remove("hide-enter-chrome");
      }
      quickFadeTimer = setTimeout(() => {
        quickFadeTimer = null;
        showScreen(name);
      }, durationMs + 10);
    }

    function activeScreen() {
      return screens.find(screen => screen.classList.contains("active"));
    }

    function updateCart() {
      const total = cartTotal();
      if (window.__giftSync) { try { window.__giftSync(); } catch (e) {} }
      if (qtyNumber) qtyNumber.textContent = String(cartQty[bagCarouselIndex] || 0);
      const hasItems = total > 0;
      bagCounts.forEach(count => {
        const bagButton = count.closest(".bag-button");
        if (count.__fadeTimer) {
          clearTimeout(count.__fadeTimer);
          count.__fadeTimer = 0;
        }

        if (hasItems) {
          count.textContent = String(total);
          bagButton?.classList.add("has-count");
          return;
        }

        bagButton?.classList.remove("has-count");
        if (count.textContent === "") return;
        count.__fadeTimer = setTimeout(() => {
          if (cartTotal() === 0 && !bagButton?.classList.contains("has-count")) {
            count.textContent = "";
          }
          count.__fadeTimer = 0;
        }, BAG_COUNT_FADE_MS);
      });
      if (checkoutTotalValue) {
        const mugSubtotal = total * unitPrice;
        const discount = (referralApplied && total > 0) ? mugSubtotal * referralFriendRate : 0;
        const grand = mugSubtotal - discount + (total > 0 ? giftWrapFee() + giftCardFee() : 0);
        checkoutTotalValue.textContent = `£${grand.toFixed(2)}`;
        if (checkoutDiscountRow) {
          checkoutDiscountRow.hidden = discount <= 0;
          const lbl = document.getElementById("checkout-discount-label");
          if (lbl) lbl.textContent = hugTpl("referral discount ({pct} off)", { pct: Math.round(referralFriendRate * 100) + "%" });
          if (checkoutDiscountValue) checkoutDiscountValue.textContent = `−£${discount.toFixed(2)}`;
        }
        if (window.__hugShopCredit) window.__hugShopCredit.render(grand);
      }
      renderCheckoutItems();
      prefillCheckoutAddress();
    }

    function renderCheckoutItems() {
      const container = document.getElementById("checkout-items");
      if (!container) return;
      const indices = [];
      for (let i = 0; i < bagVariantNames.length; i++) {
        if (cartQty[i] > 0) indices.push(i);
      }
      if (!indices.length) {
        container.innerHTML = '<p class="checkout-empty">your bag is empty</p>';
        container.classList.remove("has-items");
        return;
      }
      container.classList.add("has-items");
      const existing = [...container.querySelectorAll(".checkout-item")].map(el => el.dataset.variantIndex);
      const wanted = indices.map(String);
      const sameSet = existing.length === wanted.length && wanted.every(k => existing.includes(k));
      if (sameSet) {
        indices.forEach(i => {
          const row = container.querySelector('.checkout-item[data-variant-index="' + i + '"]');
          if (!row) return;
          row.querySelector(".checkout-item-qty").textContent = String(cartQty[i]);
          row.querySelector(".checkout-item-amount").textContent = "\u00A3" + (cartQty[i] * unitPrice).toFixed(2);
        });
        return;
      }
      container.innerHTML = indices.map(i => {
        const name = bagVariantNames[i];
        const amt = (cartQty[i] * unitPrice).toFixed(2);
        return '<div class="checkout-item" data-variant-index="' + i + '">'
          + '<span class="checkout-item-name">' + name + '</span>'
          + '<div class="checkout-stepper">'
          + '<button class="checkout-step" type="button" data-checkout-step="down" data-variant-index="' + i + '" aria-label="Remove one ' + name + '">-</button>'
          + '<span class="checkout-item-qty">' + cartQty[i] + '</span>'
          + '<button class="checkout-step" type="button" data-checkout-step="up" data-variant-index="' + i + '" aria-label="Add one ' + name + '">+</button>'
          + '</div>'
          + '<span class="checkout-item-amount gradient-accent">\u00A3' + amt + '</span>'
          + '</div>';
      }).join("");
    }

    let startX = 0;
    let startY = 0;
    let lastDragDistance = 0;
    let lastSwipeAt = 0;
    let pointerActive = false;
    let pullScreen = null;
    let gestureAxis = null;
    let dragTargetScreen = null;
    let dragDirection = 0;
    let swipeAnimating = false;
    let suppressTapUntil = 0;
    let lastNavAt = 0;
    let lastNavTarget = null;
    let settingsCloseTimer = null;
    let bagEnterTimer = null;
    let bagCloseTimer = null;
    let bagRevealTimer = null;
    let bagTargetUiStabilizeTimer = null;
    let bagAccountSwitchTimer = null;
    let bagScanSwitchTimer = null;
    let bagSettingsSwitchTimer = null;
    let settingsAccountSwitchTimer = null;
    let navSwitchStabilizeTimer = null;
    let accountEnterTimer = null;
    let accountCloseTimer = null;
    let accountRevealTimer = null;
    let quickFadeTimer = null;
    let gestureOriginInLeader = false;
    const prefersPointerInput = "PointerEvent" in window;
    let pointerGestureId = null;
    let gestureLastSampleAt = 0;
    let gestureWatchdogTimer = 0;
    window.__swipeDebug = [];

    function clearGestureWatchdog() {
      if (!gestureWatchdogTimer) return;
      clearInterval(gestureWatchdogTimer);
      gestureWatchdogTimer = 0;
    }

    function markGestureSample() {
      gestureLastSampleAt = Date.now();
    }

    function ensureGestureWatchdog() {
      if (gestureWatchdogTimer) return;
      gestureWatchdogTimer = setInterval(() => {
        if (!pointerActive || swipeAnimating) return;
        if (Date.now() - gestureLastSampleAt < 460) return;
        resetGesture({ instant: true });
      }, 120);
    }

    function clearNavSwitchStabilize() {
      if (navSwitchStabilizeTimer) {
        clearTimeout(navSwitchStabilizeTimer);
        navSwitchStabilizeTimer = null;
      }
      phone.classList.remove("nav-switching");
    }

    function stabilizeNavSwitch(durationMs = 220) {
      clearNavSwitchStabilize();
      phone.classList.add("nav-switching");
      navSwitchStabilizeTimer = setTimeout(() => {
        phone.classList.remove("nav-switching");
        navSwitchStabilizeTimer = null;
      }, durationMs);
    }

    function stabilizeBagAccountSwitch(durationMs = 280) {
      if (bagAccountSwitchTimer) {
        clearTimeout(bagAccountSwitchTimer);
        bagAccountSwitchTimer = null;
      }
      phone.classList.add("bag-account-switch");
      bagAccountSwitchTimer = setTimeout(() => {
        phone.classList.remove("bag-account-switch");
        bagAccountSwitchTimer = null;
      }, durationMs);
    }

    function clearSettingsAccountSwitch() {
      if (settingsAccountSwitchTimer) {
        clearTimeout(settingsAccountSwitchTimer);
        settingsAccountSwitchTimer = null;
      }
      phone.classList.remove("settings-account-switch");
    }

    function stabilizeSettingsAccountSwitch(durationMs = 280) {
      clearSettingsAccountSwitch();
      phone.classList.add("settings-account-switch");
      settingsAccountSwitchTimer = setTimeout(() => {
        phone.classList.remove("settings-account-switch");
        settingsAccountSwitchTimer = null;
      }, durationMs);
    }

    function clearBagScanSwitch() {
      if (bagScanSwitchTimer) {
        clearTimeout(bagScanSwitchTimer);
        bagScanSwitchTimer = null;
      }
      phone.classList.remove("bag-scan-switch");
      phone.classList.remove("bag-to-scan-switch");
      phone.classList.remove("bag-to-qr-switch");
      phone.classList.remove("bag-from-scan-switch");
    }

    function stabilizeBagScanSwitch(durationMs = 340, direction = "to-scan") {
      clearBagScanSwitch();
      phone.classList.add("bag-scan-switch");
      if (direction === "from-scan") {
        phone.classList.add("bag-from-scan-switch");
      } else if (direction === "to-qr") {
        phone.classList.add("bag-to-qr-switch");
      } else {
        phone.classList.add("bag-to-scan-switch");
      }
      bagScanSwitchTimer = setTimeout(() => {
        phone.classList.remove("bag-scan-switch");
        phone.classList.remove("bag-to-scan-switch");
        phone.classList.remove("bag-to-qr-switch");
        phone.classList.remove("bag-from-scan-switch");
        bagScanSwitchTimer = null;
      }, durationMs);
    }

    function cancelSettingsClosing() {
      if (settingsCloseTimer) {
        clearTimeout(settingsCloseTimer);
        settingsCloseTimer = null;
      }
      phone.classList.remove("settings-closing");
      phone.classList.remove("settings-home-reveal");
    }

    function cancelOverlayEntry() {
      if (bagEnterTimer) {
        clearTimeout(bagEnterTimer);
        bagEnterTimer = null;
      }
      if (accountEnterTimer) {
        clearTimeout(accountEnterTimer);
        accountEnterTimer = null;
      }
      phone.classList.remove("bag-entering");
      phone.classList.remove("account-entering");
    }

    function cancelBagClosing() {
      cancelOverlayEntry();
      if (bagCloseTimer) {
        clearTimeout(bagCloseTimer);
        bagCloseTimer = null;
      }
      if (bagRevealTimer) {
        clearTimeout(bagRevealTimer);
        cancelAnimationFrame(bagRevealTimer);
        bagRevealTimer = null;
      }
      phone.classList.remove("bag-closing");
      phone.classList.remove("bag-home-reveal");
      phone.classList.remove("bag-nonhome-reveal");
      resetBagCarousel();
      if (bagTargetUiStabilizeTimer) {
        clearTimeout(bagTargetUiStabilizeTimer);
        bagTargetUiStabilizeTimer = null;
      }
      clearBagScanSwitch();
      if (bagSettingsSwitchTimer) { clearTimeout(bagSettingsSwitchTimer); bagSettingsSwitchTimer = null; }
      phone.classList.remove("bag-to-settings-switch");
      phone.classList.remove("bag-target-settings");
      phone.classList.remove("bag-target-account");
    }

    function stabilizeTargetUiFromBag(target) {
      if (bagTargetUiStabilizeTimer) {
        clearTimeout(bagTargetUiStabilizeTimer);
        bagTargetUiStabilizeTimer = null;
      }
      phone.classList.remove("bag-target-settings");
      phone.classList.remove("bag-target-account");
      if (target === "settings") {
        phone.classList.add("bag-target-settings");
      } else if (target === "account") {
        phone.classList.add("bag-target-account");
      } else {
        return;
      }
      bagTargetUiStabilizeTimer = setTimeout(() => {
        phone.classList.remove("bag-target-settings");
        phone.classList.remove("bag-target-account");
        bagTargetUiStabilizeTimer = null;
      }, 280);
    }

    function cancelAccountClosing() {
      cancelOverlayEntry();
      if (accountCloseTimer) {
        clearTimeout(accountCloseTimer);
        accountCloseTimer = null;
      }
      if (accountRevealTimer) {
        clearTimeout(accountRevealTimer);
        cancelAnimationFrame(accountRevealTimer);
        accountRevealTimer = null;
      }
      phone.classList.remove("account-closing");
      phone.classList.remove("account-home-reveal");
    }

    function enterOverlayFromHome(target) {
      const homeScreen = screens.find(screen => screen.dataset.screen === "home");
      const targetScreen = screens.find(screen => screen.dataset.screen === target);
      if (!homeScreen || !targetScreen) {
        showScreen(target);
        return;
      }
      cancelOverlayEntry();
      if (target === "bag") {
        cancelBagClosing();
      } else if (target === "account") {
        cancelAccountClosing();
      }
      const enterClass = target === "bag" ? "bag-entering" : "account-entering";
      const duration = target === "bag" ? BAG_MOTION_MS : ACCOUNT_MOTION_MS;
      phone.classList.add(enterClass);
      screens.forEach(screen => {
        const keepActive = screen === homeScreen || screen === targetScreen;
        screen.classList.toggle("active", keepActive);
        screen.classList.remove("drag-peek", "quick-fade-enter", "quick-fade-leave");
        screen.style.setProperty("--screen-x", "0px");
        screen.style.setProperty("--content-x", "0px");
        screen.style.setProperty("--pull-y", "0px");
        screen.style.setProperty("--pull-x", "0px");
      });
      phone.classList.remove("is-pulling");
      phone.classList.remove("is-pulling-x");
      phone.dataset.current = target;
      if (target === "account") {
        document.querySelectorAll(".history-list").forEach(list => {
          list.scrollTop = 0;
          list.style.setProperty("--hist-pull", "0px");
        });
        syncHistoryFade();
      }
      const finish = () => {
        phone.classList.remove(enterClass);
        if (phone.dataset.current === target) {
          homeScreen.classList.remove("active", "drag-peek", "quick-fade-enter", "quick-fade-leave");
          homeScreen.style.setProperty("--screen-x", "0px");
          homeScreen.style.setProperty("--content-x", "0px");
          homeScreen.style.setProperty("--pull-y", "0px");
          homeScreen.style.setProperty("--pull-x", "0px");
          targetScreen.classList.add("active");
        }
        if (target === "bag") {
          bagEnterTimer = null;
        } else {
          accountEnterTimer = null;
        }
      };
      if (target === "bag") {
        bagEnterTimer = setTimeout(finish, duration + 28);
        bagCarouselRender();
      } else {
        accountEnterTimer = setTimeout(finish, duration + 28);
      }
    }

    function onNavAction(target, options = {}) {
      const trigger = options.trigger || "tap";
      const current = phone.dataset.current || "home";
      // Any move off the scan screen drops the transparent camera overlay at once,
      // so a stale leak can't grey out the whole app on the destination screen.
      if (target !== "scan") document.documentElement.classList.remove("scan-camera-active");
      // Profile must open at the top (the address-edit keyboard lift can leave its
      // scroll partway down, hiding the title behind the header).
      if (target === "profile") {
        var __pc = document.querySelector('.screen[data-screen="profile"] .content');
        if (__pc) __pc.scrollTop = 0;
      }
      // Collapse duplicate same-target calls fired by one physical tap
      // (e.g. a settings row's pointerdown opens a screen and the trailing
      // click would otherwise re-fire and toggle it closed). A deliberate
      // re-tap to toggle is always well beyond this window.
      const __navNow = Date.now();
      if (target === lastNavTarget && __navNow - lastNavAt < 350) return;
      lastNavAt = __navNow;
      lastNavTarget = target;
      const closeBagTo = next => {
        if (next === "home") {
          cancelBagClosing();
          const homeScreen = screens.find(screen => screen.dataset.screen === "home");
          const bagScreen = screens.find(screen => screen.dataset.screen === "bag");
          if (!homeScreen || !bagScreen) {
            showScreen("home");
            return;
          }
          phone.classList.add("bag-closing");
          bagCarouselRender();
          screens.forEach(screen => {
            const keepActive = screen === homeScreen || screen === bagScreen;
            screen.classList.toggle("active", keepActive);
            screen.classList.remove("drag-peek");
            screen.style.setProperty("--screen-x", "0px");
            screen.style.setProperty("--content-x", "0px");
            screen.style.setProperty("--pull-y", "0px");
            screen.style.setProperty("--pull-x", "0px");
          });
          phone.classList.remove("is-pulling");
          phone.classList.remove("is-pulling-x");
          phone.dataset.current = "home";
          bagRevealTimer = requestAnimationFrame(() => {
            bagRevealTimer = requestAnimationFrame(() => {
              if (!phone.classList.contains("bag-closing")) {
                bagRevealTimer = null;
                return;
              }
              phone.classList.add("bag-home-reveal");
              bagRevealTimer = null;
            });
          });
          bagCloseTimer = setTimeout(() => {
            if (!phone.classList.contains("bag-closing")) {
              bagCloseTimer = null;
              return;
            }
            const homeNow = phone.dataset.current || "home";
            // The bag held its icon at full strength over home; home's own is a touch lighter and
            // took over in one frame. Ease that hand-over like every other switch.
            const chromeFrom = homeNow === "home" ? chromeCapture("bag") : null;
            phone.classList.remove("bag-closing");
            phone.classList.remove("bag-home-reveal");
            bagCloseTimer = null;
            if (homeNow === "home") {
              bagScreen.classList.remove("active", "drag-peek", "quick-fade-enter", "quick-fade-leave");
              bagScreen.style.setProperty("--screen-x", "0px");
              bagScreen.style.setProperty("--content-x", "0px");
              bagScreen.style.setProperty("--pull-y", "0px");
              bagScreen.style.setProperty("--pull-x", "0px");
              homeScreen.classList.add("active");
              chromeEaseFrom(chromeFrom, { force: true, topOnly: true });
            }
          }, BAG_EXIT_MS + 36);
          return;
        }
        cancelBagClosing();
        const bagScreen = screens.find(screen => screen.dataset.screen === "bag");
        const nextScreen = screens.find(screen => screen.dataset.screen === next);
        if (!bagScreen || !nextScreen) {
          if (shouldQuickFadeTransition(current, next, trigger)) {
            quickFadeTo(next);
          } else {
            showScreen(next);
          }
          return;
        }
        if (next === "scan" || next === "qr") {
          stabilizeBagScanSwitch(BAG_EXIT_MS + 260, next === "qr" ? "to-qr" : "to-scan");
        }
        phone.classList.remove("bag-to-settings-switch");
        if (bagSettingsSwitchTimer) { clearTimeout(bagSettingsSwitchTimer); bagSettingsSwitchTimer = null; }
        if (next === "settings") {
          phone.classList.add("bag-to-settings-switch");
          bagSettingsSwitchTimer = setTimeout(() => {
            phone.classList.remove("bag-to-settings-switch");
            bagSettingsSwitchTimer = null;
          }, BAG_EXIT_MS + 260);
        }
        phone.classList.add("bag-closing");
        bagCarouselRender();
        screens.forEach(screen => {
          const keepActive = screen === bagScreen || screen === nextScreen;
          screen.classList.toggle("active", keepActive);
          screen.classList.remove("drag-peek");
          screen.style.setProperty("--screen-x", "0px");
          screen.style.setProperty("--content-x", "0px");
          screen.style.setProperty("--pull-y", "0px");
          screen.style.setProperty("--pull-x", "0px");
        });
        phone.classList.remove("is-pulling");
        phone.classList.remove("is-pulling-x");
        phone.dataset.current = next;
        bagRevealTimer = requestAnimationFrame(() => {
          bagRevealTimer = requestAnimationFrame(() => {
            if (!phone.classList.contains("bag-closing")) {
              bagRevealTimer = null;
              return;
            }
            phone.classList.add("bag-nonhome-reveal");
            bagRevealTimer = null;
          });
        });
        bagCloseTimer = setTimeout(() => {
          // The bag's nav stayed on top through this close; the page under it may dim its icons
          // a touch more (settings: .22, not .26). Ease that hand-over (nav only: the bag's top
          // bar has already faded away to show the page's own).
          const chromeFrom = chromeCapture("bag");
          phone.classList.remove("bag-closing");
          phone.classList.remove("bag-home-reveal");
          phone.classList.remove("bag-nonhome-reveal");
          bagCloseTimer = null;
          if (next !== "settings") stabilizeTargetUiFromBag(next);
          bagScreen.classList.remove("active", "drag-peek", "quick-fade-enter", "quick-fade-leave");
          bagScreen.style.setProperty("--screen-x", "0px");
          bagScreen.style.setProperty("--content-x", "0px");
          bagScreen.style.setProperty("--pull-y", "0px");
          bagScreen.style.setProperty("--pull-x", "0px");
          nextScreen.classList.add("active");
          phone.dataset.current = next;
          chromeEaseFrom(chromeFrom, { force: true, navOnly: true });
          // Bag→scan uses this manual transition (NOT showScreen), so the native
          // camera was never started — kick it off now that the scan screen is the
          // sole active screen (deferred a frame so it lays out first).
          if (next === "scan") {
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (scanScreen && scanScreen.classList.contains("active")) startProductQrScan();
            }));
          }
        }, BAG_EXIT_MS + 36);
      };
      if (current !== "settings") {
        cancelSettingsClosing();
      }
      if (current !== "bag") {
        cancelBagClosing();
      }
      if (current !== "account") {
        cancelAccountClosing();
      }
      if (current === "bag" && target === "account") {
        cancelBagClosing();
        stabilizeBagAccountSwitch(320);
        stabilizeNavSwitch(280);
        // No stabilizeTargetUiFromBag("account") any more: it pinned the balance page's top icons
        // at their final values with !important for 280 ms, which beats the ease (a snap).
        const chromeFrom = chromeCapture();
        showScreen("account");
        chromeEaseFrom(chromeFrom, { force: true });
        return;
      }
      if (current === "bag" && target !== "checkout") {
        closeBagTo(target === "bag" ? "home" : target);
        return;
      }
      if (target === "account" && current === "account") {
        cancelAccountClosing();
        const homeScreen = screens.find(screen => screen.dataset.screen === "home");
        const accountScreen = screens.find(screen => screen.dataset.screen === "account");
        if (!homeScreen || !accountScreen) {
          showScreen("home");
          return;
        }
        phone.classList.add("account-closing");
        phone.classList.remove("account-home-reveal");
        screens.forEach(screen => {
          const keepActive = screen === homeScreen || screen === accountScreen;
          screen.classList.toggle("active", keepActive);
          screen.classList.remove("drag-peek");
          screen.style.setProperty("--screen-x", "0px");
          screen.style.setProperty("--content-x", "0px");
          screen.style.setProperty("--pull-y", "0px");
          screen.style.setProperty("--pull-x", "0px");
        });
        phone.classList.remove("is-pulling");
        phone.classList.remove("is-pulling-x");
        phone.dataset.current = "home";
        accountRevealTimer = requestAnimationFrame(() => {
          accountRevealTimer = requestAnimationFrame(() => {
            if (!phone.classList.contains("account-closing")) {
              accountRevealTimer = null;
              return;
            }
            phone.classList.add("account-home-reveal");
            accountRevealTimer = null;
          });
        });
        accountCloseTimer = setTimeout(() => {
          if (!phone.classList.contains("account-closing")) {
            accountCloseTimer = null;
            return;
          }
          const homeNow = phone.dataset.current || "home";
          phone.classList.remove("account-closing");
          phone.classList.remove("account-home-reveal");
          accountCloseTimer = null;
          if (homeNow === "home") {
            accountScreen.classList.remove("active", "drag-peek", "quick-fade-enter", "quick-fade-leave");
            accountScreen.style.setProperty("--screen-x", "0px");
            accountScreen.style.setProperty("--content-x", "0px");
            accountScreen.style.setProperty("--pull-y", "0px");
            accountScreen.style.setProperty("--pull-x", "0px");
            homeScreen.classList.add("active");
          }
        }, ACCOUNT_EXIT_MS + 36);
        return;
      }
      if (target === "qr" && current === "qr") {
        if (shouldQuickFadeTransition(current, "home", trigger)) {
          quickFadeTo("home");
        } else {
          showScreen("home");
        }
        return;
      }
      if (target === "scan" && current === "scan") {
        if (shouldQuickFadeTransition(current, "home", trigger)) {
          quickFadeTo("home");
        } else {
          showScreen("home");
        }
        return;
      }
      if (target === "settings" && current === "settings") {
        cancelSettingsClosing();
        phone.classList.add("settings-closing");
        phone.classList.remove("settings-home-reveal");
        showScreen("home");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            phone.classList.add("settings-home-reveal");
          });
        });
        settingsCloseTimer = setTimeout(() => {
          phone.classList.remove("settings-closing");
          phone.classList.remove("settings-home-reveal");
          settingsCloseTimer = null;
        }, SETTINGS_MOTION_MS);
        return;
      }
      if (trigger === "tap" && current === "settings" && target === "account") {
        // No stabilizeSettingsAccountSwitch(320) any more: it pinned both top bars at the balance
        // page's values with !important, which beats the ease (a snap). The ease reads its end
        // values with transitions off, so no CSS transition starts under it either.
        const chromeFrom = chromeCapture();
        showScreen("account");
        chromeEaseFrom(chromeFrom, { force: true });
        return;
      }
      const navTarget = target === "settings" || target === "qr" || target === "scan";
      const navCurrent = current === "home" || current === "settings" || current === "qr" || current === "scan";
      if (trigger === "tap" && navTarget && navCurrent && current !== target) {
        stabilizeNavSwitch(240);
        showScreen(target);
        return;
      }
      if (trigger === "tap" && current === "account" && target === "bag") {
        stabilizeBagAccountSwitch(320);
        stabilizeNavSwitch(280);
        const chromeFrom = chromeCapture();
        showScreen("bag");
        chromeEaseFrom(chromeFrom, { force: true });
        return;
      }
      if (trigger === "tap" && (current === "scan" || current === "qr") && target === "bag") {
        stabilizeBagScanSwitch(BAG_MOTION_MS + 90, "from-scan");
        quickFadeTo(target, { ms: BAG_MOTION_MS });
        return;
      }
      if (trigger === "tap" && (target === "settings" || target === "qr" || target === "scan")) {
        stabilizeNavSwitch(240);
      }
      if (trigger === "tap" && current === "home" && (target === "bag" || target === "account")) {
        enterOverlayFromHome(target);
        return;
      }
      if (shouldQuickFadeTransition(current, target, trigger)) {
        quickFadeTo(target);
      } else {
        showScreen(target);
      }
    }

    function resetGesture({ instant = false } = {}) {
      pointerActive = false;
      pointerGestureId = null;
      clearGestureWatchdog();
      const active = activeScreen();
      const pullTarget = pullScreen || active;
      phone.classList.remove("is-pulling");
      phone.classList.remove("is-pulling-x");
      document.documentElement.classList.remove("scan-cam-veil");   // a swipe off the camera sprang back: show it again
      const clearY = () => {
        if (pullTarget) {
          pullTarget.style.setProperty("--pull-y", "0px");
          pullTarget.style.setProperty("--pull-x", "0px");
        }
        if (active && active !== pullTarget) {
          active.style.setProperty("--pull-y", "0px");
          active.style.setProperty("--pull-x", "0px");
        }
      };
      if (instant) {
        clearY();
        if (active) {
          active.style.setProperty("--screen-x", "0px");
          active.style.setProperty("--content-x", "0px");
        }
      } else {
        requestAnimationFrame(() => {
          clearY();
          if (active) {
            active.style.setProperty("--content-x", "0px");
            active.style.setProperty("--screen-x", "0px");
          }
        });
      }
      screens.forEach(screen => {
        screen.classList.remove("drag-peek");
        screen.style.setProperty("--screen-x", "0px");
        screen.style.setProperty("--content-x", "0px");
      });
      screens.forEach(screen => {
        if (!screen.classList.contains("rubber-ready")) return;
        screen.style.setProperty("--pull-y", "0px");
        screen.style.setProperty("--pull-x", "0px");
      });
      dragTargetScreen = null;
      pullScreen = null;
      gestureAxis = null;
      dragDirection = 0;
      gestureOriginInLeader = false;
    }

    function applyPull(dx, dy) {
      if (Math.abs(dy) < 8 || Math.abs(dy) < Math.abs(dx) * 1.2) return;
      const current = phone.dataset.current || "home";
      if (current === "home") return;
      const screen = activeScreen();
      if (!screen || !screen.classList.contains("rubber-ready")) return;
      pullScreen = screen;
      phone.classList.add("is-pulling");
      const pull = Math.sign(dy) * Math.min(65, Math.pow(Math.abs(dy), .82) * .78);
      screen.style.setProperty("--pull-y", `${pull}px`);
    }

    function applyPullX(dx, dy) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
      const current = phone.dataset.current || "home";
      const index = screenOrder.indexOf(current);
      if (index === -1) return;
      const screen = activeScreen();
      if (!screen || !screen.classList.contains("rubber-ready")) return;
      phone.classList.add("is-pulling-x");
      // A swipe off the scan screen veils the live camera at once (styles.css .scan-cam-veil). The
      // camera is a native layer behind the page: it cannot slide with its screen, so it stayed
      // put, live, behind the screen coming in, until the swipe had finished (owner, 2026-10-16:
      // "the camera is staying around too long and it looks shit"). A swipe that springs back
      // lifts the veil again (releaseHorizontalPeek).
      // From 16 px, so a nudge while aiming the camera does not blink it.
      if (current === "scan" && Math.abs(dx) >= 16) document.documentElement.classList.add("scan-cam-veil");
      const width = phone.clientWidth || 393;
      if (!dragDirection && Math.abs(dx) > 6) {
        dragDirection = dx < 0 ? -1 : 1;
      } else if (dragDirection && Math.abs(dx) > 24) {
        const sign = dx < 0 ? -1 : 1;
        if (sign !== dragDirection) dragDirection = sign;
      }
      const dragX = Math.max(-width, Math.min(width, dx * 0.92));
      screen.style.setProperty("--content-x", `${dragX}px`);
      const useDir = dragDirection || (dragX < 0 ? -1 : 1);
      const targetIndex = useDir < 0
        ? (index + 1) % screenOrder.length
        : (index - 1 + screenOrder.length) % screenOrder.length;
      const target = screens.find(s => s.dataset.screen === screenOrder[targetIndex]);
      if (!target) return;
      if (dragTargetScreen && dragTargetScreen !== target) {
        dragTargetScreen.classList.remove("drag-peek");
        dragTargetScreen.style.setProperty("--screen-x", "0px");
        dragTargetScreen.style.setProperty("--content-x", "0px");
      }
      dragTargetScreen = target;
      dragTargetScreen.classList.add("drag-peek");
      const incomingX = useDir < 0 ? width + dragX : -width + dragX;
      dragTargetScreen.style.setProperty("--content-x", `${incomingX}px`);
    }

    function releaseHorizontalPeek() {
      const active = activeScreen();
      phone.classList.remove("is-pulling-x");
      document.documentElement.classList.remove("scan-cam-veil");
      if (active) {
        active.style.setProperty("--content-x", "0px");
        active.style.setProperty("--screen-x", "0px");
      }
      if (dragTargetScreen) {
        dragTargetScreen.classList.remove("drag-peek");
        dragTargetScreen.style.setProperty("--content-x", "0px");
        dragTargetScreen.style.setProperty("--screen-x", "0px");
      }
      dragTargetScreen = null;
      dragDirection = 0;
    }

    function getSwipeTarget(dx, dy) {
      const width = phone.clientWidth || 393;
      const minDx = Math.max(52, Math.min(96, width * 0.16));
      if (Math.abs(dx) < minDx || Math.abs(dx) < Math.abs(dy) * 1.05) return null;
      const current = phone.dataset.current || "home";
      const index = screenOrder.indexOf(current);
      window.__swipeDebug.push({ phase: "swipe", dx, dy, current, index });
      if (index === -1) {
        return { target: "home", direction: dx < 0 ? -1 : 1 };
      }
      if (dx < 0) return { target: screenOrder[(index + 1) % screenOrder.length], direction: -1 };
      if (dx > 0) return { target: screenOrder[(index - 1 + screenOrder.length) % screenOrder.length], direction: 1 };
      return null;
    }

    document.querySelectorAll("[data-go]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        onNavAction(button.dataset.go, { trigger: "tap" });
      });
    });

    globalLogo?.addEventListener("click", event => {
      event.stopPropagation();
      const current = phone.dataset.current || "home";
      if (current === "bag") {
        onNavAction("home", { trigger: "tap" });
        return;
      }
      if (current === "account") {
        onNavAction("account", { trigger: "tap" });
        return;
      }
      showScreen("home");
    });

    const qtyPlus = document.getElementById("qty-plus");
    const qtyMinus = document.getElementById("qty-minus");
    let lastQtyActionAt = 0;
    const bagCarousel = document.querySelector(".product-carousel");
    const bagCarouselStage = bagCarousel?.querySelector(".product-carousel-stage");
    const bagVariantLabel = document.querySelector(".product-variant");
    const bagCarouselSlides = bagCarousel ? Array.from(bagCarousel.querySelectorAll(".product-render")) : [];
    const bagVariantNames = ["Dark Roast", "Cherry Pop", "Blue Crush", "Lemon Drop"];

    /* Shopify checkout hand-off: build a Storefront cart from the bag and open
       Shopify's hosted checkout (where Apple/Google Pay live). The referral_code
       (a referrer's code, if captured) rides as a cart attribute so the friend's
       discount + the referrer reward fire — same as the web flow. Needs HugShop
       configured (Storefront token set). */
    const SHOPIFY_VARIANT_GIDS = [
      "gid://shopify/ProductVariant/53993082585427", // dark roast
      "gid://shopify/ProductVariant/53993082650963", // cherry pop
      "gid://shopify/ProductVariant/53993082618195", // blue crush
      "gid://shopify/ProductVariant/53993082683731"  // lemon drop
    ];
    const SHOPIFY_GIFTWRAP_GID = "gid://shopify/ProductVariant/54045320085843"; // "Gift wrap" add-on, £5
    const SHOPIFY_GIFTCARD_GID = "gid://shopify/ProductVariant/54058678976851"; // "Greeting card" add-on, £4
    // Build the Storefront cart lines from the bag, carrying per-unit gift wrap +
    // card message so the Shopify order matches the app: a unit with a card
    // message or gift wrap becomes its own line (with line attributes); plain
    // units of a colour aggregate; one Gift-wrap product line (£3 each) charges
    // the wrap fee. Per-unit gift state comes from giftWrapFeature (__hugGiftState).
    // Card property labels — must match the website product card verbatim so
    // app + web orders read identically in Shopify.
    const CARD_DESIGN_NAMES = ["Linen", "Bloom", "Sage", "Confetti"];
    const CARD_STYLE_LABELS = { plain: "Plain", hand: "Handwritten", arcade: "Retro", ransom: "Ransom" };
    function buildShopifyLines() {
      const lines = [];
      const gift = (typeof window.__hugGiftState === "function") ? (window.__hugGiftState() || {}) : {};
      let wrappedUnits = 0, cardUnits = 0;
      for (let i = 0; i < cartQty.length; i++) {
        const gid = SHOPIFY_VARIANT_GIDS[i];
        if (!gid || cartQty[i] <= 0) continue;
        let plain = 0;
        for (let u = 1; u <= cartQty[i]; u++) {
          const s = gift[i + "_" + u];
          const wrapped = !!(s && s.wrap);
          const message = s && s.message ? String(s.message).trim() : "";
          // A "card" counts if it has a message, a composed image, a photo or stickers.
          const hasCard = !!(s && s.card && (message || (s.art && s.art.url) || s.photo || (s.stickers && s.stickers.length)));
          if (wrapped) wrappedUnits++;
          if (hasCard) cardUnits++;
          if (wrapped || hasCard) {
            const attributes = [];
            if (hasCard) {
              if (message) attributes.push({ key: "Card message", value: message });
              attributes.push({ key: "Card design", value: CARD_DESIGN_NAMES[(s && (s.design != null ? s.design : s.cardStyle)) || 0] || "Linen" });
              attributes.push({ key: "Card style", value: CARD_STYLE_LABELS[(s && s.font) || "plain"] || "Plain" });
              // The composed card artwork (photo + stickers + text), uploaded to card-art.
              if (s.art && s.art.url) {
                attributes.push({ key: "Card art", value: s.art.summary || "custom card" });
                attributes.push({ key: "_Card image", value: s.art.url });
                if (s.art.path) attributes.push({ key: "_Card art", value: s.art.path });
              }
            }
            if (wrapped) attributes.push({ key: "Gift wrap", value: "paper " + (((s && s.paper) || 0) + 1) });
            lines.push({ merchandiseId: gid, quantity: 1, attributes });
          } else {
            plain++;
          }
        }
        if (plain > 0) lines.push({ merchandiseId: gid, quantity: plain });
      }
      if (wrappedUnits > 0) lines.push({ merchandiseId: SHOPIFY_GIFTWRAP_GID, quantity: wrappedUnits });
      if (cardUnits > 0) lines.push({ merchandiseId: SHOPIFY_GIFTCARD_GID, quantity: cardUnits });
      return lines;
    }
    // The referrer's code, if the buyer was referred (typed in the checkout field
    // or captured from a deep link). Never the buyer's own code (no self-referral).
    function getCheckoutReferralCode() {
      const field = document.querySelector(".discount-field");
      const typed = field && field.value ? field.value.trim().toUpperCase() : "";
      let stored = "";
      try { stored = (localStorage.getItem("hug-incoming-ref-v1") || "").trim().toUpperCase(); } catch (e) {}
      const code = typed || stored;
      const own = String(referralCode || "").toUpperCase();
      return code && code !== own ? code : null;
    }
    // "apply" the referral code: validate it, then preview the friend's % off in the
    // total. (The code rides to Shopify at checkout regardless via the cart
    // attribute; this just gives in-app feedback that it took.) Returns a status.
    function applyReferralCode() {
      const field = document.querySelector(".discount-field");
      const typed = field && field.value ? field.value.trim().toUpperCase() : "";
      if (!typed) return "empty";
      if (typed === String(referralCode || "").toUpperCase()) return "own";   // no self-referral
      referralApplied = true;
      updateCart();
      return "applied";
    }
    // A minted code reported its real percent: the preview follows it (clamped to a sane range).
    window.addEventListener("hug:referral-rate", function (e) {
      const pct = Number(e && e.detail && e.detail.percent);
      if (!(pct > 0 && pct <= 50)) return;
      referralFriendRate = pct / 100;
      updateCart();
    });
    function resetReferralApplied() {
      referralFriendRate = REFERRAL_DISCOUNT_RATE_DEFAULT;
      if (!referralApplied) return;
      referralApplied = false;
      updateCart();
    }
    window.__hugApplyReferral = applyReferralCode;
    window.__hugResetReferral = resetReferralApplied;
    // The delivery address shown on the in-app checkout (auto-filled from the
    // profile, editable) — passed to Shopify so the hosted checkout is prefilled.
    function getCheckoutAddress() {
      function v(n){ var el = document.querySelector('.checkout-entry-field[name="' + n + '"]'); return el && el.value ? el.value.trim() : ""; }
      var name = v("name"), street = v("street-address"), city = v("city"), zip = v("postal-code");
      if (!street && !city && !zip) return null;
      var parts = name.split(/\s+/).filter(Boolean);
      return { firstName: parts.shift() || name, lastName: parts.join(" "), address1: street, city: city, zip: zip, country: "United Kingdom" };
    }
    // Copy the profile address into any EMPTY checkout fields (manual edits kept).
    function prefillCheckoutAddress() {
      var src = document.querySelector('.screen[data-screen="profile"] .addr-form');
      if (!src) return;
      document.querySelectorAll('.checkout-entry-field').forEach(function (input) {
        if (input.value && input.value.trim()) return;
        var nm = input.getAttribute('name');
        var from = nm && src.querySelector('[name="' + nm + '"]');
        if (from && from.value) {
          input.value = from.value;
          var row = input.closest('.checkout-entry-row');
          if (row) row.classList.add('has-value');
        }
      });
    }
    // Map a checkout-failure reason (from HugShop.createCheckout / buy) to copy
    // that tells the buyer what actually went wrong — distinguishing a network
    // drop, a not-yet-configured shop, and a store-side rejection (the kind that
    // currently bounces the hosted checkout). The precise stage is also in the
    // diagnostics log (HugDiag) so support can pinpoint app vs Shopify vs network.
    function checkoutFailureCopy(status) {
      switch (status) {
        case "network":
          return "You appear to be offline. Check your connection and try again.";
        case "shop-unconfigured":
        case "missing-variant":
          return "Checkout isn't available yet.";
        case "auth":
          return "Checkout is temporarily unavailable. Please try again shortly.";
        case "rejected":
        case "no-url":
        case "api-error":
        case "http":
        case "bad-response":
          return "Checkout couldn't open — this looks like a store setup issue, not your device. We're on it.";
        default:
          return "Couldn't start checkout — please try again.";
      }
    }
    async function startShopifyCheckout(trigger) {
      const lines = buildShopifyLines();
      if (!lines.length) { showToast("Your bag is empty."); return; }
      // Prototype mode: no order and no money. Say so on a note rather than a failure toast
      // (the blocked buy() used to read "Couldn't start checkout").
      if (isDemoMode()) {
        const usesBalance = !!(window.__hugShopCredit && document.getElementById("checkout-credit") && !document.getElementById("checkout-credit").hidden);
        showNote({ title: "Sample checkout", returnFocus: trigger,
          lines: ["This is the sample app, so no order was placed and no money moved.",
                  usesBalance ? "In the real app, your balance comes off the total and you pay the rest."
                              : "In the real app, this opens the secure checkout."] });
        return;
      }
      const shop = window.HugShop;
      if (!shop || !shop.configured) { showToast("Checkout isn't available yet."); return; }
      if (window.HugDiag) window.HugDiag.log("checkout:open", { lines: lines.length });
      const label = trigger ? trigger.textContent : "";
      if (trigger) { trigger.disabled = true; trigger.textContent = "opening…"; }
      try {
        // Shop credit: turn the balance into gift card(s) just before paying, and pay with them.
        // If that fails, ask once rather than silently charging the full price (or blocking).
        let giftCardCodes = [];
        const credit = window.__hugShopCredit;
        if (credit && credit.wantsToSpend()) {
          const prep = await credit.prepare();
          if (prep.ok) giftCardCodes = prep.codes;
          else if (!(await showConfirm({ title: 'Your balance', body: "We couldn't add your balance. Pay without it?", confirm: 'Pay without it', cancel: 'Cancel' }))) return;
        }
        const res = await shop.buy({ lines, referralCode: getCheckoutReferralCode(), address: getCheckoutAddress(), giftCardCodes });
        if (!res || !res.ok) {
          const status = (res && res.status) || "failed";
          if (window.HugDiag) window.HugDiag.log("checkout:ui-fail", { status });
          showToast(checkoutFailureCopy(status));
        } else if (res.status === "completed") {
          if (window.HugDiag) window.HugDiag.log("checkout:completed", {});
          showToast("Order placed — thank you!");
        }
        // "cancelled" (user closed the sheet) and "presented"/browser (checkout is
        // open) need no toast.
      } catch (e) {
        if (window.HugDiag) window.HugDiag.err("checkout", e);
        showToast("Couldn't start checkout — please try again.");
      } finally {
        if (trigger) { trigger.disabled = false; trigger.textContent = label || "checkout"; }
      }
    }
    document.querySelector(".pay-button")?.addEventListener("click", function () { startShopifyCheckout(this); });

    let bagCarouselIndex = Math.max(0, bagCarouselSlides.findIndex(slide => slide.classList.contains("is-visible")));
    if (bagCarouselIndex < 0) bagCarouselIndex = 0;
    let bagCarouselDragX = 0;
    let bagCarouselReleaseTimer = 0;
    let bagCarouselFrame = 0;
    let bagCarouselTransitionIndex = null;
    let bagCarouselTransitionStep = 0;
    let bagCarouselGestureActive = false;
    let bagCarouselGestureAxis = null;
    let bagCarouselGestureDragged = false;
    let bagCarouselGesturePointerId = null;
    let bagCarouselGestureTouchId = null;
    let bagCarouselGestureStartX = 0;
    let bagCarouselGestureStartY = 0;
    let bagCarouselGestureLastX = 0;
    let bagCarouselGestureStartTime = 0;
    let bagCarouselReleaseListenersBound = false;
    let bagArrowPressLockUntil = 0;

    function stopBagCarouselRelease() {
      if (bagCarouselReleaseTimer) {
        clearTimeout(bagCarouselReleaseTimer);
        bagCarouselReleaseTimer = 0;
      }
      if (bagCarouselFrame) {
        cancelAnimationFrame(bagCarouselFrame);
        bagCarouselFrame = 0;
      }
      bagCarouselTransitionIndex = null;
      bagCarouselTransitionStep = 0;
    }

    function finishBagCarouselGesture() {
      bagCarouselGestureActive = false;
      bagCarouselGestureAxis = null;
      bagCarouselGestureDragged = false;
      bagCarouselGesturePointerId = null;
      bagCarouselGestureTouchId = null;
      if (!bagCarouselReleaseListenersBound) return;
      document.removeEventListener("pointerup", handleBagCarouselGlobalPointerRelease, true);
      document.removeEventListener("pointercancel", handleBagCarouselGlobalPointerRelease, true);
      document.removeEventListener("lostpointercapture", handleBagCarouselGlobalPointerRelease, true);
      document.removeEventListener("mouseup", handleBagCarouselGlobalPointerRelease, true);
      document.removeEventListener("touchend", handleBagCarouselGlobalTouchRelease, true);
      document.removeEventListener("touchcancel", handleBagCarouselGlobalTouchRelease, true);
      document.removeEventListener("visibilitychange", handleBagCarouselVisibilityRelease, true);
      window.removeEventListener("pointerup", handleBagCarouselGlobalPointerRelease, true);
      window.removeEventListener("pointercancel", handleBagCarouselGlobalPointerRelease, true);
      window.removeEventListener("lostpointercapture", handleBagCarouselGlobalPointerRelease, true);
      window.removeEventListener("mouseup", handleBagCarouselGlobalPointerRelease, true);
      window.removeEventListener("touchend", handleBagCarouselGlobalTouchRelease, true);
      window.removeEventListener("touchcancel", handleBagCarouselGlobalTouchRelease, true);
      window.removeEventListener("blur", handleBagCarouselBlurRelease, true);
      bagCarouselReleaseListenersBound = false;
    }

    function handleBagCarouselBlurRelease() {
      if (!bagCarouselGestureActive) return;
      stopBagCarouselRelease();
      bagCarouselDragX = 0;
      bagCarouselRender();
      finishBagCarouselGesture();
    }

    function handleBagCarouselVisibilityRelease() {
      if (!bagCarouselGestureActive) return;
      if (!document.hidden) return;
      stopBagCarouselRelease();
      bagCarouselDragX = 0;
      bagCarouselRender();
      finishBagCarouselGesture();
    }

    function handleBagCarouselGlobalPointerRelease(event) {
      if (!bagCarouselGestureActive) return;
      const pointerId = typeof event.pointerId === "number" ? event.pointerId : null;
      if (bagCarouselGesturePointerId !== null && pointerId !== null && pointerId !== bagCarouselGesturePointerId) return;
      endBagCarouselGesture(event.clientX ?? bagCarouselGestureLastX, event.clientY ?? bagCarouselGestureStartY);
    }

    function handleBagCarouselGlobalTouchRelease(event) {
      if (!bagCarouselGestureActive) return;
      const touches = Array.from(event.changedTouches || []);
      if (bagCarouselGestureTouchId !== null && !touches.some(t => t.identifier === bagCarouselGestureTouchId)) return;
      const touch = touches.find(t => t.identifier === bagCarouselGestureTouchId) || touches[0];
      if (!touch) return;
      endBagCarouselGesture(touch.clientX, touch.clientY);
    }

    function bindBagCarouselReleaseListeners() {
      if (bagCarouselReleaseListenersBound) return;
      document.addEventListener("pointerup", handleBagCarouselGlobalPointerRelease, true);
      document.addEventListener("pointercancel", handleBagCarouselGlobalPointerRelease, true);
      document.addEventListener("lostpointercapture", handleBagCarouselGlobalPointerRelease, true);
      document.addEventListener("mouseup", handleBagCarouselGlobalPointerRelease, true);
      document.addEventListener("touchend", handleBagCarouselGlobalTouchRelease, true);
      document.addEventListener("touchcancel", handleBagCarouselGlobalTouchRelease, true);
      document.addEventListener("visibilitychange", handleBagCarouselVisibilityRelease, true);
      window.addEventListener("pointerup", handleBagCarouselGlobalPointerRelease, true);
      window.addEventListener("pointercancel", handleBagCarouselGlobalPointerRelease, true);
      window.addEventListener("lostpointercapture", handleBagCarouselGlobalPointerRelease, true);
      window.addEventListener("mouseup", handleBagCarouselGlobalPointerRelease, true);
      window.addEventListener("touchend", handleBagCarouselGlobalTouchRelease, true);
      window.addEventListener("touchcancel", handleBagCarouselGlobalTouchRelease, true);
      window.addEventListener("blur", handleBagCarouselBlurRelease, true);
      bagCarouselReleaseListenersBound = true;
    }

    function bagCarouselRender() {
      if (!bagCarousel || !bagCarouselSlides.length) return;
      const isExiting = phone.classList.contains("bag-closing");
      const renderMs = isExiting ? BAG_EXIT_MS : BAG_CAROUSEL_RENDER_MS;
      const width = bagCarousel.clientWidth || 300;
      const dragProgress = Math.min(1, Math.abs(bagCarouselDragX) / width);
      const easedProgress = dragProgress * dragProgress * (3 - (2 * dragProgress));
      const isDragging = bagCarouselGestureActive;
      const isSettling = !isDragging && bagCarouselReleaseTimer !== 0;
      const isTransitioning = bagCarouselDragX !== 0;
      const transitionMs = isDragging ? 0 : (isSettling ? renderMs : 0);
      const leavingOpacity = isExiting ? 0 : Math.max(.12, 1 - (easedProgress * .88));
      const enteringOpacity = isExiting ? 0 : Math.max(0, Math.min(1, .08 + (easedProgress * .92)));
      const step = bagCarouselTransitionStep || (bagCarouselDragX < 0 ? -1 : 1);
      const nextIndex = bagCarouselTransitionIndex !== null
        ? bagCarouselTransitionIndex
        : (bagCarouselIndex - step + bagCarouselSlides.length) % bagCarouselSlides.length;
      if (bagVariantLabel) {
        const labelIndex = isTransitioning && (isSettling || dragProgress > .08) ? nextIndex : bagCarouselIndex;
        bagVariantLabel.textContent = bagVariantNames[labelIndex] || "";
        if (qtyNumber) qtyNumber.textContent = String(cartQty[labelIndex] || 0);
      }
      bagCarouselSlides.forEach((slide, index) => {
        const isActive = index === bagCarouselIndex;
        const isNext = index === nextIndex;
        slide.classList.toggle("is-visible", isActive || (isNext && isTransitioning));
        slide.classList.toggle("is-hidden", !isActive && !(isNext && isTransitioning));
        slide.style.transition = transitionMs
          ? `transform ${transitionMs}ms cubic-bezier(.18, .88, .12, 1), opacity ${transitionMs}ms cubic-bezier(.18, .88, .12, 1)`
          : "none";
        if (isActive) {
          slide.style.opacity = String(isTransitioning ? leavingOpacity : 1);
          slide.style.transform = `translate3d(calc(${bagCarouselDragX}px + var(--bag-render-shift-x, 0px)), var(--bag-render-shift-y, 0px), 0) scale(var(--bag-render-scale, 1))`;
          return;
        }
        if (isNext && isTransitioning) {
          const x = step < 0 ? width + bagCarouselDragX : -width + bagCarouselDragX;
          slide.style.opacity = String(enteringOpacity);
          slide.style.transform = `translate3d(calc(${x}px + var(--bag-render-shift-x, 0px)), var(--bag-render-shift-y, 0px), 0) scale(var(--bag-render-scale, 1))`;
          return;
        }
        slide.style.opacity = "0";
        slide.style.transform = `translate3d(calc(${step < 0 ? width : -width}px + var(--bag-render-shift-x, 0px)), var(--bag-render-shift-y, 0px), 0) scale(var(--bag-render-scale, 1))`;
      });
    }

    function bagCarouselCommit(direction) {
      if (!bagCarousel || !bagCarouselSlides.length) return false;
      if (bagCarouselReleaseTimer || bagCarouselFrame) return false;
      const width = bagCarousel.clientWidth || 300;
      const step = direction < 0 ? -1 : 1;
      const nextIndex = (bagCarouselIndex - step + bagCarouselSlides.length) % bagCarouselSlides.length;
      const startingDragX = bagCarouselDragX;
      stopBagCarouselRelease();
      bagCarouselTransitionIndex = nextIndex;
      bagCarouselTransitionStep = step;
      bagCarouselDragX = startingDragX;
      bagCarouselReleaseTimer = window.setTimeout(() => {
        bagCarouselIndex = nextIndex;
        bagCarouselDragX = 0;
        bagCarouselReleaseTimer = 0;
        bagCarouselTransitionIndex = null;
        bagCarouselTransitionStep = 0;
        bagCarouselRender();
      }, BAG_CAROUSEL_RENDER_MS);
      bagCarouselRender();
      bagCarouselFrame = requestAnimationFrame(() => {
        bagCarouselFrame = 0;
        bagCarouselDragX = step < 0 ? -width : width;
        bagCarouselRender();
      });
      return true;
    }

    function bagCarouselStep(direction) {
      return bagCarouselCommit(direction);
    }

    function resetBagCarousel() {
      stopBagCarouselRelease();
      bagCarouselDragX = 0;
      bagCarouselRender();
    }

    bagCarousel?.querySelectorAll(".product-arrow-button[data-bag-step]").forEach(button => {
      const triggerStep = event => {
        event.stopPropagation();
        event.preventDefault();
        const now = Date.now();
        if (now < bagArrowPressLockUntil) return;
        const direction = Number(button.dataset.bagStep || 0);
        if (!direction) return;
        if (bagCarouselCommit(direction)) {
          bagArrowPressLockUntil = now + 220;
        }
      };
      button.addEventListener("pointerup", event => {
        if (!prefersPointerInput) return;
        triggerStep(event);
      });
      button.addEventListener("touchend", event => {
        if (prefersPointerInput) return;
        triggerStep(event);
      }, { passive: false });
      button.addEventListener("click", event => {
        if (event.detail !== 0) return;
        triggerStep(event);
      });
    });
    bagCarouselRender();

    function startBagCarouselGesture(x, y, pointerId = null, touchId = null, event = null) {
      if (!bagCarousel || !bagCarouselSlides.length) return;
      if (bagCarouselReleaseTimer) return;
      stopBagCarouselRelease();
      bagCarouselGestureActive = true;
      bagCarouselGestureAxis = null;
      bagCarouselGestureDragged = false;
      bagCarouselGesturePointerId = pointerId;
      bagCarouselGestureTouchId = touchId;
      bagCarouselGestureStartX = x;
      bagCarouselGestureStartY = y;
      bagCarouselGestureLastX = x;
      bagCarouselGestureStartTime = performance.now();
      bagCarouselDragX = 0;
      bagCarouselRender();
      bindBagCarouselReleaseListeners();
      event?.stopPropagation?.();
      event?.preventDefault?.();
    }

    function moveBagCarouselGesture(x, y, event = null) {
      if (!bagCarouselGestureActive) return;
      const s = currentFitScale();
      const dx = (x - bagCarouselGestureStartX) / s;
      const dy = (y - bagCarouselGestureStartY) / s;
      bagCarouselGestureLastX = x;
      if (!bagCarouselGestureAxis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax > ay * 1.15) {
          bagCarouselGestureAxis = "x";
        } else if (ay > ax * 1.05) {
          bagCarouselGestureAxis = "y";
        }
      }
      if (bagCarouselGestureAxis !== "x") {
        event?.preventDefault?.();
        return;
      }
      bagCarouselGestureDragged = true;
      bagCarouselDragX = dx * 0.9;
      bagCarouselRender();
      event?.stopPropagation?.();
      event?.preventDefault?.();
    }

    function endBagCarouselGesture(x, y, event = null) {
      if (!bagCarouselGestureActive) return;
      const dx = (x - bagCarouselGestureStartX) / currentFitScale();
      const elapsed = Math.max(1, performance.now() - bagCarouselGestureStartTime);
      const speed = Math.abs(dx) / elapsed;
      const width = bagCarousel?.clientWidth || 300;
      const threshold = Math.max(42, width * 0.16);
      const wasDragged = bagCarouselGestureDragged || Math.abs(dx) > 8;
      const wasHorizontal = bagCarouselGestureAxis === "x";
      finishBagCarouselGesture();
      if (!wasDragged) {
        onNavAction("home", { trigger: "tap" });
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
      if (!wasHorizontal) {
        bagCarouselDragX = 0;
        bagCarouselRender();
        event?.preventDefault?.();
        event?.stopPropagation?.();
        return;
      }
      const direction = dx < 0 ? -1 : 1;
      if (Math.abs(dx) >= threshold || speed > 0.45) {
        bagCarouselCommit(direction);
      } else {
        bagCarouselDragX = 0;
        bagCarouselRender();
      }
      event?.preventDefault?.();
      event?.stopPropagation?.();
    }

    if (bagCarouselStage) {
      bagCarouselStage.addEventListener("pointerdown", event => {
        if ((phone.dataset.current || "home") !== "bag") return;
        if (event.button !== 0) return;
        if (event.target?.closest?.(".product-arrow-button")) return;
        startBagCarouselGesture(event.clientX, event.clientY, event.pointerId, null, event);
        try {
          bagCarouselStage?.setPointerCapture?.(event.pointerId);
        } catch {}
      });
      bagCarouselStage.addEventListener("pointermove", event => {
        if (!bagCarouselGestureActive) return;
        if (bagCarouselGesturePointerId !== null && event.pointerId !== bagCarouselGesturePointerId) return;
        moveBagCarouselGesture(event.clientX, event.clientY, event);
      });
      bagCarouselStage.addEventListener("pointerup", event => {
        if (!bagCarouselGestureActive) return;
        if (bagCarouselGesturePointerId !== null && event.pointerId !== bagCarouselGesturePointerId) return;
        endBagCarouselGesture(event.clientX, event.clientY, event);
        try {
          bagCarouselStage?.releasePointerCapture?.(event.pointerId);
        } catch {}
      });
      bagCarouselStage.addEventListener("pointercancel", event => {
        if (!bagCarouselGestureActive) return;
        if (bagCarouselGesturePointerId !== null && event.pointerId !== bagCarouselGesturePointerId) return;
        bagCarouselDragX = 0;
        bagCarouselRender();
        finishBagCarouselGesture();
      });
      bagCarouselStage.addEventListener("touchstart", event => {
        if (prefersPointerInput) return;
        if ((phone.dataset.current || "home") !== "bag") return;
        const t = event.changedTouches?.[0];
        if (!t) return;
        if (event.target?.closest?.(".product-arrow-button")) return;
        startBagCarouselGesture(t.clientX, t.clientY, null, t.identifier, event);
      }, { passive: false });
      bagCarouselStage.addEventListener("touchmove", event => {
        if (prefersPointerInput) return;
        if (!bagCarouselGestureActive) return;
        const touches = Array.from(event.changedTouches || []);
        const touch = bagCarouselGestureTouchId !== null
          ? touches.find(t => t.identifier === bagCarouselGestureTouchId)
          : touches[0];
        if (!touch) return;
        moveBagCarouselGesture(touch.clientX, touch.clientY, event);
      }, { passive: false });
      bagCarouselStage.addEventListener("touchend", event => {
        if (prefersPointerInput) return;
        if (!bagCarouselGestureActive) return;
        const touches = Array.from(event.changedTouches || []);
        const touch = bagCarouselGestureTouchId !== null
          ? touches.find(t => t.identifier === bagCarouselGestureTouchId)
          : touches[0];
        if (!touch) return;
        endBagCarouselGesture(touch.clientX, touch.clientY, event);
      }, { passive: false });
      bagCarouselStage.addEventListener("touchcancel", event => {
        if (prefersPointerInput) return;
        if (!bagCarouselGestureActive) return;
        const touches = Array.from(event.changedTouches || []);
        const touch = bagCarouselGestureTouchId !== null
          ? touches.find(t => t.identifier === bagCarouselGestureTouchId)
          : touches[0];
        if (!touch) return;
        bagCarouselDragX = 0;
        bagCarouselRender();
        finishBagCarouselGesture();
      }, { passive: false });
    }

    function incrementCart(event) {
      const now = Date.now();
      if (now - lastQtyActionAt < 120) return;
      lastQtyActionAt = now;
      if (event) {
        event.stopPropagation();
        event.preventDefault?.();
      }
      cartQty[bagCarouselIndex] += 1;
      updateCart();
    }

    function decrementCart(event) {
      const now = Date.now();
      if (now - lastQtyActionAt < 120) return;
      lastQtyActionAt = now;
      if (event) {
        event.stopPropagation();
        event.preventDefault?.();
      }
      cartQty[bagCarouselIndex] = Math.max(0, cartQty[bagCarouselIndex] - 1);
      updateCart();
    }

    function goCheckout(event) {
      if (event) {
        event.stopPropagation();
      }
      onNavAction("checkout", { trigger: "tap" });
    }

    function stepCheckoutItem(button, event) {
      const now = Date.now();
      if (now - lastQtyActionAt < 120) return;
      lastQtyActionAt = now;
      if (event) {
        event.stopPropagation();
        event.preventDefault?.();
      }
      const idx = Number(button.dataset.variantIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cartQty.length) return;
      if (button.dataset.checkoutStep === "up") cartQty[idx] += 1;
      else cartQty[idx] = Math.max(0, cartQty[idx] - 1);
      updateCart();
    }

    phone.addEventListener("click", event => {
      const plusHit = event.target.closest?.("#qty-plus");
      const minusHit = event.target.closest?.("#qty-minus");
      const checkoutHit = event.target.closest?.(".checkout-button");
      const stepHit = event.target.closest?.(".checkout-step");
      if (!plusHit && !minusHit && !checkoutHit && !stepHit) return;
      if (plusHit) incrementCart(event);
      if (minusHit) decrementCart(event);
      if (checkoutHit) goCheckout(event);
      if (stepHit) stepCheckoutItem(stepHit, event);
    });

    function resolveActiveSettingsRow(target) {
      const row = target?.closest?.(".simple-row[data-go]");
      if (!row) return null;
      const screen = row.closest(".screen");
      if (!screen) return null;
      if (screen.dataset.screen !== "settings") return null;
      if (!screen.classList.contains("active")) return null;
      return row;
    }

    window.__hugNav = onNavAction;   // let other features (e.g. post-login) navigate
    function settingsRowAtPoint(x, y) {
      if ((phone.dataset.current || "home") !== "settings") return null;
      const rows = document.querySelectorAll(".screen[data-screen='settings'].active .simple-row[data-go]");
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return row;
      }
      return null;
    }
    function settingsRowFrom(event) {
      return resolveActiveSettingsRow(event.target) || settingsRowAtPoint(event.clientX ?? 0, event.clientY ?? 0);
    }

    // Settings rows activate on a deliberate TAP — pointer down AND up with little
    // movement — never on pointerdown alone. A light brush or the start of a scroll
    // must not navigate. If the finger moves past a small slop threshold it's a
    // scroll, and the candidate tap is cancelled.
    const SETTINGS_TAP_MOVE = 12;   // px of travel past which it's a scroll, not a tap
    const SETTINGS_TAP_TIME = 800;  // ms; a slower press isn't a tap
    let settingsTapCand = null;
    let settingsNavAt = 0;
    const tapMoved = (e, c) => Math.abs((e.clientX ?? 0) - c.x) > SETTINGS_TAP_MOVE || Math.abs((e.clientY ?? 0) - c.y) > SETTINGS_TAP_MOVE;

    phone.addEventListener("pointerdown", event => {
      const row = settingsRowFrom(event);
      settingsTapCand = row ? { row, x: event.clientX, y: event.clientY, t: Date.now() } : null;
    }, true);
    phone.addEventListener("pointermove", event => {
      if (settingsTapCand && tapMoved(event, settingsTapCand)) settingsTapCand = null;
    }, true);
    phone.addEventListener("pointerup", event => {
      const cand = settingsTapCand;
      settingsTapCand = null;
      if (!cand) return;
      if (Date.now() - cand.t > SETTINGS_TAP_TIME) return;       // too slow → not a tap
      if (tapMoved(event, cand)) return;                          // moved → it was a scroll
      if (settingsRowFrom(event) !== cand.row) return;            // lifted off the row
      event.stopPropagation();
      settingsNavAt = Date.now();
      onNavAction(cand.row.dataset.go);
    }, true);
    phone.addEventListener("pointercancel", () => { settingsTapCand = null; }, true);

    // Fallback (non-pointer environments / safety net). Native click already
    // discriminates tap vs scroll; suppress it briefly after a pointer tap so the
    // synthesized click can't double-fire the navigation.
    phone.addEventListener("click", event => {
      if (Date.now() - settingsNavAt < SETTINGS_TAP_TIME) return;
      const settingsRow = settingsRowFrom(event);
      if (!settingsRow) return;
      event.stopPropagation();
      onNavAction(settingsRow.dataset.go);
    }, true);

    function hitRect(node, x, y) {
      if (!node) return false;
      const r = node.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function shopControlsFallbackActivate(x, y, sourceEvent) {
      if ((phone.dataset.current || "home") !== "bag") return false;
      if (hitRect(qtyPlus, x, y)) {
        incrementCart(sourceEvent);
        return true;
      }
      if (hitRect(qtyMinus, x, y)) {
        decrementCart(sourceEvent);
        return true;
      }
      const checkoutBtn = document.querySelector(".screen[data-screen='bag'].active .checkout-button");
      if (hitRect(checkoutBtn, x, y)) {
        goCheckout(sourceEvent);
        return true;
      }
      return false;
    }

    phone.addEventListener("pointerdown", event => {
      if (shopControlsFallbackActivate(event.clientX, event.clientY, event)) return;
    }, true);

    phone.addEventListener("touchstart", event => {
      if (prefersPointerInput) return;
      const t = event.changedTouches?.[0];
      if (!t) return;
      if (shopControlsFallbackActivate(t.clientX, t.clientY, event)) {
        event.preventDefault();
      }
    }, { capture: true, passive: false });

    function tapToHomeFromQr(event) {
      const current = phone.dataset.current || "home";
      if (current !== "qr") return;
      if (Date.now() < suppressTapUntil) return;
      if (lastDragDistance > 12) {
        lastDragDistance = 0;
        return;
      }
      const target = event.target;
      const navButton = target?.closest?.("[data-go]");
      if (navButton) return;
      // The guest/locked nudge ("set up account" / "link a product") is its own
      // control — let its tap through instead of navigating home (same exemption
      // pattern as the scan/bag/account tap-to-home handlers below).
      if (target?.closest?.(".qr-nudge")) return;
      event.stopPropagation?.();
      onNavAction("home", { trigger: "tap" });
    }

    function tapToHomeFromScan(event) {
      const current = phone.dataset.current || "home";
      if (current !== "scan") return;
      if (Date.now() < suppressTapUntil) return;
      if (lastDragDistance > 12) {
        lastDragDistance = 0;
        return;
      }
      const target = event.target;
      const navButton = target?.closest?.("[data-go]");
      if (navButton) return;
      if (target?.closest?.(".scan-candidate, .scan-status, .scan-restart, .scan-result, .scan-account-sheet")) return;
      event.stopPropagation?.();
      quickFadeTo("home");
    }

    function tapToHomeFromBag(event) {
      const current = phone.dataset.current || "home";
      if (current !== "bag") return;
      if (Date.now() < suppressTapUntil) return;
      if (lastDragDistance > 12) {
        lastDragDistance = 0;
        return;
      }
      const target = event.target;
      const navButton = target?.closest?.("[data-go]");
      if (navButton) return;
      if (target?.closest?.(".product-carousel")) return;
      if (target?.closest?.(".shop-actions, #qty-plus, #qty-minus, .checkout-button, .product-arrow-button")) return;
      event.stopPropagation?.();
      onNavAction("home", { trigger: "tap" });
    }

    function tapToHomeFromAccountUpper(event) {
      const current = phone.dataset.current || "home";
      if (current !== "account") return;
      if (Date.now() < suppressTapUntil) return;
      if (lastDragDistance > 12) {
        lastDragDistance = 0;
        return;
      }
      const target = event.target;
      const navButton = target?.closest?.("[data-go]");
      if (navButton) return;
      // The deposited card is its own cash-out control — let its click through
      // instead of treating the tap as a navigate-away gesture.
      if (target?.closest?.(".history-wrap, .txn-detail, .simple-row.wide.approved")) return;
      // So is the pending card: it opens its note (pendingNote).
      if (target?.closest?.(".simple-row.wide.pending")) return;
      const inAccountContent = target?.closest?.(".screen[data-screen='account'].active .content");
      if (!inAccountContent) return;
      event.stopPropagation?.();
      onNavAction("account", { trigger: "tap" });
    }

    phone.addEventListener("click", tapToHomeFromQr, true);
    phone.addEventListener("touchend", tapToHomeFromQr, { capture: true, passive: true });
    phone.addEventListener("click", tapToHomeFromScan, true);
    phone.addEventListener("touchend", tapToHomeFromScan, { capture: true, passive: true });
    phone.addEventListener("click", tapToHomeFromBag, true);
    phone.addEventListener("touchend", tapToHomeFromBag, { capture: true, passive: true });
    phone.addEventListener("click", tapToHomeFromAccountUpper, true);
    phone.addEventListener("touchend", tapToHomeFromAccountUpper, { capture: true, passive: true });

    function canGestureFromPoint(x, y, target) {
      if (swipeAnimating) return false;
      const current = phone.dataset.current || "home";
      if (!screenOrder.includes(current)) return false;
      if (current === "bag" && target?.closest?.(".product-carousel")) return false;
      if (target && target.closest?.("button, a, input, textarea, select, label")) return false;
      if (current === "home" && target?.closest?.(".leader-wrap, .leader-list, .leader-row")) return false;
      // The impact row is a carousel of its own: a drag there moves the row, never the page.
      if (current === "home" && target?.closest?.("[data-impact-row]")) return false;
      // Treat the swipe area as the whole phone viewport (not only content),
      // so horizontal carousel gestures can begin nearly anywhere.
      const rect = phone.getBoundingClientRect();
      if (!(x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) return false;
      return true;
    }

    function gestureStart(x, y, target = null) {
      if (swipeAnimating) return;
      pointerActive = true;
      markGestureSample();
      ensureGestureWatchdog();
      startX = x;
      startY = y;
      gestureOriginInLeader = !!target?.closest?.(".leader-wrap, .leader-list, .leader-row");
      lastDragDistance = 0;
      gestureAxis = null;
      dragDirection = 0;
      suppressTapUntil = Date.now() + 180;
      const active = activeScreen();
      if (active) {
        active.style.setProperty("--pull-y", "0px");
        active.style.setProperty("--pull-x", "0px");
      }
      window.getSelection?.().removeAllRanges?.();
    }

    function gestureMove(x, y) {
      if (!pointerActive) return;
      markGestureSample();
      window.getSelection?.().removeAllRanges?.();
      const s = currentFitScale();
      const dx = (x - startX) / s;
      const dy = (y - startY) / s;
      lastDragDistance = Math.hypot(dx, dy);
      if (!gestureAxis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        if (ax > ay * 1.25) {
          gestureAxis = "x";
        } else if (ay > ax * 1.15) {
          gestureAxis = "y";
        }
      }
      if (gestureAxis === "y") {
        const active = activeScreen();
        if (active) active.style.setProperty("--content-x", "0px");
        if (dragTargetScreen) {
          dragTargetScreen.classList.remove("drag-peek");
          dragTargetScreen.style.setProperty("--content-x", "0px");
          dragTargetScreen.style.setProperty("--screen-x", "0px");
          dragTargetScreen = null;
        }
        dragDirection = 0;
        phone.classList.remove("is-pulling-x");
        applyPull(dx, dy);
      }
      if (gestureAxis === "x") {
        const active = activeScreen();
        if (active) {
          active.style.setProperty("--pull-y", "0px");
          active.style.setProperty("--pull-x", "0px");
        }
        pullScreen = active;
        phone.classList.remove("is-pulling");
        applyPullX(dx, dy);
      }
    }

    function animateHorizontalSwipe(dx, dy = 0, options = {}) {
      const fromLeader = !!options.fromLeader;
      const swipeNext = getSwipeTarget(dx, dy);
      if (!swipeNext) return false;
      const screen = activeScreen();
      if (!screen || !screen.classList.contains("rubber-ready")) return false;

      swipeAnimating = true;
      const width = phone.clientWidth || 393;
      const target = dragTargetScreen || screens.find(s => s.dataset.screen === swipeNext.target);
      phone.classList.remove("is-pulling-x");
      screen.style.setProperty("--content-x", `${swipeNext.direction * width * 1.02}px`);
      if (target) {
        target.classList.add("drag-peek");
        target.style.setProperty("--content-x", "0px");
      }

      suppressTapUntil = Date.now() + 320;
      lastSwipeAt = Date.now();
      setTimeout(() => {
        showScreen(swipeNext.target);
        swipeAnimating = false;
      }, 120);
      lastDragDistance = Math.max(lastDragDistance, 18);

      if (!fromLeader) {
        pointerActive = false;
        pointerGestureId = null;
        clearGestureWatchdog();
        gestureAxis = null;
        pullScreen = null;
      }
      dragTargetScreen = null;
      dragDirection = 0;
      return true;
    }

    function gestureEnd(x, y) {
      if (!pointerActive) return;
      markGestureSample();
      const s = currentFitScale();
      const dx = (x - startX) / s;
      const dy = (y - startY) / s;
      const current = phone.dataset.current || "home";
      window.__swipeDebug.push({ phase: "end", dx, dy, current: phone.dataset.current || "home" });
      if (gestureAxis === "y") {
        resetGesture({ instant: true });
        return;
      }
      if (
        current === "bag" &&
        dy < -78 &&
        Math.abs(dy) > Math.abs(dx) * 1.25
      ) {
        onNavAction("home", { trigger: "swipe" });
        lastDragDistance = Math.max(lastDragDistance, 18);
        resetGesture({ instant: true });
        return;
      }
      if (animateHorizontalSwipe(dx, dy)) {
        return;
      }
      resetGesture({ instant: true });
    }

    function clampNumber(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    // Memoised on the layout state it actually depends on.
    //
    // This measures where the nav sits and sizes the scroll windows to fit above it. Both are
    // functions of the VIEWPORT and of whether the leader/history panel is open — nothing else.
    // But syncHistoryFade() and syncLeaderFade() each call it first, and both are bound to the
    // lists' `scroll` events, so it ran on every scroll frame: two getComputedStyle() calls
    // followed by read-read-write-write over layout geometry, twice over. That is a forced
    // synchronous layout per scroll event, for an answer that had not changed.
    //
    // The signature is the same trick syncScrollWindowsOnViewportChange already uses a few
    // hundred lines below; this just applies it at the source instead of at one call site, so
    // every caller becomes cheap rather than each one having to remember. The open-state flags
    // are in the signature because the body below branches on them, so a panel opening or
    // closing must still re-fit. querySelector does not force layout, so building the signature
    // costs nothing measurable.
    let scrollWindowFitSignature = "";
    function syncResponsiveScrollWindows(force) {
      const signature = [
        window.innerWidth,
        window.innerHeight,
        screen.orientation?.type || window.orientation || "",
        document.querySelector('.screen[data-screen="home"] .home-content.leader-open') ? 1 : 0,
        document.querySelector('.screen[data-screen="account"] .account-content.history-open') ? 1 : 0
      ].join(":");
      if (!force && signature === scrollWindowFitSignature) return;
      scrollWindowFitSignature = signature;
      const bottomFeather = parseFloat(getComputedStyle(phone).getPropertyValue("--bottom-feather-h")) || 30;
      const scrollGap = parseFloat(getComputedStyle(phone).getPropertyValue("--scroll-window-gap")) || 10;
      const layoutTopWithin = (element, ancestor) => {
        let top = 0;
        let node = element;
        while (node && node !== ancestor) {
          top += node.offsetTop || 0;
          node = node.offsetParent;
        }
        if (node === ancestor) return top;
        const elementRect = element.getBoundingClientRect();
        const ancestorRect = ancestor.getBoundingClientRect();
        return elementRect.top - ancestorRect.top;
      };
      const fitWindowAboveNav = (screenName, wrapSelector, heightVar, padVar, designHeight, minHeight, options = {}) => {
        const screen = document.querySelector(`.screen[data-screen='${screenName}']`);
        const wrap = screen?.querySelector(wrapSelector);
        const nav = screen?.querySelector(".bottom-nav");
        if (!screen || !wrap || !nav) return;
        const bottomClearance = options.bottomClearance ?? (bottomFeather + scrollGap);
        const padValue = options.bottomPad ?? Math.max(24, Math.ceil(bottomFeather * .55 + scrollGap));
        const visibleBottom = layoutTopWithin(nav, screen) - bottomClearance;
        const available = visibleBottom - layoutTopWithin(wrap, screen);
        const nextHeight = clampNumber(Math.floor(available), minHeight, designHeight);
        wrap.style.setProperty(heightVar, `${nextHeight}px`);
        wrap.style.setProperty(padVar, `${padValue}px`);
      };

      // Let the leaderboard / history window grow to fill the space above the nav on
      // every device, so tall phones land flush like the shorter ones instead of
      // leaving a dead gap at the bottom. (Was capped at 340 on phones, which left a
      // ~78px empty band on tall devices — iPhone 12/13 mini, 14 Plus/13 Pro Max,
      // 15 Pro Max/16 Plus, 16 Pro Max, Galaxy Z Flip/Fold, Pixel 7/8.)
      const leaderMaxHeight = 900;
      if (!document.querySelector('.screen[data-screen="home"] .home-content.leader-open')) {
      fitWindowAboveNav("home", ".leader-wrap", "--leader-window-height", "--leader-list-bottom-pad", leaderMaxHeight, 132, {
        bottomClearance: Math.max(6, Math.ceil(bottomFeather * .22 + 2)),
        bottomPad: Math.max(16, Math.ceil(bottomFeather * .35))
      });
      }
      if (!document.querySelector('.screen[data-screen="account"] .account-content.history-open')) {
      fitWindowAboveNav("account", ".history-wrap", "--history-window-height", "--history-list-bottom-pad", leaderMaxHeight, 132, {
        bottomClearance: Math.max(6, Math.ceil(bottomFeather * .22 + 2)),
        bottomPad: Math.max(16, Math.ceil(bottomFeather * .35))
      });
      }
    }

    function syncHistoryFade() {
      syncResponsiveScrollWindows();
      document.querySelectorAll(".history-wrap").forEach(wrap => {
        const list = wrap.querySelector(".history-list");
        if (!list) return;
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        const top = list.scrollTop;
        const atBottom = top >= max - 1;
        wrap.classList.toggle("at-top", top <= 1);
        wrap.classList.toggle("at-bottom", atBottom);
        // Mirror onto the stable parent that paints the bottom feather, so the
        // feather can retire once there is nothing left below to fade.
        wrap.closest(".account-content")?.classList.toggle("list-at-bottom", atBottom);
      });
    }

    function syncLeaderFade() {
      syncResponsiveScrollWindows();
      document.querySelectorAll(".leader-wrap").forEach(wrap => {
        const list = wrap.querySelector(".leader-list");
        if (!list) return;
        const max = Math.max(0, list.scrollHeight - list.clientHeight);
        const top = list.scrollTop;
        const atBottom = top >= max - 1;
        wrap.classList.toggle("at-top", top <= 1);
        wrap.classList.toggle("at-bottom", atBottom);
        // Mirror onto the stable parent that paints the bottom feather, so the
        // feather can retire once the list is scrolled to its end.
        wrap.closest(".home-content")?.classList.toggle("list-at-bottom", atBottom);
      });
    }

    function wireKineticList(config) {
      const {
        wrapSelector,
        listSelector,
        dragSelector,
        wheelFallback,
        allowParentSwipe,
        activeScreen,
        pullVar,
        pullMax,
        pullPow,
        pullMul,
        pullTopMul = pullMul,
        pullBottomMul = pullMul,
        onHorizontalSwipe,
        onHorizontalDrag,
        onHorizontalRelease,
        horizontalSwipeThreshold = 64,
        onSync,
        momentumFriction = 0.95,
        momentumMinVelocity = 0.015,
        releaseSpringVelocity = 0.02,
        edgeVelocityDamping = 0.42,
        springTopMin = 10,
        springTopMax = 22,
        springBottomMin = 7,
        springBottomMax = 14,
        springTopVelocityScale = 150,
        springBottomVelocityScale = 110,
        springDurationMs = 240,
        springResetDelayMs = 260,
        momentumEdgeSpringScale = 0.56,
        smoothStopMs = 0,
        smoothStopFactor = 0,
        disableBottomRubberBand = false
      } = config;

      document.querySelectorAll(wrapSelector).forEach(wrap => {
        const list = wrap.querySelector(listSelector);
        if (!list) return;
        const dragSurface = dragSelector ? wrap.querySelector(dragSelector) || wrap : list;
        let dragActive = false;
        let dragAxis = null;
        let startX = 0;
        let startY = 0;
        let startTop = 0;
        let pull = 0;
        let lastX = 0;
        let lastY = 0;
        let lastT = 0;
        let velocity = 0;
        let momentumId = 0;
        let momentumT = 0;
        let settleId = 0;
        let wheelReset = 0;
        let activePointerId = null;
        let activeTouchId = null;
        let releaseListenersBound = false;

        const sync = () => onSync?.();

        const unbindReleaseListeners = () => {
          if (!releaseListenersBound) return;
          document.removeEventListener("pointerup", handleGlobalPointerRelease, true);
          document.removeEventListener("pointercancel", handleGlobalPointerRelease, true);
          document.removeEventListener("lostpointercapture", handleGlobalPointerRelease, true);
          document.removeEventListener("mouseup", handleGlobalPointerRelease, true);
          document.removeEventListener("touchend", handleGlobalTouchRelease, true);
          document.removeEventListener("touchcancel", handleGlobalTouchRelease, true);
          document.removeEventListener("visibilitychange", handleGlobalVisibility, true);
          window.removeEventListener("pointerup", handleGlobalPointerRelease, true);
          window.removeEventListener("pointercancel", handleGlobalPointerRelease, true);
          window.removeEventListener("lostpointercapture", handleGlobalPointerRelease, true);
          window.removeEventListener("mouseup", handleGlobalPointerRelease, true);
          window.removeEventListener("touchend", handleGlobalTouchRelease, true);
          window.removeEventListener("touchcancel", handleGlobalTouchRelease, true);
          window.removeEventListener("blur", handleGlobalBlur, true);
          releaseListenersBound = false;
        };

        const resetReleaseIds = () => {
          activePointerId = null;
          activeTouchId = null;
        };

        function finishDragState() {
          dragActive = false;
          dragAxis = null;
          unbindReleaseListeners();
          resetReleaseIds();
        }

        function handleGlobalPointerRelease(event) {
          if (!dragActive) return;
          const pointerId = typeof event.pointerId === "number" ? event.pointerId : null;
          if (activePointerId !== null && pointerId !== null && pointerId !== activePointerId) return;
          if (pointerId !== null) {
            try {
              dragSurface.releasePointerCapture?.(pointerId);
            } catch {}
          }
          end();
        }

        function handleGlobalTouchRelease(event) {
          if (!dragActive) return;
          if (activeTouchId !== null) {
            const touches = Array.from(event.changedTouches || []);
            if (!touches.some(t => t.identifier === activeTouchId)) return;
          }
          end();
        }

        function handleGlobalBlur() {
          if (!dragActive) return;
          stopMomentum();
          stopSettle();
          velocity = 0;
          setPull(0);
          finishDragState();
          sync();
        }

        function handleGlobalVisibility() {
          if (!dragActive) return;
          if (document.hidden) {
            stopMomentum();
            stopSettle();
            velocity = 0;
            setPull(0);
            finishDragState();
            sync();
          }
        }

        const bindReleaseListeners = () => {
          if (releaseListenersBound) return;
          document.addEventListener("pointerup", handleGlobalPointerRelease, true);
          document.addEventListener("pointercancel", handleGlobalPointerRelease, true);
          document.addEventListener("lostpointercapture", handleGlobalPointerRelease, true);
          document.addEventListener("mouseup", handleGlobalPointerRelease, true);
          document.addEventListener("touchend", handleGlobalTouchRelease, true);
          document.addEventListener("touchcancel", handleGlobalTouchRelease, true);
          document.addEventListener("visibilitychange", handleGlobalVisibility, true);
          window.addEventListener("pointerup", handleGlobalPointerRelease, true);
          window.addEventListener("pointercancel", handleGlobalPointerRelease, true);
          window.addEventListener("lostpointercapture", handleGlobalPointerRelease, true);
          window.addEventListener("mouseup", handleGlobalPointerRelease, true);
          window.addEventListener("touchend", handleGlobalTouchRelease, true);
          window.addEventListener("touchcancel", handleGlobalTouchRelease, true);
          window.addEventListener("blur", handleGlobalBlur, true);
          releaseListenersBound = true;
        };

        const setPull = value => {
          pull = value;
          if (value === 0) {
            wrap.classList.remove("is-pulling");
            list.style.setProperty(pullVar, "0px");
            return;
          }
          wrap.classList.add("is-pulling");
          list.style.setProperty(pullVar, `${value}px`);
        };

        const stopMomentum = () => {
          if (!momentumId) return;
          cancelAnimationFrame(momentumId);
          momentumId = 0;
          momentumT = 0;
        };

        const stopSettle = () => {
          if (!settleId) return;
          cancelAnimationFrame(settleId);
          settleId = 0;
        };

        const startSmoothStop = (from, to, duration) => {
          stopSettle();
          const startTime = performance.now();
          const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
          const step = now => {
            if ((phone.dataset.current || "home") !== activeScreen) {
              settleId = 0;
              return;
            }
            const p = Math.min(1, (now - startTime) / duration);
            const e = easeOutCubic(p);
            list.scrollTop = from + (to - from) * e;
            sync();
            if (p < 1) {
              settleId = requestAnimationFrame(step);
              return;
            }
            settleId = 0;
            velocity = 0;
          };
          settleId = requestAnimationFrame(step);
        };

        const springBoundary = (sign, options = {}) => {
          // Subtle, directional cushion when kinetic scrolling meets a boundary.
          // `sign` 1 = top edge (scrolling down), -1 = bottom edge (scrolling up).
          const v = Math.abs(velocity);
          const topAmp = Math.max(springTopMin, Math.min(springTopMax, v * springTopVelocityScale));
          const bottomAmp = Math.max(springBottomMin, Math.min(springBottomMax, v * springBottomVelocityScale));
          const baseAmp = sign > 0 ? topAmp : bottomAmp;
          const minAmp = sign > 0 ? springTopMin : springBottomMin;
          const maxAmp = sign > 0 ? springTopMax : springBottomMax;
          const amp = Number.isFinite(options.amp)
            ? Math.max(minAmp, Math.min(maxAmp, options.amp))
            : baseAmp;
          const offset = amp * sign;
          wrap.classList.remove("is-pulling");
          if (options.fromCurrent) {
            list.style.transition = `transform ${springDurationMs}ms cubic-bezier(.08, .68, .16, 1)`;
            list.style.setProperty(pullVar, "0px");
            sync();
            setTimeout(() => {
              list.style.removeProperty("transition");
            }, springResetDelayMs);
            return;
          }
          list.style.transition = "none";
          list.style.setProperty(pullVar, `${offset}px`);
          sync();
          requestAnimationFrame(() => requestAnimationFrame(() => {
            list.style.transition = `transform ${springDurationMs}ms cubic-bezier(.08, .68, .16, 1)`;
            list.style.setProperty(pullVar, "0px");
            sync();
          }));
          setTimeout(() => {
            list.style.removeProperty("transition");
          }, springResetDelayMs);
        };

        const stepMomentum = now => {
          if ((phone.dataset.current || "home") !== activeScreen) {
            stopMomentum();
            setPull(0);
            return;
          }
          if (!momentumT) momentumT = now;
          const dt = Math.min(34, now - momentumT || 16);
          momentumT = now;

          velocity *= Math.pow(momentumFriction, dt / 16.67);
          if (Math.abs(velocity) < momentumMinVelocity) {
            const max = Math.max(0, list.scrollHeight - list.clientHeight);
            const atTop = list.scrollTop <= 0.5;
            const atBottom = list.scrollTop >= max - 0.5;
            const movingIntoTop = atTop && velocity < -0.002;
            const movingIntoBottom = atBottom && velocity > 0.002 && !disableBottomRubberBand;
            if (movingIntoTop || movingIntoBottom) {
              springBoundary(movingIntoTop ? 1 : -1);
              stopMomentum();
              setPull(0);
              sync();
              return;
            }
            if (smoothStopMs > 0 && smoothStopFactor > 0) {
              const from = list.scrollTop;
              const target = Math.max(0, Math.min(max, from + velocity * smoothStopFactor));
              if (Math.abs(target - from) > 0.3) {
                stopMomentum();
                setPull(0);
                startSmoothStop(from, target, smoothStopMs);
                return;
              }
            }
            stopMomentum();
            setPull(0);
            sync();
            return;
          }

          const max = Math.max(0, list.scrollHeight - list.clientHeight);
          const next = list.scrollTop + (velocity * dt);
          if (next < 0 || next > max) {
            const sign = next < 0 ? 1 : -1;
            const overshoot = next < 0 ? -next : next - max;
            const edgeMul = sign > 0 ? pullTopMul : pullBottomMul;
            const edgeScale = sign > 0 ? springTopVelocityScale : springBottomVelocityScale;
            const boundaryAmp = Math.max(
              Math.pow(overshoot, pullPow) * edgeMul,
              Math.abs(velocity) * edgeScale * momentumEdgeSpringScale
            );
            list.scrollTop = next < 0 ? 0 : max;
            if (next > max && disableBottomRubberBand) {
              stopMomentum();
              setPull(0);
              sync();
              return;
            }
            springBoundary(sign, { amp: boundaryAmp });
            stopMomentum();
            sync();
            return;
          }

          list.scrollTop = next;
          sync();
          momentumId = requestAnimationFrame(stepMomentum);
        };

        const startMomentum = () => {
          stopSettle();
          if (Math.abs(velocity) < 0.03) return;
          stopMomentum();
          momentumId = requestAnimationFrame(stepMomentum);
        };

        const start = (x, y) => {
          stopMomentum();
          stopSettle();
          if (wheelReset) {
            clearTimeout(wheelReset);
            wheelReset = 0;
          }
          dragActive = true;
          dragAxis = null;
          startX = x;
          startY = y;
          lastX = x;
          startTop = Math.max(0, list.scrollTop);
          velocity = 0;
          lastY = y;
          lastT = performance.now();
          setPull(0);
          sync();
        };

        const move = (x, y) => {
          if (!dragActive) return;
          const dx = x - startX;
          const dy = y - startY;
          lastX = x;

          if (allowParentSwipe) {
            if (!dragAxis && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
              const ax = Math.abs(dx);
              const ay = Math.abs(dy);
              if (ax > 14 && ax > ay * 1.2) {
                dragAxis = "x";
              } else if (ay > 10 && ay > ax * 1.05) {
                dragAxis = "y";
              }
            }
            if (dragAxis === "x") {
              onHorizontalDrag?.(dx, dy);
              return "x";
            }
            if (dragAxis !== "y") return "pending";
          }

          const now = performance.now();
          const dt = Math.max(8, now - lastT);
          const dySinceLast = y - lastY;
          const instV = (-dySinceLast) / dt; // px per ms
          velocity = (velocity * 0.7) + (instV * 0.3);
          lastY = y;
          lastT = now;

          const max = Math.max(0, list.scrollHeight - list.clientHeight);
          const desired = startTop - dy;
          if (desired < 0) {
            list.scrollTop = 0;
            velocity *= edgeVelocityDamping;
            setPull(Math.min(pullMax, Math.pow(-desired, pullPow) * pullTopMul));
            sync();
            return;
          }
          if (desired > max) {
            list.scrollTop = max;
            velocity *= edgeVelocityDamping;
            if (disableBottomRubberBand) {
              setPull(0);
              sync();
              return;
            }
            setPull(-Math.min(pullMax, Math.pow(desired - max, pullPow) * pullBottomMul));
            sync();
            return;
          }
          if (pull !== 0) {
            setPull(0);
          }
          list.scrollTop = desired;
          sync();
          return "y";
        };

        const end = () => {
          if (!dragActive) return;
          unbindReleaseListeners();
          if (allowParentSwipe && dragAxis === "x") {
            const totalDx = lastX - startX;
            if (Math.abs(totalDx) >= horizontalSwipeThreshold) {
              onHorizontalSwipe?.(totalDx);
            } else {
              onHorizontalRelease?.(totalDx);
            }
            finishDragState();
            velocity = 0;
            setPull(0);
            sync();
            return;
          }
          if (pull !== 0) {
            const sign = pull > 0 ? 1 : -1;
            const releaseV = Math.max(0.035, Math.min(0.12, Math.abs(velocity)));
            velocity = sign > 0 ? -releaseV : releaseV;
            springBoundary(sign, { fromCurrent: true, amp: Math.abs(pull) });
            finishDragState();
            sync();
            return;
          }
          const max = Math.max(0, list.scrollHeight - list.clientHeight);
          const atTop = list.scrollTop <= 0.5;
          const atBottom = list.scrollTop >= max - 0.5;
          const topShouldSpring = atTop && velocity < -releaseSpringVelocity;
          const bottomShouldSpring = atBottom && velocity > releaseSpringVelocity && !disableBottomRubberBand;
          if (topShouldSpring || bottomShouldSpring) {
            springBoundary(topShouldSpring ? 1 : -1);
            finishDragState();
            sync();
            return;
          }
          finishDragState();
          startMomentum();
        };

        dragSurface.addEventListener("pointerdown", event => {
          if ((phone.dataset.current || "home") !== activeScreen) return;
          if (event.button !== 0) return;
          if (!allowParentSwipe) {
            event.stopPropagation();
            event.preventDefault();
          }
          dragSurface.setPointerCapture?.(event.pointerId);
          activePointerId = event.pointerId;
          bindReleaseListeners();
          start(event.clientX, event.clientY);
        });
        dragSurface.addEventListener("pointermove", event => {
          if (!dragActive) return;
          const mode = move(event.clientX, event.clientY);
          if (mode === "pending") return;
          if (mode === "x") {
            event.stopPropagation();
            event.preventDefault();
            return;
          }
          if (!allowParentSwipe || (allowParentSwipe && gestureOriginInLeader && (gestureAxis === "y" || gestureAxis === null))) {
            event.stopPropagation();
          }
          event.preventDefault();
        });
        dragSurface.addEventListener("pointerup", event => {
          if (!allowParentSwipe || (allowParentSwipe && gestureOriginInLeader && (gestureAxis === "y" || dragAxis === "y"))) {
            event.stopPropagation();
          }
          end();
        });
        dragSurface.addEventListener("pointercancel", end);

        dragSurface.addEventListener("touchstart", event => {
          if ((phone.dataset.current || "home") !== activeScreen) return;
          if (!allowParentSwipe) {
            event.stopPropagation();
            event.preventDefault();
          }
          const t = event.changedTouches[0];
          activeTouchId = t?.identifier ?? null;
          bindReleaseListeners();
          start(t.clientX, t.clientY);
        }, { passive: false });

        dragSurface.addEventListener("touchmove", event => {
          if (!dragActive) return;
          const t = event.changedTouches[0];
          const mode = move(t.clientX, t.clientY);
          if (mode === "pending") return;
          if (mode === "x") {
            event.stopPropagation();
            event.preventDefault();
            return;
          }
          if (!allowParentSwipe || (allowParentSwipe && gestureOriginInLeader && (gestureAxis === "y" || gestureAxis === null))) {
            event.stopPropagation();
          }
          event.preventDefault();
        }, { passive: false });

        dragSurface.addEventListener("touchend", end, { passive: true });
        dragSurface.addEventListener("touchcancel", end, { passive: true });

        if (wheelFallback) {
          dragSurface.addEventListener("wheel", event => {
            if ((phone.dataset.current || "home") !== activeScreen) return;
            const delta = event.deltaY;
            if (Math.abs(delta) < 0.01) return;
            event.stopPropagation();
            event.preventDefault();
            stopMomentum();
            if (wheelReset) {
              clearTimeout(wheelReset);
              wheelReset = 0;
            }
            const max = Math.max(0, list.scrollHeight - list.clientHeight);
            const next = list.scrollTop + delta;
            if (next < 0) {
              list.scrollTop = 0;
              setPull(Math.min(pullMax, Math.pow(-next, pullPow) * pullTopMul));
              sync();
              wheelReset = setTimeout(() => {
                setPull(0);
                sync();
                wheelReset = 0;
              }, 120);
              return;
            }
            if (next > max) {
              list.scrollTop = max;
              if (disableBottomRubberBand) {
                setPull(0);
                sync();
                return;
              }
              setPull(-Math.min(pullMax, Math.pow(next - max, pullPow) * pullBottomMul));
              sync();
              wheelReset = setTimeout(() => {
                setPull(0);
                sync();
                wheelReset = 0;
              }, 120);
              return;
            }
            setPull(0);
            list.scrollTop = next;
            sync();
          }, { passive: false });
        }
      });
    }

    function wireHistoryDragScroll() {
      wireKineticList({
        wrapSelector: ".history-wrap",
        listSelector: ".history-list",
        dragSelector: ".history-list",
        wheelFallback: true,
        activeScreen: "account",
        pullVar: "--hist-pull",
        pullMax: 88,
        pullPow: .84,
        pullMul: .72,
        pullBottomMul: .72,
        momentumFriction: 0.972,
        momentumMinVelocity: 0.006,
        releaseSpringVelocity: 0.009,
        edgeVelocityDamping: 0.32,
        springTopMin: 4,
        springTopMax: 8,
        springBottomMin: 4,
        springBottomMax: 8,
        springTopVelocityScale: 44,
        springBottomVelocityScale: 44,
        springDurationMs: 940,
        springResetDelayMs: 980,
        momentumEdgeSpringScale: 0.12,
        smoothStopMs: 700,
        smoothStopFactor: 190,
        disableBottomRubberBand: false,
        onSync: syncHistoryFade
      });
    }

    function wireLeaderDragScroll() {
      wireKineticList({
        wrapSelector: ".leader-wrap",
        listSelector: ".leader-list",
        dragSelector: ".leader-list",
        activeScreen: "home",
        allowParentSwipe: true,
        wheelFallback: true,
        pullVar: "--leader-pull",
        pullMax: 88,
        pullPow: .84,
        pullMul: .72,
        pullBottomMul: .72,
        momentumFriction: 0.972,
        momentumMinVelocity: 0.006,
        releaseSpringVelocity: 0.009,
        edgeVelocityDamping: 0.32,
        springTopMin: 4,
        springTopMax: 8,
        springBottomMin: 4,
        springBottomMax: 8,
        springTopVelocityScale: 44,
        springBottomVelocityScale: 44,
        springDurationMs: 940,
        springResetDelayMs: 980,
        momentumEdgeSpringScale: 0.12,
        smoothStopMs: 700,
        smoothStopFactor: 190,
        disableBottomRubberBand: false,
        horizontalSwipeThreshold: 52,
        onHorizontalDrag: (dx, dy) => {
          applyPullX(dx, dy);
        },
        onHorizontalRelease: () => {
          releaseHorizontalPeek();
        },
        onHorizontalSwipe: dx => {
          animateHorizontalSwipe(dx, 0, { fromLeader: true });
        },
        onSync: syncLeaderFade
      });
    }

    phone.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      if (!canGestureFromPoint(event.clientX, event.clientY, event.target)) return;
      pointerGestureId = event.pointerId;
      try {
        phone.setPointerCapture?.(event.pointerId);
      } catch {}
      gestureStart(event.clientX, event.clientY, event.target);
    });

    phone.addEventListener("pointermove", event => {
      if (!pointerActive) return;
      if (pointerGestureId !== null && event.pointerId !== pointerGestureId) return;
      if (event.buttons === 0) {
        gestureEnd(event.clientX, event.clientY);
        return;
      }
      gestureMove(event.clientX, event.clientY);
    });

    phone.addEventListener("pointerup", event => {
      if (pointerGestureId !== null && event.pointerId !== pointerGestureId) return;
      gestureEnd(event.clientX, event.clientY);
      try {
        phone.releasePointerCapture?.(event.pointerId);
      } catch {}
    });

    phone.addEventListener("pointercancel", event => {
      if (pointerGestureId !== null && event.pointerId !== pointerGestureId) return;
      resetGesture({ instant: true });
    });

    window.addEventListener("pointerup", event => {
      if (!pointerActive) return;
      gestureEnd(event.clientX, event.clientY);
    }, { passive: true });

    window.addEventListener("pointercancel", () => {
      if (!pointerActive) return;
      resetGesture({ instant: true });
    }, { passive: true });

    window.addEventListener("blur", () => {
      if (!pointerActive) return;
      resetGesture({ instant: true });
    }, { passive: true });

    phone.addEventListener("touchstart", event => {
      if (prefersPointerInput) return;
      const t = event.changedTouches[0];
      const touchTarget = event.target;
      if (!canGestureFromPoint(t.clientX, t.clientY, touchTarget)) return;
      gestureStart(t.clientX, t.clientY, touchTarget);
    }, { passive: true });

    phone.addEventListener("touchmove", event => {
      if (prefersPointerInput) return;
      if (!pointerActive) return;
      const t = event.changedTouches[0];
      gestureMove(t.clientX, t.clientY);
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const fromLeader = gestureOriginInLeader;
      const leaderHorizontalDrag = fromLeader && gestureAxis === "x";
      if ((leaderHorizontalDrag || !fromLeader) && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
        event.preventDefault();
      }
    }, { passive: false });

    phone.addEventListener("touchend", event => {
      if (prefersPointerInput) return;
      const t = event.changedTouches[0];
      gestureEnd(t.clientX, t.clientY);
    }, { passive: true });

    phone.addEventListener("touchcancel", () => {
      if (prefersPointerInput) return;
      resetGesture({ instant: true });
    }, { passive: true });

    window.addEventListener("touchend", event => {
      if (prefersPointerInput) return;
      if (!pointerActive) return;
      const t = event.changedTouches?.[0];
      if (!t) {
        resetGesture();
        return;
      }
      gestureEnd(t.clientX, t.clientY);
    }, { passive: true });

    window.addEventListener("touchcancel", () => {
      if (prefersPointerInput) return;
      if (!pointerActive) return;
      resetGesture({ instant: true });
    }, { passive: true });

    document.addEventListener("selectionchange", () => {
      const active = document.activeElement;
      if (active && (/input|textarea/i.test(active.tagName) || active.isContentEditable)) return;
      window.getSelection?.().removeAllRanges?.();
    });
    document.addEventListener("selectstart", event => {
      const node = event.target;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (el && el.closest('input, textarea, [contenteditable="true"]')) return;
      if (document.activeElement && document.activeElement.isContentEditable) return;
      event.preventDefault();
    });
    document.addEventListener("dragstart", event => {
      event.preventDefault();
    });

    document.querySelectorAll(".checkout-entry-field").forEach(input => {
      const row = input.closest(".checkout-entry-row");
      if (!row) return;

      const syncCheckoutEntryRow = () => {
        row.classList.toggle("has-value", input.value.trim() !== "");
      };

      const focusCheckoutEntry = () => {
        row.classList.add("is-editing");
        input.focus({ preventScroll: true });
        const pos = input.value.length;
        try {
          input.setSelectionRange(pos, pos);
        } catch {}
      };

      input.setAttribute("placeholder", "");
      input.setAttribute("data-placeholder", "");
      row.classList.remove("is-editing");
      syncCheckoutEntryRow();

      row.addEventListener("click", event => {
        if (event.target === input || event.target?.closest?.("input")) return;
        focusCheckoutEntry();
      });

      input.addEventListener("focus", () => {
        row.classList.add("is-editing");
      });

      input.addEventListener("blur", () => {
        row.classList.remove("is-editing");
        syncCheckoutEntryRow();
      });

      input.addEventListener("input", () => {
        syncCheckoutEntryRow();
      });
    });

    updateCart();
    wireHistoryDragScroll();
    wireLeaderDragScroll();
    syncHistoryFade();
    syncLeaderFade();
    document.querySelectorAll(".history-list").forEach(list => {
      list.addEventListener("scroll", syncHistoryFade, { passive: true });
    });
    document.querySelectorAll(".leader-list").forEach(list => {
      list.addEventListener("scroll", syncLeaderFade, { passive: true });
    });

    let scrollWindowLayoutSignature = `${window.innerWidth}:${screen.orientation?.type || window.orientation || ""}`;
    const syncScrollWindowsOnViewportChange = () => {
      const nextSignature = `${window.innerWidth}:${screen.orientation?.type || window.orientation || ""}`;
      if (nextSignature === scrollWindowLayoutSignature) return;
      scrollWindowLayoutSignature = nextSignature;
      requestAnimationFrame(() => {
        syncResponsiveScrollWindows();
        syncHistoryFade();
        syncLeaderFade();
      });
    };

    window.addEventListener("resize", syncScrollWindowsOnViewportChange, { passive: true });
    window.addEventListener("orientationchange", syncScrollWindowsOnViewportChange, { passive: true });
    window.visualViewport?.addEventListener("resize", syncScrollWindowsOnViewportChange, { passive: true });

    // Leaderboard swipe uses the same global gesture engine as the rest of home.
    // Desktop trackpads often surface horizontal swipe as wheel deltaX rather than
    // pointer/touch drag, so bridge that input specifically for the leaderboard area.
    let leaderWheelX = 0;
    let leaderWheelY = 0;
    let leaderWheelResetTimer = 0;
    let leaderWheelLockUntil = 0;

    const activeLeaderRect = () => {
      const wrap = document.querySelector(".screen[data-screen='home'].active .leader-wrap");
      return wrap?.getBoundingClientRect?.() || null;
    };

    const isPointInRect = (x, y, rect) => {
      if (!rect) return false;
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const swipeByWheelDelta = (deltaX) => {
      if (swipeAnimating) return;
      resetGesture({ instant: true });
      const current = phone.dataset.current || "home";
      const index = screenOrder.indexOf(current);
      if (index === -1) return;
      // wheel delta direction is opposite of drag-direction semantics used by getSwipeTarget().
      const virtualDx = -deltaX;
      const target = virtualDx < 0
        ? screenOrder[(index + 1) % screenOrder.length]
        : screenOrder[(index - 1 + screenOrder.length) % screenOrder.length];
      showScreen(target);
    };

    phone.addEventListener("wheel", event => {
      if ((phone.dataset.current || "home") !== "home") return;
      if (event.ctrlKey) return;
      const rect = activeLeaderRect();
      if (!isPointInRect(event.clientX, event.clientY, rect)) return;
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) * 1.1) return;

      leaderWheelX += event.deltaX;
      leaderWheelY += event.deltaY;

      if (leaderWheelResetTimer) clearTimeout(leaderWheelResetTimer);
      leaderWheelResetTimer = setTimeout(() => {
        leaderWheelX = 0;
        leaderWheelY = 0;
        leaderWheelResetTimer = 0;
      }, 160);

      const absX = Math.abs(leaderWheelX);
      const absY = Math.abs(leaderWheelY);
      if (absX < 64 || absX < absY * 1.45 || absY > 22) return;

      event.preventDefault();
      event.stopPropagation();

      if (Date.now() < leaderWheelLockUntil) return;
      leaderWheelLockUntil = Date.now() + 280;
      const finalDeltaX = leaderWheelX;
      leaderWheelX = 0;
      leaderWheelY = 0;
      swipeByWheelDelta(finalDeltaX);
    }, { capture: true, passive: false });

    window.__hugControls = {
      swipeLeft: () => {
        const current = phone.dataset.current || "home";
        const index = screenOrder.indexOf(current);
        const next = screenOrder[(index + 1) % screenOrder.length];
        showScreen(next);
      },
      swipeRight: () => {
        const current = phone.dataset.current || "home";
        const index = screenOrder.indexOf(current);
        const next = screenOrder[(index - 1 + screenOrder.length) % screenOrder.length];
        showScreen(next);
      },
      pullDown: amount => applyPull(0, amount),
      release: () => resetGesture(),
      current: () => phone.dataset.current || "home"
    };

    // Minimal adapter for native shell navigation. It delegates to the
    // prototype's existing transitions instead of introducing a second router.
    window.__hugNativeNavigation = {
      current: () => phone.dataset.current || "home",
      go: target => {
        if (!screens.some(screen => screen.dataset.screen === target)) return false;
        onNavAction(target, { trigger: "native" });
        return true;
      },
      back: () => {
        const giftWrapPanel = document.getElementById("giftwrap-panel");
        if (giftWrapPanel?.classList.contains("open")) {
          document.getElementById("giftwrap-back")?.click();
          return true;
        }

        if (linkedReferral?.classList.contains("open")) {
          closeLinkedReferral();
          return true;
        }

        const current = phone.dataset.current || "home";
        const backTarget = {
          account: "account",
          bag: "home",
          checkout: "bag",
          giving: "settings",
          impact: "settings",
          linked: "settings",
          profile: "settings",
          purchases: "settings",
          qr: "qr",
          scan: "scan",
          settings: "settings"
        }[current];

        if (!backTarget) return false;
        onNavAction(backTarget, { trigger: "native" });
        return true;
      }
    };

  /* ===========================================================================
     Responsive fit-to-viewport
     Scales the fixed 393x852 device design uniformly so the whole UI is always
     visible and correctly proportioned on any phone (SE -> Pro Max -> Android
     -> foldable) and on desktop. Uses visualViewport so it tracks mobile
     browser chrome (address bar show/hide) without layout jumps.
     The chosen scale is published to `window.__hugFit` and to the `--fit` CSS
     custom property consumed by `.phone`.
     ========================================================================= */
  (function fitToViewport() {
    const root = document.documentElement;
    const css = getComputedStyle(root);
    const DW = parseFloat(css.getPropertyValue("--phone-w")) || 393;
    const DH = parseFloat(css.getPropertyValue("--phone-h")) || 852;
    const coarse = window.matchMedia("(pointer: coarse)");

    function apply() {
      // Fill natively at the design width (393px) and wider; below it, scale
      // the whole app down to fit the width so padding stays equal on both
      // sides and nothing clips. --fit = min(1, viewport-width / design-width).
      // Gesture deltas are divided by --fit elsewhere, so they stay 1:1 in
      // design space. (This is width-based, not the old pointer/desktop mock.)
      const vv = window.visualViewport;
      const w = vv ? vv.width : window.innerWidth;
      const fit = Math.min(1, w / DW);
      window.__hugFit = fit;
      root.style.setProperty("--fit", fit.toFixed(4));
    }

    apply();
    addEventListener("resize", apply, { passive: true });
    addEventListener("orientationchange", apply);
    coarse.addEventListener?.("change", apply);
    if (window.visualViewport) {
      visualViewport.addEventListener("resize", apply, { passive: true });
      visualViewport.addEventListener("scroll", apply, { passive: true });
    }
  })();

  /* Balance intro: on first load the top-left pill flashes the cumulative
     referral balance (pending + deposited), pulses, then counts down to settle
     on the deposited (spendable) amount. Values come from the live server
     balance (window.__hugReferral); with no referrals yet it reads £0. */
  // Tell CSS how long each money pill's figure is, whoever set it (renderReferralBalance, the
  // intro countdown below): a long figure needs a smaller font to clear the logo. See .balance.
  (function balanceFit() {
    const tag = (el) => { const n = (el.textContent || "").trim().length; if (String(n) !== el.dataset.len) el.dataset.len = String(n); };
    document.querySelectorAll(".balance").forEach((el) => {
      tag(el);
      new MutationObserver(() => tag(el)).observe(el, { childList: true, characterData: true, subtree: true });
    });
  })();

  (function balanceIntro() {
    const homeBalance = document.querySelector('[data-screen="home"] .balance');
    if (!homeBalance) return;
    const COUNT_MS = 820, PULSE_END_MS = 3300;
    const cumulative = function () {              // pending + deposited (the higher figure)
      const ref = window.__hugReferral || { availableCents: 0, pendingCents: 0 };
      return ((ref.availableCents || 0) + (ref.pendingCents || 0)) / 100;
    };
    const deposited = function () {               // spendable / settled
      const ref = window.__hugReferral || { availableCents: 0, pendingCents: 0 };
      return (ref.availableCents || 0) / 100;
    };
    // Pulse on the cumulative (pending-inclusive) amount so the pending shows;
    // keep it current while the server balance is still arriving and re-assert
    // it over renderReferralBalance(), which paints the spendable figure.
    // While the balance is still UNKNOWN (signed in, no cache, server not yet in) leave
    // the pill blank rather than asserting \u00A30.00 \u2014 renderReferralBalance owns that state.
    const known = function () { return !window.__hugReferral || window.__hugReferral.known !== false; };
    const paintCumulative = function () {
      if (!known()) return;
      homeBalance.textContent = "\u00A3" + cumulative().toFixed(2);
    };
    paintCumulative();
    const sync = setInterval(paintCumulative, 120);
    // ONE figure on the pill while the intro owns it. renderReferralBalance() repaints every
    // .balance with the spendable figure whenever anything refreshes; the 120 ms re-assert
    // above then put the cumulative back, so the pill flashed spendable -> cumulative in the
    // first frames after the reveal (seen in prototype mode: £105.00, then £175.50). A
    // MutationObserver runs before the next paint, so the foreign figure is never drawn.
    // `counting` holds the countdown's current text once it starts; until then it is null and
    // the cumulative figure is re-derived from the same __hugReferral the other painter used.
    let counting = null, introDone = false;
    const hold = new MutationObserver(function () {
      if (introDone || !known()) return;
      const want = counting !== null ? counting : "\u00A3" + cumulative().toFixed(2);
      if (homeBalance.textContent !== want) homeBalance.textContent = want;
    });
    hold.observe(homeBalance, { childList: true, characterData: true, subtree: true });
    // The pulse and countdown are deliberate motion, so they start on the page the user can
    // actually see — once the launch cover has lifted (bootGate). Started at script time they
    // ran under the cover and were already half over, mid-fade, when the page appeared, which
    // read as the pill still loading.
    const whenShown = (window.__hugBoot && window.__hugBoot.onReveal) || function (cb) { cb(); };
    whenShown(function () {
    homeBalance.classList.add("balance-intro-pulse");
    setTimeout(function () {
      clearInterval(sync);
      homeBalance.classList.remove("balance-intro-pulse");
      // Balance never arrived (offline first launch): leave the pill to
      // renderReferralBalance rather than counting down to a fabricated £0.00.
      if (!known()) { introDone = true; hold.disconnect(); return; }
      const FROM = cumulative(), TO = deposited();          // count cumulative -> spendable
      let start = null;
      function tick(ts) {
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / COUNT_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        counting = "\u00A3" + (t < 1 ? FROM + (TO - FROM) * eased : TO).toFixed(2);
        homeBalance.textContent = counting;
        if (t < 1) requestAnimationFrame(tick);
        else { introDone = true; hold.disconnect(); }
      }
      requestAnimationFrame(tick);
    }, PULSE_END_MS);
    });
  })();

  /* The + expand's slide, shared by the home leaderboard and the account History. Each has a
     RAIL that slides (transform) and, inside it, a window whose height does NOT animate (see
     setExpand in each, and styles.css "The + expand is ONE motion"). Measured on the iPhone 16e
     simulator, 2026-10-16, by tracking the board in every frame of a recording:
       · all of the tap's work (rows, classes, the window's size) is done BEFORE the slide starts,
         and the slide starts alone once the page is calm (later); a newer tap cancels a start
         still waiting. The rail's resting transform has its own class (*-slid), set with it;
       · the slide is a Web Animation with the CSS curve and duration plus a short HOLD at its end
         position (run). iOS stopped the slide ~140 ms before its curve was done, every time, so
         the last ~0.6 pt arrived in one jump; with the hold the movement is over by then. The CSS
         transition stays as the fallback (waClass switches it off where this runs).
     y(): where the rail is NOW (mid-slide on a quick second tap). Read it before the class changes. */
  function listSlide(rail, content, waClass){
    var EASE = 'cubic-bezier(.2, .9, .16, 1)';   // = the rails' transition in styles.css
    var HOLD_MS = 250;
    // The slide also waits 40 ms at its start position. iOS can be a few frames
    // late to show a slide's first frame after a busy tap; the wait absorbs that, where otherwise
    // the first part of the curve would be skipped and the board would jump.
    var DELAY_MS = 40;
    var anim = null, seq = 0;
    var wa = !!(rail && rail.animate && window.DOMMatrix);
    if(wa) content.classList.add(waClass);
    function ms(){
      var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hist-expand-ms'));
      return v > 0 ? v : 650;
    }
    return {
      next: function(){ return ++seq; },
      // start: once the page is calm after the tap (two on-time frames in a row; at most 160 ms):
      // the slide starts, and nothing else changes in that frame. Every class change (rows, fades,
      // the search pill) happens AT the tap. Those restyle every row, ~50 ms a frame on the
      // simulator, and iOS then needs a while to draw the result; a slide started under that
      // never showed its first ~100-200 ms, so the board appeared 120-220 pt along.
      later: function(s, start){
        var t0 = 0, last = 0, calm = 0;
        function tick(ts){
          if(s !== seq) return;
          if(!t0) t0 = ts;
          calm = last && ts - last <= 20 ? calm + 1 : 0;
          last = ts;
          if(calm >= 2 || ts - t0 >= 160){ start(); return; }
          requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      },
      y: function(){
        try { var m = getComputedStyle(rail).transform; return m && m !== 'none' ? new DOMMatrix(m).m42 : 0; } catch(e){ return 0; }
      },
      // Slides the rail from `from` to `to` (px) and leaves it resting there: the resting transform
      // goes on the RAIL's own inline style (rest: what to leave, '' = the stylesheet's), never via
      // a class or custom property on the page above it, which restyled every row in the slide's
      // first frame (~45 ms on the simulator). Returns false where there are no Web Animations;
      // the caller then switches its *-slid class and the CSS transition runs instead.
      run: function(from, to, rest){
        if(!wa) return false;
        if(anim){ try{ anim.cancel(); }catch(e){} anim = null; }
        rail.style.transform = rest === undefined ? 'translateY(' + to + 'px)' : rest;
        if(Math.abs(to - from) < 0.5) return true;
        // The wait and the hold are keyframes of the one animation, not its `delay`: a delay's end
        // is a phase change that cost a ~45 ms frame just as the board started to move.
        var d = ms(), T = DELAY_MS + d + HOLD_MS;
        anim = rail.animate([
          { offset: 0, transform: 'translateY(' + from + 'px)' },
          { offset: DELAY_MS / T, transform: 'translateY(' + from + 'px)', easing: EASE },
          { offset: (DELAY_MS + d) / T, transform: 'translateY(' + to + 'px)' },
          { offset: 1, transform: 'translateY(' + to + 'px)' }
        ], { duration: T });
        return true;
      },
      // When a close may drop its held window height: as the slide's curve ends, INSIDE its hold.
      // The rail is at rest by then, and the slide still owns its position. Dropped after the
      // slide, iOS drew History's board 1 pt higher for 3 frames (its resting place with the tall
      // window), until the shorter window reached the screen (simulator, 2026-10-16). Without
      // Web Animations: just after the CSS transition.
      releaseAt: function(){ return wa ? DELAY_MS + ms() : ms() + 50; }
    };
  }

  /* History: selectable rows -> detail, and the + expand-to-full transaction list. */
  (function historyFeature(){
    var screen = document.querySelector('.screen[data-screen="account"]');
    if(!screen) return;
    var content = screen.querySelector('.account-content');
    var wrap = screen.querySelector('.history-wrap');
    var list = screen.querySelector('.history-list');
    var titleEl = screen.querySelector('.history-title');
    var rail = document.createElement('section');
    rail.className = 'history-rail';
    if (wrap && wrap.parentNode) { wrap.parentNode.insertBefore(rail, wrap); rail.appendChild(wrap); }
    if(!content || !wrap || !list || !titleEl) return;

    var GBP = function(n){ return '\u00A3' + n.toFixed(2); };
    var UNKNOWN = HUG_UNKNOWN;   // the "we cannot honestly state this" placeholder
    var MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    // Localised short month name for the current app language. English keeps the app's
    // custom lowercase style ("jun"); every other language uses the browser's ICU short
    // month (Arabic "يونيو", Japanese "6月", Hebrew "יוני" …) so dates read in-language
    // instead of a mix of English + translated. Day/year stay Western digits for parity
    // with prices; a locale that trails a period (de "Jun.") is trimmed. Falls back to the
    // English abbreviation if Intl lacks the locale. Language switch reloads, so this is
    // evaluated fresh per render — no stale month on the observer's re-pass.
    var monName = function(dt){
      var lg = (window.hugCurrentLang && window.hugCurrentLang()) || 'en';
      if (lg === 'en') return MON[dt.getMonth()];
      try {
        var nm = dt.toLocaleDateString(lg, { month: 'short' });
        return (nm && nm.replace(/\.$/, '')) || MON[dt.getMonth()];
      } catch (e) { return MON[dt.getMonth()]; }
    };
    var CATALOG = [
      {n:'hug o \u2014 dark roast', p:30}, {n:'hug o \u2014 cherry pop', p:30},
      {n:'hug o \u2014 blue crush', p:30}, {n:'hug o \u2014 lemon drop', p:30}
    ];
    var PAY = ['visa \u00b76411','visa \u00b62213','mastercard \u00b70094','amex \u00b71007','apple pay'];
    var CHAN = ['app','web','in-store'];
    var NAMES = ['max','chloe','aria','leo','ruby','finn','elsie','theo','orla','kai',
      'willow','jude','iris','reuben','edie','arlo','effie','rex','wren','otis','maeve',
      'jonah','etta','milo','cleo','dexter','posy','hugo','marnie','bram','cora','dax',
      'fern','gus','hazel','juno','kit','lena','mabel','ned','opal','pax','quinn','rory',
      'sage','tess','uma','vera','wade','yara','zane','bea','della','enzo','flo','gwen',
      'hank','imo','jett','kira','lottie','moss','nell','ori','pia','remy','sol','tova'];

    var txns = [], tid = 80432;
    // true once a referral-history read has FAILED. Distinct from "txns is empty",
    // which is a real, knowable answer. See render()/loadLive().
    var histError = false;
    function pushTxn(name, date, amt, st){
      var k = txns.length;
      // cashback is 5% of the order (the base rate); each hug o is £30 -> £1.50 cashback per mug.
      var nItems = Math.max(1, Math.round(amt / 1.5)), items = [], sub = 0;
      for(var ii=0; ii<nItems; ii++){
        var it = CATALOG[(k+ii) % 4];          // CATALOG[0..3] are the £30 mug variants
        items.push({name:it.n, qty:1, price:it.p}); sub += it.p;
      }
      var hh = 8 + ((k*7) % 12), mm = (k*13) % 60;
      txns.push({ id:'HUG-'+(tid - k*7), name:name, date:date, amt:amt, st:st,
        time:(hh<10?'0'+hh:hh)+':'+(mm<10?'0'+mm:mm), items:items, subtotal:sub,
        pay:PAY[k % PAY.length], channel:CHAN[k % CHAN.length] });
    }
    var YEAR = new Date().getFullYear();
    // Prototype-only sample referral history. Real accounts never see this (loadLive owns them).
    // DEMO_REFERRAL_ORDERS orders from referred friends, newest first, dated back from TODAY so
    // the picture is always current: the last month is still pending (the real return window),
    // one to three months back is deposited, and everything older has been cashed out. Order
    // sizes follow a plausible mix — most friends buy one mug, some buy for the household — at
    // £1.50 cashback per £30 mug (5%).
    if (isDemoMode()) {
      var r = DEMO.rng(20261001), DAY = 86400000, now = Date.now();
      var SIZE = [1,1,1,1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,4,4];   // 45% / 30% / 15% / 10%
      var who = DEMO.people(DEMO_REFERRAL_ORDERS + 40, 77);
      var ageDays = 1.5;
      for (var i = 0; i < DEMO_REFERRAL_ORDERS; i++) {
        // Busier recently (the community is growing): gaps widen with age.
        ageDays += (i < 40 ? 1.1 : i < 120 ? 2.6 : 4.4) * (0.45 + r() * 1.1);
        var mugs = SIZE[Math.floor(r() * SIZE.length)];
        var st = ageDays <= 30 ? 'pending' : ageDays <= 92 ? 'approved' : 'cashed_out';
        // A distinct friend per order: the account cells count friends, the points count
        // referrals, and the two must agree (6 x hugs + 1 x referrals == DEMO.points).
        pushTxn(who[i], new Date(now - ageDays * DAY), 1.5 * mugs, st);
      }
    }
    var CURRENT_YEAR = txns[0] ? txns[0].date.getFullYear() : YEAR;
    function fmtDate(dt){
      var s = monName(dt) + ' ' + dt.getDate();
      if(dt.getFullYear() !== CURRENT_YEAR) s += ' ' + dt.getFullYear();
      return s;
    }
    // The rate this row actually earned (stored on the row server-side: 10% before the 5% base
    // programme, 5% or 10% since). Derived from the row's own figures, never a literal.
    function cashbackLabel(t){
      if(t.rate != null && t.rate > 0) return hugTpl('cashback ({pct})', { pct: Math.round(t.rate * 100) + '%' });
      if(t.amtKnown !== false && t.subtotal > 0 && t.amt > 0) return hugTpl('cashback ({pct})', { pct: Math.round(t.amt / t.subtotal * 100) + '%' });
      return 'cashback';
    }
    function matches(t, q){
      if(!q) return true; q = q.toLowerCase();
      return t.name.toLowerCase().indexOf(q) >= 0 || t.id.toLowerCase().indexOf(q) >= 0
        || fmtDate(t.date).toLowerCase().indexOf(q) >= 0
        || t.items.some(function(it){ return it.name.toLowerCase().indexOf(q) >= 0; });
    }
    var GLANCE_LIMIT = 20;
    // Security (Phase 1C): history rows are built from backend-derived, user-
    // controllable text (a referrer's chosen name, order summary, channel, order
    // number). Never interpolate those into innerHTML — compose with DOM nodes and
    // textContent so markup in the data is rendered as text, not executed.
    function mk(tag, cls, text){
      var e = document.createElement(tag);
      if(cls) e.className = cls;
      if(text != null) e.textContent = text;
      return e;
    }
    function histStatusClass(st){
      return (st === 'pending' || st === 'cashed_out' || st === 'approved') ? st : '';
    }
    function render(q, full){
      list.textContent = '';
      var shown = 0;
      for(var k=0; k<txns.length; k++){
        var t = txns[k]; if(t.cancelled) continue; if(!matches(t, q)) continue;
        if(!full && shown >= GLANCE_LIMIT) break;
        shown++;
        var rowEl = mk('div', 'history-row ' + histStatusClass(t.st));
        rowEl.setAttribute('data-txn', String(k));
        rowEl.appendChild(mk('span', null, t.name));
        rowEl.appendChild(mk('span', 'date', fmtDate(t.date)));
        // amtKnown === false means the reward could not be read off the row (a
        // renamed/absent column). Showing "+£0.00" there is a plausible, wrong
        // statement about the customer's money; show nothing instead.
        rowEl.appendChild(mk('span', null, t.amtKnown === false ? UNKNOWN : '+' + GBP(t.amt)));
        list.appendChild(rowEl);
      }
      if(!shown && histError) list.appendChild(errorRow('couldn’t load your referrals', loadLive));
    }
    // A distinct "the read failed" row, with a retry. Without it a failed fetch
    // renders a blank list that is indistinguishable from "you have no referrals
    // yet" — the app telling a customer they have nothing when it simply does not know.
    function errorRow(message, retry){
      var box = mk('div', 'load-error');
      box.appendChild(mk('span', 'load-error-msg', message));
      var btn = mk('button', 'load-error-retry', 'retry');
      btn.type = 'button';
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){
        btn.addEventListener(ev, function(e){ e.stopPropagation(); });
      });
      btn.addEventListener('click', function(e){ e.stopPropagation(); retry(); });
      box.appendChild(btn);
      return box;
    }
    render('', true);

    var head = document.createElement('div'); head.className = 'history-head';
    titleEl.parentNode.insertBefore(head, titleEl); head.appendChild(titleEl);
    var search = document.createElement('input');
    search.className = 'history-search'; search.type = 'text';
    search.setAttribute('placeholder','search');
    search.setAttribute('aria-label','Search transactions');
    head.appendChild(search);
    var plus = document.createElement('button');
    plus.className = 'history-plus'; plus.type = 'button';
    plus.setAttribute('aria-label','Show all transactions');
    plus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    head.appendChild(plus);
    search.addEventListener('input', function(){ render(search.value.trim(), true); });
    ['pointerdown','touchstart','pointermove'].forEach(function(ev){
      search.addEventListener(ev, function(e){ e.stopPropagation(); });
    });

    var open = false, closeHold = 0;
    // Same construction as the home leaderboard (its setExpand says why): the rail slides
    // (listSlide), the window under it takes its open height in one step as the rail starts up
    // and, on a close, HOLDS it until the rail is home. Both steps land below the screen's bottom
    // edge, where the window ends in either state, so neither is seen. History used to animate
    // that height too, and ended each move with a last-frame jump (open -0.65 pt, close +0.74 pt)
    // and, 200 ms after a close, its rows dropping 2.5 pt (simulator, 2026-10-16).
    var mover = listSlide(rail, content, 'history-wa');
    function releaseCloseHold(){
      clearTimeout(closeHold); closeHold = 0;
      wrap.style.removeProperty('height');
    }
    function setExpand(next){
      open = next;
      var seq = mover.next();
      // A close still sliding home: drop its hold first, or a quick re-open would keep it.
      releaseCloseHold();
      if(open){
        // Rows past the glance twenty are laid out now, below the screen, not in the slide's first frame.
        content.classList.remove('history-glance');
        content.classList.add('history-prep');
        var cR = content.getBoundingClientRect(), wR = wrap.getBoundingClientRect();
        var nav = screen.querySelector('.bottom-nav');
        var navTop = nav ? nav.getBoundingClientRect().top : cR.bottom;
        var topInset = 8;   // = the head band's reach above the head (styles.css --head-band-pad), so it is not clipped
        // getBoundingClientRect is post-transform (scaled by --fit on a narrow
        // screen / the website mockup), but --hist-* apply in the design space
        // the .phone scales. Convert the measured distances back to design px,
        // else the shift + window come out short and leave gaps top and bottom.
        var fit = window.__hugFit || 1;
        var shift = Math.max(0, (wR.top - cR.top) / fit - topInset);
        // A WHOLE number of px, like the closed fit: with a fractional height iOS placed the list's
        // layer a whole pt or more off, so it hopped when the window changed size.
        var full = Math.round(Math.max(180, (navTop - cR.top) / fit - topInset - 8));
        content.style.setProperty('--hist-shift', shift + 'px');
        wrap.style.setProperty('--history-window-height', full + 'px');
        content.classList.add('history-open');   // the fades, the search pill; the rail moves in mover.later
        plus.setAttribute('aria-label','Hide all transactions');
        mover.later(seq, function(){
          if(!mover.run(mover.y(), -shift)) content.classList.add('history-slid');
        });
      } else {
        wrap.style.height = getComputedStyle(wrap).height;
        // Back to the glance twenty now, not in the slide's first frame: hiding ~250 rows there
        // held the slide's first frames back, and the board appeared half way down (simulator).
        content.classList.add('history-glance');
        if(search.value){ search.value = ''; render('', true); }
        content.classList.remove('history-open', 'history-prep');
        content.style.removeProperty('--hist-shift');
        wrap.style.removeProperty('--history-window-height');
        plus.setAttribute('aria-label','Show all transactions');
        try{ list.dispatchEvent(new Event('scroll')); }catch(e){}
        mover.later(seq, function(){
          // 0.01: the rail's resting transform (styles.css); '' leaves it to the stylesheet.
          if(!mover.run(mover.y(), 0.01, '')) content.classList.remove('history-slid');
          closeHold = setTimeout(function(){
            releaseCloseHold();
            try{ list.dispatchEvent(new Event('scroll')); }catch(e){}   // re-read the fade at the closed height
          }, mover.releaseAt());
        });
      }
    }
    plus.addEventListener('click', function(e){ e.stopPropagation(); setExpand(!open); });

    var ov = document.createElement('div'); ov.className = 'txn-detail'; screen.appendChild(ov);
    function openDetail(k){
      var t = txns[k]; if(!t) return;
      var dstr = monName(t.date)+' '+t.date.getDate()+' '+t.date.getFullYear()+' \u00b7 '+t.time;
      // Security (Phase 1C): compose the receipt with DOM nodes + textContent.
      // t.name / t.id / t.channel / item names are backend-derived and untrusted.
      function kv(label, val){
        var d = mk('div', 'txn-kv');
        d.appendChild(mk('span', null, label));
        d.appendChild(mk('span', null, val));
        return d;
      }
      function twoCol(cls, label, val, valCls){
        var d = mk('div', cls);
        d.appendChild(mk('span', null, label));
        d.appendChild(mk('span', valCls || null, val));
        return d;
      }
      ov.textContent = '';
      var back = mk('button', 'txn-back', '\u2039 back');
      back.type = 'button'; back.setAttribute('aria-label', 'Back');
      ov.appendChild(back);
      var head = mk('div', 'txn-head');
      head.appendChild(mk('span', 'txn-name', t.name));
      // Same honesty rule as the row: an unreadable reward states nothing.
      head.appendChild(mk('span', 'txn-amt gradient-accent', t.amtKnown === false ? UNKNOWN : '+' + GBP(t.amt)));
      ov.appendChild(head);
      ov.appendChild(mk('div', 'txn-meta', dstr));
      var statusLabel = t.st==='pending' ? 'cashback pending' : (t.st==='cashed_out' ? 'cashed out' : 'cashback deposited');
      ov.appendChild(mk('div', 'txn-status txn-' + histStatusClass(t.st), statusLabel));
      ov.appendChild(mk('div', 'txn-sec', 'order'));
      var lines = mk('div', 'txn-lines');
      t.items.forEach(function(it){
        lines.appendChild(twoCol('txn-line', it.qty + '\u00d7 ' + it.name, GBP(it.price * it.qty)));
      });
      ov.appendChild(lines);
      ov.appendChild(twoCol('txn-line txn-total', 'order total', GBP(t.subtotal)));
      ov.appendChild(twoCol('txn-line', cashbackLabel(t), t.amtKnown === false ? UNKNOWN : '+' + GBP(t.amt), 'gradient-accent'));
      ov.appendChild(mk('div', 'txn-sec', 'details'));
      ov.appendChild(kv('transaction', t.id));
      ov.appendChild(kv('channel', t.channel));
      ov.appendChild(kv('payment', t.pay));
      ov.appendChild(kv('referred by', t.name));
      requestAnimationFrame(function(){ ov.classList.add('open'); });
      ov.querySelector('.txn-back').addEventListener('click', function(e){ e.stopPropagation(); ov.classList.remove('open'); });
    }
    ['pointerdown','touchstart','pointermove'].forEach(function(ev){
      ov.addEventListener(ev, function(e){ e.stopPropagation(); });
    });
    // Tap anywhere on the open receipt to go back a step. A long-press or a
    // text selection (to copy/paste) is preserved — we don't dismiss then.
    var ovDown = null;
    ov.addEventListener('pointerdown', function(e){ ovDown = { x:e.clientX, y:e.clientY, t:Date.now() }; });
    ov.addEventListener('pointercancel', function(){ ovDown = null; });
    ov.addEventListener('pointerup', function(e){
      var d = ovDown; ovDown = null;
      if(!d || !ov.classList.contains('open')) return;
      if(e.target.closest && e.target.closest('.txn-back')) return; // its own handler closes it
      var moved = Math.abs(e.clientX - d.x) > 10 || Math.abs(e.clientY - d.y) > 10;
      var held  = (Date.now() - d.t) >= 400;
      var sel   = (window.getSelection && String(window.getSelection())) || '';
      if(!moved && !held && !sel) ov.classList.remove('open');
    });
    var rowDown = null;
    list.addEventListener('pointerdown', function(e){
      var row = e.target.closest ? e.target.closest('.history-row') : null;
      rowDown = row ? { x:e.clientX, y:e.clientY, txn:row.getAttribute('data-txn') } : null;
    }, true);
    list.addEventListener('pointerup', function(e){
      if(!rowDown) return;
      var dx = Math.abs(e.clientX - rowDown.x), dy = Math.abs(e.clientY - rowDown.y);
      var txn = rowDown.txn; rowDown = null;
      if(dx < 8 && dy < 8 && txn != null) openDetail(parseInt(txn,10));
    }, true);
    list.addEventListener('pointercancel', function(){ rowDown = null; }, true);
    list.addEventListener('click', function(e){
      if(window.PointerEvent) return;
      var row = e.target.closest ? e.target.closest('.history-row') : null;
      if(row && row.getAttribute('data-txn') != null) openDetail(parseInt(row.getAttribute('data-txn'),10));
    });

    /* Balance summary: derive the header cards + balance pills from the full txn
       history so they always match the list (dummy front-end data; no backend). */
    var summaryMain = screen.querySelector('.account-main');
    function summaryCell(label){
      if(!summaryMain) return null;
      var srows = summaryMain.querySelectorAll('.simple-row');
      for(var i=0;i<srows.length;i++){
        var lab = srows[i].querySelector('.money-card-label');
        if(lab && lab.textContent.trim().toLowerCase() === label) return srows[i].querySelector('.money-card-value');
      }
      return null;
    }
    var cellQr=summaryCell('qr scans'), cellRef=summaryCell('referrals'), cellOrd=summaryCell('orders'),
        cellPend=summaryCell('cashback pending'), cellDep=summaryCell('cashback deposited'),
        cellCashed=summaryCell('cashed out');
    var QR_SCANS = isDemoMode() ? DEMO.qrScans : (cellQr ? (parseInt(cellQr.textContent,10)||0) : 0); // standalone: scans aren't in the referral txns
    function gbpP(p){ return '£'+(p/100).toFixed(2); }
    function computeTotals(){
      var pend=0, dep=0, cashed=0, orders=0, friends={};
      for(var k=0;k<txns.length;k++){
        var t=txns[k];
        friends[t.name]=1;                 // referral counted even if the order is later cancelled
        if(t.cancelled) continue;          // a returned order leaves cashback + order count
        orders++;
        if(t.st==='pending') pend+=Math.round(t.amt*100);
        else if(t.st==='cashed_out') cashed+=Math.round(t.amt*100);
        else dep+=Math.round(t.amt*100);
      }
      return { pending:pend, deposited:dep, cashedOut:cashed, orders:orders,
        referrals:Object.keys(friends).length, qrScans:QR_SCANS };
    }
    function applySummary(){
      var referrals, pending, deposited, cashedOut, scans, known;
      if(isDemoMode()){
        // PROTOTYPE PATH — curated, self-consistent figures, no backend involved.
        // Its QR-scan figure is the one already in the markup; it is presented as
        // part of a prototype, not asserted to a real customer about their account.
        var c = computeTotals();
        referrals = c.orders;                 // every referral ended in an order -> referrals = orders
        pending = c.pending; deposited = c.deposited; cashedOut = c.cashedOut;
        scans = QR_SCANS;
        known = true;
      } else {
        // LIVE PATH — every figure here is a statement to a real customer about
        // their own money, so it may only ever be something the server actually said.
        var ref = window.__hugReferral;
        // No balance object yet, or one explicitly flagged unknown (failed/pending
        // read), means we do not know. renderReferralBalance owns that flag and
        // already blanks the home pill on it; the account cells now honour it too,
        // instead of printing a confident "£0.00 / 0" over a read that never landed.
        known = !!(ref && ref.known !== false);
        ref = ref || {};
        referrals = ref.count || 0;
        pending = ref.pendingCents || 0; deposited = ref.availableCents || 0; cashedOut = ref.cashedOutCents || 0;
        // QR scans: there is NO scan counter in the backend. The previous code
        // printed Math.round(referrals * 2.8) and showed that invention to the
        // customer as fact — 3 referrals were reported as "8 QR scans". Nothing
        // honest can be said here until a real server-side count exists, so say
        // nothing. Do not substitute a different multiplier.
        scans = null;
      }
      if(summaryMain) summaryMain.dataset.balanceState = known ? 'known' : 'unknown';
      if(cellQr) cellQr.textContent = scans == null ? UNKNOWN : String(scans);
      if(cellRef) cellRef.textContent = known ? String(referrals) : UNKNOWN;
      if(cellPend) cellPend.textContent = known ? gbpP(pending) : UNKNOWN;
      if(cellDep) cellDep.textContent = known ? gbpP(deposited) : UNKNOWN;
      if(cellCashed) cellCashed.textContent = known ? gbpP(cashedOut) : UNKNOWN;
      renderSummaryError(!known && !!(window.__hugReferral && window.__hugReferral.loadFailed));
      return { pending:pending, deposited:deposited, cashedOut:cashedOut, referrals:referrals, scans:scans, known:known };
    }
    // "couldn't load — retry" under the summary cells. Only shown once a read has
    // actually FAILED (not merely while one is in flight), so it never nags during boot.
    var summaryErrEl = null;
    function renderSummaryError(show){
      if(!summaryMain) return;
      if(show && !summaryErrEl){
        summaryErrEl = errorRow('couldn’t load your balance', function(){
          if(typeof window.__hugRetryBalance === 'function') window.__hugRetryBalance();
        });
        summaryMain.appendChild(summaryErrEl);
      } else if(!show && summaryErrEl){
        summaryErrEl.remove(); summaryErrEl = null;
      }
    }
    applySummary();

    // Live (fresh) account: load the user's REAL referrals into the history +
    // tag each by bucket; demo keeps its own txns built above.
    function buildLiveTxn(row){
      var d = row.created_at ? new Date(row.created_at) : new Date();
      var st = row.bucket==='pending' ? 'pending' : (row.bucket==='cashed_out' ? 'cashed_out' : 'approved');
      // `(Number(row.reward_cents)||0)/100` turned an absent or RENAMED column into a
      // perfectly plausible £0.00 on every row — a silent, total misstatement of what
      // the customer earned. A missing/unparseable value is unknown, not zero. A real
      // 0 is still a 0.
      var cents = Number(row.reward_cents);
      var amtKnown = row.reward_cents != null && row.reward_cents !== '' && isFinite(cents);
      return { id: row.order_number || ('HUG-'+String(row.id||'').slice(0,8)),
        name: row.name || 'a friend', date: d, amt: amtKnown ? cents/100 : 0, amtKnown: amtKnown, st: st, time: '',
        items: [{ name: row.order_summary || 'order', qty: 1, price: 0 }],
        subtotal: 0, pay: UNKNOWN, channel: row.channel || '', cancelled: false,
        // the rate this row was recorded at, when the server says (referrals.reward_rate)
        rate: (row.reward_rate != null && isFinite(Number(row.reward_rate))) ? Number(row.reward_rate) : null };
    }
    function loadLive(){
      if(isDemoMode()) return;
      var backend = window.HugBackend;
      if(document.documentElement.dataset.accountStatus !== 'active' || !(backend && backend.getReferralHistory)){
        // Signed out / no backend: genuinely nothing to show, and we know that.
        txns = []; histError = false; CURRENT_YEAR = new Date().getFullYear(); render('', true); applySummary(); return;
      }
      // A failed read is NOT an empty account. Both used to render the same blank
      // list, so a customer with referrals was shown "you have none".
      function failed(){ txns = []; histError = true; render('', true); applySummary(); }
      Promise.resolve(backend.getReferralHistory(200)).then(function(res){
        if(!(res && res.ok && Array.isArray(res.rows))) return failed();
        txns = res.rows.map(buildLiveTxn);
        histError = false;
        CURRENT_YEAR = txns[0] ? txns[0].date.getFullYear() : new Date().getFullYear();
        render('', true); applySummary();
      }).catch(failed);
    }
    window.__hugAccountHistory = { loadLive: loadLive, applySummary: applySummary };
    loadLive();
    /* Returning an item cancels a pending order: the order count and pending
       cashback drop; referrals and qr scans are unchanged; the row leaves the list.
       Call window.__hugAccount.cancelOrder("<name>") (a pending entry). */
    window.__hugAccount = {
      totals: computeTotals,
      cancelOrder: function(name){
        var key=String(name||'').trim().toLowerCase(), hit=null;
        for(var k=0;k<txns.length;k++){
          var t=txns[k];
          if(!t.cancelled && t.st==='pending' && t.name.toLowerCase()===key){ hit=t; break; }
        }
        if(!hit) return false;
        hit.cancelled=true;
        render(search ? search.value.trim() : '', true);
        applySummary();
        return true;
      },
      /* Supabase prelude (no backend wired yet): the balance/history is local
         dummy data. When Supabase lands, fetch the referral events and call
         setTransactions(rows) — that is the single swap point. Rows only need the
         shape { name, date, amt, st:'pending'|'approved' }; computeTotals() and the
         renderer then work unchanged, so the UI still works offline and for
         optimistic updates after a scan/link/return. (If you would rather the
         server compute the totals, it can return them and override the derived
         values in applySummary().) */
      setTransactions: function(rows){
        if(!Array.isArray(rows)) return false;
        txns.length = 0;
        rows.forEach(function(r){
          pushTxn(String((r && r.name) || ''),
            (r && r.date instanceof Date) ? r.date : new Date(r && r.date),
            Number(r && r.amt) || 0,
            (r && r.st) === 'pending' ? 'pending' : 'approved');
        });
        render(search ? search.value.trim() : '', true);
        applySummary();
        return true;
      }
    };
  })();


  // Robust copy: navigator.clipboard needs a secure context (https / capacitor://);
  // over the LAN http dev server it's missing, so fall back to a hidden textarea +
  // execCommand. This is why "copy" looked like it did nothing.
  function legacyCopy(val){
    try {
      var ta = document.createElement('textarea');
      ta.value = val; ta.setAttribute('readonly','');
      ta.style.position='fixed'; ta.style.top='-1000px'; ta.style.opacity='0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ta.setSelectionRange(0, val.length); } catch(e){}
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch(e){ return false; }
  }
  function copyText(val){
    val = String(val||'');
    if(!val) return Promise.resolve(false);
    if(window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText){
      return navigator.clipboard.writeText(val).then(function(){return true;}, function(){return legacyCopy(val);});
    }
    return Promise.resolve(legacyCopy(val));
  }
  window.__hugCopy = copyText;

  // Render an SVG QR to a PNG Blob (transparent background by default).
  // Rasterise the QR SVG to a TRANSPARENT (alpha) PNG data URL. The SVG carries
  // explicit width/height so WKWebView rasterises it; clearRect (no fill) keeps the
  // background fully transparent. 1024px = crisp + a reasonable file size.
  function svgToPngDataUrl(svg, size){
    return new Promise(function(resolve){
      try {
        var img = new Image();
        img.onload = function(){
          try {
            var canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            resolve(canvas.toDataURL('image/png'));
          } catch(e){ resolve(null); }
        };
        img.onerror = function(){ resolve(null); };
        img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
      } catch(e){ resolve(null); }
    });
  }
  function dataUrlToBlob(dataUrl){
    try {
      var parts = String(dataUrl).split(',');
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
      var bin = atob(parts[1] || ''), len = bin.length, arr = new Uint8Array(len);
      for(var i = 0; i < len; i++){ arr[i] = bin.charCodeAt(i); }
      return new Blob([arr], { type: mime });
    } catch(e){ return null; }
  }
  // Copy the referral QR as a transparent PNG. ON DEVICE we go through the native
  // pasteboard plugin — WKWebView can't reliably write IMAGES via the web clipboard
  // API and <a download> is a no-op on iOS, which is why the old path "came out with
  // nothing". In a desktop browser/secure context we use the async clipboard; over
  // the LAN http preview (no secure context) we download the PNG instead.
  async function copyQrImage(code){
    code = String(code || '');
    if(!code || !window.HugQr) return false;
    var svg = window.HugQr.render(referralUrl(code), { ecc:'M', transparent: true });
    var dataUrl = await svgToPngDataUrl(svg, 1024);
    if(!dataUrl) return false;
    // 1) Native iOS pasteboard (the reliable path on device).
    if(window.HugBackend && typeof window.HugBackend.copyImagePng === 'function'){
      try { var r = await window.HugBackend.copyImagePng(dataUrl); if(r && r.ok) return true; } catch(e){}
    }
    // 2) Web async clipboard (desktop browsers / https).
    if(window.isSecureContext && navigator.clipboard && window.ClipboardItem){
      try {
        var blob = dataUrlToBlob(dataUrl);
        if(blob){ await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); return true; }
      } catch(e){}
    }
    // 3) Last resort (browser preview over http): download the PNG.
    try {
      var dl = dataUrlToBlob(dataUrl); if(!dl) return false;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(dl);
      a.download = 'hug-referral-' + code + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
      return true;
    } catch(e){ return false; }
  }
  window.__hugCopyQrImage = copyQrImage;

  (function profileShare(){
    Array.prototype.forEach.call(document.querySelectorAll('.copy-btn[data-copy]'), function(btn){
      var label = btn.textContent, timer = null;
      function flash(){
        if(timer) clearTimeout(timer);
        btn.textContent = 'copied'; btn.classList.add('copied');
        timer = setTimeout(function(){ btn.textContent = label; btn.classList.remove('copied'); }, 1200);
      }
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        var line = btn.closest('.share-line');
        if(line && line.querySelector('.share-qr')){
          // The QR's copy button copies the QR IMAGE (transparent PNG), not the URL.
          copyQrImage(referralCode).then(function(){ flash(); });
          return;
        }
        copyText(btn.getAttribute('data-copy')).then(function(){ flash(); });
      });
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){
        btn.addEventListener(ev, function(e){ e.stopPropagation(); });
      });
    });
    // iOS-style share button — opens the native share sheet (email / WhatsApp / …)
    // via the Web Share API; falls back to copying the link off-device.
    var shareBtn = document.getElementById('referral-share');
    if(shareBtn){
      shareBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var code = String(referralCode || ''); if(!code) return;
        // Link straight to the Shopify product picker with the referral baked in:
        //   ?ref=<code>      → drives the friend's discount (the server's rate: a flat 5%) + credits THIS user (hug-referral.js)
        //   &ref_name=<user> → shows "<username>'s referral" at checkout (personable)
        // (Branded thehuggable.co domain → swap the host once it's connected to Shopify.)
        var name = String(window.__hugRefName || '');
        var url = 'https://zyeeke-kx.myshopify.com/products/hug-o?ref=' + encodeURIComponent(code) + (name ? '&ref_name=' + encodeURIComponent(name) : '');
        // ONE template, translated whole by the dictionary, then the friend's rate dropped in:
        // The server's current friend rate (a flat 5% since 2026-10-13). No concatenated fragments.
        var pct = (window.__hugReferralRates ? window.__hugReferralRates.friendPercent() : 5) + '%';
        var tpl = 'Every drink in one cup — brewer, cold brew, shaker, bottle, insulated cup. Nine heights, all in your pocket. Here’s {pct} off your first hug:';
        var text = hugTpl(tpl, { pct: pct });
        var payload = { title: 'hug', text: text, url: url, dialogTitle: 'Share your hug link' };
        // Native share sheet first (reliable on iOS + Android), then Web Share, then copy.
        Promise.resolve(window.HugBackend && window.HugBackend.shareLink ? window.HugBackend.shareLink(payload) : { ok:false })
          .then(function(res){
            if(res && res.ok) return;
            if(navigator.share){ navigator.share({ title: payload.title, text: text, url: url }).catch(function(){}); return; }
            copyText(url).then(function(){ showToast('Referral link copied'); });
          });
      });
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){ shareBtn.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    }
  })();


  // Master referral QR: render the user's real QR into the big QR screen + the
  // small centre nav thumbnails — but only when ACTIVE (account + a linked product
  // = gate "ready"). Guests get a nudge to set up; account-without-product gets a
  // nudge to link one. They always HAVE a master QR; it's only live once linked.
  (function masterQrFeature(){
    var mainQr = document.querySelector('.screen[data-screen="qr"] .main-qr');
    var qrContent = document.querySelector('.screen[data-screen="qr"] .qr-content');
    var nudge = null;
    if(qrContent){ nudge = document.createElement('div'); nudge.className = 'qr-nudge'; qrContent.appendChild(nudge); }
    function dataUri(code){
      // Transparent (no white panel): on the opaque white app it's black-on-white
      // (scannable) and blends in. Crucially this removes the opaque-white QR that,
      // on a non-opaque WebView, makes iOS render the rest of the page grey. The
      // download/copy QRs keep their white panel (for sharing/printing) elsewhere.
      var svg = window.HugQr ? window.HugQr.render(referralUrl(code), { ecc:'M', transparent: true }) : '';
      return svg ? ('data:image/svg+xml;utf8,' + encodeURIComponent(svg)) : '';
    }
    function setIcons(src){
      if(mainQr) mainQr.src = src;
      Array.prototype.forEach.call(document.querySelectorAll('.nav-icon.qr-icon'), function(img){ img.src = src; });
    }
    function render(){
      var gate = document.documentElement.dataset.referral; // guest | locked | ready
      if(gate === 'ready' && referralCode){
        var uri = dataUri(referralCode);
        if(uri) setIcons(uri);
        if(mainQr) mainQr.classList.add('qr-live');
        if(nudge){ nudge.classList.remove('show'); nudge.innerHTML = ''; }
        return;
      }
      setIcons('assets/icon-qr.svg');
      if(mainQr) mainQr.classList.remove('qr-live');
      if(!nudge) return;
      var locked = gate === 'locked';
      nudge.innerHTML =
        '<p class="qr-nudge-msg">' + (locked
          ? 'Link a product to activate your referral QR.'
          : 'Set up an account to get your own referral QR.') + '</p>' +
        '<button class="qr-nudge-btn" type="button">' + (locked ? 'link a product' : 'set up account') + '</button>';
      nudge.classList.add('show');
      nudge.querySelector('.qr-nudge-btn').addEventListener('click', function(){
        if(locked){ var s = document.querySelector('.screen.active .bottom-nav button[data-go="scan"]'); if(s) s.click(); }
        else if(window.__hugAuth){ window.__hugAuth.open('signin'); }
      });
    }
    window.__hugMasterQr = { render: render };
    render();
  })();

  // Cash out: when the deposited balance reaches £20 the card pulses; tapping it
  // opens an on-theme confirm (amount, fee if under £20, bank ending) and runs the
  // existing referral-cashout backend (a Stripe transfer to the referrer's own Stripe account,
  // which pays it into their bank). Prototype mode moves nothing: it says "Cashed out" on a note
  // that plainly says it is the sample, and the sample balance stays loaded (owner, 2026-10-17).
  // Live, the server refuses until the referrer has a bank on Stripe (needs-onboarding): the app
  // then offers Stripe's own bank page (startPayoutSetup → its hosted link), so bank details are
  // typed into Stripe and never into hug. Tapping Cash out also chooses bank payouts
  // (not-cash-method → setPayoutMethod('cash')): that tap is the customer asking for cash.
  (function cashoutFeature(){
    var card = document.querySelector('.account-main .simple-row.wide.approved');
    if(!card) return;
    var MIN = 2000; // £20 free-cash-out threshold (under £20 carries a £2 fee).
    var BANK_STARTED = 'hug_bank_setup_started';
    function avail(){ var r = window.__hugReferral || {}; return r.availableCents || 0; }
    function gbp(c){ return '£' + (c/100).toFixed(2); }
    function refresh(){ card.classList.toggle('cashable', avail() >= MIN); }
    window.__hugCashout = { refresh: refresh };
    function be(){ return window.HugBackend || {}; }
    function call(name){
      var f = be()[name];
      var args = Array.prototype.slice.call(arguments, 1);
      return f ? Promise.resolve(f.apply(be(), args)).catch(function(){ return { ok: false }; }) : Promise.resolve({ ok: false });
    }
    function startedBank(){ try { return localStorage.getItem(BANK_STARTED) === '1'; } catch(e){ return false; } }
    function markBank(){ try { localStorage.setItem(BANK_STARTED, '1'); } catch(e){} }
    var busy = false;

    function sayResult(res, net){
      if(res && res.ok){
        showToast('Cashing out ' + gbp(res.netCents || net) + ' — it’ll arrive shortly.');
        if(typeof refreshReferralBalanceFromServer === 'function') refreshReferralBalanceFromServer();
      } else if(res && res.status === 'below-minimum'){ showToast('A little more cashback is needed before you can cash out.'); }
      else { showToast('Couldn’t cash out right now. Please try again.'); }
    }
    // When the Stripe page closes, ask Stripe again (the account exists by then, so this only
    // re-reads it and records whether payouts are on).
    async function afterBankPage(){
      var s = await call('startPayoutSetup');
      if(s && s.ok && s.status === 'ready') showToast('Bank details added. Tap Cash out to send your cashback.');
      else showToast('Bank setup isn’t finished yet. Tap Cash out to carry on.');
    }
    // Returns a cash-out result once the bank is ready, or null when the customer is off on
    // Stripe's page (or said not now).
    async function withBank(){
      // Already started on this phone: Stripe may have finished checking since. Ask it quietly
      // before showing the add-your-bank step again.
      if(startedBank()){
        var q = await call('startPayoutSetup');
        if(q && q.ok && q.status === 'ready') return call('cashOutNow');
      }
      var go = await showConfirm({ title: 'Add your bank',
        body: 'To cash out, add your bank details with Stripe, our payments partner. You type them on Stripe’s secure page, never in the hug app.',
        confirm: 'Add bank details', cancel: 'Not now' });
      if(!go) return null;
      var s = await call('startPayoutSetup');
      if(s && s.ok && s.status === 'ready') return call('cashOutNow');
      if(s && s.ok && s.status === 'onboarding' && s.url){
        markBank();
        var links = window.HugLinks;
        var opened = links && links.open ? await links.open(s.url, afterBankPage) : false;
        if(!opened) showToast('Couldn’t open bank setup. Please try again.');
        return null;
      }
      showToast('Couldn’t open bank setup. Please try again.');
      return null;
    }

    async function startCashout(){
      if(busy) return;
      var a = avail();
      if(a <= 0){ showToast('No cashback to cash out yet.'); return; }
      var demo = isDemoMode();
      var last4 = demo ? DEMO.bankLast4 : (window.__hugBankLast4 || '');
      var acct = last4 ? ('your bank account ending ••' + last4) : 'your bank';
      var fee = a >= MIN ? 0 : 200;
      var net = Math.max(0, a - fee);
      var body = fee
        ? ('Cash out ' + gbp(a) + ' to ' + acct + '? A £2 transfer fee applies under £20, so you’ll receive ' + gbp(net) + '. (Free once you reach £20.)')
        : ('Cash out ' + gbp(a) + ' to ' + acct + '? No fee.');
      var ok = await showConfirm({ title: 'Cash out', body: body, confirm: 'Cash out', cancel: 'Not now' });
      if(!ok) return;
      if(demo){
        showNote({ title: 'Cashed out', amount: gbp(net), returnFocus: card,
          lines: ['This is the sample app, so no real money moved.', 'In the real app, this sends it to your bank account.'] });
        return;
      }
      busy = true;
      try {
        var res = await call('cashOutNow');
        if(res && res.status === 'not-cash-method'){
          var m = await call('setPayoutMethod', 'cash');
          if(m && m.ok) res = await call('cashOutNow');
        }
        if(res && res.status === 'needs-onboarding'){
          res = await withBank();
          if(!res) return;
          if(res.status === 'needs-onboarding'){ showToast('Bank setup isn’t finished yet. Tap Cash out to carry on.'); return; }
        }
        sayResult(res, net);
      } finally { busy = false; }
    }
    card.addEventListener('click', startCashout);
    refresh();
  })();

  // CASHBACK PENDING: tap the card and a short note comes to the front of the screen saying why
  // it waits (owner, 2026-10-16: "it should come to the fore and not be a kind of drop down"); the
  // app's own pop-out card (showConfirm's look), with one button. Each line is the server's rule,
  // not a guess: record_referral holds a reward for a month (matures_at = now() + interval
  // '1 month'); settle_matured_referrals then makes it available, which the app shows as
  // deposited; apply_referral_refund takes a return's share off the reward (all of it on a full
  // refund). The note sits outside the phone's tap handlers (on body), so closing it never also
  // counts as the account screen's tap-to-go-back.
  (function pendingNote(){
    var screen = document.querySelector('.screen[data-screen="account"]');
    var card = screen && screen.querySelector('.account-main .simple-row.wide.pending');
    if(!card) return;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-haspopup', 'dialog');
    var LINES = ['Cashback is held for a month after your friend’s order, while it can still be returned.',
                 'Once the returns window has closed, it’s deposited and ready to spend.',
                 'If anything is returned, the cashback on it comes off.'];
    var closeNote = null;
    function open(){
      if(closeNote) return;
      closeNote = showNote({ title: 'Cashback pending', lines: LINES, returnFocus: card,
        onClose: function(){ closeNote = null; } });
    }
    function close(){ if(closeNote) closeNote(); }
    card.addEventListener('click', function(e){ e.stopPropagation(); open(); });
    card.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); open();
    });
    new MutationObserver(function(){ if(!screen.classList.contains('active')) close(); })
      .observe(screen, { attributes: true, attributeFilter: ['class'] });
  })();

  // Shop credit: spend the referral balance on the next order. The server (referral-spend) turns
  // the balance into Shopify gift card(s); the basket shows a "Use my balance" switch (on by
  // default) and the amount that comes off, and checkout pays with the card codes. Status is
  // cached and re-read at most once a minute (and only when the basket / balance screen opens).
  // Prototype mode makes no real call: it shows the sample balance and never reaches the pay step.
  (function shopCreditFeature(){
    var TTL = 60000, RETRY = 15000;
    var row = document.getElementById('credit-row');
    var toggle = document.getElementById('credit-toggle');
    var line = document.getElementById('checkout-credit');
    var lineValue = document.getElementById('checkout-credit-value');
    var note = document.getElementById('spend-note');
    var noteLine = document.getElementById('spend-note-line');
    var noteValue = document.getElementById('spend-note-value');
    if(!row || !toggle || !line || !lineValue || !note) return;
    var status = null, statusAt = 0, failedAt = 0, inflight = null, lastGrand = 0, haveGrand = false;
    function gbp(c){ return '£' + (c/100).toFixed(2); }
    function signedIn(){ return accountStatus === 'active'; }
    function spendable(){
      if(!signedIn()) return 0;
      if(isDemoMode()) return Math.max(0, (window.__hugReferral && window.__hugReferral.availableCents) || 0);
      // Not gated on status.enabled: with the server switch off, existing cards are still the customer's money.
      return status && status.ok ? Math.max(0, status.spendableCents || 0) : 0;
    }
    // The customer's own choice (default ON), kept apart from toggle.checked: greying the switch out
    // when there is nothing to spend must never lose it.
    var choice = true;
    function on(){ return choice && !toggle.disabled; }
    function render(grand){
      if(typeof grand === 'number'){ lastGrand = grand; haveGrand = true; }
      var sp = spendable();
      var grandCents = Math.round(Math.max(0, lastGrand) * 100);
      // The row is ALWAYS there. With nothing to spend it is disabled, off and greyed.
      var show = sp > 0 && grandCents > 0;
      toggle.disabled = !show;
      toggle.checked = show && choice;
      toggle.setAttribute('aria-disabled', show ? 'false' : 'true');
      row.classList.toggle('is-disabled', !show);
      var credit = show && choice ? Math.min(sp, grandCents) : 0;
      line.hidden = credit <= 0;
      if(credit > 0) lineValue.textContent = '−' + gbp(credit);
      if(haveGrand){
        var totalEl = document.getElementById('checkout-total-value');
        if(totalEl) totalEl.textContent = gbp(grandCents - credit);
      }
      // Account note: only when there is something to spend.
      var dep = (window.__hugReferral && window.__hugReferral.availableCents) || 0;
      note.hidden = sp <= 0;
      noteLine.hidden = sp <= 0 || sp === dep;
      if(sp > 0) noteValue.textContent = gbp(sp);
    }
    function ensure(){
      if(!signedIn()){ status = null; statusAt = 0; render(); return Promise.resolve(); }
      if(isDemoMode()){ render(); return Promise.resolve(); }
      var now = Date.now();
      if(inflight) return inflight;
      if((status && now - statusAt < TTL) || (now - failedAt < RETRY)) return Promise.resolve();
      var be = window.HugBackend;
      if(!be || !be.enabled || !be.getShopCredit) return Promise.resolve();
      inflight = be.getShopCredit().then(function(res){
        if(res && res.ok){ status = res; statusAt = Date.now(); failedAt = 0; } else { failedAt = Date.now(); }
      }).catch(function(){ failedAt = Date.now(); }).then(function(){ inflight = null; render(); });
      return inflight;
    }
    // Any route into the basket or the balance screen (tap, swipe, deep link) ends with the
    // screen gaining .active, so watch that rather than hooking each navigation path.
    var obs = new MutationObserver(function(muts){
      muts.forEach(function(m){ if(m.target.classList.contains('active')) ensure(); });
    });
    ['checkout', 'account'].forEach(function(n){
      var el = document.querySelector('.screen[data-screen="' + n + '"]');
      if(el){ obs.observe(el, { attributes: true, attributeFilter: ['class'] }); if(el.classList.contains('active')) ensure(); }
    });
    // True when the switch is showing and on: the pay step should then prepare the balance.
    function wantsToSpend(){
      return signedIn() && !isDemoMode() && on() && spendable() > 0;
    }
    // Issue the card(s) and return every code. Never throws. { ok:true, codes } | { ok:false }.
    async function prepare(){
      var be = window.HugBackend;
      var res;
      // The server converts only what this order needs: send the basket total shown before credit.
      var amount = Math.round(Math.max(0, lastGrand) * 100);
      var shown = Math.min(spendable(), amount);
      try { res = await (be && be.prepareShopCredit ? be.prepareShopCredit(amount) : Promise.resolve({ ok: false })); }
      catch(e){ res = { ok: false }; }
      if(!res || !res.ok || !Array.isArray(res.cards)) return { ok: false };
      // ok but no cards, or cards worth clearly less than the credit line on screen, is a failure:
      // paying would silently charge more than the basket showed.
      var have = res.cards.reduce(function(n, c){ return n + (c.balanceCents || 0); }, 0);
      if(!res.cards.length || have < shown - 2){
        status = res; statusAt = Date.now();
        render();
        return { ok: false };
      }
      status = res; statusAt = Date.now();
      // New card: the balance moved into it, so the deposited figure is stale.
      if(res.createdCents > 0 && typeof refreshReferralBalanceFromServer === 'function') refreshReferralBalanceFromServer();
      return { ok: true, codes: res.cards.map(function(c){ return c.code; }) };
    }
    toggle.addEventListener('change', function(){ if(!toggle.disabled) choice = toggle.checked; render(); });
    window.__hugShopCredit = { render: render, ensure: ensure, wantsToSpend: wantsToSpend, prepare: prepare };
  })();

  // Balance rows: "CASHBACK DEPOSITED" etc. stay on ONE line next to the chevron and the amount.
  // CSS keeps them from wrapping (white-space: nowrap); when a long translation plus a big amount
  // still would not fit the row, the label's font shrinks a half-pixel at a time until it does,
  // so nothing wraps, overlaps or clips. Re-fitted whenever the text, the row's size or the fonts change.
  (function balanceFit(){
    var rows = Array.prototype.slice.call(document.querySelectorAll('.account-main .simple-row.wide'));
    if(!rows.length) return;
    var MIN = 7, queued = false, busy = false;
    function fit(row){
      var label = row.querySelector('.money-card-label');
      if(!label) return;
      label.style.fontSize = '';
      var rr = row.getBoundingClientRect();
      if(!rr.width || !row.offsetWidth) return;                 // not laid out (hidden): nothing to measure
      var k = rr.width / row.offsetWidth;                       // the phone is scaled on narrow screens
      var gap = (parseFloat(getComputedStyle(row).columnGap) || 0) * k;
      var size = parseFloat(getComputedStyle(label).fontSize);
      function over(){
        var l = label.getBoundingClientRect(), limit = rr.right - (parseFloat(getComputedStyle(row).paddingRight) || 0) * k;
        Array.prototype.forEach.call(row.children, function(c){
          if(c === label) return;
          var r = c.getBoundingClientRect();
          if(r.width > 0 && r.left >= l.left) limit = Math.min(limit, r.left - gap);
        });
        return l.right > limit + 0.5;
      }
      while(size > MIN && over()){ size -= 0.5; label.style.fontSize = size + 'px'; }
    }
    function run(){
      queued = false; busy = true;
      rows.forEach(fit);
      busy = false;
    }
    function queue(){ if(busy || queued) return; queued = true; requestAnimationFrame(run); }
    if(window.ResizeObserver){ var ro = new ResizeObserver(queue); rows.forEach(function(r){ ro.observe(r); }); }
    if(window.MutationObserver){
      var mo = new MutationObserver(queue);
      rows.forEach(function(r){ mo.observe(r, { childList: true, characterData: true, subtree: true }); });
    }
    window.addEventListener('resize', queue);
    if(document.fonts && document.fonts.ready) document.fonts.ready.then(queue);
    queue();
  })();

  (function leaderboardFeature(){
    var screen = document.querySelector('.screen[data-screen="home"]');
    if(!screen) return;
    var content = screen.querySelector('.home-content');
    var board = screen.querySelector('.leaderboard');
    var wrap = screen.querySelector('.leader-wrap');
    var list = screen.querySelector('.leader-list');
    var titleEl = screen.querySelector('.leader-title');
    if(!content || !board || !wrap || !list || !titleEl) return;

    // Real global leaderboard from referral_leaderboard() (the same RPC the
    // website account page uses, so app + web rank identically). Rows:
    // { label, referrals, is_me }. Authenticated-only; empty state otherwise.
    var GLANCE = 10;
    var open = false;
    var loading = false;
    var rows = [];
    /* LAST KNOWN BOARD, painted on frame one.
       The board used to start empty, render the "refer a friend to climb the leaderboard" line,
       and then pop its real rows in ~1.5s later on a phone, pushing that line down. That line
       was also untrue for those 1.5s: an unanswered read is not an empty board. So:
         · the last board this device saw is kept, and drawn at once — like the balance and
           the points hero, the network then only confirms it;
         · with nothing cached, the board draws NOTHING until the read answers (the launch
           checklist waits for it), rather than guessing "empty";
         · an answer identical to what is on screen is not redrawn at all.
       The cache is keyed to whoever it was read for, because rows carry is_me: a board read
       while signed in must never show "you" to the next person to open the app. */
    var LB_CACHE_KEY = 'hug-leaderboard-cache-v2';   // keep equal to HUG_LEADERBOARD_CACHE_KEY
    var answered = false;       // a real answer (rows, or a confirmed-empty board) is on screen
    var shownFor = null;        // whose board that is — rows carry is_me, so it is not portable
    function lbWho(){
      var h = document.documentElement;
      if(h.dataset.accountStatus !== 'active') return 'guest';
      try { return 'u:' + String(localStorage.getItem('hug-account-email-v1') || '').trim().toLowerCase(); } catch(e){ return 'u:'; }
    }
    // The board ranks TOKENS now (6 per hug + 1 per referral, referral_leaderboard().tokens).
    // An older backend sends only eco_points (25 / 5) plus the mugs and referrals behind it, so
    // the same formula is applied to those rather than showing eco points under a tokens name.
    function boardTokens(x){
      var t = Number(x.tokens);
      if(x.tokens != null && isFinite(t)) return t;
      var m = Number(x.mugs), r = Number(x.referrals);
      if(x.mugs != null && x.referrals != null && isFinite(m) && isFinite(r)) return 6 * m + r;
      return Number(x.eco_points) || 0;
    }
    function loadCachedBoard(){
      try {
        var c = JSON.parse(localStorage.getItem(LB_CACHE_KEY) || 'null');
        if(!c || c.who !== lbWho() || !Array.isArray(c.rows)) return null;
        return c.rows.filter(function(r){ return r && typeof r.label === 'string'; })
          .map(function(r){ return { label: r.label, points: Number(r.points) || 0, me: !!r.me }; });
      } catch(e){ return null; }
    }
    function saveCachedBoard(list){
      var payload = JSON.stringify({ who: lbWho(), rows: list.slice(0, 50) });
      try { localStorage.setItem(LB_CACHE_KEY, payload); } catch(e){}
      // …and the durable copy, which is what a launch after a WebKit storage eviction reads back
      // (restoreDurableAccountState). Same fire-and-forget queue as the balance and the points.
      try { if(window.__hugDurable) window.__hugDurable.set(LB_CACHE_KEY, payload); } catch(e){}
    }
    function clearCachedBoard(){
      try { localStorage.removeItem(LB_CACHE_KEY); } catch(e){}
      try { if(window.__hugDurable) window.__hugDurable.remove(LB_CACHE_KEY); } catch(e){}
    }
    // Drop whatever is on screen: nothing is known any more. Used when the account changes
    // (a board read for someone else must not stay up — least of all its "you" row) and by
    // the honesty test to set up a board with nothing to show.
    function forget(){ rows = []; answered = false; boardError = false; shownFor = null; render(open); }
    // true once a leaderboard read has FAILED — kept separate from "rows is empty",
    // which is a real answer. See render().
    var boardError = false;
    // The prototype's leaderboard (DEMO.board): you at #6 in a field of 260, eco points on the
    // real 25-per-mug + 5-per-referral scale. Built only in prototype mode.
    var DEMO_ROWS = isDemoMode() ? DEMO.board(260) : [];
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function render(full){
      if(!rows.length){
        // A FAILED read is not an empty board. The old code set rows=[] on failure
        // "so the board never looks broken/empty" — which is exactly backwards: it made
        // a broken read look like a real, empty leaderboard.
        if(boardError){
          list.textContent = '';
          var box = document.createElement('div'); box.className = 'load-error';
          var msg = document.createElement('span'); msg.className = 'load-error-msg';
          msg.textContent = 'couldn’t load the leaderboard';
          box.appendChild(msg);
          var btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'load-error-retry'; btn.textContent = 'retry';
          ['pointerdown','touchstart','pointermove'].forEach(function(ev){
            btn.addEventListener(ev, function(e){ e.stopPropagation(); });
          });
          btn.addEventListener('click', function(e){ e.stopPropagation(); load(); });
          box.appendChild(btn);
          list.appendChild(box);
          return;
        }
        // Not answered yet: say nothing. "Refer a friend to climb" is the answer for a board
        // that is really empty, and stating it before the read lands was a guess.
        list.textContent = '';          // owner, 2026-10-10: no "refer a friend" line, empty or not
        return;
      }
      var n = full ? rows.length : Math.min(GLANCE, rows.length), html = '';
      for(var i=0; i<n; i++){
        var r = rows[i];
        html += '<div class="leader-row'+(r.me?' is-me':'')+'"><span>'+esc(r.label)+'</span><span>'+r.points+'</span></div>';
      }
      list.innerHTML = html;
    }
    // The last board this device drew for the current identity, painted as the answer: the launch
    // checklist ticks the board off here, and the network then only confirms it. False when
    // there is nothing cached for this identity.
    function paintFromCache(){
      var cached = isDemoMode() ? null : loadCachedBoard();
      if(!(cached && cached.length)) return false;
      rows = cached; answered = true; boardError = false; shownFor = lbWho(); render(open); settled();
      return true;
    }
    function load(){
      // Signed in or out since this board was drawn: it belongs to someone else now. Drop it,
      // and paint the new identity's own last-known board if this device has one.
      if(shownFor !== null && shownFor !== lbWho()) forget();
      // Nothing on screen yet for this identity: the cached board, if any. On EVERY call, and
      // ahead of the in-flight check: on a phone whose localStorage was evicted, the durable
      // restore puts the cache back a few ms after this feature first drew — by which time the
      // read below is already in flight, and the first version of this returned right here.
      // The cover then waited on the network for the one part it did not need to.
      if(!answered) paintFromCache();
      if(loading) return;
      // Prototype/demo mode: curated rankings, no backend call.
      if(isDemoMode()){ rows = DEMO_ROWS.slice(); answered = true; render(open); settled(); return; }
      // Live build: the leaderboard is public (anon can read referral_leaderboard),
      // so it shows whether signed in or not.
      // "No backend YET" is not "no backend". app.js runs before native-bridge.js, so this
      // first call always saw no HugBackend and drew the empty-board line — the false
      // "refer a friend to climb" a launch showed before the real rows arrived. Wait for the
      // post-bridge call instead (below); only a bridge that says it is disabled is an answer.
      if(!window.HugBackend) return;
      if(!window.HugBackend.enabled){
        rows = []; boardError = false; answered = true; render(open); settled(); return;
      }
      loading = true;
      function failed(){
        // A board already on screen for THIS account stays up over a failed refresh: it is
        // last-known, not wrong — the same rule as the balance and the points hero. With
        // nothing (or someone else's board) to show, the failure gets the error state, never
        // the "refer a friend" line.
        if(!(answered && rows.length && shownFor === lbWho())){ rows = []; boardError = true; answered = true; shownFor = lbWho(); render(open); }
        settled();
      }
      fetchLeaderboardOnce().then(function(res){
        if(!(res && res.ok && Array.isArray(res.rows))) return failed();
        var next = res.rows.map(function(x){ return { label: x.label, points: boardTokens(x), me: !!x.is_me }; });
        saveCachedBoard(next);
        var same = answered && !boardError && JSON.stringify(next) === JSON.stringify(rows);
        rows = next; boardError = false; answered = true; shownFor = lbWho();
        // Show the global top standings to EVERYONE (even a fresh 0-point account).
        // A not-yet-ranked viewer still gets the "refer to climb" nudge under the
        // list (see render()) — but a FAILED read gets the error state, not that nudge.
        if(!same) render(open);   // identical to what is showing: leave the DOM alone
        settled();
      }).catch(failed).then(function(){ loading = false; });
    }
    function settled(){ if(window.__hugBoot) window.__hugBoot.release('boot-leaderboard'); }
    window.__hugLeaderboard = { load: load, forget: function(){ forget(); clearCachedBoard(); } };
    if(!paintFromCache()) render(open);   // nothing cached: the (silent) empty board, see render()

    var head = document.createElement('div'); head.className = 'leader-head';
    titleEl.parentNode.insertBefore(head, titleEl); head.appendChild(titleEl);
    var plus = document.createElement('button');
    plus.className = 'leader-plus'; plus.type = 'button';
    plus.setAttribute('aria-label','Show full leaderboard');
    plus.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    head.appendChild(plus);
    ['pointerdown','touchstart','pointermove'].forEach(function(ev){
      plus.addEventListener(ev, function(e){ e.stopPropagation(); });
    });

    // The window's height never animates (styles.css, "The + expand is ONE motion"): it takes the
    // open height in one step as the rail starts up, and on a close it HOLDS the open height until
    // the rail has come home, then drops to the closed height. Both steps land below the screen's
    // bottom edge, where the window ends in either state, so neither is seen.
    var closeHold = 0;
    var mover = listSlide(board.closest('.home-leader-rail'), content, 'leader-wa');   // the slide: listSlide, above History
    function releaseCloseHold(){
      clearTimeout(closeHold); closeHold = 0;
      wrap.style.removeProperty('height');
    }
    function setExpand(next){
      open = next;
      var seq = mover.next();
      // A close still sliding home: drop its hold first, or a quick re-open would keep it.
      releaseCloseHold();
      var heldHeight = open ? '' : getComputedStyle(wrap).height;   // read before render() changes the rows
      // Draw the rows the new state calls for. Expanding only resized the window: render() was
      // never re-run, so "show full leaderboard" kept showing the same ten. Invisible on today's
      // live board (the RPC returns the top ten plus you); obvious on a board of 260.
      render(open);
      if(open){
        // Rows past the glance ten are laid out now, below the screen, not in the slide's first frame.
        content.classList.add('leader-prep');
        var cR = content.getBoundingClientRect(), bR = board.getBoundingClientRect(), wR = wrap.getBoundingClientRect();
        var nav = screen.querySelector('.bottom-nav');
        var navTop = nav ? nav.getBoundingClientRect().top : cR.bottom;
        var topInset = 8;   // = the head band's reach above the head (styles.css --head-band-pad), so it is not clipped
        // Convert post-transform (scaled) rect distances back to design px so the
        // shift + window fill the space correctly on scaled screens (see history).
        var fit = window.__hugFit || 1;
        var shift = Math.max(0, (bR.top - cR.top) / fit - topInset);
        var headH = (wR.top - bR.top) / fit;   // negative once the window is pulled up under the head (styles.css --head-pull): the window then grows by that much
        // A WHOLE number of px, like the closed fit (syncResponsiveScrollWindows floors it). With a
        // fractional height (701.47) iOS placed the board's layer one whole pt lower than with the
        // closed one, so it hopped 1 pt the moment the window changed size (simulator, 2026-10-16).
        var winH = Math.round(Math.max(160, (navTop - cR.top) / fit - topInset - headH - 10));
        content.style.setProperty('--leader-shift', (-shift) + 'px');
        wrap.style.setProperty('--leader-window-height', winH + 'px');
        content.classList.add('leader-open');   // the fades, the + turning, all rows; the rail moves in mover.later
        plus.setAttribute('aria-label','Hide full leaderboard');
        try{ list.dispatchEvent(new Event('scroll')); }catch(e){}
        mover.later(seq, function(){
          if(!mover.run(mover.y(), -shift)) content.classList.add('leader-slid');
        });
      } else {
        if(heldHeight) wrap.style.height = heldHeight;
        content.classList.remove('leader-open', 'leader-prep');
        content.style.removeProperty('--leader-shift');
        wrap.style.removeProperty('--leader-window-height');
        plus.setAttribute('aria-label','Show full leaderboard');
        try{ list.dispatchEvent(new Event('scroll')); }catch(e){}
        mover.later(seq, function(){
          if(!mover.run(mover.y(), 0, '')) content.classList.remove('leader-slid');
          closeHold = setTimeout(function(){
            releaseCloseHold();
            try{ list.dispatchEvent(new Event('scroll')); }catch(e){}   // re-read the fade at the closed height
          }, mover.releaseAt());
        });
      }
    }
    plus.addEventListener('click', function(e){ e.stopPropagation(); setExpand(!open); });

    // When expanded, a tap (not a scroll-drag) anywhere on the names list
    // retracts the leaderboard back to the home view.
    var tapX = 0, tapY = 0, tapMoved = false;
    list.addEventListener('pointerdown', function(e){ tapX = e.clientX; tapY = e.clientY; tapMoved = false; }, { passive: true });
    list.addEventListener('pointermove', function(e){ if(Math.abs(e.clientX - tapX) > 10 || Math.abs(e.clientY - tapY) > 10) tapMoved = true; }, { passive: true });
    list.addEventListener('pointerup', function(){ if(open && !tapMoved) setExpand(false); }, { passive: true });

    load();
    // Re-read once native-bridge exists (guests included). NOT gated on
    // readyState === 'loading': these scripts are deferred, so they run at "interactive"
    // with DOMContentLoaded still ahead — that test would fire load() before the bridge
    // exists and leave the board empty. Same mistake, same fix as whenBridgeReady above.
    if (window.HugBackend) load();
    else {
      if (document.readyState !== 'complete') {
        document.addEventListener('DOMContentLoaded', load, { once: true });
      }
      window.addEventListener('load', load, { once: true });
    }
  })();

  // ---------------------------------------------------------------------------------------
  // HOME IMPACT ROW — a two-panel carousel (people: water/food/sanitation, first since 2026-10-18;
  // planet: plastic/carbon/tree). The finger drags the row itself; it is NOT a page swipe. Release past a
  // threshold (or a flick) settles on the other panel, otherwise it snaps back. With two panels
  // the carousel loops by construction: either direction leads to the other panel.
  //
  // Feel is lifted from the bag product carousel: axis lock at 8px / ratio 1.15, drag factor
  // 0.9, commit at max(42, width*0.16) or a 0.45px/ms flick.
  //
  // The row is excluded from the page swipe in canGestureFromPoint AND here (pointerdown /
  // touchstart / pointermove stop propagating), because #phone captures the pointer on
  // pointerdown and would otherwise take the drag.
  //
  // Opening: on a cold launch the row shows people (the primary panel, owner 2026-10-18) for a
  // beat, spins round the loop and slows to a
  // halt on the panel chosen by HugGivingMath.landingPanel (motion: spinCurve/spinAt). A touch on
  // the row cancels the spin. Returning from background after 30s+ re-picks the panel, no spin.
  //
  // Values API (for the rest of the app):
  //   window.__hugImpactRow.set({ water: { value: "47", unit: "days", label: "47 days of safe water" } })
  //   window.__hugImpactRow.show("people" | "planet" | 0 | 1 [, { instant: true }])
  // ---------------------------------------------------------------------------------------
  (function impactRow(){
    var row = document.querySelector('[data-impact-row]');
    if(!row) return;
    var viewport = row.querySelector('.impact-viewport');
    var panels = Array.prototype.slice.call(row.querySelectorAll('.impact-panel'));
    var dots = row.querySelectorAll('.impact-dot');
    if(!viewport || panels.length !== 2) return;

    var LOCK_PX = 8, LOCK_RATIO = 1.15, DRAG_FACTOR = 0.9, SETTLE_MS = 460;
    var COMMIT_MIN_PX = 42, COMMIT_FRACTION = 0.16, FLICK_PX_PER_MS = 0.45;
    var EASE = 'cubic-bezier(.22,.82,.2,1)';
    var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function reduced(){ return !!(reduceMq && reduceMq.matches); }

    var current = 0;          // index of the panel in view
    var animating = false;
    var settleTimer = 0;
    var drag = null;          // { id, x0, y0, locked, dx, samples:[[t,x]] }
    var swallowClick = false;
    var spinning = false, spinTimer = 0, spinRaf = 0, lastSpin = null;   // the opening spin (see openRow)
    var spinWindow = null;   // { start, end } in performance.now() ms, once the spin really moves (tests read it)
    var G = window.HugGivingMath;
    var PANEL_KEY = 'hug-impact-panel-v1';   // { who, panel }: the panel last settled on, per account
    var MIN_AWAY_MS = 30000;                 // away at least this long -> re-pick the panel on return
    var hiddenAt = 0;

    function now(){ return window.performance && performance.now ? performance.now() : Date.now(); }
    function scale(){
      var w = viewport.offsetWidth;
      var r = viewport.getBoundingClientRect();
      return w && r.width ? r.width / w : 1;       // the phone can be CSS-scaled to fit narrow screens
    }
    function width(){ return viewport.offsetWidth || 300; }
    function setT(el, x, ms, ease){
      el.style.transition = ms ? 'transform ' + ms + 'ms ' + (ease || EASE) : 'none';
      el.style.transform = x ? 'translate3d(' + x + 'px,0,0)' : '';
    }
    function reveal(el){ el.removeAttribute('aria-hidden'); }
    function conceal(el){ el.setAttribute('aria-hidden', 'true'); }
    function setDots(i){
      for(var k = 0; k < dots.length; k++) dots[k].classList.toggle('is-on', k === i);
    }
    function clearStyles(el){ el.style.transition = ''; el.style.transform = ''; el.style.opacity = ''; }
    function finish(committed){
      clearTimeout(settleTimer); settleTimer = 0;
      if(committed) current = 1 - current;
      clearStyles(panels[0]); clearStyles(panels[1]);
      conceal(panels[1 - current]); reveal(panels[current]);
      setDots(current);
      animating = false;
      if(!spinning){ persist(); if(pendingSet || pendingActive) setTimeout(flushPending, 0); }
    }

    // dir > 0: content heads right, the other panel enters from the left (and vice versa).
    // ms / ease / done are for the opening spin; a normal slide takes SETTLE_MS and the house ease.
    function slide(dir, ms, ease, done){
      if(animating) return;
      animating = true;
      var cur = panels[current], oth = panels[1 - current];
      reveal(oth);
      setDots(1 - current);
      if(reduced()){
        cur.style.transition = oth.style.transition = 'none';
        oth.style.opacity = '0';
        void oth.offsetWidth;
        cur.style.transition = oth.style.transition = 'opacity 180ms ease';
        cur.style.opacity = '0'; oth.style.opacity = '1';
        settleTimer = setTimeout(function(){ finish(true); if(done) done(); }, 220);
        return;
      }
      var W = width(), dur = ms || SETTLE_MS;
      setT(cur, 0, 0); setT(oth, -dir * W, 0);
      void oth.offsetWidth;
      setT(cur, dir * W, dur, ease); setT(oth, 0, dur, ease);
      settleTimer = setTimeout(function(){ finish(true); if(done) done(); }, dur + (ms ? 16 : 40));
    }
    function settleFromDrag(dx, commit){
      animating = true;
      var cur = panels[current], oth = panels[1 - current];
      var W = width();
      var dir = dx >= 0 ? 1 : -1;
      if(reduced()){
        if(commit){ animating = false; slide(dir); } else { finish(false); }
        return;
      }
      if(commit){
        setDots(1 - current);
        setT(cur, dir * W, SETTLE_MS); setT(oth, 0, SETTLE_MS);
      } else {
        setT(cur, 0, SETTLE_MS); setT(oth, -dir * W, SETTLE_MS);
      }
      settleTimer = setTimeout(function(){ finish(commit); }, SETTLE_MS + 40);
    }

    // ---- drag ---------------------------------------------------------------------------
    function begin(id, x, y){
      if(animating) return;
      drag = { id: id, x0: x, y0: y, locked: false, dx: 0, samples: [[now(), x]] };
    }
    function move(x, y, e){
      if(!drag) return;
      var rawDx = x - drag.x0, rawDy = y - drag.y0;
      if(!drag.locked){
        var ax = Math.abs(rawDx), ay = Math.abs(rawDy);
        if(ax < LOCK_PX && ay < LOCK_PX) return;
        if(ax < ay * LOCK_RATIO){ drag = null; return; }       // vertical: not ours, ignored
        drag.locked = true;
        reveal(panels[1 - current]);
        try { if(drag.id != null) row.setPointerCapture(drag.id); } catch(_) {}
      }
      if(e && e.cancelable) e.preventDefault();
      drag.samples.push([now(), x]);
      if(drag.samples.length > 6) drag.samples.shift();
      var W = width();
      var dx = (rawDx / scale()) * DRAG_FACTOR;
      dx = Math.max(-W, Math.min(W, dx));
      drag.dx = dx;
      if(reduced()) return;                                    // no slide: decide on release
      var base = dx > 0 ? -W : W;
      setT(panels[current], dx, 0);
      setT(panels[1 - current], base + dx, 0);
    }
    function end(cancelled){
      if(!drag) return;
      var d = drag; drag = null;
      try { if(d.id != null) row.releasePointerCapture(d.id); } catch(_) {}
      if(!d.locked) return;
      swallowClick = true; setTimeout(function(){ swallowClick = false; }, 60);
      var W = width();
      var s0 = d.samples[0], s1 = d.samples[d.samples.length - 1];
      var dt = Math.max(1, s1[0] - s0[0]);
      var speed = Math.abs(s1[1] - s0[1]) / scale() / dt;
      var dist = Math.abs(d.dx);
      var commit = !cancelled && (dist >= Math.max(COMMIT_MIN_PX, W * COMMIT_FRACTION) || (speed > FLICK_PX_PER_MS && dist > 6));
      settleFromDrag(d.dx, commit);
    }

    // The row must never reach the page swipe.
    function stop(e){ e.stopPropagation(); }
    row.addEventListener('pointerdown', function(e){
      stop(e);
      cancelSpin();
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      begin(e.pointerId, e.clientX, e.clientY);
    });
    row.addEventListener('pointermove', function(e){
      stop(e);
      if(drag && e.pointerId === drag.id) move(e.clientX, e.clientY, e);
    });
    row.addEventListener('pointerup', function(e){ stop(e); if(drag && e.pointerId === drag.id) end(false); });
    row.addEventListener('pointercancel', function(e){ stop(e); if(drag && e.pointerId === drag.id) end(true); });
    // Touch fallback (no PointerEvent): same logic from touch events.
    var touchOnly = !('PointerEvent' in window);
    row.addEventListener('touchstart', function(e){
      stop(e);
      cancelSpin();
      if(touchOnly){ var t = e.changedTouches[0]; begin(null, t.clientX, t.clientY); }
    }, { passive: true });
    row.addEventListener('touchmove', function(e){
      stop(e);
      if(touchOnly){ var t = e.changedTouches[0]; move(t.clientX, t.clientY, e); }
    }, { passive: false });
    row.addEventListener('touchend', function(e){ stop(e); if(touchOnly) end(false); }, { passive: true });
    row.addEventListener('touchcancel', function(e){ stop(e); if(touchOnly) end(true); }, { passive: true });

    // A drag that ends over the row must not also count as a tap on whatever sits under it.
    row.addEventListener('click', function(e){
      if(swallowClick){ e.preventDefault(); e.stopPropagation(); }
    });

    // ---- values -------------------------------------------------------------------------
    function fitValue(el){
      el.style.fontSize = '';
      var item = el.parentNode;
      var room = item && item.clientWidth;
      if(!room || el.scrollWidth <= room) return;
      var px = parseFloat(window.getComputedStyle(el).fontSize) || 23;
      el.style.fontSize = Math.max(12, Math.floor(px * room / el.scrollWidth * 100) / 100 - 0.5) + 'px';
    }
    function setOne(id, entry){
      var item = row.querySelector('[data-cause="' + id + '"]');
      var el = item && item.querySelector('.impact-value');
      if(!el) return;
      var e = entry && typeof entry === 'object' ? entry : { value: entry };
      // Unchanged figures are not rewritten. The values deferred by a spin are flushed the moment
      // the row lands; rewriting identical text there re-rasterised the panel that had just come to
      // rest, in the same frames as the halt.
      var sig = JSON.stringify([e.value, e.unit, e.label]);
      if(el.__hugSig === sig) return;
      el.__hugSig = sig;
      el.textContent = e.value == null || e.value === '' ? HUG_UNKNOWN : String(e.value);
      // letter-spacing also trails the LAST character, so a bare number sits half that gap left of
      // its icon; .no-unit puts the same gap on the left to centre it (a unit carries its own).
      el.classList.toggle('no-unit', !e.unit);
      if(e.unit){
        var u = document.createElement('span');
        u.className = 'impact-unit';
        u.textContent = String(e.unit);
        el.appendChild(u);
      }
      if(e.label) item.setAttribute('aria-label', String(e.label));
      else item.removeAttribute('aria-label');
      fitValue(el);
    }
    // New figures or a new cause list that arrive mid-spin wait for it to land: rewriting text
    // inside a panel the compositor is moving forces it to re-render that layer, which cost a
    // visible hitch on the iOS simulator (frame 51 of the spin, 2026-10-10). Last one wins.
    var pendingSet = null, pendingActive = null;
    function flushPending(){
      if(spinning) return;
      var a = pendingActive, m = pendingSet;
      pendingActive = pendingSet = null;
      if(a) setActive(a);
      if(m) set(m);
    }
    function set(map){
      if(!map) return;
      if(spinning){ pendingSet = Object.assign(pendingSet || {}, map); return; }
      Object.keys(map).forEach(function(id){ setOne(id, map[id]); });
    }
    function show(panel, opts){
      var idx = typeof panel === 'number' ? panel : idxOf(panel);
      if(idx !== 0 && idx !== 1) return;
      if(spinning){ haltSpin(); finish(false); }
      if(idx === current) return;
      if(animating) finish(false);
      if(opts && opts.instant){ current = idx; finish(false); return; }
      slide(idx === 1 ? -1 : 1);       // the second panel (planet) arrives from the right, the first from the left
    }
    // SPEC §1.4: show only the ACTIVE causes, in sort order. ids = active cause ids in display
    // order. Items not in the markup are ignored; items not listed are hidden (no space, no
    // a11y, and the motion gate skips them). Idempotent: nothing is touched when nothing changed.
    function setActive(ids){
      if(!Array.isArray(ids) || !ids.length) return;
      if(spinning){ pendingActive = ids.slice(); return; }
      panels.forEach(function(p){
        var items = Array.prototype.slice.call(p.querySelectorAll('[data-cause]'));
        items.forEach(function(it){
          var on = ids.indexOf(it.getAttribute('data-cause')) !== -1;
          if(it.hidden === !on) return;
          it.hidden = !on;
          if(on) it.removeAttribute('aria-hidden'); else it.setAttribute('aria-hidden', 'true');
        });
        var shown = items.filter(function(it){ return !it.hidden; })
          .sort(function(a, b){ return ids.indexOf(a.getAttribute('data-cause')) - ids.indexOf(b.getAttribute('data-cause')); });
        var cur = Array.prototype.slice.call(p.querySelectorAll('[data-cause]')).filter(function(it){ return !it.hidden; });
        if(shown.some(function(it, i){ return it !== cur[i]; })) shown.forEach(function(it){ p.appendChild(it); });
      });
      Array.prototype.forEach.call(row.querySelectorAll('.impact-value'), fitValue);
    }
    // ---- which panel, and the opening spin ------------------------------------------------
    // Where the row settles: the panel holding more of the giving when the cause choice is not
    // all-on, else people, the primary panel (owner, 2026-10-18). The pure rule is
    // HugGivingMath.landingPanel; this only feeds it. The panel last viewed is still kept (per
    // account, durable: iOS evicts localStorage) and passed in, but it no longer decides.
    function who(){ try { return String(localStorage.getItem('hug-account-email-v1') || '').trim().toLowerCase(); } catch(e){ return ''; } }
    function lastViewed(){
      try {
        var v = JSON.parse(localStorage.getItem(PANEL_KEY) || 'null');
        if(v && String(v.who || '') === who() && (v.panel === 'planet' || v.panel === 'people')) return v.panel;
      } catch(e){}
      return null;
    }
    function persist(){
      var panel = panelName(current);
      if(lastViewed() === panel) return;
      var raw = JSON.stringify({ who: who(), panel: panel });
      try { localStorage.setItem(PANEL_KEY, raw); } catch(e){}
      try { if(window.__hugDurable) window.__hugDurable.set(PANEL_KEY, raw); } catch(e){}
    }
    function target(){
      var last = lastViewed(), g = window.__hugGiving;
      if(g && g.landing) { try { return g.landing(last); } catch(e){} }
      return 'people';
    }
    // Which panel is which comes from the markup (data-panel), not from the order: people is the
    // first (left, first dot) since 2026-10-18 (owner: "make the people 3 icons ... the highlight
    // on the left").
    function panelName(i){ return (panels[i] && panels[i].getAttribute('data-panel')) || 'people'; }
    function idxOf(name){ return panelName(1) === name ? 1 : 0; }
    function whenOnHome(){
      var home = document.querySelector('.screen[data-screen="home"]');
      return document.visibilityState === 'visible' && (!home || home.classList.contains('active'));
    }
    // A touch on the row ends the spin: freeze it where it is and settle on the nearer panel, so
    // the next drag starts from rest. (Cancelling is a settle, not a jump to the target.)
    var spinAnims = null;     // the running spin, one Web Animation per panel (see spin)
    var calmRaf = 0;          // waiting for the page to be calm before the spin starts
    function haltSpin(){
      spinning = false;
      clearTimeout(spinTimer); spinTimer = 0;
      if(spinRaf && window.cancelAnimationFrame) cancelAnimationFrame(spinRaf);
      if(calmRaf && window.cancelAnimationFrame) cancelAnimationFrame(calmRaf);
      spinRaf = calmRaf = 0;
    }
    // Start the spin only once the page is calm: after `minMs`, as soon as 8 frames in a row have
    // arrived on time, or at `maxMs` regardless. Measured on the iOS simulator: the first launch
    // after an install spun while start-up work was still running and stuttered for its first
    // half second; warm launches were already smooth, and here they start with no extra wait.
    function whenCalm(minMs, maxMs, fn){
      var t0 = 0, last = 0, calm = 0;
      function tick(ts){
        if(!spinning) return;
        if(!t0) t0 = ts;
        calm = last && ts - last <= 20 ? calm + 1 : 0;
        last = ts;
        if((ts - t0 >= minMs && calm >= 8) || ts - t0 >= maxMs){ calmRaf = 0; fn(); return; }
        calmRaf = requestAnimationFrame(tick);
      }
      calmRaf = requestAnimationFrame(tick);
    }
    function dropSpinAnims(){
      if(!spinAnims) return;
      spinAnims.forEach(function(a){ try { a.cancel(); } catch(e){} });
      spinAnims = null;
    }
    function cancelSpin(){
      if(!spinning) return;
      var moving = !!spinRaf || !!spinAnims;
      var W = width();
      function tx(el){
        try { return new DOMMatrix(window.getComputedStyle(el).transform).m41; } catch(e){ return 0; }
      }
      var x0 = tx(panels[0]), x1 = tx(panels[1]);       // read BEFORE letting go of the animation
      haltSpin();
      clearTimeout(settleTimer); settleTimer = 0;
      if(!moving){ dropSpinAnims(); finish(false); return; }   // opening beat: put the parked panel away
      current = (x0 <= 0.5 && x0 > -W + 0.5) ? 0 : 1;   // the leader: on screen and leaving left
      var cur = panels[current], oth = panels[1 - current];
      var xc = current === 0 ? x0 : x1, xo = current === 0 ? x1 : x0;
      setT(cur, xc, 0); setT(oth, xo, 0);               // hold them exactly here …
      dropSpinAnims();                                  // … then drop the animation underneath
      void cur.offsetWidth;
      var commit = Math.abs(xc) > W / 2;
      animating = true;
      if(commit){ setT(cur, (xc < 0 ? -1 : 1) * W, 180); setT(oth, 0, 180); setDots(1 - current); }
      else { setT(cur, 0, 180); setT(oth, (xo < 0 ? -1 : 1) * W, 180); }
      settleTimer = setTimeout(function(){ finish(commit); }, 200);
    }
    // The spin's path for one panel as Web Animation keyframes. The path itself is pure maths
    // (HugGivingMath.spinPath, pinned by scripts/giving-math-test.mjs): it is where the halt's
    // ghost flash lived — the outgoing panel swept across the row in the spin's last 8 ms.
    function spinKeyframes(curve, shift, W){
      return G.spinPath(curve, shift, W).map(function(k){
        return { offset: k.offset, transform: 'translate3d(' + k.x + 'px,0,0)' };
      });
    }
    // One continuous movement. It runs on the COMPOSITOR (Web Animations), not on the page's own
    // thread: measured on the iOS simulator, the old frame-by-frame version showed the same picture
    // for up to 5 frames in a row and then jumped ~55 pt whenever start-up work held the thread —
    // the owner's "harsh and jittery". A compositor animation keeps moving regardless.
    // `current` is the panel leaving to the left; the other follows one width behind.
    function spin(toIdx){
      var curve = G.spinCurve(panelName(current), panelName(toIdx));
      var c0 = current, t0 = 0, dot = -1;
      lastSpin = curve;
      spinning = true;
      if(panels[0].animate){
        // Reveal the incoming panel now, parked off screen at +W, so it is painted and on its own
        // layer before the first frame of motion (doing it on that frame cost the spin's first
        // few frames on the simulator).
        animating = true;
        reveal(panels[1 - c0]);
        setT(panels[c0], 0, 0); setT(panels[1 - c0], width(), 0);
        whenCalm(curve.holdMs, curve.holdMs + 1200, function(){
          if(!spinning) return;
          try { var s0 = performance.now(); spinWindow = { start: s0, end: s0 + curve.totalMs }; } catch(e){}
          var W = width();
          var opts = { duration: curve.totalMs, fill: 'forwards' };
          spinAnims = [panels[c0].animate(spinKeyframes(curve, 0, W), opts),
                       panels[1 - c0].animate(spinKeyframes(curve, 1, W), opts)];
          var a0 = spinAnims[0];
          // The dots (cheap, page thread; a late dot is harmless) follow the animation's own clock.
          (function dots(){
            if(!spinning || !spinAnims) return;
            var p = G.spinAt(curve, Number(a0.currentTime) || 0).p, k = Math.floor(p);
            var lead = (c0 + k) % 2, d = (p - k) < 0.5 ? lead : 1 - lead;
            if(d !== dot){ dot = d; setDots(d); }
            spinRaf = requestAnimationFrame(dots);
          })();
          a0.onfinish = function(){
            if(!spinning || !spinAnims) return;
            haltSpin();
            current = (c0 + curve.passes) % 2;
            finish(false);              // clears the inline transforms, hides the other panel, persists
            dropSpinAnims();            // same task: no frame between the held end and the clean state
          };
        });
        return;
      }
      // Fallback (no Web Animations): the same curve, drawn frame by frame.
      function frame(ts){
        if(!spinning) return;
        if(!t0) t0 = ts;
        var t = ts - t0;
        if(t >= curve.totalMs){
          spinRaf = 0; spinning = false;
          current = (c0 + curve.passes) % 2;
          finish(false);                  // clears the transforms, hides the other panel, persists
          return;
        }
        var p = G.spinAt(curve, t).p, k = Math.floor(p), f = p - k, W = width();
        current = (c0 + k) % 2;
        setT(panels[current], f ? -f * W : 0, 0);
        setT(panels[1 - current], (1 - f) * W, 0);
        var d = f < 0.5 ? current : 1 - current;
        if(d !== dot){ dot = d; setDots(d); }
        spinRaf = requestAnimationFrame(frame);
      }
      spinTimer = setTimeout(function(){
        if(!spinning) return;
        spinTimer = 0;
        animating = true;
        reveal(panels[1 - current]);
        setT(panels[1 - current], width(), 0);
        spinRaf = requestAnimationFrame(frame);
      }, curve.holdMs);
    }
    // Cold launch: people shows for a beat, then the row runs around the loop and slows to a
    // halt on the target. Reduced motion, or a launch that lands on another screen: no spin, the
    // target is shown directly. The target is read when the launch cover lifts, from what the
    // device already knows (cached choice); a later server answer does not move the row.
    function openRow(){
      if(!G || !G.spinCurve || !G.spinPath || !window.requestAnimationFrame || reduced() || !whenOnHome() || drag){ show(idxOf(target()), { instant: true }); return; }
      spin(idxOf(target()));
    }
    // Back from the background after a real absence: pick the panel again, without the spin.
    function settleToTarget(){
      haltSpin();
      if(animating) finish(false);     // a spin or settle in flight: snap clean first
      if(drag) return;
      show(idxOf(target()), { instant: true });
    }
    function away(){ if(!hiddenAt) hiddenAt = Date.now(); }
    function back(){
      var t0 = hiddenAt; hiddenAt = 0;
      if(t0 && Date.now() - t0 >= MIN_AWAY_MS) settleToTarget();
    }
    document.addEventListener('visibilitychange', function(){
      if(document.visibilityState === 'hidden') away(); else back();
    });
    window.addEventListener('load', function(){
      try {
        var A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
        if(A && A.addListener) A.addListener('appStateChange', function(st){ if(st && st.isActive) back(); else away(); });
      } catch(e){}
    }, { once: true });
    // People is the primary panel (owner, 2026-10-18), and now the first in the markup, so the row
    // is on it from the first frame: the spin's opening beat shows people, as does a no-spin launch.
    show('people', { instant: true });
    if(window.__hugBoot && window.__hugBoot.onReveal) window.__hugBoot.onReveal(openRow);
    else openRow();

    window.__hugImpactRow = {
      set: set,
      setActive: setActive,
      show: show,
      landing: target,                  // where the row would settle right now (tests read this)
      lastViewed: lastViewed,
      settleToTarget: settleToTarget,   // what a return from background does
      get lastSpin(){ return lastSpin; },
      get spinWindow(){ return spinWindow; },
      get spinning(){ return spinning; },
      get panel(){ return panelName(current); }
    };
    window.addEventListener('resize', function(){
      Array.prototype.forEach.call(row.querySelectorAll('.impact-value'), fitValue);
    });
  })();

  /* HUG GIVING — tokens, six causes, where your tokens go (docs/giving/SPEC.md).
     One feature owns the data; the home row, the impact screen and the settings screen read it.
       · giving_overview()  public facts (causes, token value) — cached, falls back to the SPEC
                            defaults in giving-math.js so a signed-out launch needs no network
       · my_giving()        this account's tokens + split — the server's answer, cached per account
       · set_giving_causes  the choice. Optimistic; the server's reply replaces the guess.
     A read that FAILED is never drawn as zeros: it is an unknown (HUG_UNKNOWN) and says so. */
  (function givingFeature(){
    var G = window.HugGivingMath;
    if(!G) return;
    var CHOICE_KEY = 'hug-giving-choice-v1';   // prototype mode only: a local choice, never sent
    var META = {
      // Small-size variants, one per cause, matched for size and line weight (all 22 px of ink in
      // a 26-unit box, ~0.52 px stroke at 26 px; owner, 2026-10-10: "the weighting should be all
      // the same in this area"). Built from the owner's art; src/assets/giving/.
      plastic:    { name: 'ocean plastic', icon: 'assets/giving/plastic.svg' },
      carbon:     { name: 'carbon', icon: 'assets/giving/carbon.svg' },
      tree:       { name: 'trees', icon: 'assets/giving/tree.svg' },
      water:      { name: 'clean water', icon: 'assets/giving/water.svg' },
      food:       { name: 'school meals', icon: 'assets/giving/food.svg' },
      vitamin_a:  { name: 'child health', icon: 'assets/icon-health.svg' },
      sanitation: { name: 'sanitation', icon: 'assets/giving/sanitation.svg' }
    };
    var PANEL_TITLE = { planet: 'Planet', people: 'People' };
    var ROW_KEYS = ['plastic','carbon','tree','water','food','vitamin_a','sanitation'];
    var overview = null;     // giving_overview() payload (cached or fresh), else null = SPEC defaults
    var mine = null;         // my_giving() payload for the signed-in account, else null
    var mineFailed = false;  // the last my_giving() read failed and nothing has succeeded since
    var seq = 0;             // set_giving_causes calls issued; only the newest reply is applied
    var listeners = [];

    function active(){ return document.documentElement.dataset.accountStatus === 'active'; }
    function who(){ try { return String(localStorage.getItem('hug-account-email-v1') || '').trim().toLowerCase(); } catch(e){ return ''; } }
    function readJson(key){ try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e){ return null; } }
    function durable(op, key, val){ try { if(window.__hugDurable) window.__hugDurable[op](key, val); } catch(e){} }

    function config(){ return overview || { token_value_pence: G.DEFAULT_CONFIG.token_value_pence, per_cup_pence: G.DEFAULT_CONFIG.per_cup_pence, per_referral_tokens: G.DEFAULT_CONFIG.per_referral_tokens }; }
    // Active causes only (SPEC §1.4), People first, then Planet. No overview yet -> the SPEC defaults.
    function causes(){ return G.inDisplayOrder((overview && overview.causes) || G.DEFAULT_CAUSES); }
    function localChoice(){ var c = readJson(CHOICE_KEY); return Array.isArray(c) ? c : null; }

    // The enabled set the screens should use right now. Signed in: the server's. Prototype: the
    // local choice. Signed out: everything (nobody has chosen anything).
    // Signed out, the switches still work as a PREVIEW (owner, 2026-10-10: turn one off and the
    // others' amounts update at once). Held in memory only: never sent, never stored.
    var preview = null;
    function enabledIds(){
      if(isDemoMode()) return G.resolveEnabled(causes(), localChoice()).enabled;
      if(active() && mine && Array.isArray(mine.enabled)) return G.resolveEnabled(causes(), mine.enabled).enabled;
      return G.resolveEnabled(causes(), active() ? null : preview).enabled;
    }
    function coreCounts(){
      if(isDemoMode()) return { cups: (DEMO.linkedCodes || []).length, referrals: (window.__hugReferral && window.__hugReferral.count) || DEMO.referrals };
      if(active() && mine) return { cups: Number(mine.cups) || 0, referrals: Number(mine.referrals) || 0 };
      return { cups: 0, referrals: 0 };
    }
    // One hug (or n) under the current choice.
    function perCup(n){ return G.compute({ causes: causes(), config: config(), cups: n == null ? 1 : n, referrals: 0, enabled: enabledIds() }); }
    // Everything given so far. null = signed in but not known (never zeros).
    function soFar(){
      if(isDemoMode()){ var c = coreCounts(); return G.compute({ causes: causes(), config: config(), cups: c.cups, referrals: c.referrals, enabled: enabledIds() }); }
      if(!active()) return G.compute({ causes: causes(), config: config(), cups: 0, referrals: 0, enabled: null });
      if(!mine) return null;
      // Server figures verbatim; the cause list order/labels come from the overview.
      var byId = {}; (mine.per_cause || []).forEach(function(p){ byId[p.id] = p; });
      return { tokens: Number(mine.tokens) || 0, enabled: enabledIds(), allEnabled: mine.all_enabled === true,
        perCause: causes().map(function(c){ var p = byId[c.id] || {}; return { id: c.id, share: Number(p.share) || 0, pence: Number(p.pence) || 0,
          tokens: Number(p.tokens) || 0, outcome: p.outcome == null ? null : Number(p.outcome), display: p.display || c.display }; }) };
    }
    function causeById(id){ var l = causes(); for(var i=0;i<l.length;i++) if(l[i].id === id) return l[i]; return { id: id, panel: 'planet', partner_name: '', display: 'units' }; }

    // How an outcome reads. value/unit feed the home row; text is the full phrase. The row shows
    // a unit only where the number is not self-explanatory (kg); trees, meals and toilets are the
    // icon's job, and days went once a tap on the icon explains it (owner, 2026-10-10), so their
    // unit is '' (the full phrase stays as the item's aria-label).
    function phrase(id, row){
      if(!row || (row.display === 'money')) {
        var p = G.formatPence(row ? row.pence : 0);
        return { value: p, unit: '', text: p, short: p, approx: false };
      }
      if(row.display === 'percent'){
        var pp = G.formatPercentParts(row.outcome || 0);
        if(pp.isPercent) return { value: pp.value, unit: '', text: hugTpl('{n} of a family toilet', { n: pp.value }), short: hugTpl('{n} of a family toilet', { n: pp.value }), approx: true };
        var oneT = pp.value === '1';
        return { value: pp.value, unit: '', text: hugTpl(oneT ? '{n} family toilet' : '{n} family toilets', { n: pp.value }), short: hugTpl(oneT ? '{n} family toilet' : '{n} family toilets', { n: pp.value }), approx: true };
      }
      var v = G.formatUnits(row.outcome || 0), one = v === '1';
      switch(id){
        case 'plastic': return { value: v, unit: hugTpl('kg'), text: hugTpl('{n} kg of ocean plastic collected', { n: v }), short: hugTpl('{n} kg', { n: v }), approx: true };
        case 'carbon':  return { value: v, unit: hugTpl('kg'), text: hugTpl('{n} kg CO₂e offset', { n: v }), short: hugTpl('{n} kg', { n: v }), approx: true };
        case 'tree':    return { value: v, unit: '', text: hugTpl(one ? '{n} tree planted' : '{n} trees planted', { n: v }), short: hugTpl(one ? '{n} tree' : '{n} trees', { n: v }), approx: true };
        case 'water':   return { value: v, unit: '', text: hugTpl('{n} days of safe water', { n: v }), short: hugTpl('{n} days', { n: v }), approx: true };
        case 'vitamin_a': return { value: v, unit: '', text: hugTpl('{n} days of vitamin A for a child', { n: v }), short: hugTpl('{n} days', { n: v }), approx: true };
        case 'food':    return { value: v, unit: '', text: hugTpl(one ? '{n} school meal' : '{n} school meals', { n: v }), short: hugTpl(one ? '{n} meal' : '{n} meals', { n: v }), approx: true };
        default:        return { value: v, unit: '', text: v, short: v, approx: true };
      }
    }

    function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
    function icon(id, cls){
      var img = el('img', cls); img.alt = ''; img.src = (META[id] || {}).icon || ''; img.setAttribute('decoding', 'async');
      if(id === 'carbon') img.classList.add('is-tall');   // the factory stands taller, as on home (giving/carbon.svg)
      return img;
    }

    // ---- shared renderers -----------------------------------------------------------------
    // A grouped (Planet / People) list of outcome cards. calc = a G.compute() result, or null
    // for "not known", which draws dashes and says so rather than zeros.
    function renderOutcomes(host, calc){
      if(!host) return;
      host.textContent = '';
      var panel = null;
      causes().forEach(function(c){
        if(c.panel !== panel){ panel = c.panel; host.appendChild(el('p', 'giving-panel-title', hugTpl(PANEL_TITLE[panel] || panel))); }
        var row = calc && calc.perCause.filter(function(p){ return p.id === c.id; })[0];
        var item = el('div', 'giving-item');
        if(calc && row && calc.enabled.indexOf(c.id) === -1) item.classList.add('is-off');
        item.appendChild(icon(c.id));
        var main = el('div', 'giving-item-main');
        var off = !!(calc && row && calc.enabled.indexOf(c.id) === -1);
        var ph = row && !off ? phrase(c.id, row) : null;
        main.appendChild(el('span', 'giving-item-out', off ? hugTpl('switched off') : (ph ? (ph.approx ? '≈ ' : '') + ph.text : HUG_UNKNOWN)));
        if(c.partner_name){
          var site = partnerSite(c.id);
          main.appendChild(site ? partnerLink(c.partner_name, site, 'giving-item-partner') : el('span', 'giving-item-partner', c.partner_name));
        }
        item.appendChild(main);
        host.appendChild(item);
      });
    }

    // ---- home row ---------------------------------------------------------------------------
    // C1's row exposes window.__hugImpactRow.set({ [causeId]: { value, unit?, label? } }).
    function feedRow(){
      var row = window.__hugImpactRow;
      if(!row || typeof row.set !== 'function') return;
      // The account's own totals, like the TOKENS hero under it (owner, 2026-10-10: the home page
      // is "the totality" of what this person has given). Signed out that is nothing yet: zeros.
      // What one hug o gives lives on the giving and impact screens, and in each icon's story.
      var calc = soFar();
      var out = {};
      var ids = causes().map(function(c){ return c.id; });
      if(typeof row.setActive === 'function') try { row.setActive(ids); } catch(e){}
      ROW_KEYS.forEach(function(id){
        if(ids.indexOf(id) === -1) return;   // switched off by the owner: not on the row
        var p = calc && calc.perCause.filter(function(x){ return x.id === id; })[0];
        if(!p){ out[id] = { value: HUG_UNKNOWN, label: HUG_UNKNOWN }; return; }
        if(calc.enabled.indexOf(id) === -1){ out[id] = { value: hugTpl('off'), label: hugTpl('{cause} is switched off', { cause: hugTpl(META[id] ? META[id].name : id) }) }; return; }
        var ph = phrase(id, p);
        out[id] = { value: ph.value, unit: ph.unit, label: (ph.approx ? '≈ ' : '') + ph.text };
      });
      try { row.set(out); } catch(e){}
    }

    // ---- settings: where your tokens go -------------------------------------------------------
    var screen = document.querySelector('.screen[data-screen="giving"]');
    var listEl = document.getElementById('giving-list');
    var msgEl = document.getElementById('giving-msg');
    var signinEl = document.getElementById('giving-signin');
    function say(text, isError){ if(!msgEl) return; msgEl.textContent = text ? hugTpl(text) : ''; msgEl.classList.toggle('is-error', !!isError); }

    // The rows are built once and then updated IN PLACE, so a switch slides, a row dims, and the
    // amounts count to their new values (owner, 2026-10-10: "a smoother transition and not so
    // immediate"). Rebuilding the list on every tap made all of it snap.
    var COUNT_MS = 450;
    function rowShare(c, p, on){
      if(!on || !p) return hugTpl('off');
      var ph = phrase(c.id, p);
      return (ph.approx ? '≈ ' : '') + ph.short;
    }
    function countTo(span, c, from, to, p){
      if(span._count) cancelAnimationFrame(span._count);
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(reduce || !isFinite(from) || !isFinite(to) || from === to){ span.textContent = rowShare(c, p, true); span._outcome = to; return; }
      var t0 = 0;
      function frame(ts){
        if(!t0) t0 = ts;
        var u = Math.min(1, (ts - t0) / COUNT_MS), e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        var v = from + (to - from) * e;
        span.textContent = rowShare(c, { id: p.id, outcome: v, pence: p.pence, display: p.display }, true);
        span._outcome = v;
        span._count = u < 1 ? requestAnimationFrame(frame) : 0;
      }
      span._count = requestAnimationFrame(frame);
    }
    function renderSettings(){
      if(!listEl) return;
      var signedOut = !isDemoMode() && !active();
      var unknown = !isDemoMode() && active() && !mine;
      if(signinEl) signinEl.hidden = !signedOut;
      var en = enabledIds(), calc = perCup(1), list = causes();
      var rows = Array.prototype.slice.call(listEl.querySelectorAll('.giving-row'));
      var same = rows.length === list.length && rows.every(function(r, i){ return r.dataset.cause === list[i].id; });
      if(!same){
        listEl.textContent = '';
        var panel = null;
        list.forEach(function(c){
          if(c.panel !== panel){ panel = c.panel; listEl.appendChild(el('p', 'giving-panel-title', hugTpl(PANEL_TITLE[panel] || panel))); }
          var row = el('button', 'giving-row');
          row.type = 'button'; row.setAttribute('role', 'switch');
          row.dataset.cause = c.id;
          row.appendChild(icon(c.id, 'giving-icon'));
          var text = el('span', 'giving-text');
          text.appendChild(el('span', 'giving-name', hugTpl((META[c.id] || {}).name || c.id)));
          if(c.partner_name) text.appendChild(el('span', 'giving-partner', c.partner_name));
          text.appendChild(el('span', 'giving-share', ''));
          row.appendChild(text);
          var sw = el('span', 'giving-switch'); sw.setAttribute('aria-hidden', 'true'); sw.appendChild(el('span', 'giving-knob'));
          row.appendChild(sw);
          listEl.appendChild(row);
        });
        rows = Array.prototype.slice.call(listEl.querySelectorAll('.giving-row'));
      }
      list.forEach(function(c, i){
        var row = rows[i], on = en.indexOf(c.id) !== -1, last = on && en.length === 1;
        row.classList.toggle('is-on', on);
        row.classList.toggle('is-last', last);
        row.setAttribute('aria-checked', on ? 'true' : 'false');
        if(last || unknown) row.setAttribute('aria-disabled', 'true'); else row.removeAttribute('aria-disabled');
        var p = calc.perCause.filter(function(x){ return x.id === c.id; })[0];
        var span = row.querySelector('.giving-share');
        if(!on || !p){
          if(span._count) cancelAnimationFrame(span._count);
          span._count = 0; span._outcome = 0;
          span.textContent = rowShare(c, p, false);
          return;
        }
        var to = Number(p.outcome);
        // First paint: straight to the value. After that: count from what is showing now.
        if(!same || span._outcome == null) { span.textContent = rowShare(c, p, true); span._outcome = to; }
        else countTo(span, c, Number(span._outcome), to, p);
      });
    }
    function applyChoice(ids){
      // ids = the new enabled set (already non-empty).
      if(isDemoMode()){
        // Prototype mode is display-only: keep the choice on this device, send nothing.
        var all = causes().map(function(c){ return c.id; });
        var store = ids.length === all.length ? null : ids;
        try { if(store) localStorage.setItem(CHOICE_KEY, JSON.stringify(store)); else localStorage.removeItem(CHOICE_KEY); } catch(e){}
        changed(); say('');
        return;
      }
      if(!active()){
        var allIds = causes().map(function(c){ return c.id; });
        preview = ids.length === allIds.length ? null : ids.slice();
        changed(); say('Sign in to keep this choice.');
        return;
      }
      if(!mine || !window.HugBackend || !window.HugBackend.setGivingCauses) return;
      var before = mine, mySeq = ++seq;
      // Optimistic: the server's formula, run here on the counts it last told us.
      var guess = G.compute({ causes: causes(), config: config(), cups: before.cups, referrals: before.referrals, enabled: ids });
      mine = { cups: before.cups, referrals: before.referrals, tokens: before.tokens, tokens_from_cups: before.tokens_from_cups,
        tokens_from_referrals: before.tokens_from_referrals, pence: before.pence, enabled: guess.enabled, all_enabled: guess.allEnabled,
        per_cause: guess.perCause.map(function(p){ return { id: p.id, share: p.share, pence: p.pence, tokens: p.tokens, outcome: p.outcome, display: p.display }; }) };
      changed(); say('Saving…');
      window.HugBackend.setGivingCauses(ids).then(function(res){
        if(mySeq !== seq) return;   // a newer choice is already in flight; its reply decides
        if(res && res.ok && res.giving){ mine = res.giving; mineFailed = false; saveMine(); changed(); say('Saved.'); return; }
        mine = before; changed();
        say(res && res.status === 'empty' ? 'Keep at least one cause on — your tokens need somewhere to go.' : 'Couldn’t save that. Check your connection and try again.', true);
      }).catch(function(){
        if(mySeq !== seq) return;
        mine = before; changed(); say('Couldn’t save that. Check your connection and try again.', true);
      });
    }
    function signIn(){ if(window.__hugAuth) window.__hugAuth.open('signin'); }
    if(listEl) listEl.addEventListener('click', function(e){
      var row = e.target.closest && e.target.closest('.giving-row');
      if(!row) return;
      if(!isDemoMode() && active() && !mine){ say('Couldn’t load your choices yet. Go back and open this again.', true); load(); return; }
      var id = row.dataset.cause, en = enabledIds().slice(), i = en.indexOf(id);
      if(i === -1){
        // keep the display order
        applyChoice(causes().map(function(c){ return c.id; }).filter(function(x){ return x === id || en.indexOf(x) !== -1; }));
      } else if(en.length === 1){
        say('Keep at least one cause on — your tokens need somewhere to go.', true);
      } else {
        en.splice(i, 1); applyChoice(en);
      }
    });
    var siBtn = document.getElementById('giving-signin-btn');
    if(siBtn) siBtn.addEventListener('click', signIn);

    // ---- data -------------------------------------------------------------------------------
    function saveMine(){
      if(!mine) return;
      var payload = JSON.stringify({ who: who(), giving: mine });
      try { localStorage.setItem(HUG_GIVING_MINE_KEY, payload); } catch(e){}
      durable('set', HUG_GIVING_MINE_KEY, payload);
    }
    function loadCached(){
      var o = readJson(HUG_GIVING_OVERVIEW_KEY);
      if(o && Array.isArray(o.causes) && o.causes.length) overview = o;
      var m = readJson(HUG_GIVING_MINE_KEY);
      if(m && m.giving && Array.isArray(m.giving.per_cause) && String(m.who || '') === who() && active()) mine = m.giving;
    }
    var loading = false;
    function load(){
      if(isDemoMode()){ changed(); return; }
      var b = window.HugBackend;
      if(!b || !b.enabled){ changed(); return; }
      if(!mine && active()) loadCached();
      if(loading) return;
      loading = true;
      var jobs = [];
      if(b.getGivingOverview) jobs.push(b.getGivingOverview().then(function(r){
        if(r && r.ok){ overview = r.overview; var raw = JSON.stringify(r.overview);
          try { localStorage.setItem(HUG_GIVING_OVERVIEW_KEY, raw); } catch(e){} durable('set', HUG_GIVING_OVERVIEW_KEY, raw); }
      }).catch(function(){}));
      if(active() && b.getMyGiving) jobs.push(b.getMyGiving().then(function(r){
        if(!active()) return;   // signed out mid-flight
        if(r && r.ok){ mine = r.giving; mineFailed = false; saveMine(); } else { mineFailed = true; }
      }).catch(function(){ mineFailed = true; }));
      Promise.all(jobs).then(function(){ loading = false; changed(); }, function(){ loading = false; changed(); });
    }
    function forget(){ mine = null; mineFailed = false; seq++; changed(); }
    function changed(){
      feedRow(); renderSettings();
      listeners.forEach(function(fn){ try { fn(); } catch(e){} });
    }

    if(screen && 'MutationObserver' in window){
      new MutationObserver(function(){ if(screen.classList.contains('active')){ say(''); load(); } }).observe(screen, { attributes: true, attributeFilter: ['class'] });
    }
    // The home row's script may arrive after this one: feed it once everything has loaded.
    window.addEventListener('load', function(){ feedRow(); });

    // Each partner's own website, behind its underlined name (owner, 2026-10-16: "have each of
    // these names underlined ... a hotlink to each of their respective websites"). Only for the
    // partner we know runs the cause: if the admin swaps one, its name shows plain, never a wrong
    // link. Sources: docs/giving/PARTNER-FACTS.md (empower.eco now lands on jord.tech/foundation).
    var PARTNER_SITES = {
      plastic:    { match: /empower/i,                url: 'https://empower.eco' },
      carbon:     { match: /gold standard/i,          url: 'https://www.goldstandard.org' },
      tree:       { match: /eden/i,                   url: 'https://eden-plus.org' },
      water:      { match: /evidence action/i,        url: 'https://www.evidenceaction.org' },
      food:       { match: /mary/i,                   url: 'https://www.marysmeals.org.uk' },
      sanitation: { match: /toilet twinning|tearfund/i, url: 'https://toilettwinning.org' },
      vitamin_a:  { match: /helen keller/i,           url: 'https://helenkellerintl.org' }
    };
    function partnerSite(id){
      var s = PARTNER_SITES[id];
      return s && s.match.test(String(causeById(id).partner_name || '')) ? s.url : null;
    }
    // The name as a link: underlined, opens in the in-app browser (HugLinks.open in
    // native-bridge.js), and the tap goes no further (the story box closes on any other tap).
    function partnerLink(name, url, cls){
      var a = document.createElement('a');
      a.className = 'partner-link' + (cls ? ' ' + cls : '');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.textContent = name;
      a.addEventListener('click', function(e){
        e.preventDefault(); e.stopPropagation();
        var L = window.HugLinks;
        if(L && L.open) L.open(url); else { try { window.open(url, '_blank', 'noopener'); } catch(_) {} }
      });
      return a;
    }

    window.__hugGiving = {
      site: partnerSite, link: partnerLink,   // a partner's website, and its name as a link (above)
      load: load, forget: forget, enabledIds: enabledIds, perCup: perCup, soFar: soFar, renderOutcomes: renderOutcomes,
      mineKnown: function(){ return !!mine; }, mineFailed: function(){ return mineFailed; },
      onChange: function(fn){ listeners.push(fn); }, config: config,
      cause: causeById,                 // one cause's facts (partner, unit cost) — the impact detail reads it
      // Which home-row panel to land on (see HugGivingMath.landingPanel): the choice, then `last`.
      landing: function(last){ return G.landingPanel({ causes: causes(), enabled: enabledIds(), last: last }); }
    };
    loadCached();
    changed();
    if(window.HugBackend) load();
    else window.addEventListener('load', load, { once: true });
  })();

  /* IMPACT DETAIL — tap an icon on the home row: what that cause has done, and with whom.
     Owner brief 2026-10-10. Everything on home except the tapped icon fades out (the top bar and
     the bottom nav stay) over 0.5 s; then the story fades in over 0.5 s while a side icon slides
     to the middle. Every move eases in and out. Tap anywhere on home (or Esc) to go back:
     the same two steps in reverse.
     The copy follows this account: what it has given so far, or — signed out, or before the first
     hug — what one hug gives. Each cause has its own voice. Facts and sources:
     docs/giving/PARTNER-FACTS.md. A body that describes ONE partner's work is shown only while
     that partner runs the cause (`match`); if the admin swaps the partner, the generic line shows. */
  (function impactDetail(){
    var home = document.querySelector('.screen[data-screen="home"]');
    var content = home && home.querySelector('.home-content');
    var row = content && content.querySelector('[data-impact-row]');
    var G = window.HugGivingMath;
    if(!row || !G) return;
    var MS = 500;          // each fade (owner brief)
    var GLIDE_MS = 800;    // the icon's glide: longer than a fade so it can move slowly (owner: "softer and smoother")
    var reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function dur(){ return reduceMq && reduceMq.matches ? 0 : MS; }
    function glide(){ return reduceMq && reduceMq.matches ? 0 : GLIDE_MS; }

    var NAME = { plastic: 'ocean plastic', carbon: 'carbon', tree: 'trees', water: 'clean water',
      food: 'school meals', sanitation: 'sanitation', vitamin_a: 'child health' };
    var COPY = {
      plastic: { match: /empower/i, partner: 'Empower',
        given: 'You’ve had {amount} picked up and logged.',
        each: 'Every hug gets {amount} picked up and logged.',
        body: 'Every kilo is logged against the person who collected it and the place it came from, and they’re paid for it.' },
      carbon: { match: /gold standard/i, partner: 'Gold Standard',
        given: 'You’ve backed {amount} of certified carbon cuts.',
        each: 'Every hug backs {amount} of certified carbon cuts.',
        body: 'Each project is checked: the carbon it says it cuts has to be real and measured, and what it does for the people living around it counts too.' },
      tree: { match: /eden/i, partner: 'Eden: People+Planet',
        given: 'You’ve put {amount} in the ground.',
        each: 'Every hug puts {amount} in the ground.',
        body: 'Across Africa, Asia and Central America, people from nearby communities are paid to gather seed, raise saplings, then plant and protect the forest. A fair wage today, a forest tomorrow.' },
      water: { match: /evidence action/i, partner: 'Evidence Action',
        given: 'You’ve funded {amount}.',
        each: 'Every hug funds {amount}.',
        body: 'In Kenya and Uganda, chlorine dispensers sit right at shared water points. Turn the valve, take a measured dose, fill up, and the chlorine gets to work on the walk home.' },
      food: { match: /mary/i, partner: 'Mary’s Meals',
        given: 'You’ve dished up {amount}.',
        each: 'Every hug dishes up {amount}.',
        body: 'A daily meal at school gives a hungry child the energy to learn, and one more reason to turn up. It’s served in 16 countries, from Haiti to Yemen; in Malawi, the biggest, it’s likuni phala, a fortified maize and soya porridge.' },
      sanitation: { match: /toilet twinning|tearfund/i, partner: 'Toilet Twinning',
        given: 'You’ve chipped in {amount}.',
        each: 'Every hug chips in {amount}.',
        body: 'The money goes into water, sanitation and hygiene projects.',
        whole: 'Every {k} hugs twin a whole family toilet.' }
    };
    var GENERIC = { given: 'You’ve given {amount}.', each: 'Every hug gives {amount}.' };

    function tr(s){ try { if(typeof window.hugT === 'function') return window.hugT(s) || s; } catch(e){} return s; }
    function tpl(s, vars){ s = tr(s); if(vars) for(var k in vars) s = s.split('{' + k + '}').join(String(vars[k])); return s; }
    function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }

    // "3 school meals", "47 days of safe drinking water", "0.5% of a family toilet" …
    function amountText(id, r){
      if(!r || r.outcome == null) return null;
      if(r.display === 'money') return G.formatPence(r.pence);
      if(r.display === 'percent'){
        var pp = G.formatPercentParts(r.outcome);
        if(pp.isPercent) return tpl('{n} of a family toilet', { n: pp.value });
        return tpl(pp.value === '1' ? '{n} family toilet' : '{n} family toilets', { n: pp.value });
      }
      var v = G.formatUnits(r.outcome), one = v === '1';
      switch(id){
        case 'plastic':   return tpl('{n} kg of plastic', { n: v });
        case 'carbon':    return tpl('{n} kg', { n: v });           // "…backed 8 kg of carbon cuts…"
        case 'tree':      return tpl(one ? '{n} tree' : '{n} trees', { n: v });
        case 'water':     return tpl(one ? '{n} day of safe drinking water' : '{n} days of safe drinking water', { n: v });
        case 'food':      return tpl(one ? '{n} school meal' : '{n} school meals', { n: v });
        case 'vitamin_a': return tpl('{n} days of vitamin A for a child', { n: v });
      }
      return v;
    }
    function rowOf(calc, id){ return calc ? calc.perCause.filter(function(p){ return p.id === id; })[0] || null : null; }

    // ---- the story box (one per app, sits over the faded home content) ----------------------
    var box = el('section', 'impact-detail');
    box.hidden = true;
    box.setAttribute('aria-live', 'polite');
    var kicker = el('p', 'impact-detail-kicker');
    var lead = el('p', 'impact-detail-lead');
    var body = el('p', 'impact-detail-body');
    var facts = el('div', 'impact-detail-facts');
    var link = el('button', 'impact-detail-link');
    link.type = 'button';
    [kicker, lead, body, facts, link].forEach(function(n){ box.appendChild(n); });
    home.appendChild(box);

    function fact(label, text, cls){
      var d = el('div', 'impact-detail-fact' + (cls ? ' ' + cls : ''));
      d.appendChild(el('span', 'impact-detail-label', tr(label)));
      d.appendChild(typeof text === 'string' ? el('span', 'impact-detail-value', text) : text);
      return d;
    }
    // A template with the amount picked out (gradient, like the tokens figure). The whole
    // sentence is one dictionary key, so word order is each language's own.
    function sentence(host, template, amount, vars){
      host.textContent = '';
      var s = tpl(template, vars), at = s.indexOf('{amount}');
      if(at < 0 || amount == null){ host.textContent = s.split('{amount}').join(amount || ''); return; }
      host.appendChild(document.createTextNode(s.slice(0, at)));
      host.appendChild(el('span', 'impact-detail-amount', amount));
      host.appendChild(document.createTextNode(s.slice(at + 8)));
    }

    function render(id){
      var g = window.__hugGiving;
      var c = (g && g.cause) ? g.cause(id) : { partner_name: '' };
      var copy = COPY[id] || {};
      var live = String(c.partner_name || '');
      var ours = !!(copy.match && copy.match.test(live));        // our words describe THIS partner
      var partner = ours ? copy.partner : live;
      var words = ours ? copy : GENERIC;
      var calc = g ? g.soFar() : null;                             // null = signed in, not known yet
      var mine = rowOf(calc, id);
      var off = !!(calc && calc.enabled && calc.enabled.indexOf(id) === -1);
      var per = g ? rowOf(g.perCup(1), id) : null;

      kicker.textContent = tr(NAME[id] || id);
      var vars = { partner: partner, cause: tr(NAME[id] || id) };
      if(off) sentence(lead, 'You’ve switched {cause} off, so your tokens go to your other causes for now.', null, vars);
      else if(!calc) sentence(lead, 'Your figures haven’t loaded yet. Here’s what this one does.', null, vars);
      else if(mine && mine.outcome > 0) sentence(lead, words.given, amountText(id, mine), vars);
      else sentence(lead, words.each, amountText(id, per), vars);

      var more = ours && copy.body ? tr(copy.body) : '';
      if(ours && copy.whole && per && per.pence > 0 && c.unit_cost_pence > 0)
        more += (more ? ' ' : '') + tpl(copy.whole, { k: Math.round(Number(c.unit_cost_pence) / per.pence) });
      body.textContent = more;
      body.hidden = !more;

      // The partner is named ONCE, here, never in the lead (owner, 2026-10-10). Its logo, once
      // each partner has agreed to it, replaces the name in this slot. No WHERE line: not every
      // cause has a place we can stand behind, so places live in the body where they are known.
      facts.textContent = '';
      var site = ours && g && g.site ? g.site(id) : null;   // its website, when it is the partner we know
      if(partner) facts.appendChild(fact('With', site ? g.link(partner, site, 'impact-detail-value') : partner, 'is-partner'));
      facts.hidden = !facts.firstChild;
      link.textContent = tr('Token allocation ›');
    }

    // ---- motion -------------------------------------------------------------------------------
    var state = 'closed', item = null, timers = [];
    function after(ms, fn){ timers.push(setTimeout(fn, ms)); }
    function stopTimers(){ while(timers.length) clearTimeout(timers.pop()); }
    function visiblePanel(){ return row.querySelector('.impact-panel:not([aria-hidden="true"])'); }
    function rowAtRest(){
      var p = visiblePanel(), r = window.__hugImpactRow;
      return !!p && !p.style.transform && !(r && r.spinning);
    }
    function iconOf(it){ return it.querySelector('.impact-icon'); }
    function scale(){ var w = home.offsetWidth, r = home.getBoundingClientRect(); return w && r.width ? r.width / w : 1; }
    function setMs(ms){ content.style.setProperty('--detail-ms', ms + 'ms'); box.style.setProperty('--detail-ms', ms + 'ms'); }
    // The glide runs as a Web Animation, on the compositor (the icon is on its own layer from the
    // moment it is picked — see .is-picked in styles.css), so page work cannot make it stutter.
    // The end position is written inline first; the animation plays from wherever the icon is now.
    var glideAnim = null;
    function glideEase(){
      try { return getComputedStyle(document.documentElement).getPropertyValue('--detail-glide').trim() || 'ease-in-out'; }
      catch(e){ return 'ease-in-out'; }
    }
    function slide(ic, x, ms){
      var from = 0;
      try { var m = getComputedStyle(ic).transform; from = m && m !== 'none' ? new DOMMatrix(m).m41 : 0; } catch(e){}
      if(glideAnim){ try { glideAnim.cancel(); } catch(e){} glideAnim = null; }
      if(!ic.animate){                                   // fallback: a plain transition
        ic.style.transition = ms ? 'transform ' + ms + 'ms var(--detail-glide)' : 'none';
        ic.style.transform = x ? 'translateX(' + x + 'px)' : '';
        return;
      }
      ic.style.transition = 'none';
      ic.style.transform = x ? 'translateX(' + x + 'px)' : '';
      if(ms && Math.abs(from - x) > 0.5)
        glideAnim = ic.animate([{ transform: 'translateX(' + from + 'px)' }, { transform: 'translateX(' + x + 'px)' }],
          { duration: ms, easing: glideEase() });
    }

    // A closed story's icon KEEPS its own layer (.keeps-layer) instead of dropping it as it lands.
    // On its layer iOS draws the icon a whole pt lower than painted in the row, so dropping it in
    // plain view, just as the glide back ended, made it pop up 1 pt (owner, 2026-10-16: "when it
    // retracts back to its natural state, it is moving up and down a bit"; simulator, bottle and
    // tree, 204.7 -> 203.7 pt 0.2 s after landing). The layer goes only where nobody can see the
    // move: once another story's fade has hidden the icon, as the row moves, or off home. Not on
    // every icon all the time: that cost the opening spin its first frames (see .is-pressed).
    // The same goes for the row's items: .detail-motion gives them their own layers for the fades,
    // and dropping those as the story ended moved the picked icon by the same 1 pt (measured: it
    // still popped with only the icon's layer kept). .story-layers keeps them, without the fade
    // timings .detail-motion also carries.
    var kept = null;
    function keep(it){ if(kept && kept !== it) kept.classList.remove('keeps-layer'); kept = it; it.classList.add('keeps-layer'); }
    function releaseIcon(){ if(kept){ kept.classList.remove('keeps-layer'); kept = null; } }
    function release(){ releaseIcon(); content.classList.remove('story-layers'); }
    function open(it){
      if(state !== 'closed' || !rowAtRest()) return;
      var id = it.getAttribute('data-cause');
      if(!id) return;
      var d = dur(), ic = iconOf(it);
      if(!ic) return;
      var s = scale(), vr = row.getBoundingClientRect(), ir = ic.getBoundingClientRect(), hr = home.getBoundingClientRect();
      var dx = ((vr.left + vr.width / 2) - (ir.left + ir.width / 2)) / s;  // centre the icon on the row
      state = 'opening'; item = it;
      render(id);
      box.style.top = Math.round((ir.bottom - hr.top) / s + 22) + 'px';
      box.hidden = false;                                 // laid out now, still at opacity 0: at 0.5 s
                                                          // only its opacity changes, no layout mid-glide
      setMs(d);
      content.classList.add('detail-motion', 'story-layers');
      it.classList.add('is-picked');
      it.setAttribute('aria-expanded', 'true');
      void content.offsetWidth;
      content.classList.add('is-detail');                 // 1. everything else fades out …
      var g = glide();
      // … and halfway through, a side icon starts its glide to the middle: one slow, even S-curve
      // that spans the second half of the fade-out and the whole fade-in (owner, 2026-10-10).
      after(d / 2, function(){ slide(ic, Math.abs(dx) < 1 ? 0 : dx, g); });
      after(d, function(){
        box.classList.add('is-in');                       // 2. the story fades in
        if(kept && kept !== it) releaseIcon();            // the last story's icon is faded out now
      });
      after(Math.max(2 * d, d / 2 + g), function(){ state = 'open'; });
    }
    function close(instant){
      if(state === 'closed' || (state === 'closing' && !instant)) return;
      stopTimers();
      var it = item, ic = it && iconOf(it), d = instant ? 0 : dur();
      state = 'closing';
      setMs(d);
      var g = instant ? 0 : glide();
      box.classList.remove('is-in');                      // 1. the story fades out, the icon glides home
      if(ic) slide(ic, 0, g);
      after(d, function(){
        content.classList.remove('is-detail');            // 2. everything else fades back in
      });
      after(Math.max(2 * d, g), function(){
        box.hidden = true;                                // out of layout only once nothing moves
        content.classList.remove('detail-motion');
        if(it){ keep(it); it.classList.remove('is-picked', 'is-pressed'); it.setAttribute('aria-expanded', 'false'); }
        if(ic){ ic.style.transition = ''; ic.style.transform = ''; }
        glideAnim = null;
        state = 'closed'; item = null;
      });
    }

    // ---- input ----------------------------------------------------------------------------------
    // Every item is a button now (the row's drag still works: a drag swallows its click).
    Array.prototype.forEach.call(row.querySelectorAll('.impact-item'), function(it){
      it.setAttribute('role', 'button');
      it.setAttribute('tabindex', '0');
      it.setAttribute('aria-expanded', 'false');
    });
    function pick(it){
      if(state === 'open') close();
      else if(state === 'closed' && it.closest('.impact-panel') === visiblePanel()) open(it);
    }
    // A press that lands while the row is spinning stops the spin (impactRow); its click must not
    // then open a story about whatever icon the row happened to settle under the finger.
    var spinTapAt = 0;
    function noteSpinTap(){ var r = window.__hugImpactRow; if(r && r.spinning) spinTapAt = Date.now(); }
    content.addEventListener('pointerdown', noteSpinTap, true);
    content.addEventListener('touchstart', noteSpinTap, { capture: true, passive: true });
    // The icon's own layer is taken at the press, under the finger (see .is-pressed in styles.css).
    // A press that does not become a pick (a drag, a cancelled tap) gives it back a moment later.
    row.addEventListener('pointerdown', function(e){
      var r = window.__hugImpactRow, it = e.target && e.target.closest ? e.target.closest('.impact-item') : null;
      if(!it || state !== 'closed' || (r && r.spinning)) return;
      it.classList.add('is-pressed');
      setTimeout(function(){ if(!it.classList.contains('is-picked')) it.classList.remove('is-pressed'); }, 900);
    });
    row.addEventListener('click', function(e){
      if(e.defaultPrevented || state !== 'closed') return; // a drag's end; or open: home's tap closes
      if(Date.now() - spinTapAt < 800) return;            // this tap stopped the spin
      var it = e.target && e.target.closest ? e.target.closest('.impact-item') : null;
      if(it && row.contains(it)) pick(it);
    });
    // No ×: while the story is up, a tap anywhere on home puts it away (owner, 2026-10-10) —
    // except "Token allocation", which goes there, and the top bar and bottom nav,
    // which keep their own jobs.
    home.addEventListener('click', function(e){
      if(state !== 'open') return;
      var t = e.target;
      if(link.contains(t) || (t.closest && t.closest('.top, .bottom-nav, .partner-link'))) return;
      close();
    });
    row.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' && e.key !== ' ') return;
      var it = e.target && e.target.closest ? e.target.closest('.impact-item') : null;
      if(!it) return;
      e.preventDefault(); pick(it);
    });
    // While the story is up the row must not drag, spin or hand the touch to the page swipe:
    // stop the press here, on the way down, before the row's own handlers see it.
    function guard(e){ if(state !== 'closed' && row.contains(e.target)) e.stopPropagation(); }
    content.addEventListener('pointerdown', guard, true);
    content.addEventListener('touchstart', guard, { capture: true, passive: true });
    // Not a [data-go] button: those are wired once at start-up (document.querySelectorAll in the
    // router), before this box exists, so a data-go here would never fire. Navigate directly.
    link.addEventListener('click', function(e){
      e.stopPropagation();
      if(window.__hugNav) window.__hugNav('giving');   // leaving home closes the story (observer below)
    });
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && state !== 'closed') close(); });
    // If the row moves under an open story (the opening spin, a return from the background, a
    // panel switch from elsewhere) the story is no longer about what is on screen: drop it at once.
    var panelWatch = new MutationObserver(function(){
      if(kept && !rowAtRestFor(kept)) release();          // the row is moving: the drop hides in it
      if(state !== 'closed' && !rowAtRestFor(item)) close(true);
    });
    Array.prototype.forEach.call(row.querySelectorAll('.impact-panel'), function(p){
      panelWatch.observe(p, { attributes: true, attributeFilter: ['aria-hidden', 'style'] });
    });
    function rowAtRestFor(it){
      var p = it && it.closest('.impact-panel');
      return !!p && p.getAttribute('aria-hidden') !== 'true' && !p.style.transform;
    }
    // Leaving home (or the app) puts the row back as it was, at once.
    new MutationObserver(function(){ if(!home.classList.contains('active')){ close(true); release(); } })
      .observe(home, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'hidden'){ close(true); release(); } });
    // New figures while it is open: rewrite the words in place.
    if(window.__hugGiving && window.__hugGiving.onChange)
      window.__hugGiving.onChange(function(){ if(item && state !== 'closing') render(item.getAttribute('data-cause')); });

    window.__hugImpactDetail = { open: function(id){ var it = row.querySelector('.impact-panel:not([aria-hidden="true"]) [data-cause="' + id + '"]'); if(it) open(it); },
      close: close, get state(){ return state; } };
  })();

  (function impactFeature(){
    // TOKENS (combined, link-gated — matches the website + referral_leaderboard()):
    //   • each LINKED hug = 6 tokens (£1.50 of 25p tokens)
    //   • each non-reneged referral = +1 token (a refund flips it to 'reneged' and it drops off)
    // WHERE the tokens go is not decided here: it is the account's own split (givingFeature),
    // worked out by the server (my_giving) or, signed out / in prototype mode, by giving-math.js.
    var G = window.HugGivingMath;
    var ecoEl = document.getElementById('imp-eco');                  // the tokens hero number
    var soFarEl = document.getElementById('giving-so-far');
    var cupEl = document.getElementById('giving-per-cup');
    var qtyEl = document.getElementById('imp-qty');
    var minus = document.getElementById('imp-minus');
    var plus = document.getElementById('imp-plus');
    var qty = 1;

    function tokensFor(mugs, refs){
      var cfg = window.__hugGiving ? window.__hugGiving.config() : G.DEFAULT_CONFIG;
      return G.compute({ config: cfg, cups: mugs, referrals: refs }).tokens;
    }
    function setHero(text){ if(ecoEl) ecoEl.textContent = text; }
    function renderSoFar(){
      var giving = window.__hugGiving;
      if(!giving || !soFarEl) return;
      giving.renderOutcomes(soFarEl, giving.soFar());   // null (unknown) draws dashes, not zeros
    }
    function renderCup(){
      if(qtyEl) qtyEl.textContent = qty;
      var giving = window.__hugGiving;
      if(giving && cupEl) giving.renderOutcomes(cupEl, giving.perCup(qty));
    }
    if(minus) minus.addEventListener('click', function(e){ e.stopPropagation(); if(qty>1){ qty--; renderCup(); } });
    if(plus) plus.addEventListener('click', function(e){ e.stopPropagation(); if(qty<99){ qty++; renderCup(); } });
    [minus, plus].forEach(function(bn){ if(!bn) return;
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){ bn.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    });

    // Impact ties to the number of products LINKED to the account (1 hug = 6 tokens),
    // so the tokens and the "linked products" count always match.
    function load(){
      var mugs, refs;
      if(isDemoMode()){
        mugs = (DEMO.linkedCodes && DEMO.linkedCodes.length) || 0;
        refs = (window.__hugReferral && window.__hugReferral.count) || 0;
      } else if(document.documentElement.dataset.accountStatus !== 'active'){
        mugs = 0; refs = 0;   // fresh / signed-out
      } else {
        // `|| 0` counted an UNKNOWN referral balance as zero referrals, so the tokens
        // hero stated a figure computed from a read that never landed. Unknown is not zero:
        // hold the placeholder until the balance is actually known.
        var ref = window.__hugReferral;
        if(ref && ref.known === false){ setHero(HUG_UNKNOWN); renderSoFar(); renderCup(); return; }
        mugs = (typeof linkedProducts !== 'undefined' && linkedProducts) ? linkedProducts.length : 0;
        refs = (ref && ref.count) || 0;   // non-reneged referral count
      }
      var g = window.__hugGiving;
      // The server's own total wins when this account has one; otherwise the same formula here.
      var s = g && !isDemoMode() && document.documentElement.dataset.accountStatus === 'active' ? g.soFar() : null;
      setHero(G.formatTokensTotal(s ? s.tokens : tokensFor(mugs, refs)));
      renderSoFar(); renderCup();
      if(mugs > 0 && !load.seeded){ qty = Math.min(99, mugs); load.seeded = true; renderCup(); }
    }
    window.__hugImpact = { load: load };
    if(window.__hugGiving) window.__hugGiving.onChange(function(){ load(); });
    load();
  })();

  /* REFERRAL RATE — the rates behind the share text ("… {n}% off"). The balance screen's rate card
     is gone (owner, 2026-10-10: "saying the 5% stuff again.. they need to be told once and that is
     it"); what stays is the friend's % for the share message: the account's own current rate
     (my_referral_balance, SPEC §3.2) when known, else the base 5%. */
  (function referralRateFeature(){
    var rates = null;
    function friendRate(){
      if(rates && isFinite(rates.friendRate)) return rates.friendRate;
      if(rates && isFinite(rates.baseFriendRate)) return rates.baseFriendRate;
      return 0.05;
    }
    window.__hugReferralRates = {
      set: function(r){ rates = r || null; },
      render: function(){},
      friendPercent: function(){ return Math.round(friendRate() * 100); }
    };
  })();


  // ----- Account auth: dedicated sign-in / set-up / set-password modal -----
  // Self-contained overlay (independent of product scanning) so a user can sign
  // in with the SAME hug account they use on the website. Password + email-code
  // + sign-up-with-confirm, all on the shared Supabase project. Mirrors the web.
  (function accountAuthFeature(){
    var overlay = null, els = {}, mode = 'signin', stage = 'main';
    var pendingEmail = '', pendingName = '', pendingKind = '', pendingPassword = '', busy = false;

    // Remembered accounts: emails that have signed in on this device, kept so the
    // user can re-sign-in fast (tap to fill the email, then let iOS Face ID
    // autofill the password). Survives the sign-out reset (separate key). Emails
    // aren't secret; the PASSWORD is never stored by us — that's iOS Keychain's job.
    var KNOWN_EMAILS_KEY = 'hug-known-emails-v1';
    var BIO_EMAILS_KEY = 'hug-bio-emails-v1';   // emails that have Face ID creds saved (Keychain)
    var bioAvailable = false;                    // device has Face ID / Touch ID set up
    function getKnownEmails(){
      try { var a = JSON.parse(localStorage.getItem(KNOWN_EMAILS_KEY) || '[]'); return Array.isArray(a) ? a.filter(isValidEmail) : []; }
      catch(e){ return []; }
    }
    function getBioEmails(){
      try { var a = JSON.parse(localStorage.getItem(BIO_EMAILS_KEY) || '[]'); return Array.isArray(a) ? a : []; }
      catch(e){ return []; }
    }
    function hasBio(email){ return getBioEmails().indexOf(String(email||'').trim().toLowerCase()) >= 0; }
    function setBioEmail(email, on){
      email = String(email||'').trim().toLowerCase();
      var list = getBioEmails().filter(function(e){ return e !== email; });
      if(on) list.unshift(email);
      var payload = JSON.stringify(list.slice(0, 8));
      try { localStorage.setItem(BIO_EMAILS_KEY, payload); } catch(e){}
      durableSet(BIO_EMAILS_KEY, payload);
    }
    /* WHY THESE TWO LISTS ARE MIRRORED.
       The Face ID credential itself lives in the iOS Keychain, which survives everything —
       eviction, and even a reinstall. But whether a chip is OFFERED is decided entirely by
       these two localStorage keys: getKnownEmails() supplies the chips, hasBio() puts the
       face glyph on one. Lose localStorage and there is no chip, so there is no Face ID
       entry point at all — the credential is still sitting in the Keychain, unreachable.
       That is what "the face recognition was not working" is: not a broken prompt, a
       missing button. Same durable-thing/evictable-index split as the balance had.
       Restoring a chip whose Keychain entry has genuinely gone is safe: biometricSignInAs
       already handles a credential that no longer works by dropping it and emailing a code. */
    function hydrateAccountListsFromDurable(){
      if(!window.HugStore) return Promise.resolve(false);
      var wantKnown = getKnownEmails().length === 0;
      var wantBio = getBioEmails().length === 0;
      if(!wantKnown && !wantBio) return Promise.resolve(false);
      return Promise.all([
        wantKnown ? window.HugStore.get(KNOWN_EMAILS_KEY) : null,
        wantBio ? window.HugStore.get(BIO_EMAILS_KEY) : null
      ]).then(function(vals){
        var changed = false;
        [[KNOWN_EMAILS_KEY, vals[0]], [BIO_EMAILS_KEY, vals[1]]].forEach(function(pair){
          if(!pair[1]) return;
          try {
            var parsed = JSON.parse(pair[1]);
            if(!Array.isArray(parsed) || !parsed.length) return;   // never write junk back
            localStorage.setItem(pair[0], pair[1]);
            changed = true;
          } catch(e){}
        });
        return changed;
      }).catch(function(){ return false; });
    }
    function refreshBioAvailable(){
      var b = window.HugBackend;
      if(!(b && b.biometricAvailable)) { bioAvailable = false; return Promise.resolve(false); }
      return b.biometricAvailable().then(function(r){ bioAvailable = !!(r && r.available); return bioAvailable; })
        .catch(function(){ bioAvailable = false; return false; });
    }
    // After a password sign-in, offer to enable Face ID for that account.
    function maybeOfferBiometric(email, password){
      if(!bioAvailable || !password) return;
      var b = window.HugBackend;
      if(!(b && b.saveBiometricCredentials)) return;
      if(hasBio(email)){
        // Already enabled — silently REFRESH the stored password every successful
        // sign-in / password change, so Face ID can never go stale on this device.
        b.saveBiometricCredentials(email, password);
        return;
      }
      showConfirm({ title: 'Use Face ID next time?', body: 'Save this login to your device so you can sign in to ' + email + ' with Face ID — no typing.', confirm: 'Use Face ID', cancel: 'Not now' })
        .then(function(ok){
          if(!ok) return;
          b.saveBiometricCredentials(email, password).then(function(res){ if(res && res.ok){ setBioEmail(email, true); rememberEmail(email); } });
        });
    }
    // Tap a Face-ID-enabled chip -> biometric prompt -> sign in, no typing.
    function biometricSignInAs(email){
      var b = window.HugBackend;
      if(busy || !(b && b.biometricGetCredentials)) return;
      busy = true;
      Promise.resolve(b.biometricGetCredentials(email)).then(function(c){
        if(!c || !c.ok){ busy = false; return; }   // cancelled / dismissed: stay on the form
        return b.signInWithPassword(c.email || email, c.password).then(function(si){
          busy = false;
          if(si && si.ok){ finishSignedIn(si.email || email); return; }
          // Stored password is stale (e.g. it was changed on another device).
          // Don't dump the user into a password box they may not know — drop the
          // stale Face ID and email a code so they still get in, passwordless.
          setBioEmail(email, false);
          if(b.deleteBiometricCredentials) b.deleteBiometricCredentials(email);
          els.email.value = email; renderAccountChips();
          showToast('Face ID sign-in expired — emailing you a code.');
          sendOtp(email);
        });
      }).catch(function(){ busy = false; });
    }
    function rememberEmail(email){
      email = String(email||'').trim().toLowerCase();
      if(!isValidEmail(email)) return;
      var list = getKnownEmails().filter(function(e){ return e !== email; });
      list.unshift(email);
      var payload = JSON.stringify(list.slice(0, 4));
      try { localStorage.setItem(KNOWN_EMAILS_KEY, payload); } catch(e){}
      durableSet(KNOWN_EMAILS_KEY, payload);
    }
    function forgetEmail(email){
      var payload = JSON.stringify(getKnownEmails().filter(function(e){ return e !== email; }));
      try { localStorage.setItem(KNOWN_EMAILS_KEY, payload); }
      catch(e){}
      durableSet(KNOWN_EMAILS_KEY, payload);   // or the next boot restores the forgotten account
    }
    // Tappable chips for each remembered account — only on the sign-in screen.
    // A chip with Face ID enabled shows a face glyph and signs in on tap; others
    // just fill the email. The × forgets the account (and its Keychain login).
    var FACE_SVG = '<svg class="hug-auth-account-face" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16"/>' +
      '<path d="M9 9.5v1.5M15 9.5v1.5M12 9v4l-1 1"/><path d="M9.2 15.5c1.4 1.1 4.2 1.1 5.6 0"/></svg>';
    function renderAccountChips(){
      if(!els.accounts) return;
      els.accounts.innerHTML = '';
      var emails = (mode === 'signin' && stage === 'main') ? getKnownEmails() : [];
      els.accounts.style.display = emails.length ? '' : 'none';
      emails.forEach(function(em){
        var bio = bioAvailable && hasBio(em);
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'hug-auth-account' + (bio ? ' has-bio' : '');
        chip.innerHTML = (bio ? FACE_SVG : '') + '<span class="hug-auth-account-em"></span><span class="hug-auth-account-x" aria-label="Forget">×</span>';
        chip.querySelector('.hug-auth-account-em').textContent = em;
        chip.addEventListener('click', function(ev){
          if(ev.target && ev.target.classList.contains('hug-auth-account-x')){
            ev.stopPropagation();
            forgetEmail(em);
            if(hasBio(em)){ setBioEmail(em, false); if(window.HugBackend && window.HugBackend.deleteBiometricCredentials) window.HugBackend.deleteBiometricCredentials(em); }
            renderAccountChips();
            return;
          }
          if(bio){ biometricSignInAs(em); return; }
          els.email.value = em;
          try{ els.pass.focus(); }catch(e){}
        });
        els.accounts.appendChild(chip);
      });
    }

    function build(){
      overlay = document.createElement('div');
      overlay.className = 'hug-auth-overlay';
      overlay.innerHTML =
        '<div class="hug-auth-card" role="dialog" aria-modal="true" aria-labelledby="hug-auth-title">' +
          '<button type="button" class="hug-auth-close" aria-label="Close">×</button>' +
          '<h3 class="hug-auth-title" id="hug-auth-title"></h3>' +
          '<p class="hug-auth-copy"></p>' +
          '<div class="hug-auth-accounts"></div>' +
          '<form class="hug-auth-form" novalidate>' +
            '<input class="hug-auth-input hug-auth-name" type="text" name="name" autocomplete="name" autocapitalize="words" spellcheck="false" placeholder="name (optional)">' +
            // autocomplete="username" + the password field below lets iOS save the
            // login to Keychain and offer it back via Face ID / Touch ID autofill.
            '<input class="hug-auth-input hug-auth-email" type="email" name="username" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="you@example.com">' +
            '<input class="hug-auth-input hug-auth-pass" type="password" name="password" autocomplete="current-password" placeholder="password">' +
            '<input class="hug-auth-input hug-auth-code" type="text" inputmode="numeric" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" maxlength="10" placeholder="code from email">' +
            '<p class="hug-auth-error" role="alert" aria-live="polite"></p>' +
            '<button type="submit" class="hug-auth-submit"></button>' +
          '</form>' +
          '<div class="hug-auth-links">' +
            '<button type="button" class="hug-auth-alt"></button>' +
            '<button type="button" class="hug-auth-toggle"></button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      ['card','title','copy','form','accounts','name','email','pass','code','error','submit','alt','toggle'].forEach(function(k){
        els[k] = overlay.querySelector('.hug-auth-' + k);
      });
      overlay.querySelector('.hug-auth-close').addEventListener('click', close);
      overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
      els.form.addEventListener('submit', onSubmit);
      els.alt.addEventListener('click', onAlt);
      els.toggle.addEventListener('click', onToggle);
      // Keyboard-aware: lift the centered card above the on-screen keyboard so the
      // email, password, the Sign-in button AND the "set up an account" link stay
      // visible. The app runs Keyboard resize:"none" (visualViewport doesn't see
      // the keyboard), so use the native plugin's reported height.
      var K = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
      if(K && K.addListener){
        K.addListener('keyboardWillShow', function(info){
          if(overlay && overlay.classList.contains('show'))
            overlay.style.paddingBottom = (((info && info.keyboardHeight) || 0) + 24) + 'px';
        });
        K.addListener('keyboardWillHide', function(){
          if(overlay) overlay.style.paddingBottom = '';
        });
      }
    }

    function setError(m){ if(els.error) els.error.textContent = m || ''; }

    function render(){
      overlay.dataset.mode = mode;
      overlay.dataset.stage = stage;
      setError('');
      renderAccountChips();
      if(stage === 'code'){
        els.title.textContent = pendingKind === 'signup' ? 'Confirm your email' : 'Enter the code';
        els.copy.textContent = 'We emailed a code to ' + pendingEmail + '.';
        els.submit.textContent = pendingKind === 'signup' ? 'Create account' : 'Verify code';
        els.alt.textContent = 'use a different email';
        els.toggle.textContent = '';
        requestAnimationFrame(function(){ try{ els.code.focus(); }catch(e){} });
        return;
      }
      if(mode === 'setpass'){
        els.pass.setAttribute('autocomplete','new-password');
        if(stage === 'confirm'){
          els.title.textContent = 'Confirm password';
          els.copy.textContent = 'Re-enter your new password to confirm.';
          els.pass.placeholder = 'confirm new password';
          els.submit.textContent = 'Save password';
          els.alt.textContent = 'back';
        } else {
          els.title.textContent = 'Set a password';
          els.copy.textContent = 'Use this to sign in next time — on the app or the website.';
          els.pass.placeholder = 'new password';
          els.submit.textContent = 'Next';
          els.alt.textContent = '';
        }
        els.toggle.textContent = '';
        requestAnimationFrame(function(){ try{ els.pass.focus(); }catch(e){} });
        return;
      }
      if(mode === 'signup' && stage === 'confirm'){
        // Step 2 of sign-up — re-enter the password (two-step, like set-password).
        els.pass.setAttribute('autocomplete','new-password');
        els.title.textContent = 'Confirm password';
        els.copy.textContent = 'Re-enter your password to confirm.';
        els.pass.placeholder = 'confirm password';
        els.submit.textContent = 'Create account';
        els.alt.textContent = 'back';
        els.toggle.textContent = '';
        requestAnimationFrame(function(){ try{ els.pass.focus(); }catch(e){} });
        return;
      }
      if(mode === 'signup'){
        els.title.textContent = 'Set up an account';
        els.copy.textContent = 'Create a password — it works on the app and the website.';
        els.pass.setAttribute('autocomplete','new-password');
        els.pass.placeholder = 'password (min 6 characters)';
        els.submit.textContent = 'Next';
        els.alt.textContent = '';
        els.toggle.textContent = 'have an account? sign in';
      } else {
        els.title.textContent = 'Sign in';
        els.copy.textContent = 'Your hug account — the same login as the website.';
        els.pass.setAttribute('autocomplete','current-password');
        els.pass.placeholder = 'password';
        els.submit.textContent = 'Sign in';
        els.alt.textContent = 'email me a code instead';
        els.toggle.textContent = 'set up an account';
      }
      requestAnimationFrame(function(){ try{ (mode==='signup'?els.name:els.email).focus(); }catch(e){} });
    }

    function open(initialMode){
      if(!overlay) build();
      mode = (initialMode === 'signup' || initialMode === 'setpass') ? initialMode : 'signin';
      stage = 'main'; pendingEmail=''; pendingName=''; pendingKind=''; pendingPassword='';
      els.name.value=''; els.email.value=''; els.pass.value=''; els.code.value='';
      // Pre-fill the most recently used account so re-signing in is quick.
      if(mode === 'signin'){ var known = getKnownEmails(); if(known.length) els.email.value = known[0]; }
      render();
      overlay.classList.add('show');
      // Re-render chips once we know if Face ID is set up (async), so bio chips
      // pick up the face glyph + tap-to-Face-ID behaviour. Recover the account lists
      // from the durable mirror first — without that, a device whose localStorage was
      // evicted (or freshly reinstalled) shows no chips at all and the Keychain
      // credential behind Face ID is unreachable. Re-fills the prefill too.
      hydrateAccountListsFromDurable().then(function(restored){
        if(restored && mode === 'signin' && !els.email.value){
          var k = getKnownEmails();
          if(k.length) els.email.value = k[0];
        }
        return refreshBioAvailable();
      }).then(function(){ renderAccountChips(); });
    }
    function close(){ if(overlay){ overlay.classList.remove('show'); overlay.style.paddingBottom = ''; } }

    function onToggle(){ if(stage==='code') return; mode = (mode==='signup' ? 'signin' : 'signup'); render(); }

    function onAlt(){
      // Back out of a confirm-password step (sign-up or set-password).
      if(stage === 'confirm'){
        stage = 'main';
        render();
        els.pass.value = (mode === 'signup') ? pendingPassword : '';
        return;
      }
      if(stage === 'code'){ stage='main'; pendingKind=''; render(); return; }
      var email = String(els.email.value||'').trim();
      if(!isValidEmail(email)){ setError('Enter a valid email address.'); els.email.focus(); return; }
      sendOtp(email);
    }

    // Disable + relabel the submit button while an async auth op runs.
    function withBusy(label, fn){
      busy = true; setError(''); var prev = els.submit.textContent;
      els.submit.textContent = label; els.submit.disabled = true;
      return fn().finally(function(){ busy = false; els.submit.disabled = false; els.submit.textContent = prev; });
    }

    function sendOtp(email){
      var backend = window.HugBackend;
      if(!backend || !backend.enabled){ setError('Sign-in is unavailable right now.'); return; }
      if(busy) return;
      withBusy('Sending…', function(){ return backend.signInWithOtp(email); }).then(function(sent){
        if(!sent || !sent.ok){ setError("Couldn't send the code. Try again."); return; }
        pendingEmail = email; pendingKind = 'otp'; stage = 'code'; render();
      });
    }

    function onSubmit(e){
      e.preventDefault();
      var backend = window.HugBackend;
      if(busy) return;
      if(!backend || !backend.enabled){ setError('Sign-in is unavailable right now.'); return; }

      if(stage === 'code'){
        var code = String(els.code.value||'').trim();
        if(!/^\d{4,10}$/.test(code)){ setError('Enter the code from the email.'); els.code.focus(); return; }
        withBusy('Verifying…', function(){
          return pendingKind === 'signup'
            ? backend.verifySignup(pendingEmail, code, pendingName)
            : backend.verifyOtp(pendingEmail, code);
        }).then(function(res){
          if(!res || !res.ok){ setError(res && res.status==='invalid-code' ? "That code didn't match." : "Couldn't verify the code."); els.code.focus(); try{ els.code.select(); }catch(e){} return; }
          var em = res.email || pendingEmail;
          finishSignedIn(em);
          if(pendingKind === 'signup' && pendingPassword) maybeOfferBiometric(em, pendingPassword);
        });
        return;
      }

      if(mode === 'setpass'){
        var np = String(els.pass.value||'');
        if(stage !== 'confirm'){
          // Step 1: enter the new password.
          if(np.length < 6){ setError('Password must be at least 6 characters.'); els.pass.focus(); return; }
          pendingPassword = np;
          els.pass.value = '';
          stage = 'confirm';
          render();
          return;
        }
        // Step 2: re-enter to confirm, then save.
        if(np !== pendingPassword){ setError('Passwords don’t match. Try again.'); els.pass.focus(); try{ els.pass.select(); }catch(e){} return; }
        withBusy('Saving…', function(){ return backend.setPassword(np); }).then(function(res){
          if(!res || !res.ok){ setError("Couldn't save the password. Try again."); return; }
          close(); showToast('Password saved.');
          if(accountEmail) maybeOfferBiometric(accountEmail, np);   // now there's a password — offer Face ID
        });
        return;
      }

      // Sign-up is a two-step flow (enter password -> confirm on the next screen),
      // matching set-password so every place you set a password is two-step.
      if(mode === 'signup'){
        var suEmail = String(els.email.value||'').trim();
        var suPass = String(els.pass.value||'');
        if(stage !== 'confirm'){
          // Step 1: name + email + new password.
          if(!isValidEmail(suEmail)){ setError('Enter a valid email address.'); els.email.focus(); return; }
          if(suPass.length < 6){ setError('Password must be at least 6 characters.'); els.pass.focus(); return; }
          pendingEmail = suEmail;
          pendingName = String(els.name.value||'').trim();
          pendingPassword = suPass;
          els.pass.value = '';
          stage = 'confirm';
          render();
          return;
        }
        // Step 2: re-enter to confirm, then create.
        if(suPass !== pendingPassword){ setError('Passwords don’t match. Try again.'); els.pass.focus(); try{ els.pass.select(); }catch(e){} return; }
        withBusy('Creating…', function(){ return backend.signUp(pendingEmail, suPass, pendingName); }).then(function(su){
          if(!su || !su.ok){
            if(su && su.status==='already-registered'){ setError('That email already has an account — sign in.'); mode='signin'; stage='main'; render(); els.email.value=pendingEmail; return; }
            setError((su && su.message) || "Couldn't create the account."); stage='main'; render(); els.email.value=pendingEmail; els.pass.value=pendingPassword; return;
          }
          if(su.session){ finishSignedIn(pendingEmail); maybeOfferBiometric(pendingEmail, suPass); return; }   // confirm disabled -> straight in
          pendingKind = 'signup'; stage = 'code'; render();
        });
        return;
      }

      var email = String(els.email.value||'').trim();
      var pass = String(els.pass.value||'');
      if(!isValidEmail(email)){ setError('Enter a valid email address.'); els.email.focus(); return; }
      if(pass.length < 6){ setError('Password must be at least 6 characters.'); els.pass.focus(); return; }

      withBusy('Signing in…', function(){ return backend.signInWithPassword(email, pass); }).then(function(si){
        if(!si || !si.ok){ setError(si && si.status==='invalid-credentials' ? 'Wrong email or password — or tap “email me a code instead” below.' : ((si && si.message) || "Couldn't sign in.")); return; }
        var em = si.email || email;
        finishSignedIn(em);
        maybeOfferBiometric(em, pass);   // offer Face ID for next time
      });
    }

    function finishSignedIn(email){
      rememberEmail(email);   // remember this account for fast re-sign-in next time
      setHugAccountState('active', email);
      refreshReferralCodeFromServer();
      refreshReferralBalanceFromServer();
      if (typeof refreshLinkedProductsFromServer === 'function') refreshLinkedProductsFromServer();
      if (window.__hugPurchases) window.__hugPurchases.refresh();
      close();
      // Never leave the user on a stale transparent camera overlay, and move them
      // off Settings (where sign-in is triggered) onto Home.
      document.documentElement.classList.remove('scan-camera-active');
      var activeScreenEl = document.querySelector('.screen.active');
      if (window.__hugNav && activeScreenEl && activeScreenEl.dataset.screen === 'settings') window.__hugNav('home');
      showToast('Signed in as ' + email);
    }

    window.__hugAuth = {
      open: open,
      // Forget a remembered account + its saved Face ID login (used on delete).
      forgetAccount: function(email){
        forgetEmail(email);
        if(hasBio(email)){ setBioEmail(email, false); if(window.HugBackend && window.HugBackend.deleteBiometricCredentials) window.HugBackend.deleteBiometricCredentials(email); }
      }
    };
  })();

  // ----- Account controls injected into Settings (sign in / out / delete) -----
  (function accountControls(){
    var settings = document.querySelector('.screen[data-screen="settings"] .content.plain-content');
    if(!settings) return;
    var box = document.createElement('div');
    box.className = 'account-controls';
    settings.appendChild(box);

    function row(cls, sym, label){
      return '<button class="simple-row ' + cls + '" type="button"><span class="row-left">' +
        '<svg class="row-svg" viewBox="0 0 64 64" aria-hidden="true"><use href="#' + sym + '"></use></svg>' +
        label + '</span><span>›</span></button>';
    }
    async function onSignOut(){
      var ok = await showConfirm({ title:'Sign out', body:'Sign out of your hug account?', confirm:'Sign out', cancel:'Cancel' });
      if(!ok) return;
      try { if(window.HugBackend && window.HugBackend.signOut) await window.HugBackend.signOut(); } catch(e){}
      if(window.clearHugAccountState) window.clearHugAccountState();
      showToast('Signed out.');
    }
    async function onDelete(){
      var ok = await showConfirm({ title:'Delete account', body:"Permanently delete your account and data? This can't be undone.", confirm:'Delete', cancel:'Cancel' });
      if(!ok) return;
      var res = await (window.HugBackend && window.HugBackend.deleteAccount ? window.HugBackend.deleteAccount() : Promise.resolve({ ok:false }));
      if(!res || !res.ok){ showToast("Couldn't delete the account. Try again."); return; }
      try { if(window.__hugAuth && window.__hugAuth.forgetAccount && accountEmail) window.__hugAuth.forgetAccount(accountEmail); } catch(e){}
      try { if(window.HugBackend && window.HugBackend.signOut) await window.HugBackend.signOut(); } catch(e){}
      if(window.clearHugAccountState) window.clearHugAccountState();
      showToast('Your account was deleted.');
    }
    async function onSignOutDemo(){
      // Prototype mode is drawn OVER the real signed-in account, not a separate fake one, so
      // signing out here signs the real account out — and ends prototype mode with it.
      var ok = await showConfirm({ title:'Sign out', body:'Sign out of your hug account? Prototype mode turns off.', confirm:'Sign out', cancel:'Cancel' });
      if(!ok) return;
      try { if(window.HugBackend && window.HugBackend.signOut) await window.HugBackend.signOut(); } catch(e){}
      if(window.clearHugAccountState) window.clearHugAccountState();
      location.reload();
    }
    function render(){
      if(isDemoMode()){
        // Prototype simulates a signed-in account: the only account action is sign out.
        box.innerHTML = row('account-signout','i-signout','sign out');
        box.querySelector('.account-signout').addEventListener('click', onSignOutDemo);
        return;
      }
      var active = document.documentElement.dataset.accountStatus === 'active';
      if(!active){
        box.innerHTML = row('account-signin', 'i-key', 'sign in');
        box.querySelector('.account-signin').addEventListener('click', function(){ if(window.__hugAuth) window.__hugAuth.open('signin'); });
      } else {
        box.innerHTML = row('account-setpass','i-key','set a password') + row('account-signout','i-signout','sign out') + row('account-delete','i-trash','delete account');
        box.querySelector('.account-setpass').addEventListener('click', function(){ if(window.__hugAuth) window.__hugAuth.open('setpass'); });
        box.querySelector('.account-signout').addEventListener('click', onSignOut);
        box.querySelector('.account-delete').addEventListener('click', onDelete);
      }
    }
    window.__hugAccountControls = { render: render };
    render();
  })();

  /* PROTOTYPE MODE — the Settings switch. Shown only to a signed-in person the server has said
     may have it (see the prototype gate near isDemoMode and refreshPrototypeAccess). Turning it
     on explains itself first; either direction reloads, because a dozen features read the mode
     while they build the page. The launch curtain covers the reload. */
  (function prototypeSwitchFeature(){
    var settings = document.querySelector('.screen[data-screen="settings"] .content.plain-content');
    if(!settings) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'simple-row';
    btn.classList.add('proto-row');
    btn.setAttribute('role', 'switch');
    btn.hidden = true;
    btn.innerHTML = '<span class="row-left"><svg class="row-svg" viewBox="0 0 64 64" aria-hidden="true"><use href="#i-sparkle"></use></svg>prototype mode</span>' +
      '<span class="proto-switch" aria-hidden="true"><span class="proto-knob"></span></span>';
    // Above the account rows, below the screens list — it changes what every screen shows.
    var controls = settings.querySelector('.account-controls');
    settings.insertBefore(btn, controls || null);
    function signedInEmail(){
      if(document.documentElement.dataset.accountStatus !== 'active') return '';
      try { return localStorage.getItem('hug-account-email-v1') || ''; } catch(e){ return ''; }
    }
    function render(){
      var on = isDemoMode();
      btn.hidden = !(on || prototypeAllowedFor(signedInEmail()));
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
    }
    btn.addEventListener('click', async function(){
      if(isDemoMode()){ setPrototypeMode(false); location.reload(); return; }
      if(!prototypeAllowedFor(signedInEmail())){ render(); return; }
      var ok = await showConfirm({ title:'Prototype mode',
        body:'Fills the app with sample people, referrals and money, to show what it looks like when it is busy. Your real account is not changed, and nothing you do in prototype mode is saved.',
        confirm:'Turn on', cancel:'Cancel' });
      if(!ok) return;
      setPrototypeMode(true);
      location.reload();
    });
    window.__hugPrototypeSwitch = { render: render };
    render();
    // The bridge refused a write because prototype mode is on (native-bridge.js prototypeGuard).
    // Say so plainly, so a demo never looks broken and nobody thinks a sample change was saved.
    window.addEventListener('hug:prototype-blocked', function(){
      showToast('Prototype mode — nothing was changed.');
    });
  })();

  // ----- Language selector (Settings): mirrors the storefront footer switcher -----
  // A "language" row that opens an on-brand bottom-sheet (clone of the help overlay)
  // listing the same 20 languages as the website (flag + native name, gradient-dot on
  // the current one). Picking one persists the choice and reloads; assets/i18n/hug-i18n.js
  // then translates the whole app on the fresh DOM. Language names are never translated,
  // so the option list + the row's current-language chip carry data-i18n-skip.
  (function languageSelector(){
    var settings = document.querySelector('.screen[data-screen="settings"] .content.plain-content');
    if(!settings) return;
    var LANGS = (window.HUG_LANGS) || [{ code:'en', flag:'🇬🇧', name:'English' }];
    function cur(){ try { return (window.hugCurrentLang ? window.hugCurrentLang() : 'en'); } catch(e){ return 'en'; } }
    function meta(code){ for(var i=0;i<LANGS.length;i++){ if(LANGS[i].code===code) return LANGS[i]; } return LANGS[0]; }

    // Settings row. The "language" label translates; the current-language chip does not.
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'simple-row lang-row';
    function paintRow(){
      var m = meta(cur());
      // The row is just the current language: flag + native name. No icon, no "language"
      // label — the flag makes it self-explanatory, and language names are never translated.
      row.innerHTML = '<span class="row-left" translate="no" data-i18n-skip>' +
          '<span class="lang-row-flag' + (m.flag.charCodeAt(0) === 0xD83C ? '' : ' lang-flag--script') + '" aria-hidden="true">' + m.flag + '</span>' +
          '<span class="lang-row-name">' + m.name + '</span>' +
        '</span><span class="lang-row-chev" aria-hidden="true">›</span>';
    }
    paintRow();
    // Sit with the primary nav rows: right after "linked products".
    var linked = settings.querySelector('#settings-linked');
    if (linked && linked.nextSibling) settings.insertBefore(row, linked.nextSibling);
    else if (linked) settings.appendChild(row);
    else settings.appendChild(row);

    function open(){
      var active = cur();
      var opts = LANGS.map(function(l){
        return '<button type="button" class="lang-opt" role="option" data-lang="' + l.code + '" lang="' + l.code + '" aria-selected="' + (l.code===active?'true':'false') + '">' +
          '<span class="lang-flag' + (l.flag.charCodeAt(0) === 0xD83C ? '' : ' lang-flag--script') + '" aria-hidden="true">' + l.flag + '</span>' +
          '<span class="lang-name">' + l.name + '</span>' +
        '</button>';
      }).join('');
      var ov = document.createElement('div');
      ov.className = 'lang-overlay';
      ov.innerHTML =
        '<div class="lang-card" role="dialog" aria-modal="true" aria-label="Language">' +
          '<div class="lang-head lang-head--bare"><button type="button" class="lang-close" aria-label="Close">✕</button></div>' +
          '<div class="lang-scroll" role="listbox" aria-label="Language" translate="no" data-i18n-skip>' + opts + '</div>' +
        '</div>';
      function close(){ ov.classList.remove('show'); document.removeEventListener('keydown', onKey); setTimeout(function(){ ov.remove(); }, 200); }
      function onKey(e){ if(e.key==='Escape') close(); }
      ov.querySelector('.lang-close').addEventListener('click', close);
      ov.addEventListener('click', function(e){ if(e.target===ov) close(); });
      document.addEventListener('keydown', onKey);
      ov.querySelectorAll('.lang-opt').forEach(function(btn){
        btn.addEventListener('click', function(){
          var code = btn.getAttribute('data-lang');
          if(code === cur()){ close(); return; }
          // Persist + reload; the i18n engine applies the new language on next boot.
          if(window.hugSetLang){ window.hugSetLang(code); }
          else { try { localStorage.setItem('hug_lang', code); } catch(e){} location.reload(); }
        });
      });
      document.body.appendChild(ov);
      requestAnimationFrame(function(){ ov.classList.add('show'); });
    }
    row.addEventListener('click', open);
    window.__hugLanguage = { open: open, repaint: paintRow };
  })();

  // ----- Hidden diagnostics screen (support / release debugging) -----
  // Entry point: a small version line at the foot of Settings; tapping it 7×
  // within ~1.6s opens a read-only panel of build info, plugin availability,
  // permissions, the last result of each backend op, and the recent event log
  // (all from HugDiag). A "copy for support" button puts it on the clipboard.
  // No secrets/PII — HugDiag strips those before anything is stored.
  (function diagnosticsFeature(){
    var settings = document.querySelector('.screen[data-screen="settings"] .content.plain-content');
    var build = window.__HUG_BUILD__ || {};
    var foot = document.createElement('button');
    foot.type = 'button';
    foot.className = 'diag-version';
    foot.textContent = 'hug ' + (build.version || '0.0.0') + (build.env && build.env !== 'production' ? ' · ' + build.env : '');
    if (settings) settings.appendChild(foot);

    var taps = 0, tapTimer = 0;
    foot.addEventListener('click', function(){
      taps++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function(){ taps = 0; }, 1600);
      if (taps >= 7) { taps = 0; open(); }
    });

    function ago(t){ if(!t) return ''; var s=Math.max(0,Math.round((Date.now()-t)/1000)); if(s<60) return s+'s ago'; var m=Math.round(s/60); if(m<60) return m+'m ago'; var h=Math.round(m/60); if(h<48) return h+'h ago'; return Math.round(h/24)+'d ago'; }
    function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }); }
    function vstr(v){ return (typeof v==='object' && v!==null)?JSON.stringify(v):String(v); }

    function buildText(snap, live){
      var L=[];
      L.push('hug diagnostics — '+new Date().toISOString());
      L.push('version '+(snap.build.version||'?')+' (build '+((live.appInfo&&live.appInfo.build!=null)?live.appInfo.build:'?')+', id '+(snap.build.buildId||'?')+') · '+(snap.build.env||'?')+' · '+(live.mode||'?'));
      L.push('built '+(snap.build.builtAt||'?'));
      L.push('');
      L.push('[device]');
      L.push('platform: '+(live.platform||'?')+(live.native?' (native)':' (web)'));
      L.push('camera: '+(live.cameraPermission||'?'));
      L.push('biometric: '+(live.biometric&&live.biometric.available?('yes '+(live.biometric.type||'')):'no'));
      L.push('auth: '+(live.auth&&live.auth.signedIn?('signed in '+(live.auth.userId||'')):'signed out'));
      L.push('shop: '+(live.shop&&live.shop.configured?'configured':'unconfigured')+' '+((live.shop&&live.shop.domain)||''));
      var pl=live.plugins||{}; L.push('plugins: '+Object.keys(pl).map(function(k){return k+'='+(pl[k]?'1':'0');}).join(' '));
      L.push('supabase: '+(live.supabaseUrl||'?'));
      L.push('');
      L.push('[last results]');
      var m=snap.marks||{}; Object.keys(m).forEach(function(k){ L.push(k+': '+vstr(m[k]&&m[k].v)+'  ('+ago(m[k].t)+')'); });
      L.push('');
      L.push('[recent events]');
      (snap.events||[]).slice(-40).forEach(function(e){ L.push(new Date(e.t).toISOString().slice(11,19)+' '+e.ev+(e.d?(' '+JSON.stringify(e.d)):'')); });
      return L.join('\n');
    }

    async function open(){
      var snap = (window.HugDiag && window.HugDiag.snapshot) ? window.HugDiag.snapshot() : { build: build, marks:{}, events:[] };
      var live = {};
      try { if (window.HugDiag && window.HugDiag.live) live = await window.HugDiag.live(); } catch(e){ live = {}; }
      var pl = live.plugins || {};
      var m = snap.marks || {};
      var markRows = Object.keys(m).map(function(k){
        return '<div class="diag-row"><span class="diag-k">'+esc(k)+'</span><span class="diag-v">'+esc(vstr(m[k]&&m[k].v))+'</span><span class="diag-t">'+esc(ago(m[k].t))+'</span></div>';
      }).join('') || '<div class="diag-empty">no operations yet</div>';
      var evRows = (snap.events||[]).slice(-40).reverse().map(function(e){
        return '<div class="diag-ev"><span class="diag-t">'+esc(new Date(e.t).toISOString().slice(11,19))+'</span> <span class="diag-evn">'+esc(e.ev)+'</span>'+(e.d?(' <span class="diag-evd">'+esc(JSON.stringify(e.d))+'</span>'):'')+'</div>';
      }).join('') || '<div class="diag-empty">no events yet</div>';
      var ov = document.createElement('div');
      ov.className = 'diag-overlay';
      ov.innerHTML =
        '<div class="diag-card" role="dialog" aria-modal="true" aria-label="Diagnostics">'+
          '<div class="diag-head"><span class="diag-title">diagnostics</span><button type="button" class="diag-close" aria-label="Close">✕</button></div>'+
          '<div class="diag-scroll">'+
            '<div class="diag-sec">build</div>'+
            '<div class="diag-row"><span class="diag-k">version</span><span class="diag-v">'+esc((snap.build.version||'?')+' · '+(snap.build.env||'?'))+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">build no.</span><span class="diag-v">'+esc((live.appInfo&&live.appInfo.build!=null)?live.appInfo.build:'? (web)')+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">build id</span><span class="diag-v">'+esc(snap.build.buildId||'?')+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">built</span><span class="diag-v">'+esc((snap.build.builtAt||'').replace('T',' ').slice(0,19))+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">mode</span><span class="diag-v">'+esc(live.mode||'?')+'</span></div>'+
            '<div class="diag-sec">device</div>'+
            '<div class="diag-row"><span class="diag-k">platform</span><span class="diag-v">'+esc((live.platform||'?')+(live.native?' · native':' · web'))+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">camera</span><span class="diag-v">'+esc(live.cameraPermission||'?')+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">biometric</span><span class="diag-v">'+esc(live.biometric&&live.biometric.available?('yes '+(live.biometric.type||'')):'no')+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">auth</span><span class="diag-v">'+esc(live.auth&&live.auth.signedIn?('signed in '+(live.auth.userId||'')):'signed out')+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">shop</span><span class="diag-v">'+esc(live.shop&&live.shop.configured?'configured':'unconfigured')+'</span></div>'+
            '<div class="diag-row"><span class="diag-k">plugins</span><span class="diag-v">'+esc(Object.keys(pl).map(function(k){return k+(pl[k]?' ✓':' ✕');}).join('   '))+'</span></div>'+
            '<div class="diag-sec">last results</div>'+ markRows +
            '<div class="diag-sec">recent events</div>'+ evRows +
          '</div>'+
          '<div class="diag-actions"><button type="button" class="diag-copy">copy for support</button></div>'+
        '</div>';
      function close(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); }, 200); }
      ov.querySelector('.diag-close').addEventListener('click', close);
      ov.addEventListener('click', function(e){ if(e.target===ov) close(); });
      ov.querySelector('.diag-copy').addEventListener('click', async function(){
        var txt = buildText(snap, live), ok = false, b = this;
        try { await navigator.clipboard.writeText(txt); ok = true; } catch(e){}
        if(!ok){ try { var ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok=true; } catch(e){} }
        if (window.hugSetText) window.hugSetText(b, ok ? 'copied ✓' : 'copy failed'); else b.textContent = ok ? 'copied ✓' : 'copy failed';
        setTimeout(function(){ b.textContent = 'copy for support'; }, 1600);
      });
      document.body.appendChild(ov);
      requestAnimationFrame(function(){ ov.classList.add('show'); });
    }

    window.__hugDiagnostics = { open: open };
  })();

  // ----- Help & support: categorised recovery flows + email with diagnostics -----
  // A Settings entry that opens a list of the things that actually go wrong, each
  // with self-serve guidance and an "email support" action that pre-fills a mail
  // to hey@thehuggable.co including a compact, PII-free diagnostics summary (from
  // HugDiag) so support can help without a back-and-forth.
  (function supportFeature(){
    var SUPPORT_EMAIL = 'hey@thehuggable.co';
    var ISSUES = [
      { q: "I scanned but nothing happened", a: "Hold the phone steady in good light so the whole QR is in frame — the app retries automatically on a weak signal. If it still won't read, your camera permission may be off (Settings on your phone › hug › Camera)." },
      { q: "My cup says it's already claimed", a: "If it's your cup, it's already linked to your account — you're all set. If you bought it second-hand or it's showing under someone else, email us and we'll transfer it." },
      { q: "I changed phone", a: "Sign in with your email + password (or Face ID once re-enabled) on the new phone — your cups, referral code and cashback all follow your account, nothing is stored only on the device." },
      { q: "I can't access my email", a: "Your account is tied to your email, so reach out and we'll help you recover access or move you to a new address." },
      { q: "Face ID stopped working", a: "Re-enable it from the account screen, or just sign in with your password — Face ID is only a shortcut, never the only way in." },
      { q: "My cashback is missing", a: "New cashback is 'pending' until the referred order matures, then becomes 'available'. Check the cashback screen first; if a confirmed referral never showed up, email us." },
      { q: "My friend used my link but I wasn't credited", a: "Credit lands once their order completes and clears the return window. If it's been a while, email us their order number and we'll check." },
      { q: "Checkout wouldn't open", a: "This is usually a store-side setup, not your phone — try again shortly. If it keeps happening, email us and the diagnostics will tell us exactly where it stopped." },
      { q: "My gift card didn't save", a: "Re-open the card in your bag and tap done again — the upload retries on a blip. If it still won't save, email us." },
      { q: "I want to return or unlink a cup", a: "Unlink a cup yourself from your cups list. For a return or refund, email us and we'll sort it." }
    ];

    function esc(s){ return String(s==null?'':s).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }); }

    async function compactDiag(){
      var s = (window.HugDiag && window.HugDiag.snapshot) ? window.HugDiag.snapshot() : { build:{}, marks:{} };
      var live = {}; try { if (window.HugDiag && window.HugDiag.live) live = await window.HugDiag.live(); } catch(e){}
      var m = s.marks || {}, L = [];
      L.push('app ' + (s.build.version||'?') + ' (' + (s.build.buildId||'?') + ') ' + (s.build.env||''));
      L.push('device ' + (live.platform||'?') + (live.native?' native':''));
      L.push('user ' + (live.auth && live.auth.signedIn ? (live.auth.userId||'signed-in') : 'signed-out'));
      ['qr_resolve','claim','cart_create','checkout_url_host','checkout_cart_ref','checkout_opened_at','checkout_handoff','checkout_result','cashout'].forEach(function(k){
        if (m[k]) L.push(k + '=' + (typeof m[k].v==='object'?JSON.stringify(m[k].v):m[k].v));
      });
      return L.join('\n');
    }
    async function emailSupport(issue){
      var diag = await compactDiag();
      var subj = encodeURIComponent('[hug support] ' + issue);
      var body = encodeURIComponent('Issue: ' + issue + '\n\n[Tell us what happened here]\n\n--- diagnostics (helps us help you, no personal data) ---\n' + diag + '\n');
      var url = 'mailto:' + SUPPORT_EMAIL + '?subject=' + subj + '&body=' + body;
      if (window.HugDiag) window.HugDiag.log('support:email', { issue: issue.slice(0, 40) });
      try { window.location.href = url; } catch(e){}
    }

    function open(){
      var ov = document.createElement('div');
      ov.className = 'help-overlay';
      var items = ISSUES.map(function(it, i){
        return '<div class="help-item" data-i="' + i + '">' +
          '<button type="button" class="help-q">' + esc(it.q) + '<span class="help-chev">›</span></button>' +
          '<div class="help-a"><p>' + esc(it.a) + '</p><button type="button" class="help-email">email support</button></div>' +
        '</div>';
      }).join('');
      ov.innerHTML =
        '<div class="help-card" role="dialog" aria-modal="true" aria-label="Help and support">' +
          '<div class="help-head"><span class="help-title">help &amp; support</span><button type="button" class="help-close" aria-label="Close">✕</button></div>' +
          '<div class="help-scroll">' + items +
            '<button type="button" class="help-email help-email--general">email us about something else</button>' +
          '</div>' +
        '</div>';
      function close(){ ov.classList.remove('show'); setTimeout(function(){ ov.remove(); }, 200); }
      ov.querySelector('.help-close').addEventListener('click', close);
      ov.addEventListener('click', function(e){ if(e.target===ov) close(); });
      ov.querySelectorAll('.help-q').forEach(function(btn){
        btn.addEventListener('click', function(){ this.closest('.help-item').classList.toggle('open'); });
      });
      ov.querySelectorAll('.help-item').forEach(function(item){
        var i = Number(item.getAttribute('data-i'));
        item.querySelector('.help-email').addEventListener('click', function(){ emailSupport(ISSUES[i].q); });
      });
      ov.querySelector('.help-email--general').addEventListener('click', function(){ emailSupport('Something else'); });
      document.body.appendChild(ov);
      requestAnimationFrame(function(){ ov.classList.add('show'); });
    }

    // Settings entry.
    var settings = document.querySelector('.screen[data-screen="settings"] .content.plain-content');
    if (settings) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'simple-row help-row';
      row.innerHTML = '<span class="row-left"><svg class="row-svg" viewBox="0 0 64 64" aria-hidden="true"><use href="#i-email"></use></svg>help &amp; support</span><span>›</span>';
      settings.appendChild(row);
      row.addEventListener('click', open);
    }
    window.__hugSupport = { open: open };
  })();

  // ----- Offline banner: slides in on hug:offline, out on hug:online (HugNet) -----
  (function offlineBanner(){
    var bar = document.createElement('div');
    bar.className = 'net-banner';
    bar.setAttribute('role', 'status');
    bar.textContent = "You're offline — some things may not work";
    document.body.appendChild(bar);
    function set(off){ document.documentElement.classList.toggle('is-offline', !!off); }
    window.addEventListener('hug:offline', function(){ set(true); });
    window.addEventListener('hug:online', function(){ set(false); });
    try { if (window.HugNet && !window.HugNet.isOnline()) set(true); } catch(e){}
  })();

  // ----- Prototype data: linked products + referral code/QR (demo only) -----
  (function demoDataFeature(){
    if(!isDemoMode()) return;
    // Present the prototype as a fully signed-in, ACTIVE account. Display-only:
    // not persisted, and syncAccountFromBackend() no-ops in demo, so nothing
    // overwrites it.
    accountStatus = "active";
    accountEmail = DEMO.email;
    document.documentElement.dataset.accountStatus = "active";
    referralCode = DEMO.referralCode;
    referralAvailableCents = DEMO.availableCents;
    referralPendingCents = DEMO.pendingCents;
    linkedProducts = DEMO.linkedCodes
      .filter(function(c){ return HUG_PRODUCT_CATALOG[c]; })
      .map(function(c){
        return {
          productCode: c,
          productName: HUG_PRODUCT_CATALOG[c].productName,
          colourName: HUG_PRODUCT_CATALOG[c].colourName,
          linkedAt: ""
        };
      });
    var nameEl = document.querySelector('.screen[data-screen="profile"] .profile-name');
    if(nameEl) nameEl.textContent = DEMO.name;
    var form = document.querySelector('.screen[data-screen="profile"] .addr-form');
    if(form){
      Object.keys(DEMO.address).forEach(function(k){
        var el = form.querySelector('[name="' + k + '"]');
        if(el) el.value = DEMO.address[k];
      });
    }
    prefillCheckoutAddress();
    renderLinkedProducts();
    renderHugAccountState();
  })();

  // ----- Home "TOKENS" = your combined tokens (6/linked hug + 1/referral),
  // read from the leaderboard's is_me row (0 until you have any). -----
  (function pointsFeature(){
    var el = document.querySelector('.points-block .points');
    if(!el) return;
    // The hero is final once it states a figure. A blank ('') means "not known yet", so it
    // does not count — unless nothing more can come (no backend, or the read failed).
    function set(v){ el.textContent = String(v); if(v !== '' && window.__hugBoot) window.__hugBoot.release('boot-points'); }
    function settled(){ if(window.__hugBoot) window.__hugBoot.release('boot-points'); }
    function load(){
      if(isDemoMode()){ set(DEMO.points); return; }
      // Same honesty rule as the balance pill: while boot has not established whose
      // account this is, state nothing rather than a 0 that may have to be taken back.
      if(bootAccountStateUnknown){ set(''); return; }
      // Render only — NO clearCachedPoints() here. This runs on every account-state
      // render, including while boot has not yet confirmed who this is, and wiping the
      // durable cache from a paint path destroyed the very figure the restore was about
      // to read back. Sign-out is what clears it (setHugAccountState), and sign-out is
      // the only thing that should.
      // The hero is the account's whole token count, and nothing else (owner, 2026-10-10).
      if(document.documentElement.dataset.accountStatus !== 'active'){ set(0); return; }
      // Signed in: lead with the last figure we actually saw. Painting the cache first
      // means the hero is right on frame one and the RPC below only ever confirms it.
      var cached = loadCachedPoints();
      if(cached != null) set(cached);
      else set('');   // signed in, never yet read — blank beats a fabricated 0
      if(!window.HugBackend) return;   // bridge not loaded yet: a later load() will fetch
      if(!window.HugBackend.enabled) return settled();
      fetchLeaderboardOnce().then(function(res){
        if(document.documentElement.dataset.accountStatus !== 'active') return;   // signed out mid-flight
        var me = (res && res.ok && Array.isArray(res.rows)) ? res.rows.filter(function(r){ return r.is_me; })[0] : null;
        if(!(res && res.ok)) return settled();   // failed read: keep the cached figure, don't zero it
        // referral_leaderboard().tokens; an older backend sends eco points, converted from the
        // hugs and referrals behind them (see boardTokens in the leaderboard).
        var tk = me ? Number(me.tokens) : 0;
        if(me && !(me.tokens != null && isFinite(tk))){
          var m = Number(me.mugs), r = Number(me.referrals);
          tk = (me.mugs != null && me.referrals != null && isFinite(m) && isFinite(r)) ? 6 * m + r : NaN;
        }
        if(!isFinite(tk)) return settled();   // cannot state tokens honestly: keep what is showing
        saveCachedPoints(tk);
        set(tk);
      });
    }
    window.__hugPoints = { load: load };
    load();
  })();

  // (Prototype-mode toggle removed — the app runs on real accounts only.)

  // (19) card designer — live message + font-style picker (plain / handwritten / retro / ransom).
  (function cardEditorFeature(){
    // ---- shared ransom renderer (also drives the checkout thumbnails) ----
    var RF = ["'Anton',sans-serif", "'Abril Fatface',serif", "'Playfair Display',serif", "'Special Elite',cursive", "'Bungee',cursive", "'Oswald',sans-serif", "'Archivo Black',sans-serif", "'Bebas Neue',sans-serif", "Georgia,serif", "'Courier New',monospace"];
    var RP = [['#fff','#0a0a0a'], ['#fff','#0a0a0a'], ['#0a0a0a','#fff'], ['#f3f0e7','#0a0a0a'], ['#ffe14d','#0a0a0a'], ['#eb3d7f','#fff']];
    function rpick(a){ return a[(Math.random()*a.length)|0]; }
    function resc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function rletter(ch){ var p=rpick(RP); return '<span class="ransom-ch" style="font-family:'+rpick(RF)+';background:'+p[0]+';color:'+p[1]+';transform:rotate('+(Math.random()*26-13).toFixed(1)+'deg);font-size:'+(0.85+Math.random()*0.6).toFixed(2)+'em;">'+resc(ch)+'</span>'; }
    function ransom(t){ var o='', word=''; function flush(){ if(word){ o+='<span class="ransom-word">'+word+'</span>'; word=''; } } t=String(t); for (var i=0;i<t.length;i++){ var ch=t[i]; if (ch==='\n'){ flush(); o+='<span style="flex-basis:100%;height:.32em"></span>'; continue; } if (ch===' '){ flush(); continue; } word+=rletter(ch); } flush(); return o; }
    window.__hugCardRender = function(el, stl, text){
      if(!el) return;
      el.className = 'card-msg style-' + stl;
      var t = (text && text.length) ? text : ' ';
      if (stl === 'ransom') el.innerHTML = ransom(t); else el.textContent = t;
    };

    // ---- 16 stickers (same art as the website card designer) ----
    var STK = [
      '<svg viewBox="0 0 100 100"><path d="M50 86 18 54a20 20 0 0 1 28-28l4 4 4-4a20 20 0 0 1 28 28z" fill="#e8476b"/></svg>',
      '<svg viewBox="0 0 100 100"><g fill="#f48fb1"><circle cx="50" cy="26" r="15"/><circle cx="74" cy="50" r="15"/><circle cx="50" cy="74" r="15"/><circle cx="26" cy="50" r="15"/></g><circle cx="50" cy="50" r="13" fill="#ffd54f"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M50 8 61 38 93 38 67 58 77 90 50 70 23 90 33 58 7 38 39 38z" fill="#ffca28"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M50 10c4 24 16 36 40 40-24 4-36 16-40 40-4-24-16-36-40-40 24-4 36-16 40-40z" fill="#ffd54f"/></svg>',
      '<svg viewBox="0 0 100 100"><g stroke="#ffb300" stroke-width="6" stroke-linecap="round"><path d="M50 8v12M50 80v12M8 50h12M80 50h12M22 22l9 9M69 69l9 9M78 22l-9 9M31 69l-9 9"/></g><circle cx="50" cy="50" r="20" fill="#ffca28"/></svg>',
      '<svg viewBox="0 0 100 100" fill="none" stroke-width="9"><path d="M14 78a36 36 0 0 1 72 0" stroke="#e8476b"/><path d="M25 78a25 25 0 0 1 50 0" stroke="#ffca28"/><path d="M36 78a14 14 0 0 1 28 0" stroke="#42a5f5"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M30 70a18 18 0 0 1 0-36 22 22 0 0 1 42 6 16 16 0 0 1-2 30z" fill="#90caf9"/></svg>',
      '<svg viewBox="0 0 100 100"><ellipse cx="50" cy="40" rx="26" ry="32" fill="#7e57c2"/><path d="M50 72v20" stroke="#9e9e9e" stroke-width="3"/><path d="M45 72h10l-5 7z" fill="#7e57c2"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M78 22C40 22 22 48 22 78c30 0 56-18 56-56z" fill="#66bb6a"/><path d="M30 70 70 30" stroke="#2e7d32" stroke-width="4"/></svg>',
      '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ffd54f"/><circle cx="38" cy="42" r="5" fill="#5d4037"/><circle cx="62" cy="42" r="5" fill="#5d4037"/><path d="M34 60a18 18 0 0 0 32 0" stroke="#5d4037" stroke-width="5" fill="none" stroke-linecap="round"/></svg>',
      '<svg viewBox="0 0 100 100" fill="#8d6e63"><ellipse cx="50" cy="65" rx="20" ry="16"/><circle cx="30" cy="46" r="8"/><circle cx="44" cy="35" r="8"/><circle cx="56" cy="35" r="8"/><circle cx="70" cy="46" r="8"/></svg>',
      '<svg viewBox="0 0 100 100" fill="#42a5f5"><path d="M40 26 76 18v40a12 10 0 1 1-8-9V34l-20 4v30a12 10 0 1 1-8-9z"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M56 6 24 56h20l-8 38 36-54H50z" fill="#ffca28"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M18 72 12 34l22 16 16-28 16 28 22-16-6 38z" fill="#ffca28"/><rect x="18" y="72" width="64" height="10" rx="3" fill="#ffb300"/></svg>',
      '<svg viewBox="0 0 100 100"><g fill="#ab47bc"><path d="M50 50C40 24 14 22 18 44c-3 22 26 18 32 6z"/><path d="M50 50C60 24 86 22 82 44c3 22-26 18-32 6z"/><path d="M50 52C42 64 20 70 26 84c10 10 24-12 24-24z"/><path d="M50 52C58 64 80 70 74 84c-10 10-24-12-24-24z"/></g><rect x="48" y="34" width="4" height="36" rx="2" fill="#4a148c"/></svg>',
      '<svg viewBox="0 0 100 100"><path d="M24 38h44v20a18 18 0 0 1-36 0z" fill="#8d6e63"/><path d="M68 42h8a10 10 0 0 1 0 20h-8" fill="none" stroke="#8d6e63" stroke-width="6"/><path d="M36 24c-4 4 4 6 0 10M50 22c-4 4 4 6 0 10" stroke="#bcaaa4" stroke-width="4" fill="none" stroke-linecap="round"/></svg>'
    ];
    var DESIGN_NAMES = ['Linen','Bloom','Sage','Confetti'];
    var FIT_START = { plain:16, hand:22, arcade:10, ransom:16 };   // start small — the width/height sliders + size grow it
    var PHOTO_B = { smin:0.5, smax:1.7, base:52, top:32 };
    var STK_B   = { smin:0.5, smax:2.6, base:22, top:52 };
    var TEXT_B  = { smin:0.55, smax:1.6 };

    var card = document.getElementById('ce-card');
    var msgEl = document.getElementById('ce-msg');
    var stickerBox = document.getElementById('ce-stickers');
    var photoBtn = document.getElementById('ce-photo-btn'), photoInput = document.getElementById('ce-photo-input');
    var ctlPanel = document.getElementById('ce-layerctl'), sizeSlider = document.getElementById('ce-size');
    var rotSlider = document.getElementById('ce-rot'), rotRow = document.getElementById('ce-rotrow'), removeBtn = document.getElementById('ce-remove');
    var designsBox = document.getElementById('ce-designs'), fontsBox = document.getElementById('ce-fonts'), doneBtn = document.getElementById('ce-done');
    if(!card || !msgEl) return;   // (the ransom renderer above is still exported)

    var curKey = null, design = 0, font = 'plain', msgScale = 1, msgW = 84, msgH = 0.86, msgX = 50, msgY = 50, curRaw = '', msgFocused = false, msgEditing = false;
    var widthSlider = document.getElementById('ce-width'), widthRow = document.getElementById('ce-widthrow');
    var heightSlider = document.getElementById('ce-height'), heightRow = document.getElementById('ce-heightrow');
    var layers = [], selLayer = null;   // photo + sticker layers; selLayer may be 'msg'

    // ---- message (types directly on the white card) ----
    function fitMsg(){
      if(!card.clientHeight) return;
      // WIDTH = the user's wrap width (text reflows inside it). HEIGHT = the area
      // the text is allowed to fill — the font shrinks UNIFORMLY to fit, starting
      // from the style's preferred size. So changing either dimension reflows /
      // re-fits the text without ever stretching (distorting) the glyphs.
      msgEl.style.width = msgW + '%';
      var avH = card.clientHeight * msgH;
      var size = FIT_START[font] || 24, min = 9, guard = 60;
      msgEl.style.fontSize = size + 'px';
      while(guard-- > 0 && size > min && msgEl.scrollHeight > avH){ size--; msgEl.style.fontSize = size + 'px'; }
    }
    function applyMsgPos(){ msgEl.style.left = msgX + '%'; msgEl.style.top = msgY + '%'; }
    function setMsgDisplay(){
      var empty = !curRaw.trim();
      msgEl.className = 'ce-msg card-msg style-' + font + (empty ? ' ce-empty' : '') + (selLayer === 'msg' ? ' sel' : '');
      if(empty) msgEl.textContent = '';
      else if(font === 'ransom' && !msgFocused) msgEl.innerHTML = ransom(curRaw);
      else msgEl.textContent = curRaw;
      msgEl.style.setProperty('--ms', msgScale);
      fitMsg();
      applyMsgPos();
    }
    // The message behaves like the photo/sticker layers: tap to SELECT (the chosen
    // font — including ransom — stays on screen, and you can drag it / resize it),
    // tap AGAIN (or tap an empty message) to EDIT the words. Edit is the only mode
    // that drops to plain text + raises the keyboard; on blur it re-renders the font.
    // The element is NOT contenteditable until edit mode, so a tap/drag to reposition
    // never strips the ransom styling.
    function placeMsgCaretEnd(){ try{ var r=document.createRange(); r.selectNodeContents(msgEl); r.collapse(false); var s=window.getSelection(); s.removeAllRanges(); s.addRange(r); }catch(e){} }
    function enterMsgEdit(){
      if(msgEditing) return;
      msgEditing = true; msgFocused = true;
      selectLayer('msg');
      msgEl.setAttribute('contenteditable', 'true');
      if(font === 'ransom') msgEl.textContent = curRaw;   // plain so the words can be typed
      try{ msgEl.focus(); }catch(e){}
      placeMsgCaretEnd();
    }
    function exitMsgEdit(){
      if(!msgEditing) return;
      msgEditing = false; msgFocused = false;
      msgEl.removeAttribute('contenteditable');
      setMsgDisplay();   // re-render the chosen font (ransom etc.)
    }
    msgEl.addEventListener('input', function(){ curRaw = msgEl.innerText.replace(/\n$/, ''); msgEl.classList.toggle('ce-empty', !curRaw.trim()); fitMsg(); });
    msgEl.addEventListener('blur', function(){ if(msgEditing) exitMsgEdit(); });

    // Drag-to-move + tap-to-select/edit (distinguished by a small movement threshold).
    var msx = null, msy, mslx, msly, mrect, msgMoved = false, msgWasSel = false;
    msgEl.addEventListener('pointerdown', function(e){
      if(msgEditing) return;                 // already editing → let the caret/keyboard work
      e.stopPropagation();
      msgWasSel = (selLayer === 'msg');
      selectLayer('msg');
      mrect = card.getBoundingClientRect();
      msx = e.clientX; msy = e.clientY; mslx = msgX; msly = msgY; msgMoved = false;
      try{ msgEl.setPointerCapture(e.pointerId); }catch(er){}
    });
    msgEl.addEventListener('pointermove', function(e){
      if(msx == null || msgEditing) return;
      if(!msgMoved && (Math.abs(e.clientX - msx) + Math.abs(e.clientY - msy)) < 6) return;
      msgMoved = true; msgEl.classList.add('dragging');
      var dx=(e.clientX-msx)/mrect.width*100, dy=(e.clientY-msy)/mrect.height*100;
      msgX = Math.max(8, Math.min(92, mslx + dx));
      msgY = Math.max(8, Math.min(92, msly + dy));
      applyMsgPos();
    });
    function msgPointerEnd(e){
      if(msx == null) return;
      msx = null; msgEl.classList.remove('dragging');
      try{ msgEl.releasePointerCapture(e.pointerId); }catch(er){}
      if(msgMoved) return;                                  // it was a drag, not a tap
      if(!curRaw.trim() || msgWasSel) enterMsgEdit();       // empty → edit now; else 2nd tap edits
    }
    msgEl.addEventListener('pointerup', msgPointerEnd);
    msgEl.addEventListener('pointercancel', function(){ if(msx != null){ msx = null; msgEl.classList.remove('dragging'); } });

    // ---- photo + sticker layers ----
    function applyLayer(l){ l.el.style.left = l.x + '%'; l.el.style.top = l.y + '%'; l.el.style.transform = 'translate(-50%,-50%) rotate(' + l.rot + 'deg) scale(' + l.scale + ')'; l.el.style.setProperty('--ls', l.scale); }
    function deselectAll(){ selLayer = null; layers.forEach(function(x){ x.el.classList.remove('sel'); }); msgEl.classList.remove('sel'); if(ctlPanel) ctlPanel.hidden = true; }
    function selectLayer(l){
      selLayer = l;
      layers.forEach(function(x){ x.el.classList.toggle('sel', x === l); });
      msgEl.classList.toggle('sel', l === 'msg');
      if(!l){ if(ctlPanel) ctlPanel.hidden = true; return; }
      if(ctlPanel) ctlPanel.hidden = false;
      var isText = l === 'msg';
      var b = isText ? TEXT_B : (l.type === 'photo' ? PHOTO_B : STK_B);
      if(sizeSlider){ sizeSlider.min = Math.round(b.smin*100); sizeSlider.max = Math.round(b.smax*100); sizeSlider.value = Math.round((isText ? msgScale : l.scale)*100); }
      // Width + height sliders are text-only (they reshape the message box).
      if(widthRow) widthRow.style.display = isText ? '' : 'none';
      if(heightRow) heightRow.style.display = isText ? '' : 'none';
      if(isText){ if(widthSlider) widthSlider.value = Math.round(msgW); if(heightSlider) heightSlider.value = Math.round(msgH*100); }
      if(rotRow) rotRow.style.display = isText ? 'none' : '';
      if(rotSlider && !isText){ rotSlider.min = -180; rotSlider.max = 180; rotSlider.value = Math.round(l.rot); }
      if(removeBtn) removeBtn.style.display = isText ? 'none' : '';
    }
    function removeLayer(l){ if(!l || l === 'msg') return; l.el.remove(); layers = layers.filter(function(x){ return x !== l; }); if(selLayer === l) deselectAll(); }
    function wireDrag(l){
      var sx = null, sy, slx, sly, rect;
      l.el.addEventListener('pointerdown', function(e){ selectLayer(l); rect = card.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; slx = l.x; sly = l.y; l.el.classList.add('dragging'); try{ l.el.setPointerCapture(e.pointerId); }catch(er){} e.preventDefault(); e.stopPropagation(); });
      l.el.addEventListener('pointermove', function(e){ if(sx == null) return; var dx=(e.clientX-sx)/rect.width*100, dy=(e.clientY-sy)/rect.height*100; l.x=Math.max(3,Math.min(97,slx+dx)); l.y=Math.max(3,Math.min(97,sly+dy)); applyLayer(l); });
      function end(){ sx = null; l.el.classList.remove('dragging'); }
      l.el.addEventListener('pointerup', end); l.el.addEventListener('pointercancel', end);
    }
    function addLayer(type, child, init){
      var b = type === 'photo' ? PHOTO_B : STK_B;
      var el = document.createElement('div'); el.className = 'ce-layer ' + type; el.style.width = b.base + '%'; el.appendChild(child);
      var l = { type: type, el: el, x: (init&&init.x!=null?init.x:50), y: (init&&init.y!=null?init.y:b.top), scale: (init&&init.scale!=null?init.scale:1), rot: (init&&init.rot!=null?init.rot:0) };
      var xb = document.createElement('button'); xb.type='button'; xb.className='ce-layer-x'; xb.setAttribute('aria-label','Remove'); xb.textContent='×';
      xb.addEventListener('pointerdown', function(e){ e.stopPropagation(); });
      xb.addEventListener('click', function(e){ e.stopPropagation(); e.preventDefault(); removeLayer(l); });
      el.appendChild(xb); card.appendChild(el);
      layers.push(l); applyLayer(l); wireDrag(l); return l;
    }
    function addPhoto(src, init){
      layers.filter(function(l){ return l.type==='photo'; }).forEach(removeLayer);
      var img = document.createElement('img'); img.alt = '';
      var l = addLayer('photo', img, init); l.src = src;
      if(!init){ img.onload = function(){ var a=(img.naturalWidth&&img.naturalHeight)?(img.naturalWidth/img.naturalHeight):1; var pct=100*Math.sqrt(0.20*a*1.5); pct=Math.max(24,Math.min(82,pct)); l.el.style.width = pct+'%'; }; }
      else if(init.width){ l.el.style.width = init.width; }
      img.src = src;
      selectLayer(l); return l;
    }
    function addSticker(idx, init){
      var span = document.createElement('span'); span.innerHTML = STK[idx] || '';
      var l = addLayer('sticker', span, init); l.idx = idx;
      if(!init) selectLayer(l);
      return l;
    }

    if(stickerBox && !stickerBox.childElementCount){ STK.forEach(function(svg, idx){ var b=document.createElement('button'); b.type='button'; b.className='ce-stk'; b.setAttribute('aria-label','Add sticker'); b.innerHTML=svg; b.addEventListener('click', function(){ addSticker(idx); }); stickerBox.appendChild(b); }); }
    if(photoBtn && photoInput){
      photoBtn.addEventListener('click', function(){ photoInput.click(); });
      photoInput.addEventListener('change', function(){ var f=photoInput.files&&photoInput.files[0]; if(!f) return; var rd=new FileReader(); rd.onload=function(){ addPhoto(rd.result); }; rd.readAsDataURL(f); photoInput.value=''; });
    }
    if(sizeSlider) sizeSlider.addEventListener('input', function(){ var v=Number(sizeSlider.value)/100; if(selLayer==='msg'){ msgScale=v; msgEl.style.setProperty('--ms', msgScale); } else if(selLayer){ selLayer.scale=v; applyLayer(selLayer); } });
    // Text box width (wrap) + height (fit area): re-fit so the text reflows
    // without distortion. Only meaningful while the message is selected.
    if(widthSlider) widthSlider.addEventListener('input', function(){ if(selLayer!=='msg') return; msgW=Number(widthSlider.value); fitMsg(); });
    if(heightSlider) heightSlider.addEventListener('input', function(){ if(selLayer!=='msg') return; msgH=Number(heightSlider.value)/100; fitMsg(); });
    if(rotSlider) rotSlider.addEventListener('input', function(){ if(selLayer && selLayer!=='msg'){ selLayer.rot=Number(rotSlider.value); applyLayer(selLayer); } });
    if(removeBtn) removeBtn.addEventListener('click', function(){ removeLayer(selLayer); });
    if(card) card.addEventListener('pointerdown', function(e){ if(e.target === card) deselectAll(); });
    // Tap anywhere OFF the selected item (and off its size/rotate/remove controls)
    // to deselect it — clears the × + dashed outline so the card previews cleanly.
    var ceScreen = (card && card.closest) ? (card.closest('.screen') || document) : document;
    ceScreen.addEventListener('pointerdown', function(e){
      if(!selLayer) return;
      var t = e.target;
      if(t && t.closest && (t.closest('.ce-layer') || t.closest('#ce-msg') || t.closest('#ce-layerctl'))) return;
      deselectAll();
    });

    // ---- design (outside cover) + font pickers ----
    function setDesign(i){ design = i; if(designsBox) designsBox.querySelectorAll('.gift-card-opt').forEach(function(b){ b.classList.toggle('sel', Number(b.getAttribute('data-design'))===i); }); }
    function setFont(k){ font = k; if(fontsBox) fontsBox.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-style')===k); }); setMsgDisplay(); }
    if(designsBox) designsBox.addEventListener('click', function(e){ var b=e.target.closest('[data-design]'); if(b) setDesign(Number(b.getAttribute('data-design'))||0); });
    if(fontsBox) fontsBox.addEventListener('click', function(e){ var b=e.target.closest('[data-style]'); if(b) setFont(b.getAttribute('data-style')||'plain'); });

    // ---- open the editor for a unit, save back to the gift state ----
    function giftState(){ return (typeof window.__hugGiftState === 'function') ? (window.__hugGiftState() || {}) : {}; }
    function open(key){
      curKey = key;
      var s = giftState()[key] || {};
      design = (s.design != null) ? s.design : ((s.cardStyle != null) ? s.cardStyle : 0);
      font = s.font || 'plain'; curRaw = s.message || ''; msgScale = s.msgScale || 1;
      msgW = (s.msgW != null ? s.msgW : 84); msgH = (s.msgH != null ? s.msgH : 0.86);
      msgX = (s.msgX != null ? s.msgX : 50); msgY = (s.msgY != null ? s.msgY : 50);
      msgFocused = false; msgEditing = false; msgEl.removeAttribute('contenteditable');
      layers.slice().forEach(function(l){ l.el.remove(); }); layers = [];
      if(s.photo && s.photo.src) addPhoto(s.photo.src, s.photo);
      (s.stickers || []).forEach(function(st){ addSticker(st.idx, st); });
      deselectAll();
      setDesign(design); setFont(font); setMsgDisplay();
      if(window.__hugNav) window.__hugNav('card');
      // Re-fit across the screen slide-in (the card grows to full size ~580ms).
      requestAnimationFrame(function(){ setMsgDisplay(); });
      setTimeout(function(){ fitMsg(); }, 380);
      setTimeout(function(){ fitMsg(); }, 700);
    }
    window.__hugOpenCardEditor = open;

    function serialize(s){
      s.card = true; s.design = design; s.cardStyle = design; s.font = font;
      s.message = curRaw.trim(); s.msgScale = msgScale; s.msgW = msgW; s.msgH = msgH; s.msgX = msgX; s.msgY = msgY;
      var ph = layers.filter(function(l){ return l.type==='photo'; })[0];
      s.photo = ph ? { src: ph.src, x: ph.x, y: ph.y, scale: ph.scale, rot: ph.rot, width: ph.el.style.width } : null;
      s.stickers = layers.filter(function(l){ return l.type==='sticker'; }).map(function(l){ return { idx: l.idx, x: l.x, y: l.y, scale: l.scale, rot: l.rot }; });
    }
    function hasMedia(){ return layers.some(function(l){ return l.type==='photo' || l.type==='sticker'; }); }
    function mediaSummary(){ var ph=0, st=0; layers.forEach(function(l){ if(l.type==='photo')ph++; else if(l.type==='sticker')st++; }); var bits=[]; if(ph)bits.push('photo'); if(st)bits.push(st+' sticker'+(st>1?'s':'')); if(curRaw.trim())bits.push('message'); return bits.join(' + '); }

    // ---- compose the finished card to a PNG and upload (best-effort) ----
    var H2C = null;
    function loadH2C(){ if(H2C) return Promise.resolve(H2C); return new Promise(function(res){ var s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'; s.onload=function(){ H2C=window.html2canvas||null; res(H2C); }; s.onerror=function(){ res(null); }; document.head.appendChild(s); }); }
    async function captureCard(){
      var h = await loadH2C(); if(!h) return null;
      try { if(document.fonts && document.fonts.ready) await document.fonts.ready; } catch(e){}
      deselectAll();
      var canvas; try { canvas = await h(card, { scale: 4, backgroundColor: '#ffffff', useCORS: true, logging: false }); } catch(e){ return null; }
      var dataUrl; try { dataUrl = canvas.toDataURL('image/png'); } catch(e){ return null; }
      if(!dataUrl) return null;
      try {
        var doFetch = function(){ return fetch('https://mfaysolymoacymfwcmik.supabase.co/functions/v1/card-art-upload', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ image: dataUrl }) }); };
        // Retry a transient blip — the upload is best-effort but losing the art
        // to a momentary drop is avoidable.
        var r = (window.HugNet && window.HugNet.retryTransient) ? await window.HugNet.retryTransient(doFetch, { tries: 3, label: 'card-upload' }) : await doFetch();
        var j = await r.json().catch(function(){ return null; });
        if(!r.ok || !j || !j.ok){ console.warn('hug: card-art upload', (j&&j.error)||r.status); if(window.HugDiag) window.HugDiag.log('card_upload:fail', { status: r.status }); return null; }
        return { url: j.url, path: j.path };
      } catch(e){ console.warn('hug: card-art upload', e); if(window.HugDiag) window.HugDiag.err('card-upload', e); return null; }
    }

    async function done(){
      if(!curKey){ if(window.__hugNav) window.__hugNav('checkout'); return; }
      if(msgEditing) exitMsgEdit();   // re-render the chosen font before composing the image
      var gw = giftState(); var s = gw[curKey] || (gw[curKey] = {});
      serialize(s);
      var label = doneBtn ? doneBtn.textContent : '';
      if(hasMedia() || curRaw.trim()){
        if(doneBtn){ doneBtn.disabled = true; doneBtn.textContent = 'saving card…'; }
        try { var cap = await captureCard(); if(cap){ s.art = { url: cap.url, path: cap.path, summary: mediaSummary() }; } } catch(e){}
        if(doneBtn){ doneBtn.disabled = false; doneBtn.textContent = label || 'done'; }
      } else { s.card = false; s.art = null; }
      if(window.__hugCardSaved) window.__hugCardSaved(curKey);
      if(window.__hugNav) window.__hugNav('checkout');
      if(window.__hugGiftReopen) window.__hugGiftReopen();
    }
    if(doneBtn) doneBtn.addEventListener('click', done);
    window.addEventListener('resize', function(){ if(document.querySelector('.screen[data-screen="card"].active')) setMsgDisplay(); });

    setMsgDisplay();
  })();

  // (18) gift-wrap + gift-card fees (hoisted so updateCart can read them); maintained by giftWrapFeature
  function giftWrapFee(){ return (window.__giftWrapFee || 0); }
  function giftCardFee(){ return (window.__giftCardFee || 0); }

  (function giftWrapFeature(){
    // Gift card + gift wrap are now TWO independent cart rows, each opening the
    // shared panel in its own mode and showing its own running total.
    var wrapToggle = document.getElementById('gift-wrap-toggle');
    var cardToggle = document.getElementById('gift-card-toggle');
    var wrapRow    = document.getElementById('giftwrap-row');
    var cardRow    = document.getElementById('giftcard-row');
    var wrapFeeEl  = document.getElementById('giftwrap-fee');
    var cardFeeEl  = document.getElementById('giftcard-fee');
    var panel  = document.getElementById('giftwrap-panel');
    if(!panel || (!wrapToggle && !cardToggle)) return;
    var unitsWrap = document.getElementById('gift-units');
    var doneBtn   = document.getElementById('gift-done');
    var backBtn   = document.getElementById('giftwrap-back');
    var titleEl   = document.getElementById('giftwrap-title');
    var introEl   = document.getElementById('gift-intro');
    var mode = 'wrap';   // 'wrap' | 'card' — which option this panel is editing
    var PAPER_COUNT = 5;
    var gw = {};                 // per-SKU: gw[i] = { wrap, paper, card, message }
    window.__giftWrapFee = 0;
    window.__giftCardFee = 0;

    function st(i){ if(!gw[i]) gw[i] = { wrap:false, paper:0, card:false, cardStyle:0, font:'plain', message:'' }; return gw[i]; }
    function cardsHtml(i){ var s=st(i), html=''; var NM=['Linen','Bloom','Sage','Confetti']; for(var c=0;c<4;c++){ html += '<button type="button" class="gift-card-opt gift-card-opt-'+c+(s.cardStyle===c?' sel':'')+'" data-cardstyle="'+c+'" aria-label="'+NM[c]+'"></button>'; } return html; }
    // Font / "Card style" picker — Plain · Handwritten · Retro · Ransom (web parity).
    var FONT_KEYS = ['plain','hand','arcade','ransom'];
    var FONT_LABELS = ['Plain','Handwritten','Retro','Ransom'];
    function fontsHtml(i){ var s=st(i), html=''; for(var f=0;f<4;f++){ html += '<button type="button" class="gift-font-opt'+((s.font||'plain')===FONT_KEYS[f]?' sel':'')+'" data-cardfont="'+FONT_KEYS[f]+'">'+FONT_LABELS[f]+'</button>'; } return html; }
    // Render + auto-shrink a unit's live preview (start sizes match the web card).
    var FIT_START = { plain:16, hand:22, arcade:10, ransom:16 };   // match the editor's start sizes (the composed image is the real card)
    // Per-unit card summary: the composed card-art thumbnail (if designed) or a
    // white mini-card with the message, plus a one-line summary + the open state.
    function renderPreview(key){
      if(!unitsWrap) return;
      var sum = unitsWrap.querySelector('[data-cardsum="'+key+'"]');
      var prev = unitsWrap.querySelector('[data-preview="'+key+'"]'); if(!prev) return;
      var s = st(key);
      if(sum) sum.classList.toggle('open', !!s.card);
      if(s.art && s.art.url){
        prev.className = 'gift-card-preview gcp-art';
        // Security (Phase 1C): set the URL as a property, never interpolate it
        // into an innerHTML src="" attribute (avoids attribute-breakout).
        prev.textContent = '';
        var artImg = document.createElement('img');
        artImg.alt = '';
        artImg.src = s.art.url;
        prev.appendChild(artImg);
      } else {
        prev.className = 'gift-card-preview gcp-white';
        prev.innerHTML = '<span class="gcp-msg card-msg style-' + (s.font||'plain') + '"></span>';
        var m = prev.querySelector('.gcp-msg');
        if(window.__hugCardRender) window.__hugCardRender(m, s.font||'plain', s.message||'');
        requestAnimationFrame(function(){
          if(prev.clientHeight < 8) return;
          var size = FIT_START[s.font||'plain'] || 16, guard = 64;
          m.style.fontSize = size + 'px';
          while(guard-- > 0 && size > 9 && m.scrollHeight > prev.clientHeight - 10){ size--; m.style.fontSize = size + 'px'; }
        });
      }
      var txt = unitsWrap.querySelector('[data-cardtext="'+key+'"]');
      if(txt){
        var bits = [], msg = (s.message||'').trim();
        if(msg) bits.push('“' + (msg.length>26 ? msg.slice(0,26)+'…' : msg) + '”');
        if(s.photo) bits.push('photo');
        var nst = (s.stickers||[]).length; if(nst) bits.push(nst + ' sticker' + (nst>1?'s':''));
        txt.textContent = bits.length ? bits.join(' · ') : 'design your card';
      }
    }
    function renderAllPreviews(){ if(!unitsWrap) return; unitsWrap.querySelectorAll('[data-preview]').forEach(function(p){ renderPreview(p.getAttribute('data-preview')); }); }
    function wrappedCount(){ var n=0; for(var i=0;i<bagVariantNames.length;i++){ var q=cartQty[i]; for(var u=1;u<=q;u++){ var k=i+'_'+u; if(gw[k]&&gw[k].wrap) n++; } } return n; }
    // A card counts (and is charged \u00A34) when it actually has content.
    function cardCount(){ var n=0; for(var i=0;i<bagVariantNames.length;i++){ var q=cartQty[i]; for(var u=1;u<=q;u++){ var k=i+'_'+u; var s=gw[k]; if(s && s.card && ((s.message&&s.message.trim()) || s.photo || (s.stickers&&s.stickers.length))) n++; } } return n; }

    var GIFTWRAP_PRICE = 5, GIFTCARD_PRICE = 4;   // whole-pound add-ons
    function recompute(){
      var nw = wrappedCount(), nc = cardCount();
      window.__giftWrapFee = nw * GIFTWRAP_PRICE;
      window.__giftCardFee = nc * GIFTCARD_PRICE;
      // Each row shows its OWN running total (count \u00D7 price), or the base price
      // when none are selected yet \u2014 so the numbers add up logically.
      if(wrapToggle) wrapToggle.checked = nw > 0;
      if(wrapRow) wrapRow.classList.toggle('selected', nw > 0);
      if(wrapFeeEl) wrapFeeEl.textContent = '+\u00A3' + (nw > 0 ? nw*GIFTWRAP_PRICE : GIFTWRAP_PRICE).toFixed(0);
      if(cardToggle) cardToggle.checked = nc > 0;
      if(cardRow) cardRow.classList.toggle('selected', nc > 0);
      if(cardFeeEl) cardFeeEl.textContent = '+\u00A3' + (nc > 0 ? nc*GIFTCARD_PRICE : GIFTCARD_PRICE).toFixed(0);
    }
    function refreshFee(){ recompute(); try{ updateCart(); }catch(e){} }
    window.__giftSync = function(){ if(panel && !panel.classList.contains('open')) build(); recompute(); };
    // Per-unit gift state (gw["<colourIndex>_<unit>"] = {wrap,paper,cardStyle,message})
    // for the Shopify checkout hand-off (buildShopifyLines reads this).
    window.__hugGiftState = function(){ return gw; };

    function papersHtml(i){
      var s = st(i), html='';
      for(var p=0;p<PAPER_COUNT;p++){
        html += '<button type="button" class="gift-paper gift-paper-'+p+(s.paper===p?' sel':'')+'" data-paper="'+p+'" aria-label="Wrapping paper '+(p+1)+'"></button>';
      }
      return html;
    }

    function build(){
      if(!unitsWrap) return;
      var html='';
      for(var i=0;i<bagVariantNames.length;i++){
        var q = cartQty[i]; if(!q) continue;
        for(var u=1;u<=q;u++){
          var key = i+'_'+u;
          var s = st(key);
          var label = 'hug o \u2014 '+bagVariantNames[i].toLowerCase()+(q>1 ? ' '+u : '');
          if(mode === 'card'){
            html += '<div class="gift-unit'+(s.card?' wrapped':'')+'" data-u="'+key+'">'
              + '<label class="gift-unit-head">'
              +   '<span class="gift-check"><input type="checkbox" data-card="'+key+'"'+(s.card?' checked':'')+'><span class="gift-tick"></span></span>'
              +   '<span class="gift-unit-name">'+label+'</span>'
              +   '<span class="gift-price">+£4</span>'
              + '</label>'
              + '<div class="gift-card-summary'+(s.card?' open':'')+'" data-cardsum="'+key+'">'
              +   '<div class="gift-card-preview" data-preview="'+key+'"></div>'
              +   '<div class="gcs-meta"><span class="gcs-text" data-cardtext="'+key+'"></span><button type="button" class="gcs-edit" data-editcard="'+key+'">edit card</button></div>'
              + '</div>'
              + '</div>';
          } else {
            html += '<div class="gift-unit'+(s.wrap?' wrapped':'')+'" data-u="'+key+'">'
              + '<label class="gift-unit-head">'
              +   '<span class="gift-check"><input type="checkbox" data-wrap="'+key+'"'+(s.wrap?' checked':'')+'><span class="gift-tick"></span></span>'
              +   '<span class="gift-unit-name">'+label+'</span>'
              +   '<span class="gift-price">+£5</span>'
              + '</label>'
              + '<div class="gift-unit-body">'
              +   '<p class="gift-section-label">wrapping paper</p>'
              +   '<div class="gift-papers" data-papers="'+key+'">'+papersHtml(key)+'</div>'
              + '</div>'
              + '</div>';
          }
        }
      }
      unitsWrap.innerHTML = html || '<p class="gift-empty">your bag is empty</p>';
    }

    var firstWrapOpen = true;
    function openPanel(m){
      mode = (m === 'card') ? 'card' : 'wrap';
      // Tapping "gift wrap" the first time wraps everything in the bag (clear
      // intent); the card flow never auto-adds — cards must be designed.
      if(mode === 'wrap' && firstWrapOpen && wrappedCount()===0){ for(var i=0;i<bagVariantNames.length;i++){ var q=cartQty[i]; for(var u=1;u<=q;u++){ st(i+'_'+u).wrap=true; } } }
      if(mode === 'wrap') firstWrapOpen = false;
      if(titleEl) titleEl.textContent = mode === 'card' ? 'GIFT CARD' : 'GIFT WRAP';
      if(introEl) introEl.textContent = mode === 'card' ? 'add a card & message to each item — designed your way' : 'wrap items individually — pick a paper for each';
      build();
      recompute();
      panel.classList.add('open'); panel.setAttribute('aria-hidden','false');
      renderAllPreviews();
    }
    function closePanel(){ panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }

    // Open the full-screen card designer for a unit; reopened (in card mode) on its "done".
    function openEditor(key){ st(key).card = true; closePanel(); if(window.__hugOpenCardEditor) window.__hugOpenCardEditor(key); }
    window.__hugGiftReopen = function(){ openPanel('card'); };

    if(unitsWrap){
      unitsWrap.addEventListener('change', function(e){
        var w = e.target.closest('input[data-wrap]');
        if(w){ var wi=w.getAttribute('data-wrap'); st(wi).wrap = w.checked;
          var unit = w.closest('.gift-unit'); if(unit) unit.classList.toggle('wrapped', w.checked);
          refreshFee(); return; }
        var c = e.target.closest('input[data-card]');
        if(c){ var ci=c.getAttribute('data-card');
          if(c.checked){ openEditor(ci); }                       // → full-screen designer
          else { var s=st(ci); s.card=false; s.art=null; renderPreview(ci); }
        }
      });
      unitsWrap.addEventListener('click', function(e){
        var ec = e.target.closest('[data-editcard]');
        if(ec){ openEditor(ec.getAttribute('data-editcard')); return; }
        var b = e.target.closest('[data-paper]'); if(!b) return;
        var group = b.closest('[data-papers]'); if(!group) return;
        st(group.getAttribute('data-papers')).paper = parseInt(b.getAttribute('data-paper'),10) || 0;
        group.querySelectorAll('.gift-paper').forEach(function(el){ el.classList.remove('sel'); });
        b.classList.add('sel');
      });
    }

    function applyAndClose(){ refreshFee(); closePanel(); }
    if(doneBtn) doneBtn.addEventListener('click', applyAndClose);
    if(backBtn) backBtn.addEventListener('click', applyAndClose);

    function bindOpen(el, m){
      if(!el) return;
      el.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); openPanel(m); });
      ['pointerdown','touchstart'].forEach(function(ev){ el.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    }
    bindOpen(wrapToggle, 'wrap'); bindOpen(cardToggle, 'card');
    if(wrapRow) wrapRow.addEventListener('click', function(){ openPanel('wrap'); });
    if(cardRow) cardRow.addEventListener('click', function(){ openPanel('card'); });
  })();

  // (12) tap name / email to edit, with a confirm first
  (function profileEdit(){
    var scope = document.querySelector('.screen[data-screen="profile"]');
    if(!scope) return;
    function editable(el, label){
      if(!el) return;
      el.classList.add('editable-field');
      el.setAttribute('role','button'); el.setAttribute('tabindex','0');
      el.addEventListener('click', function(e){
        e.stopPropagation();
        if(!window.confirm('Edit your ' + label + '?')) return;
        var next = window.prompt('New ' + label + ':', el.textContent.trim());
        if(next != null && next.trim()) el.textContent = next.trim();
      });
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){
        el.addEventListener(ev, function(e){ e.stopPropagation(); });
      });
    }
    // Tap the email (the whole row space) to edit it in a pop-out — the field
    // shows the full address so you can read it AND fill it in. The change is
    // confirmed by email before it takes effect.
    var emailVal = scope.querySelector('.email-value');
    var emailRow = emailVal && emailVal.closest('.simple-row');
    function openEmailEditor(){
      if(accountStatus !== 'active'){ showToast('Sign in to set your email.'); return; }
      var cur = String(accountEmail || emailVal.textContent || '').trim();
      if(cur.toLowerCase() === 'guest') cur = '';
      showPrompt({
        title: 'Your email',
        body: 'Used to sign in and to receive your cashback. We’ll email a confirmation link before it changes.',
        value: cur, type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com',
        confirm: 'Save', cancel: 'Cancel'
      }).then(function(next){
        if(next == null) return;
        var clean = String(next).trim();
        if(!clean || clean === cur) return;
        if(typeof isValidEmail === 'function' ? !isValidEmail(clean) : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)){ showToast('Enter a valid email address.'); return; }
        var backend = window.HugBackend;
        showToast('Checking…');
        // 1) block an email already used by another account
        Promise.resolve(backend && backend.emailAvailable ? backend.emailAvailable(clean) : { ok:true, available:true })
          .then(function(chk){
            if(chk && chk.ok && chk.available === false){ showToast('That email is already in use.'); return; }
            // 2) start the confirmed change — Supabase emails a link; the email
            //    only switches once they confirm (we don't change the display yet).
            return Promise.resolve(backend && backend.updateEmail ? backend.updateEmail(clean) : { ok:false })
              .then(function(res){
                if(res && res.ok){ showToast('Confirm via the link we just emailed to ' + clean + '.'); }
                else if(res && /already|registered|in use|exists/i.test(res.message||'')){ showToast('That email is already in use.'); }
                else { showToast((res && res.message) || 'Couldn’t update email. Try again.'); }
              });
          });
      });
    }
    if(emailVal){
      emailVal.setAttribute('role','button'); emailVal.setAttribute('tabindex','0');
      // Whole-row tap opens the editor (the email value, the label, or the pill).
      if(emailRow){ emailRow.addEventListener('click', function(e){ e.stopPropagation(); openEmailEditor(); }); }
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){ if(emailRow) emailRow.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    }
  })();

  // Username (leaderboard name): shows the chosen name, or a stable arbitrary
  // "hug-NNNNN" default. Tap to edit — tapping a default clears it so you type
  // fresh; on commit it's checked for uniqueness server-side ("taken" rejects it,
  // no two "ruary"s). Reflected in the leaderboard + home eco-points "is_me" row.
  (function profileUsername(){
    var nameEl = document.querySelector('.screen[data-screen="profile"] .profile-name');
    if(!nameEl) return;
    // committed = the saved username; committedDefault = whether that saved value is
    // still the auto-assigned default (so we show a "pick a username" prompt instead).
    var committed = '', committedDefault = false, saving = false, committedJustNow = false, confirming = false;
    var status = '', debTimer = null;
    var PLACEHOLDER = 'pick a username';
    var active = function(){ return document.documentElement.dataset.accountStatus === 'active'; };

    // Wrap the name. The pencil hint + accepted-tick are absolutely positioned
    // inside the wrap so they never knock the name off-centre under the avatar.
    var wrap = document.createElement('span');
    wrap.className = 'profile-name-wrap';
    nameEl.parentNode.insertBefore(wrap, nameEl);
    wrap.appendChild(nameEl);
    // Sleek transient checkmark that draws in briefly when a name is accepted.
    var tick = document.createElement('span');
    tick.className = 'username-tick';
    tick.setAttribute('aria-hidden', 'true');
    tick.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18.16 4 C18.35 3.96 18.46 3.98 18.58 4 C18.69 4.02 18.8 4.06 18.87 4.11 C18.93 4.16 18.98 4.23 18.99 4.3 C19 4.38 19.36 3.93 18.94 4.57 C18.52 5.21 17.21 6.98 16.47 8.14 C15.73 9.3 15.13 10.33 14.49 11.53 C13.86 12.73 13.1 14.37 12.66 15.35 C12.21 16.33 12.07 16.74 11.81 17.42 C11.55 18.1 11.26 19.06 11.11 19.44 C10.96 19.83 11 19.65 10.91 19.73 C10.83 19.81 10.72 19.87 10.6 19.92 C10.49 19.96 10.35 19.99 10.21 20 C10.07 20.01 9.9 20.01 9.76 19.97 C9.62 19.93 9.69 20.2 9.36 19.77 C9.04 19.34 8.3 18.09 7.79 17.4 C7.28 16.7 6.74 16.1 6.31 15.6 C5.88 15.11 5.43 14.66 5.22 14.42 C5.01 14.19 5.09 14.25 5.05 14.18 C5.02 14.1 4.99 14.06 5.01 13.97 C5.03 13.88 5.09 13.74 5.19 13.65 C5.3 13.55 5.47 13.46 5.63 13.42 C5.78 13.37 5.99 13.36 6.14 13.37 C6.29 13.39 6.36 13.4 6.51 13.5 C6.67 13.6 6.8 13.68 7.07 13.97 C7.34 14.25 7.67 14.6 8.12 15.21 C8.57 15.82 9.48 17.2 9.78 17.63 C10.09 18.05 9.91 17.75 9.96 17.76 C10.02 17.77 10.07 17.75 10.12 17.7 C10.17 17.65 10.09 17.91 10.26 17.48 C10.44 17.05 10.85 15.92 11.19 15.11 C11.53 14.29 11.93 13.39 12.3 12.61 C12.67 11.82 13.07 11.03 13.42 10.38 C13.76 9.72 13.95 9.37 14.37 8.66 C14.79 7.96 15.51 6.8 15.94 6.14 C16.37 5.49 16.68 5.05 16.93 4.74 C17.19 4.42 17.26 4.37 17.46 4.25 C17.67 4.13 17.98 4.04 18.16 4 Z"/></svg>';
    wrap.appendChild(tick);
    function flashTick(){
      wrap.classList.remove('tick-show');
      void wrap.offsetWidth;            // restart the animation if it fires twice
      wrap.classList.add('tick-show');
      setTimeout(function(){ wrap.classList.remove('tick-show'); }, 1400);
    }

    // ✓ / ✕ live-availability line shown under the name while editing.
    var badge = document.createElement('span');
    badge.className = 'username-status';
    wrap.insertAdjacentElement('afterend', badge);
    function setStatus(s){
      status = s || '';
      badge.className = 'username-status' + (status ? ' is-' + status : '');
      var msg = status === 'available' ? '✓ available'
        : status === 'taken' ? '✕ taken — pick another'
        : status === 'invalid' ? '✕ use 2–24 characters'
        : status === 'checking' ? 'checking…' : '';
      if (window.hugSetText) window.hugSetText(badge, msg); else badge.textContent = msg;
    }
    // Wobble BOTH the status line and the name box itself — a tactile "nope".
    function flashBad(){
      [badge, nameEl].forEach(function(el){ el.classList.add('shake'); setTimeout(function(){ el.classList.remove('shake'); }, 420); });
    }
    // Optional sensory cue on the chosen-name result (fires only on exit, with the
    // ✓/shake). Uses the native Haptics plugin if present (a real buzz), else a
    // vibrate fallback (Android). No-op where neither exists (e.g. iOS without
    // @capacitor/haptics) — the visible ✓/shake still carry the feedback.
    function cue(kind){
      try{
        var H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
        if(H){
          if(H.notification){ H.notification({ type: kind === 'ok' ? 'SUCCESS' : 'ERROR' }); return; }
          if(H.impact){ H.impact({ style: kind === 'ok' ? 'LIGHT' : 'MEDIUM' }); return; }
        }
      }catch(e){}
      try{ if(navigator.vibrate){ navigator.vibrate(kind === 'ok' ? 12 : [16,40,16]); } }catch(e){}
    }
    function text(){ return (nameEl.textContent || '').replace(/\s+/g, ' ').trim(); }
    function placeCaretEnd(el){
      try { var r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch(e){}
    }

    function show(username, def){
      committed = username || '';
      committedDefault = !!def;
      // The sharer's real username (not the arbitrary default) rides the share
      // link so checkout can read "<username>'s referral".
      window.__hugRefName = (committedDefault || !committed) ? '' : committed;
      nameEl.textContent = committedDefault ? PLACEHOLDER : (username || '');
      nameEl.classList.toggle('is-default-name', committedDefault);
      wrap.classList.toggle('can-edit', active());   // show the pencil only when editable
      setStatus('');
    }
    function load(){
      var b = window.HugBackend;
      if(!active()){ show('guest', false); return; }
      if(!(b && b.getMyUsername)) return;
      b.getMyUsername().then(function(r){ if(r && r.ok) show(r.username, r.isDefault); }).catch(function(){});
    }
    window.__hugUsername = { load: load };

    nameEl.setAttribute('contenteditable', 'true');
    nameEl.setAttribute('role', 'textbox');
    nameEl.setAttribute('tabindex', '0');
    nameEl.setAttribute('enterkeyhint', 'done');
    nameEl.setAttribute('autocapitalize', 'none');
    nameEl.setAttribute('spellcheck', 'false');
    nameEl.classList.add('editable-name');
    ['pointerdown','touchstart','pointermove'].forEach(function(ev){ nameEl.addEventListener(ev, function(e){ e.stopPropagation(); }); });

    // Commit = the "check as you exit" step: try to claim the name. The server
    // accepts it (✓ tick + save + happy cue) or rejects it as taken/invalid
    // (✕ shake + nope cue). This is the ONLY place the tick fires. Returns the
    // status so the caller (blur) can decide what to do next.
    function commit(v){
      saving = true; setStatus('checking');
      return Promise.resolve(window.HugBackend && window.HugBackend.setUsername ? window.HugBackend.setUsername(v) : { ok:false })
        .then(function(res){
          saving = false;
          var st = (res && res.status) ? res.status : (res && res.ok ? 'ok' : 'error');
          if(res && res.ok){
            committedJustNow = true;
            show(v, false);
            wrap.classList.remove('editing');
            flashTick(); cue('ok');      // brief "accepted" checkmark + happy cue
            showToast('Username updated.');
            if(window.__hugLeaderboard) window.__hugLeaderboard.load();
            try{ nameEl.blur(); }catch(e){}
            setTimeout(function(){ setStatus(''); committedJustNow = false; }, 1300);
          } else if(st === 'taken'){ setStatus('taken'); flashBad(); cue('bad'); }
          else { setStatus('invalid'); flashBad(); cue('bad'); }
          return st;
        })
        .catch(function(){ saving = false; setStatus(''); return 'error'; });
    }

    nameEl.addEventListener('focus', function(){
      if(!active()){ nameEl.blur(); return; }
      wrap.classList.add('editing');     // hide the pencil hint while typing
      // First tap on the "pick a username" prompt clears it so they type fresh.
      // (On a re-focus from "keep editing" the field holds typed text — don't wipe it.)
      if(committedDefault && text() === PLACEHOLDER){ nameEl.textContent = ''; nameEl.classList.remove('is-default-name'); }
      setStatus('');
    });
    nameEl.addEventListener('input', function(){
      // No live availability check: the ✓/shake only fire when you try to LEAVE
      // the field (Enter or tap away) — i.e. when you've actually chosen a name.
      // Typing or backspacing keeps the field quiet (no premature tick).
      if(debTimer){ clearTimeout(debTimer); debTimer = null; }
      if(status){ setStatus(''); }
    });
    // Enter / Done = an explicit "I've chosen this name" → check on exit.
    // commit() shows the ✓ (saved) or the ✕ shake (taken). On a reject the field
    // keeps focus (preventDefault) so they can fix it without leaving.
    nameEl.addEventListener('keydown', function(e){
      if(e.key !== 'Enter') return;
      e.preventDefault();
      var v = text();
      if(v === committed){ committedJustNow = true; try{ nameEl.blur(); }catch(_){} setTimeout(function(){ committedJustNow = false; }, 60); return; }
      if(v.length < 2){ setStatus('invalid'); flashBad(); cue('bad'); return; }
      commit(v);
    });
    // Blur = tapping away = also an exit → run the same check-on-exit:
    //   • unchanged / empty / too short → just leave (restore current name)
    //   • otherwise commit(): ✓ saves it; on ✕ taken the shake fires, then we
    //     offer keep-editing vs leave (they've tapped away from an unsaved name).
    nameEl.addEventListener('blur', function(){
      wrap.classList.remove('editing');   // pencil hint returns once idle
      if(debTimer){ clearTimeout(debTimer); debTimer = null; }
      if(saving || committedJustNow || confirming) return;
      var v = text();
      if(v === committed || v === ''){ show(committed, committedDefault); return; }
      if(v.length < 2){ flashBad(); cue('bad'); show(committed, committedDefault); return; }
      confirming = true;                  // guard re-entrant blur during the async check
      commit(v).then(function(st){
        confirming = false;
        if(st === 'ok') return;           // saved — tick already shown
        confirming = true;
        showConfirm({
          title: st === 'taken' ? 'Username taken' : 'Leave without saving?',
          body: st === 'taken'
            ? '“' + v + '” is already taken. Keep your current username instead?'
            : 'That username isn’t saved yet. Keep your current username instead?',
          cancel: 'Keep editing',
          confirm: 'Leave'
        }).then(function(leave){
          confirming = false;
          if(leave){ show(committed, committedDefault); }
          else { nameEl.textContent = v; nameEl.focus(); placeCaretEnd(nameEl); }
        });
      });
    });

    load();
  })();


  // (14) purchase history: the signed-in user's REAL purchases (HugBackend.listPurchases,
  // RLS-scoped). Empty when signed out / fresh, so no legacy demo data leaks through.
  (function purchasesFeature(){
    var scope = document.querySelector('.screen[data-screen="purchases"]');
    if(!scope) return;
    var list = scope.querySelector('.purchase-list');
    if(!list) return;
    var TINT = { 'dark roast':'pr-dark', 'cherry pop':'pr-cherry', 'blue crush':'pr-blue', 'lemon drop':'pr-lemon' };
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).toLowerCase(); }catch(e){ return ''; } }
    function rowHtml(p){
      var items = Array.isArray(p.items) ? p.items : [];
      var first = items[0] || {};
      var variant = String(first.variant||'').toLowerCase();
      var title = (first.title||'hug o') + (variant ? ' — ' + variant : '') + (items.length>1 ? ' +'+(items.length-1)+' more' : '');
      var price = '£' + (((p.total_cents)||0)/100).toFixed(2);
      var date = p.ordered_at ? fmtDate(p.ordered_at) : '';
      return '<div class="purchase-item">'
        + '<button class="simple-row purchase-row '+(TINT[variant]||'')+'" type="button"><span class="row-left">'+esc(title)+'</span><span class="purchase-plus">+</span></button>'
        + '<div class="purchase-detail">'
        +   '<div class="purchase-kv"><span>paid</span><span>'+esc(date)+(date?' · ':'')+price+'</span></div>'
        +   (p.order_number ? '<div class="purchase-kv"><span>order</span><span>'+esc(p.order_number)+'</span></div>' : '')
        +   (p.mug_qty ? '<div class="purchase-kv"><span>mugs</span><span>'+esc(String(p.mug_qty))+'</span></div>' : '')
        + '</div>'
        + '</div>';
    }
    function render(items){
      list.innerHTML = (items && items.length) ? items.map(rowHtml).join('') : '<p class="purchases-empty">No purchases yet.</p>';
    }
    function clear(){ render([]); }
    function refresh(){
      // Prototype: sample orders, never the real account's (that would be a real read under a
      // sample identity, and the two would be shown side by side as if they belonged together).
      if(isDemoMode()){ render(DEMO.purchases()); return; }
      var b = window.HugBackend;
      if(!(b && b.enabled && b.listPurchases) || document.documentElement.dataset.accountStatus !== 'active'){ clear(); return; }
      b.listPurchases().then(function(res){ render(res && res.ok ? (res.purchases||[]) : []); }).catch(function(){ clear(); });
    }
    // Expand a row on tap (delegation, so re-rendered rows keep working).
    list.addEventListener('click', function(e){
      var row = e.target.closest('.purchase-row'); if(!row) return;
      e.stopPropagation();
      var item = row.closest('.purchase-item'); if(item) item.classList.toggle('open');
    });
    window.__hugPurchases = { refresh: refresh, clear: clear };
    if(document.documentElement.dataset.accountStatus === 'active') refresh(); else clear();
  })();

/* address edit (profile info-box) — inline editing within the box, no popup.
   The fields are real readonly <input>s (not contenteditable) so iOS Contact
   AutoFill can offer the user's name/address while editing. */
(function () {
  const btn = document.querySelector(".info-edit");
  if (!btn) return;
  const box = btn.closest(".info-box");
  if (!box) return;
  // Enter is handled below; never let the wrapper form navigate/submit.
  box.querySelector(".addr-form")?.addEventListener("submit", e => e.preventDefault());
  function caretEnd(el){ try{ const n = el.value.length; el.setSelectionRange(n, n); }catch(e){} }
  btn.addEventListener("click", () => {
    const editing = box.classList.toggle("editing");
    btn.classList.toggle("editing-on", editing);
    const vals = box.querySelectorAll(".addr-v");
    if (editing) {
      btn.textContent = "done";
      vals.forEach(v => { v.readOnly = false; });
      if (vals[0]) { vals[0].focus(); caretEnd(vals[0]); }
    } else {
      btn.textContent = "edit";
      vals.forEach(v => { v.readOnly = true; v.value = (v.value || "").trim(); });
      saveAddressToProfile();   // persist to shared profiles.shipping_address
    }
  });

  // Write the address form to the SHARED profiles.shipping_address (jsonb) so the
  // app + website show the same delivery address. Single app street line -> line1.
  function saveAddressToProfile() {
    if (document.documentElement.dataset.accountStatus !== "active") return;   // signed-in only
    const backend = window.HugBackend;
    if (!backend || !backend.enabled || !backend.saveShippingAddress) return;
    function fv(n) { const el = box.querySelector('.addr-form [name="' + n + '"]'); return el && el.value ? el.value.trim() : ""; }
    const addr = {
      name: fv("name"), line1: fv("street-address"), line2: "",
      city: fv("city"), postcode: fv("postal-code"), country: "United Kingdom"
    };
    if (!addr.name && !addr.line1 && !addr.city && !addr.postcode) return;   // nothing to save
    // The form flips back to "edit", which reads as saved — so a write that did NOT
    // land has to say so. saveShippingAddress now reports a zero-row update as a
    // failure (it used to return ok:true having written nothing); this is where the
    // user finds out, rather than at delivery.
    Promise.resolve(backend.saveShippingAddress(addr)).then(function(res){
      if(!res || !res.ok) showToast('Couldn’t save your address. Try again.');
    }).catch(function(){ showToast('Couldn’t save your address. Try again.'); });
    if (typeof prefillCheckoutAddress === "function") prefillCheckoutAddress();
  }
  box.addEventListener("keydown", e => {
    const t = e.target;
    if (e.key === "Enter" && t.classList && t.classList.contains("addr-v")) {
      e.preventDefault();
      const vals = [].slice.call(box.querySelectorAll(".addr-v"));
      const i = vals.indexOf(t);
      if (i > -1 && i < vals.length - 1) { vals[i+1].focus(); caretEnd(vals[i+1]); }
      else btn.click();
    }
  });
})();

/* Profile address keyboard lift (iOS, Keyboard.resize="none"). The keyboard
   overlays the webview, so the address box can sit under it. Give the profile
   scroll area room equal to the native keyboard height and lift the focused
   line clear; re-run on focus so moving between lines stays visible. Scoped to
   the address .info-box; scroll math divided by --fit. */
(function profileAddressKeyboardLift(){
  function fitScale(){ return window.__hugFit || 1; }
  function profile(){ return document.querySelector('.screen[data-screen="profile"]'); }
  function scroller(){ var p = profile(); return p ? p.querySelector('.content') : null; }
  var kbH = 0;
  function lift(){
    var sc = scroller();
    var el = document.activeElement;
    if (!sc || kbH <= 0 || !el || !el.closest) return;
    if (!el.closest('.info-box')) return;
    var f = fitScale() || 1;
    sc.style.paddingBottom = Math.ceil(kbH / f) + 'px';
    requestAnimationFrame(function(){
      var kbTop = window.innerHeight - kbH;
      var rect = el.getBoundingClientRect();
      var overlap = rect.bottom - kbTop + 18;
      if (overlap > 0) sc.scrollTop += overlap / f;
    });
  }
  function register(){
    var K = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
    if (!K || !K.addListener) return false;
    K.addListener('keyboardWillShow', function(info){
      kbH = (info && info.keyboardHeight) || 0;
      lift();
    });
    K.addListener('keyboardWillHide', function(){
      kbH = 0;
      var sc = scroller();
      if (sc) sc.style.paddingBottom = '';
    });
    var p = profile();
    if (p) p.addEventListener('focusin', function(){
      if (kbH > 0) requestAnimationFrame(lift);
    });
    return true;
  }
  if (!register()) window.addEventListener('load', register);
})();


/* Referral code apply (checkout). Validates + previews the friend's % off in the total;
   the applied state persists until the code is edited. */
(function () {
  const btn = document.querySelector(".discount-apply");
  const field = document.querySelector(".discount-field");
  if (!btn || !field) return;
  function resetBtn(){ btn.classList.remove("applied"); btn.textContent = "apply"; }
  btn.addEventListener("click", () => {
    const status = window.__hugApplyReferral ? window.__hugApplyReferral() : "applied";
    if (status === "empty") { field.focus(); return; }
    field.blur();   // dismiss the keyboard cleanly (no scroll jump)
    if (status === "own") {
      btn.classList.remove("applied");
      btn.textContent = "your own code";
      setTimeout(resetBtn, 1900);
      return;
    }
    btn.classList.add("applied");
    if (window.hugSetText) window.hugSetText(btn, "applied ✓"); else btn.textContent = "applied ✓";
  });
  // Editing the code clears the applied state + the previewed discount.
  field.addEventListener("input", () => {
    if (btn.classList.contains("applied")) resetBtn();
    if (window.__hugResetReferral) window.__hugResetReferral();
  });
})();

/* Hide the iOS keyboard accessory bar (prev/next/Done). Native-only; no-ops in a browser. */
(function hideKeyboardAccessoryBar(){
  function apply(){
    try {
      var K = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
      if (K && K.setAccessoryBarVisible) { K.setAccessoryBarVisible({ isVisible: false }); }
    } catch (e) {}
  }
  if (document.readyState === 'complete') apply();
  else window.addEventListener('load', apply);
})();

/* Gap-on-first-open fix: scroll windows are sized once at init, which can run
   before iOS settles the safe-area/fonts. Fire the app's own scroll handler after
   the layout settles so the windows self-correct from the first frame. */
(function fixScrollWindowSizingOnOpen(){
  function nudge(){
    document.querySelectorAll('.leader-list, .history-list').forEach(function(l){
      try { l.dispatchEvent(new Event('scroll')); } catch (e) {}
    });
  }
  requestAnimationFrame(function(){ requestAnimationFrame(nudge); });
  window.addEventListener('load', function(){ nudge(); setTimeout(nudge, 250); });
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(nudge); }
  setTimeout(nudge, 600);
})();

/* ---------------------------------------------------------------------------
   Keyboard field-lift (iOS). With Keyboard.resize = "none" the keyboard now
   overlays the webview (the bottom nav no longer gets pushed up). On focusing a
   checkout field we give the existing scroll area enough room below and lift the
   focused field just clear of the keyboard, then restore on hide. Scoped to the
   checkout scroll container; everything else (e.g. History search, which sits at
   the top of its panel) is untouched. Scroll math is divided by --fit so it stays
   correct on narrower devices; on iPhone --fit is ~1.
--------------------------------------------------------------------------- */
(function keyboardFieldLift(){
  function fitScale(){ return window.__hugFit || 1; }
  function scroller(){
    return document.querySelector('.screen[data-screen="checkout"] .checkout-content');
  }
  function register(){
    var K = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
    if (!K || !K.addListener) return false;
    try { if (K.setResizeMode) K.setResizeMode({ mode: 'none' }); } catch (e) {}
    K.addListener('keyboardWillShow', function(info){
      var sc = scroller();
      var el = document.activeElement;
      if (!sc || !el || !el.closest || !el.closest('.checkout-content')) return;
      var h = (info && info.keyboardHeight) || 0;
      if (h <= 0) return;
      if (sc._hugKbScroll == null) sc._hugKbScroll = sc.scrollTop;   // remember where we were
      var f = fitScale() || 1;
      sc.style.paddingBottom = Math.ceil(h / f) + 'px';
      requestAnimationFrame(function(){
        var kbTop = window.innerHeight - h;
        var rect = el.getBoundingClientRect();
        var overlap = rect.bottom - kbTop + 14;
        if (overlap > 0) sc.scrollTop += overlap / f;
      });
    });
    K.addListener('keyboardWillHide', function(){
      var sc = scroller();
      if (!sc) return;
      sc.style.paddingBottom = '';
      // Restore the pre-keyboard scroll position instead of jumping to the top.
      if (sc._hugKbScroll != null) { sc.scrollTop = sc._hugKbScroll; sc._hugKbScroll = null; }
    });
    return true;
  }
  if (!register()) window.addEventListener('load', register);
})();

/* Linked Products colour tint: mirror the Purchases per-variant wash on each
   linked card by reading its variant text and applying the matching pr-* class.
   Render-agnostic and additive - it observes the linked list and does not touch
   the linking or localStorage logic. */
(function linkedTint(){
  var MAP = {
    'dark roast': 'pr-dark',
    'cherry pop': 'pr-cherry',
    'blue crush': 'pr-blue',
    'lemon drop': 'pr-lemon'
  };
  var ALL = ['pr-dark','pr-cherry','pr-blue','pr-lemon'];
  function classFor(text){
    var t = (text || '').toLowerCase();
    for (var key in MAP){ if (t.indexOf(key) !== -1) return MAP[key]; }
    return '';
  }
  function tint(row){
    if (!row || row.nodeType !== 1 || !row.classList) return;
    if (!row.classList.contains('linked-row')) return;
    var v = row.querySelector('.linked-variant');
    var cls = classFor(v ? v.textContent : row.textContent);
    ALL.forEach(function(c){ row.classList.remove(c); });
    if (cls) row.classList.add(cls);
  }
  function tintAll(){
    var rows = document.querySelectorAll('.linked-row');
    for (var i = 0; i < rows.length; i++) tint(rows[i]);
  }
  function start(){
    tintAll();
    var list = document.getElementById('linked-list') || document.querySelector('.linked-list');
    if (list && window.MutationObserver){
      new MutationObserver(function(muts){
        for (var i = 0; i < muts.length; i++){
          var added = muts[i].addedNodes;
          for (var j = 0; added && j < added.length; j++){
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.classList && n.classList.contains('linked-row')) tint(n);
            if (n.querySelectorAll){
              var inner = n.querySelectorAll('.linked-row');
              for (var k = 0; k < inner.length; k++) tint(inner[k]);
            }
          }
        }
      }).observe(list, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

/* Scanner leave-cover: while the scan screen is active the camera shows through
   a transparent WebView (scan-camera-active on <html>). On leave the black can
   flash because the camera stops while that transparency is still on. Drop the
   transparency the moment the scan screen starts leaving (loses .active or gets
   the quick-fade-leave class) so the opaque app background covers the camera
   before it tears down. Additive + cosmetic only: it removes an existing CSS
   class earlier - it does not touch the scanner, QR parsing, claiming, linked
   products, or localStorage. */
(function scanLeaveCover(){
  function init(){
    var scanScreen = document.querySelector('.screen[data-screen="scan"]');
    var phoneEl = document.querySelector('.phone');
    var root = document.documentElement;
    if (!scanScreen || !root || !window.MutationObserver) return;
    // The transparent class may only stay on while we're ACTUALLY on the scan
    // screen — judged by the authoritative current screen, NOT the .active class
    // (a stale .active is what was leaving the whole app grey).
    function onScan(){
      // Defer to the main shared check; if it's not ready yet, assume NOT on scan
      // (strip), since the camera class is only ever set after that check passes.
      return !!(window.__hugOnScan && window.__hugOnScan());
    }
    function strip(){
      if (root.classList.contains('scan-camera-active') && !onScan()) {
        root.classList.remove('scan-camera-active');
      }
    }
    new MutationObserver(strip).observe(scanScreen, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(strip).observe(root, { attributes: true, attributeFilter: ['class'] });
    if (phoneEl) new MutationObserver(strip).observe(phoneEl, { attributes: true, attributeFilter: ['data-current'] });
    strip();                 // clear any already-stuck state on load
    setInterval(strip, 1000); // catch-all for a stuck state that fires no mutation
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

(function scanShutter(){
  if (window.__hugScanShutter) return;
  window.__hugScanShutter = true;

  var ENTER_MS = 400;
  var EXIT_MS = 380;

  var phone = document.getElementById("phone");
  var scanScreen = document.querySelector('.screen[data-screen="scan"]');
  if (!phone || !scanScreen) return;

  var shutter = document.createElement("div");
  shutter.className = "scan-shutter";
  shutter.setAttribute("aria-hidden", "true");
  phone.appendChild(shutter);

  var cachedBox = null;
  var hideTimer = null;

  function measure(){
    var vp = scanScreen.querySelector(".camera-viewport")
          || scanScreen.querySelector(".camera-content")
          || scanScreen.querySelector(".content");
    if (!vp) return;
    var r = vp.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var pr = phone.getBoundingClientRect();
    var fit = window.__hugFit || 1;
    cachedBox = {
      top: (r.top - pr.top) / fit,
      left: (r.left - pr.left) / fit,
      width: r.width / fit,
      height: r.height / fit
    };
  }

  function applyBox(){
    if (!cachedBox) return;
    shutter.style.top = cachedBox.top + "px";
    shutter.style.left = cachedBox.left + "px";
    shutter.style.width = cachedBox.width + "px";
    shutter.style.height = cachedBox.height + "px";
  }

  function show(){
    if (hideTimer){ clearTimeout(hideTimer); hideTimer = null; }
    applyBox();
    shutter.classList.add("is-on");
  }

  function hideAfter(ms){
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function(){
      shutter.classList.remove("is-on");
      hideTimer = null;
    }, ms);
  }

  var html = document.documentElement;
  var lastCam = html.classList.contains("scan-camera-active");

  new MutationObserver(function(){
    var camNow = html.classList.contains("scan-camera-active");
    if (camNow === lastCam) return;
    if (camNow){
      measure();
      show();
      hideAfter(ENTER_MS);
    } else if (!html.classList.contains("scan-cam-veil") && onScanStill()) {
      // Only while the scan page stays (a scan ends there: the box hides the camera's last frame).
      // Not after a swipe: the swipe's veil already covers the camera in white, and this grey box
      // (it stays where the camera window was, over whatever screen comes in) faded in and out
      // over the QR code just after a swipe landed (owner, 2026-10-16). Not on any other leave
      // either (2026-10-17): it sat over the page coming in for 0.4 s and then went, on/off; the
      // camera now stops only after the switch, under the white stop-cover (stopProductQrScan).
      show();
      hideAfter(EXIT_MS);
    }
    lastCam = camNow;
  }).observe(html, { attributes:true, attributeFilter:["class"] });

  function onScanStill(){
    return scanScreen.classList.contains("active") && (phone.dataset.current || "home") === "scan" &&
      !/leave|fade-out|exit/.test(scanScreen.className || "");
  }
  // Leaving the scan page used to show the box here too (see above for why it no longer does).
})();

(function keyboardSafeLayer(){
  if (window.__hugKbSafe) return;
  window.__hugKbSafe = true;

  var root = document.documentElement;
  var vv = window.visualViewport || null;

  function update(){
    var h = vv ? vv.height : window.innerHeight;
    root.style.setProperty('--vvh', h + 'px');
    // --kb and .keyboard-open are set from the native Keyboard plugin height,
    // because visualViewport does not shrink with Keyboard resize:"none".
  }

  if (vv){
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
  }
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  update();

  function managed(el){
    if (!el || !el.closest) return false;
    if (el.closest('.checkout-content')) return false;
    if (el.closest('.info-box')) return false;
    if (el.closest('.scan-account-sheet')) return false;
    return !!el.closest('.screen[data-screen="profile"], .kb-safe');
  }
  document.addEventListener('focusin', function(e){
    var el = e.target;
    if (!managed(el)) return;
    if (!el.matches || !el.matches('input, textarea, select, [contenteditable="true"]')) return;
    setTimeout(function(){
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      catch (err) { try { el.scrollIntoView(); } catch (e2) {} }
    }, 200);
  });
})();

/**
 * Inject the gift-card composer's display faces after boot. Idempotent and best-effort: the
 * composer degrades to its fallback stack (see the RF list) if this never lands, which is the
 * honest behaviour for a decorative font on a phone that is offline.
 */
var __hugCardFontsRequested = false;
function loadCardComposerFonts() {
  if (__hugCardFontsRequested) return;
  __hugCardFontsRequested = true;
  var run = function () {
    try {
      if (document.querySelector('link[data-hug-card-fonts]')) return;
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-hug-card-fonts", "1");
      // Same families and the same display=swap as the markup used to carry — only the timing
      // changed. Kept as one request so it stays a single cache entry.
      link.href = "https://fonts.googleapis.com/css2?family=Abril+Fatface&family=Anton&family=Archivo+Black&family=Bebas+Neue&family=Bungee&family=Oswald:wght@600;700&family=Playfair+Display:wght@700;900&family=Press+Start+2P&family=Special+Elite&display=swap";
      document.head.appendChild(link);
    } catch (error) {}
  };
  // requestIdleCallback is absent in WKWebView before iOS 17.4, and this app supports older —
  // so the timeout fallback is the live path on many devices, not a formality.
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}

/**
 * The factory-smoke SMIL animation only runs when it is actually on screen.
 *
 * index.html carries three <animate attributeName="d" repeatCount="indefinite"> elements on the
 * home screen's factory impact icon. SMIL morphs the path geometry every frame, and each frame
 * invalidates the SVG resource, which forces a style recalc and a layout. Measured over four
 * seconds of IDLE with nothing touched, at 4x CPU throttle (roughly a mid-range phone):
 *
 *                        smoke running    smoke paused
 *     layouts                      240              54
 *     style recalcs                240              55
 *     main thread busy             44%              9%
 *
 * So ~80% of everything this app did while sitting still was three wisps of decorative smoke.
 * It is not a JS loop — requestAnimationFrame never fires for it — which is why profiling
 * scripts and bundle sizes never found it.
 *
 * A `.screen` that is not `.active` is visibility:hidden but still laid out, and SMIL keeps
 * running in it: the animation carried on at full cost on every OTHER screen in the app, where
 * the factory is not even drawn. It also carried on with the tab/webview hidden.
 *
 * This does not change the animation where it IS visible — that is a design decision, not a
 * bug, and it belongs to whoever drew it. It only stops paying for it where nobody can see it:
 *
 *   · home screen not active   -> paused
 *   · document hidden          -> paused
 *   · prefers-reduced-motion   -> paused outright, which the SMIL ignored (CSS
 *                                 animation-play-state does not apply to SMIL)
 *
 * pauseAnimations()/unpauseAnimations() act on the SVG's own timeline, so the smoke resumes
 * from where it stopped rather than snapping back to the start.
 */
function installImpactIconMotionGate() {
  const svgs = Array.from(document.querySelectorAll(".impact-icon svg"))
    .filter((svg) => svg.querySelector("animate, animateTransform, animateMotion"));
  if (!svgs.length) return;
  const homeScreen = document.querySelector('.screen[data-screen="home"]');
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  // THE SMOKE IS STEPPED, NOT LEFT TO RUN FREE.
  //
  // SMIL renders at the display's refresh rate — 60fps here, 120 on a ProMotion device — and
  // every frame rewrites the path geometry, forcing a style recalc and a layout. Nothing about
  // slow drifting smoke needs sixty updates a second. pauseAnimations() freezes the timeline and
  // setCurrentTime() still renders whatever instant you ask for, so the animation can be advanced
  // by hand at a sane cadence: same artwork, same motion, same loop, fewer samples of it.
  //
  // Measured over 4s idle on home at 4x CPU throttle, with the frames verified to be genuinely
  // changing by screenshotting the icon (a getAttribute('d') check does NOT work — SMIL animates
  // the presentation value, not the DOM attribute, so it reads static even while running):
  //
  //     native 60fps   240 layouts   35% main thread
  //     20fps          115 layouts   19%
  //     15fps           99 layouts   14%     <- chosen
  //     12fps           90 layouts   13%
  //
  // 15 was picked over 12 because the saving flattens out below it while the risk of visible
  // stepping does not. This IS a change to how the animation looks, in principle — it is a lower
  // temporal resolution of the same motion. It is one constant to change or delete if the smoke
  // is judged to have lost anything.
  //
  // Owner, 2026-10-10: "move them all up to 60fps". Every icon now steps at 60 — the table
  // above is the price (about the native row) and why it used to be 15. The other savings
  // stay: only the panel in view moves, and nothing moves off the home screen or hidden.
  // Food gets a deadline-based 60 fps clock that also handles 90/144 Hz displays.
  // Keep the other icons on their existing shared clock.
  const foodSvg = svgs.find((svg) => svg.closest('[data-cause="food"]'));
  const steppedSvgs = svgs.filter((svg) => svg !== foodSvg);
  const SMOKE_FPS = 60;
  let foodFrame = null, foodPaint = null, foodDue = null;
  const stopFood = () => {
    if (foodFrame !== null) cancelAnimationFrame(foodFrame);
    foodFrame = null; foodPaint = null; foodDue = null;
  };
  // While the row spins, or this icon is fading out under the impact detail, it holds still:
  // nobody can see steam at spin speed, and redrawing a moving or fading layer every frame is
  // what starved the page thread (owner, 2026-10-10: "harsh and jittery"). It resumes in place.
  const iconHeld = (svg) => {
    const r = window.__hugImpactRow;
    return !!((r && r.spinning) || svg.closest('.home-content.detail-motion .impact-item:not(.is-picked)'));
  };
  const tickFood = (now) => {
    if (foodPaint !== null && iconHeld(foodSvg)) { foodPaint = now; foodDue = now + 1000 / 60; foodFrame = requestAnimationFrame(tickFood); return; }
    if (foodPaint === null) { foodPaint = now; foodDue = now + 1000 / 60; }
    if (now >= foodDue - 0.5) {
      try { foodSvg.setCurrentTime(foodSvg.getCurrentTime() + (now - foodPaint) / 1000); } catch (error) {}
      foodPaint = now;
      foodDue += Math.max(1, Math.floor((now - foodDue) / (1000 / 60)) + 1) * (1000 / 60);
    }
    foodFrame = requestAnimationFrame(tickFood);
  };
  const updateFood = (wanted) => {
    const visible = foodSvg && !foodSvg.closest('.impact-panel[aria-hidden="true"], .impact-item[hidden]');
    if (!wanted || !visible) { stopFood(); return; }
    if (foodFrame === null) foodFrame = requestAnimationFrame(tickFood);
  };
  let stepFrame = null, lastStep = null;

  let running = null;
  const stop = () => {
    if (stepFrame !== null) { cancelAnimationFrame(stepFrame); stepFrame = null; }
    lastStep = null;
    for (const svg of svgs) { try { svg.pauseAnimations(); } catch (error) {} }
  };
  // Stepped on the display's own frame clock, not a timer: a 60 Hz timer drifts against the
  // screen and now and then lands two steps in one frame (a visible hitch). Each step moves the
  // timeline by the real time since the last one, at most SMOKE_FPS steps a second, so a 120 Hz
  // screen still gets 60 and a dropped frame does not slow the motion down.
  const step = (now) => {
    stepFrame = requestAnimationFrame(step);
    if (lastStep === null) { lastStep = now; return; }
    const dt = now - lastStep;
    if (dt < 1000 / SMOKE_FPS - 1) return;
    lastStep = now;
    for (const svg of steppedSvgs) {
      // Only the panel in view animates; the other one is aria-hidden / visibility:hidden.
      if (svg.closest('.impact-panel[aria-hidden="true"], .impact-item[hidden]')) continue;
      if (iconHeld(svg)) continue;                   // spinning row / fading out: hold still
      try { svg.setCurrentTime(svg.getCurrentTime() + Math.min(dt, 250) / 1000); } catch (error) {}
    }
  };
  const start = () => {
    // Held paused throughout; the frame clock is what advances it. Driving a paused timeline by
    // hand is the whole mechanism — unpausing would hand it back to SMIL's own clock.
    for (const svg of svgs) { try { svg.pauseAnimations(); } catch (error) {} }
    if (stepFrame !== null) return;
    stepFrame = requestAnimationFrame(step);
  };

  // Not under the launch cover: nobody can see the icons move yet, and sixty redraws a second
  // there were main-thread work the launch itself was waiting on (release gate, 2026-10-11: the
  // cover lifted ~0.4 s later than main's). The clock starts when the page is shown.
  const shown = () => !window.__hugBoot || window.__hugBoot.revealed;
  const apply = () => {
    const wanted =
      shown() &&
      !(reduceMotion && reduceMotion.matches) &&
      document.visibilityState === "visible" &&
      (!homeScreen || homeScreen.classList.contains("active"));
    updateFood(wanted);
    if (wanted === running) return;   // idempotent: never touch the timeline needlessly
    running = wanted;
    wanted ? start() : stop();
  };
  // Panel swaps and a disabled food cause must stop food's clock immediately.
  if (foodSvg) {
    const observer = new MutationObserver(apply);
    const panel = foodSvg.closest('.impact-panel'), item = foodSvg.closest('.impact-item');
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['aria-hidden'] });
    if (item) observer.observe(item, { attributes: true, attributeFilter: ['hidden'] });
  }
  apply();
  if (window.__hugBoot && window.__hugBoot.onReveal) window.__hugBoot.onReveal(apply);
  document.addEventListener("visibilitychange", apply);
  if (reduceMotion) {
    if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", apply);
    else if (reduceMotion.addListener) reduceMotion.addListener(apply);
  }
  // Screen changes are class toggles on the screen element, so watch that attribute rather than
  // polling or hooking every navigation call site — one observer, fires only on a real switch.
  if (homeScreen) {
    new MutationObserver(apply).observe(homeScreen, { attributes: true, attributeFilter: ["class"] });
  }
}
