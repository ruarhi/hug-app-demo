/* ===========================================================================
   demo-bridge.js — website-only stand-in for native-bridge.js.

   This lets the REAL app (app.js + index.html + styles.css, copied verbatim
   from src/) run interactively inside the marketing site's phone mockup, with
   no Supabase, no auth and no native camera. It defines the same two globals
   the app talks to — window.HugNative and window.HugBackend — but every call
   returns canned demo data for a fictional, already-activated account.

   Loaded BEFORE app.js so that (a) localStorage is seeded before the app reads
   it on boot (app.js loadHugAccountStatus/loadReferralCode), and (b)
   window.HugBackend exists when app.js runs its initial syncAccountFromBackend.
   To refresh the demo, re-copy src/* into website/app/ and keep this file.
   =========================================================================== */
(function () {
  "use strict";

  /* The fictional demo account. Change these to change every page at once. */
  var DEMO = {
    email: "alex@huggable.co",
    userId: "demo-alex-0001",
    referralCode: "ALEXR-7Q2",
    availableCents: 3600,   // £36.00 spendable referral credit (the top pill)
    pendingCents: 1500,     // £15.00 still maturing
    referralCount: 4,
    // Two units this account has claimed -> Purchases / Linked screens.
    units: [
      { qrToken: "demo-dr-7Q2K9", sku: "HUG-DR-001", name: "hug o", variant: "dark roast", claimedAt: "2026-05-18T09:24:00Z" },
      { qrToken: "demo-bc-4M1X8", sku: "HUG-BC-001", name: "hug o", variant: "blue crush", claimedAt: "2026-06-02T17:41:00Z" }
    ]
  };

  /* ── 1. Seed localStorage synchronously, before app.js boots ──────────────
     Keys mirror the constants in app.js. This makes the very first paint show
     the activated account (no "guest" flash) even before the async calls below
     resolve. */
  try {
    localStorage.setItem("hug-account-state-v1", "active");
    localStorage.setItem("hug-account-email-v1", DEMO.email);
    localStorage.setItem("hug-referral-code-v1", DEMO.referralCode);
    localStorage.setItem("hug-linked-products-v1", JSON.stringify(
      DEMO.units.map(function (u) { return { productCode: u.sku, linkedAt: u.claimedAt }; })
    ));
  } catch (e) { /* storage unavailable: app falls back to guest, still usable */ }

  var ok = function (extra) { return Object.assign({ ok: true }, extra || {}); };

  /* ── 2. HugNative — native shims (camera, checkout, etc.) ─────────────────
     In a browser there is no camera; returning "unavailable" makes the scan
     screen show its graceful fallback instead of hanging. */
  window.HugNative = Object.freeze({
    startQrScan: function () { return Promise.resolve({ ok: false, status: "unavailable" }); },
    stopQrScan: function () { return Promise.resolve({ ok: true, status: "cancelled" }); },
    getAuthSession: function () { return Promise.resolve(ok({ status: "demo" })); },
    startShopifyCheckout: function () { return Promise.resolve(ok({ status: "demo" })); },
    requestBackend: function () { return Promise.resolve(ok({ status: "demo" })); },
    recordReferralEvent: function () { return Promise.resolve(ok({ status: "demo" })); }
  });

  /* ── 3. HugBackend — same contract as native-bridge.js, dummy answers ───── */
  window.HugBackend = Object.freeze({
    enabled: true,

    getSession: function () {
      return Promise.resolve(ok({ session: { email: DEMO.email, userId: DEMO.userId } }));
    },

    signInWithOtp: function () {
      return Promise.resolve(ok({ status: "code-sent" }));
    },

    verifyOtp: function () {
      return Promise.resolve(ok({ status: "verified", email: DEMO.email, userId: DEMO.userId }));
    },

    signOut: function () {
      return Promise.resolve(ok({ status: "signed-out" }));
    },

    getMyProfile: function () {
      return Promise.resolve(ok({ referralCode: DEMO.referralCode, email: DEMO.email }));
    },

    getReferralBalance: function () {
      return Promise.resolve(ok({
        pendingCents: DEMO.pendingCents,
        availableCents: DEMO.availableCents,
        count: DEMO.referralCount
      }));
    },

    resolveQr: function () {
      // A scanned demo code resolves to an unclaimed hug o.
      return Promise.resolve(ok({
        status: "unclaimed", sku: "HUG-CP-001", name: "hug o",
        variant: "cherry pop", priceCents: 3000
      }));
    },

    claimUnit: function () { return Promise.resolve(ok({ status: "claimed" })); },
    unlinkUnit: function () { return Promise.resolve(ok({ status: "unlinked" })); },

    listMyUnits: function () {
      return Promise.resolve(ok({ units: DEMO.units.slice() }));
    }
  });
})();
