// src/components/ResultsView.tsx
import React from 'react';
import { type Solution } from '../types';
import { Box, Paper, Typography } from '@mui/material';

export default function ResultsView({ solutions }: { solutions: Solution[] }) {
  if (!solutions?.length) {
    return (
      <Paper sx={{ p: 2, border: '1px solid #333', bgcolor: '#111' }}>
        <Typography variant="body2" color="text.secondary">No results yet.</Typography>
      </Paper>
    );
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #333' };
  const td: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid #333' };
  const nameTd: React.CSSProperties = {
    ...td,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {solutions.map((sol) => (
        <Paper key={sol.rank} sx={{ p: 2, border: '1px solid #333', bgcolor: '#111' }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Lineup #{sol.rank} • Cost ${sol.total_cost} • Proj {sol.total_points}
          </Typography>

          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              {/* Fix widths for small cols; let Name take the rest */}
              <colgroup>
                <col style={{ width: '68px' }} />    {/* Slot */}
                <col style={{ width: '200px' }} />   {/* Name */}
                <col style={{ width: '60px' }} />    {/* Pos */}
                <col style={{ width: '84px' }} />    {/* Price */}
                <col style={{ width: '110px' }} />   {/* Projection */}
                <col style={{ width: '72px' }} />    {/* PP$ */}
              </colgroup>

              <thead>
                <tr>
                  <th style={th}>Slot</th>
                  <th style={th}>Name</th>
                  <th style={th}>Pos</th>
                  <th style={th}>Price</th>
                  <th style={th}>Projection</th>
                  <th style={th}>PP$</th>
                </tr>
              </thead>
              <tbody>
                {sol.table.map((r, i) => (
                  <tr key={i}>
                    <td style={td}>{r.Slot}</td>
                    <td style={nameTd} title={r.Name}>{r.Name}</td> {/* no-wrap + ellipsis */}
                    <td style={td}>{r.Pos}</td>
                    <td style={td}>${r.Price}</td>
                    <td style={td}>{r.Projection}</td>
                    <td style={td}>{r['PP$'] ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        </Paper>
      ))}
    </Box>
  );
}
