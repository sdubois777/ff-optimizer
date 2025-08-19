// src/api.ts
import * as XLSX from "xlsx";
import type { PlayerRow, Solution } from "./types";

const API_BASE =
  (import.meta as any)?.env?.VITE_API_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:5001";

const NUM = (v: any) => {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

const u = (s: any) => String(s ?? "").trim();
const U = (s: any) => u(s).toUpperCase();

function normalizePos(v: any): string {
  const s = U(v);
  if (s === "DST" || s === "DEF" || s === "D/ST" || s === "D-ST") return "DST";
  return s;
}

type DetectMap = {
  name?: string;
  pos?: string;      // header key for position, if present
  price?: string;
  proj?: string;
};

const POS_SET = new Set(["QB", "RB", "WR", "TE", "K", "DST", "DEF", "D/ST", "D-ST"]);

// Try to pull Pos (and clean name) from a "Name (TEAM - POS)" style field
function extractPosFromName(fullName: string): { cleanName: string; pos?: string } {
  let name = u(fullName);
  let pos: string | undefined;

  // Look inside parentheses e.g. "(BAL - QB)" or "(CIN WR)"
  const paren = name.match(/\(([^)]*)\)/);
  if (paren) {
    const inside = U(paren[1]);
    const tokens = inside.split(/[^\w/]+/);
    const hit = tokens.find((t) => POS_SET.has(t));
    if (hit) pos = normalizePos(hit);
    // strip the whole "(...)" from the name
    name = name.replace(/\s*\([^)]*\)\s*/g, "").trim();
  }

  // Fallback: trailing dash form e.g. " - QB" / "– WR" / "— TE"
  if (!pos) {
    const dash = name.match(/[-–—]\s*(QB|RB|WR|TE|K|DST|DEF|D\/ST|D-ST)\s*$/i);
    if (dash) {
      pos = normalizePos(dash[1]);
      name = name.replace(/[-–—]\s*(QB|RB|WR|TE|K|DST|DEF|D\/ST|D-ST)\s*$/i, "").trim();
    }
  }

  return { cleanName: name, pos };
}

function detectColumns(rows: any[]): DetectMap {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const H = headers.map((h) => [h, h.toLowerCase()] as const);

  const hasHeader = (re: RegExp) => H.find(([, low]) => re.test(low))?.[0];

  const map: DetectMap = {};

  // Header matches first
  map.name = hasHeader(/\b(name|player|full\s*name)\b/);
  map.pos = hasHeader(/\b(pos|position)\b/);
  map.price = hasHeader(/\b(price|cost|salary|\$|bid)\b/);
  map.proj = hasHeader(/\b(projection|proj|points|fp|fpts|ppg|fantasy)\b/);

  // Gather column stats
  const stats = headers.map((h) => {
    const texts = rows.map((r) => u(r[h]));
    const nums = rows.map((r) => NUM(r[h]));
    const numCount = nums.filter((n) => Number.isFinite(n)).length;
    const isMostlyNumeric = numCount >= rows.length * 0.8;
    const posHits = texts.filter((t) => POS_SET.has(U(t))).length;
    return {
      h,
      posHits,
      isMostlyNumeric,
      max: Math.max(...nums),
      mean:
        numCount > 0
          ? nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / numCount
          : 0,
      intShare:
        rows.filter((r) => {
          const n = NUM(r[h]);
          return Math.abs(n - Math.round(n)) < 0.001;
        }).length / Math.max(1, rows.length),
    };
  });

  // If no pos header, try value-based — but only if we actually see POS tokens.
  if (!map.pos) {
    const withHits = stats
      .filter((s) => s.posHits > 0 && !s.isMostlyNumeric)
      .sort((a, b) => b.posHits - a.posHits);
    map.pos = withHits[0]?.h; // may remain undefined
  }

  // Price/projection heuristics (only among numeric-heavy columns)
  const numericCols = stats.filter((s) => s.isMostlyNumeric);

  if (!map.price) {
    const priceCand = [...numericCols]
      .sort((a, b) => {
        // price tends to have higher max and be more integer-like
        const as = (a.max >= 50 ? 1 : 0) + a.intShare;
        const bs = (b.max >= 50 ? 1 : 0) + b.intShare;
        return bs - as;
      })[0]?.h;
    if (priceCand) map.price = priceCand;
  }

  if (!map.proj) {
    const projCand = [...numericCols]
      .sort((a, b) => {
        // projections sit in a moderate range; not necessarily integers
        const as = (a.mean >= 1 && a.mean <= 60 ? 1 : 0) + (a.max <= 250 ? 0.3 : 0);
        const bs = (b.mean >= 1 && b.mean <= 60 ? 1 : 0) + (b.max <= 250 ? 0.3 : 0);
        return bs - as;
      })[0]?.h;
    if (projCand && projCand !== map.price) map.proj = projCand;
  }

  // Final guard: if pos column is numeric for most rows, treat as "no pos column"
  if (map.pos) {
    const ps = stats.find((s) => s.h === map.pos);
    if (ps?.isMostlyNumeric) {
      map.pos = undefined;
    }
  }

  return map;
}

/**
 * Parse CSV/XLS/XLSX in the browser.
 * - Detects columns robustly
 * - If no Pos column, extracts Pos from Name and cleans "(TEAM - POS)" off the Name
 */
export async function parseSheet(
  file: File,
  options?: { debug?: boolean }
): Promise<PlayerRow[]> {
  const debug = !!options?.debug;
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  // choose first non-empty sheet
  let ws = wb.Sheets[wb.SheetNames[0]];
  let chosen = wb.SheetNames[0];
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    const rowsTry: any[] = XLSX.utils.sheet_to_json(sh, { defval: "" });
    if (rowsTry.length > 0) {
      ws = sh;
      chosen = name;
      break;
    }
  }

  const rowsRaw: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (debug) {
    console.log("[api.parseSheet] sheet:", chosen, "rows:", rowsRaw.length);
    console.log("[api.parseSheet] headers:", Object.keys(rowsRaw[0] || {}));
  }
  if (rowsRaw.length === 0) return [];

  const mapping = detectColumns(rowsRaw);
  if (debug) console.log("[api.parseSheet] mapping:", mapping);

  const { name, pos, price, proj } = mapping;
  // require at least name/price/proj; pos can be derived from name
  if (!name || !price || !proj) {
    if (debug) {
      console.warn("[api.parseSheet] need at least Name, Price, and Projection columns");
    }
    return [];
  }

  const out: PlayerRow[] = rowsRaw
    .map((r) => {
      const fullName = u(r[name]);
      if (!fullName) return null;

      const priceVal = NUM(r[price]);
      const projVal = NUM(r[proj]);

      // Pos: header if valid, else extract from the name
      let posVal = pos ? normalizePos(r[pos]) : "";
      const { cleanName, pos: fromName } = extractPosFromName(fullName);

      if (!posVal && fromName) posVal = fromName;
      posVal = normalizePos(posVal);

      return {
        Name: cleanName,           // cleaned (no "(TEAM - POS)")
        Pos: posVal,               // real position
        Price: priceVal,
        Projection: projVal,
        anchor: false,
        exclude: false,
      } as PlayerRow;
    })
    .filter((r): r is PlayerRow => !!r && !!r.Name && !!r.Pos);

  if (debug) console.log("[api.parseSheet] produced players:", out.length);
  return out;
}

/** Call backend optimizer */
export async function optimize(
  rows: PlayerRow[],
  budget: number,
  k: number,
  signal?: AbortSignal
): Promise<Solution[]> {
  const res = await fetch(`${API_BASE}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    mode: "cors",
    signal,
    body: JSON.stringify({ rows, budget, k }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Optimize failed (${res.status}): ${text || res.statusText}`);
  }
  const data = await res.json();
  return data?.solutions ?? [];
}
