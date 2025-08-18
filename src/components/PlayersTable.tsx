import React from 'react';
import { type PlayerRow } from '../types';
import { Box, Checkbox, TextField } from '@mui/material';

type ViewRow = PlayerRow & { __idx?: number };

type Props = {
  rows: ViewRow[]; // may be filtered; __idx maps back to original index
  onEdit: (originalIndex: number, patch: Partial<PlayerRow>) => void;
};

export default function PlayersTable({ rows, onEdit }: Props) {
  const headerCell: React.CSSProperties = {
    fontWeight: 600,
    padding: '8px',
    textAlign: 'left',
    position: 'sticky',
    top: 0,
    background: '#111',
    zIndex: 1
  };
  const cell: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid #333' };

  const update = (viewIndex: number, patch: Partial<PlayerRow>) => {
    const r = rows[viewIndex];
    const original = r.__idx ?? viewIndex;
    onEdit(original, patch);
  };

  return (
    <Box sx={{ border: '1px solid #444', borderRadius: 2, height: '100%', overflow: 'hidden' }}>
      <Box sx={{ width: '100%', height: '100%', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headerCell}>Anchor</th>
              <th style={headerCell}>Exclude</th>
              <th style={headerCell}>Name</th>
              <th style={headerCell}>Pos</th>
              <th style={headerCell}>Price</th>
              <th style={headerCell}>Projection</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.Name}-${r.Pos}-${r.__idx ?? i}`}>
                <td style={cell}>
                  <Checkbox
                    size="small"
                    checked={!!r.anchor}
                    onChange={(e) => update(i, { anchor: e.target.checked, exclude: e.target.checked ? false : r.exclude })}
                  />
                </td>
                <td style={cell}>
                  <Checkbox
                    size="small"
                    checked={!!r.exclude}
                    onChange={(e) => update(i, { exclude: e.target.checked, anchor: e.target.checked ? false : r.anchor })}
                  />
                </td>
                <td style={cell}>{r.Name}</td>
                <td style={cell}>{r.Pos}</td>
                <td style={cell}>
                  <TextField
                    size="small"
                    type="number"
                    value={r.Price ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const n = val === '' ? 0 : Math.trunc(Number(val));
                      update(i, { Price: Number.isFinite(n) && n >= 0 ? n : 0 });
                    }}
                    inputProps={{ min: 0, step: 1 }}
                  />
                </td>
                <td style={cell}>
                  <TextField
                    size="small"
                    type="number"
                    value={r.Projection ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const n = val === '' ? 0 : Number(val);
                      update(i, { Projection: Number.isFinite(n) && n >= 0 ? n : 0 });
                    }}
                    inputProps={{ min: 0, step: '0.1' }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  );
}
