import React, { useMemo, useState } from 'react';
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

  // Apply filters (case-insensitive search; multi-pos)
  const filteredRows: ViewRow[] = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .map((r, i) => ({ ...r, __idx: i }))
      .filter((r) => {
        const posOk = selectedPositions.length === 0 || selectedPositions.includes(r.Pos);
        const searchOk = !s || r.Name.toLowerCase().includes(s);
        return posOk && searchOk;
      });
  }, [rows, search, selectedPositions]);

  const onClearAllFilters = () => {
    setSelectedPositions([]);
    setSearch('');
  };

  const onOptimize = async () => {
    setBusy(true);
    setError(null);
    try {
      // Send ALL rows (including filtered-out ones); filters are UI only
      const sols = await optimize(rows, budget, k);
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

        <Button variant="contained" onClick={onOptimize} disabled={busy || rows.length === 0}>
          {busy ? 'Optimizing…' : 'Optimize'}
        </Button>
      </Stack>

      <FilterBar
        posOptions={posOptions}
        selectedPositions={selectedPositions}
        setSelectedPositions={setSelectedPositions}
        search={search}
        setSearch={setSearch}
        onClearAll={onClearAllFilters}
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

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
          <PlayersTable rows={filteredRows} onEdit={onEdit} />
        </Paper>

        {/* Right: results pane is sticky */}
        <Box sx={{ position: { md: 'sticky' }, top: { md: 16 } }}>
          <ResultsView solutions={solutions} />
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Showing {filteredRows.length} of {rows.length} players
      </Typography>
    </Box>
  );
}
