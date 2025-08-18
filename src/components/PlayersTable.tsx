import React from 'react';
import { type PlayerRow } from '../types';
import { Box, Checkbox, TextField } from '@mui/material';

type Props = {
  rows: PlayerRow[];
  setRows: (rows: PlayerRow[]) => void;
};

export default function PlayersTable({ rows, setRows }: Props) {
  const update = (i: number, patch: Partial<PlayerRow>) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], ...patch };
    setRows(copy);
  };

  const headerStyle: React.CSSProperties = { fontWeight: 600, padding: '8px', textAlign: 'left' };
  const cellStyle: React.CSSProperties = { padding: '6px 8px', borderTop: '1px solid #333' };

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid #444', borderRadius: 2 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={headerStyle}>Include</th>
            <th style={headerStyle}>Anchor</th>
            <th style={headerStyle}>Exclude</th>
            <th style={headerStyle}>Name</th>
            <th style={headerStyle}>Pos</th>
            <th style={headerStyle}>Price</th>
            <th style={headerStyle}>Projection</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.Name}-${i}`}>
              <td style={cellStyle}>
                <Checkbox
                  size="small"
                  checked={!!r.include}
                  onChange={(e) =>
                    update(i, {
                      include: e.target.checked,
                      // keep exclude mutually exclusive
                      exclude: e.target.checked ? false : r.exclude,
                    })
                  }
                />
              </td>
              <td style={cellStyle}>
                <Checkbox
                  size="small"
                  checked={!!r.anchor}
                  onChange={(e) =>
                    update(i, {
                      anchor: e.target.checked,
                      // anchors imply not excluded
                      exclude: e.target.checked ? false : r.exclude,
                    })
                  }
                />
              </td>
              <td style={cellStyle}>
                <Checkbox
                  size="small"
                  checked={!!r.exclude}
                  onChange={(e) =>
                    update(i, {
                      exclude: e.target.checked,
                      // exclude clears include/anchor
                      include: e.target.checked ? false : r.include,
                      anchor: e.target.checked ? false : r.anchor,
                    })
                  }
                />
              </td>
              <td style={cellStyle}>{r.Name}</td>
              <td style={cellStyle}>{r.Pos}</td>
              <td style={cellStyle}>
                <TextField
                  size="small"
                  type="number"
                  value={r.Price ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    update(i, { Price: val === '' ? 0 : Math.max(0, Math.trunc(Number(val))) });
                  }}
                  inputProps={{ min: 0, step: 1 }}
                />
              </td>
              <td style={cellStyle}>
                <TextField
                  size="small"
                  type="number"
                  value={r.Projection ?? ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    update(i, { Projection: val === '' ? 0 : Number(val) });
                  }}
                  inputProps={{ min: 0, step: '0.1' }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}
