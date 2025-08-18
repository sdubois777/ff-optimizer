import { useMemo, useState, useTransition, useDeferredValue, useCallback, useEffect, useRef } from 'react';
import { Box, Button, Stack, TextField, Typography, Alert, Paper } from '@mui/material';
import type { PlayerRow, Solution } from './types';
import PlayersTable from './components/PlayersTable';
import ResultsView from './components/ResultsView';
import FilterBar from './components/FilterBar';
import { parseSheet, optimize } from './api';

type ViewRow = PlayerRow & { __idx: number };

const AUTO_OPT_DEBOUNCE_MS = 600; // tweak 300–800ms to taste

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

  // View: filters + projection-desc sort (UI only)
  const filteredRows: ViewRow[] = useMemo(() => {
    const s = deferredSearch.trim().toLowerCase();
    const hasPosFilter = selectedPositions.length > 0;
    return rows
      .map((r, i) => ({ ...r, __idx: i }))
      .filter((r) => (!hasPosFilter || selectedPositions.includes(r.Pos)) && (!s || r.Name.toLowerCase().includes(s)))
      .sort((a, b) => (Number(b.Projection ?? 0) - Number(a.Projection ?? 0)) || a.Name.localeCompare(b.Name));
  }, [rows, deferredSearch, selectedPositions]);

  const onClearAllFilters = () => {
    setSelectedPositions([]);
    setSearch('');
  };

  // --- AUTO OPTIMIZE ---
  // Build a minimal signature of the data that actually affects the optimizer
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

    // debounce
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      // cancel older request
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;

      setBusy(true);
      setError(null);
      const myReq = ++reqIdRef.current;

      try {
        const sols = await optimize(rows, budget, k, ctl.signal);
        // only apply if this is the latest in-flight call
        if (myReq === reqIdRef.current) setSolutions(sols);
      } catch (e: any) {
        // ignore cancellations; surface real errors
        const code = e?.code || e?.name || '';
        if (String(code).toLowerCase().includes('cancel')) {
          /* noop */
        } else if (myReq === reqIdRef.current) {
          setSolutions([]);
          setError(e?.message ?? String(e));
        }
      } finally {
        if (myReq === reqIdRef.current) setBusy(false);
      }
    }, AUTO_OPT_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // re-run when price/projection/anchor/exclude change, or budget/k
  }, [rowsSignature, budget, k]);

  // Manual button still useful if you ever turn auto off
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
      <Typography variant="h5" sx={{ mb: 2 }}>
        Fantasy Auction Lineup Optimizer
      </Typography>

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
          />
        </Paper>

        <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          <ResultsView solutions={solutions} />
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Showing {filteredRows.length} of {rows.length} {isPending ? '(updating…)': ''} {busy ? '• optimizing…' : ''}
      </Typography>
    </Box>
  );
}
