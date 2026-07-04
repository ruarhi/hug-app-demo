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
    let referralApplied = false;   // referral code applied -> preview the 10% off in the total
    const REFERRAL_DISCOUNT_RATE = 0.10;
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
        [HUG_ACCOUNT_STATE_KEY, HUG_ACCOUNT_EMAIL_KEY, HUG_REFERRAL_CODE_KEY, HUG_LINKED_PRODUCTS_KEY, "hug-demo-mode"]
          .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
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
      const keys = [HUG_LINKED_PRODUCTS_KEY, HUG_ACCOUNT_STATE_KEY, HUG_ACCOUNT_EMAIL_KEY, HUG_REFERRAL_CODE_KEY];
      keys.forEach(function (key) {
        try { localStorage.removeItem(key); } catch (e) {}
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
    const HUG_PRODUCT_CATALOG = Object.freeze({
      "HUG-DR-001": Object.freeze({ productName: "hugo", colourName: "dark roast" }),
      "HUG-BC-001": Object.freeze({ productName: "hugo", colourName: "blue crush" }),
      "HUG-CP-001": Object.freeze({ productName: "hugo", colourName: "cherry pop" }),
      "HUG-LD-001": Object.freeze({ productName: "hugo", colourName: "lemon drop" }),
      "HUG-TEST-001": Object.freeze({ productName: "hugo", colourName: "dark roast" }),
      "HUG-TEST-002": Object.freeze({ productName: "hugo", colourName: "blue crush" })
    });
    let linkedProducts = [];
    let accountStatus = "guest";
    let accountEmail = null;
    let referralCode = "";
    let referralAvailableCents = 0;
    let referralPendingCents = 0;
    let referralCashedOutCents = 0;
    let referralRewardCount = 0;

    // ---- Prototype/demo mode -------------------------------------------------
    // A Settings toggle flips between a totally FRESH account experience (empty,
    // real) and a fully-populated PROTOTYPE. localStorage overrides the build
    // default (window.__HUG_DEMO__ from hug-flags.js). Demo data is display-only:
    // it never persists account state or calls the backend.
    function isDemoMode() {
      // Prototype/demo mode retired — the app always runs against real accounts.
      return false;
    }
    window.__hugIsDemo = isDemoMode;
    document.documentElement.dataset.demo = isDemoMode() ? "on" : "off";
    const DEMO = {
      mugs: 6,                 // -> 240 bottles / 24 kg / 6 trees
      points: 204,   // == demo referral/order count; home POINTS == leaderboard "you" (DEMO_ROWS reads this)
      availableCents: 4250,    // fallback only — demo balance is derived from the history txns
      pendingCents: 1200,
      cashedOutCents: 90000,
      referralCode: "HUGDEMO",
      name: "ruary",
      email: "ruary@thehuggable.co",
      bankLast4: "4471",
      address: { "name": "Ruary Hewson", "street-address": "14 Maple Street", "city": "Bristol", "postal-code": "BS1 4ND" },
      linkedCodes: ["HUG-DR-001", "HUG-CP-001", "HUG-BC-001"]
    };
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
    // applies the friend's 10% on add-to-cart, and credits this user.
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

    async function refreshReferralCodeFromServer() {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await backend.getMyProfile();
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
      window.__hugReferral = { availableCents: available, pendingCents: pending, cashedOutCents: cashedOut, count: count };
      document.querySelectorAll(".balance").forEach(el => {
        el.textContent = formatGbpCents(available);
      });
      if (window.__hugAccountHistory && window.__hugAccountHistory.applySummary) window.__hugAccountHistory.applySummary();
      if (window.__hugCashout) window.__hugCashout.refresh();
      if (window.__hugImpact) window.__hugImpact.load();   // referral count feeds the +1/referral impact bonus
    }

    async function refreshReferralBalanceFromServer() {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await backend.getReferralBalance();
      if (!res.ok) return;
      referralAvailableCents = res.availableCents;
      referralPendingCents = res.pendingCents;
      referralCashedOutCents = res.cashedOutCents || 0;
      referralRewardCount = res.count || 0;
      renderReferralBalance();
    }

    function loadHugAccountStatus() {
      try {
        return localStorage.getItem(HUG_ACCOUNT_STATE_KEY) === "active" ? "active" : "guest";
      } catch (error) {
        console.warn("Unable to load account state", error);
        return "guest";
      }
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
      el.textContent = message;
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
        requestAnimationFrame(() => ov.classList.add("show"));
      });
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
      try {
        localStorage.setItem(HUG_LINKED_PRODUCTS_KEY, JSON.stringify(linkedProducts));
      } catch (error) {
        console.warn("Unable to save linked products", error);
      }
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
      renderLinkedProducts();
      closeLinkedReferral();
    }

    window.clearHugLinkedProducts = clearHugLinkedProducts;
    linkedProducts = loadLinkedProducts();
    const hadStoredAccountStatus = hasStoredHugAccountStatus();
    accountStatus = loadHugAccountStatus();
    accountEmail = loadHugAccountEmail();
    referralCode = loadReferralCode();
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

    /* Supabase sync: when the backend is enabled, the auth session is the
       authority on guest/active and product_units is the authority on linked
       products. localStorage stays as an offline display cache and as the
       full fallback when the backend is disabled. */
    async function refreshLinkedProductsFromServer() {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await backend.listMyUnits();
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

    async function syncAccountFromBackend() {
      if (isDemoMode()) return;   // demo mode is self-contained display; never sync the backend over it
      const backend = window.HugBackend;
      if (!backend?.enabled) return;
      await hugLoginReset;        // wait out the one-time forced sign-out, or it races and re-signs-in
      const res = await backend.getSession();
      if (!res.ok) return;                      // offline: keep local fallback state
      if (res.session) {
        setHugAccountState("active", res.session.email);
        refreshLinkedProductsFromServer();
        if (window.__hugPurchases) window.__hugPurchases.refresh();
        refreshReferralCodeFromServer();
        refreshReferralBalanceFromServer();
      } else if (accountStatus === "active") {
        // Stale local "active" with no session behind it: claiming would fail
        // as unauthenticated, so drop back to guest until the user verifies.
        setHugAccountState("guest");
      }
    }
    // native-bridge.js loads after app.js, so HugBackend appears by window load.
    if (window.HugBackend) syncAccountFromBackend();
    else window.addEventListener("load", () => syncAccountFromBackend(), { once: true });

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

    async function stopProductQrScan({ state = "cancelled", message = "Scan cancelled" } = {}) {
      const hadLiveCamera = cameraSessionAlive ||
        document.documentElement.classList.contains("scan-camera-active");
      scanRequestId += 1;
      cameraSessionAlive = false;
      closeAccountActivation();
      setScanCameraVisible(false);
      // Only flash the white stop-cover when a camera was actually live;
      // redundant stops (double nav calls, browser) shouldn't blink the UI.
      if (hadLiveCamera) {
        document.documentElement.classList.add("scan-stopping");
        setTimeout(function(){ document.documentElement.classList.remove("scan-stopping"); }, 360);
      }
      try {
        await queueScanOp(function () { return window.HugNative?.stopQrScan?.(); });
      } catch (error) {
        console.error("Unable to stop QR scanner", error);
      }
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

    function showScreen(name, options = {}) {
      if (window.HugDiag) window.HugDiag.log("screen", { name });
      const scanWasActive = scanScreen?.classList.contains("active");
      if (scanWasActive && name !== "scan") {
        stopProductQrScan({ state: null });
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
        stopProductQrScan({ state: null });
      }
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
        const discount = (referralApplied && total > 0) ? mugSubtotal * REFERRAL_DISCOUNT_RATE : 0;
        const grand = mugSubtotal - discount + (total > 0 ? giftWrapFee() + giftCardFee() : 0);
        checkoutTotalValue.textContent = `£${grand.toFixed(2)}`;
        if (checkoutDiscountRow) {
          checkoutDiscountRow.hidden = discount <= 0;
          if (checkoutDiscountValue) checkoutDiscountValue.textContent = `−£${discount.toFixed(2)}`;
        }
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
        stabilizeTargetUiFromBag("account");
        showScreen("account");
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
        stabilizeSettingsAccountSwitch(320);
        showScreen("account");
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
       10% + the referrer reward fire — same as the web flow. Needs HugShop
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
    // "apply" the referral code: validate it, then preview the 10% off in the
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
    function resetReferralApplied() {
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
      const shop = window.HugShop;
      if (!shop || !shop.configured) { showToast("Checkout isn't available yet."); return; }
      if (window.HugDiag) window.HugDiag.log("checkout:open", { lines: lines.length });
      const label = trigger ? trigger.textContent : "";
      if (trigger) { trigger.disabled = true; trigger.textContent = "opening…"; }
      try {
        const res = await shop.buy({ lines, referralCode: getCheckoutReferralCode(), address: getCheckoutAddress() });
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

    function syncResponsiveScrollWindows() {
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

      // Tablets (>=600px wide) have a much taller column than a phone, so let the
      // leaderboard grow to fill it instead of capping at the phone height (340).
      // Phones are <=440px wide and keep the original 340 cap untouched.
      const leaderMaxHeight = window.innerWidth >= 600 ? 900 : 340;
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
    homeBalance.textContent = "\u00A3" + cumulative().toFixed(2);
    homeBalance.classList.add("balance-intro-pulse");
    const sync = setInterval(function () {
      homeBalance.textContent = "\u00A3" + cumulative().toFixed(2);
    }, 120);
    setTimeout(function () {
      clearInterval(sync);
      homeBalance.classList.remove("balance-intro-pulse");
      const FROM = cumulative(), TO = deposited();          // count cumulative -> spendable
      let start = null;
      function tick(ts) {
        if (start === null) start = ts;
        const t = Math.min(1, (ts - start) / COUNT_MS);
        const eased = 1 - Math.pow(1 - t, 3);
        homeBalance.textContent = "\u00A3" + (FROM + (TO - FROM) * eased).toFixed(2);
        if (t < 1) requestAnimationFrame(tick);
        else homeBalance.textContent = "\u00A3" + TO.toFixed(2);
      }
      requestAnimationFrame(tick);
    }, PULSE_END_MS);
  })();

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
    var MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
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
    function pushTxn(name, date, amt, st){
      var k = txns.length;
      // cashback is 10% of the order; each hug o is £30 -> £3 cashback per mug.
      var nItems = Math.max(1, Math.round(amt / 3)), items = [], sub = 0;
      for(var ii=0; ii<nItems; ii++){
        var it = CATALOG[(k+ii) % 4];          // CATALOG[0..3] are the £30 mug variants
        items.push({name:it.n, qty:1, price:it.p}); sub += it.p;
      }
      var hh = 8 + ((k*7) % 12), mm = (k*13) % 60;
      txns.push({ id:'HUG-'+(tid - k*7), name:name, date:date, amt:amt, st:st,
        time:(hh<10?'0'+hh:hh)+':'+(mm<10?'0'+mm:mm), items:items, subtotal:sub,
        pay:PAY[k % PAY.length], channel:CHAN[k % CHAN.length] });
    }
    var YEAR = 2026;
    // Prototype-only sample referral history. Fresh mode = empty history.
    if (isDemoMode()) {
    // 4 newest orders from new referred friends -> brings the order total to 204.
    [['rowan',5,8,6,'pending'],['sienna',5,7,3,'pending'],['felix',5,6,6,'pending'],['amara',5,5,3,'pending']]
      .forEach(function(s){ pushTxn(s[0], new Date(YEAR, s[1], s[2]), s[3], s[4]); });
    // 20 most-recent transactions populate the small (glance) window; first few pending.
    [[5,4,6,'pending'],[5,1,3,'pending'],[4,28,9,'pending'],[4,22,3,'pending'],[4,14,3,'pending'],
     [4,4,3,'approved'],[3,27,6,'approved'],[3,20,3,'approved'],[3,13,6,'approved'],[3,6,3,'approved'],
     [2,27,6,'approved'],[2,20,9,'approved'],[2,12,3,'approved'],[2,5,6,'approved'],[1,28,3,'approved'],
     [1,20,9,'approved'],[1,12,6,'approved'],[1,5,3,'approved'],[0,28,6,'approved'],[0,20,3,'approved']
    ].forEach(function(s, idx){ pushTxn(NAMES[idx % NAMES.length], new Date(YEAR, s[0], s[1]), s[2], s[3]); });
    // ~180 older transactions stepping back through prior years -> ~200 total when expanded.
    var cur = new Date(YEAR, 0, 20), amts = [3,6,9,3,6,3,9,6,3,6,9,3];
    for(var i=0; i<180; i++){
      cur = new Date(cur.getTime() - (5 + (i%5)) * 86400000);
      pushTxn(NAMES[(i+7) % NAMES.length], new Date(cur), amts[i % amts.length], 'cashed_out');
    }
    }
    var CURRENT_YEAR = txns[0] ? txns[0].date.getFullYear() : YEAR;
    function fmtDate(dt){
      var s = MON[dt.getMonth()] + ' ' + dt.getDate();
      if(dt.getFullYear() !== CURRENT_YEAR) s += ' ' + dt.getFullYear();
      return s;
    }
    function matches(t, q){
      if(!q) return true; q = q.toLowerCase();
      return t.name.toLowerCase().indexOf(q) >= 0 || t.id.toLowerCase().indexOf(q) >= 0
        || fmtDate(t.date).toLowerCase().indexOf(q) >= 0
        || t.items.some(function(it){ return it.name.toLowerCase().indexOf(q) >= 0; });
    }
    var GLANCE_LIMIT = 20;
    function render(q, full){
      var html = '', shown = 0;
      for(var k=0; k<txns.length; k++){
        var t = txns[k]; if(t.cancelled) continue; if(!matches(t, q)) continue;
        if(!full && shown >= GLANCE_LIMIT) break;
        shown++;
        html += '<div class="history-row '+t.st+'" data-txn="'+k+'">'
              + '<span>'+t.name+'</span><span class="date">'+fmtDate(t.date)+'</span>'
              + '<span>+'+GBP(t.amt)+'</span></div>';
      }
      list.innerHTML = html;
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

    var open = false;
    function setExpand(next){
      open = next;
      if(open){
        var cR = content.getBoundingClientRect(), wR = wrap.getBoundingClientRect();
        var nav = screen.querySelector('.bottom-nav');
        var navTop = nav ? nav.getBoundingClientRect().top : cR.bottom;
        var topInset = 6;
        // getBoundingClientRect is post-transform (scaled by --fit on a narrow
        // screen / the website mockup), but --hist-* apply in the design space
        // the .phone scales. Convert the measured distances back to design px,
        // else the shift + window come out short and leave gaps top and bottom.
        var fit = window.__hugFit || 1;
        var shift = Math.max(0, (wR.top - cR.top) / fit - topInset);
        var full = Math.max(180, (navTop - cR.top) / fit - topInset - 8);
        content.style.setProperty('--hist-shift', shift + 'px');
        wrap.style.setProperty('--history-window-height', full + 'px');
        content.classList.add('history-open');
        plus.setAttribute('aria-label','Hide all transactions');
      } else {
        content.classList.remove('history-open');
        content.style.removeProperty('--hist-shift');
        wrap.style.removeProperty('--history-window-height');
        if(search.value){ search.value = ''; render('', true); }
        plus.setAttribute('aria-label','Show all transactions');
        try{ list.dispatchEvent(new Event('scroll')); }catch(e){}
      }
    }
    plus.addEventListener('click', function(e){ e.stopPropagation(); setExpand(!open); });

    var ov = document.createElement('div'); ov.className = 'txn-detail'; screen.appendChild(ov);
    function openDetail(k){
      var t = txns[k]; if(!t) return;
      var rows = t.items.map(function(it){
        return '<div class="txn-line"><span>'+it.qty+'\u00d7 '+it.name+'</span><span>'+GBP(it.price*it.qty)+'</span></div>';
      }).join('');
      var dstr = MON[t.date.getMonth()]+' '+t.date.getDate()+' '+t.date.getFullYear()+' \u00b7 '+t.time;
      ov.innerHTML =
        '<button class="txn-back" type="button" aria-label="Back">\u2039 back</button>'
        + '<div class="txn-head"><span class="txn-name">'+t.name+'</span>'
        + '<span class="txn-amt gradient-accent">+'+GBP(t.amt)+'</span></div>'
        + '<div class="txn-meta">'+dstr+'</div>'
        + '<div class="txn-status txn-'+t.st+'">'+(t.st==='pending'?'cashback pending':(t.st==='cashed_out'?'cashed out':'cashback deposited'))+'</div>'
        + '<div class="txn-sec">order</div><div class="txn-lines">'+rows+'</div>'
        + '<div class="txn-line txn-total"><span>order total</span><span>'+GBP(t.subtotal)+'</span></div>'
        + '<div class="txn-line"><span>cashback (10%)</span><span class="gradient-accent">+'+GBP(t.amt)+'</span></div>'
        + '<div class="txn-sec">details</div>'
        + '<div class="txn-kv"><span>transaction</span><span>'+t.id+'</span></div>'
        + '<div class="txn-kv"><span>channel</span><span>'+t.channel+'</span></div>'
        + '<div class="txn-kv"><span>payment</span><span>'+t.pay+'</span></div>'
        + '<div class="txn-kv"><span>referred by</span><span>'+t.name+'</span></div>';
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
    var QR_SCANS = cellQr ? (parseInt(cellQr.textContent,10)||0) : 0; // standalone: scans aren't in the referral txns
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
      var referrals, pending, deposited, cashedOut;
      if(isDemoMode()){
        var c = computeTotals();
        referrals = c.orders;                 // every referral ended in an order -> referrals = orders
        pending = c.pending; deposited = c.deposited; cashedOut = c.cashedOut;
      } else {
        var ref = window.__hugReferral || {};
        referrals = ref.count || 0;
        pending = ref.pendingCents || 0; deposited = ref.availableCents || 0; cashedOut = ref.cashedOutCents || 0;
      }
      // A QR scan is a potential order; a referral is a converted one -> scans >> referrals.
      var scans = referrals > 0 ? Math.round(referrals * 2.8) : 0;
      if(cellQr) cellQr.textContent = String(scans);
      if(cellRef) cellRef.textContent = String(referrals);
      if(cellPend) cellPend.textContent = gbpP(pending);
      if(cellDep) cellDep.textContent = gbpP(deposited);
      if(cellCashed) cellCashed.textContent = gbpP(cashedOut);
      return { pending:pending, deposited:deposited, cashedOut:cashedOut, referrals:referrals, scans:scans };
    }
    applySummary();

    // Live (fresh) account: load the user's REAL referrals into the history +
    // tag each by bucket; demo keeps its own txns built above.
    function buildLiveTxn(row){
      var d = row.created_at ? new Date(row.created_at) : new Date();
      var st = row.bucket==='pending' ? 'pending' : (row.bucket==='cashed_out' ? 'cashed_out' : 'approved');
      return { id: row.order_number || ('HUG-'+String(row.id||'').slice(0,8)),
        name: row.name || 'a friend', date: d, amt: (Number(row.reward_cents)||0)/100, st: st, time: '',
        items: [{ name: row.order_summary || 'order', qty: 1, price: 0 }],
        subtotal: 0, pay: '—', channel: row.channel || '', cancelled: false };
    }
    function loadLive(){
      if(isDemoMode()) return;
      var backend = window.HugBackend;
      if(document.documentElement.dataset.accountStatus !== 'active' || !(backend && backend.getReferralHistory)){
        txns = []; CURRENT_YEAR = new Date().getFullYear(); render('', true); applySummary(); return;
      }
      backend.getReferralHistory(200).then(function(res){
        txns = (res && res.ok && Array.isArray(res.rows)) ? res.rows.map(buildLiveTxn) : [];
        CURRENT_YEAR = txns[0] ? txns[0].date.getFullYear() : new Date().getFullYear();
        render('', true); applySummary();
      }).catch(function(){ txns=[]; render('', true); applySummary(); });
    }
    // Demo cash-out: move all matured (deposited) cashback into "cashed out" so
    // the numbers shift exactly as a real cash-out would, then re-render.
    function cashOutDemo(){
      for(var k=0;k<txns.length;k++){ if(txns[k].st==='approved') txns[k].st='cashed_out'; }
      render('', true); applySummary();
      if(typeof renderReferralBalance==='function') renderReferralBalance();
    }
    window.__hugAccountHistory = { loadLive: loadLive, applySummary: applySummary, cashOutDemo: cashOutDemo };
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
        //   ?ref=<code>      → drives the friend's 10% + credits THIS user (hug-referral.js)
        //   &ref_name=<user> → shows "<username>'s referral" at checkout (personable)
        // (Branded thehuggable.co domain → swap the host once it's connected to Shopify.)
        var name = String(window.__hugRefName || '');
        var url = 'https://zyeeke-kx.myshopify.com/products/hug-o?ref=' + encodeURIComponent(code) + (name ? '&ref_name=' + encodeURIComponent(name) : '');
        var text = 'Every drink in one cup — brewer, cold brew, shaker, bottle, insulated cup. Nine heights, all in your pocket. Here’s 10% off your first hug:';
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
  // existing referral-cashout backend (Stripe payout / Shopify store credit). Demo
  // simulates the move locally so the figures shift exactly as they would live.
  (function cashoutFeature(){
    var card = document.querySelector('.account-main .simple-row.wide.approved');
    if(!card) return;
    var MIN = 2000; // £20 free-cash-out threshold (under £20 carries a £2 fee).
    function avail(){ var r = window.__hugReferral || {}; return r.availableCents || 0; }
    function gbp(c){ return '£' + (c/100).toFixed(2); }
    function refresh(){ card.classList.toggle('cashable', avail() >= MIN); }
    window.__hugCashout = { refresh: refresh };

    async function startCashout(){
      var a = avail();
      if(a <= 0){ showToast('No cashback to cash out yet.'); return; }
      var demo = isDemoMode();
      var last4 = demo ? DEMO.bankLast4 : (window.__hugBankLast4 || '');
      var acct = last4 ? ('your bank account ending ••' + last4) : 'your linked bank account';
      var fee = a >= MIN ? 0 : 200;
      var net = Math.max(0, a - fee);
      var body = fee
        ? ('Cash out ' + gbp(a) + ' to ' + acct + '? A £2 transfer fee applies under £20, so you’ll receive ' + gbp(net) + '. (Free once you reach £20.)')
        : ('Cash out ' + gbp(a) + ' to ' + acct + '? No fee.');
      var ok = await showConfirm({ title: 'Cash out', body: body, confirm: 'Cash out', cancel: 'Not now' });
      if(!ok) return;
      if(demo){
        if(window.__hugAccountHistory && window.__hugAccountHistory.cashOutDemo) window.__hugAccountHistory.cashOutDemo();
        showToast('Cashing out ' + gbp(net) + ' to ' + (last4 ? ('••' + last4) : 'your bank') + '.');
        return;
      }
      var res = await (window.HugBackend && window.HugBackend.cashOutNow ? window.HugBackend.cashOutNow() : Promise.resolve({ ok: false }));
      if(res && res.ok){
        showToast('Cashing out ' + gbp(res.netCents || net) + ' — it’ll arrive shortly.');
        if(typeof refreshReferralBalanceFromServer === 'function') refreshReferralBalanceFromServer();
      } else if(res && res.status === 'needs-onboarding'){ showToast('Add your bank details first to cash out.'); }
      else if(res && res.status === 'not-cash-method'){ showToast('Switch to bank cash-out in settings first.'); }
      else if(res && res.status === 'below-minimum'){ showToast('A little more cashback is needed before you can cash out.'); }
      else { showToast('Couldn’t cash out right now. Please try again.'); }
    }
    card.addEventListener('click', startCashout);
    refresh();
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
    // Curated rankings for the populated/demo build (window.__HUG_DEMO__).
    var DEMO_ROWS = (function(){
      var rows = [
        { label:'ladymoon', points:341, me:false }, { label:'jack p', points:268, me:false },
        { label:'hanna', points:229, me:false }, { label:'you', points:DEMO.points, me:true }
      ];
      var more = ['harry','ivy','luke','maya','sam','noa','ada','bo','cass','dot','evie','fox','greta',
        'huxley','ines','jo','kemi','lux','mona','nia','ola','peg','quincy','rae','sid','tariq','beck',
        'coco','dane','esme','freya','gia','hutch','isla','jasper','kara','lev','niko','pim','rhys',
        'suki','tomas','val','zadie','odie','perry'];
      var p = 197;
      for(var i=0;i<more.length;i++){ rows.push({ label:more[i], points:p, me:false }); p = Math.max(20, p - 4); }
      return rows;
    })();
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function render(full){
      if(!rows.length){
        list.innerHTML = '<div class="leader-empty">refer a friend to climb the leaderboard</div>';
        return;
      }
      var n = full ? rows.length : Math.min(GLANCE, rows.length), html = '';
      for(var i=0; i<n; i++){
        var r = rows[i];
        html += '<div class="leader-row'+(r.me?' is-me':'')+'"><span>'+esc(r.label)+'</span><span>'+r.points+'</span></div>';
      }
      // Not on the board yet → a gentle nudge under the standings (instead of hiding them).
      if(!rows.some(function(r){ return r.me; })) html += '<div class="leader-empty leader-empty--footer">refer a friend to climb the leaderboard</div>';
      list.innerHTML = html;
    }
    function load(){
      if(loading) return;
      // Prototype/demo mode: curated rankings, no backend call.
      if(isDemoMode()){ rows = DEMO_ROWS.slice(); render(open); return; }
      // Live build: the leaderboard is public (anon can read referral_leaderboard),
      // so it shows whether signed in or not.
      if(!(window.HugBackend && window.HugBackend.enabled)){
        rows = []; render(open); return;
      }
      loading = true;
      window.HugBackend.getLeaderboard().then(function(res){
        rows = (res && res.ok && Array.isArray(res.rows))
          ? res.rows.map(function(x){ return { label: x.label, points: Number(x.eco_points) || 0, me: !!x.is_me }; })
          : [];
        // Show the global top standings to EVERYONE (even a fresh 0-point account) so
        // the board never looks broken/empty. A not-yet-ranked viewer still gets the
        // "refer to climb" nudge under the list (see render()).
        render(open);
      }).catch(function(){ rows = []; render(open); }).then(function(){ loading = false; });
    }
    window.__hugLeaderboard = { load: load };
    render(open);

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

    function setExpand(next){
      open = next;
      if(open){
        var cR = content.getBoundingClientRect(), bR = board.getBoundingClientRect(), wR = wrap.getBoundingClientRect();
        var nav = screen.querySelector('.bottom-nav');
        var navTop = nav ? nav.getBoundingClientRect().top : cR.bottom;
        var topInset = 6;
        // Convert post-transform (scaled) rect distances back to design px so the
        // shift + window fill the space correctly on scaled screens (see history).
        var fit = window.__hugFit || 1;
        var shift = Math.max(0, (bR.top - cR.top) / fit - topInset);
        var headH = Math.max(0, (wR.top - bR.top) / fit);
        var winH = Math.max(160, (navTop - cR.top) / fit - topInset - headH - 10);
        content.style.setProperty('--leader-shift', (-shift) + 'px');
        wrap.style.setProperty('--leader-window-height', winH + 'px');
        content.classList.add('leader-open');
        plus.setAttribute('aria-label','Hide full leaderboard');
        try{ list.dispatchEvent(new Event('scroll')); }catch(e){}
      } else {
        content.classList.remove('leader-open');
        content.style.removeProperty('--leader-shift');
        wrap.style.removeProperty('--leader-window-height');
        plus.setAttribute('aria-label','Show full leaderboard');
        try{ list.dispatchEvent(new Event('scroll')); }catch(e){}
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
    window.addEventListener('load', load);   // re-fetch once native-bridge is ready (guests included)
  })();

  (function impactFeature(){
    // ECO POINTS (combined, link-gated — matches the website + referral_leaderboard()):
    //   • each LINKED hug o = 25 eco points (a full mug's offsets)
    //   • each non-reneged referral = +5 (20% of a mug, a BONUS on top — a refund
    //     flips it to 'reneged' and the 5 drops off automatically)
    // The physical offset per mug is unchanged: 25 eco points = 1 mug =
    //   40 bottles / 4 kg CO2e / 1 tree → so 1 eco point = 1.6 / 0.16 / 0.04.
    var POINTS_PER_MUG = 25;
    var POINTS_PER_REFERRAL = 5;
    var PER_MUG = { bottles: 40, co2kg: 4, trees: 1 };   // real per-mug offset (the stepper)
    var PER_POINT = { bottles: PER_MUG.bottles / POINTS_PER_MUG, co2kg: PER_MUG.co2kg / POINTS_PER_MUG, trees: PER_MUG.trees / POINTS_PER_MUG };
    function ecoPointsFor(mugs, refs){ return POINTS_PER_MUG * (mugs || 0) + POINTS_PER_REFERRAL * (refs || 0); }
    function fmtMass(kg){
      if(kg >= 1000) return (Math.round(kg/100)/10) + ' t';
      return (Math.round(kg*10)/10) + ' kg';
    }
    function fmtTrees(n){ return String(Math.round(n * 100) / 100); }  // 0.25 steps -> clean decimals
    function setTriplet(nodes, b, c, t){
      if(nodes[0]) nodes[0].textContent = b;
      if(nodes[1]) nodes[1].textContent = c;
      if(nodes[2]) nodes[2].textContent = t;
    }

    // (A) "your impact so far" (impact screen) + the home summary grid show the
    // signed-in user's REAL cumulative impact: purchased mugs × the factors.
    var homeVals = document.querySelectorAll('.home-content .impact-grid .impact-value');   // [bottles, co2, trees]
    var soFarGroup = document.querySelectorAll('.impact-content .impact-cards')[0];          // first group = "your impact so far"
    var soFarVals = soFarGroup ? soFarGroup.querySelectorAll('.impact-card-val') : [];
    var ecoEl = document.getElementById('imp-eco');                                          // the eco-points hero number
    var placeholder = null;   // original marketing copy, restored when signed out
    function renderYourImpact(linkedMugs, refs){
      if(!placeholder){
        placeholder = {
          home: Array.prototype.map.call(homeVals, function(el){ return el.textContent; }),
          soFar: Array.prototype.map.call(soFarVals, function(el){ return el.textContent; }),
          eco: ecoEl ? ecoEl.textContent : '0'
        };
      }
      if(linkedMugs == null){
        setTriplet(homeVals, placeholder.home[0], placeholder.home[1], placeholder.home[2]);
        setTriplet(soFarVals, placeholder.soFar[0], placeholder.soFar[1], placeholder.soFar[2]);
        if(ecoEl) ecoEl.textContent = placeholder.eco;
        return;
      }
      var points = ecoPointsFor(linkedMugs, refs);   // 25/mug + 5/referral
      var b = Math.round(points * PER_POINT.bottles);
      var c = fmtMass(points * PER_POINT.co2kg);
      var t = fmtTrees(points * PER_POINT.trees);
      setTriplet(homeVals, b, c, t);
      setTriplet(soFarVals, b, c, t);
      if(ecoEl) ecoEl.textContent = String(points);
    }

    // (B) the per-mug stepper — an educational "we offset this per mug" calculator.
    var qtyEl = document.getElementById('imp-qty');
    var bottlesEl = document.getElementById('imp-bottles');
    var co2El = document.getElementById('imp-co2');
    var treesEl = document.getElementById('imp-trees');
    var minus = document.getElementById('imp-minus');
    var plus = document.getElementById('imp-plus');
    var qty = 1;
    function updateStepper(){
      if(qtyEl) qtyEl.textContent = qty;
      if(bottlesEl) bottlesEl.textContent = qty * PER_MUG.bottles;
      if(co2El) co2El.textContent = fmtMass(qty * PER_MUG.co2kg);
      if(treesEl) treesEl.textContent = qty;
    }
    if(minus) minus.addEventListener('click', function(e){ e.stopPropagation(); if(qty>1){ qty--; updateStepper(); } });
    if(plus) plus.addEventListener('click', function(e){ e.stopPropagation(); if(qty<99){ qty++; updateStepper(); } });
    [minus, plus].forEach(function(bn){ if(!bn) return;
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){ bn.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    });
    updateStepper();

    // Impact ties to the number of products LINKED to the account (1 mug = 1 tree),
    // so the offsets and the "linked products" count always match.
    function load(){
      var mugs, refs;
      if(isDemoMode()){
        mugs = (DEMO.linkedCodes && DEMO.linkedCodes.length) || 0;
        refs = (window.__hugReferral && window.__hugReferral.count) || 0;
      } else if(document.documentElement.dataset.accountStatus !== 'active'){
        mugs = 0; refs = 0;   // fresh / signed-out
      } else {
        mugs = (typeof linkedProducts !== 'undefined' && linkedProducts) ? linkedProducts.length : 0;
        refs = (window.__hugReferral && window.__hugReferral.count) || 0;   // non-reneged referral count
      }
      renderYourImpact(mugs, refs);
      if(mugs > 0){ qty = Math.min(99, mugs); updateStepper(); }
    }
    window.__hugImpact = { load: load };
    load();
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
      try { localStorage.setItem(BIO_EMAILS_KEY, JSON.stringify(list.slice(0, 8))); } catch(e){}
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
      try {
        var list = getKnownEmails().filter(function(e){ return e !== email; });
        list.unshift(email);
        localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(list.slice(0, 4)));
      } catch(e){}
    }
    function forgetEmail(email){
      try { localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(getKnownEmails().filter(function(e){ return e !== email; }))); }
      catch(e){}
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
      // pick up the face glyph + tap-to-Face-ID behaviour.
      refreshBioAvailable().then(function(){ renderAccountChips(); });
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
      var ok = await showConfirm({ title:'Sign out', body:'Sign out of the prototype account?', confirm:'Sign out', cancel:'Cancel' });
      if(!ok) return;
      // Prototype "sign out" leaves the demo account -> fresh / signed-out state.
      try { localStorage.setItem('hug-demo-mode', 'off'); } catch(e){}
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
        b.textContent = ok ? 'copied ✓' : 'copy failed';
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

  // ----- Home "ECO POINTS" = your combined eco points (25/linked mug + 5/referral),
  // read from the leaderboard's is_me row (0 until you have any). -----
  (function pointsFeature(){
    var el = document.querySelector('.points-block .points');
    if(!el) return;
    function set(v){ el.textContent = String(v); }
    function load(){
      if(isDemoMode()){ set(DEMO.points); return; }
      if(document.documentElement.dataset.accountStatus !== 'active' || !(window.HugBackend && window.HugBackend.enabled)){ set(0); return; }
      window.HugBackend.getLeaderboard().then(function(res){
        var me = (res && res.ok && Array.isArray(res.rows)) ? res.rows.filter(function(r){ return r.is_me; })[0] : null;
        set(me ? (Number(me.eco_points) || 0) : 0);
      }).catch(function(){ set(0); });
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
        prev.innerHTML = '<img src="' + s.art.url + '" alt="">';
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
    tick.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.4L19 7"/></svg>';
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
      badge.textContent = status === 'available' ? '✓ available'
        : status === 'taken' ? '✕ taken — pick another'
        : status === 'invalid' ? '✕ use 2–24 characters'
        : status === 'checking' ? 'checking…' : '';
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
    backend.saveShippingAddress(addr);
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


/* Referral code apply (checkout). Validates + previews the 10% off in the total;
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
    btn.textContent = "applied ✓";
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
    } else {
      show();
      hideAfter(EXIT_MS);
    }
    lastCam = camNow;
  }).observe(html, { attributes:true, attributeFilter:["class"] });

  var scanLeaving = false;
  new MutationObserver(function(){
    var cls = scanScreen.className || "";
    var leaving = !scanScreen.classList.contains("active") || /leave|fade-out|exit/.test(cls);
    if (leaving && !scanLeaving && cachedBox){
      scanLeaving = true;
      show();
      hideAfter(EXIT_MS);
    } else if (!leaving){
      scanLeaving = false;
    }
  }).observe(scanScreen, { attributes:true, attributeFilter:["class"] });
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
