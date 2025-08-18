import { useMemo, useState, useTransition, useDeferredValue, useCallback, useEffect, useRef } from 'react';
import { Box, Button, Stack, TextField, Typography, Alert, Paper } from '@mui/material';
import type { PlayerRow, Solution } from './types';
import PlayersTable from './components/PlayersTable';
import ResultsView from './components/ResultsView';
import FilterBar from './components/FilterBar';
import { parseSheet, optimize } from './api';

type ViewRow = PlayerRow & { __idx: number };
type SortKey = 'Name' | 'Pos' | 'Price' | 'Projection' | 'anchor' | 'exclude';
type SortDir = 'asc' | 'desc';

const AUTO_OPT_DEBOUNCE_MS = 600; // keep your auto-optimize

export default function App() {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [budget, setBudget] = useState<number>(180);
  const [k, setK] = useState<number>(5);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const posOptions = ['QB', 'RB', 'WR', 'TE'];
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [search, setSearch] = useState<string>('');
  const deferredSearch = useDeferredValue(search);
  const [isPending, startTransition] = useTransition();
  const handleSetPositions = useCallback((vals: string[]) => {
    startTransition(() => setSelectedPositions(vals));
  }, []);

  // Sort state (default: Projection desc)
  const [sortKey, setSortKey] = useState<SortKey>('Projection');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const requestSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // default direction by type: numbers -> desc, text/bool -> asc
      setSortDir(key === 'Price' || key === 'Projection' ? 'desc' : 'asc');
    }
  };

  const onUpload = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseSheet(file);
      setRows(parsed);
      setSolutions([]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const onEdit = (originalIndex: number, patch: Partial<PlayerRow>) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[originalIndex] = { ...copy[originalIndex], ...patch };
      return copy;
    });
  };

  // Apply filters + SORT by chosen column
  const filteredRows: ViewRow[] = useMemo(() => {
    const s = deferredSearch.trim().toLowerCase();
    const hasPosFilter = selectedPositions.length > 0;

    const base = rows
      .map((r, i) => ({ ...r, __idx: i }))
      .filter((r) => (!hasPosFilter || selectedPositions.includes(r.Pos)) && (!s || r.Name.toLowerCase().includes(s)));

    const cmp = (a: ViewRow, b: ViewRow) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const num = (v: any) => Number.isFinite(Number(v)) ? Number(v) : 0;
      const str = (v: any) => String(v ?? '').toLowerCase();
      const boo = (v: any) => (v ? 1 : 0);

      let res = 0;
      switch (sortKey) {
        case 'Price':
          res = num(a.Price) - num(b.Price);
          break;
        case 'Projection':
          res = num(a.Projection) - num(b.Projection);
          break;
        case 'Name':
          res = str(a.Name).localeCompare(str(b.Name));
          break;
        case 'Pos':
          res = str(a.Pos).localeCompare(str(b.Pos));
          break;
        case 'anchor':
          res = boo(a.anchor) - boo(b.anchor);
          break;
        case 'exclude':
          res = boo(a.exclude) - boo(b.exclude);
          break;
      }
      if (res === 0) {
        // secondary stable tiebreakers
        const t = str(a.Name).localeCompare(str(b.Name));
        if (t !== 0) res = t;
      }
      return dir * res;
    };

    return base.sort(cmp);
  }, [rows, deferredSearch, selectedPositions, sortKey, sortDir]);

  const onClearAllFilters = () => {
    setSelectedPositions([]);
    setSearch('');
  };

  // -------------------
  // Auto-optimize (unchanged)
  const rowsSignature = useMemo(
    () => JSON.stringify(rows.map((r) => ({ n: r.Name, p: r.Pos, $: r.Price, pr: r.Projection, a: !!r.anchor, x: !!r.exclude })) ),
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
        const code = e?.code || e?.name || '';
        if (!String(code).toLowerCase().includes('cancel')) {
          if (myReq === reqIdRef.current) {
            setSolutions([]);
            setError(e?.message ?? String(e));
          }
        }
      } finally {
        if (myReq === reqIdRef.current) setBusy(false);
      }
    }, AUTO_OPT_DEBOUNCE_MS);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [rowsSignature, budget, k]);
  // -------------------

  // Manual button still available
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
      const code = e?.code || e?.name || '';
      if (!String(code).toLowerCase().includes('cancel')) {
        if (myReq === reqIdRef.current) {
          setSolutions([]);
          setError(e?.message ?? String(e));
        }
      }
    } finally {
      if (myReq === reqIdRef.current) setBusy(false);
    }
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1600, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>Fantasy Auction Lineup Optimizer</Typography>

      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" component="label" disabled={busy}>
          Upload CSV/XLSX
          <input hidden type="file" accept=".csv,.xlsx,.xls" onChange={(e) => onUpload(e.target.files?.[0] || null)} />
        </Button>

        <TextField label="Budget" type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value || 0))} size="small" sx={{ width: 140 }} />
        <TextField label="Top-K lineups" type="number" value={k} onChange={(e) => setK(Number(e.target.value || 1))} size="small" sx={{ width: 160 }} />

        <Button variant="outlined" onClick={onOptimizeNow} disabled={busy || rows.length === 0}>
          {busy ? 'Optimizing…' : 'Optimize now'}
        </Button>
        <Typography variant="body2" color="text.secondary">Auto-optimize on change is enabled</Typography>
      </Stack>

      <FilterBar
        posOptions={posOptions}
        selectedPositions={selectedPositions}
        setSelectedPositions={handleSetPositions}
        search={search}
        setSearch={setSearch}
        onClearAll={onClearAllFilters}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 420px' }, alignItems: 'start', minHeight: '60vh' }}>
        <Paper sx={{ p: 0, border: '1px solid #333', bgcolor: '#111', height: { xs: 'auto', md: 'calc(100vh - 260px)' } }}>
          <PlayersTable
            rows={filteredRows}
            onEdit={onEdit}
            listHeight={window.innerHeight ? Math.max(400, window.innerHeight - 320) : 560}
            rowHeight={48}
            sortKey={sortKey}
            sortDir={sortDir}
            onRequestSort={requestSort}
          />
        </Paper>

        <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          <ResultsView solutions={solutions} />
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Showing {filteredRows.length} of {rows.length} {isPending ? '(updating…)' : ''} {busy ? '• optimizing…' : ''}
      </Typography>
    </Box>
  );
}
