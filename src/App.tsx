// src/App.tsx
import { useMemo, useState, useTransition, useDeferredValue, useCallback } from 'react';
import { Box, Button, Stack, TextField, Typography, Alert, Paper } from '@mui/material';
import type { PlayerRow, Solution } from './types';
import PlayersTable from './components/PlayersTable';
import ResultsView from './components/ResultsView';
import FilterBar from './components/FilterBar';
import { parseSheet, optimize } from './api';

type ViewRow = PlayerRow & { __idx: number };

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

  // Smooth typing for search
  const deferredSearch = useDeferredValue(search);

  // Concurrent UI update for position toggles
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

  // Update a row by original index (works even when filtered)
  const onEdit = (originalIndex: number, patch: Partial<PlayerRow>) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[originalIndex] = { ...copy[originalIndex], ...patch };
      return copy;
    });
  };

  // Apply filters (case-insensitive search; multi-pos) + SORT BY PROJECTION DESC
  const filteredRows: ViewRow[] = useMemo(() => {
    const s = deferredSearch.trim().toLowerCase();
    const hasPosFilter = selectedPositions.length > 0;

    const out = rows
      .map((r, i) => ({ ...r, __idx: i }))
      .filter((r) => {
        if (hasPosFilter && !selectedPositions.includes(r.Pos)) return false;
        if (s && !r.Name.toLowerCase().includes(s)) return false;
        return true;
      })
      .sort((a, b) => {
        const pa = Number(a.Projection ?? 0);
        const pb = Number(b.Projection ?? 0);
        if (pb !== pa) return pb - pa;           // projection DESC
        // optional tiebreakers:
        const na = (a.Name || '').toLowerCase();
        const nb = (b.Name || '').toLowerCase();
        return na.localeCompare(nb);
      });

    return out;
  }, [rows, deferredSearch, selectedPositions]);

  const onClearAllFilters = () => {
    setSelectedPositions([]);
    setSearch('');
  };

  const onOptimize = async () => {
    setBusy(true);
    setError(null);
    try {
      const sols = await optimize(rows, budget, k); // send ALL rows; filters are UI-only
      setSolutions(sols);
    } catch (e: any) {
      setSolutions([]);
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
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

        <Button variant="contained" onClick={onOptimize} disabled={busy || rows.length === 0}>
          {busy ? 'Optimizing…' : 'Optimize'}
        </Button>
      </Stack>

      <FilterBar
        posOptions={['QB','RB','WR','TE']}
        selectedPositions={selectedPositions}
        setSelectedPositions={handleSetPositions}
        search={search}
        setSearch={setSearch}
        onClearAll={onClearAllFilters}
      />

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* Two-pane layout */}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: '1fr 420px' },
          alignItems: 'start',
          minHeight: '60vh',
        }}
      >
        {/* Left: filtered table in a tall scrollable card */}
        <Paper sx={{ p: 0, border: '1px solid #333', bgcolor: '#111', height: { xs: 'auto', md: 'calc(100vh - 260px)' } }}>
          {/* Virtualized list inside PlayersTable */}
          <PlayersTable rows={filteredRows} onEdit={onEdit} listHeight={window.innerHeight ? Math.max(400, window.innerHeight - 320) : 560} />
        </Paper>

        {/* Right: results pane is sticky */}
        <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          <ResultsView solutions={solutions} />
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Showing {filteredRows.length} of {rows.length} {isPending ? '(updating…)': ''}
      </Typography>
    </Box>
  );
}
