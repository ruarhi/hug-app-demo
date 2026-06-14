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
    let selectedLinkedProduct = null;
    let referralCopyTimer = null;

    // Local prototype referral link only. Real attribution/user identity belongs in backend/auth work.
    function buildLocalReferralUrl(productCode) {
      return `https://www.thehuggable.co/r/LOCAL-USER/${encodeURIComponent(productCode)}`;
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
    function renderReferralCode() {
      const shareValue = document.querySelector(".share-box .share-value");
      const codeBtn = document.querySelector('.share-box .copy-btn[aria-label="Copy referral code"]');
      const linkBtn = document.querySelector('.share-box .copy-btn[aria-label="Copy referral link"]');
      const code = accountStatus === "active" ? referralCode : "";
      if (shareValue) shareValue.textContent = code || "—";
      if (codeBtn) codeBtn.setAttribute("data-copy", code);
      if (linkBtn) linkBtn.setAttribute("data-copy", code ? `www.thehuggable.co/r/${code}` : "");
    }

    async function refreshReferralCodeFromServer() {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await backend.getMyProfile();
      if (!res.ok || !res.referralCode) return;
      referralCode = res.referralCode;
      saveReferralCode(referralCode);
      renderReferralCode();
    }

    function formatGbpCents(cents) {
      return "£" + (Math.max(0, Number(cents) || 0) / 100).toFixed(2);
    }

    // The top-bar "Referral balance" pill (shown on every screen) reflects
    // spendable (available/deposited) referral credit from the server. Pending
    // is kept on window.__hugReferral for the home intro motion and future
    // account-screen wiring. Guests / signed-out show £0.00.
    function renderReferralBalance() {
      const active = accountStatus === "active";
      const available = active ? referralAvailableCents : 0;
      const pending = active ? referralPendingCents : 0;
      window.__hugReferral = { availableCents: available, pendingCents: pending };
      document.querySelectorAll(".balance").forEach(el => {
        el.textContent = formatGbpCents(available);
      });
    }

    async function refreshReferralBalanceFromServer() {
      const backend = window.HugBackend;
      if (!backend?.enabled || accountStatus !== "active") return;
      const res = await backend.getReferralBalance();
      if (!res.ok) return;
      referralAvailableCents = res.availableCents;
      referralPendingCents = res.pendingCents;
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
    }

    window.clearHugAccountState = clearHugAccountState;

    function isValidEmail(value) {
      const email = String(value || "").trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function renderHugAccountState() {
      if (profileEmailValue) {
        profileEmailValue.textContent = accountStatus === "active" && accountEmail
          ? accountEmail
          : "guest";
        profileEmailValue.title = accountEmail || "guest";
      }
      renderReferralCode();
      renderReferralBalance();
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
      const backend = window.HugBackend;
      if (!backend?.enabled) return;
      const res = await backend.getSession();
      if (!res.ok) return;                      // offline: keep local fallback state
      if (res.session) {
        setHugAccountState("active", res.session.email);
        refreshLinkedProductsFromServer();
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

    function setScanCameraVisible(visible) {
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

    async function startProductQrScan() {
      if (!scanScreen) return;
      // Soft resume (JS-only, no camera restart) is only safe when we KNOW the
      // native session survived: it is alive and the app never went hidden.
      if (cameraSessionAlive &&
          document.visibilityState !== "hidden" &&
          document.documentElement.classList.contains("scan-camera-active")) {
        scanRequestId += 1;
        clearCandidateQrCode();
        clearScanResult();
        scanResult?.setAttribute("aria-hidden", "true");
        confirmedScannedCode = "";
        confirmedHugProductCode = "";
        confirmedHugProduct = null;
        setScanState("scanning", "Point the camera at a product QR code");
        return;
      }
      const requestId = ++scanRequestId;
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

      // Watchdog: if the native start hangs, surface a tappable failed state
      // instead of "Starting camera..." forever. A late success still recovers.
      setTimeout(function () {
        if (requestId !== scanRequestId) return;
        if (scanScreen.dataset.scanState !== "ready") return;
        setScanCameraVisible(false);
        setScanState("failed", "Unable to start the scanner. Tap to retry.");
      }, 7000);

      try {
        const result = await queueScanOp(function () { return window.HugNative.startQrScan(); });
        if (requestId !== scanRequestId) {
          // A newer start/stop owns the camera now; its queued ops clean up.
          // Stopping here would race ahead and kill the newer session.
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
          return;
        }

        if (result?.status === "denied") {
          setScanState("denied", "Camera permission is required to scan QR codes.");
          return;
        }

        setScanState("unavailable", "QR scanning works on device.");
      } catch (error) {
        console.error("Unable to start QR scanner", error);
        cameraSessionAlive = false;
        setScanCameraVisible(false);
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
      confirmedScannedCode = scannedCode;
      const handlingRequestId = scanRequestId;
      const parsedCode = parseHugQrCode(scannedCode);
      await new Promise(function (resolve) { setTimeout(resolve, 520); });
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
      if (name === "account") {
        document.querySelectorAll(".history-list").forEach(list => {
          list.scrollTop = 0;
          list.style.setProperty("--hist-pull", "0px");
        });
        syncHistoryFade();
      }
      if (name === "scan") {
        startProductQrScan();
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
        checkoutTotalValue.textContent = `£${(total * unitPrice + (total > 0 ? giftWrapFee() : 0)).toFixed(2)}`;
      }
      renderCheckoutItems();
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

    function routeSettingsByPoint(x, y, event) {
      if ((phone.dataset.current || "home") !== "settings") return false;
      const rows = document.querySelectorAll(".screen[data-screen='settings'].active .simple-row[data-go]");
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          event?.stopPropagation?.();
          event?.preventDefault?.();
          onNavAction(row.dataset.go);
          return true;
        }
      }
      return false;
    }

    document.querySelectorAll(".screen[data-screen='settings'] .simple-row[data-go]").forEach(row => {
      row.addEventListener("click", event => {
        event.stopPropagation();
        onNavAction(row.dataset.go);
      });
    });

    phone.addEventListener("pointerdown", event => {
      if (routeSettingsByPoint(event.clientX, event.clientY, event)) return;
      const settingsRow = resolveActiveSettingsRow(event.target);
      if (!settingsRow) return;
      event.stopPropagation();
      event.preventDefault?.();
      onNavAction(settingsRow.dataset.go);
    }, true);

    phone.addEventListener("touchstart", event => {
      if (prefersPointerInput) return;
      const t = event.changedTouches?.[0];
      if (t && routeSettingsByPoint(t.clientX, t.clientY, event)) return;
      const settingsRow = resolveActiveSettingsRow(event.target);
      if (!settingsRow) return;
      event.stopPropagation();
      event.preventDefault?.();
      onNavAction(settingsRow.dataset.go);
    }, { capture: true, passive: false });

    phone.addEventListener("click", event => {
      if (routeSettingsByPoint(event.clientX ?? 0, event.clientY ?? 0, event)) return;
      const settingsRow = resolveActiveSettingsRow(event.target);
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
      if (target?.closest?.(".history-wrap, .txn-detail")) return;
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
      pushTxn(NAMES[(i+7) % NAMES.length], new Date(cur), amts[i % amts.length], 'approved');
    }
    var CURRENT_YEAR = txns[0].date.getFullYear();
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
        + '<div class="txn-status txn-'+t.st+'">'+(t.st==='pending'?'cashback pending':'cashback deposited')+'</div>'
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
        cellPend=summaryCell('cashback pending'), cellDep=summaryCell('cashback deposited');
    var QR_SCANS = cellQr ? (parseInt(cellQr.textContent,10)||0) : 0; // standalone: scans aren't in the referral txns
    function gbpP(p){ return '£'+(p/100).toFixed(2); }
    function computeTotals(){
      var pend=0, dep=0, orders=0, friends={};
      for(var k=0;k<txns.length;k++){
        var t=txns[k];
        friends[t.name]=1;                 // referral counted even if the order is later cancelled
        if(t.cancelled) continue;          // a returned order leaves cashback + order count
        orders++;
        if(t.st==='pending') pend+=Math.round(t.amt*100); else dep+=Math.round(t.amt*100);
      }
      return { pending:pend, deposited:dep, orders:orders,
        referrals:Object.keys(friends).length, qrScans:QR_SCANS };
    }
    function applySummary(){
      var s=computeTotals();
      if(cellQr) cellQr.textContent=String(s.qrScans);
      if(cellRef) cellRef.textContent=String(s.referrals);
      if(cellOrd) cellOrd.textContent=String(s.orders);
      if(cellPend) cellPend.textContent=gbpP(s.pending);
      if(cellDep) cellDep.textContent=gbpP(s.deposited);
      return s;
    }
    applySummary();
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
        var val = btn.getAttribute('data-copy');
        try {
          if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(val).then(flash, flash); }
          else { flash(); }
        } catch(err){ flash(); }
      });
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){
        btn.addEventListener(ev, function(e){ e.stopPropagation(); });
      });
    });
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

    // 50 entries; names kept disjoint from the history transaction pool.
    var NAMES = ['ladymoon','jack p','hanna','mia','harry','ivy','luke','maya','sam','noa',
      'ada','bo','cass','dot','evie','fox','greta','huxley','ines','jo',
      'kemi','lux','mona','nia','ola','peg','quincy','rae','sid','tariq',
      'beck','coco','dane','esme','freya','gia','hutch','isla','jasper','kara',
      'lev','niko','pim','rhys','suki','tomas','val','zadie','odie','perry'];
    var PTS = [745,570,515,492,468,446,428,405,389,362];
    for(var p=10; p<NAMES.length; p++){ PTS.push(Math.max(40, 350 - (p-10)*7)); }
    var GLANCE = 10;
    function render(full){
      var n = full ? NAMES.length : GLANCE, html = '';
      for(var i=0; i<n; i++){
        html += '<div class="leader-row"><span>'+NAMES[i]+'</span><span>'+PTS[i]+'</span></div>';
      }
      list.innerHTML = html;
    }
    render(true);

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

    var open = false;
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
  })();

  (function impactStepper(){
    var qtyEl = document.getElementById('imp-qty');
    if(!qtyEl) return;
    var bottlesEl = document.getElementById('imp-bottles');
    var co2El = document.getElementById('imp-co2');
    var treesEl = document.getElementById('imp-trees');
    var minus = document.getElementById('imp-minus');
    var plus = document.getElementById('imp-plus');
    var qty = 1;
    function fmtKg(n){ return (Math.round(n*10)/10) + ' kg'; }
    function update(){
      qtyEl.textContent = qty;
      if(bottlesEl) bottlesEl.textContent = qty * 40;      // 40 bottles each
      if(co2El) co2El.textContent = fmtKg(qty * 4);        // ~4 kg CO2e each
      if(treesEl) treesEl.textContent = qty;               // 1 tree each
    }
    if(minus) minus.addEventListener('click', function(e){ e.stopPropagation(); if(qty>1){ qty--; update(); } });
    if(plus) plus.addEventListener('click', function(e){ e.stopPropagation(); if(qty<99){ qty++; update(); } });
    [minus, plus].forEach(function(b){ if(!b) return;
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){ b.addEventListener(ev, function(e){ e.stopPropagation(); }); });
    });
    update();
  })();


  // (19) card designer — live message + font-style picker (plain / handwritten / retro / ransom).
  (function cardDesigner(){
    var msg = document.getElementById('card-msg');
    var input = document.getElementById('card-input');
    var styles = document.getElementById('card-styles');
    var save = document.getElementById('card-save');
    if (!msg || !input || !styles) return;
    var style = 'plain';
    var KEY = 'hug_card';
    var RF = ["'HugRansom',cursive"];
    var RP = [['#fff','#0a0a0a'], ['#fff','#0a0a0a'], ['#0a0a0a','#fff'], ['#f3f0e7','#0a0a0a'], ['#ffe14d','#0a0a0a'], ['#eb3d7f','#fff']];
    function rpick(a){ return a[(Math.random()*a.length)|0]; }
    function resc(s){ return s.replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
    function ransom(t){ var o=''; for (var i=0;i<t.length;i++){ var ch=t[i]; if (ch===' '){ o+='<span class="ransom-sp"></span>'; continue; } var p=rpick(RP); o+='<span class="ransom-ch" style="font-family:'+rpick(RF)+';background:'+p[0]+';color:'+p[1]+';transform:rotate('+(Math.random()*26-13).toFixed(1)+'deg);font-size:'+(0.85+Math.random()*0.6).toFixed(2)+'em;">'+resc(ch)+'</span>'; } return o; }
    function render(){ var t = input.value || ' '; msg.className = 'card-msg style-'+style; if (style==='ransom') msg.innerHTML = ransom(t); else msg.textContent = t; }
    try { var saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { if (saved.message) input.value = saved.message; style = saved.style || 'plain'; styles.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.dataset.style===style); }); } } catch(e){}
    input.addEventListener('input', render);
    styles.querySelectorAll('button').forEach(function(b){ b.addEventListener('click', function(){ style = b.dataset.style; styles.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x===b); }); render(); }); });
    if (save) save.addEventListener('click', function(){ try { localStorage.setItem(KEY, JSON.stringify({ message: input.value.trim(), style: style })); } catch(e){} save.textContent = 'Saved ✓'; setTimeout(function(){ save.textContent = 'Save card'; }, 1400); });
    render();
  })();

  // (18) gift-wrap fee (hoisted so updateCart can read it); maintained by giftWrapFeature
  function giftWrapFee(){ return (window.__giftWrapFee || 0); }

  (function giftWrapFeature(){
    var toggle = document.getElementById('gift-wrap-toggle');
    var row    = document.getElementById('gift-row');
    var feeEl  = document.getElementById('gift-fee');
    var panel  = document.getElementById('giftwrap-panel');
    if(!toggle || !panel) return;
    var unitsWrap = document.getElementById('gift-units');
    var doneBtn   = document.getElementById('gift-done');
    var backBtn   = document.getElementById('giftwrap-back');
    var PAPER_COUNT = 5;
    var gw = {};                 // per-SKU: gw[i] = { wrap, paper, card, message }
    window.__giftWrapFee = 0;

    function st(i){ if(!gw[i]) gw[i] = { wrap:false, paper:0, card:false, cardStyle:0, message:'' }; return gw[i]; }
    function cardsHtml(i){ var s=st(i), html=''; for(var c=0;c<4;c++){ html += '<button type="button" class="gift-card-opt gift-card-opt-'+c+(s.cardStyle===c?' sel':'')+'" data-cardstyle="'+c+'" aria-label="Card design '+(c+1)+'"></button>'; } return html; }
    function wrappedCount(){ var n=0; for(var i=0;i<bagVariantNames.length;i++){ var q=cartQty[i]; for(var u=1;u<=q;u++){ var k=i+'_'+u; if(gw[k]&&gw[k].wrap) n++; } } return n; }

    function recompute(){
      var n = wrappedCount(), on = n > 0;
      window.__giftWrapFee = n * 3;
      toggle.checked = on;
      if(row) row.classList.toggle('selected', on);
      if(feeEl) feeEl.textContent = '+\u00A3' + (on ? n*3 : 3).toFixed(2);
    }
    function refreshFee(){ recompute(); try{ updateCart(); }catch(e){} }
    window.__giftSync = function(){ if(panel && !panel.classList.contains('open')) build(); recompute(); };

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
          html += '<div class="gift-unit'+(s.wrap?' wrapped':'')+'" data-u="'+key+'">'
            + '<label class="gift-unit-head">'
            +   '<span class="gift-check"><input type="checkbox" data-wrap="'+key+'"'+(s.wrap?' checked':'')+'><span class="gift-tick"></span></span>'
            +   '<span class="gift-unit-name">'+label+'</span>'
            + '</label>'
            + '<div class="gift-unit-body">'
            +   '<p class="gift-section-label">wrapping paper</p>'
            +   '<div class="gift-papers" data-papers="'+key+'">'+papersHtml(key)+'</div>'
            +   '<label class="gift-unit-card-row"><span class="gift-check"><input type="checkbox" data-card="'+key+'"'+(s.card?' checked':'')+'><span class="gift-tick"></span></span><span>add a gift card</span></label>'
            +   '<div class="gift-card-panel'+(s.card?' open':'')+'" data-cardpanel="'+key+'"><p class="gift-section-label">card design</p><div class="gift-cards" data-cards="'+key+'">'+cardsHtml(key)+'</div><p class="gift-section-label">message</p><textarea data-msg="'+key+'" maxlength="200" placeholder="write your message\u2026">'+(s.message||'')+'</textarea></div>'
            + '</div>'
            + '</div>';
        }
      }
      unitsWrap.innerHTML = html || '<p class="gift-empty">your bag is empty</p>';
    }

    var firstOpen = true;
    function openPanel(){
      if(firstOpen && wrappedCount()===0){ for(var i=0;i<bagVariantNames.length;i++){ var q=cartQty[i]; for(var u=1;u<=q;u++){ st(i+'_'+u).wrap=true; } } }
      firstOpen = false;
      build();
      recompute();
      panel.classList.add('open'); panel.setAttribute('aria-hidden','false');
    }
    function closePanel(){ panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }

    if(unitsWrap){
      unitsWrap.addEventListener('change', function(e){
        var w = e.target.closest('input[data-wrap]');
        if(w){ var wi=w.getAttribute('data-wrap'); st(wi).wrap = w.checked;
          var unit = w.closest('.gift-unit'); if(unit) unit.classList.toggle('wrapped', w.checked);
          refreshFee(); return; }
        var c = e.target.closest('input[data-card]');
        if(c){ var ci=c.getAttribute('data-card'); st(ci).card = c.checked;
          var cp = unitsWrap.querySelector('[data-cardpanel="'+ci+'"]');
          if(cp){ cp.classList.toggle('open', c.checked);
            if(c.checked){ var ta=cp.querySelector('textarea'); if(ta) setTimeout(function(){ ta.focus(); },280); } }
        }
      });
      unitsWrap.addEventListener('input', function(e){
        var ta = e.target.closest('textarea[data-msg]'); if(!ta) return;
        st(ta.getAttribute('data-msg')).message = ta.value;
      });
      unitsWrap.addEventListener('click', function(e){
        var cb = e.target.closest('[data-cardstyle]');
        if(cb){ var cg = cb.closest('[data-cards]'); if(cg){ st(cg.getAttribute('data-cards')).cardStyle = parseInt(cb.getAttribute('data-cardstyle'),10) || 0; cg.querySelectorAll('.gift-card-opt').forEach(function(el){ el.classList.remove('sel'); }); cb.classList.add('sel'); } return; }
        var b = e.target.closest('[data-paper]'); if(!b) return;
        var group = b.closest('[data-papers]'); if(!group) return;
        st(group.getAttribute('data-papers')).paper = parseInt(b.getAttribute('data-paper'),10) || 0;
        group.querySelectorAll('.gift-paper').forEach(function(el){ el.classList.remove('sel'); });
        b.classList.add('sel');
      });
    }

    function applyAndClose(){
      if(unitsWrap){ unitsWrap.querySelectorAll('textarea[data-msg]').forEach(function(ta){ st(ta.getAttribute('data-msg')).message = ta.value; }); }
      refreshFee(); closePanel();
    }
    if(doneBtn) doneBtn.addEventListener('click', applyAndClose);
    if(backBtn) backBtn.addEventListener('click', applyAndClose);

    toggle.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); openPanel(); });
    ['pointerdown','touchstart'].forEach(function(ev){ toggle.addEventListener(ev, function(e){ e.stopPropagation(); }); });

    if(row){
      row.addEventListener('click', function(){ openPanel(); });
    }
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
    editable(scope.querySelector('.profile-name'), 'name');
    editable(scope.querySelector('.email-value'), 'email');
  })();


  // (14) purchase history: tap a row to expand its details
  (function purchasesFeature(){
    var scope = document.querySelector('.screen[data-screen="purchases"]');
    if(!scope) return;
    scope.querySelectorAll('.purchase-row').forEach(function(row){
      row.addEventListener('click', function(e){
        e.stopPropagation();
        var item = row.closest('.purchase-item');
        if(item) item.classList.toggle('open');
      });
      ['pointerdown','touchstart','pointermove'].forEach(function(ev){
        row.addEventListener(ev, function(e){ e.stopPropagation(); });
      });
    });
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
    }
  });
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


/* discount code apply (checkout) */
(function () {
  const btn = document.querySelector(".discount-apply");
  const field = document.querySelector(".discount-field");
  if (!btn || !field) return;
  btn.addEventListener("click", () => {
    if (!field.value.trim()) { field.focus(); return; }
    btn.classList.add("applied");
    btn.textContent = "applied";
    setTimeout(() => { btn.classList.remove("applied"); btn.textContent = "apply"; }, 1600);
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
      sc.scrollTop = 0;
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
    var root = document.documentElement;
    if (!scanScreen || !root || !window.MutationObserver) return;
    new MutationObserver(function(){
      var leaving = !scanScreen.classList.contains('active') ||
                    scanScreen.classList.contains('quick-fade-leave');
      if (leaving) root.classList.remove('scan-camera-active');
    }).observe(scanScreen, { attributes: true, attributeFilter: ['class'] });
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
