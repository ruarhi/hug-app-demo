/* Frosted bars (owner spec 2026-10-10).
   The header (.top) and the bottom nav frost only while content is actually under them:
     .is-under-top     the screen's .content is scrolled away from the top (scrollTop > 0)
     .is-under-bottom  there is more content below (scrollTop + clientHeight < scrollHeight - 1)
   styles.css draws both states and fades the hairline. Only screens whose CSS sets
   --frosted-bars: 1 take part; on the rest the classes are never set.
   Inner lists: home and account do not scroll as a page; their lists (.leader-list,
   .history-list) scroll inside windows that run on under the nav (styles.css, "inner lists").
   A bar frosts while rows of such a list sit in the part of it that is both on screen and
   behind that bar; the nav only once the list is scrolled from its top (see innerUnder).
   Padding is not a row: a list scrolled to its end leaves the nav white.
   The list's own head (.leader-head / .history-head) gets .is-under while the list is
   scrolled away from its top.
   Passive by design: it updates on scroll (passive listeners), on resize, when a screen
   becomes .active, and when the content changes size. No per-frame loop. Not a scroll-driven
   animation either: iOS WebKit does not run those reliably. */
(function frostedBars() {
  "use strict";

  var INNER = ".leader-list, .history-list";
  var tracked = [];   // [{ screen, content, inner, bar, nav, on, outer }]
  var pending = null; // tracked entries waiting for the next frame

  function takesPart(screen) {
    return getComputedStyle(screen).getPropertyValue("--frosted-bars").trim() === "1";
  }

  // The page itself only counts if it really scrolls (home and account clip, they never did).
  function scrolls(el) {
    return /^(auto|scroll)$/.test(getComputedStyle(el).overflowY);
  }

  // Which bars an inner list has rows behind: { top, bottom }. Works in screen px, then turns
  // the covered strip into the list's scroll coordinates (the .phone may be scaled by --fit).
  // Your own row (.leader-row.is-me) is a solid pink-to-purple pill. Under the glass it reads
  // as a pink blur in the bar (owner, 2026-10-17: "the highlighted me tab shows up in the frosted
  // glass bottom"). So a bar with that row behind it stays white instead, from a little before
  // the row reaches it (LEAD px, screen) so none of it shows while the bar turns.
  var ME = ".leader-row.is-me", LEAD = 28;
  function meIn(list, y0, y1) {
    var rows = list.querySelectorAll(ME);
    for (var i = 0; i < rows.length; i++) {
      var q = rows[i].getBoundingClientRect();
      if (q.height && q.bottom > y0 - LEAD && q.top < y1 + LEAD) return true;
    }
    return false;
  }

  function innerUnder(entry, list) {
    var out = { top: false, bottom: false, meTop: false, meBottom: false, meHead: false };
    if (!list.offsetHeight || !list.clientHeight) return out;   // not laid out (hidden)
    var r = list.getBoundingClientRect();
    var scale = r.height / list.offsetHeight || 1;
    var cs = getComputedStyle(list);
    var rowsFrom = parseFloat(cs.paddingTop) || 0;                       // scroll coords
    var rowsTo = list.scrollHeight - (parseFloat(cs.paddingBottom) || 0);
    var cr = entry.content.getBoundingClientRect();
    var seenTop = Math.max(r.top, cr.top);                               // .content clips the top
    var toScroll = function (y) { return list.scrollTop + (y - r.top) / scale; };
    var rows = function (y0, y1) {                                       // any row in [y0, y1] px?
      if (y1 - y0 < 1) return false;
      return rowsTo > toScroll(y0) + 1 && rowsFrom < toScroll(y1) - 1;
    };
    if (entry.bar) {
      var b = entry.bar.getBoundingClientRect();
      out.top = rows(Math.max(seenTop, b.top), Math.min(r.bottom, b.bottom));
      out.meTop = out.top && meIn(list, Math.max(seenTop, b.top), Math.min(r.bottom, b.bottom));
    }
    // The nav waits until the list has moved (owner, 2026-10-17). At its top, the rows behind
    // the nav are only the list running on, and frosting over them showed the gradient "you"
    // row as a pink blur ("a faded/gradient pill box"), fading in each time home arrived. At
    // scroll 0 the nav stays white, as it was before the windows ran on under it.
    if (entry.nav && list.scrollTop > 0) {
      var n = entry.nav.getBoundingClientRect();
      out.bottom = rows(Math.max(seenTop, n.top), Math.min(r.bottom, n.bottom));
      out.meBottom = out.bottom && meIn(list, Math.max(seenTop, n.top), Math.min(r.bottom, n.bottom));
    }
    // The list's own head is glass too while the list is scrolled (below): same rule.
    var box = list.closest(".leaderboard, .history-wrap");
    var head = box && box.querySelector(".leader-head, .history-head");
    if (head && list.scrollTop > 0) {
      var h = head.getBoundingClientRect();
      out.meHead = meIn(list, h.top, h.bottom);
    }
    return out;
  }

  function update(entry) {
    var c = entry.content;
    var top = false;
    var bottom = false;
    var meTop = false, meBottom = false, meHead = [];
    if (entry.on) {
      if (entry.outer) {
        top = c.scrollTop > 0;
        bottom = c.scrollTop + c.clientHeight < c.scrollHeight - 1;
      }
      entry.inner.forEach(function (list, i) {
        var u = innerUnder(entry, list);
        top = top || u.top;
        bottom = bottom || u.bottom;
        meTop = meTop || u.meTop;
        meBottom = meBottom || u.meBottom;
        meHead[i] = u.meHead;
      });
    }
    // Each inner list's own head ("LEADERBOARD +", "HISTORY +") is a bar too: frosted while
    // the list is scrolled away from its top (owner, 2026-10-10). app.js builds the heads after
    // this file runs, so they are looked up here, not at init.
    entry.inner.forEach(function (list, i) {
      var box = list.closest(".leaderboard, .history-wrap");
      var head = box && box.querySelector(".leader-head, .history-head");
      if (head) {
        head.classList.toggle("is-under", entry.on && list.scrollTop > 0 && !meHead[i]);
        head.classList.toggle("me-under", !!meHead[i]);
      }
    });
    entry.screen.classList.toggle("is-under-top", top && !meTop);
    entry.screen.classList.toggle("is-under-bottom", bottom && !meBottom);
    // Turning white for your row is instant (styles.css .me-under-*); back to glass fades.
    entry.screen.classList.toggle("me-under-top", meTop);
    entry.screen.classList.toggle("me-under-bottom", meBottom);
  }

  // Coalesce bursts (a fling fires many scroll events) into one read per frame.
  function schedule(entry) {
    if (pending) { if (pending.indexOf(entry) < 0) pending.push(entry); return; }
    pending = [entry];
    requestAnimationFrame(function () {
      var list = pending;
      pending = null;
      list.forEach(update);
    });
  }

  function refreshAll() {
    tracked.forEach(function (entry) {
      entry.on = takesPart(entry.screen);
      entry.outer = scrolls(entry.content);
      schedule(entry);
    });
  }

  function init() {
    var screens = document.querySelectorAll(".screen");
    var resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(function (records) {
          records.forEach(function (r) {
            var entry = r.target.__hugFrost;
            if (entry) schedule(entry);
          });
        })
      : null;

    Array.prototype.forEach.call(screens, function (screen) {
      var content = screen.querySelector(":scope > .content");
      if (!content) return;
      var entry = {
        screen: screen, content: content,
        inner: Array.prototype.slice.call(content.querySelectorAll(INNER)),
        bar: screen.querySelector(":scope > .top"),
        nav: screen.querySelector(":scope > .bottom-nav"),
        on: takesPart(screen), outer: scrolls(content)
      };
      tracked.push(entry);

      content.addEventListener("scroll", function () { schedule(entry); }, { passive: true });

      // Inner lists: their own scroll, rows arriving or being filtered (no resize, but the
      // scroll height changes), and the + expand, which slides the rail by a transform.
      entry.inner.forEach(function (list) {
        list.addEventListener("scroll", function () { schedule(entry); }, { passive: true });
        new MutationObserver(function () { schedule(entry); }).observe(list, { childList: true });
      });
      if (entry.inner.length) {
        screen.addEventListener("transitionend", function () { schedule(entry); }, { passive: true });
      }

      // A screen coming forward may have been scrolled, resized or refilled while hidden.
      // Only the step to .active matters (this also ignores our own class toggles).
      var wasActive = screen.classList.contains("active");
      new MutationObserver(function () {
        var active = screen.classList.contains("active");
        if (active && !wasActive) schedule(entry);
        wasActive = active;
      }).observe(screen, { attributes: true, attributeFilter: ["class"] });

      // Content that grows or shrinks without a scroll (a list arriving, a box expanding)
      // changes whether anything is left below the nav.
      if (resizeObserver) {
        content.__hugFrost = entry;
        resizeObserver.observe(content);
        Array.prototype.forEach.call(content.children, function (child) {
          child.__hugFrost = entry;
          resizeObserver.observe(child);
        });
        entry.inner.forEach(function (list) {
          list.__hugFrost = entry;
          resizeObserver.observe(list);
        });
      }

      update(entry);
    });

    window.addEventListener("resize", refreshAll, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
