/**
 * HalaTheme — shared theme resolver & apply API (PR2)
 * Storage keys written ONLY on explicit user action (never on load).
 * Shell identity: html[data-shell] only (marketing | product).
 */
(function (global) {
  "use strict";

  var THEME_KEY = "hala_theme";
  var REDUCE_KEY = "hala_reduce_motion";
  var ANIM_CLASS = "theme-animating";
  var ANIM_MS = 500;

  var systemMql = null;
  var systemHandler = null;

  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      /* ignore quota / private mode */
    }
  }

  function getShell() {
    return document.documentElement.getAttribute("data-shell") || "product";
  }

  function surfaceDefault() {
    return getShell() === "marketing" ? "dark" : "light";
  }

  /** light | dark | system | null if absent / invalid */
  function getPreferred() {
    var pref = safeGet(THEME_KEY);
    if (pref === "light" || pref === "dark" || pref === "system") return pref;
    return null;
  }

  function systemResolved() {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  /**
   * Resolve concrete light|dark from preference or surface default.
   * Never writes localStorage.
   */
  function resolve(theme) {
    var pref = theme !== undefined && theme !== null ? theme : getPreferred();
    if (pref === "light" || pref === "dark") return pref;
    if (pref === "system") return systemResolved();
    return surfaceDefault();
  }

  function syncLandingDark(resolved) {
    var shell = getShell();
    var isMarketing = shell === "marketing";
    if (document.body) {
      document.body.classList.toggle("landing-dark", isMarketing);
    }
  }

  function apply(theme, options) {
    options = options || {};
    var persist = !!options.persist;
    var animate = !!options.animate;
    var root = document.documentElement;

    // theme may be light|dark|system; resolve to concrete
    var preferred =
      theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : getPreferred() || surfaceDefault();
    var resolved = resolve(preferred);

    if (animate) {
      root.classList.add(ANIM_CLASS);
      setTimeout(function () {
        root.classList.remove(ANIM_CLASS);
      }, ANIM_MS);
    }

    root.setAttribute("data-theme", resolved);
    root.classList.toggle("dark", resolved === "dark");
    syncLandingDark(resolved);

    if (persist) {
      safeSet(THEME_KEY, preferred);
    }

    ensureSystemSubscription();
    syncControls();
    return resolved;
  }

  function getReduceMotionPreferred() {
    var raw = safeGet(REDUCE_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null; // absent → OS
  }

  function resolveReduceMotion() {
    var pref = getReduceMotionPreferred();
    if (pref !== null) return pref;
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setReduceMotion(on, options) {
    options = options || {};
    var persist = !!options.persist;
    document.documentElement.setAttribute("data-reduce-motion", on ? "1" : "0");
    if (persist) {
      safeSet(REDUCE_KEY, on ? "1" : "0");
    }
    syncControls();
  }

  function subscribeSystem(handler) {
    if (typeof handler !== "function") return function () {};
    if (!systemMql) {
      systemMql = matchMedia("(prefers-color-scheme: dark)");
    }
    var listener = function () {
      if (getPreferred() === "system") {
        handler(systemResolved());
      }
    };
    if (systemMql.addEventListener) {
      systemMql.addEventListener("change", listener);
    } else if (systemMql.addListener) {
      systemMql.addListener(listener);
    }
    return function unsubscribe() {
      if (systemMql.removeEventListener) {
        systemMql.removeEventListener("change", listener);
      } else if (systemMql.removeListener) {
        systemMql.removeListener(listener);
      }
    };
  }

  function ensureSystemSubscription() {
    if (systemHandler) return;
    systemHandler = subscribeSystem(function () {
      apply("system", { persist: false, animate: false });
    });
  }

  function syncControls() {
    var pref = getPreferred();
    var selectValue = pref || "system";
    // When key absent, show surface-aware default in UI as the resolved surface
    // but design wants tri-state light|dark|system. Absent → treat display as
    // the surface default is not "system"; keep select at system only if stored.
    // For absent key, leave select on surface default so UI matches resolve() without implying system.
    if (pref === null) {
      selectValue = surfaceDefault();
    }

    document.querySelectorAll("[data-hala-theme-select]").forEach(function (el) {
      if (el.value !== selectValue) el.value = selectValue;
    });

    var reduce = resolveReduceMotion();
    document.querySelectorAll("[data-hala-reduce-motion]").forEach(function (el) {
      if (el.type === "checkbox") {
        el.checked = reduce;
      }
    });
  }

  function wireControls(root) {
    root = root || document;
    root.querySelectorAll("[data-hala-theme-select]").forEach(function (el) {
      if (el._halaThemeWired) return;
      el._halaThemeWired = true;
      el.addEventListener("change", function () {
        var value = el.value;
        if (value !== "light" && value !== "dark" && value !== "system") return;
        apply(value, { persist: true, animate: true });
      });
    });
    root.querySelectorAll("[data-hala-reduce-motion]").forEach(function (el) {
      if (el._halaMotionWired) return;
      el._halaMotionWired = true;
      el.addEventListener("change", function () {
        setReduceMotion(!!el.checked, { persist: true });
      });
    });
    syncControls();
  }

  function debugDump() {
    try {
      var params = new URLSearchParams(location.search);
      var debug =
        params.get("hala_debug_theme") === "1" || safeGet("hala_debug_theme") === "1";
      if (!debug) return;
      console.info("[HalaTheme]", {
        pref: getPreferred(),
        resolved: resolve(),
        shell: getShell(),
        reduceMotion: resolveReduceMotion()
      });
    } catch (e) {
      /* ignore */
    }
  }

  var HalaTheme = {
    getShell: getShell,
    getPreferred: getPreferred,
    resolve: resolve,
    syncLandingDark: syncLandingDark,
    apply: apply,
    setReduceMotion: setReduceMotion,
    subscribeSystem: subscribeSystem,
    wireControls: wireControls,
    resolveReduceMotion: resolveReduceMotion
  };

  global.HalaTheme = HalaTheme;

  // Keep OS listener live when preferred === system
  ensureSystemSubscription();

  // Mirror landing-dark if body already present (FOUC may have scheduled DOMContentLoaded)
  if (document.body) {
    syncLandingDark(resolve());
  } else {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        syncLandingDark(resolve());
      },
      { once: true }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      wireControls();
      debugDump();
    });
  } else {
    wireControls();
    debugDump();
  }
})(typeof window !== "undefined" ? window : this);
