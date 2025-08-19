// content.js — MV3 (Firefox/Firefox Nightly/Chrome) — run_at: document_idle
(() => {
  // Top frame only + single instance
  if (window !== window.top) return;
  if (window.__FFO_CONTENT_ACTIVE__) return;
  window.__FFO_CONTENT_ACTIVE__ = true;

  const API_BASE = "http://127.0.0.1:5001";
  const POST_URL = `${API_BASE}/draft-event`;
  const LOG = "[ffo]";
  const BID_SCAN_MS = 500;
  const ROSTER_SCAN_MS = 2000;
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
    return String(s || "")
      .replace(/\(([^)]*)\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Remove trailing injury/status suffixes: "DTD", "PUP", "IR", "OUT", etc.
  const STATUS_RE = /\s*(?:DTD|PUP|IR|OUT|Q|O|D|NA|DNP|SUSP|NFI|PPD|COVID(?:-19)?|RES)\.?$/i;
  function stripStatus(name) {
    return String(name || "").replace(STATUS_RE, "").trim();
  }

  // ====================================================
  //                 LIVE BID (stable)
  // ====================================================

  function* priceElements() {
    const nodes = document.querySelectorAll("span,div,strong,b,h1,h2,h3");
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = el.innerText || "";
      if (/\$\s*\d/.test(t)) yield el;
    }
  }

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
    const v1 = findSplitDollarNumber(card);
    if (v1 != null) return v1;
    const v2 = findSingleDollarNumber(card);
    if (v2 != null) return v2;

    // last resort, but still guarded to $NN shape
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

  function extractNameFromCard(card) {
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
      const t = stripStatus(clean(explicit.textContent || ""));
      if (t && t.length >= 3) return t;
    }

    const lines = (card.innerText || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const posIdx = lines.findIndex((L) => isPosText(L));
    if (posIdx > 0) {
      const guess = stripStatus(clean(lines[posIdx - 1]));
      if (guess && guess.length >= 3) return guess;
    }

    // fallback: longest title-cased line
    let best = "";
    for (const L of lines) {
      if (/^[A-Z][A-Za-z0-9 .'\-]{2,}$/.test(L) && L.length > best.length) best = L;
    }
    return stripStatus(clean(best));
  }

  function extractActiveBidOnce() {
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

      const score = 1000 - (card.innerText || "").length;
      if (!best || score > best.score) best = { name, price, score };
    }
    return best;
  }

  const bidState = { lastName: null, lastPrice: null };

  function bidTick() {
    try {
      const hit = extractActiveBidOnce();
      if (!hit) return;
      if (hit.name === bidState.lastName && hit.price === bidState.lastPrice) return;

      bidState.lastName = hit.name;
      bidState.lastPrice = hit.price;

      info("bid_update", { name: hit.name, price: hit.price });
      postDraftEvent({ type: "bid_update", player_name: hit.name, bid: hit.price });
    } catch (e) {
      warn("tick error", e);
    }
  }

  setInterval(bidTick, BID_SCAN_MS);
  info("content.js ready on", location.href);

  // ====================================================
  //                 ROSTER SYNC (table)
  // ====================================================

  // Find the "My Team" table panel (headers: Pos | Player | Salary)
  function findRosterPanel() {
    const candidates = [];
    document.querySelectorAll("aside,section,div").forEach((el) => {
      if (!isVisible(el)) return;
      const t = el.innerText || "";
      if (!t) return;
      if (/\bPos\b/i.test(t) && /\bPlayer\b/i.test(t) && /\bSalary\b/i.test(t)) {
        const posHits = (t.match(/\b(QB|RB|WR|TE|K|DST|DEF|W\/R\/T)\b/g) || []).length;
        if (posHits >= 2) candidates.push(el);
      }
    });
    if (!candidates.length) return null;
    // prefer right-side panel (largest x)
    candidates.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return candidates[candidates.length - 1];
  }

  // Given a player <a>, climb to its "row"
  function rowForPlayerAnchor(a) {
    let cur = a;
    for (let i = 0; i < 8 && cur; i++, cur = cur.parentElement) {
      if (!(cur instanceof Element)) break;
      const t = cur.innerText || "";
      if (/\b(QB|RB|WR|TE|K|DST|DEF|W\/R\/T)\b/i.test(t) && (/\$/.test(t) || /\bSalary\b/i.test(t))) {
        return cur;
      }
    }
    return a.parentElement;
  }

  function extractRowSalary(row) {
    if (!row) return null;

    // "$17" in one node
    const nodes = row.querySelectorAll("span,div,strong,b");
    let best = null;
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const v = (el.innerText || "").match(/^\s*\$\s*(\d{1,3})\s*$/);
      if (v) {
        const n = parseInt(v[1], 10);
        if (Number.isFinite(n) && n <= MAX_PRICE) best = Math.max(best ?? -1, n);
      }
    }
    if (best != null) return best;

    // "$" and "17" in adjacent nodes
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

    // fallback
    const m = (row.innerText || "").match(/\$\s*(\d{1,3})\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n <= MAX_PRICE) return n;
    }
    return null;
  }

  // "J. Goff Det - QB" → "J. Goff"
  function normalizePlayerCell(text) {
    let s = clean(text);
    s = s.replace(/\s*[–-]\s*(QB|RB|WR|TE|K|DST|DEF)\b.*$/i, "");            // cut " - POS"
    s = s.replace(/([A-Za-z.'-]{2,})(?:[A-Z]{2,3}|[A-Z][a-z]{2})$/, "$1");   // glued team suffix
    s = s.replace(/\s+(?:[A-Z]{2,3}|[A-Z][a-z]{2})$/, "");                   // spaced team suffix
    s = stripStatus(s);                                                      // injury/status suffix
    return clean(s);
  }

  function extractRoster(panel) {
    const names = [];
    const costs = {};

    const anchors = panel.querySelectorAll('a[href*="/nfl/player"], a[href*="/nfl/players"]');
    if (anchors.length) {
      anchors.forEach((a) => {
        const raw = clean(a.textContent || "");
        if (!raw) return;
        const name = normalizePlayerCell(raw);
        const row = rowForPlayerAnchor(a);
        const price = extractRowSalary(row);
        if (name) {
          names.push(name);
          if (price != null) costs[name] = price;
        }
      });
    } else {
      // Fallback: parse text lines
      const lines = (panel.innerText || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
      for (const L of lines) {
        const m =
          L.match(/^(?:QB|RB|WR|TE|K|DST|DEF|W\/R\/T)\s+(.+?)\s*[–-]\s*(QB|RB|WR|TE|K|DST|DEF)\b/i) ||
          L.match(/^(.+?)\s*[–-]\s*(QB|RB|WR|TE|K|DST|DEF)\b/i);
        if (m) {
          const name = normalizePlayerCell(m[1]);
          if (name) names.push(name);
        }
      }
    }

    const uniq = Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
    return { names: uniq, costs };
  }

  const rosterState = { lastSig: "" };

  function rosterTick() {
    try {
      const panel = findRosterPanel();
      if (!panel) return;

      const { names, costs } = extractRoster(panel);
      const sig = JSON.stringify({ names, costs });
      if (sig === rosterState.lastSig) return;
      rosterState.lastSig = sig;

      info("roster", names);
      if (Object.keys(costs).length) info("roster_costs", costs);
      postDraftEvent({ type: "roster", names, costs });
    } catch (e) {
      // stay quiet; try again next tick
    }
  }

  setInterval(rosterTick, ROSTER_SCAN_MS);

  // Manual tests:
  // window.__ffo_testBid("Zay FlowersDTD", 12)
  // window.__ffo_testRoster(["J. Goff Det - QB", "Zay FlowersDTD"])
  window.__ffo_testBid = (name, price) => {
    postDraftEvent({ type: "bid_update", player_name: String(name || ""), bid: Number(price || 0) });
    info("test bid_update posted", name, price);
  };
  window.__ffo_testRoster = (names) => {
    const arr = Array.isArray(names) ? names : [];
    postDraftEvent({ type: "roster", names: arr });
    info("test roster posted", arr);
  };
})();
