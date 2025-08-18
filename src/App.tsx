import React, { useState } from 'react';
import { Box, Button, Stack, TextField, Typography, Paper, Divider, Alert } from '@mui/material';
import type { PlayerRow, Solution } from './types';
import PlayersTable from './components/PlayersTable';
import ResultsView from './components/ResultsView';
import { parseSheet, optimize } from './api';

export default function App() {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [budget, setBudget] = useState<number>(180);
  const [k, setK] = useState<number>(5);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const onOptimize = async () => {
    setBusy(true);
    setError(null);
    try {
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
    <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Fantasy Auction Lineup Optimizer (Strict Top-K)
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

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <PlayersTable rows={rows} setRows={setRows} />

      <Divider sx={{ my: 3 }} />

      <Typography variant="h6" sx={{ mb: 1 }}>
        Results
      </Typography>
      <ResultsView solutions={solutions} />
    </Box>
  );
}
