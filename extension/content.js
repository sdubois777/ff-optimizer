// content.js — MV3 (Firefox/Chrome) — run_at: document_idle
(() => {
  // top frame only + single instance
  if (window !== window.top) return;
  if (window.__FFO_CONTENT_ACTIVE__) return;
  window.__FFO_CONTENT_ACTIVE__ = true;

  const API_BASE = "http://127.0.0.1:5001";
  const POST_URL = `${API_BASE}/draft-event`;
  const LOG = "[ffo]";
  const SCAN_MS = 500;
  const MAX_PRICE = 300;

  const info = (...a) => console.log(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  function postDraftEvent(payload) {
    return fetch(POST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      mode: "cors",
      body: JSON.stringify(payload),
    }).catch((e) => warn("post failed", e));
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  }

  function clean(s) {
    return String(s || "").replace(/\(([^)]*)\)/g, " ").replace(/\s+/g, " ").trim();
  }

  // ---------- Find the active "card" ----------
  // Heuristic: a compact ancestor that includes a POS token (QB/RB/WR/TE/K/DST)
  // and a "Remaining" timer (seen on the live nomination widget)
  function isPosText(t) {
    return /\b(QB|RB|WR|TE|K|DST)\b/i.test(t);
  }
  function hasRemaining(t) {
    return /\bRemaining\b/i.test(t);
  }

  function closestActiveCardFrom(el) {
    let cur = el;
    for (let d = 0; d < 8 && cur; d++, cur = cur.parentElement) {
      if (!(cur instanceof Element)) break;
      const txt = cur.innerText || "";
      if (isPosText(txt) && hasRemaining(txt)) return cur;
    }
    return null;
  }

  // ---------- Price extraction ----------
  function getNumber(text) {
    const m = String(text || "").match(/^\s*(\d{1,3})\s*$/);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    return Number.isFinite(v) && v <= MAX_PRICE ? v : null;
  }

  function getDollarNumber(text) {
    const m = String(text || "").match(/^\s*\$\s*(\d{1,3})\s*$/);
    if (!m) return null;
    const v = parseInt(m[1], 10);
    return Number.isFinite(v) && v <= MAX_PRICE ? v : null;
    }

  // price is often split into two siblings: "$" + "17"
  function findSplitDollarNumber(container) {
    const nodes = container.querySelectorAll("span,div,strong,b");
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = el.textContent || "";
      if (/^\s*\$\s*$/.test(t)) {
        const next = el.nextElementSibling;
        const prev = el.previousElementSibling;
        const n1 = next && isVisible(next) ? getNumber(next.textContent || "") : null;
        const n2 = prev && isVisible(prev) ? getNumber(prev.textContent || "") : null;
        const v = n1 ?? n2;
        if (v != null) return v;
      }
    }
    return null;
  }

  // also handle a single element that already contains "$17"
  function findSingleDollarNumber(container) {
    const nodes = container.querySelectorAll("span,div,strong,b,h1,h2,h3");
    let best = null;
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const v = getDollarNumber(el.innerText || "");
      if (v != null) best = Math.max(best ?? -1, v);
    }
    return best;
  }

  function extractPriceFromCard(card) {
    // 1) split form: "$" + "17"
    const v1 = findSplitDollarNumber(card);
    if (v1 != null) return v1;

    // 2) single element "$17"
    const v2 = findSingleDollarNumber(card);
    if (v2 != null) return v2;

    // 3) last resort: a short line with "$NN" in the card, ignoring other numbers
    const lines = (card.innerText || "").split(/\n+/).map((s) => s.trim());
    for (const L of lines) {
      const m = L.match(/\$\s*(\d{1,3})\b/);
      if (m) {
        const v = parseInt(m[1], 10);
        if (Number.isFinite(v) && v <= MAX_PRICE) return v;
      }
    }
    return null;
  }

  // ---------- Name extraction ----------
  function extractNameFromCard(card) {
    // Prefer explicit player-name nodes
    const nameSel = [
      '[data-test*="player-name" i]',
      '[data-testid*="player-name" i]',
      'a[href*="/nfl/player"]',
      'a[href*="/nfl/players"]',
      ".player-name",
      ".PlayerName",
      "h1,h2,h3",
    ].join(",");
    const explicit = card.querySelector(nameSel);
    if (explicit && isVisible(explicit)) {
      const t = clean(explicit.textContent || "");
      if (t && t.length >= 3) return t;
    }

    // Otherwise: the line immediately above the POS line
    const lines = (card.innerText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const posIdx = lines.findIndex((L) => isPosText(L));
    if (posIdx > 0) {
      const guess = clean(lines[posIdx - 1]);
      if (guess && guess.length >= 3) return guess;
    }

    // Fallback: longest Title-cased line
    let best = "";
    for (const L of lines) {
      if (/^[A-Z][A-Za-z0-9 .'\-]{2,}$/.test(L) && L.length > best.length) best = L;
    }
    return clean(best);
  }

  // ---------- Scan loop ----------
  const state = { lastName: null, lastPrice: null };

  function extractActiveBidOnce() {
    // Start from any element that shows a "$" (the big price digits are near it),
    // then climb to the card that also has POS + Remaining.
    const dollarElems = document.querySelectorAll("span,div,strong,b,h1,h2,h3");
    let best = null;

    for (const el of dollarElems) {
      if (!isVisible(el)) continue;
      const txt = el.textContent || "";
      if (!/\$/.test(txt)) continue;

      const card = closestActiveCardFrom(el);
      if (!card || !isVisible(card)) continue;

      const price = extractPriceFromCard(card);
      if (price == null) continue;

      const name = extractNameFromCard(card);
      if (!name || name.length < 3) continue;

      // prefer tighter cards (shorter innerText)
      const score = 1000 - (card.innerText || "").length;
      if (!best || score > best.score) best = { name, price, score };
    }
    return best;
  }

  function tick() {
    try {
      const hit = extractActiveBidOnce();
      if (!hit) return;
      if (hit.name === state.lastName && hit.price === state.lastPrice) return;

      state.lastName = hit.name;
      state.lastPrice = hit.price;

      info("bid_update", { name: hit.name, price: hit.price });
      postDraftEvent({ type: "bid_update", player_name: hit.name, bid: hit.price });
    } catch (e) {
      warn("tick error", e);
    }
  }

  setInterval(tick, SCAN_MS);
  info("content.js ready on", location.href);

  // manual sanity test:
  // window.__ffo_testBid("Jaylen Waddle", 17)
  window.__ffo_testBid = (name, price) => {
    postDraftEvent({ type: "bid_update", player_name: String(name || ""), bid: Number(price || 0) });
    info("test bid_update posted", name, price);
  };
})();
