// HUG Giving maths — SPEC docs/giving/SPEC.md §1.2, implemented exactly.
// One file, two homes: a browser global (window.HugGivingMath, loaded before app.js) and a
// CommonJS module (scripts/giving-math-test.mjs). No rounding inside the maths; the format*
// helpers round for display only.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HugGivingMath = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // SPEC §1 — the numbers. Used only when giving_overview() has not answered (signed out
  // offline, prototype mode, backend not yet deployed). Live values come from the database.
  var DEFAULT_CONFIG = { token_value_pence: 25, per_cup_pence: 150, per_referral_tokens: 1 };
  var DEFAULT_CAUSES = [
    { id: "plastic", panel: "planet", sort: 1, partner_name: "empower.eco", unit_cost_pence: 39.09, default_share_pence: 43, display: "units" },
    { id: "carbon", panel: "planet", sort: 2, partner_name: "Gold Standard-certified credits", unit_cost_pence: 1.625, default_share_pence: 13, display: "units" },
    { id: "tree", panel: "planet", sort: 3, partner_name: "Eden: People+Planet", unit_cost_pence: 16, default_share_pence: 16, display: "units" },
    { id: "water", panel: "people", sort: 4, partner_name: "Evidence Action", unit_cost_pence: 0.384, default_share_pence: 18, display: "units" },
    { id: "food", panel: "people", sort: 5, partner_name: "Mary's Meals", unit_cost_pence: 10, default_share_pence: 30, display: "units" },
    { id: "sanitation", panel: "people", sort: 6, partner_name: "Toilet Twinning (Tearfund)", unit_cost_pence: 6000, default_share_pence: 30, display: "percent" },
    // Built but switched off (SPEC §1.4): the owner can swap it back in from the admin.
    { id: "vitamin_a", panel: "people", sort: 7, partner_name: "Helen Keller Intl", unit_cost_pence: 0.41, default_share_pence: 26, display: "units", active: false }
  ];

  function num(v, fallback) {
    var n = typeof v === "string" ? Number(v) : v;
    return typeof n === "number" && isFinite(n) ? n : fallback;
  }

  // Only active causes take part (a cause with no `active` flag is active — giving_overview()
  // already sends active ones only). SPEC §1.4.
  function activeOnly(causes) {
    return (causes || []).filter(function (c) { return c.active !== false; });
  }

  // The order every list shows causes in: the People panel first, then Planet, each in its own
  // sort order (owner, 2026-10-18: "put people first in the app"). The panel decides, not the
  // database's sort numbers, so the order holds whatever the admin's sort says.
  var PANEL_RANK = { people: 0, planet: 1 };
  function panelRank(c) { var r = PANEL_RANK[c && c.panel]; return r == null ? 2 : r; }
  function byDisplayOrder(a, b) { return panelRank(a) - panelRank(b) || num(a.sort, 0) - num(b.sort, 0); }
  function inDisplayOrder(causes) { return activeOnly(causes).sort(byDisplayOrder); }

  // causes: any order, inactive ones are dropped; enabledIds: profile.giving_causes
  // (null/undefined/[] = all active; ids naming an inactive cause are dropped, SPEC §1.2).
  // Returns { causes (active, in display order), enabled (ids), allEnabled }.
  function resolveEnabled(causes, enabledIds) {
    var sorted = inDisplayOrder(causes);
    var allIds = sorted.map(function (c) { return c.id; });
    var chosen = Array.isArray(enabledIds) ? allIds.filter(function (id) { return enabledIds.indexOf(id) !== -1; }) : [];
    var enabled = chosen.length ? chosen : allIds;
    return { causes: sorted, enabled: enabled, allEnabled: enabled.length === allIds.length };
  }

  // The split. opts: { causes, config, cups, referrals, enabled }.
  function compute(opts) {
    opts = opts || {};
    var cfg = opts.config || DEFAULT_CONFIG;
    var tokenValue = num(cfg.token_value_pence, 25);
    var perCupTokens = num(cfg.per_cup_pence, 150) / tokenValue;
    var perRefTokens = num(cfg.per_referral_tokens, 1);
    var cups = Math.max(0, num(opts.cups, 0));
    var referrals = Math.max(0, num(opts.referrals, 0));
    var r = resolveEnabled(opts.causes || DEFAULT_CAUSES, opts.enabled);

    var W = 0;
    r.causes.forEach(function (c) {
      if (r.enabled.indexOf(c.id) !== -1) W += num(c.default_share_pence, 0);
    });

    var tokens = perCupTokens * cups + perRefTokens * referrals;
    var pence = tokens * tokenValue;
    var perCause = r.causes.map(function (c) {
      var on = r.enabled.indexOf(c.id) !== -1 && W > 0;
      var share = on ? num(c.default_share_pence, 0) / W : 0;
      var p = pence * share;
      var unit = num(c.unit_cost_pence, 0);
      return {
        id: c.id,
        share: share,
        pence: p,
        tokens: p / tokenValue,
        outcome: c.display === "money" || !(unit > 0) ? null : p / unit,
        display: c.display
      };
    });
    return {
      cups: cups, referrals: referrals, tokens: tokens, pence: pence,
      enabled: r.enabled, allEnabled: r.allEnabled, perCause: perCause
    };
  }

  // ---- display rounding (SPEC §1.2) -------------------------------------------------------
  function group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  // units: >= 10 whole with thousands separators; < 10 one decimal, ".0" dropped.
  function formatUnits(n) {
    n = num(n, 0);
    if (n >= 10) return group(String(Math.round(n)));
    var s = n.toFixed(1);
    return s.slice(-2) === ".0" ? s.slice(0, -2) : s;
  }
  // money (pence in): < £10 -> "£2.60", >= £10 -> "£12". Under £1 the home row wants "26p".
  function formatMoney(pence) {
    pence = num(pence, 0);
    if (pence >= 1000) return "£" + group(String(Math.round(pence / 100)));
    return "£" + (pence / 100).toFixed(2);
  }
  // Short money for tight places (home row, per-cup share): "26p" below £1, else formatMoney.
  function formatPence(pence) {
    pence = num(pence, 0);
    if (pence < 100) return String(Math.round(pence)) + "p";
    return formatMoney(pence);
  }
  // percent (SPEC §1.2): n is a FRACTION of one unit. Below 1 unit -> a percentage, one decimal,
  // ".0" dropped, never "0%" for a non-zero amount, whole number from 10%. At 1 unit or more ->
  // the count, one decimal, ".0" dropped. Returns { text, isPercent } so callers pick the unit.
  function formatPercentParts(n) {
    n = num(n, 0);
    if (n >= 1) return { value: formatTokensCause(n), isPercent: false };
    if (!(n > 0)) return { value: "0%", isPercent: true };
    var pct = n * 100;
    if (pct >= 10) return { value: String(Math.round(pct)) + "%", isPercent: true };
    var s = pct.toFixed(1);
    if (s === "0.0") s = "0.1";
    return { value: (s.slice(-2) === ".0" ? s.slice(0, -2) : s) + "%", isPercent: true };
  }
  function formatPercent(n) { return formatPercentParts(n).value; }
  function formatTokensTotal(n) { return group(String(Math.round(num(n, 0)))); }
  function formatTokensCause(n) {
    var s = num(n, 0).toFixed(1);
    return s.slice(-2) === ".0" ? s.slice(0, -2) : s;
  }

  // HOME ROW OPENING (app.js impactRow). Pure, so scripts/giving-math-test.mjs can pin them.
  // landingPanel: which of the two panels the home row settles on. People is the primary panel
  // (owner, 2026-10-18: "make people and not planet the primary cause i.e. the main 3 icons at
  // the top"). (a) a cause choice that is not all-on -> the panel holding the larger share of the
  // giving (sum of default_share_pence of the enabled causes per panel); else, and on a tie, (b)
  // people. opts: { causes, enabled, last }; last (the panel last viewed) no longer decides: it
  // used to come before the default, so a look at planet once kept planet up front for good.
  function landingPanel(opts) {
    opts = opts || {};
    var r = resolveEnabled(opts.causes || DEFAULT_CAUSES, opts.enabled);
    if (!r.allEnabled) {
      var sum = { planet: 0, people: 0 };
      r.causes.forEach(function (c) {
        if (r.enabled.indexOf(c.id) !== -1 && (c.panel === "planet" || c.panel === "people")) sum[c.panel] += num(c.default_share_pence, 0);
      });
      if (sum.planet > sum.people) return "planet";
    }
    return "people";
  }
  // spinCurve: the opening spin of a two-panel loop, as ONE continuous movement (no steps, so no
  // jolt between panels). Still for holdMs. Then a quick run-up (accelMs): the speed rises as
  // sin², so the row leaves rest without a kick, like a slot-machine reel. A short burst at full
  // speed (cruiseMs). Then a long coast (decelMs): the speed falls away exponentially, like a
  // released scroll on an iPhone (time constant decelMs / k = 500 ms by default, iOS "normal"
  // deceleration), and reaches zero exactly as the last panel lands — no hard stop.
  // The row always heads the same way. Distance = `passes` panel widths: at least minPasses
  // (default 4), plus one when needed so the row lands on `target`. spinAt() gives the position.
  function spinCurve(start, target, opts) {
    opts = opts || {};
    var n = Math.max(2, Math.floor(num(opts.minPasses, 4)));
    if ((start === target) !== (n % 2 === 0)) n++;
    var a = Math.max(0, num(opts.accelMs, 320));
    var c = Math.max(0, num(opts.cruiseMs, 160));
    var d = Math.max(200, num(opts.decelMs, 2000));
    var k = Math.max(0.5, num(opts.k, 4));
    var e = Math.exp(-k);
    var coast = ((1 - e) / k - e) / (1 - e);        // share of vmax·d covered while coasting
    return { holdMs: num(opts.holdMs, 500), accelMs: a, cruiseMs: c, decelMs: d, k: k,
      vmax: n / (a / 2 + c + d * coast),             // panels per ms at full speed
      passes: n, totalMs: a + c + d, target: target };
  }
  // spinAt: `t` ms after the hold ends -> { p: panels travelled (0 … passes), v: panels per ms }.
  function spinAt(s, t) {
    var a = s.accelMs, c = s.cruiseMs, d = s.decelMs, v = s.vmax, k = s.k, e = Math.exp(-k);
    if (!(t > 0)) return { p: 0, v: 0 };
    if (t >= a + c + d) return { p: s.passes, v: 0 };
    if (t < a) {
      var u = t / a;
      return { p: v / 2 * (t - a / Math.PI * Math.sin(Math.PI * u)), v: v * (1 - Math.cos(Math.PI * u)) / 2 };
    }
    if (t < a + c) return { p: v * a / 2 + v * (t - a), v: v };
    var x = (t - a - c) / d;
    return {
      p: Math.min(s.passes, v * a / 2 + v * c + v * d * ((1 - Math.exp(-k * x)) / k - e * x) / (1 - e)),
      v: v * (Math.exp(-k * x) - e) / (1 - e)
    };
  }

  // spinPath: the opening spin for ONE panel as compositor keyframes [{ offset 0…1, x px }],
  // sampled from spinAt every `stepMs` (default 8) and interpolated linearly between samples.
  // `shift` = how many panels behind the leader it starts (0 or 1); W = panel width in px.
  // A panel leaves to the left and, fully off screen at -W, re-enters from +W: that jump is a PAIR
  // of keyframes at the same offset (-W then +W), so nothing is ever interpolated across the row.
  //
  // The pair is emitted whenever a sample reaches an odd whole pass, INCLUDING landing on it
  // exactly. The last sample of every spin lands exactly on `passes`, so one of the two panels
  // always finishes on a wrap boundary. With `q > m` (the old test) that last wrap was never
  // emitted: the final 8 ms was keyframed -W -> +W and the compositor swept the outgoing panel
  // across the row on top of the one landing — a ghost flash at the very moment of the halt
  // (owner, 2026-10-12: "jittery as it gets to the end of its slow down and halt").
  function spinPath(curve, shift, W, stepMs) {
    var T = curve.totalMs, N = Math.max(1, Math.ceil(T / (stepMs > 0 ? stepMs : 8))), out = [], prevQ = shift;
    function r(x) { return Math.round(x * 100) / 100 + 0; }     // + 0: never "-0"
    function xAt(q) { var a = ((q % 2) + 2) % 2; return a < 1 ? -a * W : (2 - a) * W; }
    function qAt(t) { return (t >= T ? curve.passes : spinAt(curve, t).p) + shift; }
    for (var i = 0; i <= N; i++) {
      var t = T * i / N, q = qAt(t), m = Math.floor(q);
      if (i > 0 && m > Math.floor(prevQ) && m % 2 === 1) {
        var lo = T * (i - 1) / N, hi = t;                         // when it reaches -W exactly
        for (var b = 0; b < 30; b++) { var mid = (lo + hi) / 2; if (qAt(mid) < m) lo = mid; else hi = mid; }
        out.push({ offset: hi / T, x: r(-W) }, { offset: hi / T, x: r(W) });
      }
      out.push({ offset: i / N, x: r(xAt(q)) });
      prevQ = q;
    }
    return out;
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    DEFAULT_CAUSES: DEFAULT_CAUSES,
    landingPanel: landingPanel,
    spinCurve: spinCurve,
    spinAt: spinAt,
    spinPath: spinPath,
    activeOnly: activeOnly,
    inDisplayOrder: inDisplayOrder,
    resolveEnabled: resolveEnabled,
    compute: compute,
    formatUnits: formatUnits,
    formatMoney: formatMoney,
    formatPence: formatPence,
    formatPercent: formatPercent,
    formatPercentParts: formatPercentParts,
    formatTokensTotal: formatTokensTotal,
    formatTokensCause: formatTokensCause
  };
});
