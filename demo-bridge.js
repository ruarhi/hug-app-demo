/* ===========================================================================
   demo-bridge.js — website-only stand-in for native-bridge.js.

   Lets the REAL app (app.js + index.html + styles.css, copied verbatim from
   the Capacitor app's src/) run interactively in a browser — no Supabase, no
   auth, no native camera. It defines the SAME globals native-bridge.js exposes
   — window.HugBackend / HugNative / HugQr / HugShop / HugNet / HugDiag /
   HugLinks — but every call returns canned data for a fictional, already-active
   account, so all the account screens are populated for the marketing demo.

   Loaded BEFORE app.js so (a) localStorage is seeded before the app reads it on
   boot, and (b) the globals exist when app.js runs its first backend sync.
   To refresh: re-copy src/{index.html,app.js,styles.css,assets} into this
   folder (keep demo-bridge.js + demo.css), and add any NEW backend method the
   app starts calling to window.HugBackend below.
   =========================================================================== */
(function () {
  "use strict";

  /* The fictional demo account — change these to change every screen at once. */
  var DEMO = {
    email: "alex@huggable.co",
    userId: "demo-alex-0001",
    displayName: "Alex Rivera",
    username: "alexr",
    referralCode: "ALEXR-7Q2",
    availableCents: 3600,   // £36.00 spendable (deposited) referral credit
    pendingCents: 1500,     // £15.00 still maturing
    cashedOutCents: 8400,   // £84.00 already cashed out
    referralCount: 14,
    shippingAddress: {
      name: "Alex Rivera", line1: "14 Maple Street", line2: "",
      city: "Bristol", postcode: "BS1 4ND", country: "United Kingdom"
    },
    // Units this account has claimed -> Purchases / Linked screens.
    units: [
      { qrToken: "demo-dr-7Q2K9", productCode: "HUG-DR-001", sku: "HUG-DR-001", name: "hug o", variant: "dark roast", claimedAt: "2026-05-18T09:24:00Z" },
      { qrToken: "demo-bc-4M1X8", productCode: "HUG-BC-001", sku: "HUG-BC-001", name: "hug o", variant: "blue crush", claimedAt: "2026-06-02T17:41:00Z" }
    ],
    purchases: [
      { order_number: "#1042", total_cents: 3000, currency: "GBP", mug_qty: 1, items: "1× hug o — dark roast", receipt_url: "#", ordered_at: "2026-05-18T09:24:00Z" },
      { order_number: "#1188", total_cents: 3000, currency: "GBP", mug_qty: 1, items: "1× hug o — blue crush", receipt_url: "#", ordered_at: "2026-06-02T17:41:00Z" }
    ],
    // Cashback history (bucket: pending | deposited | cashed_out).
    history: [
      { id: "h1", name: "robin", reward_cents: 300, bucket: "pending",    order_number: "#3007", order_summary: "1× hug o — lemon drop", created_at: "2026-06-28T10:12:00Z" },
      { id: "h2", name: "sam",   reward_cents: 300, bucket: "pending",    order_number: "#3006", order_summary: "1× hug o — cherry pop", created_at: "2026-06-24T16:41:00Z" },
      { id: "h3", name: "nia",   reward_cents: 600, bucket: "deposited",  order_number: "#3001", order_summary: "2× hug o — dark roast", created_at: "2026-06-11T09:05:00Z" },
      { id: "h4", name: "mia",   reward_cents: 300, bucket: "deposited",  order_number: "#2994", order_summary: "1× hug o — blue crush", created_at: "2026-06-04T14:20:00Z" },
      { id: "h5", name: "leo",   reward_cents: 300, bucket: "cashed_out", order_number: "#2977", order_summary: "1× hug o — dark roast", created_at: "2026-05-20T11:30:00Z" },
      { id: "h6", name: "amara", reward_cents: 600, bucket: "cashed_out", order_number: "#2961", order_summary: "2× hug o — lemon drop", created_at: "2026-05-09T08:52:00Z" }
    ],
    // Leaderboard (ranked by eco_points; is_me flags this account).
    leaderboard: [
      { rank: 1, label: "beckett",   eco_points: 210, mugs: 6, referrals: 12, is_me: false },
      { rank: 2, label: "priya",     eco_points: 185, mugs: 5, referrals: 11, is_me: false },
      { rank: 3, label: "Alex Rivera", eco_points: 120, mugs: 2, referrals: 14, is_me: true },
      { rank: 4, label: "hug-40213", eco_points: 95,  mugs: 3, referrals: 3,  is_me: false },
      { rank: 5, label: "sol",       eco_points: 70,  mugs: 2, referrals: 4,  is_me: false },
      { rank: 6, label: "hug-77120", eco_points: 45,  mugs: 1, referrals: 4,  is_me: false }
    ]
  };

  var ok = function (extra) { return Object.assign({ ok: true }, extra || {}); };
  var soon = function (v) { return Promise.resolve(v); };

  /* ── Seed localStorage synchronously, before app.js boots ──────────────────
     Mirrors the constants in app.js so the very first paint shows the active
     account (no "guest" flash) even before the async calls resolve. */
  try {
    localStorage.setItem("hug-account-state-v1", "active");
    localStorage.setItem("hug-account-email-v1", DEMO.email);
    localStorage.setItem("hug-referral-code-v1", DEMO.referralCode);
    localStorage.setItem("hug-linked-products-v1", JSON.stringify(
      DEMO.units.map(function (u) { return { productCode: u.productCode, linkedAt: u.claimedAt }; })
    ));
  } catch (e) { /* storage unavailable: app falls back to guest, still usable */ }

  /* ── A faux QR renderer — returns an SVG string that LOOKS like a scannable
     rounded QR (finder patterns + deterministic pseudo-random modules seeded by
     the text). Matches the app's charcoal rounded-dot style. Not scannable — it
     is decorative for the demo. Signature mirrors HugQr.render(text, opts). */
  function fauxQr(text, opts) {
    opts = opts || {};
    var N = 29, dot = "#3a3a3a", pad = 2, r = 0.46;
    var seedStr = String(text || "hug"); var seed = 0;
    for (var i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var size = N + pad * 2;
    var parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size + '" shape-rendering="geometricPrecision">');
    if (!opts.transparent) parts.push('<rect width="' + size + '" height="' + size + '" fill="#ffffff"/>');
    // three finder patterns (7x7) at the QR corners
    function finder(ox, oy) {
      parts.push('<rect x="' + (ox + pad) + '" y="' + (oy + pad) + '" width="7" height="7" rx="2.2" fill="none" stroke="' + dot + '" stroke-width="1"/>');
      parts.push('<rect x="' + (ox + pad + 2) + '" y="' + (oy + pad + 2) + '" width="3" height="3" rx="1" fill="' + dot + '"/>');
    }
    function inFinder(x, y) {
      return (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
    }
    finder(0, 0); finder(N - 7, 0); finder(0, N - 7);
    // data modules
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      if (inFinder(x, y)) continue;
      if (rnd() > 0.52) parts.push('<circle cx="' + (x + pad + 0.5) + '" cy="' + (y + pad + 0.5) + '" r="' + r + '" fill="' + dot + '"/>');
    }
    parts.push('</svg>');
    return parts.join("");
  }

  /* ── HugNative — native shims (no camera / native runtime in a browser) ──── */
  window.HugNative = {
    startQrScan: function () { return soon({ ok: false, status: "unavailable" }); },
    stopQrScan: function () { return soon({ ok: true, status: "cancelled" }); },
    getAuthSession: function () { return soon(ok({ status: "demo" })); },
    startShopifyCheckout: function () { return soon(ok({ status: "demo" })); },
    requestBackend: function () { return soon(ok({ status: "demo" })); },
    recordReferralEvent: function () { return soon(ok({ status: "demo" })); }
  };

  /* ── HugDiag — diagnostics no-ops ────────────────────────────────────────── */
  window.HugDiag = {
    log: function () {}, err: function () {}, mark: function () {},
    live: function () { return false; }, snapshot: function () { return {}; }
  };

  /* ── HugNet — connectivity. The demo is always "online" (no real network to
     drop); force true so the offline banner never mis-fires, and clear it once
     after boot in case an environment reported navigator.onLine=false. ──────── */
  window.HugNet = {
    isOnline: function () { return true; },
    retryTransient: function (fn) { return Promise.resolve().then(fn); }
  };
  try { setTimeout(function () { window.dispatchEvent(new Event("hug:online")); }, 0); } catch (e) {}

  /* ── HugLinks — deep-link helper (unused in the demo; safe stub) ──────────── */
  window.HugLinks = { open: function () {}, handle: function () {} };

  /* ── HugQr — rounded QR renderer (faux, decorative) ──────────────────────── */
  window.HugQr = { render: function (text, opts) { return fauxQr(text, opts); } };

  /* ── HugShop — in-app checkout (unconfigured in the demo -> graceful) ─────── */
  window.HugShop = {
    configured: false,
    createCheckout: function () { return soon({ ok: false, status: "shop-unconfigured" }); },
    buy: function () { return soon({ ok: false, status: "shop-unconfigured" }); }
  };

  /* ── HugBackend — same contract as native-bridge.js, dummy answers ───────── */
  window.HugBackend = {
    enabled: true,

    /* auth (faux — the demo stays signed in) */
    getSession: function () { return soon(ok({ session: { email: DEMO.email, userId: DEMO.userId } })); },
    getAuthSession: function () { return soon(ok({ session: { email: DEMO.email, userId: DEMO.userId } })); },
    signInWithOtp: function () { return soon(ok({ status: "code-sent" })); },
    verifyOtp: function () { return soon(ok({ status: "verified", email: DEMO.email, userId: DEMO.userId })); },
    signInWithPassword: function () { return soon(ok({ status: "signed-in", email: DEMO.email, userId: DEMO.userId })); },
    signUp: function () { return soon(ok({ status: "confirm-sent" })); },
    verifySignup: function () { return soon(ok({ status: "verified", email: DEMO.email })); },
    setPassword: function () { return soon(ok({ status: "password-set" })); },
    updateEmail: function () { return soon(ok({ status: "confirm-sent" })); },
    emailAvailable: function () { return soon({ ok: true, taken: false }); },
    approveQrLogin: function () { return soon(ok({ status: "approved" })); },
    signOut: function () { return soon(ok({ status: "signed-out" })); },
    deleteAccount: function () { return soon(ok({ status: "deleted" })); },
    deleteBiometricCredentials: function () { return soon(ok({ status: "cleared" })); },

    /* profile + username */
    getMyProfile: function () {
      return soon(ok({ referralCode: DEMO.referralCode, email: DEMO.email, displayName: DEMO.displayName, shippingAddress: DEMO.shippingAddress }));
    },
    getMyUsername: function () { return soon(ok({ displayName: DEMO.displayName, username: DEMO.username, isDefault: false })); },
    setUsername: function (name) { if (name) DEMO.displayName = String(name); return soon(ok({ status: "ok" })); },
    checkUsername: function () { return soon(ok({ available: true })); },
    saveShippingAddress: function (a) { if (a) DEMO.shippingAddress = a; return soon(ok({ status: "saved" })); },

    /* referral money */
    getReferralBalance: function () {
      return soon(ok({ pendingCents: DEMO.pendingCents, availableCents: DEMO.availableCents, cashedOutCents: DEMO.cashedOutCents, count: DEMO.referralCount }));
    },
    getReferralHistory: function () { return soon(ok({ rows: DEMO.history.slice() })); },
    cashOutNow: function () { return soon(ok({ status: "queued", amountCents: DEMO.availableCents, feeCents: 0 })); },
    setPayoutMethod: function () { return soon(ok({ status: "set" })); },
    listRedemptions: function () { return soon(ok({ rows: [] })); },
    startPayoutSetup: function () { return soon(ok({ status: "demo", url: "#" })); },

    /* impact + leaderboard + purchases */
    getLeaderboard: function () { return soon(ok({ rows: DEMO.leaderboard.slice() })); },
    listPurchases: function () { return soon(ok({ purchases: DEMO.purchases.slice() })); },

    /* units */
    resolveQr: function () { return soon(ok({ status: "unclaimed", sku: "HUG-CP-001", name: "hug o", variant: "cherry pop", priceCents: 3000 })); },
    claimUnit: function () { return soon(ok({ status: "claimed" })); },
    unlinkUnit: function () { return soon(ok({ status: "unlinked" })); },
    listMyUnits: function () { return soon(ok({ units: DEMO.units.slice() })); },
    recordReferralEvent: function () { return soon(ok({ status: "demo" })); },

    /* sharing + clipboard (best-effort in a browser) */
    shareLink: function (opts) {
      var o = opts || {};
      try {
        if (navigator.share) { navigator.share({ title: o.title || "hug", text: o.text || "", url: o.url || "" }); return soon(ok({ status: "shared" })); }
      } catch (e) {}
      return soon({ ok: false, status: "not-native" }); // app falls back to Web Share / copy
    },
    copyImagePng: function () { return soon({ ok: false, status: "not-native" }); }
  };
})();
