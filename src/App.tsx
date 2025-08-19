import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { io, Socket } from "socket.io-client";

import PlayersTable from "./components/PlayersTable";
import ResultsView from "./components/ResultsView";
import FilterBar from "./components/FilterBar";
import { parseSheet, optimize } from "./api";
import type { PlayerRow, Solution } from "./types";

/* =======================
   Helpers (matching/sort)
   ======================= */

type ViewRow = PlayerRow & { __idx: number };
type SortKey = "Name" | "Pos" | "Price" | "Projection" | "anchor" | "exclude";
type SortDir = "asc" | "desc";

const SOCKET_URL =
  (import.meta as any)?.env?.VITE_API_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:5001";

const AUTO_OPT_DEBOUNCE_MS = 600;
const DEBUG_ROSTER = false;

// Normalize: lower, drop (TEAM - POS), keep word chars/space/.'-
const normBase = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, " ")
    .replace(/[^a-z0-9 '.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Strip suffixes anywhere
const stripSuffixes = (s: string) =>
  s.replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/gi, "").trim();

type NameParts = {
  first: string;
  last: string;
  firstInitial: string;
  first2: string;
  keyFull: string;
};

function alphaInitial(str: string): string {
  const m = String(str || "").match(/[a-z]/i);
  return m ? m[0].toLowerCase() : "";
}
function cleanToken(t: string): string {
  return String(t || "").replace(/\.+$/g, "");
}
function partsFrom(raw: string): NameParts {
  const t = stripSuffixes(normBase(raw));
  const tokens = t.split(" ").filter(Boolean);
  const firstTok = cleanToken(tokens[0] ?? "");
  const lastTok = tokens.length > 1 ? tokens[tokens.length - 1] : "";
  const first = firstTok;
  const last = lastTok;
  const firstInitial = alphaInitial(firstTok);
  const first2 = firstTok.replace(/[^a-z]/g, "").slice(0, 2);
  const keyFull = first && last ? `${first} ${last}` : "";
  return { first, last, firstInitial, first2, keyFull };
}

/** Looser matcher used for bid/sold-only updates (ok to guess a bit). */
function looseIndexByName(list: PlayerRow[], incoming: string): number {
  const q = partsFrom(incoming);

  // exact full "first last"
  if (q.keyFull) {
    const exact = list.findIndex((r) => partsFrom(r.Name).keyFull === q.keyFull);
    if (exact !== -1) return exact;
  }

  // last + first initial (handles "B. Thomas" vs "Brian Thomas")
  for (let i = 0; i < list.length; i++) {
    const p = partsFrom(list[i].Name);
    if (!p.last || !q.last) continue;
    if (p.last === q.last && (!q.firstInitial || p.first.startsWith(q.firstInitial))) {
      return i;
    }
  }
  return -1;
}

/** Build indices for strong, unambiguous roster resolution. */
function buildNameIndex(rows: PlayerRow[]) {
  const full = new Map<string, number>();
  const last2 = new Map<string, number[]>();
  const last1 = new Map<string, number[]>();
  const lastCount = new Map<string, number>();
  const lastUnique = new Map<string, number>();

  const push = (m: Map<string, number[]>, k: string, i: number) => {
    const arr = m.get(k);
    if (arr) arr.push(i);
    else m.set(k, [i]);
  };

  rows.forEach((r, i) => {
    const p = partsFrom(r.Name);
    if (p.keyFull) full.set(p.keyFull, i);
    if (p.last) {
      lastCount.set(p.last, (lastCount.get(p.last) || 0) + 1);
      if (p.first2) push(last2, `${p.last}|${p.first2}`, i);
      if (p.firstInitial) push(last1, `${p.last}|${p.firstInitial}`, i);
    }
  });

  lastCount.forEach((cnt, last) => {
    if (cnt === 1) {
      const idx = rows.findIndex((r) => partsFrom(r.Name).last === last);
      if (idx !== -1) lastUnique.set(last, idx);
    }
  });

  if (DEBUG_ROSTER) {
    // eslint-disable-next-line no-console
    console.debug("[roster-index]", {
      full: full.size,
      last2_keys: last2.size,
      last1_keys: last1.size,
      lastUnique: Array.from(lastUnique.keys()),
    });
  }

  return { full, last2, last1, lastUnique };
}

function resolveRosterIndex(name: string, idx: ReturnType<typeof buildNameIndex>): number {
  const q = partsFrom(name);
  if (q.keyFull && idx.full.has(q.keyFull)) return idx.full.get(q.keyFull)!;
  if (q.last && q.first2 && q.first2.length === 2) {
    const a2 = idx.last2.get(`${q.last}|${q.first2}`) || [];
    if (a2.length === 1) return a2[0];
  }
  if (q.last && q.firstInitial) {
    const a1 = idx.last1.get(`${q.last}|${q.firstInitial}`) || [];
    if (a1.length === 1) return a1[0];
  }
  if (q.last && q.first && q.first.replace(/[^a-z]/g, "").length <= 1) {
    const u = idx.lastUnique.get(q.last);
    if (typeof u === "number") return u;
  }
  return -1;
}

/* =======================
   Component
   ======================= */

export default function App() {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [budget, setBudget] = useState<number>(180);
  const [k, setK] = useState<number>(5);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Winner keywords (owner/team aliases)
  const [winnerKeys, setWinnerKeys] = useState<string>(() => {
    try {
      return localStorage.getItem("winnerKeys") || "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("winnerKeys", winnerKeys);
    } catch {}
  }, [winnerKeys]);

  const winnerKeyList = useMemo(
    () =>
      winnerKeys
        .split(",")
        .map((s) => s.toLowerCase().trim())
        .filter(Boolean),
    [winnerKeys]
  );

  const winnerMatchesMe = useCallback(
    (winnerText?: string, wonByYouFlag?: boolean) => {
      if (wonByYouFlag) return true;
      const w = String(winnerText || "").toLowerCase().trim();
      if (!w) return false;
      if (/\b(you|your team)\b/.test(w)) return true;
      if (winnerKeyList.length === 0) return false;
      return winnerKeyList.some((k) => k && w.includes(k));
    },
    [winnerKeyList]
  );

  /* ---- filters ---- */
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [search, setSearch] = useState<string>("");
  const deferredSearch = useDeferredValue(search);
  const [isPending, startTransition] = useTransition();

  const handleSetPositions = useCallback((vals: string[]) => {
    startTransition(() => setSelectedPositions(vals));
  }, []);

  /* ---- sorting ---- */
  const [sortKey, setSortKey] = useState<SortKey>("Projection");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const requestSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "Price" || key === "Projection" ? "desc" : "asc");
    }
  };

  /* ---- nominated pin/highlight ---- */
  const [activeNomName, setActiveNomName] = useState<string | null>(null);

  const namesFromSolution = useCallback((s: any): string[] => {
    if (!s) return [];
    if (Array.isArray(s.table)) return s.table.map((p: any) => String(p?.Name ?? p?.name ?? ""));
    if (Array.isArray(s.players)) return s.players.map((p: any) => String(p?.Name ?? p?.name ?? ""));
    if (Array.isArray(s.lineup)) return s.lineup.map((p: any) => String(p?.Name ?? p?.name ?? ""));
    if (Array.isArray(s.rows)) return s.rows.map((p: any) => String(p?.Name ?? p?.name ?? ""));
    return [];
  }, []);

  const lineupMembership = useMemo(() => {
    const first = solutions[0] ? new Set(namesFromSolution(solutions[0])) : new Set<string>();
    const others = new Set<string>();
    solutions.slice(1).forEach((sol) => {
      for (const n of namesFromSolution(sol)) others.add(n);
    });
    return { first, others };
  }, [solutions, namesFromSolution]);

  /* ---- upload ---- */
  const onUpload = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseSheet(file, { debug: true });
      if (!parsed || parsed.length === 0) {
        setRows([]);
        setSolutions([]);
        setError(
          "Couldn’t detect Name/Pos/Price/Projection in that sheet. Check console for mapping logs."
        );
        return;
      }
      setRows(parsed);
      setSolutions([]);
      setActiveNomName(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---- edit ---- */
  const onEdit = (originalIndex: number, patch: Partial<PlayerRow>) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[originalIndex] = { ...copy[originalIndex], ...patch };
      return copy;
    });
  };

  /* ---- filtered/sorted view (with pin-to-top for active) ---- */
  const activeNomIdx = useMemo(
    () => (activeNomName ? looseIndexByName(rows, activeNomName) : -1),
    [rows, activeNomName]
  );

  const filteredRows: ViewRow[] = useMemo(() => {
    const s = deferredSearch.trim().toLowerCase();
    const hasPos = selectedPositions.length > 0;

    const base = rows
      .map((r, i) => ({ ...r, __idx: i }))
      .filter(
        (r) =>
          (!hasPos || selectedPositions.includes(r.Pos)) &&
          (!s || r.Name.toLowerCase().includes(s))
      );

    const dir = sortDir === "asc" ? 1 : -1;
    const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const str = (v: any) => String(v ?? "").toLowerCase();
    const boo = (v: any) => (v ? 1 : 0);

    base.sort((a, b) => {
      let res = 0;
      switch (sortKey) {
        case "Price":
          res = num(a.Price) - num(b.Price);
          break;
        case "Projection":
          res = num(a.Projection) - num(b.Projection);
          break;
        case "Name":
          res = str(a.Name).localeCompare(str(b.Name));
          break;
        case "Pos":
          res = str(a.Pos).localeCompare(str(b.Pos));
          break;
        case "anchor":
          res = boo(a.anchor) - boo(b.anchor);
          break;
        case "exclude":
          res = boo(a.exclude) - boo(b.exclude);
          break;
      }
      if (res === 0) res = str(a.Name).localeCompare(str(b.Name));
      return dir * res;
    });

    // Pin nominated row to top (if it survived filters)
    if (activeNomIdx >= 0) {
      const i = base.findIndex((r) => r.__idx === activeNomIdx);
      if (i > 0) {
        const [row] = base.splice(i, 1);
        base.unshift(row);
      }
    }

    return base;
  }, [rows, deferredSearch, selectedPositions, sortKey, sortDir, activeNomIdx]);

  const onClearAllFilters = () => {
    setSelectedPositions([]);
    setSearch("");
  };

  /* ---- auto-optimize (debounced) ---- */
  const rowsSignature = useMemo(
    () =>
      JSON.stringify(
        rows.map((r) => ({
          n: r.Name,
          p: r.Pos,
          $: r.Price,
          pr: r.Projection,
          a: !!r.anchor,
          x: !!r.exclude,
        }))
      ),
    [rows]
  );

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (rows.length === 0) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setBusy(true);
      setError(null);
      const myReq = ++reqIdRef.current;
      try {
        const sols = await optimize(rows, budget, k, ctl.signal);
        if (myReq === reqIdRef.current) setSolutions(sols);
      } catch (e: any) {
        const code = e?.code || e?.name || "";
        if (!String(code).toLowerCase().includes("cancel")) {
          if (myReq === reqIdRef.current) {
            setSolutions([]);
            setError(e?.message ?? String(e));
          }
        }
      } finally {
        if (myReq === reqIdRef.current) setBusy(false);
      }
    }, AUTO_OPT_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [rowsSignature, budget, k]);

  const onOptimizeNow = async () => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setError(null);
    const myReq = ++reqIdRef.current;
    try {
      const sols = await optimize(rows, budget, k, ctl.signal);
      if (myReq === reqIdRef.current) setSolutions(sols);
    } catch (e: any) {
      const code = e?.code || e?.name || "";
      if (!String(code).toLowerCase().includes("cancel")) {
        if (myReq === reqIdRef.current) {
          setSolutions([]);
          setError(e?.message ?? String(e));
        }
      }
    } finally {
      if (myReq === reqIdRef.current) setBusy(false);
    }
  };

  /* ---- socket: roster / bid_update / player_sold ---- */
  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      withCredentials: false,
    });

    socket.on("connect_error", (err) => {
      console.warn("[socket] connect_error:", err?.message || err);
    });

    socket.on("draft_event", (evt: any) => {
      if (!evt?.type) return;

      if (evt.type === "my_team" && evt.name) {
        const maybe = String(evt.name).trim();
        setWinnerKeys((prev) => {
          if (!maybe) return prev;
          const low = prev.toLowerCase();
          if (low.includes(maybe.toLowerCase())) return prev;
          return prev ? `${prev}, ${maybe}` : maybe;
        });
        return;
      }

      // Strong roster anchoring (unambiguous only)
      if (evt.type === "roster" && Array.isArray(evt.names)) {
        const incoming = evt.names as string[];
        setRows((prev) => {
          const idx = buildNameIndex(prev);
          const toAnchor = new Set<number>();
          for (const n of incoming) {
            const i = resolveRosterIndex(n, idx);
            if (DEBUG_ROSTER) console.debug("[roster-in]", n, "->", i);
            if (i !== -1) toAnchor.add(i);
          }
          if (toAnchor.size === 0) return prev;
          return prev.map((r, i) =>
            toAnchor.has(i) ? { ...r, anchor: true, exclude: false } : r
          );
        });
        return;
      }

      // Live bid update → update Price and mark active by NAME
      if (evt.type === "bid_update") {
        if (!evt.player_name) return;
        const price =
          Number.isFinite(evt.bid) && evt.bid != null ? Number(evt.bid) : undefined;

        setRows((prev) => {
          const copy = [...prev];
          const idx = looseIndexByName(copy, evt.player_name);
          if (idx === -1) return prev;
          const r = { ...copy[idx] };
          if (price != null) r.Price = price;
          copy[idx] = r;
          return copy;
        });

        setActiveNomName(String(evt.player_name));
        return;
      }

      // Player sold
      if (evt.type === "player_sold") {
        if (!evt.player_name) return;
        const price =
          Number.isFinite(evt.bid) && evt.bid != null ? Number(evt.bid) : undefined;

        setRows((prev) => {
          const copy = [...prev];
          const idx = looseIndexByName(copy, evt.player_name);
          if (idx === -1) return prev;
          const r = { ...copy[idx] };
          if (price != null) r.Price = price;

          if (!evt.winner) {
            if (!r.anchor) r.exclude = true; // unknown winner → exclude unless already ours
          } else {
            const won = winnerMatchesMe(evt.winner, evt.won_by_you || evt.wonByYou);
            r.anchor = !!won;
            r.exclude = !won;
          }
          copy[idx] = r;
          return copy;
        });

        if (activeNomName && evt.player_name && String(evt.player_name) === activeNomName) {
          setActiveNomName(null);
        }
        return;
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [winnerMatchesMe, activeNomName]);

  // Compute highlight color from solutions for the active nomination
  const highlightColor = useMemo(() => {
    if (activeNomIdx < 0) return null;
    const nm = rows[activeNomIdx]?.Name;
    if (!nm) return "red";
    if (lineupMembership.first.has(nm)) return "green";
    if (lineupMembership.others.has(nm)) return "yellow";
    return "red";
  }, [activeNomIdx, rows, lineupMembership]);

  /* ---- UI ---- */
  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: "auto" }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Fantasy Auction Lineup Optimizer
      </Typography>

      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        sx={{ mb: 2, flexWrap: "wrap" }}
      >
        <Button variant="contained" component="label" disabled={busy}>
          Upload CSV/XLSX
          <input
            hidden
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => onUpload(e.target.files?.[0] || null)}
          />
        </Button>

        <TextField
          label="Budget"
          type="number"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value || 0))}
          size="small"
          sx={{ width: 140 }}
        />

        <TextField
          label="Top-K lineups"
          type="number"
          value={k}
          onChange={(e) => setK(Number(e.target.value || 1))}
          size="small"
          sx={{ width: 160 }}
        />

        <TextField
          label="Winner keywords (comma-separated)"
          value={winnerKeys}
          onChange={(e) => setWinnerKeys(e.target.value)}
          placeholder="e.g., Stephen's Squad, Stephen"
          size="small"
          sx={{ width: 320 }}
        />

        <Button
          variant="outlined"
          onClick={onOptimizeNow}
          disabled={busy || rows.length === 0}
        >
          {busy ? "Optimizing…" : "Optimize now"}
        </Button>
        <Typography variant="body2" color="text.secondary">
          Auto-optimize on change is enabled
        </Typography>
      </Stack>

      <FilterBar
        posOptions={["QB", "RB", "WR", "TE"]}
        selectedPositions={selectedPositions}
        setSelectedPositions={handleSetPositions}
        search={search}
        setSearch={setSearch}
        onClearAll={onClearAllFilters}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "1fr 420px" },
          alignItems: "start",
          minHeight: "60vh",
        }}
      >
        <Paper
          sx={{
            p: 0,
            border: "1px solid #333",
            bgcolor: "#111",
            height: { xs: "auto", md: "calc(100vh - 260px)" },
          }}
        >
          <PlayersTable
            rows={filteredRows}
            onEdit={onEdit}
            listHeight={
              typeof window !== "undefined"
                ? Math.max(400, window.innerHeight - 320)
                : 560
            }
            rowHeight={48}
            sortKey={sortKey}
            sortDir={sortDir}
            onRequestSort={requestSort}
            highlightOriginalIndex={activeNomIdx >= 0 ? activeNomIdx : null}
            highlightColor={highlightColor}
          />
        </Paper>

        <Box sx={{ position: { md: "sticky" }, top: { md: 16 } }}>
          <ResultsView solutions={solutions} />
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Showing {filteredRows.length} of {rows.length}{" "}
        {isPending ? "(updating…)" : ""} {busy ? "• optimizing…" : ""}
      </Typography>
    </Box>
  );
}
